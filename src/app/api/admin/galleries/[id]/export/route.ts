import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const separator = searchParams.get('separator') || ', '; // ', ', ' ', or '\n'
  const download = searchParams.get('download') === 'true';

  try {
    const gallery = db.prepare('SELECT id, title FROM galleries WHERE id = ? OR slug = ?').get(id, id) as { id: string; title: string } | undefined;
    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    const selections = db.prepare(`
      SELECT p.filename
      FROM selections s
      JOIN photos p ON p.id = s.photo_id
      WHERE s.gallery_id = ?
      ORDER BY p.order_index ASC, p.created_at ASC
    `).all(gallery.id) as { filename: string }[];

    const filenames = selections.map(s => s.filename);
    const content = filenames.join(separator === 'newline' ? '\n' : separator === 'space' ? ' ' : ', ');

    if (download) {
      const safeTitle = gallery.title.replace(/[^a-zA-Z0-9_-]/g, '_');
      return new NextResponse(content, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="selekcja_${safeTitle}.txt"`,
        },
      });
    }

    return NextResponse.json({
      count: filenames.length,
      filenames,
      formattedText: content,
      // Useful variations for different software
      commaSeparated: filenames.join(', '),
      spaceSeparated: filenames.join(' '),
      lineSeparated: filenames.join('\n'),
      // Without extension for Lightroom search if needed
      withoutExtension: filenames.map(f => f.replace(/\.[^/.]+$/, '')).join(', '),
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Błąd generowania eksportu' }, { status: 500 });
  }
}
