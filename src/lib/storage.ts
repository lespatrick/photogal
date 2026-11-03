import path from 'path';
import fs from 'fs';

function resolveStorageDir(): string {
  if (process.env.STORAGE_DIR) {
    return path.resolve(process.env.STORAGE_DIR);
  }
  const cwd = process.cwd();
  // If running inside .next/standalone due to process.chdir(__dirname), find the true project root
  const standaloneMarker = path.sep + '.next' + path.sep + 'standalone';
  const idx = cwd.indexOf(standaloneMarker);
  const trueRoot = idx !== -1 ? cwd.substring(0, idx) : cwd;
  return path.resolve(trueRoot, 'storage');
}

export const STORAGE_DIR = resolveStorageDir();

if (!fs.existsSync(/*turbopackIgnore: true*/ STORAGE_DIR)) {
  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  } catch {}
}

// Automatic rescue migration: Check if photos were saved in .next/standalone/storage/galleries
try {
  const cwd = process.cwd();
  const standaloneMarker = path.sep + '.next' + path.sep + 'standalone';
  const idx = cwd.indexOf(standaloneMarker);
  const trueRoot = idx !== -1 ? cwd.substring(0, idx) : cwd;
  const legacyGalleries = path.resolve(trueRoot, '.next', 'standalone', 'storage', 'galleries');
  const targetGalleries = path.resolve(STORAGE_DIR, 'galleries');

  if (fs.existsSync(legacyGalleries) && legacyGalleries !== targetGalleries) {
    const isSymlink = fs.lstatSync(legacyGalleries).isSymbolicLink();
    if (!isSymlink) {
      fs.mkdirSync(targetGalleries, { recursive: true });
      const entries = fs.readdirSync(legacyGalleries, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dest = path.resolve(targetGalleries, entry.name);
          if (!fs.existsSync(dest)) {
            fs.cpSync(path.resolve(legacyGalleries, entry.name), dest, { recursive: true });
            console.log(`[STORAGE MIGRATION] Migrated gallery ${entry.name} from standalone to root storage.`);
          }
        }
      }
    }
  }
} catch {}

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
  if (base.startsWith(galleriesRoot + path.sep) && base !== galleriesRoot && fs.existsSync(/*turbopackIgnore: true*/ base)) {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

export function clearGalleryStorage(galleryId: string) {
  const base = getSafeGalleryBase(galleryId);
  if (!base) return;
  const galleriesRoot = path.resolve(STORAGE_DIR, 'galleries');
  if (base.startsWith(galleriesRoot + path.sep) && base !== galleriesRoot && fs.existsSync(/*turbopackIgnore: true*/ base)) {
    fs.rmSync(base, { recursive: true, force: true });
  }
  ensureGalleryStorage(galleryId);
}

export function deletePhotoFiles(galleryId: string, originalPath: string, thumbPath: string, previewPath: string) {
  const galleryBase = getSafeGalleryBase(galleryId);
  if (!galleryBase) return;

  const fullOriginal = resolveSafeStoragePath(originalPath);
  const fullThumb = resolveSafeStoragePath(thumbPath);
  const fullPreview = resolveSafeStoragePath(previewPath);

  if (fullOriginal && fullOriginal.startsWith(galleryBase + path.sep) && fs.existsSync(/*turbopackIgnore: true*/ fullOriginal)) {
    try { fs.unlinkSync(fullOriginal); } catch {}
  }
  if (fullThumb && fullThumb.startsWith(galleryBase + path.sep) && fs.existsSync(/*turbopackIgnore: true*/ fullThumb)) {
    try { fs.unlinkSync(fullThumb); } catch {}
  }
  if (fullPreview && fullPreview.startsWith(galleryBase + path.sep) && fs.existsSync(/*turbopackIgnore: true*/ fullPreview)) {
    try { fs.unlinkSync(fullPreview); } catch {}
  }
}

