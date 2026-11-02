import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';
import { clearGalleryStorage } from '@/lib/storage';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession(req))) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const gallery = db.prepare('SELECT id FROM galleries WHERE id = ? OR slug = ?').get(id, id) as { id: string } | undefined;
    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }
    const actualId = gallery.id;

    // Remove selections and photos inside transaction, reset cover
    db.transaction(() => {
      db.prepare('DELETE FROM selections WHERE gallery_id = ?').run(actualId);
      db.prepare('DELETE FROM photos WHERE gallery_id = ?').run(actualId);
      db.prepare('UPDATE galleries SET cover_photo_id = NULL WHERE id = ?').run(actualId);
    }).immediate();

    // Clean up physical storage on disk
    clearGalleryStorage(actualId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete all photos error:', error);
    return NextResponse.json({ error: 'Błąd usuwania wszystkich zdjęć' }, { status: 500 });
  }
}
