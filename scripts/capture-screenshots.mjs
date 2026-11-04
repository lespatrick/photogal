import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_URL = 'http://localhost:3005';
const OUT_DIR = path.resolve(process.cwd(), 'docs/screenshots');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function optimizeAndSave(buffer, filename) {
  const targetPath = path.resolve(OUT_DIR, filename);
  // Compress PNG with sharp
  await sharp(buffer)
    .png({ quality: 90, compressionLevel: 8 })
    .toFile(targetPath);
  const stats = fs.statSync(targetPath);
  console.log(`Saved ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
}

async function run() {
  console.log('Launching Chrome for screenshot capture...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
      '--window-size=1440,960',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
  });

  // 1. PIN Gate
  console.log('Capturing: Client PIN Gate...');
  await page.goto(`${BASE_URL}/g/anna-i-piotr-slub`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 800));
  const pinGateBuf = await page.screenshot({ type: 'png' });
  await optimizeAndSave(pinGateBuf, 'client-pin-gate.png');

  // 2. Client Gallery (Unlocked)
  console.log('Unlocking client gallery...');
  const pinInput = await page.$('input[type="password"]');
  if (pinInput) {
    await pinInput.type('2026');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.client-gallery-page', { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    // Wait for images
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log('Capturing: Hero Client Gallery...');
  const heroBuf = await page.screenshot({ type: 'png' });
  await optimizeAndSave(heroBuf, 'hero-client-gallery.png');

  // 3. Client Lightbox
  console.log('Capturing: Client Lightbox...');
  const firstPhoto = await page.$('.masonry-item img');
  if (firstPhoto) {
    await firstPhoto.click();
    await page.waitForSelector('.lightbox-content, .lightbox-overlay', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 800));
    const lightboxBuf = await page.screenshot({ type: 'png' });
    await optimizeAndSave(lightboxBuf, 'client-lightbox.png');

    // Close lightbox
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 500));
  }

  // 4. Proofing Shield / Honeypot
  console.log('Capturing: Proofing Shield Honeypot...');
  await page.evaluate(() => {
    // Add trap-active class to demonstrate protection
    document.querySelector('.client-gallery-page')?.classList.add('trap-active');
  });
  await new Promise((r) => setTimeout(r, 800));
  const shieldBuf = await page.screenshot({ type: 'png' });
  await optimizeAndSave(shieldBuf, 'proofing-shield.png');

  // 5. Admin Dashboard
  console.log('Capturing: Admin Dashboard...');
  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  // Fill login
  const userInput = await page.$('input[type="text"]');
  const passInput = await page.$('input[type="password"]');
  if (userInput && passInput) {
    await userInput.type('admin');
    await passInput.type('admin123');
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
  }

  await page.evaluate(() => document.fonts.ready);
  const adminDashBuf = await page.screenshot({ type: 'png' });
  await optimizeAndSave(adminDashBuf, 'admin-dashboard.png');

  // 6. Admin Gallery & Export Modal
  console.log('Capturing: Admin Gallery Management & Export Modal...');
  await page.goto(`${BASE_URL}/admin/galleries/demo-gallery-id`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1000));

  // Open Export Modal
  const exportBtn = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find((b) => b.textContent?.includes('Eksportuj wybrane'));
  });

  if (exportBtn && exportBtn.asElement()) {
    await exportBtn.asElement().click();
    await page.waitForSelector('.modal-card', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 800));
  }

  const exportBuf = await page.screenshot({ type: 'png' });
  await optimizeAndSave(exportBuf, 'admin-gallery-export.png');

  await browser.close();
  console.log('All screenshots captured successfully!');
}

run().catch((err) => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});

