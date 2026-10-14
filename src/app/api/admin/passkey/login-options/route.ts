import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import db from '@/lib/db';
import { getWebAuthnConfig, saveChallenge } from '@/lib/webauthn';
import { extractClientIp } from '@/lib/auth';

const optionsRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_RATE_LIMIT_ENTRIES = 5000;

export async function GET(req: NextRequest) {
  const ip = extractClientIp(req);
  const now = Date.now();

  // Prune expired entries to prevent memory leaks
  if (optionsRateLimitMap.size > 200) {
    for (const [key, val] of optionsRateLimitMap.entries()) {
      if (val.resetAt <= now) {
        optionsRateLimitMap.delete(key);
      }
    }
  }

  const rl = optionsRateLimitMap.get(ip);
  if (rl && rl.resetAt > now) {
    if (rl.count >= 30) {
      return NextResponse.json({ error: 'Zbyt wiele zapytań' }, { status: 429 });
    }
    rl.count++;
  } else {
    if (optionsRateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = optionsRateLimitMap.keys().next().value;
      if (oldestKey) optionsRateLimitMap.delete(oldestKey);
    }
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
    allowCredentials: authenticators.map((auth) => {
      let transports: any = undefined;
      if (auth.transports) {
        try { transports = JSON.parse(auth.transports); } catch {}
      }
      return {
        id: auth.id,
        transports,
      };
    }),
  });

  saveChallenge(options.challenge, 'admin_login');

  return NextResponse.json({
    options,
    hasRegisteredPasskeys: true,
  });
}
