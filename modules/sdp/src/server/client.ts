/**
 * ServiceDesk Plus (on-premises) REST API v3 over `conn.http`: the technician API key (`authtoken` header), the
 * optional `PORTALID` header, `input_data` encoding, and the typed errors of the connector contract.
 */
import { type ConnectorContext, ErrorCodes, HttpError, type OutboundResponse } from '@isbp/sdk/server';
import { type SdpConfig, type SdpSecrets, serverRoot } from '../contracts';

export type SdpConn = ConnectorContext<SdpConfig, SdpSecrets>;

export const ACCEPT = 'application/vnd.manageengine.sdp.v3+json';

const DEFAULT_RETRY_AFTER_S = 60;

function json(res: OutboundResponse): Record<string, unknown> | null {
  if (!res.body.length) return null;
  try {
    const v: unknown = JSON.parse(res.body.toString('utf8'));
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * ServiceDesk Plus throttles per URL and locks the URL for a while; its answer reads like "URL configured to access
 * 30 requests within 1 minutes was violated" or "…maximum access limit for the page is exceeded". The status code
 * of that answer is not documented, so the text decides.
 */
const THROTTLED_RE = /within\s+\d+\s+minutes?[^.]*?violated|maximum access limit/i;
const MINUTES_RE = /within\s+(\d+)\s+minutes?/i;

/** The throttle message in an answer's body, if any. */
export function throttleMessage(res: OutboundResponse): string | null {
  const text = res.body.subarray(0, 16 * 1024).toString('utf8');
  const m = THROTTLED_RE.exec(text);
  if (!m) return null;
  // The sentence around the match, without markup.
  const start = Math.max(0, text.lastIndexOf('"', m.index) + 1, text.lastIndexOf('>', m.index) + 1);
  return text
    .slice(start, Math.min(text.length, start + 300))
    .split(/["<]/)[0]!
    .trim();
}

/**
 * Seconds to wait: a `Retry-After` header (delta seconds or an HTTP date), else the minutes the throttle message
 * names, else 60.
 */
export function retryAfterSeconds(res: OutboundResponse, message?: string | null): number {
  const h = res.headers['retry-after'];
  if (h) {
    const n = Number(h);
    if (Number.isFinite(n) && n >= 0) return Math.min(Math.ceil(n), 3600);
    const at = Date.parse(h);
    if (!Number.isNaN(at)) return Math.min(Math.max(1, Math.ceil((at - Date.now()) / 1000)), 3600);
  }
  const minutes = message ? Number(MINUTES_RE.exec(message)?.[1]) : NaN;
  if (Number.isFinite(minutes) && minutes > 0) return Math.min(minutes * 60, 3600);
  return DEFAULT_RETRY_AFTER_S;
}

interface SdpMessage {
  status_code?: unknown;
  message?: unknown;
  field?: unknown;
  fields?: unknown;
  type?: unknown;
}

/** `response_status` is an object (single record) or an array (lists); either way, its messages. */
function messagesOf(body: Record<string, unknown> | null): SdpMessage[] {
  if (!body) return [];
  const rs = body.response_status;
  const statuses = (Array.isArray(rs) ? rs : rs ? [rs] : []) as Record<string, unknown>[];
  return statuses.flatMap((s) => [
    ...(Array.isArray(s.messages) ? (s.messages as SdpMessage[]) : []),
    ...(s.status_code && s.status_code !== 2000 && !Array.isArray(s.messages) ? [s as SdpMessage] : []),
  ]);
}

const codes = (messages: SdpMessage[]) => messages.map((m) => Number(m.status_code)).filter(Number.isFinite);

function describe(messages: SdpMessage[], fallback: string): string {
  const parts = messages.map((m) => {
    const text =
      typeof m.message === 'string' && m.message ? m.message : `status ${String(m.status_code ?? '?')}`;
    const field =
      typeof m.field === 'string' && m.field ? m.field : Array.isArray(m.fields) ? m.fields.join(', ') : '';
    return field ? `${field}: ${text}` : text;
  });
  return parts.join('; ') || fallback;
}

/** A record that does not exist (HTTP 404 or status 4007). */
export class NotFound extends HttpError {
  constructor(message = 'Not found in ServiceDesk Plus') {
    super(404, ErrorCodes.NOT_FOUND, message);
  }
}

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Calls `<baseUrl>/api/v3<path>` and returns the JSON body. Errors: 401 or status 4022 (a wrong, expired or
 * disabled API key) → 502 `REMOTE_AUTH_FAILED`; 404/4007 → {@link NotFound}; 429, 4015 or the throttle
 * message ("…requests within N minutes was violated", "maximum access limit") → 429 `REMOTE_RATE_LIMITED`; other 4xx → 422 `REMOTE_REJECTED` with ServiceDesk Plus' messages; 5xx and unreadable
 * answers → 502 `UPSTREAM_FAILED`. `conn.http`'s own errors (network, `TARGET_BLOCKED`, `INSECURE_HTTP`) pass
 * through unchanged.
 */
export async function sdpCall(
  conn: SdpConn,
  method: Method,
  path: string,
  input?: unknown,
): Promise<Record<string, unknown>> {
  let url = `${serverRoot(conn.config)}/api/v3${path}`;
  const headers: Record<string, string> = { accept: ACCEPT, authtoken: conn.secrets.apiKey };
  if (conn.config.portalId) headers.portalid = conn.config.portalId;
  let body: string | null = null;
  const encoded = input === undefined ? null : `input_data=${encodeURIComponent(JSON.stringify(input))}`;
  if (encoded && (method === 'GET' || method === 'DELETE')) url += `?${encoded}`;
  else if (encoded) {
    body = encoded;
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  const res = await conn.http.request(url, {
    method,
    headers,
    body,
    timeoutMs: 30_000,
    maxBytes: 8 * 1024 * 1024,
    signal: conn.signal,
  });

  const parsed = json(res);
  const messages = messagesOf(parsed);
  const statusCodes = codes(messages);
  const ok = res.status >= 200 && res.status < 300 && parsed !== null;
  const throttle = ok ? null : throttleMessage(res);
  if (throttle || res.status === 429 || statusCodes.includes(4015)) {
    const message = throttle ?? (describe(messages, '') || null);
    throw new HttpError(429, ErrorCodes.REMOTE_RATE_LIMITED, 'ServiceDesk Plus is throttling requests', {
      retryAfterSeconds: retryAfterSeconds(res, message),
      ...(message ? { message } : {}),
    });
  }
  if (res.status === 401 || statusCodes.includes(4022))
    throw new HttpError(
      502,
      ErrorCodes.REMOTE_AUTH_FAILED,
      `ServiceDesk Plus refused the API key: ${describe(messages, 'HTTP 401')}`,
      { codes: statusCodes },
    );
  if (res.status === 404 || statusCodes.includes(4007)) throw new NotFound(describe(messages, 'Not found'));
  if (res.status >= 500)
    throw new HttpError(502, ErrorCodes.UPSTREAM_FAILED, `ServiceDesk Plus answered ${res.status}`, {
      reason: 'response',
      status: res.status,
    });
  if (res.status >= 400)
    throw new HttpError(422, ErrorCodes.REMOTE_REJECTED, 'ServiceDesk Plus refused the request', {
      message: describe(messages, `HTTP ${res.status}`),
      status: res.status,
      codes: statusCodes,
    });
  if (res.status < 200 || res.status >= 300 || !parsed || res.truncated)
    throw new HttpError(
      502,
      ErrorCodes.UPSTREAM_FAILED,
      res.truncated
        ? 'The ServiceDesk Plus response was too large'
        : // A login page or a proxy's answer instead of JSON: usually a wrong base URL.
          `Unexpected ServiceDesk Plus response (HTTP ${res.status}${parsed ? '' : ', not JSON'})`,
      { reason: 'response', status: res.status },
    );
  return parsed;
}
