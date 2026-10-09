/**
 * The API as a persona sees it: session cookie + CSRF header, like the web app. Requests never throw (a refused or
 * failed request is a `{ status, body }` like any other; no response at all is status 0), and every one is recorded.
 */
import { addTrail, currentScope, currentStep } from './context';
import { excerpt, type Recorder } from './recorder';

/** Response bodies are loosely typed JSON: flows read the fields they need. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface ApiResponse<T = Json> {
  status: number;
  body: T;
  /** Round trip in milliseconds. */
  ms: number;
  method: string;
  /** The path as requested, query string included. */
  path: string;
  requestId: string | null;
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | readonly QueryValue[]>;

export interface RequestOptions {
  query?: Query;
  /** Default 30 s; a request that takes longer counts as a transport error (status 0). */
  timeoutMs?: number;
  /** Send as an API client with this key (`Authorization: Bearer …`) instead of the persona's session. */
  bearer?: string;
  /** Extra request headers (e.g. `mcp-protocol-version`); they win over the defaults. */
  headers?: Record<string, string>;
}

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

export interface Credentials {
  username: string;
  password: string;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** `/roles` → `/api/v1/roles`; `/api/…` is kept as it is. */
export function apiPath(path: string, query?: Query): string {
  const base = path.startsWith('/api/') ? path : `/api/v1${path.startsWith('/') ? '' : '/'}${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    const values = Array.isArray(v) ? v : [v];
    for (const one of values) if (one !== undefined && one !== null) params.append(k, String(one));
  }
  const qs = params.toString();
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;
}

/** Signs in with a local account; throws (without the password) when that fails. */
export async function signIn(base: string, credentials: Credentials, label: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(
      `Sign-in as ${label} failed: ${(err as Error).message} (is the stack running at ${base}?)`,
    );
  }
  const text = await res.text();
  if (res.status !== 200) {
    let code = '';
    try {
      code = (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? '';
    } catch {
      // not JSON
    }
    throw new Error(`Sign-in as ${label} failed: HTTP ${res.status} ${code}`.trim());
  }
  const body = JSON.parse(text) as { csrfToken: string; user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .find((c) => c.startsWith('isbp_session='));
  if (!cookie) throw new Error(`Sign-in as ${label} returned no session cookie`);
  return { cookie, csrf: body.csrfToken, userId: body.user.id };
}

export class ApiClient {
  private session: Session | null = null;
  private signingIn: Promise<Session> | null = null;

  constructor(
    /** The persona's name, as flows call it. */
    readonly persona: string,
    private readonly base: string,
    private readonly recorder: Recorder,
    private readonly credentials: () => Credentials,
    private readonly defaultTimeoutMs = 30_000,
  ) {}

  /** Signs in (once; concurrent callers share the attempt). */
  async ensureSession(): Promise<Session> {
    if (this.session) return this.session;
    if (!this.signingIn) {
      this.signingIn = signIn(this.base, this.credentials(), this.persona)
        .then((s) => {
          this.session = s;
          return s;
        })
        .finally(() => {
          this.signingIn = null;
        });
    }
    return this.signingIn;
  }

  /** The signed-in user's id (after the first request or {@link ensureSession}). */
  get userId(): string | null {
    return this.session?.userId ?? null;
  }

  get<T = Json>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, undefined, opts);
  }

  delete<T = Json>(path: string, opts?: RequestOptions) {
    return this.request<T>('DELETE', path, undefined, opts);
  }

  post<T = Json>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, body, opts);
  }

  patch<T = Json>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', path, body, opts);
  }

  put<T = Json>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PUT', path, body, opts);
  }

  /** Uploads one file as multipart/form-data (field `file` by default), e.g. `/records/:type/:id/files`. */
  upload<T = Json>(
    path: string,
    file: { name: string; contentType: string; data: string | Uint8Array; field?: string },
    opts?: RequestOptions,
  ) {
    const form = new FormData();
    const bytes = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data;
    form.append(
      file.field ?? 'file',
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.contentType }),
      file.name,
    );
    return this.request<T>('POST', path, form, opts);
  }

  async request<T = Json>(
    method: string,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
    retried = false,
  ): Promise<ApiResponse<T>> {
    const url = apiPath(path, opts.query);
    let session: Session | null = null;
    if (!opts.bearer)
      try {
        session = await this.ensureSession();
      } catch (err) {
        return this.transportFailure<T>(method, url, 0, err as Error);
      }
    // An API client's key (`opts.bearer`) instead of the persona's session: no cookie, no CSRF header.
    const headers: Record<string, string> = session
      ? { cookie: session.cookie, accept: 'application/json' }
      : { authorization: `Bearer ${opts.bearer}`, accept: 'application/json' };
    if (session && !SAFE.has(method)) headers['x-csrf-token'] = session.csrf;
    Object.assign(headers, opts.headers);
    // FormData (uploads) sets its own multipart content type.
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers['content-type'] = 'application/json';
    const started = performance.now();
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${this.base}${url}`, {
        method,
        headers,
        body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.defaultTimeoutMs),
      });
      text = await res.text();
    } catch (err) {
      return this.transportFailure<T>(method, url, performance.now() - started, err as Error);
    }
    const ms = performance.now() - started;
    const parsed = parse(text);
    const scope = currentScope();
    this.recorder.record({
      method,
      path: url,
      status: res.status,
      ms,
      persona: this.persona,
      flow: scope?.flow ?? null,
      iteration: scope?.iteration ?? null,
      step: currentStep(),
      ...(res.status >= 500 ? { body: excerpt(parsed, 1_000) } : {}),
    });
    addTrail(`${this.persona}: ${method} ${url} → ${res.status} (${Math.round(ms)} ms)`);
    // A session that ended mid-run (expired, revoked): sign in again, once, and say so in the report.
    if (res.status === 401 && !retried && session) {
      this.recorder.reauthentications++;
      this.session = null;
      return this.request<T>(method, path, body, opts, true);
    }
    return {
      status: res.status,
      body: parsed as T,
      ms,
      method,
      path: url,
      requestId: res.headers.get('x-request-id'),
    };
  }

  private transportFailure<T>(method: string, url: string, ms: number, err: Error): ApiResponse<T> {
    const scope = currentScope();
    const message = err.name === 'TimeoutError' ? `timed out after ${Math.round(ms)} ms` : err.message;
    this.recorder.record({
      method,
      path: url,
      status: 0,
      ms,
      persona: this.persona,
      flow: scope?.flow ?? null,
      iteration: scope?.iteration ?? null,
      step: currentStep(),
      error: message,
    });
    addTrail(`${this.persona}: ${method} ${url} → no response (${message})`);
    return {
      status: 0,
      body: { error: { code: 'NO_RESPONSE', message } } as T,
      ms,
      method,
      path: url,
      requestId: null,
    };
  }
}

function parse(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
