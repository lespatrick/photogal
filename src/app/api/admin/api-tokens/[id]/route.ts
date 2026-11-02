import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAdminSessionId } from '@/lib/auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminSessionId(req);
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = db.prepare('DELETE FROM api_tokens WHERE id = ? AND admin_id = ?').run(id, adminId);
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Token nie istnieje lub brak uprawnień' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error revoking API token:', error);
    return NextResponse.json({ error: 'Błąd unieważniania tokenu API' }, { status: 500 });
  }
}

