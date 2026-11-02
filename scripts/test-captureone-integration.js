const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.DATA_DIR = path.resolve(__dirname, '../data');

const db = require('../src/lib/db').default || require('../src/lib/db');
const { generateApiToken, hashApiToken } = require('../src/lib/auth');
const { processAndSavePhoto } = require('../src/lib/image');
const { deletePhotoFiles } = require('../src/lib/storage');

async function testFullIntegration() {
  console.log('--- Testing Full Capture One Integration Pipeline ---');

  // 1. Admin & Token
  const admin = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
  assert(admin, 'Admin must exist');

  const { rawToken, tokenHash } = generateApiToken();
  const tokenId = 'test-co-' + Date.now();
  db.prepare(`
    INSERT INTO api_tokens (id, admin_id, token_hash, label)
    VALUES (?, ?, ?, ?)
  `).run(tokenId, admin.id, tokenHash, 'Capture One E2E Test');
  console.log('✓ Created API token:', rawToken.slice(0, 16) + '...');

  // 2. Simulate gallery creation with Bearer auth
  const galleryId = 'test-co-gallery-' + Date.now();
  const slug = 'test-co-export-' + Date.now();
  db.prepare(`
    INSERT INTO galleries (id, slug, title, shoot_date, welcome_text, pin_code, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(galleryId, slug, 'Capture One Test Gallery', '2026-11-02', 'Welcome', '1234');
  console.log('✓ Created test gallery:', galleryId);

  // 3. Simulate photo processing pipeline (what /upload does upon receiving files from Capture One)
  // Create a minimal 100x100 JPEG buffer
  const sharp = require('sharp');
  const sampleJpg = await sharp({
    create: {
      width: 200,
      height: 150,
      channels: 3,
      background: { r: 120, g: 80, b: 200 }
    }
  }).jpeg().toBuffer();

  const processed = await processAndSavePhoto(galleryId, 'capture_one_export.jpg', sampleJpg);
  assert(processed.originalRelativePath, 'Original path must exist');
  assert(processed.thumbRelativePath, 'Thumb path must exist');
  assert(processed.previewRelativePath, 'Preview path must exist');
  console.log('✓ Sharp processed WebP thumb & preview:', processed.width, 'x', processed.height);

  const photoId = 'test-photo-' + Date.now();
  db.prepare(`
    INSERT INTO photos (
      id, gallery_id, filename, original_path, thumb_path, preview_path,
      width, height, aspect_ratio, file_size, order_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    photoId,
    galleryId,
    processed.filename,
    processed.originalRelativePath,
    processed.thumbRelativePath,
    processed.previewRelativePath,
    processed.width,
    processed.height,
    processed.aspectRatio,
    processed.fileSize
  );
  console.log('✓ Stored photo in SQLite database');

  // Verify DB state
  const photoRow = db.prepare('SELECT id, filename FROM photos WHERE id = ?').get(photoId);
  assert.strictEqual(photoRow.id, photoId);
  console.log('✓ Verified photo in database');

  // 4. Cleanup
  deletePhotoFiles(galleryId, processed.originalRelativePath, processed.thumbRelativePath, processed.previewRelativePath);
  db.prepare('DELETE FROM photos WHERE id = ?').run(photoId);
  db.prepare('DELETE FROM galleries WHERE id = ?').run(galleryId);
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(tokenId);
  console.log('✓ Cleaned up test files and DB records');

  console.log('--- All Capture One Pipeline Tests Succeeded! ---');
}

testFullIntegration().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

