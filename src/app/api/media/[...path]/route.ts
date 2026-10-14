import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import db from '@/lib/db';
import { verifyAdminSession, verifyClientToken, extractClientToken } from '@/lib/auth';
import { getFilePath, getSafeGalleryBase } from '@/lib/storage';

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
    const mediaType = filePathArray[2] as 'thumb' | 'preview' | 'original';
    const rawFileName = filePathArray[3];

    if (!['thumb', 'preview', 'original'].includes(mediaType)) {
      return new NextResponse('File not found', { status: 404 });
    }

    const safeFileName = path.basename(rawFileName.trim());
    if (!safeFileName || safeFileName === '.' || safeFileName === '..' || safeFileName !== rawFileName) {
      return new NextResponse('File not found', { status: 404 });
    }

    const galleryBase = getSafeGalleryBase(galleryId);
    const fullPath = getFilePath(galleryId, mediaType, safeFileName);

    if (!fullPath || !galleryBase || !fullPath.startsWith(galleryBase + path.sep) || !fs.existsSync(fullPath)) {
      return new NextResponse('File not found', { status: 404 });
    }

    const relativePath = `galleries/${path.basename(galleryId)}/${mediaType}/${safeFileName}`;

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

      const clientToken = extractClientToken(req, galleryId);
      const isClientAuthorized = clientToken ? verifyClientToken(clientToken, galleryId) : false;

      if (!isClientAuthorized) {
        // Allow only cover thumbnail for public PIN gate preview
        if (mediaType === 'thumb') {
          let coverRow: { thumb_path: string } | undefined;
          if (gallery.cover_photo_id) {
            coverRow = db.prepare(`
              SELECT thumb_path FROM photos 
              WHERE gallery_id = ? AND id = ?
            `).get(galleryId, gallery.cover_photo_id) as { thumb_path: string } | undefined;
          }
          if (!coverRow) {
            coverRow = db.prepare(`
              SELECT thumb_path FROM photos 
              WHERE gallery_id = ?
              ORDER BY order_index ASC, created_at ASC LIMIT 1
            `).get(galleryId) as { thumb_path: string } | undefined;
          }

          if (!coverRow || coverRow.thumb_path !== relativePath) {
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

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    };

    if (mediaType === 'original') {
      const photoRow = db.prepare('SELECT filename FROM photos WHERE gallery_id = ? AND original_path = ?').get(galleryId, relativePath) as { filename: string } | undefined;
      const downloadName = photoRow?.filename || path.basename(fullPath);
      const asciiFallback = downloadName.replace(/[^a-zA-Z0-9._-]/g, '_');
      headers['Content-Disposition'] = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
    }

    const rangeHeader = req.headers.get('range');
    const fileSize = stat.size;

    // Support HTTP Range requests (RFC 7233) for resumable downloads and media streaming
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (!isNaN(start) && start >= 0 && start < fileSize) {
        const chunkEnd = Math.min(isNaN(end) ? fileSize - 1 : end, fileSize - 1);
        if (chunkEnd >= start) {
          const chunkSize = chunkEnd - start + 1;
          const rangeStream = fs.createReadStream(fullPath, { start, end: chunkEnd });
          req.signal?.addEventListener('abort', () => {
            if (!rangeStream.destroyed) rangeStream.destroy();
          });

          headers['Content-Range'] = `bytes ${start}-${chunkEnd}/${fileSize}`;
          headers['Content-Length'] = chunkSize.toString();

          return new NextResponse(Readable.toWeb(rangeStream) as ReadableStream, {
            status: 206,
            headers,
          });
        }
      }
    }

    headers['Content-Length'] = fileSize.toString();
    const fileStream = fs.createReadStream(fullPath);
    req.signal?.addEventListener('abort', () => {
      if (!fileStream.destroyed) fileStream.destroy();
    });

    return new NextResponse(Readable.toWeb(fileStream) as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
