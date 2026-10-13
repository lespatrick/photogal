import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { STORAGE_DIR } from '@/lib/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const filePathArray = resolvedParams.path;
    if (!filePathArray || filePathArray.length === 0) {
      return new NextResponse('File not found', { status: 404 });
    }

    // Prevent directory traversal attacks
    const relativePath = filePathArray.join('/');
    const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(STORAGE_DIR, safePath);

    if (!fullPath.startsWith(path.resolve(STORAGE_DIR))) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    if (!fs.existsSync(fullPath)) {
      return new NextResponse('File not found', { status: 404 });
    }

    const stat = await fs.promises.stat(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    let contentType = 'application/octet-stream';
    if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';

    const fileStream = fs.createReadStream(fullPath);
    // Convert Node ReadStream to Web ReadableStream
    const readable = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => controller.close());
        fileStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        fileStream.destroy();
      },
    });

    return new NextResponse(readable, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
