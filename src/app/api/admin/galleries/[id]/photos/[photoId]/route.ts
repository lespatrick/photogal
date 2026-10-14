import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';
import { deletePhotoFiles } from '@/lib/storage';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id, photoId } = await params;

  try {
    const gallery = db.prepare('SELECT id FROM galleries WHERE id = ? OR slug = ?').get(id, id) as { id: string } | undefined;
    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }
    const actualId = gallery.id;

    const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND gallery_id = ?').get(photoId, actualId) as any;
    if (!photo) {
      return NextResponse.json({ error: 'Zdjęcie nie zostało znalezione' }, { status: 404 });
    }

    // Run database deletion first inside immediate transaction
    db.transaction(() => {
      db.prepare('DELETE FROM photos WHERE id = ?').run(photoId);
      db.prepare('UPDATE galleries SET cover_photo_id = NULL WHERE id = ? AND cover_photo_id = ?').run(actualId, photoId);
    }).immediate();

    // After database deletion succeeds, clean up physical files
    deletePhotoFiles(actualId, photo.original_path, photo.thumb_path, photo.preview_path);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete photo error:', error);
    return NextResponse.json({ error: 'Błąd usuwania zdjęcia' }, { status: 500 });
  }
}
