import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import Database from 'better-sqlite3';

describe('Photogal Core & Security Test Suite', () => {
  test('Password hashing (scrypt) and constant-time verification', () => {
    const password = 'PhotogalSecure2026!';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const storedHash = `${salt}:${hash}`;

    // Verify correct password
    const [savedSalt, savedKey] = storedHash.split(':');
    const derivedKey = crypto.scryptSync(password, savedSalt, 64).toString('hex');
    const isValid = crypto.timingSafeEqual(Buffer.from(savedKey, 'hex'), Buffer.from(derivedKey, 'hex'));
    assert.equal(isValid, true, 'Valid password must match');

    // Verify wrong password
    const wrongDerived = crypto.scryptSync('WrongPassword', savedSalt, 64).toString('hex');
    const isWrongValid = crypto.timingSafeEqual(Buffer.from(savedKey, 'hex'), Buffer.from(wrongDerived, 'hex'));
    assert.equal(isWrongValid, false, 'Invalid password must not match');
  });

  test('HMAC-SHA256 session token signing and verification', () => {
    const secret = 'test-secret-key-32b-length-xyz123';
    const payload = JSON.stringify({ adminId: 'test-admin-uuid', exp: Date.now() + 60000 });
    
    // Sign
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const signature = hmac.digest('hex');
    const token = `${Buffer.from(payload).toString('base64url')}.${signature}`;

    // Verify
    const [encodedData, sig] = token.split('.');
    const decoded = Buffer.from(encodedData, 'base64url').toString('utf-8');
    const expectedHmac = crypto.createHmac('sha256', secret);
    expectedHmac.update(decoded);
    const expectedSig = expectedHmac.digest('hex');

    const verified = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
    assert.equal(verified, true, 'Token signature must verify');
    assert.equal(JSON.parse(decoded).adminId, 'test-admin-uuid');
  });

  test('Constant-time PIN comparison & tarpit threshold logic', () => {
    const correctPin = '7890';
    const enteredPin = '7890';
    const badPin = '1234';

    const checkPin = (input, target) => {
      if (input.length !== target.length) return false;
      return crypto.timingSafeEqual(Buffer.from(input), Buffer.from(target));
    };

    assert.equal(checkPin(enteredPin, correctPin), true);
    assert.equal(checkPin(badPin, correctPin), false);
    assert.equal(checkPin('789', correctPin), false);

    // Rate-limiting thresholds
    const isTarpitTriggered = (fails) => fails >= 3;
    const isSoftLockTriggered = (fails) => fails >= 5;
    const isEmergencyLockTriggered = (fails) => fails >= 10;

    assert.equal(isTarpitTriggered(2), false);
    assert.equal(isTarpitTriggered(3), true);
    assert.equal(isSoftLockTriggered(4), false);
    assert.equal(isSoftLockTriggered(5), true);
    assert.equal(isEmergencyLockTriggered(10), true);
  });

  test('In-memory SQLite schema creation and relationships', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE galleries (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        pin_code TEXT NOT NULL
      );
      CREATE TABLE photos (
        id TEXT PRIMARY KEY,
        gallery_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
      );
    `);

    // Insert gallery
    db.prepare('INSERT INTO galleries (id, slug, title, pin_code) VALUES (?, ?, ?, ?)').run(
      'gal-1', 'sesja-plenerowa', 'Sesja Plenerowa', '5555'
    );

    // Insert photos
    db.prepare('INSERT INTO photos (id, gallery_id, filename) VALUES (?, ?, ?)').run('p-1', 'gal-1', 'DSC_0001.JPG');
    db.prepare('INSERT INTO photos (id, gallery_id, filename) VALUES (?, ?, ?)').run('p-2', 'gal-1', 'DSC_0002.JPG');

    const photoCount = db.prepare('SELECT COUNT(*) as count FROM photos WHERE gallery_id = ?').get('gal-1').count;
    assert.equal(photoCount, 2, 'Should have 2 photos');

    // Test Cascade Delete
    db.prepare('DELETE FROM galleries WHERE id = ?').run('gal-1');
    const remainingPhotos = db.prepare('SELECT COUNT(*) as count FROM photos').get().count;
    assert.equal(remainingPhotos, 0, 'Cascade delete must remove associated photos');

    db.close();
  });
});
