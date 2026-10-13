import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import db from '@/lib/db';
import { getWebAuthnConfig, saveChallenge } from '@/lib/webauthn';

export async function GET(req: NextRequest) {
  const authenticators = db.prepare('SELECT id, transports FROM authenticators').all() as { id: string; transports: string }[];

  const { rpID } = getWebAuthnConfig(req);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: authenticators.map((auth) => ({
      id: auth.id,
      transports: auth.transports ? JSON.parse(auth.transports) : undefined,
    })),
  });

  saveChallenge(options.challenge, 'admin_login');

  return NextResponse.json({
    options,
    hasRegisteredPasskeys: authenticators.length > 0,
  });
}
