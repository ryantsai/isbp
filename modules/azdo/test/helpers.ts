import type { AddressInfo } from 'node:net';
import { createMockServer, MOCK_CREDENTIALS } from '@isbp/integration-mocks';
import type { CacheService, HttpClient, OutboundRequest } from '@isbp/sdk/server';
import { type AzdoConfig, azdoConfigSchema, type AzdoSecrets } from '../src/contracts';
import type { AzdoConn } from '../src/server/client';

export interface Mock {
  close(): Promise<void>;
  /** `http://localhost:<port>` */
  base: string;
  collectionUrl: string;
  /** Calls a `/_mock/…` control. */
  control<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** Calls the REST API as the demo token. */
  api<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<{ status: number; body: T }>;
}

export async function startMock(): Promise<Mock> {
  const app = await createMockServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://localhost:${(app.server.address() as AddressInfo).port}`;
  const collectionUrl = `${base}/ado/${MOCK_CREDENTIALS.ado.collection}`;
  const auth = `Basic ${Buffer.from(`:${MOCK_CREDENTIALS.ado.pat}`).toString('base64')}`;
  return {
    base,
    collectionUrl,
    close: () => app.close(),
    async control<T>(method: string, path: string, body?: unknown) {
      const res = await fetch(`${base}/_mock${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text}`);
      return (text ? JSON.parse(text) : null) as T;
    },
    async api<T>(method: string, path: string, body?: unknown, contentType = 'application/json') {
      const res = await fetch(`${collectionUrl}/${path}`, {
        method,
        headers: { authorization: auth, ...(body === undefined ? {} : { 'content-type': contentType }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
    },
  };
}

/** A fetch-based `HttpClient` like the kernel's (no redirects, byte cap), recording every call. */
export function recordingHttp(before?: (url: string, opts: OutboundRequest) => Promise<void>) {
  const calls: { method: string; url: string }[] = [];
  const http: HttpClient = {
    async request(url, opts = {}) {
      calls.push({ method: opts.method ?? 'GET', url });
      await before?.(url, opts);
      const started = Date.now();
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body:
          typeof opts.body === 'string' || !opts.body ? (opts.body ?? undefined) : new Uint8Array(opts.body),
        redirect: 'manual',
        signal: opts.signal,
      });
      const body = Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const max = opts.maxBytes ?? 1024 * 1024;
      return {
        status: res.status,
        headers,
        body: body.subarray(0, max),
        truncated: body.length > max,
        durationMs: Date.now() - started,
      };
    },
  };
  return { http, calls };
}

/** An in-memory `CacheService` (TTLs honoured). */
export function memoryCache(): CacheService & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const expires = new Map<string, number>();
  const live = (key: string) => {
    const at = expires.get(key);
    if (at !== undefined && at < Date.now()) {
      store.delete(key);
      expires.delete(key);
    }
    return store.has(key);
  };
  return {
    store,
    async get<T>(key: string) {
      return live(key) ? (structuredClone(store.get(key)) as T) : null;
    },
    async set(key, value, ttl) {
      store.set(key, structuredClone(value));
      expires.set(key, Date.now() + ttl * 1000);
    },
    async delete(key) {
      store.delete(key);
      expires.delete(key);
    },
    async increment(key, ttl) {
      const n = ((live(key) ? (store.get(key) as number) : 0) ?? 0) + 1;
      store.set(key, n);
      expires.set(key, Date.now() + ttl * 1000);
      return n;
    },
    async rateLimit() {
      return { allowed: true, remaining: 1, resetSeconds: 1 };
    },
  };
}

/** A connector context for a connection to the mock. */
export function connFor(
  mock: Mock,
  opts: {
    pat?: string;
    apiVersion?: AzdoConfig['apiVersion'];
    before?: (url: string, opts: OutboundRequest) => Promise<void>;
  } = {},
): AzdoConn & { calls: { method: string; url: string }[]; cacheStore: Map<string, unknown> } {
  const { http, calls } = recordingHttp(opts.before);
  const cache = memoryCache();
  const config = azdoConfigSchema.parse({ collectionUrl: mock.collectionUrl, apiVersion: opts.apiVersion });
  const secrets: AzdoSecrets = { pat: opts.pat ?? MOCK_CREDENTIALS.ado.pat };
  return { connectionId: 'test', config, secrets, http, cache, calls, cacheStore: cache.store };
}

/** A fresh context (empty per-call memo) sharing the same cache: what the kernel builds per hub call. */
export function again<C extends AzdoConn>(conn: C): C {
  return { ...conn };
}

/** Waits until `fn` returns a truthy value. */
export async function eventually<T>(fn: () => T | Promise<T>, timeoutMs = 5000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}
