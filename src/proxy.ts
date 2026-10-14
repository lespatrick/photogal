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
  
  // Extract and validate hostname to defeat Host Header Injection and Open Redirects
  const hostWithoutPort = rawHost.split(':')[0].trim().toLowerCase();
  const isValidHostname = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(hostWithoutPort);
  let hostname = isValidHostname ? hostWithoutPort : url.hostname.toLowerCase();

  const allowedHosts = [
    ...(process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',').map((h) => h.trim().toLowerCase()) : []),
    ...(process.env.RP_ID ? [process.env.RP_ID.trim().toLowerCase()] : []),
  ].filter(Boolean);

  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
  // Internal health check exemption (e.g. Docker container wget http://127.0.0.1:3000/ or local dev)
  const isInternalLoopback = isLoopback && !forwardedProto;

  // Enforce allowed host whitelist if configured
  if (allowedHosts.length > 0 && !isLoopback && !allowedHosts.includes(hostname)) {
    if (isHttp && !isInternalLoopback) {
      hostname = allowedHosts[0];
    } else {
      return new NextResponse('Invalid Host', { status: 400 });
    }
  }

  if (isHttp && !isInternalLoopback) {
    // Exempt local development on localhost when not in production
    if (process.env.NODE_ENV !== 'production' && isLoopback && process.env.ENFORCE_HTTPS !== 'true') {
      return NextResponse.next();
    }

    // Build secure HTTPS destination without insecure HTTP ports
    const customHttpsPort = process.env.HTTPS_PORT ? `:${process.env.HTTPS_PORT}` : '';
    const cleanHost = `${hostname}${customHttpsPort}`;
    const httpsUrl = `https://${cleanHost}${url.pathname}${url.search}`;

    // 308 Permanent Redirect preserves HTTP method (GET, POST, PATCH, DELETE) and payload
    const redirectResponse = NextResponse.redirect(httpsUrl, 308);
    redirectResponse.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    return redirectResponse;
  }

  const response = NextResponse.next();

  // Enforce HSTS and defensive security headers on all secure responses
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';"
  );
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

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
