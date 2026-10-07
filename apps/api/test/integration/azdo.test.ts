/**
 * The Azure DevOps Server connector (`azdo.server`) through the kernel, as the Integrations Hub opens it
 * (`ctx.connectors`): settings validation, the host-limited `ctx.http` (plain HTTP only for loopback or with
 * "Allow insecure HTTP"), the connection-scoped Redis cache and the capability checks, against the stand-in
 * started in-process.
 *
 * DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_azdo_test REDIS_URL=redis://localhost:6379/13 \
 *   ISBP_TEST_MODULES=azdo npx vitest run --project integration test/integration/azdo.test.ts
 */
import { createMockServer, MOCK_CREDENTIALS } from '@isbp/integration-mocks';
import { uuidv7 } from '@isbp/db/schema';
import { type ConnectorsService, ErrorCodes, HttpError } from '@isbp/sdk/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
let mock: FastifyInstance;
let collectionUrl: string;

const connectors = (): ConnectorsService => h.kernel.registry.context('core').connectors;
const secrets = { pat: MOCK_CREDENTIALS.ado.pat };
const open = (
  config: Record<string, unknown> = {},
  extra: { secrets?: unknown; allowInsecureHttp?: boolean } = {},
) =>
  connectors().open('azdo.server', {
    id: uuidv7(),
    config: { collectionUrl, ...config },
    secrets: extra.secrets ?? secrets,
    ...(extra.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
  });

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
  collectionUrl = `http://localhost:${(mock.server.address() as { port: number }).port}/ado/${MOCK_CREDENTIALS.ado.collection}`;
}, 60_000);

afterAll(async () => {
  await mock?.close();
  await h?.close();
});

describe('azdo.server through ctx.connectors', () => {
  it('is listed with its objects, scopes and secret keys', () => {
    const info = connectors()
      .list()
      .find((c) => c.type === 'azdo.server');
    expect(info).toMatchObject({ moduleId: 'azdo', name: 'azdo.connector.name', secretKeys: ['pat'] });
    expect(
      info!.objects.map((o) => [o.type, o.scoped, o.capabilities.create, o.capabilities.hierarchy]),
    ).toEqual([
      ['project', false, false, false],
      ['work-item', true, true, true],
      ['repository', true, false, false],
    ]);
  });

  it('validates settings and fills the default API version', () => {
    expect(connectors().validate('azdo.server', { collectionUrl }, secrets).config).toEqual({
      collectionUrl,
      apiVersion: '7.2',
    });
    let err: HttpError | null = null;
    try {
      connectors().validate('azdo.server', { collectionUrl: 'ado.contoso.local', apiVersion: '9.9' }, {});
    } catch (e) {
      err = e as HttpError;
    }
    expect(err?.code).toBe(ErrorCodes.VALIDATION_FAILED);
    const paths = (err!.details as { issues: { path: string }[] }).issues.map((i) => i.path).sort();
    expect(paths).toEqual(['config.apiVersion', 'config.collectionUrl', 'secrets.pat']);
  });

  it('signs in through the host-limited http client and caches per connection', async () => {
    const conn = open();
    expect(conn.hosts()).toEqual(['localhost']);
    expect(await conn.test()).toMatchObject({
      ok: true,
      account: expect.stringContaining('DefaultCollection'),
    });
    const scopes = await conn.scopes('work-item');
    expect(scopes.map((s) => s.name)).toEqual(['ERP', 'Network', 'Zero Trust rollout']);
    const page = await conn.changes('work-item', { scope: scopes[0]!.id, cursor: null, limit: 5 });
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    const bad = open({}, { secrets: { pat: 'revoked' } });
    expect((await errorOf(bad.test())).code).toBe(ErrorCodes.REMOTE_AUTH_FAILED);
  });

  it('refuses plain HTTP to other hosts unless the connection allows it', async () => {
    const remote = open({ collectionUrl: 'http://ado.contoso.invalid/tfs/DefaultCollection' });
    expect((await errorOf(remote.test())).code).toBe(ErrorCodes.INSECURE_HTTP);
    const allowed = open(
      { collectionUrl: 'http://ado.contoso.invalid/tfs/DefaultCollection' },
      { allowInsecureHttp: true },
    );
    expect((await errorOf(allowed.test())).code).not.toBe(ErrorCodes.INSECURE_HTTP);
  });

  it('enforces capabilities and suggests mappings', async () => {
    const conn = open();
    expect((await errorOf(conn.create('repository', {}, {}))).code).toBe(ErrorCodes.NOT_SUPPORTED);
    expect((await errorOf(conn.comments.list('project', 'x'))).code).toBe(ErrorCodes.NOT_SUPPORTED);
    expect(conn.defaultMapping('repository', 'alm.repository').map((m) => m.local)).toContain('pullRequests');
    expect(
      await conn.webhook({
        headers: {},
        body: { eventType: 'workitem.updated', resource: { workItemId: 7 } },
      }),
    ).toEqual([{ objectType: 'work-item', id: '7', scope: null }]);
  });
});
