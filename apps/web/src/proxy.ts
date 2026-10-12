import { type NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
/** No sign-in: the login page, and modules' public pages (`/p/<module>/…`, e.g. a published chat). */
const PUBLIC_PATHS = ['/login', '/p'];
const isDev = process.env.NODE_ENV !== 'production';

/** An origin allowed to frame a page: `https://host[:port]`, or `http://localhost` (what goes into the CSP). */
const FRAME_ORIGIN = /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d{1,5})?$/;
const FRAME_CACHE_MS = 30_000;
const frameCache = new Map<string, { at: number; origins: string[] }>();

/**
 * Websites that may show a public module page in a frame, asked from the API (the module decides, e.g. a published
 * chat's allowed websites) and cached briefly. Any failure means none.
 */
async function frameAncestorsOf(pathname: string): Promise<string[]> {
  const cached = frameCache.get(pathname);
  if (cached && Date.now() - cached.at < FRAME_CACHE_MS) return cached.origins;
  let origins: string[] = [];
  try {
    const res = await fetch(
      new URL(`/api/v1/platform/frame-ancestors?path=${encodeURIComponent(pathname)}`, API_URL),
      { signal: AbortSignal.timeout(2_000) },
    );
    if (res.ok)
      origins =
        ((await res.json()) as { origins?: unknown[] }).origins?.filter(
          (o): o is string => typeof o === 'string' && FRAME_ORIGIN.test(o),
        ) ?? [];
  } catch {
    // The API is unreachable: the page can't be framed.
  }
  if (frameCache.size > 1_000) frameCache.clear();
  frameCache.set(pathname, { at: Date.now(), origins });
  return origins;
}

/**
 * Runs on every request:
 *  1. `/api/*` is forwarded to the API at runtime (URL comes from env, so one image fits every
 *     environment and cookies stay same-origin — no CORS).
 *  2. Pages get a per-request CSP nonce.
 *  3. Requests without a session cookie are sent to /login early (the API remains the authority).
 *  4. Nothing may frame a page, except a module's public page where its module allows the website.
 */
export async function proxy(req: NextRequest) {
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

  const ancestors = pathname.startsWith('/p/') ? await frameAncestorsOf(pathname) : [];
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
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
