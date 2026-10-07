import { createMockServer, MOCK_CREDENTIALS } from '@isbp/integration-mocks';
import {
  type CacheService,
  type ConnectorContext,
  ErrorCodes,
  type HttpClient,
  HttpError,
} from '@isbp/sdk/server';
import type { FastifyInstance } from 'fastify';
import { type SdpConfig, sdpConfigSchema, type SdpSecrets } from '../src/contracts';
import { sdpConnector } from '../src/server/connector';

/** An in-memory stand-in for the connection's Redis cache. */
export function memoryCache(): CacheService & { entries: Map<string, { value: unknown; until: number }> } {
  const entries = new Map<string, { value: unknown; until: number }>();
  const live = (key: string) => {
    const e = entries.get(key);
    if (e && e.until > Date.now()) return e;
    entries.delete(key);
    return null;
  };
  return {
    entries,
    async get<T>(key: string) {
      return (live(key)?.value as T | undefined) ?? null;
    },
    async set(key, value, ttl) {
      entries.set(key, { value: structuredClone(value), until: Date.now() + ttl * 1000 });
    },
    async delete(key) {
      entries.delete(key);
    },
    async increment(key, ttl) {
      const n = Number(live(key)?.value ?? 0) + 1;
      entries.set(key, { value: n, until: Date.now() + ttl * 1000 });
      return n;
    },
    async rateLimit(key, limit, windowSeconds) {
      const n = await this.increment(key, windowSeconds);
      return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetSeconds: windowSeconds };
    },
  };
}

/**
 * A small `fetch`-based `HttpClient` limited to `hosts`, like the kernel's connector-scoped `ctx.http`
 * (other hosts: 422 `TARGET_BLOCKED`; network failures: 502 `UPSTREAM_FAILED`).
 */
export function fetchClient(hosts: string[], log: { method: string; url: string }[] = []): HttpClient {
  return {
    async request(url, opts = {}) {
      const host = new URL(url).hostname;
      if (!hosts.includes(host))
        throw new HttpError(422, ErrorCodes.TARGET_BLOCKED, `${host} is not one of this connection's hosts`);
      const started = Date.now();
      log.push({ method: opts.method ?? 'GET', url });
      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: opts.headers,
          body: typeof opts.body === 'string' ? opts.body : opts.body ? new Uint8Array(opts.body) : undefined,
          signal: opts.signal,
          redirect: 'manual',
        });
      } catch (err) {
        throw new HttpError(502, ErrorCodes.UPSTREAM_FAILED, (err as Error).message, { reason: 'network' });
      }
      const max = opts.maxBytes ?? 1024 * 1024;
      const buf = Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      return {
        status: res.status,
        headers,
        body: buf.subarray(0, max),
        truncated: buf.length > max,
        durationMs: Date.now() - started,
      };
    },
  };
}

export interface MockSdp {
  app: FastifyInstance;
  base: string;
  config: SdpConfig;
  secrets: SdpSecrets;
  /** A connection to the mock (a fresh cache unless one is given). */
  conn(opts?: {
    config?: Partial<SdpConfig>;
    secrets?: Partial<SdpSecrets>;
    cache?: CacheService;
    log?: { method: string; url: string }[];
  }): ConnectorContext<SdpConfig, SdpSecrets>;
  /** Calls a mock route (test controls). */
  control<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  close(): Promise<void>;
}

export async function startMock(): Promise<MockSdp> {
  const app = await createMockServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://localhost:${port}`;
  const config = sdpConfigSchema.parse({ baseUrl: `${base}/sdp` });
  const secrets: SdpSecrets = { apiKey: MOCK_CREDENTIALS.sdp.apiKey };
  return {
    app,
    base,
    config,
    secrets,
    conn(opts = {}) {
      const cfg = { ...config, ...opts.config };
      return {
        connectionId: 'test-connection',
        config: cfg,
        secrets: { ...secrets, ...opts.secrets },
        http: fetchClient(sdpConnector.hosts(cfg), opts.log),
        cache: opts.cache ?? memoryCache(),
      };
    },
    async control<T>(method: string, path: string, body?: unknown) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text}`);
      return (text ? JSON.parse(text) : null) as T;
    },
    close: () => app.close(),
  };
}

/** The `HttpError` a promise rejects with. */
export async function errorOf(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}
