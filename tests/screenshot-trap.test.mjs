import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

describe('Screenshot Trap & Proofing Honeypot Test Suite', () => {
  test('Screenshot key chord detection algorithm correctly classifies screenshot attempts', () => {
    // Pure function extracting the keyboard logic used in useScreenshotTrap
    function isScreenshotAttempt(event) {
      if (event.key === 'PrintScreen') return true;

      const isMetaOrCtrl = Boolean(event.metaKey || event.ctrlKey);
      const isShift = Boolean(event.shiftKey);

      if (isMetaOrCtrl && isShift) {
        const screenshotKeys = ['3', '4', '5', '6', 's', 'S', 'Meta', 'Shift', 'Control'];
        const screenshotCodes = ['Digit3', 'Digit4', 'Digit5', 'Digit6', 'KeyS'];

        if (
          screenshotKeys.includes(event.key) ||
          (event.code && screenshotCodes.includes(event.code))
        ) {
          return true;
        }
      }

      // Print shortcut
      if (isMetaOrCtrl && (event.key === 'p' || event.key === 'P' || event.code === 'KeyP')) {
        return true;
      }

      return false;
    }

    // 1. Windows / Linux PrintScreen key
    assert.equal(isScreenshotAttempt({ key: 'PrintScreen' }), true, 'PrintScreen must trigger trap');

    // 2. macOS Cmd + Shift + 3 / 4 / 5 / 6
    assert.equal(isScreenshotAttempt({ metaKey: true, shiftKey: true, key: '3' }), true, 'Cmd+Shift+3 must trigger trap');
    assert.equal(isScreenshotAttempt({ metaKey: true, shiftKey: true, key: '4' }), true, 'Cmd+Shift+4 must trigger trap');
    assert.equal(isScreenshotAttempt({ metaKey: true, shiftKey: true, key: '5' }), true, 'Cmd+Shift+5 must trigger trap');
    assert.equal(isScreenshotAttempt({ metaKey: true, shiftKey: true, code: 'Digit4' }), true, 'Cmd+Shift+Digit4 must trigger trap');

    // 3. Early modifier capture: Holding Cmd + Shift
    assert.equal(isScreenshotAttempt({ metaKey: true, shiftKey: true, key: 'Shift' }), true, 'Cmd+Shift modifier hold must trigger trap preemptively');
    assert.equal(isScreenshotAttempt({ metaKey: true, shiftKey: true, key: 'Meta' }), true, 'Shift+Cmd modifier hold must trigger trap preemptively');

    // 4. Windows Snipping Tool (Win + Shift + S or Ctrl + Shift + S)
    assert.equal(isScreenshotAttempt({ metaKey: true, shiftKey: true, key: 's' }), true, 'Win+Shift+S must trigger trap');
    assert.equal(isScreenshotAttempt({ ctrlKey: true, shiftKey: true, key: 's' }), true, 'Ctrl+Shift+S must trigger trap');
    assert.equal(isScreenshotAttempt({ ctrlKey: true, shiftKey: true, code: 'KeyS' }), true, 'Ctrl+Shift+KeyS must trigger trap');

    // 5. Print dialog (Cmd+P or Ctrl+P)
    assert.equal(isScreenshotAttempt({ metaKey: true, key: 'p' }), true, 'Cmd+P must trigger trap');
    assert.equal(isScreenshotAttempt({ ctrlKey: true, key: 'P' }), true, 'Ctrl+P must trigger trap');

    // 6. Normal gallery browsing keys must NOT trigger trap
    assert.equal(isScreenshotAttempt({ key: 'ArrowRight' }), false, 'Arrow navigation must not trigger trap');
    assert.equal(isScreenshotAttempt({ key: 'ArrowLeft' }), false, 'Arrow navigation must not trigger trap');
    assert.equal(isScreenshotAttempt({ key: ' ' }), false, 'Spacebar must not trigger trap');
    assert.equal(isScreenshotAttempt({ key: 'f' }), false, 'F key must not trigger trap');
    assert.equal(isScreenshotAttempt({ key: 'Escape' }), false, 'Escape must not trigger trap');
    assert.equal(isScreenshotAttempt({ ctrlKey: true, key: 'c' }), false, 'Ctrl+C alone must not trigger trap');
  });

  test('ProofingShield component exports required decoy and print components', () => {
    const shieldFile = fs.readFileSync(path.resolve('src/components/ProofingShield.tsx'), 'utf-8');
    assert.ok(shieldFile.includes('export function ProofingDecoyLightbox'), 'ProofingDecoyLightbox must be exported');
    assert.ok(shieldFile.includes('export function ProofingDecoyGrid'), 'ProofingDecoyGrid must be exported');
    assert.ok(shieldFile.includes('export function PrintProofingNotice'), 'PrintProofingNotice must be exported');
    assert.ok(shieldFile.includes('Podgląd Autorski'), 'Must contain editorial Polish studio title');
    assert.ok(shieldFile.includes('proofing-watermark-pattern'), 'Must include SVG watermark pattern element');
  });

  test('globals.css defines screenshot trap obfuscation filters and print media protection', () => {
    const css = fs.readFileSync(path.resolve('src/app/globals.css'), 'utf-8');
    assert.ok(css.includes('.trap-active .masonry-item img'), 'Must style masonry images during trap');
    assert.ok(css.includes('.trap-active .lightbox-image'), 'Must style lightbox image during trap');
    assert.ok(css.includes('blur('), 'Must apply blur filter during trap');
    assert.ok(css.includes('proofing-decoy-grid'), 'Must define decoy grid overlay');
    assert.ok(css.includes('proofing-decoy-lightbox'), 'Must define decoy lightbox overlay');
    assert.ok(css.includes('@media print'), 'Must define print media protection');
    assert.ok(css.includes('.print-proofing-notice'), 'Must define print notice style');
  });

  test('Client gallery page integrates useScreenshotTrap, decoy overlays, and print notice', () => {
    const pageFile = fs.readFileSync(path.resolve('src/app/g/[slug]/page.tsx'), 'utf-8');
    assert.ok(pageFile.includes('useScreenshotTrap'), 'Must invoke useScreenshotTrap hook');
    assert.ok(pageFile.includes('ProofingDecoyLightbox'), 'Must render ProofingDecoyLightbox');
    assert.ok(pageFile.includes('ProofingDecoyGrid'), 'Must render ProofingDecoyGrid');
    assert.ok(pageFile.includes('PrintProofingNotice'), 'Must render PrintProofingNotice');
    assert.ok(pageFile.includes('trap-active'), 'Must toggle trap-active class');
  });
});

