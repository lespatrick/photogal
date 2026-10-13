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
    const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND gallery_id = ?').get(photoId, id) as any;
    if (!photo) {
      return NextResponse.json({ error: 'Zdjęcie nie zostało znalezione' }, { status: 404 });
    }

    // Delete files from storage
    deletePhotoFiles(id, photo.original_path, photo.thumb_path, photo.preview_path);

    // Delete record from DB
    db.prepare('DELETE FROM photos WHERE id = ?').run(photoId);

    // Reset cover if this photo was the cover
    db.prepare('UPDATE galleries SET cover_photo_id = NULL WHERE id = ? AND cover_photo_id = ?').run(id, photoId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete photo error:', error);
    return NextResponse.json({ error: 'Błąd usuwania zdjęcia' }, { status: 500 });
  }
}
