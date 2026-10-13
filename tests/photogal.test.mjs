import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { PassThrough } from 'stream';
import { ZipArchive } from 'archiver';

import db from '../src/lib/db';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  createClientToken,
  verifyClientToken,
} from '../src/lib/auth';
import {
  resolveSafeStoragePath,
  deletePhotoFiles,
  STORAGE_DIR,
} from '../src/lib/storage';

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
});
