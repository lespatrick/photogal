import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { verifyAdminSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!(await verifyAdminSession(req))) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const zipPath = path.resolve(process.cwd(), 'integrations/captureone/photogal.coplugin.zip');

  if (!fs.existsSync(zipPath)) {
    return NextResponse.json({ error: 'Paczka wtyczki Capture One nie została jeszcze zbudowana.' }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(zipPath);

  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="photogal.coplugin.zip"',
      'Content-Length': fileBuffer.length.toString(),
    },
  });
}

