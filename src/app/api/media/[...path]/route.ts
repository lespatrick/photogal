import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import db from '@/lib/db';
import { verifyAdminSession, verifyClientToken } from '@/lib/auth';
import { resolveSafeStoragePath } from '@/lib/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const filePathArray = resolvedParams.path;
    if (!filePathArray || filePathArray.length !== 4 || filePathArray[0] !== 'galleries') {
      return new NextResponse('File not found', { status: 404 });
    }

    const galleryId = filePathArray[1];
    const mediaType = filePathArray[2]; // 'thumb' | 'preview' | 'original'

    if (!['thumb', 'preview', 'original'].includes(mediaType)) {
      return new NextResponse('File not found', { status: 404 });
    }

    const relativePath = filePathArray.join('/');
    const fullPath = resolveSafeStoragePath(relativePath);

    if (!fullPath || !fs.existsSync(fullPath)) {
      return new NextResponse('File not found', { status: 404 });
    }

    const isAdmin = await verifyAdminSession();

    if (!isAdmin) {
      const gallery = db.prepare(`
        SELECT id, status, allow_zip_download, cover_photo_id 
        FROM galleries 
        WHERE id = ?
      `).get(galleryId) as {
        id: string;
        status: string;
        allow_zip_download: number;
        cover_photo_id: string | null;
      } | undefined;

      if (!gallery || gallery.status === 'draft') {
        return new NextResponse('File not found', { status: 404 });
      }

      const clientCookie = req.cookies.get(`photogal_client_${galleryId}`)?.value;
      const queryToken = req.nextUrl.searchParams.get('token');
      const headerToken = req.headers.get('x-client-token');
      const clientToken = clientCookie || queryToken || headerToken;

      const isClientAuthorized = clientToken ? verifyClientToken(clientToken, galleryId) : false;

      if (!isClientAuthorized) {
        // Allow only cover thumbnail for public PIN gate preview
        if (mediaType === 'thumb') {
          const isCover = gallery.cover_photo_id
            ? db.prepare(`
                SELECT id FROM photos 
                WHERE gallery_id = ? AND thumb_path = ? AND id = ?
              `).get(galleryId, relativePath, gallery.cover_photo_id)
            : db.prepare(`
                SELECT id FROM photos 
                WHERE gallery_id = ? AND thumb_path = ?
                ORDER BY order_index ASC, created_at ASC LIMIT 1
              `).get(galleryId, relativePath);

          if (!isCover) {
            return new NextResponse('Brak autoryzacji do przeglądania zdjęć', { status: 401 });
          }
        } else {
          return new NextResponse('Brak autoryzacji do przeglądania zdjęć', { status: 401 });
        }
      } else {
        // Client is authorized. Check restrictions on original camera files
        if (mediaType === 'original') {
          if (!gallery.allow_zip_download || gallery.status !== 'submitted') {
            return new NextResponse('Pobieranie plików oryginalnych nie jest udostępnione', { status: 403 });
          }

          // Originals strictly allowed ONLY for photos explicitly selected by client
          const isSelected = db.prepare(`
            SELECT s.id FROM selections s
            JOIN photos p ON p.id = s.photo_id
            WHERE s.gallery_id = ? AND p.original_path = ?
          `).get(galleryId, relativePath);

          if (!isSelected) {
            return new NextResponse('Zdjęcie nie zostało wybrane w pakiecie', { status: 403 });
          }
        }
      }
    }

    const stat = await fs.promises.stat(fullPath);
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    const ifNoneMatch = req.headers.get('if-none-match');

    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304 });
    }

    const ext = path.extname(fullPath).toLowerCase();

    let contentType = 'application/octet-stream';
    if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.avif') contentType = 'image/avif';
    else if (ext === '.heic' || ext === '.heif') contentType = 'image/heic';
    else if (ext === '.tiff' || ext === '.tif') contentType = 'image/tiff';

    const fileStream = fs.createReadStream(fullPath);
    const readable = Readable.toWeb(fileStream);

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': stat.size.toString(),
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': 'private, max-age=86400',
    };

    if (mediaType === 'original') {
      const photoRow = db.prepare('SELECT filename FROM photos WHERE gallery_id = ? AND original_path = ?').get(galleryId, relativePath) as { filename: string } | undefined;
      const downloadName = photoRow?.filename || path.basename(fullPath);
      const asciiFallback = downloadName.replace(/[^a-zA-Z0-9._-]/g, '_');
      headers['Content-Disposition'] = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
    }

    return new NextResponse(readable as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
