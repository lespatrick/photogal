import { NextRequest, NextResponse } from 'next/server';
import { ZipArchive } from 'archiver';
import path from 'path';
import fs from 'fs';
import { PassThrough, Readable } from 'stream';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';
import { resolveSafeStoragePath } from '@/lib/storage';

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

    // Level 0 Store mode for instant streaming
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

    const mode = onlySelected ? 'wybrane' : 'wszystkie';
    const asciiFallback = gallery.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'galeria';
    const encodedTitle = encodeURIComponent(`${gallery.title}_${mode}.zip`);

    const webStream = Readable.toWeb(passThrough);

    return new NextResponse(webStream as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${asciiFallback}_${mode}.zip"; filename*=UTF-8''${encodedTitle}`,
      },
    });
  } catch (error) {
    console.error('ZIP generation error:', error);
    return NextResponse.json({ error: 'Błąd generowania archiwum ZIP' }, { status: 500 });
  }
}
