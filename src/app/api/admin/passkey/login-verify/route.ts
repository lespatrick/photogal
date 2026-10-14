import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { createAdminSession, extractClientIp, getAuthSecret } from '@/lib/auth';
import { getWebAuthnConfig, consumeChallenge } from '@/lib/webauthn';

function getAdminIpHash(req: NextRequest): string {
  const ip = extractClientIp(req);
  return crypto.createHash('sha256').update(ip + getAuthSecret()).digest('hex');
}

export async function POST(req: NextRequest) {
  const ipHash = getAdminIpHash(req);

  // 1. Check persistent rate limiting & lockouts from SQLite
  const recentFails = (db.prepare(`
    SELECT COUNT(*) as count FROM admin_login_attempts 
    WHERE ip_hash = ? AND attempted_at > datetime('now', '-15 minutes')
  `).get(ipHash) as any)?.count || 0;

  if (recentFails >= 5) {
    return NextResponse.json({
      error: 'Zbyt wiele nieudanych prób logowania. Odczekaj 15 minut przed kolejną próbą.',
    }, { status: 429 });
  }

  if (recentFails >= 3) {
    await new Promise((r) => setTimeout(r, 2000));
  }

  let response: any;
  let challenge: string | undefined;
  try {
    const body = await req.json();
    response = body?.response;
    challenge = body?.challenge;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania' }, { status: 400 });
  }

  try {
    // 2. Strict input validation
    if (!response || typeof response !== 'object' || typeof response.id !== 'string' || !response.id.trim() || !challenge) {
      return NextResponse.json({ error: 'Brak lub nieprawidłowe dane uwierzytelnienia' }, { status: 400 });
    }

    const isValidChallenge = consumeChallenge(challenge, 'admin_login');
    if (!isValidChallenge) {
      return NextResponse.json({ error: 'Sesja logowania wygasła. Spróbuj ponownie.' }, { status: 400 });
    }

    const authenticator = db.prepare(`
      SELECT * FROM authenticators WHERE id = ?
    `).get(response.id.trim()) as any;

    if (!authenticator) {
      db.prepare('INSERT INTO admin_login_attempts (id, ip_hash) VALUES (?, ?)').run(
        crypto.randomUUID(),
        ipHash
      );
      return NextResponse.json({ error: 'Nierozpoznany klucz Passkey' }, { status: 404 });
    }

    const { rpID, origin } = getWebAuthnConfig(req);

    // Convert stored base64url public key to Uint8Array
    const publicKeyUint8 = new Uint8Array(Buffer.from(authenticator.public_key, 'base64url'));

    let authTransports: any = undefined;
    if (authenticator.transports) {
      try { authTransports = JSON.parse(authenticator.transports); } catch {}
    }

    let verification: any;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: authenticator.id,
          publicKey: publicKeyUint8,
          counter: authenticator.counter,
          transports: authTransports,
        },
        requireUserVerification: false,
      });
    } catch (verifyErr: any) {
      db.prepare('INSERT INTO admin_login_attempts (id, ip_hash) VALUES (?, ?)').run(
        crypto.randomUUID(),
        ipHash
      );
      return NextResponse.json({ error: verifyErr.message || 'Weryfikacja podpisu biometrycznego nie powiodła się' }, { status: 401 });
    }

    if (!verification.verified) {
      db.prepare('INSERT INTO admin_login_attempts (id, ip_hash) VALUES (?, ?)').run(
        crypto.randomUUID(),
        ipHash
      );
      return NextResponse.json({ error: 'Podpis biometryczny nieprawidłowy' }, { status: 401 });
    }

    // Success -> clear failed attempts
    db.prepare('DELETE FROM admin_login_attempts WHERE ip_hash = ?').run(ipHash);

    // Update authenticator counter & last_used_at
    db.prepare(`
      UPDATE authenticators 
      SET counter = ?, last_used_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(verification.authenticationInfo.newCounter, authenticator.id);

    // Create admin session
    await createAdminSession(authenticator.admin_id);

    return NextResponse.json({
      success: true,
      message: 'Zalogowano pomyślnie za pomocą Passkey!',
    });
  } catch (error: any) {
    console.error('Passkey verification error:', error);
    return NextResponse.json({ error: error.message || 'Błąd logowania Passkey' }, { status: 500 });
  }
}
