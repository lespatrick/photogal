import crypto from 'crypto';
import util from 'util';
import { cookies } from 'next/headers';
import db from './db';

import type { NextRequest } from 'next/server';

const scryptAsync = util.promisify(crypto.scrypt);

let cachedAuthSecret: string | null = null;

export function getAuthSecret(): string {
  if (cachedAuthSecret) return cachedAuthSecret;
  if (process.env.AUTH_SECRET) {
    cachedAuthSecret = process.env.AUTH_SECRET;
    return cachedAuthSecret;
  }

  // Load or generate persistent random secret from settings table in SQLite
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('auth_secret') as { value: string } | undefined;
    if (row?.value) {
      cachedAuthSecret = row.value;
      return cachedAuthSecret;
    }

    const generated = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('auth_secret', generated);
    cachedAuthSecret = generated;
    return cachedAuthSecret;
  } catch {
    // Fallback if DB is not ready during tests/bootstrap
    const ephemeral = crypto.randomBytes(32).toString('hex');
    cachedAuthSecret = ephemeral;
    return ephemeral;
  }
}

export const SESSION_COOKIE_NAME = 'photogal_admin_session';
export const CLIENT_COOKIE_PREFIX = 'photogal_client_';

export async function hashPassword(password: string, saltHex?: string): Promise<string> {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const keyBuf = Buffer.from(key, 'hex');
    if (keyBuf.length !== derivedKey.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedKey);
  } catch {
    return false;
  }
}

export function signToken(data: string): string {
  const secret = getAuthSecret();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  const signature = hmac.digest('hex');
  return `${Buffer.from(data).toString('base64url')}.${signature}`;
}

export function verifyToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedData, signature] = parts;
    const data = Buffer.from(encodedData, 'base64url').toString('utf-8');
    const secret = getAuthSecret();
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(data);
    const expectedSignature = hmac.digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expectedSigBuf = Buffer.from(expectedSignature, 'hex');
    if (sigBuf.length !== expectedSigBuf.length) return null;
    if (crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createAdminSession(adminId: string) {
  const cookieStore = await cookies();
  const admin = db.prepare('SELECT id, token_version FROM admins WHERE id = ?').get(adminId) as { id: string; token_version?: number } | undefined;
  const tokenVersion = admin?.token_version || 1;
  const payload = JSON.stringify({
    adminId,
    tokenVersion,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  });
  const token = signToken(payload);
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return token;
}

export async function verifyAdminSession(): Promise<boolean> {
  const id = await getAdminSessionId();
  return !!id;
}

export async function getAdminSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;

  const verified = verifyToken(sessionToken);
  if (!verified) return null;

  try {
    const data = JSON.parse(verified);
    if (!data.adminId || data.exp < Date.now()) return null;
    const row = db.prepare('SELECT id, token_version FROM admins WHERE id = ?').get(data.adminId) as { id: string; token_version?: number } | undefined;
    if (!row) return null;
    // Enforce token version to invalidate sessions on password reset
    if (data.tokenVersion !== undefined && row.token_version !== undefined && data.tokenVersion !== row.token_version) {
      return null;
    }
    return row.id;
  } catch {
    return null;
  }
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

// Client PIN verification token
export function createClientToken(galleryId: string): string {
  const payload = JSON.stringify({ galleryId, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }); // 30 days
  return signToken(payload);
}

export function verifyClientToken(token: string, expectedGalleryId: string): boolean {
  const verified = verifyToken(token);
  if (!verified) return false;
  try {
    const data = JSON.parse(verified);
    return data.galleryId === expectedGalleryId && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function extractClientIp(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip');
  if (realIp) {
    const clean = realIp.trim().replace(/[^a-fA-F0-9:.]/g, '').substring(0, 45);
    if (clean) return clean;
  }

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const list = forwarded.split(',').map((s) => s.trim().replace(/[^a-fA-F0-9:.]/g, '')).filter(Boolean);
    // Use the rightmost IP appended by the trusted reverse proxy to defeat client spoofing
    if (list.length > 0) {
      return list[list.length - 1].substring(0, 45);
    }
  }

  return '127.0.0.1';
}

export function extractClientToken(req: NextRequest, galleryId?: string): string | null {
  const headerToken = req.headers.get('x-client-token');
  if (headerToken) return headerToken;

  const queryToken = req.nextUrl.searchParams.get('token');
  if (queryToken) return queryToken;

  if (galleryId) {
    const cookieToken = req.cookies.get(`${CLIENT_COOKIE_PREFIX}${galleryId}`)?.value;
    return cookieToken || null;
  }

  // Fallback: check all cookies starting with photogal_client_ only when galleryId is omitted
  for (const cookie of req.cookies.getAll()) {
    if (cookie.name.startsWith(CLIENT_COOKIE_PREFIX)) {
      return cookie.value;
    }
  }

  return null;
}
