import { NextRequest, NextResponse } from 'next/server';
import { ZipArchive } from 'archiver';
import path from 'path';
import fs from 'fs';
import { PassThrough } from 'stream';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';
import { STORAGE_DIR } from '@/lib/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const onlySelected = searchParams.get('selected') === 'true';

  try {
    const gallery = db.prepare('SELECT id, title FROM galleries WHERE id = ? OR slug = ?').get(id, id) as { id: string; title: string } | undefined;
    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    let photos: { filename: string; original_path: string }[] = [];
    if (onlySelected) {
      photos = db.prepare(`
        SELECT p.filename, p.original_path
        FROM selections s
        JOIN photos p ON p.id = s.photo_id
        WHERE s.gallery_id = ?
        ORDER BY p.order_index ASC, p.created_at ASC
      `).all(gallery.id) as { filename: string; original_path: string }[];
    } else {
      photos = db.prepare(`
        SELECT filename, original_path
        FROM photos
        WHERE gallery_id = ?
        ORDER BY order_index ASC, created_at ASC
      `).all(gallery.id) as { filename: string; original_path: string }[];
    }

    if (photos.length === 0) {
      return NextResponse.json({ error: 'Brak zdjęć do spakowania' }, { status: 400 });
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
    const zipName = `${safeTitle}_${onlySelected ? 'wybrane' : 'wszystkie'}.zip`;

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
    console.error('ZIP generation error:', error);
    return NextResponse.json({ error: 'Błąd generowania archiwum ZIP' }, { status: 500 });
  }
}
