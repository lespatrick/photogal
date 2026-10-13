import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import db from '@/lib/db';
import { getAdminSessionId } from '@/lib/auth';
import { getWebAuthnConfig, consumeChallenge } from '@/lib/webauthn';

export async function POST(req: NextRequest) {
  const adminId = await getAdminSessionId();
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  try {
    const { response, challenge, friendlyName } = await req.json();

    if (!response || !challenge) {
      return NextResponse.json({ error: 'Brak wymaganych danych weryfikacji' }, { status: 400 });
    }

    const isValidChallenge = consumeChallenge(challenge, 'admin_register');
    if (!isValidChallenge) {
      return NextResponse.json({ error: 'Wyzwanie wygasło lub jest nieprawidłowe' }, { status: 400 });
    }

    const { rpID, origin } = getWebAuthnConfig(req);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Weryfikacja klucza nie powiodła się' }, { status: 400 });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // credential.publicKey is Uint8Array -> encode to base64url
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64url');

    db.prepare(`
      INSERT INTO authenticators (
        id, admin_id, public_key, counter, device_type, backed_up, transports, friendly_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      credential.id,
      adminId,
      publicKeyBase64,
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      response.response?.transports ? JSON.stringify(response.response.transports) : null,
      friendlyName?.trim() || 'Klucz dostępu (Passkey)'
    );

    return NextResponse.json({
      success: true,
      credentialId: credential.id,
      message: 'Klucz dostępu został pomyślnie dodany do konta!',
    });
  } catch (error: any) {
    console.error('Passkey registration error:', error);
    return NextResponse.json({ error: error.message || 'Błąd rejestracji Passkey' }, { status: 500 });
  }
}
