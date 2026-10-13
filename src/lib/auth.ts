import crypto from 'crypto';
import { cookies } from 'next/headers';
import db from './db';

const AUTH_SECRET = process.env.AUTH_SECRET || 'photogal-super-secure-production-secret-key-32b';
const SESSION_COOKIE_NAME = 'photogal_admin_session';

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derivedKey, 'hex'));
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
    if (crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
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
