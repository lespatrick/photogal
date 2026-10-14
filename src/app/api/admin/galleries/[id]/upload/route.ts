import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';
import { processAndSavePhoto } from '@/lib/image';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const gallery = db.prepare('SELECT id FROM galleries WHERE id = ? OR slug = ?').get(id, id) as { id: string } | undefined;
    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }
    const actualId = gallery.id;

    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'Brak plików do wgrania' }, { status: 400 });
    }

    if (files.length > 50) {
      return NextResponse.json({ error: 'Maksymalna wielkość pojedynczej paczki to 50 plików' }, { status: 400 });
    }

    const currentMaxOrder = (db.prepare('SELECT MAX(order_index) as max_ord FROM photos WHERE gallery_id = ?').get(actualId) as any)?.max_ord || 0;
    let nextOrder = currentMaxOrder + 1;

    const insertedPhotos = [];
    const errors = [];

    for (const file of files) {
      try {
        if (file.size > 50 * 1024 * 1024) {
          errors.push({ filename: file.name, error: 'Plik przekracza maksymalny limit 50MB' });
          continue;
        }

        const originalName = file.name;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Process with Sharp into WebP thumb, WebP preview, and original JPG
        const processed = await processAndSavePhoto(actualId, originalName, buffer);

        const photoId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO photos (
            id, gallery_id, filename, original_path, thumb_path, preview_path,
            width, height, aspect_ratio, file_size, order_index
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          photoId,
          actualId,
          processed.filename,
          processed.originalRelativePath,
          processed.thumbRelativePath,
          processed.previewRelativePath,
          processed.width,
          processed.height,
          processed.aspectRatio,
          processed.fileSize,
          nextOrder++
        );

        insertedPhotos.push({
          id: photoId,
          gallery_id: actualId,
          filename: processed.filename,
          original_path: processed.originalRelativePath,
          thumb_path: processed.thumbRelativePath,
          preview_path: processed.previewRelativePath,
          width: processed.width,
          height: processed.height,
          aspect_ratio: processed.aspectRatio,
          file_size: processed.fileSize,
          is_selected: 0,
        });
      } catch (err: any) {
        console.error(`Error processing file ${file.name}:`, err);
        errors.push({ filename: file.name, error: err.message || 'Błąd przetwarzania obrazu' });
      }
    }

    return NextResponse.json({
      success: true,
      count: insertedPhotos.length,
      photos: insertedPhotos,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Wystąpił błąd podczas wgrywania zdjęć' }, { status: 500 });
  }
}
