import crypto from 'crypto';
import util from 'util';
import { cookies } from 'next/headers';
import db from './db';

const scryptAsync = util.promisify(crypto.scrypt);

const AUTH_SECRET = process.env.AUTH_SECRET || (
  process.env.NODE_ENV === 'production'
    ? (() => {
        console.warn('⚠️ WARNING: AUTH_SECRET is not set in production! Define AUTH_SECRET in your environment.');
        return 'photogal-super-secure-production-secret-key-32b';
      })()
    : 'photogal-super-secure-production-secret-key-32b'
);
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
  const hmac = crypto.createHmac('sha256', AUTH_SECRET);
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
    const hmac = crypto.createHmac('sha256', AUTH_SECRET);
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
  const payload = JSON.stringify({ adminId, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 }); // 7 days
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
    const row = db.prepare('SELECT id FROM admins WHERE id = ?').get(data.adminId) as { id: string } | undefined;
    return row?.id || null;
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
