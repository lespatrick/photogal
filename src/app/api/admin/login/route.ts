import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyPassword, createAdminSession, destroyAdminSession, verifyAdminSession, getAuthSecret, extractClientIp } from '@/lib/auth';

import crypto from 'crypto';

// In-memory rate limiting for admin password login (15 min window)
const failedAttemptsMap = new Map<string, { count: number; lastAttempt: number }>();
const MAX_MAP_ENTRIES = 10000;

// Dummy hash for constant-time comparison against nonexistent users
const DUMMY_HASH = '0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function getAdminIpHash(req: NextRequest): string {
  const ip = extractClientIp(req);
  return crypto.createHash('sha256').update(ip + getAuthSecret()).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const now = Date.now();

    // Prune stale entries (> 15 min) when map grows
    if (failedAttemptsMap.size > 100) {
      for (const [key, val] of failedAttemptsMap.entries()) {
        if (now - val.lastAttempt > 15 * 60 * 1000) {
          failedAttemptsMap.delete(key);
        }
      }
    }

    const ipHash = getAdminIpHash(req);
    const attempt = failedAttemptsMap.get(ipHash);

    if (attempt && (now - attempt.lastAttempt < 15 * 60 * 1000)) {
      if (attempt.count >= 5) {
        return NextResponse.json({
          error: 'Zbyt wiele nieudanych prób logowania. Odczekaj 15 minut przed kolejną próbą.',
        }, { status: 429 });
      }
      if (attempt.count >= 3) {
        // Tarpit delay
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    let username: string | undefined;
    let password: string | undefined;
    try {
      const body = await req.json();
      username = body?.username;
      password = body?.password;
    } catch {
      return NextResponse.json({ error: 'Nieprawidłowe dane żądania' }, { status: 400 });
    }

    if (!username || !password) {
      return NextResponse.json({ error: 'Nazwa użytkownika i hasło są wymagane.' }, { status: 400 });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username) as {
      id: string;
      username: string;
      password_hash: string;
    } | undefined;

    // Defeat username enumeration: run scrypt verification regardless of whether the user exists
    const hashToVerify = admin ? admin.password_hash : DUMMY_HASH;
    const isPasswordValid = await verifyPassword(password, hashToVerify);
    const isValid = !!admin && isPasswordValid;

    if (!isValid) {
      if (failedAttemptsMap.size >= MAX_MAP_ENTRIES) {
        const oldestKey = failedAttemptsMap.keys().next().value;
        if (oldestKey) failedAttemptsMap.delete(oldestKey);
      }
      const prev = failedAttemptsMap.get(ipHash) || { count: 0, lastAttempt: now };
      failedAttemptsMap.set(ipHash, { count: prev.count + 1, lastAttempt: now });
      return NextResponse.json({ error: 'Nieprawidłowy login lub hasło.' }, { status: 401 });
    }

    // Success -> clear rate limit
    failedAttemptsMap.delete(ipHash);

    await createAdminSession(admin.id);
    return NextResponse.json({ success: true, username: admin.username });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Wystąpił błąd serwera.' }, { status: 500 });
  }
}

export async function GET() {
  const isAuth = await verifyAdminSession();
  return NextResponse.json({ authenticated: isAuth });
}

export async function DELETE() {
  await destroyAdminSession();
  return NextResponse.json({ success: true });
}
