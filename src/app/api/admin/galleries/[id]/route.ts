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
    const existing = db.prepare('SELECT * FROM galleries WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    const {
      title,
      shoot_date,
      welcome_text,
      pin_code,
      max_selections,
      allow_zip_download,
      status,
      cover_photo_id,
    } = body;

    db.prepare(`
      UPDATE galleries 
      SET 
        title = COALESCE(?, title),
        shoot_date = COALESCE(?, shoot_date),
        welcome_text = COALESCE(?, welcome_text),
        pin_code = COALESCE(?, pin_code),
        max_selections = COALESCE(?, max_selections),
        allow_zip_download = COALESCE(?, allow_zip_download),
        status = COALESCE(?, status),
        cover_photo_id = COALESCE(?, cover_photo_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title !== undefined ? title : null,
      shoot_date !== undefined ? shoot_date : null,
      welcome_text !== undefined ? welcome_text : null,
      pin_code !== undefined ? pin_code : null,
      max_selections !== undefined ? Number(max_selections) : null,
      allow_zip_download !== undefined ? (allow_zip_download ? 1 : 0) : null,
      status !== undefined ? status : null,
      cover_photo_id !== undefined ? cover_photo_id : null,
      id
    );

    const updated = db.prepare('SELECT * FROM galleries WHERE id = ?').get(id);
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
    deleteGalleryStorage(id);
    db.prepare('DELETE FROM galleries WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting gallery:', error);
    return NextResponse.json({ error: 'Błąd usuwania galerii' }, { status: 500 });
  }
}
