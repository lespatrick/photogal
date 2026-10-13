import crypto from 'crypto';
import db from './db';

export function getWebAuthnConfig(req: Request) {
  const envRpId = process.env.RP_ID;
  const envOrigin = process.env.RP_ORIGIN;

  const url = new URL(req.url);
  const rawHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  const safeHost = rawHost.replace(/[^a-zA-Z0-9.:_-]/g, '').trim();
  const rawProto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const proto = rawProto === 'https' || (process.env.NODE_ENV === 'production') ? 'https' : 'http';

  const hostname = safeHost.split(':')[0] || 'localhost';
  const rpID = envRpId || hostname;
  const origin = envOrigin || `${proto}://${safeHost}`;
  const rpName = 'photogal';

  return { rpName, rpID, origin };
}

export function saveChallenge(challenge: string, userType: 'admin_register' | 'admin_login', adminId?: string): string {
  // Clean expired challenges
  const now = Date.now();
  db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(now);

  const id = crypto.randomUUID();
  const expiresAt = now + 1000 * 60 * 5; // 5 minutes TTL

  db.prepare(`
    INSERT INTO auth_challenges (id, challenge, user_type, admin_id, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, challenge, userType, adminId || null, expiresAt);

  return id;
}

export function consumeChallenge(challenge: string, userType: 'admin_register' | 'admin_login'): boolean {
  const now = Date.now();
  const row = db.prepare(`
    SELECT id FROM auth_challenges 
    WHERE challenge = ? AND user_type = ? AND expires_at >= ?
  `).get(challenge, userType, now);

  if (!row) return false;

  db.prepare('DELETE FROM auth_challenges WHERE id = ?').run((row as any).id);
  return true;
}
