import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { getAdminSessionId, generateApiToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const adminId = await getAdminSessionId(req);
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  try {
    const tokens = db.prepare(`
      SELECT id, label, created_at, last_used_at
      FROM api_tokens
      WHERE admin_id = ?
      ORDER BY created_at DESC
    `).all(adminId);

    return NextResponse.json({ tokens });
  } catch (error) {
    console.error('Error fetching API tokens:', error);
    return NextResponse.json({ error: 'Błąd pobierania tokenów API' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const adminId = await getAdminSessionId(req);
  if (!adminId) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawLabel = (body && typeof body.label === 'string') ? body.label.trim() : '';
    const label = rawLabel.slice(0, 100) || 'Capture One Plugin';

    const id = crypto.randomUUID();
    const { rawToken, tokenHash } = generateApiToken();

    db.prepare(`
      INSERT INTO api_tokens (id, admin_id, token_hash, label)
      VALUES (?, ?, ?, ?)
    `).run(id, adminId, tokenHash, label);

    return NextResponse.json({
      success: true,
      token: {
        id,
        label,
        token: rawToken,
        created_at: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating API token:', error);
    return NextResponse.json({ error: 'Błąd generowania tokenu API' }, { status: 500 });
  }
}

