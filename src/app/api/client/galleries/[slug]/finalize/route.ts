import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyClientToken, extractClientToken } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const gallery = db.prepare('SELECT id, status, max_selections FROM galleries WHERE slug = ?').get(slug) as any;

    if (!gallery || gallery.status === 'draft') {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    const token = extractClientToken(req, gallery.id);
    if (!token || !verifyClientToken(token, gallery.id)) {
      return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
    }

    if (gallery.status === 'submitted') {
      return NextResponse.json({ message: 'Selekcja została już wcześniej sfinalizowana.' });
    }

    if (gallery.status !== 'active') {
      return NextResponse.json({ error: 'Galeria nie jest aktywna. Finalizacja jest zablokowana.' }, { status: 403 });
    }

    const { notes } = await req.json().catch(() => ({ notes: '' }));

    const finalizeTx = db.transaction(() => {
      const current = db.prepare('SELECT status, max_selections FROM galleries WHERE id = ?').get(gallery.id) as { status: string; max_selections: number } | undefined;
      if (!current || current.status !== 'active') {
        if (current?.status === 'submitted') {
          return { alreadySubmitted: true };
        }
        return { error: 'Galeria nie jest obecnie aktywna.' };
      }

      const selectedCount = (db.prepare('SELECT COUNT(*) as count FROM selections WHERE gallery_id = ?').get(gallery.id) as any)?.count || 0;

      if (selectedCount === 0) {
        return { error: 'Wybierz co najmniej jedno zdjęcie przed wysłaniem.' };
      }

      if (current.max_selections > 0 && selectedCount > current.max_selections) {
        return {
          error: `Liczba wybranych zdjęć (${selectedCount}) przekracza maksymalny limit pakietu (${current.max_selections}).`,
        };
      }

      const safeNotes = typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 3000) : null;

      const updateResult = db.prepare(`
        UPDATE galleries 
        SET 
          status = 'submitted',
          client_notes = ?,
          submitted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status != 'submitted'
      `).run(safeNotes, gallery.id);

      if (updateResult.changes === 0) {
        return { alreadySubmitted: true };
      }

      return { success: true, selectedCount };
    }).immediate();

    if (finalizeTx.alreadySubmitted) {
      return NextResponse.json({ message: 'Selekcja została już wcześniej sfinalizowana.' });
    }

    if (finalizeTx.error) {
      return NextResponse.json({ error: finalizeTx.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'Selekcja została pomyślnie wysłana do fotografa!',
      selectedCount: finalizeTx.selectedCount,
    });
  } catch (error) {
    console.error('Finalize error:', error);
    return NextResponse.json({ error: 'Błąd podczas finalizowania selekcji' }, { status: 500 });
  }
}
