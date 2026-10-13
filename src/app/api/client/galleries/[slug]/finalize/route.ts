import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyClientToken } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const token = req.headers.get('x-client-token');

  try {
    const gallery = db.prepare('SELECT id, status, max_selections FROM galleries WHERE slug = ?').get(slug) as any;

    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    if (!token || !verifyClientToken(token, gallery.id)) {
      return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
    }

    if (gallery.status === 'submitted') {
      return NextResponse.json({ message: 'Selekcja została już wcześniej sfinalizowana.' });
    }

    const { notes } = await req.json().catch(() => ({ notes: '' }));

    const selectedCount = (db.prepare('SELECT COUNT(*) as count FROM selections WHERE gallery_id = ?').get(gallery.id) as any)?.count || 0;

    if (selectedCount === 0) {
      return NextResponse.json({ error: 'Wybierz co najmniej jedno zdjęcie przed wysłaniem.' }, { status: 400 });
    }

    if (gallery.max_selections > 0 && selectedCount > gallery.max_selections) {
      return NextResponse.json({
        error: `Liczba wybranych zdjęć (${selectedCount}) przekracza maksymalny limit pakietu (${gallery.max_selections}).`,
      }, { status: 400 });
    }

    db.prepare(`
      UPDATE galleries 
      SET 
        status = 'submitted',
        client_notes = ?,
        submitted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(notes?.trim() || null, gallery.id);

    return NextResponse.json({
      success: true,
      message: 'Selekcja została pomyślnie wysłana do fotografa!',
      selectedCount,
    });
  } catch (error) {
    console.error('Finalize error:', error);
    return NextResponse.json({ error: 'Błąd podczas finalizowania selekcji' }, { status: 500 });
  }
}
