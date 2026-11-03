#!/usr/bin/env node
/**
 * photogal — Disaster Recovery Utility
 *
 * Scans the storage directory (STORAGE_DIR/galleries) for physical photos,
 * detects orphaned galleries/photos missing from the SQLite database,
 * and restores them into photogal.db.
 *
 * Usage:
 *   node scripts/recover-galleries.js [--dry-run] [--execute]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const isDryRun = !args.includes('--execute');

const customStorageDir = args.find(a => a.startsWith('--storage-dir='))?.split('=')[1];
const customDbPath = args.find(a => a.startsWith('--db-path='))?.split('=')[1];

const DATA_DIR = customDbPath
  ? path.dirname(path.resolve(customDbPath))
  : process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : fs.existsSync('/opt/photogal/data')
      ? '/opt/photogal/data'
      : path.resolve(process.cwd(), 'data');

const DB_PATH = customDbPath
  ? path.resolve(customDbPath)
  : process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(DATA_DIR, 'photogal.db');

const STORAGE_DIR = customStorageDir
  ? path.resolve(customStorageDir)
  : process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : fs.existsSync('/opt/photogal/storage')
      ? '/opt/photogal/storage'
      : path.resolve(process.cwd(), 'storage');

console.log('============================================================');
console.log('📸 photogal — Storage Scanner & Disaster Recovery Tool');
console.log('============================================================');
console.log(`Database Path: ${DB_PATH}`);
console.log(`Storage Path:  ${STORAGE_DIR}`);
console.log(`Mode:          ${isDryRun ? 'DRY-RUN (Pass --execute to commit changes)' : 'LIVE EXECUTION'}`);
console.log('============================================================\n');

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Database not found at: ${DB_PATH}`);
  process.exit(1);
}

const galleriesRoot = path.resolve(STORAGE_DIR, 'galleries');
if (!fs.existsSync(galleriesRoot)) {
  console.log(`ℹ️ No galleries folder found at: ${galleriesRoot}`);
  process.exit(0);
}

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  console.warn('⚠️ Warning: sharp is not available. Image dimensions will be estimated.');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const existingGalleries = new Set(
  db.prepare('SELECT id FROM galleries').all().map(g => g.id)
);
const existingSlugs = new Set(
  db.prepare('SELECT slug FROM galleries').all().map(g => g.slug)
);

// Check if galleries exist in legacy standalone storage
const standaloneGalleries = path.resolve(STORAGE_DIR, '..', '.next', 'standalone', 'storage', 'galleries');
if (fs.existsSync(standaloneGalleries) && standaloneGalleries !== galleriesRoot) {
  try {
    const standaloneFolders = fs.readdirSync(standaloneGalleries, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    if (standaloneFolders.length > 0) {
      console.log(`📦 Found ${standaloneFolders.length} gallery folder(s) in legacy .next/standalone storage.`);
      for (const folder of standaloneFolders) {
        const dest = path.join(galleriesRoot, folder);
        if (!fs.existsSync(dest)) {
          if (!isDryRun) {
            fs.cpSync(path.join(standaloneGalleries, folder), dest, { recursive: true });
            console.log(`   Migrated [${folder}] from standalone to root storage.`);
          } else {
            console.log(`   [DRY-RUN] Would migrate [${folder}] from standalone to root storage.`);
          }
        }
      }
      console.log();
    }
  } catch {}
}

const galleryFolders = fs.readdirSync(galleriesRoot, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

console.log(`Found ${galleryFolders.length} gallery folder(s) in physical storage.\n`);

let recoveredGalleriesCount = 0;
let recoveredPhotosCount = 0;

async function runRecovery() {
  for (const galleryId of galleryFolders) {
    const galleryBase = path.join(galleriesRoot, galleryId);
    const originalDir = path.join(galleryBase, 'original');
    const thumbDir = path.join(galleryBase, 'thumb');
    const previewDir = path.join(galleryBase, 'preview');

    if (!fs.existsSync(originalDir)) {
      continue;
    }

    const originalFiles = fs.readdirSync(originalDir).filter(f => !f.startsWith('.'));
    if (originalFiles.length === 0) {
      continue;
    }

    const isExisting = existingGalleries.has(galleryId);

    if (isExisting) {
      // Gallery exists, check for orphaned photos
      const existingPhotos = new Set(
        db.prepare('SELECT filename, original_path FROM photos WHERE gallery_id = ?').all(galleryId)
          .map(p => path.basename(p.original_path))
      );

      const missingFiles = originalFiles.filter(f => !existingPhotos.has(f));
      if (missingFiles.length === 0) {
        continue;
      }

      console.log(`🔍 Gallery [${galleryId}] exists, but has ${missingFiles.length} photo(s) missing from database:`);
      let maxOrder = (db.prepare('SELECT MAX(order_index) as m FROM photos WHERE gallery_id = ?').get(galleryId)?.m || 0) + 1;

      for (const file of missingFiles) {
        console.log(`   + Missing photo: ${file}`);
        if (!isDryRun) {
          await insertRecoveredPhoto(galleryId, file, originalDir, thumbDir, previewDir, maxOrder++);
          recoveredPhotosCount++;
        }
      }
      continue;
    }

    // Gallery is completely missing from SQLite!
    console.log(`🚨 ORPHANED GALLERY DETECTED: [${galleryId}]`);
    console.log(`   Files in original/: ${originalFiles.length}`);

    // Generate safe unique slug
    let baseSlug = `recovered-${galleryId.substring(0, 8)}`;
    let slug = baseSlug;
    let counter = 1;
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }
    existingSlugs.add(slug);

    // Get folder creation/mtime for shoot_date
    let shootDate = new Date().toISOString().split('T')[0];
    try {
      const stats = fs.statSync(galleryBase);
      shootDate = new Date(stats.birthtimeMs || stats.mtimeMs).toISOString().split('T')[0];
    } catch {}

    const defaultPin = '1234';
    const title = `Odzyskana Galeria (${galleryId.substring(0, 8)})`;

    console.log(`   Proposed Title:      "${title}"`);
    console.log(`   Proposed Slug:       "${slug}"`);
    console.log(`   Assigned Shoot Date: ${shootDate}`);
    console.log(`   Assigned PIN:        ${defaultPin}`);

    if (isDryRun) {
      console.log(`   [DRY-RUN] Would create gallery and recover ${originalFiles.length} photo(s).\n`);
      recoveredGalleriesCount++;
      recoveredPhotosCount += originalFiles.length;
      continue;
    }

    // Insert Gallery
    db.prepare(`
      INSERT INTO galleries (
        id, slug, title, shoot_date, welcome_text, pin_code, pin_version,
        max_selections, allow_zip_download, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      galleryId,
      slug,
      title,
      shootDate,
      'Galeria odzyskana automatycznie po aktualizacji systemu.',
      defaultPin
    );

    let orderIndex = 0;
    let firstPhotoId = null;

    for (const file of originalFiles) {
      const photoId = await insertRecoveredPhoto(galleryId, file, originalDir, thumbDir, previewDir, orderIndex++);
      if (!firstPhotoId && photoId) {
        firstPhotoId = photoId;
      }
      recoveredPhotosCount++;
    }

    if (firstPhotoId) {
      db.prepare('UPDATE galleries SET cover_photo_id = ? WHERE id = ?').run(firstPhotoId, galleryId);
    }

    existingGalleries.add(galleryId);
    recoveredGalleriesCount++;
    console.log(`   ✅ Gallery [${galleryId}] successfully restored in database!\n`);
  }

  console.log('============================================================');
  if (isDryRun) {
    console.log(`DRY RUN COMPLETE.`);
    console.log(`Detected: ${recoveredGalleriesCount} missing gallery/galleries and ${recoveredPhotosCount} photo(s).`);
    console.log(`To restore them into the database, run:`);
    console.log(`  node scripts/recover-galleries.js --execute`);
  } else {
    console.log(`RECOVERY COMPLETE!`);
    console.log(`Restored ${recoveredGalleriesCount} gallery/galleries and ${recoveredPhotosCount} photo(s).`);
    console.log(`Default PIN for recovered galleries is 1234 (change it in Admin panel).`);
  }
  console.log('============================================================');
}

async function insertRecoveredPhoto(galleryId, originalFile, originalDir, thumbDir, previewDir, orderIndex) {
  const photoId = crypto.randomUUID();
  const originalFullPath = path.join(originalDir, originalFile);

  let width = 1920;
  let height = 1080;
  let fileSize = 0;

  try {
    const stat = fs.statSync(originalFullPath);
    fileSize = stat.size;
  } catch {}

  if (sharp) {
    try {
      const meta = await sharp(originalFullPath).metadata();
      if (meta.width && meta.height) {
        const isRotated = meta.orientation && [5, 6, 7, 8].includes(meta.orientation);
        width = isRotated ? meta.height : meta.width;
        height = isRotated ? meta.width : meta.height;
      }
    } catch {}
  }

  const aspectRatio = +(width / height).toFixed(4);

  // Derive base name for thumb and preview
  const originalExt = path.extname(originalFile);
  const strippedFilename = originalExt ? originalFile.slice(0, -originalExt.length) : originalFile;

  let thumbFile = `${strippedFilename}.webp`;
  let previewFile = `${strippedFilename}_preview.webp`;

  // Check if thumb exists, otherwise find any matching webp or fallback to original
  if (!fs.existsSync(path.join(thumbDir, thumbFile))) {
    const candidateThumbs = fs.existsSync(thumbDir) ? fs.readdirSync(thumbDir) : [];
    const matched = candidateThumbs.find(t => t.startsWith(strippedFilename) || strippedFilename.startsWith(t.replace('.webp', '')));
    if (matched) {
      thumbFile = matched;
    }
  }

  if (!fs.existsSync(path.join(previewDir, previewFile))) {
    const candidatePreviews = fs.existsSync(previewDir) ? fs.readdirSync(previewDir) : [];
    const matched = candidatePreviews.find(p => p.startsWith(strippedFilename) || strippedFilename.startsWith(p.replace('_preview.webp', '')));
    if (matched) {
      previewFile = matched;
    }
  }

  // Derive human-friendly display filename (strip timestamp prefix if photogal-generated)
  let cleanFilename = originalFile;
  const matchPrefix = originalFile.match(/^[a-z0-9]+-[a-z0-9]+_(.+)$/i);
  if (matchPrefix && matchPrefix[1]) {
    cleanFilename = matchPrefix[1];
  }

  const origRel = `galleries/${galleryId}/original/${originalFile}`;
  const thumbRel = `galleries/${galleryId}/thumb/${thumbFile}`;
  const prevRel = `galleries/${galleryId}/preview/${previewFile}`;

  db.prepare(`
    INSERT INTO photos (
      id, gallery_id, filename, original_path, thumb_path, preview_path,
      width, height, aspect_ratio, file_size, order_index, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    photoId,
    galleryId,
    cleanFilename,
    origRel,
    thumbRel,
    prevRel,
    width,
    height,
    aspectRatio,
    fileSize,
    orderIndex
  );

  return photoId;
}

runRecovery().catch(err => {
  console.error('Fatal error during recovery:', err);
  process.exit(1);
});

