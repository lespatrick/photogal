import { NextRequest, NextResponse } from 'next/server';
import { ZipArchive } from 'archiver';
import path from 'path';
import fs from 'fs';
import { PassThrough } from 'stream';
import db from '@/lib/db';
import { verifyClientToken } from '@/lib/auth';
import { STORAGE_DIR } from '@/lib/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const token = req.headers.get('x-client-token') || req.nextUrl.searchParams.get('token');

  try {
    const gallery = db.prepare('SELECT id, title, allow_zip_download, status FROM galleries WHERE slug = ?').get(slug) as any;

    if (!gallery) {
      return new NextResponse('Galeria nie istnieje', { status: 404 });
    }

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

    const archive = new ZipArchive({ zlib: { level: 5 } });
    const passThrough = new PassThrough();

    archive.pipe(passThrough);

    for (const p of photos) {
      const fullPath = path.resolve(STORAGE_DIR, p.original_path);
      if (fs.existsSync(fullPath)) {
        archive.file(fullPath, { name: p.filename });
      }
    }

    archive.finalize().catch((err: any) => {
      console.error('Archive finalize error:', err);
    });

    const safeTitle = gallery.title.replace(/[^a-zA-Z0-9_-]/g, '_');
    const zipName = `Wybrane_${safeTitle}.zip`;

    const webStream = new ReadableStream({
      start(controller) {
        passThrough.on('data', (chunk) => controller.enqueue(chunk));
        passThrough.on('end', () => controller.close());
        passThrough.on('error', (err) => controller.error(err));
      },
      cancel() {
        passThrough.destroy();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
      },
    });
  } catch (error) {
    console.error('Client ZIP error:', error);
    return new NextResponse('Błąd generowania ZIP', { status: 500 });
  }
}
