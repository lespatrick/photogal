import path from 'path';
import fs from 'fs';

export const STORAGE_DIR = path.resolve(process.cwd(), 'storage');

export function getSafeGalleryBase(galleryId: string): string | null {
  if (!galleryId || typeof galleryId !== 'string') return null;
  const safeId = path.basename(galleryId.trim());
  if (!safeId || safeId === '.' || safeId === '..') return null;
  const galleriesRoot = path.resolve(STORAGE_DIR, 'galleries');
  const base = path.resolve(galleriesRoot, safeId);
  if (!base.startsWith(galleriesRoot + path.sep) || base === galleriesRoot) {
    return null;
  }
  return base;
}

export function ensureGalleryStorage(galleryId: string) {
  const base = getSafeGalleryBase(galleryId);
  if (!base) {
    throw new Error(`Invalid galleryId for storage: ${galleryId}`);
  }
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

export function getFilePath(galleryId: string, type: 'original' | 'thumb' | 'preview', filename: string): string | null {
  const base = getSafeGalleryBase(galleryId);
  if (!base) return null;
  const safeFile = path.basename(filename);
  if (!safeFile || safeFile === '.' || safeFile === '..') return null;
  return path.resolve(base, type, safeFile);
}

export function resolveSafeStoragePath(relPath: string): string | null {
  if (!relPath || typeof relPath !== 'string') return null;
  // Strip any leading slashes, backslashes, or relative markers
  const cleanRel = path.normalize(relPath.trim()).replace(/^(\.\.[\/\\]|[/\\])+/, '');
  if (!cleanRel || cleanRel === '.' || cleanRel === '..') return null;
  const fullPath = path.resolve(STORAGE_DIR, cleanRel);
  const normalizedStorage = path.resolve(STORAGE_DIR);
  if (!fullPath.startsWith(normalizedStorage + path.sep) || fullPath === normalizedStorage) {
    return null;
  }
  return fullPath;
}

export function deleteGalleryStorage(galleryId: string) {
  const base = getSafeGalleryBase(galleryId);
  if (!base) return;
  const galleriesRoot = path.resolve(STORAGE_DIR, 'galleries');
  // Extra safeguard: base must be strictly inside galleriesRoot and unequal to it
  if (base.startsWith(galleriesRoot + path.sep) && base !== galleriesRoot && fs.existsSync(base)) {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

export function deletePhotoFiles(galleryId: string, originalPath: string, thumbPath: string, previewPath: string) {
  const galleryBase = getSafeGalleryBase(galleryId);
  if (!galleryBase) return;

  const fullOriginal = resolveSafeStoragePath(originalPath);
  const fullThumb = resolveSafeStoragePath(thumbPath);
  const fullPreview = resolveSafeStoragePath(previewPath);

  if (fullOriginal && fullOriginal.startsWith(galleryBase + path.sep) && fs.existsSync(fullOriginal)) {
    try { fs.unlinkSync(fullOriginal); } catch {}
  }
  if (fullThumb && fullThumb.startsWith(galleryBase + path.sep) && fs.existsSync(fullThumb)) {
    try { fs.unlinkSync(fullThumb); } catch {}
  }
  if (fullPreview && fullPreview.startsWith(galleryBase + path.sep) && fs.existsSync(fullPreview)) {
    try { fs.unlinkSync(fullPreview); } catch {}
  }
}

