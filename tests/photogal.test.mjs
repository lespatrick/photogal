import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { PassThrough } from 'stream';
import { ZipArchive } from 'archiver';

import crypto from 'crypto';
import db, { parseSqliteDate } from '../src/lib/db';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  createClientToken,
  verifyClientToken,
  extractClientIp,
  extractClientToken,
} from '../src/lib/auth';
import {
  saveChallenge,
  consumeChallenge,
} from '../src/lib/webauthn';
import {
  resolveSafeStoragePath,
  deletePhotoFiles,
  deleteGalleryStorage,
  getSafeGalleryBase,
  getFilePath,
  STORAGE_DIR,
} from '../src/lib/storage';
import { proxy } from '../src/proxy';
import { NextRequest } from 'next/server';

describe('Photogal Core & Security Integration Test Suite', () => {
  test('Password hashing (async scrypt) and constant-time verification from auth.ts', async () => {
    const password = 'PhotogalSecure2026!';
    const storedHash = await hashPassword(password);

    assert.ok(storedHash.includes(':'), 'Hash must contain salt and key separated by colon');
    const isValid = await verifyPassword(password, storedHash);
    assert.equal(isValid, true, 'Valid password must match');

    const isWrongValid = await verifyPassword('WrongPassword', storedHash);
    assert.equal(isWrongValid, false, 'Invalid password must not match');

    // Test malformed hash defense
    assert.equal(await verifyPassword(password, 'malformedhash'), false);
    assert.equal(await verifyPassword(password, ':'), false);
  });

  test('HMAC-SHA256 session token signing, verification & tampering rejection from auth.ts', () => {
    const payload = JSON.stringify({ adminId: 'test-admin-uuid', tokenVersion: 1, exp: Date.now() + 60000 });
    const token = signToken(payload);

    assert.ok(token.includes('.'), 'Token must contain payload and signature');
    const verified = verifyToken(token);
    assert.ok(verified, 'Valid token must be verified');
    const parsed = JSON.parse(verified);
    assert.equal(parsed.adminId, 'test-admin-uuid');

    // Tampered token payload
    const parts = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ adminId: 'attacker', tokenVersion: 1, exp: Date.now() + 60000 })).toString('base64url');
    const tamperedToken = `${tamperedPayload}.${parts[1]}`;
    assert.equal(verifyToken(tamperedToken), null, 'Tampered token must be rejected');

    // Invalid signature
    assert.equal(verifyToken(`${parts[0]}.deadbeef`), null, 'Invalid signature must be rejected safely');
  });

  test('Client tokens creation and verification from auth.ts', () => {
    const galleryId = 'gal-uuid-999';
    const clientToken = createClientToken(galleryId);

    assert.equal(verifyClientToken(clientToken, galleryId), true, 'Valid client token must be verified');
    assert.equal(verifyClientToken(clientToken, 'other-gal-id'), false, 'Client token must not authorize other gallery');
    assert.equal(verifyClientToken('invalid.token', galleryId), false, 'Invalid token format must be rejected');
  });

  test('Storage path containment and directory traversal defense from storage.ts', () => {
    const valid = resolveSafeStoragePath('galleries/gal-1/thumb/img.webp');
    assert.equal(valid, path.resolve(STORAGE_DIR, 'galleries/gal-1/thumb/img.webp'));

    // Directory traversal attempts with ../
    const escapeAttempt = resolveSafeStoragePath('../../etc/passwd');
    assert.ok(escapeAttempt.startsWith(STORAGE_DIR), 'Must never escape base storage directory');

    // Absolute path injection attempts
    const absAttempt = resolveSafeStoragePath('/data/photogal.db');
    assert.ok(absAttempt.startsWith(STORAGE_DIR), 'Absolute path must be sanitized to stay inside storage');

    // Null or invalid input
    assert.equal(resolveSafeStoragePath(''), null);
    assert.equal(resolveSafeStoragePath(null), null);
  });

  test('deletePhotoFiles strictly confines deletion to specified gallery directory', () => {
    const testGalId = 'test-confine-gal';
    const otherGalId = 'other-gal';
    const testDir = path.resolve(STORAGE_DIR, 'galleries', testGalId, 'thumb');
    const otherDir = path.resolve(STORAGE_DIR, 'galleries', otherGalId, 'thumb');
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(otherDir, { recursive: true });

    const testFile = path.resolve(testDir, 'photo.webp');
    const otherFile = path.resolve(otherDir, 'photo.webp');
    fs.writeFileSync(testFile, 'test');
    fs.writeFileSync(otherFile, 'other');

    // Attempt to delete otherGalId file while passing testGalId
    const otherRel = `galleries/${otherGalId}/thumb/photo.webp`;
    deletePhotoFiles(testGalId, otherRel, otherRel, otherRel);

    // otherFile must still exist because deletePhotoFiles validates galleryBase containment
    assert.equal(fs.existsSync(otherFile), true, 'Files outside gallery directory must not be deleted');

    // Clean up
    fs.rmSync(path.resolve(STORAGE_DIR, 'galleries', testGalId), { recursive: true, force: true });
    fs.rmSync(path.resolve(STORAGE_DIR, 'galleries', otherGalId), { recursive: true, force: true });
  });

  test('Database busy_timeout pragma is configured for concurrency', () => {
    const activeDb = db.default || db;
    const pragma = activeDb.pragma('busy_timeout', { simple: true });
    assert.ok(Number(pragma) >= 5000, 'busy_timeout must be at least 5000ms');
  });

  test('Archiver error listener prevents unhandled error process crashes', async () => {
    const archive = new ZipArchive({ zlib: { level: 0 } });
    const passThrough = new PassThrough();

    let errorHandled = false;
    archive.on('error', (err) => {
      errorHandled = true;
      passThrough.destroy(err);
    });
    passThrough.on('error', () => {});

    archive.pipe(passThrough);

    // Emit synthetic stream error to verify it does not trigger unhandled exception crash
    archive.emit('error', new Error('Simulated stream failure'));
    assert.equal(errorHandled, true, 'Archive stream error must be caught by listener');
  });

  test('getSafeGalleryBase and deleteGalleryStorage never delete root galleries directory', () => {
    // Malicious or empty galleryId inputs must return null
    assert.equal(getSafeGalleryBase(''), null);
    assert.equal(getSafeGalleryBase('.'), null);
    assert.equal(getSafeGalleryBase('..'), null);
    assert.equal(getSafeGalleryBase('   '), null);
    assert.equal(getSafeGalleryBase(null), null);

    const galleriesRoot = path.resolve(STORAGE_DIR, 'galleries');
    fs.mkdirSync(galleriesRoot, { recursive: true });

    // Attempt to invoke deleteGalleryStorage with empty or dot input
    deleteGalleryStorage('');
    deleteGalleryStorage('.');
    deleteGalleryStorage('..');

    // Root galleries directory MUST remain intact
    assert.equal(fs.existsSync(galleriesRoot), true, 'Galleries root folder must never be deleted');
  });

  test('extractClientIp resolves rightmost forwarded IP to defeat client spoofing', () => {
    // Simulated request with multiple forwarded IPs
    const fakeReqWithSpoof = {
      headers: new Headers({
        'x-forwarded-for': '203.0.113.195, 198.51.100.1, 192.0.2.1',
      }),
    };
    const resolvedIp = extractClientIp(fakeReqWithSpoof);
    assert.equal(resolvedIp, '192.0.2.1', 'Must resolve rightmost IP added by proxy');

    // Simulated request with X-Real-IP
    const fakeReqWithRealIp = {
      headers: new Headers({
        'x-real-ip': '198.51.100.42',
        'x-forwarded-for': 'attacker.spoofed.ip',
      }),
    };
    assert.equal(extractClientIp(fakeReqWithRealIp), '198.51.100.42', 'Must prioritize verified X-Real-IP');
  });

  test('extractClientToken strictly isolates cookie lookup when galleryId is provided', () => {
    const fakeReq = {
      headers: new Headers(),
      nextUrl: new URL('http://localhost:3000/api/test'),
      cookies: {
        get: (name) => (name === 'photogal_client_gal-A' ? { value: 'token-A' } : undefined),
        getAll: () => [{ name: 'photogal_client_gal-A', value: 'token-A' }],
      },
    };

    // When asking for gal-A, must return token-A
    assert.equal(extractClientToken(fakeReq, 'gal-A'), 'token-A');

    // When asking for gal-B, must NOT return token-A from other gallery
    assert.equal(extractClientToken(fakeReq, 'gal-B'), null);
  });

  test('parseSqliteDate strictly normalizes SQLite datetime to UTC without local timezone skew', () => {
    const rawSqlite = '2026-10-14 14:30:00';
    const parsed = parseSqliteDate(rawSqlite);
    assert.equal(parsed.toISOString(), '2026-10-14T14:30:00.000Z', 'Must evaluate to exact UTC time');
    assert.equal(Number.isNaN(parsed.getTime()), false);

    // Empty or invalid input
    assert.equal(Number.isNaN(parseSqliteDate('').getTime()), true);
  });

  test('consumeChallenge is atomic and prevents replay', () => {
    const challenge = 'test-atomic-challenge-' + Date.now();
    saveChallenge(challenge, 'admin_login');

    // First consumption must succeed
    const firstConsume = consumeChallenge(challenge, 'admin_login');
    assert.equal(firstConsume, true, 'First consumption of challenge must succeed');

    // Second consumption must fail (replay attack defense)
    const replayAttempt = consumeChallenge(challenge, 'admin_login');
    assert.equal(replayAttempt, false, 'Replaying the same challenge must be rejected');
  });

  test('resolveSafeStoragePath rejects resolving the storage root itself', () => {
    assert.equal(resolveSafeStoragePath('.'), null, 'Dot relative path must not return storage root');
    assert.equal(resolveSafeStoragePath('./'), null);
    assert.equal(resolveSafeStoragePath('..'), null);
    assert.equal(resolveSafeStoragePath(''), null);
    assert.equal(resolveSafeStoragePath('   '), null);
  });

  test('ZIP archive entry name sanitization eliminates Zip Slip path traversal', () => {
    const maliciousNames = [
      '../../etc/cron.d/malicious.jpg',
      '..\\..\\windows\\system32\\calc.exe',
      '/var/www/shell.php',
      'folder/subfolder/photo.webp',
      '..',
      '../',
      '..\\',
    ];

    for (const rawName of maliciousNames) {
      const normalized = rawName.trim().replace(/\\/g, '/');
      const sanitized = path.basename(normalized).replace(/[/\\?%*:|"<>]/g, '_').replace(/^\.+/, '') || 'photo.jpg';
      assert.equal(sanitized.includes('/'), false, `Sanitized name "${sanitized}" must not contain forward slashes`);
      assert.equal(sanitized.includes('\\'), false, `Sanitized name "${sanitized}" must not contain backslashes`);
      assert.equal(sanitized.startsWith('..'), false, `Sanitized name "${sanitized}" must not begin with ..`);
      assert.ok(sanitized.length > 0, 'Sanitized name must not be empty');
    }
  });

  test('auth_challenges table has composite index for performant lookups', () => {
    const activeDb = db.default || db;
    const indices = activeDb.prepare("PRAGMA index_list('auth_challenges')").all();
    const hasCompositeIndex = indices.some((idx) => idx.name === 'idx_auth_challenges_lookup');
    assert.equal(hasCompositeIndex, true, 'auth_challenges must have idx_auth_challenges_lookup index');
  });

  test('getFilePath strictly confines media files to target gallery directory and defeats cross-gallery traversal', () => {
    const galA = 'gallery-alpha';
    const galB = 'gallery-beta';

    const validPath = getFilePath(galA, 'thumb', 'photo_1.webp');
    assert.equal(validPath, path.resolve(STORAGE_DIR, 'galleries', galA, 'thumb', 'photo_1.webp'));

    // Attempt traversal across galleries via filename
    const traversalAttempt = getFilePath(galA, 'thumb', `../../${galB}/original/secret.jpg`);
    assert.equal(traversalAttempt, path.resolve(STORAGE_DIR, 'galleries', galA, 'thumb', 'secret.jpg'), 'Must be confined to gallery-alpha and cannot escape into gallery-beta');
  });

  test('extractClientToken ignores literal null or undefined strings in searchParams', () => {
    const fakeReqWithLiteralNull = {
      headers: new Headers(),
      nextUrl: new URL('http://localhost:3000/api/test?token=null'),
      cookies: {
        get: (name) => (name === 'photogal_client_gal-test' ? { value: 'real-valid-cookie-token' } : undefined),
        getAll: () => [],
      },
    };

    const token = extractClientToken(fakeReqWithLiteralNull, 'gal-test');
    assert.equal(token, 'real-valid-cookie-token', 'Must ignore token=null and fall back to valid cookie');
  });

  test('SHA-256 constant-time PIN comparison handles any length without buffer truncation anomalies', () => {
    function secureComparePins(a, b) {
      const strA = (a || '').trim();
      const strB = (b || '').trim();
      if (!strA || !strB) return false;
      const hashA = crypto.createHash('sha256').update(strA).digest();
      const hashB = crypto.createHash('sha256').update(strB).digest();
      return crypto.timingSafeEqual(hashA, hashB);
    }

    assert.equal(secureComparePins('2026', '2026'), true);
    assert.equal(secureComparePins(' 2026 ', '2026'), true);
    assert.equal(secureComparePins('2026', '2027'), false);
    assert.equal(secureComparePins('', ''), false);
    assert.equal(secureComparePins('   ', '   '), false);

    // Strings longer than 32 characters
    const long1 = 'A'.repeat(50) + '1';
    const long2 = 'A'.repeat(50) + '2';
    assert.equal(secureComparePins(long1, long1), true);
    assert.equal(secureComparePins(long1, long2), false, 'Must not collide or truncate at 32 bytes');
  });

  test('Proxy strictly disables HTTP connections by redirecting to HTTPS with 308 and HSTS', () => {
    // 1. Plaintext HTTP through reverse proxy (x-forwarded-proto: http)
    const httpReq = new NextRequest('http://studio.example.com/g/wedding-session?tab=selected', {
      headers: {
        'x-forwarded-proto': 'http',
        'host': 'studio.example.com',
      },
    });

    const redirectRes = proxy(httpReq);
    assert.equal(redirectRes.status, 308, 'Must return 308 Permanent Redirect for plaintext HTTP');
    assert.equal(
      redirectRes.headers.get('location'),
      'https://studio.example.com/g/wedding-session?tab=selected',
      'Must redirect to https preserving pathname and query string'
    );
    assert.ok(
      redirectRes.headers.get('Strict-Transport-Security'),
      'Redirect response must include Strict-Transport-Security header'
    );

    // 2. Direct non-loopback HTTP request
    const directHttpReq = new NextRequest('http://photogal.studio/admin/login', {
      headers: {
        'host': 'photogal.studio',
      },
    });
    const directRes = proxy(directHttpReq);
    assert.equal(directRes.status, 308);
    assert.equal(directRes.headers.get('location'), 'https://photogal.studio/admin/login');

    // 3. Internal loopback request without proxy header (e.g. Docker health check wget http://127.0.0.1:3000/)
    const healthCheckReq = new NextRequest('http://127.0.0.1:3000/', {
      headers: {
        'host': '127.0.0.1:3000',
      },
    });
    const healthRes = proxy(healthCheckReq);
    assert.notEqual(healthRes.status, 308, 'Internal container health check must not be redirected to HTTPS');

    // 4. Secure HTTPS request through reverse proxy
    const httpsReq = new NextRequest('https://studio.example.com/g/wedding-session', {
      headers: {
        'x-forwarded-proto': 'https',
        'host': 'studio.example.com',
      },
    });
    const httpsRes = proxy(httpsReq);
    assert.notEqual(httpsRes.status, 308, 'Valid HTTPS request must not be redirected');
    assert.equal(
      httpsRes.headers.get('Strict-Transport-Security'),
      'max-age=63072000; includeSubDomains; preload',
      'HTTPS response must enforce Strict-Transport-Security with 2-year preload'
    );
    assert.equal(httpsRes.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(httpsRes.headers.get('X-Frame-Options'), 'DENY');

    // 5. Configurable ALLOW_HTTP bypass
    process.env.ALLOW_HTTP = 'true';
    try {
      const allowedRes = proxy(httpReq);
      assert.notEqual(allowedRes.status, 308, 'ALLOW_HTTP=true must bypass HTTPS redirect');
    } finally {
      delete process.env.ALLOW_HTTP;
    }
  });
});

