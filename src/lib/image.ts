import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { ensureGalleryStorage } from './storage';

export interface ProcessedPhotoResult {
  filename: string;
  originalRelativePath: string;
  thumbRelativePath: string;
  previewRelativePath: string;
  width: number;
  height: number;
  aspectRatio: number;
  fileSize: number;
}

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.tif', '.avif']);

export async function processAndSavePhoto(
  galleryId: string,
  originalFilename: string,
  buffer: Buffer
): Promise<ProcessedPhotoResult> {
  const dirs = ensureGalleryStorage(galleryId);

  // Validate extension
  const ext = (path.extname(originalFilename) || '.jpg').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Niedozwolony format pliku (${ext}). Dozwolone są pliki JPG, PNG, WebP, HEIC i TIFF.`);
  }

  // 1. Validate image format with Sharp BEFORE writing to disk
  const imagePipeline = sharp(buffer).rotate();
  const metadata = await imagePipeline.metadata();

  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error('Plik nie jest prawidłowym obrazem lub jest uszkodzony.');
  }

  // Generate safe unique base name (case-insensitive extension stripping)
  const originalExt = path.extname(originalFilename);
  const strippedFilename = originalExt ? originalFilename.slice(0, -originalExt.length) : originalFilename;
  const rawBase = path.basename(strippedFilename).replace(/[^a-zA-Z0-9_-]/g, '_') || 'photo';
  const uniquePrefix = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
  const baseName = `${uniquePrefix}_${rawBase}`;

  const originalFile = `${baseName}${ext}`;
  const thumbFile = `${baseName}.webp`;
  const previewFile = `${baseName}_preview.webp`;

  const originalFullPath = path.join(dirs.original, originalFile);
  const thumbFullPath = path.join(dirs.thumb, thumbFile);
  const previewFullPath = path.join(dirs.preview, previewFile);

  const writtenFiles: string[] = [];

  try {
    // 2. Save original buffer
    await fs.promises.writeFile(originalFullPath, buffer);
    writtenFiles.push(originalFullPath);

    const originalWidth = metadata.width;
    const originalHeight = metadata.height;
    const isRotated = metadata.orientation && [5, 6, 7, 8].includes(metadata.orientation);
    
    // Normalized dimensions
    const finalWidth = isRotated ? originalHeight : originalWidth;
    const finalHeight = isRotated ? originalWidth : originalHeight;
    const aspectRatio = +(finalWidth / finalHeight).toFixed(4);

    // 3. Generate High-Res WebP Preview directly from original file on disk (max 2200x2200) to minimize heap memory footprint
    await sharp(originalFullPath)
      .rotate()
      .resize(2200, 2200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, effort: 3 })
      .toFile(previewFullPath);
    writtenFiles.push(previewFullPath);

    // 4. Generate WebP Thumbnail directly from original file on disk to eliminate in-memory buffer duplication
    await sharp(originalFullPath)
      .rotate()
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 3 })
      .toFile(thumbFullPath);
    writtenFiles.push(thumbFullPath);

    return {
      filename: originalFilename,
      originalRelativePath: `galleries/${galleryId}/original/${originalFile}`,
      thumbRelativePath: `galleries/${galleryId}/thumb/${thumbFile}`,
      previewRelativePath: `galleries/${galleryId}/preview/${previewFile}`,
      width: finalWidth,
      height: finalHeight,
      aspectRatio,
      fileSize: buffer.length,
    };
  } catch (error) {
    // Clean up any files written before the error
    for (const file of writtenFiles) {
      try {
        if (fs.existsSync(file)) await fs.promises.unlink(file);
      } catch {}
    }
    throw error;
  }
}
