import { NextRequest, NextResponse } from 'next/server';
import { ZipArchive } from 'archiver';
import path from 'path';
import fs from 'fs';
import { PassThrough, Readable } from 'stream';
import db, { parseSqliteDate } from '@/lib/db';
import { verifyClientToken, extractClientToken } from '@/lib/auth';
import { resolveSafeStoragePath } from '@/lib/storage';

const zipRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_ZIP_RATE_LIMIT_ENTRIES = 2000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const gallery = db.prepare('SELECT id, title, allow_zip_download, status, pin_version, pin_locked_until FROM galleries WHERE slug = ?').get(slug) as any;

    if (!gallery || gallery.status === 'draft') {
      return new NextResponse('Galeria nie istnieje', { status: 404 });
    }

    if (gallery.status === 'archived') {
      return new NextResponse('Galeria została zarchiwizowana', { status: 403 });
    }

    if (gallery.pin_locked_until) {
      const lockExpiry = parseSqliteDate(gallery.pin_locked_until).getTime();
      if (lockExpiry > Date.now()) {
        return new NextResponse('Galeria zablokowana ze względów bezpieczeństwa', { status: 423 });
      }
    }

    const token = extractClientToken(req, gallery.id);
    if (!token || !verifyClientToken(token, gallery.id, gallery.pin_version)) {
      return new NextResponse('Brak autoryzacji', { status: 401 });
    }

    // Rate limit: max 5 zip generations per 5 minutes per gallery session
    const rlKey = `${gallery.id}:${token.slice(-16)}`;
    const now = Date.now();
    const rl = zipRateLimitMap.get(rlKey);
    if (rl && rl.resetAt > now) {
      if (rl.count >= 5) {
        return new NextResponse('Zbyt wiele zapytań o archiwum ZIP. Spróbuj ponownie za 5 minut.', { status: 429 });
      }
      rl.count++;
    } else {
      if (zipRateLimitMap.size > 200) {
        for (const [k, v] of zipRateLimitMap.entries()) {
          if (v.resetAt <= now) zipRateLimitMap.delete(k);
        }
      }
      if (zipRateLimitMap.size >= MAX_ZIP_RATE_LIMIT_ENTRIES) {
        const oldestKey = zipRateLimitMap.keys().next().value;
        if (oldestKey) zipRateLimitMap.delete(oldestKey);
      }
      zipRateLimitMap.set(rlKey, { count: 1, resetAt: now + 5 * 60 * 1000 });
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

    archive.on('error', (err: any) => {
      console.error('Client ZIP stream error:', err);
      passThrough.destroy(err);
    });

    passThrough.on('close', () => {
      if (!archive.destroyed) {
        archive.destroy();
      }
    });

    req.signal?.addEventListener('abort', () => {
      if (!archive.destroyed) archive.destroy();
      if (!passThrough.destroyed) passThrough.destroy();
    });

    archive.pipe(passThrough);

    const usedNames = new Set<string>();
    for (const p of photos) {
      const fullPath = resolveSafeStoragePath(p.original_path);
      if (fullPath && fs.existsSync(fullPath)) {
        const normalized = p.filename.trim().replace(/\\/g, '/');
        const safeBaseName = path.basename(normalized).replace(/[/\\?%*:|"<>]/g, '_').replace(/^\.+/, '') || 'photo.jpg';
        let entryName = safeBaseName;
        let counter = 2;
        const ext = path.extname(safeBaseName);
        const base = path.basename(safeBaseName, ext);
        while (usedNames.has(entryName)) {
          entryName = `${base}_${counter++}${ext}`;
        }
        usedNames.add(entryName);
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
