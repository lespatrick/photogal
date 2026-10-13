import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { createClientToken, getAuthSecret } from '@/lib/auth';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const list = forwarded.split(',').map(s => s.trim()).filter(Boolean);
    if (list.length > 0) return list[0].replace(/[^a-fA-F0-9:.]/g, '').substring(0, 45);
  }
  const realIp = req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip');
  if (realIp) return realIp.trim().replace(/[^a-fA-F0-9:.]/g, '').substring(0, 45);
  return '127.0.0.1';
}

function secureComparePins(a: string, b: string): boolean {
  const strA = (a || '').trim();
  const strB = (b || '').trim();
  const maxLen = 32;
  const bufA = Buffer.alloc(maxLen, 0);
  const bufB = Buffer.alloc(maxLen, 0);
  bufA.write(strA);
  bufB.write(strB);
  const isMatch = crypto.timingSafeEqual(bufA, bufB);
  return isMatch && strA.length === strB.length;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const { pin } = await req.json();

    if (!pin) {
      return NextResponse.json({ error: 'Podaj kod PIN' }, { status: 400 });
    }

    const gallery = db.prepare(`
      SELECT id, slug, pin_code, title, pin_locked_until 
      FROM galleries 
      WHERE slug = ?
    `).get(slug) as {
      id: string;
      slug: string;
      pin_code: string;
      title: string;
      pin_locked_until: string | null;
    } | undefined;

    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie została odnaleziona' }, { status: 404 });
    }

    // 1. Check if gallery is locked by photographer or system hard lockout
    if (gallery.pin_locked_until) {
      const lockExpiry = new Date(gallery.pin_locked_until).getTime();
      if (lockExpiry > Date.now()) {
        const remainingMinutes = Math.ceil((lockExpiry - Date.now()) / (1000 * 60));
        return NextResponse.json({
          error: `Galeria została zablokowana ze względów bezpieczeństwa po wielokrotnych błędnych próbach wprowadzenia PIN. Spróbuj ponownie za ${remainingMinutes} min lub skontaktuj się z fotografem.`,
          locked: true,
          retryAfter: remainingMinutes * 60,
        }, { status: 423 });
      }
    }

    // 2. Rate limiting per IP + gallery
    const clientIp = getClientIp(req);
    const ipHash = crypto.createHash('sha256').update(clientIp + getAuthSecret()).digest('hex');

    // Count failed attempts in the last 15 minutes for this IP
    const recentFails = (db.prepare(`
      SELECT COUNT(*) as count FROM pin_attempts 
      WHERE gallery_id = ? AND ip_hash = ? AND success = 0 AND attempted_at > datetime('now', '-15 minutes')
    `).get(gallery.id, ipHash) as any)?.count || 0;

    // Lockout IP after 5 failed attempts in 15 minutes
    if (recentFails >= 5) {
      return NextResponse.json({
        error: 'Zbyt wiele nieudanych prób wprowadzenia kodu PIN. Dostęp z tego adresu został zablokowany na 15 minut.',
        locked: true,
        retryAfter: 900,
      }, { status: 429 });
    }

    // Check gallery-wide failed attempts in the last 15 minutes
    const totalGalleryFails = (db.prepare(`
      SELECT COUNT(*) as count FROM pin_attempts
      WHERE gallery_id = ? AND success = 0 AND attempted_at > datetime('now', '-15 minutes')
    `).get(gallery.id) as any)?.count || 0;

    // 3. Progressive backoff delay (tarpit) after 3 failed attempts from this IP OR if gallery is under general brute force
    if (recentFails >= 3 || totalGalleryFails >= 20) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    // 4. Constant-time secure comparison
    const isPinCorrect = secureComparePins(pin.toString(), gallery.pin_code);

    if (!isPinCorrect) {
      // Record failed attempt
      db.prepare(`
        INSERT INTO pin_attempts (id, gallery_id, ip_hash, success)
        VALUES (?, ?, ?, 0)
      `).run(crypto.randomUUID(), gallery.id, ipHash);

      // Only lock the entire gallery if there is an extreme distributed flood (>150 failed attempts in 15 min)
      if (totalGalleryFails >= 150) {
        db.prepare(`
          UPDATE galleries 
          SET pin_locked_until = datetime('now', '+30 minutes') 
          WHERE id = ?
        `).run(gallery.id);

        return NextResponse.json({
          error: 'Galeria została zablokowana ze względów bezpieczeństwa z powodu masowych błędnych prób. Skontaktuj się z fotografem.',
          locked: true,
        }, { status: 423 });
      }

      const remainingAttempts = Math.max(0, 5 - (recentFails + 1));
      let message = 'Nieprawidłowy kod PIN.';
      if (remainingAttempts > 0) {
        message += ` Pozostało prób przed blokadą: ${remainingAttempts}.`;
      } else {
        message += ' Kolejna próba zablokuje dostęp na 15 minut.';
      }

      return NextResponse.json({
        error: message,
        remainingAttempts,
      }, { status: 401 });
    }

    // 5. On success: record successful attempt & clear IP failed attempts
    db.prepare(`
      INSERT INTO pin_attempts (id, gallery_id, ip_hash, success)
      VALUES (?, ?, ?, 1)
    `).run(crypto.randomUUID(), gallery.id, ipHash);

    db.prepare(`
      DELETE FROM pin_attempts 
      WHERE gallery_id = ? AND ip_hash = ? AND success = 0
    `).run(gallery.id, ipHash);

    const token = createClientToken(gallery.id);

    const res = NextResponse.json({
      success: true,
      token,
      galleryId: gallery.id,
      slug: gallery.slug,
    });

    // Set HttpOnly client cookie for seamless authenticated media streaming
    res.cookies.set(`photogal_client_${gallery.id}`, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return res;
  } catch (error) {
    console.error('Verify PIN error:', error);
    return NextResponse.json({ error: 'Błąd weryfikacji' }, { status: 500 });
  }
}
