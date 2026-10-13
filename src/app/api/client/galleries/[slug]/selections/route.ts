import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { verifyClientToken } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const token = req.headers.get('x-client-token');

  try {
    const gallery = db.prepare('SELECT id, status, max_selections FROM galleries WHERE slug = ?').get(slug) as {
      id: string;
      status: string;
      max_selections: number;
    } | undefined;

    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    if (!token || !verifyClientToken(token, gallery.id)) {
      return NextResponse.json({ error: 'Brak autoryzacji (wymagany PIN)' }, { status: 401 });
    }

    if (gallery.status === 'submitted') {
      return NextResponse.json({
        error: 'Selekcja została już sfinalizowana i wysłana do fotografa. Edycja jest zablokowana.',
        locked: true,
      }, { status: 403 });
    }

    const { photoId, action } = await req.json();
    if (!photoId) {
      return NextResponse.json({ error: 'Brak photoId' }, { status: 400 });
    }

    const photo = db.prepare('SELECT id FROM photos WHERE id = ? AND gallery_id = ?').get(photoId, gallery.id);
    if (!photo) {
      return NextResponse.json({ error: 'Zdjęcie nie należy do tej galerii' }, { status: 404 });
    }

    const existingSelection = db.prepare('SELECT id FROM selections WHERE gallery_id = ? AND photo_id = ?').get(gallery.id, photoId);

    let isSelected = false;

    if (action === 'like' || (!action && !existingSelection)) {
      if (!existingSelection) {
        const currentCount = (db.prepare('SELECT COUNT(*) as count FROM selections WHERE gallery_id = ?').get(gallery.id) as any)?.count || 0;
        if (gallery.max_selections > 0 && currentCount >= gallery.max_selections) {
          return NextResponse.json({
            error: `Osiągnięto maksymalną liczbę wybranych zdjęć w pakiecie (${gallery.max_selections}). Odznacz inne zdjęcie, aby dodać nowe.`,
            limitReached: true,
            maxSelections: gallery.max_selections,
          }, { status: 400 });
        }

        db.prepare('INSERT INTO selections (id, gallery_id, photo_id) VALUES (?, ?, ?)').run(
          crypto.randomUUID(),
          gallery.id,
          photoId
        );
      }
      isSelected = true;
    } else {
      if (existingSelection) {
        db.prepare('DELETE FROM selections WHERE gallery_id = ? AND photo_id = ?').run(gallery.id, photoId);
      }
      isSelected = false;
    }

    const allSelections = db.prepare('SELECT photo_id FROM selections WHERE gallery_id = ?').all(gallery.id) as { photo_id: string }[];
    const selectedIds = allSelections.map(s => s.photo_id);

    return NextResponse.json({
      success: true,
      photoId,
      isSelected,
      selectedIds,
      selectedCount: selectedIds.length,
    });
  } catch (error) {
    console.error('Selection error:', error);
    return NextResponse.json({ error: 'Błąd zapisu wyboru' }, { status: 500 });
  }
}
