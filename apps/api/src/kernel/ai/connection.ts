import { ErrorCodes, HttpError } from '@isbp/sdk/server';
import { Agent, fetch as undiciFetch } from 'undici';

/** A custom header an admin set on an AI endpoint (value decrypted: server use only). */
export interface AiHeader {
  name: string;
  value: string;
}

/**
 * Where and how the gateway reaches one AI endpoint (chat, embeddings, reranker, …). Every endpoint takes the same
 * options: a key, custom headers (gateways often need a tenant or routing header) and, for self-signed gateways on
 * the customer's network, an audited switch that skips TLS certificate checks.
 */
export interface AiConnection {
  baseUrl: string;
  apiKey: string | null;
  headers: AiHeader[];
  insecureTls: boolean;
}

/** Stored as one sealed setting: a JSON list of `{ name, value }`. Anything malformed reads as no headers. */
export function parseHeaders(raw: unknown): AiHeader[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (h): h is AiHeader =>
          !!h && typeof h === 'object' && typeof h.name === 'string' && typeof h.value === 'string',
      )
      .map((h) => ({ name: h.name, value: h.value }));
  } catch {
    return [];
  }
}

/**
 * The stored list after an update: `next` replaces it, and a header sent without a value keeps the stored value of
 * the same name (names compare case-insensitively). A new header without a value is dropped.
 */
export function mergeHeaders(stored: AiHeader[], next: { name: string; value?: string }[]): AiHeader[] {
  const old = new Map(stored.map((h) => [h.name.toLowerCase(), h.value]));
  const out: AiHeader[] = [];
  for (const h of next) {
    const name = h.name.trim();
    const value = h.value ?? old.get(name.toLowerCase());
    if (value !== undefined) out.push({ name, value });
  }
  return out;
}

// One dispatcher for every insecure connection: certificate checks off, nothing else changed.
/** undici's own limits (300 s for headers and body) cut off a long synchronous OCR call: these agents wait longer. */
const LONG_TIMEOUT_MS = 20 * 60_000;
const agents = new Map<string, Agent>();
function agent(insecure: boolean, long: boolean): Agent | undefined {
  if (!insecure && !long) return undefined;
  const key = `${insecure}:${long}`;
  let a = agents.get(key);
  if (!a)
    agents.set(
      key,
      (a = new Agent({
        ...(insecure ? { connect: { rejectUnauthorized: false } } : {}),
        ...(long ? { headersTimeout: LONG_TIMEOUT_MS, bodyTimeout: LONG_TIMEOUT_MS } : {}),
      })),
    );
  return a;
}

/**
 * `fetch` for a connection: undici's own, so the TLS switch applies (Node's global `fetch` can't take a dispatcher
 * from another undici copy reliably). The Anthropic SDK and the OpenAI-style providers both call through it.
 * `long` allows responses that take up to 20 minutes (document extraction).
 */
export function connectionFetch(conn: Pick<AiConnection, 'insecureTls'>, long = false): typeof fetch {
  const dispatcher = agent(conn.insecureTls, long);
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      {
        ...(init as Parameters<typeof undiciFetch>[1]),
        ...(dispatcher ? { dispatcher } : {}),
      } as Parameters<typeof undiciFetch>[1],
    )) as unknown as typeof fetch;
}

/**
 * Custom headers applied over `base` (names compare case-insensitively, so `Authorization` replaces the
 * `authorization` the platform set). Without `base`, just the custom headers as an object.
 */
export function headerObject(headers: AiHeader[], base: Record<string, string> = {}): Record<string, string> {
  const out = { ...base };
  for (const h of headers) {
    for (const key of Object.keys(out)) if (key.toLowerCase() === h.name.toLowerCase()) delete out[key];
    out[h.name] = h.value;
  }
  return out;
}

export const isAzure = (baseUrl: string) => /\.openai\.azure\.com/i.test(baseUrl);

/**
 * POST JSON to an OpenAI-style endpoint (`/chat/completions`, `/responses`, `/embeddings`, `/rerank`, …). Azure
 * OpenAI takes its key in `api-key` and needs an `api-version` (unless the URL is its `/openai/v1` API). Custom
 * headers are applied last, so an admin can replace the authorization header for a gateway that wants another one.
 */
export async function aiPost(
  conn: AiConnection,
  path: string,
  body: unknown,
  opts: { signal?: AbortSignal; timeoutMs?: number; authHeader?: 'bearer' | 'none' } = {},
): Promise<Response> {
  const azure = isAzure(conn.baseUrl);
  const url = new URL(conn.baseUrl.replace(/\/+$/, '') + path);
  if (azure && !url.searchParams.has('api-version') && !/\/openai\/v1(\/|$)/.test(url.pathname))
    url.searchParams.set('api-version', '2024-10-21');
  const auth: Record<string, string> = {};
  if (conn.apiKey && opts.authHeader !== 'none') {
    if (azure) auth['api-key'] = conn.apiKey;
    else auth.authorization = `Bearer ${conn.apiKey}`;
  }
  return aiRequest(conn, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify(body),
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * Any request to an AI endpoint (`url` absolute, or a path under the base URL): the connection's TLS switch and
 * custom headers (applied last), a timeout, and failures as `AI_PROVIDER_ERROR` with a `reason` (`auth`,
 * `rate_limited`, `status_<n>`, `unreachable`, `tls`, `timeout`).
 */
export async function aiRequest(
  conn: AiConnection,
  url: string | URL,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | FormData | Uint8Array;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const long = (init.timeoutMs ?? 0) > 280_000;
  const target =
    typeof url === 'string' && !/^https?:/i.test(url) ? conn.baseUrl.replace(/\/+$/, '') + url : url;
  const headers = headerObject(conn.headers, { accept: '*/*', ...init.headers });
  let res: Response;
  try {
    res = await connectionFetch(conn, long)(target, {
      method: init.method ?? 'GET',
      headers,
      body: init.body as RequestInit['body'],
      signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 120_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw providerError(timedOut ? 'timeout' : (tlsReason(err) ?? 'unreachable'), err);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    const reason =
      res.status === 401 || res.status === 403
        ? 'auth'
        : res.status === 429
          ? 'rate_limited'
          : `status_${res.status}`;
    throw new HttpError(502, ErrorCodes.AI_PROVIDER_ERROR, 'The AI provider request failed', {
      reason,
      detail,
    });
  }
  return res;
}

export function providerError(reason: string, err?: unknown): HttpError {
  const detail = errorDetail(err);
  return new HttpError(502, ErrorCodes.AI_PROVIDER_ERROR, 'The AI provider request failed', {
    reason,
    detail,
  });
}

/** The message of an error and its causes (undici hides the TLS or DNS reason in `cause`). */
function errorDetail(err: unknown): string | undefined {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur instanceof Error; i++) {
    if (cur.message && !parts.includes(cur.message)) parts.push(cur.message);
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  return parts.length ? parts.join(': ').slice(0, 200) : undefined;
}

/** `tls` when a connection failed on the certificate (the admin may need the TLS switch or a trusted CA). */
export function tlsReason(err: unknown): 'tls' | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (
      typeof code === 'string' &&
      /^(CERT_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO|ERR_TLS|ERR_SSL|HOSTNAME_MISMATCH|ERR_TLS_CERT)/.test(code)
    )
      return 'tls';
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}
