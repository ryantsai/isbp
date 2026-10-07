import { type ConnectorContext, ErrorCodes, HttpError, type OutboundResponse } from '@isbp/sdk/server';
import { type AzdoConfig, type AzdoSecrets, normalizeCollectionUrl } from '../contracts';

export type AzdoConn = ConnectorContext<AzdoConfig, AzdoSecrets>;

/** The body Azure DevOps sends with an error (`TF…`/`VS…` codes in `message`). */
export interface AzdoErrorBody {
  message?: string;
  typeKey?: string;
  typeName?: string;
  errorCode?: number;
  customProperties?: Record<string, unknown>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Query parameters (`api-version` is added). `undefined` values are left out. */
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** `application/json` (default) or `application/json-patch+json` for work item writes. */
  contentType?: 'application/json' | 'application/json-patch+json';
  /** Overrides the connection's version (previews: `7.0-preview.3`); empty leaves it out. */
  apiVersion?: string;
  /** Statuses returned to the caller instead of thrown (404 for "not found" reads). */
  allow?: number[];
  maxBytes?: number;
}

export interface AzdoResponse<T> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

const MAX_RETRY_AFTER = 3600;

/** `Retry-After` in seconds (delta or HTTP date), clamped to an hour; 60 when absent or unreadable. */
export function retryAfterSeconds(header: string | undefined, now = Date.now()): number {
  if (!header) return 60;
  const n = Number(header.trim());
  if (Number.isFinite(n)) return Math.min(MAX_RETRY_AFTER, Math.max(1, Math.ceil(n)));
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return Math.min(MAX_RETRY_AFTER, Math.max(1, Math.ceil((at - now) / 1000)));
  return 60;
}

function parseBody(res: OutboundResponse): unknown {
  if (!res.body.length) return null;
  const text = res.body.toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * A failed `test /rev` operation: the work item changed since it was read. Azure DevOps answers 412 with
 * `TestPatchOperationFailedException` (`VS403351: Test Operation for path /rev failed…`); 409 is treated the same.
 */
export function isRevisionConflict(status: number, err: AzdoErrorBody | null): boolean {
  if (status === 409 || status === 412) return true;
  if (status !== 400 || !err) return false;
  const key = `${err.typeKey ?? ''} ${err.typeName ?? ''}`;
  return /TestPatchOperationFailed/i.test(key) || /\bVS403351\b/.test(err.message ?? '');
}

const errorBody = (body: unknown): AzdoErrorBody | null =>
  typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as AzdoErrorBody) : null;

/** Short, secret-free explanation from an error response (the remote's own message). */
function remoteMessage(status: number, body: unknown): string {
  const err = errorBody(body);
  if (err?.message) return err.message.slice(0, 1000);
  // A wrong collection or virtual directory gets IIS's HTML 404 page.
  if (status === 404) return 'Not found: check the collection URL (https://<server>/tfs/<collection>)';
  return `Azure DevOps Server answered ${status}`;
}

/**
 * Maps a failed response to the hub's error contract: 401/403 (and the sign-in page some servers send with
 * 203) → 502 `REMOTE_AUTH_FAILED`; 429, or 503 with `Retry-After` → 429 `REMOTE_RATE_LIMITED`; a failed
 * `test /rev` → 409 `REMOTE_CONFLICT`; other 4xx → 422 `REMOTE_REJECTED` with the server's message; anything
 * else → 502 `UPSTREAM_FAILED`.
 */
export function toHttpError(
  res: { status: number; headers: Record<string, string> },
  body: unknown,
): HttpError {
  const { status } = res;
  const err = errorBody(body);
  const details = { status, typeKey: err?.typeKey ?? null, message: remoteMessage(status, body) };
  if (status >= 300 && status < 400) {
    // Redirects aren't followed: a redirect to the sign-in page means the token was refused.
    const location = res.headers.location ?? '';
    if (/sign[-_]?in|login|_signin/i.test(location))
      return new HttpError(
        502,
        ErrorCodes.REMOTE_AUTH_FAILED,
        'Azure DevOps Server refused the personal access token',
        details,
      );
    return new HttpError(
      502,
      ErrorCodes.UPSTREAM_FAILED,
      'Azure DevOps Server redirected the request: check the collection URL',
      {
        ...details,
        location: location.slice(0, 500),
      },
    );
  }
  if (status === 401 || status === 403 || status === 203)
    return new HttpError(
      502,
      ErrorCodes.REMOTE_AUTH_FAILED,
      'Azure DevOps Server refused the personal access token',
      details,
    );
  if (status === 429 || (status === 503 && res.headers['retry-after'])) {
    const retry = retryAfterSeconds(res.headers['retry-after']);
    return new HttpError(429, ErrorCodes.REMOTE_RATE_LIMITED, 'Azure DevOps Server is throttling requests', {
      ...details,
      retryAfterSeconds: retry,
    });
  }
  if (isRevisionConflict(status, err))
    return new HttpError(
      409,
      ErrorCodes.REMOTE_CONFLICT,
      'The work item changed in Azure DevOps since it was read',
      details,
    );
  if (status >= 400 && status < 500)
    return new HttpError(422, ErrorCodes.REMOTE_REJECTED, details.message, details);
  return new HttpError(502, ErrorCodes.UPSTREAM_FAILED, `Azure DevOps Server answered ${status}`, details);
}

/**
 * The `api-version` to send. Azure DevOps Server (2025+) serves most resources at 7.2 only as previews
 * (`7.2-preview.N`), and a preview request is accepted for released resources too: 7.2 is always asked as
 * `7.2-preview`. Older versions are sent as they are; a resource that is still a preview there is retried once.
 */
export const requestVersion = (version: string) => (version === '7.2' ? '7.2-preview' : version);

/** The collection URL of a connection, without a trailing slash. */
export const collectionUrl = (conn: AzdoConn) => normalizeCollectionUrl(conn.config.collectionUrl);

/** Path segment of a project, repository or type name (spaces, `#`, non-ASCII). */
export const seg = (value: string) => encodeURIComponent(value);

/**
 * One REST call against the collection: Basic auth with the PAT (empty user name), `api-version` in the
 * query, JSON in and out. Only `conn.http` (the connection's own host) is used.
 */
export async function azdo<T = unknown>(
  conn: AzdoConn,
  path: string,
  opts: RequestOptions = {},
): Promise<AzdoResponse<T>> {
  const version = requestVersion(opts.apiVersion ?? conn.config.apiVersion);
  try {
    return await send<T>(conn, path, opts, version);
  } catch (err) {
    // Some resources are still previews on older servers (work item type states on 2019): ask again as one.
    const typeKey = ((err as HttpError).details as { typeKey?: string } | undefined)?.typeKey;
    if (version && !version.includes('-preview') && typeKey === 'VssInvalidPreviewVersionException')
      return send<T>(conn, path, opts, `${version}-preview`);
    throw err;
  }
}

async function send<T>(
  conn: AzdoConn,
  path: string,
  opts: RequestOptions,
  version: string,
): Promise<AzdoResponse<T>> {
  const url = new URL(`${collectionUrl(conn)}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(opts.query ?? {}))
    if (v !== undefined) url.searchParams.set(k, String(v));
  if (version) url.searchParams.set('api-version', version);
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`:${conn.secrets.pat}`).toString('base64')}`,
    accept: 'application/json',
    // Ask for 401 instead of a redirect to the sign-in page when the token is refused.
    'x-tfs-fedauthredirect': 'Suppress',
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = `${opts.contentType ?? 'application/json'}; charset=utf-8`;
  }
  const res = await conn.http.request(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body,
    timeoutMs: 30_000,
    maxBytes: opts.maxBytes ?? 16 * 1024 * 1024,
    signal: conn.signal,
  });
  const parsed = parseBody(res);
  const html = /text\/html/i.test(res.headers['content-type'] ?? '');
  if (res.status >= 200 && res.status < 300 && res.status !== 203 && !html) {
    if (res.truncated)
      throw new HttpError(502, ErrorCodes.UPSTREAM_FAILED, 'The Azure DevOps Server response was too large', {
        status: res.status,
        reason: 'truncated',
      });
    return { status: res.status, body: parsed as T, headers: res.headers };
  }
  if (opts.allow?.includes(res.status))
    return { status: res.status, body: parsed as T, headers: res.headers };
  // A 2xx HTML page is the sign-in page of a server that ignored the PAT.
  if (res.status >= 200 && res.status < 300) throw toHttpError({ status: 203, headers: res.headers }, null);
  throw toHttpError(res, parsed);
}
