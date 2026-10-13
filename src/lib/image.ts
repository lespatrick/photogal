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

export async function processAndSavePhoto(
  galleryId: string,
  originalFilename: string,
  buffer: Buffer
): Promise<ProcessedPhotoResult> {
  const dirs = ensureGalleryStorage(galleryId);

  // Generate safe unique base name
  const ext = path.extname(originalFilename) || '.jpg';
  const rawBase = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const uniquePrefix = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
  const baseName = `${uniquePrefix}_${rawBase}`;

  const originalFile = `${baseName}${ext}`;
  const thumbFile = `${baseName}.webp`;
  const previewFile = `${baseName}_preview.webp`;

  const originalFullPath = path.join(dirs.original, originalFile);
  const thumbFullPath = path.join(dirs.thumb, thumbFile);
  const previewFullPath = path.join(dirs.preview, previewFile);

  // Save original buffer
  await fs.promises.writeFile(originalFullPath, buffer);

  // Process with Sharp: rotate orientation automatically from EXIF
  const imagePipeline = sharp(buffer).rotate();
  const metadata = await imagePipeline.metadata();

  const originalWidth = metadata.width || 1920;
  const originalHeight = metadata.height || 1080;
  const isRotated = metadata.orientation && [5, 6, 7, 8].includes(metadata.orientation);
  
  // Normalized dimensions
  const finalWidth = isRotated ? originalHeight : originalWidth;
  const finalHeight = isRotated ? originalWidth : originalHeight;
  const aspectRatio = +(finalWidth / finalHeight).toFixed(4);

  // 1. Generate WebP Thumbnail (max 600x600, fit inside)
  await sharp(buffer)
    .rotate()
    .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 3 })
    .toFile(thumbFullPath);

  // 2. Generate WebP High-Res Preview for Lightbox (max 2200x2200, fit inside)
  await sharp(buffer)
    .rotate()
    .resize(2200, 2200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86, effort: 3 })
    .toFile(previewFullPath);

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
}
