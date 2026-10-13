import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';

function slugify(text: string): string {
  const polishChars: Record<string, string> = {
    ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
    Ą: 'a', Ć: 'c', Ę: 'e', Ł: 'l', Ń: 'n', Ó: 'o', Ś: 's', Ź: 'z', Ż: 'z',
  };
  const normalized = text.split('').map(c => polishChars[c] || c).join('');
  return normalized
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'galeria-' + Math.random().toString(36).substring(2, 6);
}

export async function GET() {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  try {
    const galleries = db.prepare(`
      SELECT 
        g.*,
        (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id) AS total_photos,
        (SELECT COUNT(*) FROM selections s WHERE s.gallery_id = g.id) AS selected_photos,
        (SELECT thumb_path FROM photos p WHERE p.id = g.cover_photo_id) AS cover_thumb,
        (SELECT thumb_path FROM photos p WHERE p.gallery_id = g.id ORDER BY p.order_index ASC, p.created_at ASC LIMIT 1) AS fallback_thumb
      FROM galleries g
      ORDER BY g.created_at DESC
    `).all();

    return NextResponse.json({ galleries });
  } catch (error) {
    console.error('Error fetching galleries:', error);
    return NextResponse.json({ error: 'Błąd pobierania galerii' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, shoot_date, welcome_text, pin_code, max_selections, allow_zip_download } = body;

    if (!title || !shoot_date) {
      return NextResponse.json({ error: 'Tytuł i data sesji są wymagane' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    let baseSlug = slugify(title);
    let finalSlug = baseSlug;
    let counter = 1;

    // Ensure slug uniqueness
    while (db.prepare('SELECT id FROM galleries WHERE slug = ?').get(finalSlug)) {
      finalSlug = `${baseSlug}-${counter++}`;
    }

    // Default PIN: 4 random digits if not provided
    const finalPin = pin_code?.trim() || Math.floor(1000 + Math.random() * 9000).toString();

    db.prepare(`
      INSERT INTO galleries (id, slug, title, shoot_date, welcome_text, pin_code, max_selections, allow_zip_download, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      id,
      finalSlug,
      title.trim(),
      shoot_date,
      welcome_text?.trim() || '',
      finalPin,
      Number(max_selections) || 0,
      allow_zip_download ? 1 : 0
    );

    const created = db.prepare('SELECT * FROM galleries WHERE id = ?').get(id);
    return NextResponse.json({ gallery: created }, { status: 201 });
  } catch (error) {
    console.error('Error creating gallery:', error);
    return NextResponse.json({ error: 'Błąd podczas tworzenia galerii' }, { status: 500 });
  }
}
