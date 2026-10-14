/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORAGE_DIR = path.resolve(process.cwd(), 'storage');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.resolve(DATA_DIR, 'photogal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS galleries (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      shoot_date TEXT NOT NULL,
      welcome_text TEXT,
      pin_code TEXT NOT NULL,
      max_selections INTEGER DEFAULT 0,
      allow_zip_download INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      cover_photo_id TEXT,
      client_notes TEXT,
      submitted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      pin_locked_until DATETIME
    );

    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_path TEXT NOT NULL,
      thumb_path TEXT NOT NULL,
      preview_path TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      aspect_ratio REAL NOT NULL,
      file_size INTEGER NOT NULL,
      order_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS selections (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      UNIQUE(gallery_id, photo_id)
    );

    CREATE TABLE IF NOT EXISTS authenticators (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT DEFAULT 'singleDevice',
      backed_up INTEGER DEFAULT 0,
      transports TEXT,
      friendly_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      user_type TEXT NOT NULL,
      admin_id TEXT,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pin_attempts (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      success INTEGER NOT NULL,
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
    );
  `);

  // Default admin
  const defaultAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
  if (!defaultAdmin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = crypto.scryptSync(defaultPassword, salt, 64).toString('hex');
    const passwordHash = `${salt}:${hash}`;
    db.prepare('INSERT OR IGNORE INTO admins (id, username, password_hash) VALUES (?, ?, ?)').run(
      crypto.randomUUID(),
      'admin',
      passwordHash
    );
  }
}

async function seed() {
  initSchema();
  console.log('Seeding demo gallery...');

  const galleryId = 'demo-gallery-id';
  const slug = 'anna-i-piotr-slub';
  const title = 'Ślub & Plener: Anna i Piotr';
  const shootDate = '2026-09-18';
  const welcomeText = 'Cześć Aniu i Piotrze! Dziękujemy za ten wspaniały, pełen emocji dzień. Przygotowaliśmy dla Was zestawienie najlepszych kadrów z ceremonii oraz sesji plenerowej. Wybierzcie proszę Wasze ulubione ujęcia (serduszkiem), abyśmy mogli skierować je do pełnego autorskiego retuszu.';
  const pinCode = '2026';
  const maxSelections = 15;

  // Ensure gallery storage directories
  const baseDir = path.resolve(STORAGE_DIR, 'galleries', galleryId);
  const origDir = path.resolve(baseDir, 'original');
  const thumbDir = path.resolve(baseDir, 'thumb');
  const prevDir = path.resolve(baseDir, 'preview');

  [origDir, thumbDir, prevDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // Upsert gallery
  db.prepare(`
    INSERT OR REPLACE INTO galleries (
      id, slug, title, shoot_date, welcome_text, pin_code, max_selections, allow_zip_download, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(galleryId, slug, title, shootDate, welcomeText, pinCode, maxSelections, 1);

  // Clear existing photos for demo
  db.prepare('DELETE FROM photos WHERE gallery_id = ?').run(galleryId);
  db.prepare('DELETE FROM selections WHERE gallery_id = ?').run(galleryId);

  const photoDefs = [
    { name: '_DSC4012.JPG', w: 1200, h: 800, color1: '#2c3e50', color2: '#3498db', title: 'Przygotowania & Detale Sukni' },
    { name: '_DSC4088.JPG', w: 800, h: 1200, color1: '#3e2723', color2: '#d7ccc8', title: 'Portret Panny Młodej' },
    { name: '_DSC4152.JPG', w: 1200, h: 800, color1: '#1b5e20', color2: '#a5d6a7', title: 'First Look w Ogrodzie' },
    { name: '_DSC4230.JPG', w: 800, h: 1200, color1: '#4a148c', color2: '#ce93d8', title: 'Przysięga Małżeńska' },
    { name: '_DSC4310.JPG', w: 1200, h: 800, color1: '#e65100', color2: '#ffcc80', title: 'Wyjście z Kościoła & Konfetti' },
    { name: '_DSC4425.JPG', w: 1200, h: 900, color1: '#263238', color2: '#cfd8dc', title: 'Pierwszy Taniec w Chmurach' },
    { name: '_DSC4580.JPG', w: 800, h: 1200, color1: '#880e4f', color2: '#f48fb1', title: 'Złota Godzina - Zachód Słońca' },
    { name: '_DSC4690.JPG', w: 1200, h: 800, color1: '#004d40', color2: '#80cbc4', title: 'Zimne Ognie o Północy' },
  ];

  let order = 1;
  let coverId = null;

  for (const def of photoDefs) {
    const photoId = crypto.randomUUID();
    if (!coverId) coverId = photoId;

    const svg = `
      <svg width="${def.w}" height="${def.h}" viewBox="0 0 ${def.w} ${def.h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${def.color1}" />
            <stop offset="100%" stop-color="${def.color2}" />
          </linearGradient>
          <radialGradient id="vignette" cx="50%" cy="50%" r="50%">
            <stop offset="60%" stop-color="#000000" stop-opacity="0" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.6" />
          </radialGradient>
        </defs>
        <rect width="${def.w}" height="${def.h}" fill="url(#grad)" />
        <rect width="${def.w}" height="${def.h}" fill="url(#vignette)" />
        
        <circle cx="${def.w / 2}" cy="${def.h / 2 - 40}" r="90" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
        <circle cx="${def.w / 2}" cy="${def.h / 2 - 40}" r="40" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="4" />
        
        <text x="${def.w / 2}" y="${def.h / 2 + 100}" font-family="sans-serif" font-size="34" font-weight="600" fill="#ffffff" text-anchor="middle" letter-spacing="1">
          ${def.title.replace(/&/g, '&amp;')}
        </text>
        <text x="${def.w / 2}" y="${def.h / 2 + 150}" font-family="monospace" font-size="20" fill="rgba(255,255,255,0.7)" text-anchor="middle">
          ${def.name} • 1/250s f/1.4 ISO 100
        </text>
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();

    const origPath = path.resolve(origDir, def.name);
    const thumbName = def.name.replace('.JPG', '.webp');
    const prevName = def.name.replace('.JPG', '_preview.webp');

    fs.writeFileSync(origPath, buffer);

    await sharp(buffer)
      .resize(600, 600, { fit: 'inside' })
      .webp({ quality: 80 })
      .toFile(path.resolve(thumbDir, thumbName));

    await sharp(buffer)
      .resize(1800, 1800, { fit: 'inside' })
      .webp({ quality: 85 })
      .toFile(path.resolve(prevDir, prevName));

    const relOrig = `galleries/${galleryId}/original/${def.name}`;
    const relThumb = `galleries/${galleryId}/thumb/${thumbName}`;
    const relPrev = `galleries/${galleryId}/preview/${prevName}`;

    db.prepare(`
      INSERT INTO photos (
        id, gallery_id, filename, original_path, thumb_path, preview_path,
        width, height, aspect_ratio, file_size, order_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      photoId,
      galleryId,
      def.name,
      relOrig,
      relThumb,
      relPrev,
      def.w,
      def.h,
      +(def.w / def.h).toFixed(4),
      buffer.length,
      order++
    );

    // Pre-select 2 photos to show selection state right away
    if (order === 2 || order === 4) {
      db.prepare('INSERT INTO selections (id, gallery_id, photo_id) VALUES (?, ?, ?)').run(
        crypto.randomUUID(),
        galleryId,
        photoId
      );
    }
  }

  db.prepare('UPDATE galleries SET cover_photo_id = ? WHERE id = ?').run(coverId, galleryId);

  console.log(`Demo gallery seeded successfully! Slug: /g/${slug}, PIN: ${pinCode}`);
}

seed().catch(console.error);
