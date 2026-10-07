/**
 * Stand-ins for the outside systems Phase 5 integrates with, so development, tests and the demo run without
 * them:
 *
 * - `/sdp/api/v3/…`: ManageEngine ServiceDesk Plus (on-premises) REST API v3, technician API key auth.
 * - `/ado/<collection>/…`: Azure DevOps Server (on-premises) REST API (work items, projects, Git).
 * - `/_mock/…`: test controls: reset, inspect, edit records "as someone in the outside system", webhooks.
 *
 * They follow the real APIs' shapes closely enough for the connectors to run unchanged against either. The
 * credentials they accept are the demo values in `credentials.ts`.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { adoMock } from './ado';
import { MockStore } from './store';
import { sdpMock } from './sdp';

export { MOCK_CREDENTIALS } from './credentials';
export type { MockWebhook } from './store';
export { MockStore } from './store';

export interface MockPlugin {
  /** URL prefix and state key: `sdp` or `ado`. */
  name: 'sdp' | 'ado';
  register(app: FastifyInstance, ctx: MockContext): void;
}

export interface MockContext {
  store: MockStore;
  /** Absolute base URL of this server (for links in responses). */
  baseUrl(): string;
  /** POSTs to every webhook registered for `system` (fire and forget). */
  notify(system: 'sdp' | 'ado', body: unknown): void;
}

export interface MockServerOptions {
  /** Persist state to this JSON file (dev stack); in memory only when omitted (tests). */
  dataFile?: string | null;
  logger?: boolean;
}

export async function createMockServer(opts: MockServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const store = new MockStore(opts.dataFile ?? null);
  // ServiceDesk Plus sends form-encoded `input_data`; Azure DevOps sends JSON Patch.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );
  app.addContentTypeParser('application/json-patch+json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const ctx: MockContext = {
    store,
    baseUrl: () => {
      const addr = app.server.address();
      return addr && typeof addr === 'object' ? `http://localhost:${addr.port}` : '';
    },
    notify: (system, body) => {
      for (const hook of store.webhooks.filter((w) => w.system === system)) {
        void fetch(hook.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...hook.headers },
          body: JSON.stringify(body),
        }).catch(() => undefined);
      }
    },
  };

  app.get('/_mock/health', async () => ({ ok: true }));
  app.post('/_mock/reset', async () => {
    store.reset();
    return { ok: true };
  });
  app.get('/_mock/webhooks', async () => store.webhooks);
  app.post<{ Body: { system: 'sdp' | 'ado'; url: string; headers?: Record<string, string> } }>(
    '/_mock/webhooks',
    async (req) => {
      const hook = {
        id: `wh-${store.webhooks.length + 1}`,
        system: req.body.system,
        url: req.body.url,
        headers: req.body.headers ?? {},
      };
      store.webhooks = [...store.webhooks.filter((w) => w.url !== hook.url), hook];
      store.changed();
      return hook;
    },
  );
  app.delete('/_mock/webhooks', async () => {
    store.webhooks = [];
    store.changed();
    return { ok: true };
  });

  for (const plugin of [sdpMock, adoMock]) plugin.register(app, ctx);
  app.addHook('onClose', async () => store.flush());
  return app;
}
