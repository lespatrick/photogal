import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyAdminSession } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const gallery = db.prepare('SELECT id, pin_locked_until FROM galleries WHERE id = ? OR slug = ?').get(id, id) as any;
    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    const failedAttempts = (db.prepare(`
      SELECT COUNT(*) as count FROM pin_attempts 
      WHERE gallery_id = ? AND success = 0 AND attempted_at > datetime('now', '-24 hours')
    `).get(gallery.id) as any)?.count || 0;

    const isLocked = gallery.pin_locked_until
      ? new Date(gallery.pin_locked_until).getTime() > Date.now()
      : false;

    const recentLogs = db.prepare(`
      SELECT id, success, attempted_at, substr(ip_hash, 1, 8) as ip_fingerprint
      FROM pin_attempts
      WHERE gallery_id = ?
      ORDER BY attempted_at DESC
      LIMIT 10
    `).all(gallery.id);

    return NextResponse.json({
      galleryId: gallery.id,
      failedAttempts24h: failedAttempts,
      isLocked,
      lockedUntil: gallery.pin_locked_until,
      recentLogs,
    });
  } catch (error) {
    console.error('Security status error:', error);
    return NextResponse.json({ error: 'Błąd pobierania statusu bezpieczeństwa' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const gallery = db.prepare('SELECT id FROM galleries WHERE id = ? OR slug = ?').get(id, id) as any;
    if (!gallery) {
      return NextResponse.json({ error: 'Galeria nie istnieje' }, { status: 404 });
    }

    // Unlock gallery and clear failed attempts
    db.prepare('UPDATE galleries SET pin_locked_until = NULL WHERE id = ?').run(gallery.id);
    db.prepare('DELETE FROM pin_attempts WHERE gallery_id = ? AND success = 0').run(gallery.id);

    return NextResponse.json({
      success: true,
      message: 'Galeria została odblokowana, a historia nieudanych prób wyczyszczona.',
    });
  } catch (error) {
    console.error('Reset security error:', error);
    return NextResponse.json({ error: 'Błąd resetowania zabezpieczeń' }, { status: 500 });
  }
}
