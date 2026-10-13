import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAdminSessionId } from '@/lib/auth';

export async function GET() {
  const adminId = await getAdminSessionId();
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const keys = db.prepare(`
    SELECT id, friendly_name, device_type, backed_up, created_at, last_used_at
    FROM authenticators
    WHERE admin_id = ?
    ORDER BY created_at DESC
  `).all(adminId);

  return NextResponse.json({ keys });
}

export async function DELETE(req: NextRequest) {
  const adminId = await getAdminSessionId();
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: 'Brak ID klucza' }, { status: 400 });
  }

  db.prepare('DELETE FROM authenticators WHERE id = ? AND admin_id = ?').run(id, adminId);
  return NextResponse.json({ success: true });
}
