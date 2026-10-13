import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { getAdminSessionId, verifyPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const adminId = await getAdminSessionId();
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { currentPassword, newPassword, confirmPassword } = body;

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

    if (!admin || !verifyPassword(currentPassword, admin.password_hash)) {
      return NextResponse.json({ error: 'Aktualne hasło jest nieprawidłowe' }, { status: 400 });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(newPassword, salt, 64).toString('hex');
    const passwordHash = `${salt}:${hash}`;

    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, adminId);

    return NextResponse.json({ success: true, message: 'Hasło zostało pomyślnie zmienione' });
  } catch (error) {
    console.error('Error changing admin password:', error);
    return NextResponse.json({ error: 'Błąd podczas zmiany hasła' }, { status: 500 });
  }
}
