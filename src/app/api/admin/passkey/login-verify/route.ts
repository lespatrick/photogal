import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import db from '@/lib/db';
import { createAdminSession, extractClientIp } from '@/lib/auth';
import { getWebAuthnConfig, consumeChallenge } from '@/lib/webauthn';

const verifyRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_RATE_LIMIT_ENTRIES = 5000;

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const now = Date.now();

  if (verifyRateLimitMap.size > 200) {
    for (const [key, val] of verifyRateLimitMap.entries()) {
      if (val.resetAt <= now) {
        verifyRateLimitMap.delete(key);
      }
    }
  }

  const rl = verifyRateLimitMap.get(ip);
  if (rl && rl.resetAt > now) {
    if (rl.count >= 20) {
      return NextResponse.json({ error: 'Zbyt wiele prób weryfikacji. Odczekaj chwilę.' }, { status: 429 });
    }
    rl.count++;
  } else {
    if (verifyRateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = verifyRateLimitMap.keys().next().value;
      if (oldestKey) verifyRateLimitMap.delete(oldestKey);
    }
    verifyRateLimitMap.set(ip, { count: 1, resetAt: now + 60000 });
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
    if (!response || !challenge) {
      return NextResponse.json({ error: 'Brak danych uwierzytelnienia' }, { status: 400 });
    }

    const isValidChallenge = consumeChallenge(challenge, 'admin_login');
    if (!isValidChallenge) {
      return NextResponse.json({ error: 'Sesja logowania wygasła. Spróbuj ponownie.' }, { status: 400 });
    }

    const authenticator = db.prepare(`
      SELECT * FROM authenticators WHERE id = ?
    `).get(response.id) as any;

    if (!authenticator) {
      return NextResponse.json({ error: 'Nierozpoznany klucz Passkey' }, { status: 404 });
    }

    const { rpID, origin } = getWebAuthnConfig(req);

    // Convert stored base64url public key to Uint8Array
    const publicKeyUint8 = new Uint8Array(Buffer.from(authenticator.public_key, 'base64url'));

    let authTransports: any = undefined;
    if (authenticator.transports) {
      try { authTransports = JSON.parse(authenticator.transports); } catch {}
    }

    const verification = await verifyAuthenticationResponse({
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

    if (!verification.verified) {
      return NextResponse.json({ error: 'Podpis biometryczny nieprawidłowy' }, { status: 401 });
    }

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
