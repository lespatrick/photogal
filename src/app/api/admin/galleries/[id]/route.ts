import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';
import { deleteGalleryStorage } from '@/lib/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const gallery = db.prepare('SELECT * FROM galleries WHERE id = ? OR slug = ?').get(id, id) as Record<string, any> | undefined;
    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }
    const actualId = gallery.id;

    const photos = db.prepare(`
      SELECT 
        p.*,
        CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS is_selected,
        s.created_at AS selected_at
      FROM photos p
      LEFT JOIN selections s ON s.photo_id = p.id AND s.gallery_id = p.gallery_id
      WHERE p.gallery_id = ?
      ORDER BY p.order_index ASC, p.created_at ASC
    `).all(actualId);

    const selections = db.prepare(`
      SELECT s.photo_id, s.created_at, p.filename, p.thumb_path, p.preview_path
      FROM selections s
      JOIN photos p ON p.id = s.photo_id
      WHERE s.gallery_id = ?
      ORDER BY s.created_at ASC
    `).all(actualId);

    return NextResponse.json({ gallery, photos, selections });
  } catch (error) {
    console.error('Error fetching gallery details:', error);
    return NextResponse.json({ error: 'Błąd pobierania danych galerii' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const existing = db.prepare('SELECT * FROM galleries WHERE id = ? OR slug = ?').get(id, id) as Record<string, any> | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    const newTitle = body.title !== undefined && body.title.trim() ? body.title.trim() : existing.title;
    const newShootDate = body.shoot_date !== undefined ? body.shoot_date : existing.shoot_date;
    const newWelcomeText = 'welcome_text' in body ? body.welcome_text : existing.welcome_text;
    const newPin = body.pin_code !== undefined ? body.pin_code : existing.pin_code;
    const newMaxSelections = 'max_selections' in body ? (Number(body.max_selections) || 0) : existing.max_selections;
    const newAllowZip = 'allow_zip_download' in body ? (body.allow_zip_download ? 1 : 0) : existing.allow_zip_download;
    const newStatus = body.status !== undefined ? body.status : existing.status;
    
    let newCoverPhotoId = existing.cover_photo_id;
    if ('cover_photo_id' in body) {
      if (body.cover_photo_id === null || body.cover_photo_id === '') {
        newCoverPhotoId = null;
      } else {
        const validPhoto = db.prepare('SELECT id FROM photos WHERE id = ? AND gallery_id = ?').get(body.cover_photo_id, existing.id);
        if (validPhoto) {
          newCoverPhotoId = body.cover_photo_id;
        }
      }
    }

    db.prepare(`
      UPDATE galleries 
      SET 
        title = ?,
        shoot_date = ?,
        welcome_text = ?,
        pin_code = ?,
        max_selections = ?,
        allow_zip_download = ?,
        status = ?,
        cover_photo_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      newTitle,
      newShootDate,
      newWelcomeText,
      newPin,
      newMaxSelections,
      newAllowZip,
      newStatus,
      newCoverPhotoId,
      existing.id
    );

    const updated = db.prepare('SELECT * FROM galleries WHERE id = ?').get(existing.id);
    return NextResponse.json({ gallery: updated });
  } catch (error) {
    console.error('Error updating gallery:', error);
    return NextResponse.json({ error: 'Błąd aktualizacji galerii' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const existing = db.prepare('SELECT id FROM galleries WHERE id = ? OR slug = ?').get(id, id) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    deleteGalleryStorage(existing.id);
    db.prepare('DELETE FROM galleries WHERE id = ?').run(existing.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting gallery:', error);
    return NextResponse.json({ error: 'Błąd usuwania galerii' }, { status: 500 });
  }
}
