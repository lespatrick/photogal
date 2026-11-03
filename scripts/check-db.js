#!/usr/bin/env node
/**
 * photogal — Database Inspection & Diagnostics Utility
 *
 * Inspects a SQLite database file and prints detailed statistics:
 * - Number of galleries (total and by status)
 * - Photo and selection counts per gallery
 * - Integrity status and file size
 * - Admin accounts and passkeys registered
 *
 * Usage:
 *   node scripts/check-db.js [path/to/photogal.db]
 *   node scripts/check-db.js --json
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const isJson = args.includes('--json');
const customPath = args.find(a => !a.startsWith('--'));

// Resolve database path
const defaultPaths = [
  process.env.DATABASE_PATH,
  process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'photogal.db') : null,
  '/opt/photogal/data/photogal.db',
  path.resolve(process.cwd(), 'data/photogal.db'),
  '/opt/photogal/.next/standalone/data/photogal.db',
  path.resolve(process.cwd(), '.next/standalone/data/photogal.db'),
  path.resolve(process.cwd(), 'photogal.db')
].filter(Boolean);

let dbPath = customPath ? path.resolve(customPath) : null;
if (!dbPath) {
  for (const candidate of defaultPaths) {
    if (fs.existsSync(candidate)) {
      dbPath = candidate;
      break;
    }
  }
}

if (!dbPath) {
  dbPath = path.resolve(process.cwd(), 'data/photogal.db');
}

if (!fs.existsSync(dbPath)) {
  if (isJson) {
    console.log(JSON.stringify({ error: `Database file not found at: ${dbPath}`, exists: false }));
  } else {
    console.error(`\n❌ Error: Database file not found at: ${dbPath}`);
    console.error(`Usage: node scripts/check-db.js [path/to/photogal.db]\n`);
  }
  process.exit(1);
}

let db;
try {
  // Open read-only to avoid altering WAL or acquiring unnecessary locks
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  if (isJson) {
    console.log(JSON.stringify({ error: err.message, dbPath }));
  } else {
    console.error(`\n❌ Error opening SQLite database at ${dbPath}: ${err.message}\n`);
  }
  process.exit(1);
}

// 1. Database file stats
const stat = fs.statSync(dbPath);
const fileSizeKb = (stat.size / 1024).toFixed(1);
const walFile = `${dbPath}-wal`;
const hasWal = fs.existsSync(walFile);
const walSizeKb = hasWal ? (fs.statSync(walFile).size / 1024).toFixed(1) : 0;

// 2. Integrity check
let integrity = 'OK';
try {
  const check = db.prepare('PRAGMA integrity_check').get();
  integrity = check ? Object.values(check)[0] : 'UNKNOWN';
} catch (e) {
  integrity = `ERROR: ${e.message}`;
}

// 3. Tables check
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
const hasGalleriesTable = tables.includes('galleries');
const hasPhotosTable = tables.includes('photos');
const hasSelectionsTable = tables.includes('selections');
const hasAdminsTable = tables.includes('admins');

if (!hasGalleriesTable) {
  if (isJson) {
    console.log(JSON.stringify({ error: 'Database does not contain "galleries" table', tables, dbPath }));
  } else {
    console.log(`\n⚠️ Database at ${dbPath} is initialized, but missing the "galleries" table.`);
    console.log(`Existing tables: ${tables.join(', ') || 'none'}\n`);
  }
  process.exit(0);
}

// 4. Gallery statistics
const galleries = db.prepare(`
  SELECT 
    g.id,
    g.slug,
    g.title,
    g.shoot_date,
    g.status,
    g.created_at,
    COUNT(DISTINCT p.id) as photo_count,
    COUNT(DISTINCT s.id) as selection_count
  FROM galleries g
  LEFT JOIN photos p ON p.gallery_id = g.id
  LEFT JOIN selections s ON s.gallery_id = g.id
  GROUP BY g.id
  ORDER BY g.created_at DESC
`).all();

const totalGalleries = galleries.length;
const totalPhotos = hasPhotosTable ? (db.prepare('SELECT COUNT(*) as c FROM photos').get()?.c || 0) : 0;
const totalSelections = hasSelectionsTable ? (db.prepare('SELECT COUNT(*) as c FROM selections').get()?.c || 0) : 0;

// Status breakdown
const statusCounts = {};
for (const g of galleries) {
  const st = g.status || 'unknown';
  statusCounts[st] = (statusCounts[st] || 0) + 1;
}

// Admin and passkey statistics
const adminCount = hasAdminsTable ? (db.prepare('SELECT COUNT(*) as c FROM admins').get()?.c || 0) : 0;
const admins = hasAdminsTable ? db.prepare('SELECT username, created_at FROM admins').all() : [];

if (isJson) {
  console.log(JSON.stringify({
    dbPath,
    fileSizeKb: parseFloat(fileSizeKb),
    walActive: hasWal,
    walSizeKb: parseFloat(walSizeKb),
    integrity,
    counts: {
      galleries: totalGalleries,
      photos: totalPhotos,
      selections: totalSelections,
      admins: adminCount,
      byStatus: statusCounts,
    },
    galleries,
    admins,
  }, null, 2));
  process.exit(0);
}

// Human-friendly console report
console.log('\n============================================================');
console.log('📊 photogal — Database Inspection & Diagnostics');
console.log('============================================================');
console.log(`Database File:    ${dbPath}`);
console.log(`File Size:        ${fileSizeKb} KB ${hasWal ? `(WAL: ${walSizeKb} KB)` : ''}`);
console.log(`Integrity Check:  ${integrity === 'ok' ? '✅ OK' : `⚠️ ${integrity}`}`);
console.log(`Admins:           ${adminCount} account(s) registered`);
console.log('------------------------------------------------------------');
console.log(`TOTAL GALLERIES:  ${totalGalleries}`);
console.log(`TOTAL PHOTOS:     ${totalPhotos}`);
console.log(`TOTAL SELECTIONS: ${totalSelections}`);

if (Object.keys(statusCounts).length > 0) {
  const breakdown = Object.entries(statusCounts)
    .map(([st, cnt]) => `${st}: ${cnt}`)
    .join(', ');
  console.log(`Status Breakdown: ${breakdown}`);
}
console.log('============================================================\n');

if (totalGalleries === 0) {
  console.log('ℹ️  No galleries found in this database.');

  // Check if galleries are in legacy standalone location
  const potentialStandalonePaths = [
    '/opt/photogal/.next/standalone/data/photogal.db',
    path.resolve(process.cwd(), '.next/standalone/data/photogal.db'),
  ].filter(p => p !== dbPath && fs.existsSync(p));

  let foundLegacy = false;
  for (const altPath of potentialStandalonePaths) {
    try {
      const altDb = new Database(altPath, { readonly: true, fileMustExist: true });
      const altCount = altDb.prepare('SELECT COUNT(*) as c FROM galleries').get()?.c || 0;
      if (altCount > 0) {
        console.log(`\n🚨 FOUND ${altCount} GALLERY/GALLERIES IN ALTERNATIVE LOCATION:`);
        console.log(`   Path: ${altPath}`);
        console.log(`   To inspect: node scripts/check-db.js "${altPath}"`);
        console.log(`   To restore: cp -a "${altPath}" "${dbPath}" && systemctl restart photogal\n`);
        foundLegacy = true;
      }
      altDb.close();
    } catch {}
  }

  if (!foundLegacy) {
    console.log('   If your photos are on disk, you can recover them with:');
    console.log('   node scripts/recover-galleries.js --execute\n');
  }
} else {
  console.log('GALERIE W BAZIE DANYCH:');
  console.log('─'.repeat(80));
  console.log(
    'TYTUŁ'.padEnd(28) +
    'SLUG'.padEnd(20) +
    'DATA SESJI'.padEnd(12) +
    'STATUS'.padEnd(10) +
    'ZDJĘĆ'.padStart(6) +
    'WYBORÓW'.padStart(8)
  );
  console.log('─'.repeat(80));

  for (const g of galleries) {
    const title = (g.title.length > 26 ? g.title.substring(0, 23) + '...' : g.title).padEnd(28);
    const slug = (g.slug.length > 18 ? g.slug.substring(0, 15) + '...' : g.slug).padEnd(20);
    const date = (g.shoot_date || '-').padEnd(12);
    const status = (g.status || 'active').padEnd(10);
    const photos = String(g.photo_count).padStart(6);
    const selections = String(g.selection_count).padStart(8);

    console.log(`${title}${slug}${date}${status}${photos}${selections}`);
  }
  console.log('─'.repeat(80));
  console.log();
}

