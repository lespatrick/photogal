import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import db from '@/lib/db';
import { createAdminSession } from '@/lib/auth';
import { getWebAuthnConfig, consumeChallenge } from '@/lib/webauthn';

export async function POST(req: NextRequest) {
  try {
    const { response, challenge } = await req.json();

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

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: authenticator.id,
        publicKey: publicKeyUint8,
        counter: authenticator.counter,
        transports: authenticator.transports ? JSON.parse(authenticator.transports) : undefined,
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
