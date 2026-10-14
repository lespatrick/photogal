import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { getAdminSessionId, verifyPassword, hashPassword, createAdminSession, getAuthSecret, extractClientIp } from '@/lib/auth';

function getAdminIpHash(req: NextRequest): string {
  const ip = extractClientIp(req);
  return crypto.createHash('sha256').update(ip + getAuthSecret()).digest('hex');
}

export async function POST(req: NextRequest) {
  const adminId = await getAdminSessionId();
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const ipHash = getAdminIpHash(req);

  // Check persistent admin lockouts (15 minutes lockout after 5 fails, tarpit after 3)
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
    await new Promise((r) => setTimeout(r, 2000));
  }

  let currentPassword: string | undefined;
  let newPassword: string | undefined;
  let confirmPassword: string | undefined;
  try {
    const body = await req.json();
    currentPassword = body?.currentPassword;
    newPassword = body?.newPassword;
    confirmPassword = body?.confirmPassword;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania' }, { status: 400 });
  }

  try {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword.trim() || !newPassword) {
      return NextResponse.json({ error: 'Wypełnij wszystkie wymagane pola' }, { status: 400 });
    }

    if (currentPassword.length > 128 || newPassword.length > 128) {
      return NextResponse.json({ error: 'Hasło przekracza maksymalną dozwoloną długość (128 znaków)' }, { status: 400 });
    }

    if (newPassword.length < 10) {
      return NextResponse.json({ error: 'Nowe hasło musi mieć co najmniej 10 znaków' }, { status: 400 });
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'Nowe hasła nie są identyczne' }, { status: 400 });
    }

    const admin = db.prepare('SELECT id, password_hash FROM admins WHERE id = ?').get(adminId) as {
      id: string;
      password_hash: string;
    } | undefined;

    const isCurrentValid = admin ? await verifyPassword(currentPassword, admin.password_hash) : false;
    if (!admin || !isCurrentValid) {
      db.prepare('INSERT INTO admin_login_attempts (id, ip_hash) VALUES (?, ?)').run(
        crypto.randomUUID(),
        ipHash
      );
      return NextResponse.json({ error: 'Aktualne hasło jest nieprawidłowe' }, { status: 400 });
    }

    // Success -> clear failed attempts
    db.prepare('DELETE FROM admin_login_attempts WHERE ip_hash = ?').run(ipHash);

    const passwordHash = await hashPassword(newPassword);

    db.prepare('UPDATE admins SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(passwordHash, adminId);

    // Re-issue a fresh session cookie with the new token version
    await createAdminSession(adminId);

    return NextResponse.json({ success: true, message: 'Hasło zostało pomyślnie zmienione' });
  } catch (error) {
    console.error('Error changing admin password:', error);
    return NextResponse.json({ error: 'Błąd podczas zmiany hasła' }, { status: 500 });
  }
}
