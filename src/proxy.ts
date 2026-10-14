import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js 16 Proxy (formerly Middleware) to strictly enforce HTTPS
 * and reject/redirect insecure plaintext HTTP connections.
 */
export function proxy(req: NextRequest) {
  // Configurable bypass if explicitly permitted by administrator
  if (process.env.ALLOW_HTTP === 'true') {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  const rawHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  const forwardedProto = req.headers.get('x-forwarded-proto');

  // Check if connection is plaintext HTTP
  const isHttp = forwardedProto === 'http' || (!forwardedProto && url.protocol === 'http:');
  const hostname = rawHost.split(':')[0].toLowerCase();
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';

  // Internal health check exemption (e.g. Docker container wget http://127.0.0.1:3000/ or local dev)
  const isInternalLoopback = isLoopback && !forwardedProto;

  if (isHttp && !isInternalLoopback) {
    // Exempt local development on localhost when not in production
    if (process.env.NODE_ENV !== 'production' && isLoopback && process.env.ENFORCE_HTTPS !== 'true') {
      return NextResponse.next();
    }

    // Build secure HTTPS destination
    const cleanHost = rawHost.replace(/:80$/, '');
    const httpsUrl = `https://${cleanHost}${url.pathname}${url.search}`;

    // 308 Permanent Redirect preserves HTTP method (GET, POST, PATCH, DELETE) and payload
    const redirectResponse = NextResponse.redirect(httpsUrl, 308);
    redirectResponse.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    return redirectResponse;
  }

  const response = NextResponse.next();

  // Enforce HSTS on all secure responses
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, icon-192.png, icon-512.png (icons)
     * - sw.js, manifest.webmanifest (PWA assets)
     */
    '/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|sw\\.js|manifest\\.webmanifest).*)',
  ],
};
