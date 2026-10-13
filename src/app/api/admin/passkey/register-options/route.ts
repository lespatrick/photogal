import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import db from '@/lib/db';
import { getAdminSessionId } from '@/lib/auth';
import { getWebAuthnConfig, saveChallenge } from '@/lib/webauthn';

export async function GET(req: NextRequest) {
  const adminId = await getAdminSessionId();
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const admin = db.prepare('SELECT id, username FROM admins WHERE id = ?').get(adminId) as { id: string; username: string } | undefined;
  if (!admin) {
    return NextResponse.json({ error: 'Admin nie istnieje' }, { status: 404 });
  }

  // Get existing authenticators to exclude them from re-registration
  const existingAuthenticators = db.prepare('SELECT id, transports FROM authenticators WHERE admin_id = ?').all(adminId) as { id: string; transports: string }[];

  const { rpName, rpID } = getWebAuthnConfig(req);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(admin.id),
    userName: admin.username,
    userDisplayName: `Fotograf (${admin.username})`,
    attestationType: 'none',
    excludeCredentials: existingAuthenticators.map((auth) => ({
      id: auth.id,
      transports: auth.transports ? JSON.parse(auth.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  saveChallenge(options.challenge, 'admin_register', adminId);

  return NextResponse.json(options);
}
