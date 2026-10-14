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

  const hostParts = safeHost.split(':');
  let hostname = hostParts[0] || 'localhost';
  let port = '';
  if (hostParts.length === 2 && /^[0-9]{1,5}$/.test(hostParts[1])) {
    const portNum = parseInt(hostParts[1], 10);
    if (portNum > 0 && portNum <= 65535 && portNum !== 80 && portNum !== 443) {
      port = `:${portNum}`;
    }
  }

  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';

  const allowedHosts = [
    ...(process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',').map((h) => h.trim().toLowerCase()) : []),
    ...(process.env.RP_ID ? [process.env.RP_ID.trim().toLowerCase()] : []),
  ].filter(Boolean);

  if (allowedHosts.length > 0 && !isLoopback && !allowedHosts.includes(hostname.toLowerCase())) {
    hostname = allowedHosts[0];
    port = ''; // Invalidate any untrusted port from the rejected host
  }

  const rpID = envRpId || hostname;
  const origin = envOrigin || `${proto}://${hostname}${port}`;
  const rpName = 'photogal';

  return { rpName, rpID, origin };
}

export function saveChallenge(challenge: string, userType: 'admin_register' | 'admin_login', adminId?: string): string {
  const now = Date.now();
  // Prune expired challenges occasionally (10% of calls) to avoid redundant write locks on every call
  if (Math.random() < 0.1) {
    try {
      db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(now);
    } catch {}
  }

  const id = crypto.randomUUID();
  const expiresAt = now + 1000 * 60 * 5; // 5 minutes TTL

  db.prepare(`
    INSERT INTO auth_challenges (id, challenge, user_type, admin_id, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, challenge, userType, adminId || null, expiresAt);

  return id;
}

export function consumeChallenge(
  challenge: string,
  userType: 'admin_register' | 'admin_login',
  expectedAdminId?: string
): boolean {
  const now = Date.now();
  try {
    let sql = 'DELETE FROM auth_challenges WHERE challenge = ? AND user_type = ? AND expires_at >= ?';
    const params: any[] = [challenge, userType, now];

    if (expectedAdminId) {
      sql += ' AND admin_id = ?';
      params.push(expectedAdminId);
    }

    sql += ' RETURNING id';
    const deleted = db.prepare(sql).get(...params);
    return !!deleted;
  } catch {
    // Fallback for environments where RETURNING might fail
    const tx = db.transaction(() => {
      let selSql = 'SELECT id FROM auth_challenges WHERE challenge = ? AND user_type = ? AND expires_at >= ?';
      const selParams: any[] = [challenge, userType, now];

      if (expectedAdminId) {
        selSql += ' AND admin_id = ?';
        selParams.push(expectedAdminId);
      }

      const row = db.prepare(selSql).get(...selParams);
      if (!row) return false;
      db.prepare('DELETE FROM auth_challenges WHERE id = ?').run((row as any).id);
      return true;
    });
    return tx.immediate();
  }
}
