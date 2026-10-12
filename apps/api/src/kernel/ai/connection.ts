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
let insecureAgent: Agent | undefined;
const insecure = () => (insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } }));

/**
 * `fetch` for a connection: undici's own, so the TLS switch applies (Node's global `fetch` can't take a dispatcher
 * from another undici copy reliably). The Anthropic SDK and the OpenAI-style providers both call through it.
 */
export function connectionFetch(conn: Pick<AiConnection, 'insecureTls'>): typeof fetch {
  const dispatcher = conn.insecureTls ? insecure() : undefined;
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
  const base: Record<string, string> = { 'content-type': 'application/json', accept: '*/*' };
  if (conn.apiKey && opts.authHeader !== 'none') {
    if (azure) base['api-key'] = conn.apiKey;
    else base.authorization = `Bearer ${conn.apiKey}`;
  }
  const headers = headerObject(conn.headers, base);
  let res: Response;
  try {
    res = await connectionFetch(conn)(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
  } catch (err) {
    throw providerError(tlsReason(err) ?? 'unreachable', err);
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
