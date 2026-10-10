import { type NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const PUBLIC_PATHS = ['/login'];
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Runs on every request:
 *  1. `/api/*` is forwarded to the API at runtime (URL comes from env, so one image fits every
 *     environment and cookies stay same-origin — no CORS).
 *  2. Pages get a per-request CSP nonce.
 *  3. Requests without a session cookie are sent to /login early (the API remains the authority).
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    return NextResponse.rewrite(new URL(`${pathname}${search}`, API_URL));
  }

  if (
    !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) &&
    !req.cookies.has('isbp_session')
  ) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('x-isbp-path', pathname + search);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|fonts/|healthz).*)'],
};
