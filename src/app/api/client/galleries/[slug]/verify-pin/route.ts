import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db, { parseSqliteDate } from '@/lib/db';
import { createClientToken, getAuthSecret, extractClientIp } from '@/lib/auth';

function secureComparePins(a: string, b: string): boolean {
  const strA = (a || '').trim();
  const strB = (b || '').trim();
  if (!strA || !strB) return false;
  const hashA = crypto.createHash('sha256').update(strA).digest();
  const hashB = crypto.createHash('sha256').update(strB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    let pin: string | undefined;
    try {
      const body = await req.json();
      pin = body?.pin;
    } catch {
      return NextResponse.json({ error: 'Nieprawidłowe dane żądania' }, { status: 400 });
    }

    const cleanPin = (typeof pin === 'string' || typeof pin === 'number') ? String(pin).trim() : '';
    if (!cleanPin) {
      return NextResponse.json({ error: 'Podaj kod PIN' }, { status: 400 });
    }

    if (cleanPin.length > 32) {
      return NextResponse.json({ error: 'Nieprawidłowy format kodu PIN' }, { status: 400 });
    }

    const gallery = db.prepare(`
      SELECT id, slug, pin_code, title, pin_locked_until, status 
      FROM galleries 
      WHERE slug = ?
    `).get(slug) as {
      id: string;
      slug: string;
      pin_code: string;
      title: string;
      pin_locked_until: string | null;
      status: string;
    } | undefined;

    if (!gallery || gallery.status === 'draft') {
      return NextResponse.json({ error: 'Galeria nie została odnaleziona' }, { status: 404 });
    }

    // 1. Rate limiting & PIN verification inside atomic immediate transaction
    // Periodically prune pin attempts older than 7 days (10% sample rate)
    if (Math.random() < 0.1) {
      try {
        db.prepare("DELETE FROM pin_attempts WHERE attempted_at < datetime('now', '-7 days')").run();
      } catch {}
    }

    const clientIp = extractClientIp(req);
    const ipHash = crypto.createHash('sha256').update(clientIp + getAuthSecret()).digest('hex');
    const isPinCorrect = secureComparePins(cleanPin, gallery.pin_code);

    const txResult = db.transaction(() => {
      // Re-check if gallery is locked by photographer or system hard lockout
      const fresh = db.prepare('SELECT pin_locked_until FROM galleries WHERE id = ?').get(gallery.id) as { pin_locked_until: string | null } | undefined;
      if (fresh?.pin_locked_until) {
        const lockExpiry = parseSqliteDate(fresh.pin_locked_until).getTime();
        if (lockExpiry > Date.now()) {
          const remainingMinutes = Math.max(1, Math.ceil((lockExpiry - Date.now()) / (1000 * 60)));
          return {
            status: 423,
            error: remainingMinutes > 1000
              ? 'Galeria została zablokowana ze względów bezpieczeństwa po wielokrotnych błędnych próbach wprowadzenia PIN. Skontaktuj się z fotografem w celu odblokowania.'
              : `Galeria została zablokowana ze względów bezpieczeństwa po wielokrotnych błędnych próbach wprowadzenia PIN. Spróbuj ponownie za ${remainingMinutes} min lub skontaktuj się z fotografem.`,
            locked: true,
          };
        }
      }

      // Count failed attempts in the last 15 minutes for this IP
      const recentFails = (db.prepare(`
        SELECT COUNT(*) as count FROM pin_attempts 
        WHERE gallery_id = ? AND ip_hash = ? AND success = 0 AND attempted_at > datetime('now', '-15 minutes')
      `).get(gallery.id, ipHash) as any)?.count || 0;

      // Lockout IP after 5 failed attempts in 15 minutes
      if (recentFails >= 5) {
        return {
          status: 429,
          error: 'Zbyt wiele nieudanych prób wprowadzenia kodu PIN. Dostęp z tego adresu został zablokowany na 15 minut.',
          locked: true,
          retryAfter: 900,
        };
      }

      // Check total gallery-wide failed attempts since last photographer reset
      const totalGalleryFails = (db.prepare(`
        SELECT COUNT(*) as count FROM pin_attempts
        WHERE gallery_id = ? AND success = 0
      `).get(gallery.id) as any)?.count || 0;

      if (!isPinCorrect) {
        // Record failed attempt
        db.prepare(`
          INSERT INTO pin_attempts (id, gallery_id, ip_hash, success)
          VALUES (?, ?, ?, 0)
        `).run(crypto.randomUUID(), gallery.id, ipHash);

        // Lock the entire gallery after 10 total failed attempts per AGENTS.md specification (requires photographer reset)
        if (totalGalleryFails + 1 >= 10) {
          db.prepare(`
            UPDATE galleries 
            SET pin_locked_until = '9999-12-31 23:59:59' 
            WHERE id = ?
          `).run(gallery.id);

          return {
            status: 423,
            error: 'Galeria została zablokowana ze względów bezpieczeństwa po wielokrotnych błędnych próbach wprowadzenia PIN. Skontaktuj się z fotografem w celu odblokowania.',
            locked: true,
            applyTarpit: true,
          };
        }

        const remainingAttempts = Math.max(0, 5 - (recentFails + 1));
        let message = 'Nieprawidłowy kod PIN.';
        if (remainingAttempts > 0) {
          message += ` Pozostało prób przed blokadą: ${remainingAttempts}.`;
        } else {
          message += ' Kolejna próba zablokuje dostęp na 15 minut.';
        }

        return {
          status: 401,
          error: message,
          remainingAttempts,
          applyTarpit: recentFails + 1 >= 3,
        };
      }

      // On success: record successful attempt & clear IP failed attempts
      db.prepare(`
        INSERT INTO pin_attempts (id, gallery_id, ip_hash, success)
        VALUES (?, ?, ?, 1)
      `).run(crypto.randomUUID(), gallery.id, ipHash);

      db.prepare(`
        DELETE FROM pin_attempts 
        WHERE gallery_id = ? AND ip_hash = ? AND success = 0
      `).run(gallery.id, ipHash);

      return {
        status: 200,
        applyTarpit: recentFails >= 3,
      };
    }).immediate();

    // 2. Progressive backoff delay (tarpit) if triggered
    if (txResult.applyTarpit) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    if (txResult.status !== 200) {
      return NextResponse.json({
        error: txResult.error,
        locked: txResult.locked,
        remainingAttempts: txResult.remainingAttempts,
        retryAfter: txResult.retryAfter,
      }, { status: txResult.status });
    }

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
      secure: process.env.NODE_ENV === 'production' && process.env.ALLOW_HTTP !== 'true',
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
