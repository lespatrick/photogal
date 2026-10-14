import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyClientToken, extractClientToken } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const gallery = db.prepare(`
      SELECT 
        g.id, g.slug, g.title, g.shoot_date, g.welcome_text,
        g.max_selections, g.allow_zip_download, g.status,
        g.submitted_at, g.client_notes,
        (SELECT thumb_path FROM photos p WHERE p.id = g.cover_photo_id) AS cover_thumb,
        (SELECT thumb_path FROM photos p WHERE p.gallery_id = g.id ORDER BY p.order_index ASC, p.created_at ASC LIMIT 1) AS fallback_thumb
      FROM galleries g
      WHERE g.slug = ?
    `).get(slug) as any;

    if (!gallery || gallery.status === 'draft') {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    const token = extractClientToken(req, gallery.id);
    const isAuthorized = token ? verifyClientToken(token, gallery.id) : false;

    if (!isAuthorized) {
      return NextResponse.json({
        unlocked: false,
        gallery: {
          id: gallery.id,
          slug: gallery.slug,
          title: gallery.title,
          shoot_date: gallery.shoot_date,
          cover_thumb: gallery.cover_thumb || gallery.fallback_thumb,
        },
      });
    }

    // Client is authorized -> return full gallery with photos & selections
    const photos = db.prepare(`
      SELECT 
        p.id, p.filename, p.thumb_path, p.preview_path,
        p.width, p.height, p.aspect_ratio, p.order_index,
        CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS is_selected
      FROM photos p
      LEFT JOIN selections s ON s.photo_id = p.id AND s.gallery_id = p.gallery_id
      WHERE p.gallery_id = ?
      ORDER BY p.order_index ASC, p.created_at ASC
    `).all(gallery.id);

    const selections = db.prepare('SELECT photo_id FROM selections WHERE gallery_id = ?').all(gallery.id) as { photo_id: string }[];
    const selectedIds = selections.map(s => s.photo_id);

    const res = NextResponse.json({
      unlocked: true,
      gallery,
      photos,
      selectedIds,
      totalPhotos: photos.length,
      selectedCount: selectedIds.length,
    });

    if (token) {
      res.cookies.set(`photogal_client_${gallery.id}`, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }

    return res;
  } catch (error) {
    console.error('Client gallery error:', error);
    return NextResponse.json({ error: 'Błąd serwera' }, { status: 500 });
  }
}
