import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import util from 'util';
import path from 'path';
import Database from 'better-sqlite3';

const scryptAsync = util.promisify(crypto.scrypt);

describe('Photogal Core & Security Test Suite', () => {
  test('Password hashing (async scrypt) and constant-time verification', async () => {
    const password = 'PhotogalSecure2026!';
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await scryptAsync(password, salt, 64);
    const storedHash = `${salt}:${derivedKey.toString('hex')}`;

    // Verify correct password
    const [savedSalt, savedKey] = storedHash.split(':');
    const verifyDerived = await scryptAsync(password, savedSalt, 64);
    const keyBuf = Buffer.from(savedKey, 'hex');
    const isValid = keyBuf.length === verifyDerived.length && crypto.timingSafeEqual(keyBuf, verifyDerived);
    assert.equal(isValid, true, 'Valid password must match');

    // Verify wrong password
    const wrongDerived = await scryptAsync('WrongPassword', savedSalt, 64);
    const isWrongValid = keyBuf.length === wrongDerived.length && crypto.timingSafeEqual(keyBuf, wrongDerived);
    assert.equal(isWrongValid, false, 'Invalid password must not match');
  });

  test('HMAC-SHA256 session token signing, verification & tampering rejection', () => {
    const secret = 'test-secret-key-32b-length-xyz123';
    const payload = JSON.stringify({ adminId: 'test-admin-uuid', exp: Date.now() + 60000 });
    
    // Sign
    const sign = (data) => {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(data);
      return `${Buffer.from(data).toString('base64url')}.${hmac.digest('hex')}`;
    };

    const verify = (token) => {
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [encoded, sig] = parts;
      const data = Buffer.from(encoded, 'base64url').toString('utf-8');
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(data);
      const expected = hmac.digest('hex');
      const sigBuf = Buffer.from(sig, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
      return JSON.parse(data);
    };

    const token = sign(payload);
    const verified = verify(token);
    assert.equal(verified.adminId, 'test-admin-uuid');

    // Tampered token payload
    const tamperedPayload = Buffer.from(JSON.stringify({ adminId: 'attacker', exp: Date.now() + 60000 })).toString('base64url');
    const tamperedToken = `${tamperedPayload}.${token.split('.')[1]}`;
    assert.equal(verify(tamperedToken), null, 'Tampered token must be rejected');

    // Malformed signature length
    assert.equal(verify(`${token.split('.')[0]}.1234`), null, 'Malformed signature length must be rejected safely');
  });

  test('Storage path traversal containment (safe storage path resolution)', () => {
    const fakeStorage = '/app/storage';

    const resolveSafe = (baseDir, relPath) => {
      if (!relPath || typeof relPath !== 'string') return null;
      const cleanRel = path.normalize(relPath).replace(/^(\.\.[\/\\]|[/\\])+/, '');
      const fullPath = path.resolve(baseDir, cleanRel);
      const normalizedBase = path.resolve(baseDir);
      if (!fullPath.startsWith(normalizedBase + path.sep) && fullPath !== normalizedBase) {
        return null;
      }
      return fullPath;
    };

    // Valid relative path
    const valid = resolveSafe(fakeStorage, 'galleries/gal-1/thumb/img.webp');
    assert.equal(valid, path.resolve(fakeStorage, 'galleries/gal-1/thumb/img.webp'));

    // Path traversal attempt with ../
    const escapeAttempt = resolveSafe(fakeStorage, '../../etc/passwd');
    assert.ok(escapeAttempt.startsWith(fakeStorage), 'Must never escape base storage directory');

    // Absolute path injection attempt
    const absAttempt = resolveSafe(fakeStorage, '/data/photogal.db');
    assert.ok(absAttempt.startsWith(fakeStorage), 'Absolute path must be sanitized to stay inside storage');
  });

  test('Server-side selection package ceiling (max_selections) enforcement', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE galleries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        max_selections INTEGER DEFAULT 0
      );
      CREATE TABLE selections (
        id TEXT PRIMARY KEY,
        gallery_id TEXT NOT NULL,
        photo_id TEXT NOT NULL,
        UNIQUE(gallery_id, photo_id)
      );
    `);

    db.prepare('INSERT INTO galleries (id, title, max_selections) VALUES (?, ?, ?)').run('gal-pkg', 'Wedding 15', 2);

    const tryAddSelection = (galleryId, photoId) => {
      const gallery = db.prepare('SELECT max_selections FROM galleries WHERE id = ?').get(galleryId);
      const count = db.prepare('SELECT COUNT(*) as count FROM selections WHERE gallery_id = ?').get(galleryId).count;
      if (gallery.max_selections > 0 && count >= gallery.max_selections) {
        return { success: false, error: 'Limit reached' };
      }
      db.prepare('INSERT INTO selections (id, gallery_id, photo_id) VALUES (?, ?, ?)').run(crypto.randomUUID(), galleryId, photoId);
      return { success: true };
    };

    assert.equal(tryAddSelection('gal-pkg', 'photo-1').success, true);
    assert.equal(tryAddSelection('gal-pkg', 'photo-2').success, true);
    // Exceeding 2
    const thirdAttempt = tryAddSelection('gal-pkg', 'photo-3');
    assert.equal(thirdAttempt.success, false);
    assert.equal(thirdAttempt.error, 'Limit reached');

    db.close();
  });

  test('ZIP file entry name deduplication logic', () => {
    const rawFiles = ['DSC_0001.JPG', 'DSC_0002.JPG', 'DSC_0001.JPG', 'DSC_0001.JPG'];
    const tracker = new Map();
    const resultNames = [];

    for (const filename of rawFiles) {
      let entryName = filename;
      const count = tracker.get(filename) || 0;
      if (count > 0) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        entryName = `${base}_${count + 1}${ext}`;
      }
      tracker.set(filename, count + 1);
      resultNames.push(entryName);
    }

    assert.deepEqual(resultNames, [
      'DSC_0001.JPG',
      'DSC_0002.JPG',
      'DSC_0001_2.JPG',
      'DSC_0001_3.JPG'
    ]);
  });

  test('Session token version invalidation (revocation on password change)', () => {
    const adminId = 'admin-123';
    let currentTokenVersion = 1;

    const createPayload = (version) => JSON.stringify({
      adminId,
      tokenVersion: version,
      exp: Date.now() + 60000,
    });

    const sessionA = JSON.parse(createPayload(currentTokenVersion));
    assert.equal(sessionA.tokenVersion, 1);

    // Password changed -> token_version incremented
    currentTokenVersion = 2;

    const validateSession = (payload) => {
      if (payload.tokenVersion !== currentTokenVersion) {
        return false; // Revoked
      }
      return true;
    };

    assert.equal(validateSession(sessionA), false, 'Old session token must be revoked');
    const sessionB = JSON.parse(createPayload(currentTokenVersion));
    assert.equal(validateSession(sessionB), true, 'Fresh session token must be accepted');
  });

  test('Media path validation strictly restricts access to galleries 4-part structure', () => {
    const isValidMediaPath = (segments) => {
      if (!segments || segments.length !== 4 || segments[0] !== 'galleries') {
        return false;
      }
      const mediaType = segments[2];
      return ['thumb', 'preview', 'original'].includes(mediaType);
    };

    assert.equal(isValidMediaPath(['galleries', 'gal-1', 'thumb', 'photo.webp']), true);
    assert.equal(isValidMediaPath(['galleries', 'gal-1', 'preview', 'photo.webp']), true);
    assert.equal(isValidMediaPath(['galleries', 'gal-1', 'original', 'photo.jpg']), true);

    // Rejections
    assert.equal(isValidMediaPath(['backups', 'database.sqlite']), false);
    assert.equal(isValidMediaPath(['galleries', 'gal-1', 'secrets.env']), false);
    assert.equal(isValidMediaPath(['galleries', 'gal-1']), false);
    assert.equal(isValidMediaPath(['galleries', 'gal-1', 'thumb']), false);
    assert.equal(isValidMediaPath(['galleries', 'gal-1', 'thumb', 'nested', 'photo.webp']), false);
  });
});

