import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyPassword, createAdminSession, destroyAdminSession, verifyAdminSession, getAuthSecret, extractClientIp } from '@/lib/auth';

import crypto from 'crypto';

// Dummy hash for constant-time comparison against nonexistent users
const DUMMY_HASH = '0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function getAdminIpHash(req: NextRequest): string {
  const ip = extractClientIp(req);
  return crypto.createHash('sha256').update(ip + getAuthSecret()).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const ipHash = getAdminIpHash(req);

    // Prune stale attempts (10% sample rate)
    if (Math.random() < 0.1) {
      try {
        db.prepare("DELETE FROM admin_login_attempts WHERE attempted_at < datetime('now', '-24 hours')").run();
      } catch {}
    }

    // Query failed attempts in the last 15 minutes from persistent SQLite
    const recentFails = (db.prepare(`
      SELECT COUNT(*) as count FROM admin_login_attempts 
      WHERE ip_hash = ? AND attempted_at > datetime('now', '-15 minutes')
    `).get(ipHash) as any)?.count || 0;

    if (recentFails >= 5) {
      return NextResponse.json({
        error: 'Zbyt wiele nieudanych prób logowania. Odczekaj 15 minut przed kolejną próbą.',
      }, { status: 429 });
    }

    if (recentFails >= 3) {
      // Tarpit delay
      await new Promise((r) => setTimeout(r, 2000));
    }

    let username: unknown;
    let password: unknown;
    try {
      const body = await req.json();
      username = body?.username;
      password = body?.password;
    } catch {
      return NextResponse.json({ error: 'Nieprawidłowe dane żądania' }, { status: 400 });
    }

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return NextResponse.json({ error: 'Nazwa użytkownika i hasło są wymagane.' }, { status: 400 });
    }

    if (username.length > 64 || password.length > 128) {
      return NextResponse.json({ error: 'Nieprawidłowa długość danych logowania.' }, { status: 400 });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username.trim()) as {
      id: string;
      username: string;
      password_hash: string;
    } | undefined;

    // Defeat username enumeration: run scrypt verification regardless of whether the user exists
    const hashToVerify = admin ? admin.password_hash : DUMMY_HASH;
    const isPasswordValid = await verifyPassword(password, hashToVerify);
    const isValid = !!admin && isPasswordValid;

    if (!isValid) {
      db.prepare('INSERT INTO admin_login_attempts (id, ip_hash) VALUES (?, ?)').run(
        crypto.randomUUID(),
        ipHash
      );
      return NextResponse.json({ error: 'Nieprawidłowy login lub hasło.' }, { status: 401 });
    }

    // Success -> clear rate limit
    db.prepare('DELETE FROM admin_login_attempts WHERE ip_hash = ?').run(ipHash);

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
