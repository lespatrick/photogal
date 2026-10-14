import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { getAdminSessionId, verifyPassword, hashPassword, createAdminSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const adminId = await getAdminSessionId();
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
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
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Wypełnij wszystkie wymagane pola' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Nowe hasło musi mieć co najmniej 6 znaków' }, { status: 400 });
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
      return NextResponse.json({ error: 'Aktualne hasło jest nieprawidłowe' }, { status: 400 });
    }

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
