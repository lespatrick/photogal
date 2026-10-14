import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { verifyClientToken, extractClientToken } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const gallery = db.prepare('SELECT id, status, max_selections FROM galleries WHERE slug = ?').get(slug) as {
      id: string;
      status: string;
      max_selections: number;
    } | undefined;

    if (!gallery || gallery.status === 'draft') {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    const token = extractClientToken(req, gallery.id);
    if (!token || !verifyClientToken(token, gallery.id)) {
      return NextResponse.json({ error: 'Brak autoryzacji (wymagany PIN)' }, { status: 401 });
    }

    if (gallery.status === 'submitted') {
      return NextResponse.json({
        error: 'Selekcja została już sfinalizowana i wysłana do fotografa. Edycja jest zablokowana.',
        locked: true,
      }, { status: 403 });
    }

    if (gallery.status !== 'active') {
      return NextResponse.json({
        error: 'Galeria nie jest aktywna. Edycja selekcji jest zablokowana.',
        locked: true,
      }, { status: 403 });
    }

    let photoId: string | undefined;
    let action: string | undefined;
    try {
      const body = await req.json();
      photoId = body?.photoId;
      action = body?.action;
    } catch {
      return NextResponse.json({ error: 'Nieprawidłowe dane żądania' }, { status: 400 });
    }

    if (!photoId) {
      return NextResponse.json({ error: 'Brak photoId' }, { status: 400 });
    }

    const photo = db.prepare('SELECT id FROM photos WHERE id = ? AND gallery_id = ?').get(photoId, gallery.id);
    if (!photo) {
      return NextResponse.json({ error: 'Zdjęcie nie należy do tej galerii' }, { status: 404 });
    }

    const txResult = db.transaction(() => {
      // Re-fetch current status & limits inside immediate transaction
      const current = db.prepare('SELECT status, max_selections FROM galleries WHERE id = ?').get(gallery.id) as {
        status: string;
        max_selections: number;
      } | undefined;

      if (!current || current.status !== 'active') {
        return {
          locked: true,
          error: current?.status === 'submitted'
            ? 'Selekcja została już sfinalizowana i wysłana do fotografa. Edycja jest zablokowana.'
            : 'Galeria nie jest aktywna. Edycja selekcji jest zablokowana.',
        };
      }

      const existingSelection = db.prepare('SELECT id FROM selections WHERE gallery_id = ? AND photo_id = ?').get(gallery.id, photoId);
      let isSelected = false;

      if (action === 'like' || (!action && !existingSelection)) {
        if (!existingSelection) {
          const currentCount = (db.prepare('SELECT COUNT(*) as count FROM selections WHERE gallery_id = ?').get(gallery.id) as any)?.count || 0;
          if (current.max_selections > 0 && currentCount >= current.max_selections) {
            return {
              limitReached: true,
              error: `Osiągnięto maksymalną liczbę wybranych zdjęć w pakiecie (${current.max_selections}). Odznacz inne zdjęcie, aby dodać nowe.`,
            };
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

      return {
        limitReached: false,
        isSelected,
        selectedIds,
      };
    }).immediate();

    if (txResult.locked) {
      return NextResponse.json({
        error: txResult.error,
        locked: true,
      }, { status: 403 });
    }

    if (txResult.limitReached) {
      return NextResponse.json({
        error: txResult.error,
        limitReached: true,
        maxSelections: gallery.max_selections,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      photoId,
      isSelected: txResult.isSelected,
      selectedIds: txResult.selectedIds,
      selectedCount: txResult.selectedIds?.length || 0,
    });
  } catch (error) {
    console.error('Selection error:', error);
    return NextResponse.json({ error: 'Błąd zapisu wyboru' }, { status: 500 });
  }
}
