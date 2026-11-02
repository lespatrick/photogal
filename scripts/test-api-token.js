const assert = require('assert');
const path = require('path');

// Set up environment if needed
process.env.DATA_DIR = path.resolve(__dirname, '../data');

// Import db and auth modules
const db = require('../src/lib/db').default || require('../src/lib/db');
const { generateApiToken, hashApiToken } = require('../src/lib/auth');

async function runTests() {
  console.log('--- Testing API Token Flow ---');

  // Find admin ID
  const admin = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
  assert(admin, 'Admin account should exist');
  console.log('✓ Found admin account:', admin.id);

  // Generate API token
  const { rawToken, tokenHash } = generateApiToken();
  assert(rawToken.startsWith('pg_live_'), 'Token should start with pg_live_');
  assert.strictEqual(hashApiToken(rawToken), tokenHash, 'Hash function should match generated tokenHash');
  console.log('✓ Generated token:', rawToken.slice(0, 16) + '...');

  // Insert into api_tokens
  const tokenId = 'test-token-' + Date.now();
  db.prepare(`
    INSERT INTO api_tokens (id, admin_id, token_hash, label)
    VALUES (?, ?, ?, ?)
  `).run(tokenId, admin.id, tokenHash, 'Test Capture One Token');
  console.log('✓ Inserted test token into database');

  // Verify lookup
  const tokenRow = db.prepare('SELECT id, admin_id, last_used_at FROM api_tokens WHERE token_hash = ?').get(tokenHash);
  assert(tokenRow, 'Token must be queryable by hash');
  assert.strictEqual(tokenRow.admin_id, admin.id, 'Token admin_id must match');
  console.log('✓ Successfully retrieved token from SQLite');

  // Update last_used_at
  db.prepare("UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(tokenId);
  const updatedRow = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(tokenId);
  assert(updatedRow.last_used_at !== null, 'last_used_at should be updated');
  console.log('✓ last_used_at updated:', updatedRow.last_used_at);

  // Clean up
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(tokenId);
  const deletedRow = db.prepare('SELECT id FROM api_tokens WHERE id = ?').get(tokenId);
  assert(!deletedRow, 'Token should be deleted');
  console.log('✓ Successfully cleaned up test token');

  console.log('--- All API Token Tests Passed! ---');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

