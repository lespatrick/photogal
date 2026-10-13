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
    if (!filePathArray || filePathArray.length < 3) {
      return new NextResponse('File not found', { status: 404 });
    }

    const relativePath = filePathArray.join('/');
    const fullPath = resolveSafeStoragePath(relativePath);

    if (!fullPath || !fs.existsSync(fullPath)) {
      return new NextResponse('File not found', { status: 404 });
    }

    // Media route structure: galleries/{galleryId}/{type}/{filename}
    if (filePathArray[0] === 'galleries') {
      const galleryId = filePathArray[1];
      const mediaType = filePathArray[2]; // 'thumb' | 'preview' | 'original'

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
            const isCover = db.prepare(`
              SELECT id FROM photos 
              WHERE gallery_id = ? AND thumb_path = ? AND (
                id = ? OR id = (SELECT id FROM photos WHERE gallery_id = ? ORDER BY order_index ASC, created_at ASC LIMIT 1)
              )
            `).get(galleryId, relativePath, gallery.cover_photo_id || '', galleryId);

            if (!isCover) {
              return new NextResponse('Brak autoryzacji do przeglądania zdjęć', { status: 401 });
            }
          } else {
            return new NextResponse('Brak autoryzacji do przeglądania zdjęć', { status: 401 });
          }
        } else {
          // Client is authorized. Check restrictions on original camera files
          if (mediaType === 'original' && !gallery.allow_zip_download) {
            return new NextResponse('Pobieranie plików oryginalnych nie jest udostępnione', { status: 403 });
          }
        }
      }
    }

    const stat = await fs.promises.stat(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    let contentType = 'application/octet-stream';
    if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';

    const fileStream = fs.createReadStream(fullPath);
    const readable = Readable.toWeb(fileStream);

    return new NextResponse(readable as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
