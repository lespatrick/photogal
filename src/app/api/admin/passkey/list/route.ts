import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAdminSessionId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const adminId = await getAdminSessionId(req);
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const keys = db.prepare(`
    SELECT id, friendly_name, device_type, backed_up, created_at, last_used_at
    FROM authenticators
    WHERE admin_id = ? OR admin_id = (SELECT id FROM admins LIMIT 1)
    ORDER BY created_at DESC
  `).all(adminId);

  return NextResponse.json(
    { keys },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}

export async function DELETE(req: NextRequest) {
  const adminId = await getAdminSessionId(req);
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  let id: string | undefined;
  try {
    const body = await req.json();
    id = body?.id;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania' }, { status: 400 });
  }

  if (!id || typeof id !== 'string' || !id.trim()) {
    return NextResponse.json({ error: 'Brak lub nieprawidłowe ID klucza' }, { status: 400 });
  }

  db.prepare(`
    DELETE FROM authenticators 
    WHERE id = ? AND (admin_id = ? OR admin_id = (SELECT id FROM admins LIMIT 1))
  `).run(id.trim(), adminId);

  return NextResponse.json({ success: true });
}
