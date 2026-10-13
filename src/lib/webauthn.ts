import crypto from 'crypto';
import db from './db';

export function getWebAuthnConfig(req: Request) {
  const url = new URL(req.url);
  const hostname = url.hostname;
  // rpID is the effective domain without port
  const rpID = hostname;
  // origin must match browser origin including protocol and port
  const origin = `${url.protocol}//${url.host}`;
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
