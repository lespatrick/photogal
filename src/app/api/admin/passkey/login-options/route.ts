import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import db from '@/lib/db';
import { getWebAuthnConfig, saveChallenge } from '@/lib/webauthn';

const optionsRateLimitMap = new Map<string, { count: number; resetAt: number }>();

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1';
  const now = Date.now();
  const rl = optionsRateLimitMap.get(ip);
  if (rl && rl.resetAt > now) {
    if (rl.count >= 30) {
      return NextResponse.json({ error: 'Zbyt wiele zapytań' }, { status: 429 });
    }
    rl.count++;
  } else {
    optionsRateLimitMap.set(ip, { count: 1, resetAt: now + 60000 });
  }

  const authenticators = db.prepare('SELECT id, transports FROM authenticators').all() as { id: string; transports: string }[];

  if (authenticators.length === 0) {
    return NextResponse.json({
      options: null,
      hasRegisteredPasskeys: false,
    });
  }

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
    hasRegisteredPasskeys: true,
  });
}
