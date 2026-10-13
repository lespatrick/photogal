import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.resolve(DATA_DIR, 'photogal.db');

const db: Database.Database = new Database(DB_PATH);

// Pragmas for performance and data integrity
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
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
      status TEXT DEFAULT 'active', -- 'draft', 'active', 'submitted', 'archived'
      cover_photo_id TEXT,
      client_notes TEXT,
      submitted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_galleries_slug ON galleries(slug);
    CREATE INDEX IF NOT EXISTS idx_photos_gallery ON photos(gallery_id);
    CREATE INDEX IF NOT EXISTS idx_selections_gallery ON selections(gallery_id);
    CREATE INDEX IF NOT EXISTS idx_selections_photo ON selections(photo_id);
    CREATE INDEX IF NOT EXISTS idx_authenticators_admin ON authenticators(admin_id);
    CREATE INDEX IF NOT EXISTS idx_pin_attempts_lookup ON pin_attempts(gallery_id, ip_hash, attempted_at);
  `);

  // Safe migrations
  try {
    db.prepare('ALTER TABLE galleries ADD COLUMN pin_locked_until DATETIME').run();
  } catch {}

  try {
    db.prepare('ALTER TABLE admins ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1').run();
  } catch {}

  // Prune pin_attempts older than 7 days to prevent unbounded DB bloat
  try {
    db.prepare("DELETE FROM pin_attempts WHERE attempted_at < datetime('now', '-7 days')").run();
  } catch {}

  // Seed default admin if none exists (username: admin, pass: admin123 or from env)
  try {
    const defaultAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
    if (!defaultAdmin) {
      const salt = crypto.randomBytes(16).toString('hex');
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
      const hash = crypto.scryptSync(defaultPassword, salt, 64).toString('hex');
      const passwordHash = `${salt}:${hash}`;
      db.prepare('INSERT OR IGNORE INTO admins (id, username, password_hash, token_version) VALUES (?, ?, ?, 1)').run(
        crypto.randomUUID(),
        'admin',
        passwordHash
      );
      console.log('Initialized default admin account: user=admin, pass=' + defaultPassword);
    }
  } catch {
    // Ignore concurrency race conditions during Next.js parallel route compilation
  }
}

// Ensure database is initialized upon module load
initDatabase();

export { db };
export default db;
