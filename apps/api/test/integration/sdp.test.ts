/**
 * The ServiceDesk Plus (on-premises) connector (`sdp.server`) through the kernel, as the Integrations Hub opens
 * it (`ctx.connectors`): settings validation, the host-limited `ctx.http` (private addresses allowed for the
 * connection's own host, plain HTTP only when allowed or on loopback), the capability checks, against the
 * stand-in mock started in-process.
 *
 * DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_sdp_test REDIS_URL=redis://localhost:6379/12 \
 *   ISBP_TEST_MODULES=sdp npx vitest run --project integration test/integration/sdp.test.ts
 */
import { uuidv7 } from '@isbp/db/schema';
import { createMockServer, MOCK_CREDENTIALS } from '@isbp/integration-mocks';
import { type ConnectorsService, ErrorCodes, HttpError } from '@isbp/sdk/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
let mock: FastifyInstance;
let base: string;

const connectors = (): ConnectorsService => h.kernel.registry.context('core').connectors;

const config = () => ({ baseUrl: `${base}/sdp` });
const secrets = { apiKey: MOCK_CREDENTIALS.sdp.apiKey };

async function errorOf(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}

beforeAll(async () => {
  h = await createHarness();
  mock = await createMockServer();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  base = `http://localhost:${(mock.server.address() as { port: number }).port}`;
}, 60_000);

afterAll(async () => {
  await mock?.close();
  await h?.close();
});

describe('sdp.server through ctx.connectors', () => {
  it('is listed with its objects and its one secret', () => {
    const info = connectors()
      .list()
      .find((c) => c.type === 'sdp.server');
    expect(info).toMatchObject({ moduleId: 'sdp', name: 'sdp.connector.name', secretKeys: ['apiKey'] });
    expect(info!.objects.map((o) => [o.type, o.capabilities.comments])).toEqual([
      ['request', true],
      ['problem', false],
      ['change', false],
      ['asset', false],
      ['solution', false],
    ]);
  });

  it('validates settings', () => {
    expect(connectors().validate('sdp.server', config(), secrets).config).toEqual(config());
    // Plain HTTP is a connection switch (kernel), not a schema rule.
    expect(() =>
      connectors().validate('sdp.server', { baseUrl: 'http://sdp.contoso.local:8080' }, secrets),
    ).not.toThrow();
    let err: HttpError | null = null;
    try {
      connectors().validate('sdp.server', { baseUrl: 'https://svc:pw@sdp.contoso.local', portalId: 'x' }, {});
    } catch (e) {
      err = e as HttpError;
    }
    expect(err?.code).toBe(ErrorCodes.VALIDATION_FAILED);
    const paths = (err!.details as { issues: { path: string }[] }).issues.map((i) => i.path).sort();
    expect(paths).toEqual(['config.baseUrl', 'config.portalId', 'secrets.apiKey']);
  });

  it('tests the connection and reads the change feed', async () => {
    const conn = connectors().open('sdp.server', { id: uuidv7(), config: config(), secrets });
    expect(conn.hosts()).toEqual(['localhost']);
    expect((await conn.test()).ok).toBe(true);

    const page = await conn.changes('request', { cursor: null, limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    const first = page.items[0]!;
    expect(await conn.get('request', first.id)).toMatchObject({ id: first.id, ref: first.ref });

    const fields = await conn.fields('request');
    expect(fields.find((f) => f.key === 'status')?.choices?.length).toBeGreaterThan(3);
    expect(conn.defaultMapping('request', 'itsm.ticket').length).toBeGreaterThan(5);
  });

  it('scans changes (no update time), remembering it in the connection’s Redis', async () => {
    const id = uuidv7();
    const conn = connectors().open('sdp.server', { id, config: config(), secrets });
    const page = await conn.changes('change', { cursor: null, limit: 10 });
    expect(page.items).toHaveLength(5);
    expect(page.items.every((i) => i.version.startsWith('h:'))).toBe(true);
    expect(await h.kernel.redis.get(`isbp:m:sdp:conn:${id}:feed:change`)).toBe('"scan"');
  });

  it('updates with optimistic concurrency and adds notes', async () => {
    const conn = connectors().open('sdp.server', { id: uuidv7(), config: config(), secrets });
    const [req] = (await conn.changes('request', { cursor: null, limit: 1 })).items;
    const updated = await conn.update(
      'request',
      req!.id,
      { priority: 'High' },
      { expectedVersion: req!.version },
    );
    expect(updated.values.priority).toBe('High');
    const stale = await errorOf(
      conn.update('request', req!.id, { priority: 'Low' }, { expectedVersion: req!.version }),
    );
    expect(stale.code).toBe(ErrorCodes.REMOTE_CONFLICT);

    const note = await conn.comments.add('request', req!.id, {
      body: 'From ISBP',
      format: 'text',
      internal: true,
    });
    expect(note).toMatchObject({ internal: true, body: '<p>From ISBP</p>' });
    expect((await errorOf(conn.comments.list('asset', '1'))).code).toBe(ErrorCodes.NOT_SUPPORTED);
  });

  it('reports a refused API key', async () => {
    const bad = connectors().open('sdp.server', {
      id: uuidv7(),
      config: config(),
      secrets: { apiKey: 'revoked' },
    });
    expect((await errorOf(bad.get('request', '1'))).code).toBe(ErrorCodes.REMOTE_AUTH_FAILED);
    expect((await bad.test()).ok).toBe(false);
  });

  it('refuses plain HTTP to a non-loopback server unless the connection allows it', async () => {
    const conn = connectors().open('sdp.server', {
      id: uuidv7(),
      config: { baseUrl: 'http://sdp.contoso.invalid:8080' },
      secrets,
    });
    expect(conn.hosts()).toEqual(['sdp.contoso.invalid']);
    expect((await errorOf(conn.test())).code).toBe(ErrorCodes.INSECURE_HTTP);
    // Allowed: the call goes out (and fails to resolve the made-up host).
    const allowed = connectors().open('sdp.server', {
      id: uuidv7(),
      config: { baseUrl: 'http://sdp.contoso.invalid:8080' },
      secrets,
      allowInsecureHttp: true,
    });
    expect(await allowed.test()).toMatchObject({ ok: false });
  });

  it('parses webhooks the way the documented trigger sends them', async () => {
    const conn = connectors().open('sdp.server', { id: uuidv7(), config: config(), secrets });
    expect(await conn.webhook({ headers: {}, body: { module: 'change', id: '100000000000042' } })).toEqual([
      { objectType: 'change', id: '100000000000042' },
    ]);
  });
});
