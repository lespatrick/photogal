import path from 'path';
import fs from 'fs';

export const STORAGE_DIR = path.resolve(process.cwd(), 'storage');

export function ensureGalleryStorage(galleryId: string) {
  const safeId = path.basename(galleryId);
  const base = path.resolve(STORAGE_DIR, 'galleries', safeId);
  const dirs = [
    path.resolve(base, 'original'),
    path.resolve(base, 'thumb'),
    path.resolve(base, 'preview'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return {
    base,
    original: path.resolve(base, 'original'),
    thumb: path.resolve(base, 'thumb'),
    preview: path.resolve(base, 'preview'),
  };
}

export function getFilePath(galleryId: string, type: 'original' | 'thumb' | 'preview', filename: string): string {
  const safeId = path.basename(galleryId);
  const safeFile = path.basename(filename);
  return path.resolve(STORAGE_DIR, 'galleries', safeId, type, safeFile);
}

export function resolveSafeStoragePath(relPath: string): string | null {
  if (!relPath || typeof relPath !== 'string') return null;
  // Strip any leading slashes, backslashes, or relative markers
  const cleanRel = path.normalize(relPath).replace(/^(\.\.[\/\\]|[/\\])+/, '');
  const fullPath = path.resolve(STORAGE_DIR, cleanRel);
  const normalizedStorage = path.resolve(STORAGE_DIR);
  if (!fullPath.startsWith(normalizedStorage + path.sep) && fullPath !== normalizedStorage) {
    return null;
  }
  return fullPath;
}

export function deleteGalleryStorage(galleryId: string) {
  const safeId = path.basename(galleryId);
  const base = path.resolve(STORAGE_DIR, 'galleries', safeId);
  if (fs.existsSync(base)) {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

export function deletePhotoFiles(galleryId: string, originalPath: string, thumbPath: string, previewPath: string) {
  const fullOriginal = resolveSafeStoragePath(originalPath);
  const fullThumb = resolveSafeStoragePath(thumbPath);
  const fullPreview = resolveSafeStoragePath(previewPath);

  if (fullOriginal && fs.existsSync(fullOriginal)) fs.unlinkSync(fullOriginal);
  if (fullThumb && fs.existsSync(fullThumb)) fs.unlinkSync(fullThumb);
  if (fullPreview && fs.existsSync(fullPreview)) fs.unlinkSync(fullPreview);
}

