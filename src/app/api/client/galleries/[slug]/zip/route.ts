import { NextRequest, NextResponse } from 'next/server';
import { ZipArchive } from 'archiver';
import path from 'path';
import fs from 'fs';
import { PassThrough, Readable } from 'stream';
import db from '@/lib/db';
import { verifyClientToken, extractClientToken } from '@/lib/auth';
import { resolveSafeStoragePath } from '@/lib/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const gallery = db.prepare('SELECT id, title, allow_zip_download, status FROM galleries WHERE slug = ?').get(slug) as any;

    if (!gallery) {
      return new NextResponse('Galeria nie istnieje', { status: 404 });
    }

    const token = extractClientToken(req, gallery.id);
    if (!token || !verifyClientToken(token, gallery.id)) {
      return new NextResponse('Brak autoryzacji', { status: 401 });
    }

    if (!gallery.allow_zip_download || gallery.status !== 'submitted') {
      return new NextResponse('Pobieranie archiwum ZIP nie jest obecnie udostępnione dla tej galerii.', { status: 403 });
    }

    const photos = db.prepare(`
      SELECT p.filename, p.original_path
      FROM selections s
      JOIN photos p ON p.id = s.photo_id
      WHERE s.gallery_id = ?
      ORDER BY p.order_index ASC, p.created_at ASC
    `).all(gallery.id) as { filename: string; original_path: string }[];

    if (photos.length === 0) {
      return new NextResponse('Brak wybranych zdjęć do pobrania', { status: 400 });
    }

    // zlib level 0 (Store mode): Photos are already compressed WebP/JPEGs. Level 0 streams instantly without high CPU load.
    const archive = new ZipArchive({ zlib: { level: 0 } });
    const passThrough = new PassThrough();

    archive.pipe(passThrough);

    const nameTracker = new Map<string, number>();
    for (const p of photos) {
      const fullPath = resolveSafeStoragePath(p.original_path);
      if (fullPath && fs.existsSync(fullPath)) {
        let entryName = p.filename;
        const count = nameTracker.get(p.filename) || 0;
        if (count > 0) {
          const ext = path.extname(p.filename);
          const base = path.basename(p.filename, ext);
          entryName = `${base}_${count + 1}${ext}`;
        }
        nameTracker.set(p.filename, count + 1);
        archive.file(fullPath, { name: entryName });
      }
    }

    archive.finalize().catch((err: any) => {
      console.error('Archive finalize error:', err);
    });

    const asciiFallback = gallery.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'galeria';
    const encodedTitle = encodeURIComponent(`Wybrane_${gallery.title}.zip`);

    const webStream = Readable.toWeb(passThrough);

    return new NextResponse(webStream as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="Wybrane_${asciiFallback}.zip"; filename*=UTF-8''${encodedTitle}`,
      },
    });
  } catch (error) {
    console.error('Client ZIP error:', error);
    return new NextResponse('Błąd generowania ZIP', { status: 500 });
  }
}
