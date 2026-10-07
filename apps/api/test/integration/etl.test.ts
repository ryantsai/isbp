import { auditLogs, dbConnections, roleAssignments, roles, users } from '@isbp/db/schema';
import { calls, pipelineRuns, pipelines } from '@isbp/module-etl/schema';
import type { TaskContext } from '@isbp/sdk/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { toSessionUser } from '../../src/kernel/sessions';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/**
 * Data APIs & ETL against the test database itself: a schema `itest_etl` with a small table, a function and
 * warehouse tables, reached through `core.db_connections` rows that point back at this database.
 */
const MODULES = process.env.ISBP_TEST_MODULES;
const API = '/api/v1/etl';
const SCHEMA = 'itest_etl';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'dev' | 'viewer' | 'consumer' | 'scoped', string>;
const conn = {} as Record<'data' | 'readonly' | 'admin', string>;
let clientKey = '';
let clientRow = '';

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(username: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username[0]!.toUpperCase() + username.slice(1),
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

/** A raw call to a Data API (headers matter): as a person (session) or an API client (bearer key). */
async function invoke(
  who: Session | { bearer: string },
  method: 'GET' | 'POST',
  url: string,
  opts: { body?: unknown; accept?: string } = {},
) {
  const headers: Record<string, string> =
    'bearer' in who
      ? { authorization: `Bearer ${who.bearer}` }
      : { cookie: who.cookie, 'x-csrf-token': who.csrf };
  if (opts.accept) headers.accept = opts.accept;
  const res = await h.app.inject({ method, url, headers, payload: opts.body as object | undefined });
  let body: LooseJson = res.body;
  try {
    body = JSON.parse(res.body);
  } catch {
    /* CSV */
  }
  return { status: res.statusCode, headers: res.headers, body };
}

const exec = (statement: string) => h.kernel.db.execute(sql.raw(statement));

/** Minimal draft of a query endpoint on the test connection. */
const draft = (sqlText: string, params: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  connectionId: conn.data,
  kind: 'query',
  sql: sqlText,
  params,
  ...extra,
});

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? 'etl';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  stopWorker = await startWorker(h.kernel);
  const db = h.kernel.db;

  await exec(`drop schema if exists ${SCHEMA} cascade`);
  await exec(`
    create schema ${SCHEMA};
    create table ${SCHEMA}.customers (
      id serial primary key,
      code varchar(12) not null unique,
      name varchar(120) not null,
      region varchar(16) not null,
      updated_at timestamptz(3) not null default date_trunc('milliseconds', now())
    );
    insert into ${SCHEMA}.customers (code, name, region, updated_at)
    select 'C' || lpad(g::text, 5, '0'), 'Customer ' || g, (array['north','south','east'])[1 + g % 3],
           timestamptz '2026-01-01 00:00:00+00' + g * interval '1 hour'
      from generate_series(1, 30) g;
    update ${SCHEMA}.customers set name = '=HYPERLINK("http://evil")' where code = 'C00001';
    create function ${SCHEMA}.region_count(p_region varchar)
      returns table (region varchar, customers bigint)
      language sql stable as $$
        select c.region, count(*) from ${SCHEMA}.customers c where c.region = p_region group by c.region
      $$;
    create table ${SCHEMA}.customer_dim (
      customer_code varchar(12) primary key,
      name varchar(120) not null,
      region varchar(16) not null,
      loaded_at timestamptz not null default now()
    );
  `);

  const url = new URL(process.env.DATABASE_URL!);
  const base = {
    engine: 'postgres' as const,
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    username: decodeURIComponent(url.username),
    passwordSealed: h.kernel.box.encrypt(decodeURIComponent(url.password)),
    options: { tls: 'off' as const, ca: null, instanceName: null, domain: null },
    status: 'ok' as const,
  };
  const insertConn = async (key: string, purposes: ('data' | 'admin')[], readOnly: boolean) =>
    (
      await db
        .insert(dbConnections)
        .values({ ...base, key, name: key, purposes, readOnly, maxRows: 5_000 })
        .returning()
    )[0]!.id;
  conn.data = await insertConn('itest-data', ['data'], false);
  conn.readonly = await insertConn('itest-readonly', ['data'], true);
  conn.admin = await insertConn('itest-admin', ['admin'], false);

  ids.dev = await mkUser('dev');
  ids.viewer = await mkUser('viewer');
  ids.consumer = await mkUser('consumer');
  ids.scoped = await mkUser('scoped');
  await db.insert(roleAssignments).values([
    { roleId: await roleId('etl-developer'), userId: ids.dev },
    { roleId: await roleId('etl-viewer'), userId: ids.viewer },
    { roleId: await roleId('etl-consumer'), userId: ids.consumer },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'dev', 'viewer', 'consumer', 'scoped', 'outsider']) s[u] = await h.login(u);
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await exec(`drop schema if exists ${SCHEMA} cascade`).catch(() => undefined);
  await h?.close();
});

describe('endpoints: drafts, safety lint, test console and versions', () => {
  it('lists data connections and their catalog for developers only', async () => {
    const list = await h.call(s.dev!, 'GET', `${API}/connections`);
    expect(list.status).toBe(200);
    const keys = list.body.items.map((c: LooseJson) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['itest-data', 'itest-readonly']));
    expect(keys).not.toContain('itest-admin');
    expect(JSON.stringify(list.body)).not.toMatch(/password|isbp:isbp/);
    expect((await h.call(s.viewer!, 'GET', `${API}/connections`)).status).toBe(403);
    const catalog = await h.call(s.dev!, 'GET', `${API}/connections/${conn.data}/catalog`);
    expect(catalog.status).toBe(200);
    expect(catalog.body.tables.some((t: LooseJson) => t.schema === SCHEMA && t.name === 'customers')).toBe(
      true,
    );
    expect(catalog.body.procedures.some((p: LooseJson) => p.name === 'region_count')).toBe(true);
    const admin = await h.call(s.dev!, 'GET', `${API}/connections/${conn.admin}/catalog`);
    expect(admin.body.error.code).toBe('CONNECTION_PURPOSE');
  });

  it('creates an endpoint and refuses admin connections, bad slugs and writes', async () => {
    const purpose = await h.call(s.dev!, 'POST', `${API}/endpoints`, {
      name: 'Nope',
      slug: 'nope',
      connectionId: conn.admin,
    });
    expect(purpose.status).toBe(403);
    expect(purpose.body.error.code).toBe('CONNECTION_PURPOSE');
    const slug = await h.call(s.dev!, 'POST', `${API}/endpoints`, {
      name: 'Bad',
      slug: 'Bad_Slug',
      connectionId: conn.data,
    });
    expect(slug.status).toBe(400);
    expect(
      (
        await h.call(s.viewer!, 'POST', `${API}/endpoints`, {
          name: 'x',
          slug: 'xx',
          connectionId: conn.data,
        })
      ).status,
    ).toBe(403);

    const created = await h.call(s.dev!, 'POST', `${API}/endpoints`, {
      name: 'Customers by region',
      slug: 'itest-customers',
      connectionId: conn.data,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slug: 'itest-customers', status: 'draft', latestVersion: null });

    const writes = await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-customers`, {
      draft: draft(`DELETE FROM ${SCHEMA}.customers WHERE region = :region`, [
        { name: 'region', required: true },
      ]),
    });
    expect(writes.status).toBe(422);
    expect(writes.body.error).toMatchObject({
      code: 'WRITES_NOT_ALLOWED',
      details: { keywords: ['DELETE'] },
    });

    const readOnly = await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-customers`, {
      draft: { ...draft(`DELETE FROM ${SCHEMA}.customers`), connectionId: conn.readonly, allowsWrites: true },
    });
    expect(readOnly.body.error.code).toBe('CONNECTION_READ_ONLY');

    const badDefault = await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-customers`, {
      draft: draft(`SELECT 1 WHERE 1 = :n`, [{ name: 'n', type: 'integer', default: 'abc' }]),
    });
    expect(badDefault.status).toBe(400);
    expect(badDefault.body.error.details.issues[0].path).toBe('draft.params.0.default');
  });

  it('tests the draft: rows, columns, time, bound SQL; 409 TEST_REQUIRED until then', async () => {
    const saved = await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-customers`, {
      draft: draft(
        `SELECT code, name, region FROM ${SCHEMA}.customers WHERE region = :region ORDER BY code LIMIT :limit`,
        [
          { name: 'region', required: true, enum: ['north', 'south', 'east'] },
          { name: 'limit', type: 'integer', default: '5', min: 1, max: 50 },
          { name: 'token', sensitive: true },
        ],
      ),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.draftTested).toBe(false);

    const early = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/publish`, { note: 'first' });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('TEST_REQUIRED');

    const invalid = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/test`, {
      params: { region: 'west' },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.issues[0].path).toBe('params.region');

    const test = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/test`, {
      params: { region: 'north', limit: '3' },
    });
    expect(test.status).toBe(200);
    expect(test.body).toMatchObject({ ok: true, rowCount: 3, error: null, draftTested: true });
    expect(test.body.columns.map((c: LooseJson) => c.name)).toEqual(['code', 'name', 'region']);
    expect(test.body.boundSql).toContain('region = $1');
    expect(test.body.boundSql).toContain('LIMIT $2');
    expect(test.body.boundSql).not.toContain('north');

    const published = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/publish`, {
      note: 'first',
    });
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: 'published', latestVersion: 1 });
    expect(published.body.versions[0]).toMatchObject({ version: 1, status: 'published', note: 'first' });

    // A database error is reported, not thrown.
    await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-customers`, {
      draft: draft(`SELECT code, nope FROM ${SCHEMA}.customers WHERE region = :region`, [
        { name: 'region', required: true },
      ]),
    });
    const failing = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/test`, {
      params: { region: 'north' },
    });
    expect(failing.status).toBe(200);
    expect(failing.body).toMatchObject({ ok: false, draftTested: false, error: { dbCode: '42703' } });
    expect(
      (await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/publish`, {})).body.error.code,
    ).toBe('TEST_REQUIRED');

    // v2 adds a column; the slug is now fixed.
    await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-customers`, {
      draft: draft(
        `SELECT code, name, region, updated_at FROM ${SCHEMA}.customers WHERE region = :region ORDER BY code LIMIT :limit`,
        [
          { name: 'region', required: true, enum: ['north', 'south', 'east'] },
          { name: 'limit', type: 'integer', default: '5', min: 1, max: 50 },
          { name: 'token', sensitive: true },
        ],
        { cacheTtlSeconds: 60 },
      ),
    });
    expect(
      (await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/test`, { params: { region: 'south' } }))
        .body.ok,
    ).toBe(true);
    const v2 = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/publish`, {
      note: 'adds updated_at',
    });
    expect(v2.body.latestVersion).toBe(2);
    expect(v2.body.versions.map((v: LooseJson) => v.version)).toEqual([2, 1]);
    const slug = await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-customers`, { slug: 'renamed' });
    expect(slug.body.error.code).toBe('INVALID_STATE');

    const audit = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'etl.endpoint.published'));
    expect(audit.length).toBe(2);
  });

  it('runs a procedure endpoint with mapped arguments', async () => {
    await h.call(s.dev!, 'POST', `${API}/endpoints`, {
      name: 'Region count',
      slug: 'itest-region-count',
      connectionId: conn.data,
      kind: 'procedure',
    });
    const catalog = await h.call(s.dev!, 'GET', `${API}/connections/${conn.data}/catalog`);
    const proc = catalog.body.procedures.find((p: LooseJson) => p.name === 'region_count');
    const saved = await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-region-count`, {
      draft: {
        connectionId: conn.data,
        kind: 'procedure',
        procedure: proc,
        params: [{ name: 'region', required: true, target: 'p_region' }],
        responseShape: 'single',
      },
    });
    expect(saved.status).toBe(200);
    const test = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-region-count/test`, {
      params: { region: 'east' },
    });
    expect(test.body).toMatchObject({ ok: true, rows: [{ region: 'east', customers: '10' }] });
    expect(test.body.boundSql).toContain('"p_region" => $1');
    await h.call(s.dev!, 'POST', `${API}/endpoints/itest-region-count/publish`, {});

    const res = await invoke(s.dev!, 'GET', `${API}/data/itest-region-count?region=east`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ region: 'east', customers: '10' });
    const none = await invoke(s.dev!, 'GET', `${API}/data/itest-region-count?region=west`);
    expect(none.status).toBe(404);
  });
});

describe('invocation', () => {
  it('answers people with invoke, as JSON with meta, and validates parameters', async () => {
    const ok = await invoke(s.dev!, 'GET', `${API}/data/itest-customers?region=north&limit=2&token=s3cret`);
    expect(ok.status).toBe(200);
    expect(ok.body.meta).toMatchObject({ rows: 2, version: 2, truncated: false, cached: false });
    expect(Object.keys(ok.body.data[0])).toEqual(['code', 'name', 'region', 'updated_at']);
    expect(ok.headers['ratelimit-limit']).toBe('120');

    const bad = await invoke(s.dev!, 'GET', `${API}/data/itest-customers?region=west&limit=x&extra=1`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.details.issues.map((i: LooseJson) => i.path).sort()).toEqual([
      'extra',
      'limit',
      'region',
    ]);

    expect((await invoke(s.outsider!, 'GET', `${API}/data/itest-customers?region=north`)).status).toBe(403);
    expect((await invoke(s.viewer!, 'GET', `${API}/data/itest-customers?region=north`)).status).toBe(403);
    expect((await invoke(s.consumer!, 'GET', `${API}/data/itest-customers?region=north`)).status).toBe(200);
    expect(
      (await invoke(s.dev!, 'POST', `${API}/data/itest-customers`, { body: { region: 'north' } })).status,
    ).toBe(405);
    expect((await invoke(s.dev!, 'GET', `${API}/data/nope`)).status).toBe(404);
  });

  it('honours record-scoped invoke grants and the "allow people" switch', async () => {
    const ep = (await h.call(s.dev!, 'GET', `${API}/endpoints/itest-region-count`)).body;
    await h.kernel.db.insert(roleAssignments).values({
      roleId: await roleId('etl-consumer'),
      userId: ids.scoped,
      scopeType: 'record',
      scopeRecordType: 'etl.endpoint',
      scopeRecordId: ep.id,
    });
    await h.kernel.rbac.bump();
    expect((await invoke(s.scoped!, 'GET', `${API}/data/itest-region-count?region=east`)).status).toBe(200);
    expect((await invoke(s.scoped!, 'GET', `${API}/data/itest-customers?region=east`)).status).toBe(403);

    await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-region-count`, { allowUsers: false });
    expect((await invoke(s.scoped!, 'GET', `${API}/data/itest-region-count?region=east`)).status).toBe(403);
    await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-region-count`, { allowUsers: true });
  });

  it('lets API clients call only endpoints that allow them, hiding database details', async () => {
    const created = await h.call(s.admin!, 'POST', '/api/v1/api-clients', {
      name: 'Reporting robot',
      permissions: ['etl.endpoints.invoke'],
    });
    expect(created.status).toBe(201);
    clientKey = created.body.secret;
    clientRow = created.body.client.id;
    const bearer = { bearer: clientKey };

    const denied = await invoke(bearer, 'GET', `${API}/data/itest-customers?region=north`);
    expect(denied.status).toBe(403);
    const clients = await h.call(s.dev!, 'GET', `${API}/clients`);
    expect(clients.body.items.map((c: LooseJson) => c.name)).toContain('Reporting robot');
    const allowed = await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-customers`, {
      allowedClients: [clientRow],
    });
    expect(allowed.body.allowedClients).toEqual([
      expect.objectContaining({ id: clientRow, name: 'Reporting robot' }),
    ]);
    const ok = await invoke(bearer, 'GET', `${API}/data/itest-customers?region=south`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.length).toBeGreaterThan(0);

    // A failing statement: people see the database error, API clients a generic one with the request id.
    await h.call(s.dev!, 'POST', `${API}/endpoints`, {
      name: 'Ratio',
      slug: 'itest-broken',
      connectionId: conn.data,
    });
    await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-broken`, {
      draft: draft(`SELECT 10 / (:n - 1) AS x`, [{ name: 'n', type: 'integer', default: '2' }]),
      allowedClients: [clientRow],
    });
    const t = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-broken/test`, { params: { n: '1' } });
    expect(t.body.ok).toBe(false);
    expect(t.body.error).toMatchObject({ kind: 'other', dbCode: '22012' });
    expect((await h.call(s.dev!, 'POST', `${API}/endpoints/itest-broken/test`, { params: {} })).body.ok).toBe(
      true,
    );
    await h.call(s.dev!, 'POST', `${API}/endpoints/itest-broken/publish`, {});
    const person = await invoke(s.dev!, 'GET', `${API}/data/itest-broken?n=1`);
    expect(person.status).toBe(422);
    expect(person.body.error).toMatchObject({ code: 'DATABASE_ERROR', details: { dbCode: '22012' } });
    const robot = await invoke(bearer, 'GET', `${API}/data/itest-broken?n=1`);
    expect(robot.status).toBe(422);
    expect(robot.body.error.code).toBe('DATABASE_ERROR');
    expect(robot.body.error.details).toBeUndefined();
    expect(robot.body.error.message).not.toMatch(/division/i);
    expect(robot.body.error.requestId).toBeTruthy();
    const logged = await eventually(
      () => h.kernel.db.select().from(calls).where(eq(calls.requestId, robot.body.error.requestId)),
      (r) => r.length > 0,
    );
    expect(logged[0]).toMatchObject({ status: 422, errorCode: 'DATABASE_ERROR', callerType: 'client' });
    expect(logged[0]!.errorMessage).toMatch(/22012/);
  });

  it('rate-limits per caller with RateLimit and Retry-After headers', async () => {
    await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-region-count`, { rateLimitPerMinute: 2 });
    const results = [];
    for (let i = 0; i < 6; i++)
      results.push(await invoke(s.dev!, 'GET', `${API}/data/itest-region-count?region=east`));
    const limited = results.find((r) => r.status === 429)!;
    expect(limited).toBeDefined();
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(0);
    expect(limited.headers['ratelimit-remaining']).toBe('0');
    // Another caller has its own budget.
    expect((await invoke(s.consumer!, 'GET', `${API}/data/itest-region-count?region=east`)).status).toBe(200);
    await h.call(s.dev!, 'PATCH', `${API}/endpoints/itest-region-count`, { rateLimitPerMinute: null });
  });

  it('caches per version and canonical parameters', async () => {
    const first = await invoke(s.dev!, 'GET', `${API}/data/itest-customers?limit=4&region=east`);
    expect(first.headers['x-cache']).toBe('MISS');
    const second = await invoke(s.dev!, 'GET', `${API}/data/itest-customers?region=east&limit=4`);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body.meta.cached).toBe(true);
    expect(second.body.data).toEqual(first.body.data);
    // v1 has no cache.
    const pinned = await invoke(s.dev!, 'GET', `${API}/data/itest-customers/v1?region=east&limit=4`);
    expect(pinned.headers['x-cache']).toBeUndefined();
    expect(pinned.body.meta.version).toBe(1);
    expect(Object.keys(pinned.body.data[0])).toEqual(['code', 'name', 'region']);
  });

  it('deprecates, retires and refuses unpublished endpoints', async () => {
    const dep = await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/versions/1/deprecate`, {});
    expect(dep.body.versions.find((v: LooseJson) => v.version === 1).status).toBe('deprecated');
    const old = await invoke(s.dev!, 'GET', `${API}/data/itest-customers/v1?region=north`);
    expect(old.status).toBe(200);
    expect(old.headers.deprecation).toBe('true');
    expect(old.headers.link).toBe('</api/v1/etl/data/itest-customers/v2>; rel="latest-version"');
    expect(
      (await invoke(s.dev!, 'GET', `${API}/data/itest-customers/v2?region=north`)).headers.deprecation,
    ).toBeUndefined();

    expect(
      (await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/versions/1/deprecate`, {})).body.error
        .code,
    ).toBe('INVALID_STATE');
    await h.call(s.dev!, 'POST', `${API}/endpoints/itest-customers/versions/1/retire`, {});
    const gone = await invoke(s.dev!, 'GET', `${API}/data/itest-customers/v1?region=north`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('ENDPOINT_RETIRED');
    expect((await invoke(s.dev!, 'GET', `${API}/data/itest-customers/v9?region=north`)).status).toBe(404);

    await h.call(s.dev!, 'POST', `${API}/endpoints`, {
      name: 'Draft only',
      slug: 'itest-draft',
      connectionId: conn.data,
    });
    const unpublished = await invoke(s.dev!, 'GET', `${API}/data/itest-draft`);
    expect(unpublished.status).toBe(404);
    expect(unpublished.body.error.code).toBe('ENDPOINT_NOT_PUBLISHED');
  });

  it('returns CSV with formula-injection protection', async () => {
    const res = await invoke(s.dev!, 'GET', `${API}/data/itest-customers?region=south&limit=50`, {
      accept: 'text/csv',
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    const lines = String(res.body).trimEnd().split('\r\n');
    expect(lines[0]).toBe('code,name,region,updated_at');
    expect(lines.find((l) => l.startsWith('C00001'))).toBe(
      `C00001,"'=HYPERLINK(""http://evil"")",south,${'2026-01-01T01:00:00.000Z'}`,
    );
  });

  it('logs calls after responding, with sensitive parameters masked', async () => {
    const res = await invoke(s.consumer!, 'GET', `${API}/data/itest-customers?region=north&token=hunter2`);
    expect(res.status).toBe(200);
    const [row] = await eventually(
      () =>
        h.kernel.db
          .select()
          .from(calls)
          .where(eq(calls.userId, ids.consumer))
          .orderBy(desc(calls.createdAt))
          .limit(1),
      (r) => r.length > 0 && (r[0]!.params as LooseJson).token !== undefined,
    );
    expect(row).toMatchObject({
      status: 200,
      version: 2,
      callerType: 'user',
      callerName: 'Consumer',
      cached: false,
    });
    expect(row!.params).toEqual({ region: 'north', limit: 5, token: '•••' });
    expect(JSON.stringify(await h.kernel.db.select().from(calls))).not.toContain('hunter2');

    const list = await h.call(s.viewer!, 'GET', `${API}/calls?status=error&period=24h`);
    expect(list.status).toBe(200);
    expect(list.body.items.every((c: LooseJson) => c.status >= 400)).toBe(true);
    const mine = await h.call(s.viewer!, 'GET', `${API}/calls?caller=user:${ids.consumer}`);
    expect(mine.body.items.every((c: LooseJson) => c.caller.id === ids.consumer)).toBe(true);
    const callers = await h.call(s.viewer!, 'GET', `${API}/calls/callers`);
    expect(callers.body.items.map((c: LooseJson) => c.name)).toEqual(
      expect.arrayContaining(['Consumer', 'Reporting robot']),
    );

    const stats = await h.call(s.viewer!, 'GET', `${API}/endpoints/itest-customers/stats?period=24h`);
    expect(stats.status).toBe(200);
    expect(stats.body.calls).toBeGreaterThan(5);
    expect(stats.body.series).toHaveLength(24);
    expect(stats.body.p95Ms).not.toBeNull();
    const week = await h.call(s.viewer!, 'GET', `${API}/endpoints/itest-customers/stats?period=7d`);
    expect(week.body.series).toHaveLength(7);
  });

  it('documents the callable versions as OpenAPI 3.1', async () => {
    const forClient = await invoke({ bearer: clientKey }, 'GET', `${API}/openapi.json`);
    expect(forClient.status).toBe(200);
    expect(forClient.body.openapi).toBe('3.1.0');
    const paths = Object.keys(forClient.body.paths);
    expect(paths).toContain('/api/v1/etl/data/itest-customers');
    expect(paths).toContain('/api/v1/etl/data/itest-customers/v2');
    expect(paths).not.toContain('/api/v1/etl/data/itest-customers/v1'); // retired
    expect(paths).not.toContain('/api/v1/etl/data/itest-region-count'); // client not allowed
    const op = forClient.body.paths['/api/v1/etl/data/itest-customers'].get;
    expect(op.parameters.find((p: LooseJson) => p.name === 'region')).toMatchObject({
      required: true,
      schema: { type: 'string', enum: ['north', 'south', 'east'] },
    });
    expect(
      op.responses['200'].content['application/json'].schema.properties.data.items.properties.updated_at,
    ).toEqual({
      type: ['string', 'null'],
      format: 'date-time',
    });
    expect(forClient.body.components.securitySchemes.bearerAuth.scheme).toBe('bearer');

    const forReaders = await h.call(s.viewer!, 'GET', `${API}/endpoints/openapi.json`);
    expect(Object.keys(forReaders.body.paths)).toContain('/api/v1/etl/data/itest-region-count');
    expect((await h.call(s.viewer!, 'GET', `${API}/openapi.json`)).status).toBe(403);
  });
});

describe('pipelines', () => {
  let pipelineId = '';

  it('validates the target catalog and mapping on save', async () => {
    const base = {
      name: 'Customers to dim',
      source: {
        connectionId: conn.data,
        sql: `SELECT code, name, region, updated_at FROM ${SCHEMA}.customers WHERE updated_at > :watermark::timestamptz ORDER BY code`,
      },
      incremental: { column: 'updated_at', initial: '2000-01-01T00:00:00Z' },
      target: {
        connectionId: conn.data,
        schema: SCHEMA,
        table: 'customer_dim',
        mode: 'upsert',
        keys: ['customer_code'],
      },
      mappings: [
        { source: 'code', target: 'customer_code', transform: 'lower' },
        { source: 'name', target: 'name', transform: 'trim' },
        { source: 'region', target: 'region', transform: 'upper' },
      ],
      batchSize: 7,
    };
    const badTable = await h.call(s.dev!, 'POST', `${API}/pipelines`, {
      ...base,
      target: { ...base.target, table: 'nope' },
    });
    expect(badTable.status).toBe(400);
    expect(badTable.body.error.details.issues[0].path).toBe('target.table');
    const badColumn = await h.call(s.dev!, 'POST', `${API}/pipelines`, {
      ...base,
      mappings: [{ source: 'name', target: 'nope', transform: 'none' }],
    });
    expect(badColumn.body.error.details.issues.map((i: LooseJson) => i.path)).toEqual([
      'mappings.0.target',
      'target.keys.0',
    ]);
    const readOnly = await h.call(s.dev!, 'POST', `${API}/pipelines`, {
      ...base,
      target: { ...base.target, connectionId: conn.readonly },
    });
    expect(readOnly.body.error.code).toBe('CONNECTION_READ_ONLY');
    const missingParam = await h.call(s.dev!, 'POST', `${API}/pipelines`, { ...base, incremental: null });
    expect(missingParam.body.error.details.issues[0].path).toBe('source.params.watermark');

    const preview = await h.call(s.dev!, 'POST', `${API}/pipelines/preview`, {
      connectionId: conn.data,
      sql: base.source.sql,
      incremental: base.incremental,
    });
    expect(preview.body.columns.map((c: LooseJson) => c.name)).toEqual([
      'code',
      'name',
      'region',
      'updated_at',
    ]);
    expect(preview.body.rows).toHaveLength(10);

    const created = await h.call(s.dev!, 'POST', `${API}/pipelines`, { ...base, ownerId: ids.dev });
    expect(created.status).toBe(201);
    pipelineId = created.body.id;
    expect(created.body).toMatchObject({
      incremental: true,
      targetTable: `${SCHEMA}.customer_dim`,
      lastRun: null,
    });
    expect((await h.call(s.viewer!, 'POST', `${API}/pipelines/${pipelineId}/run`)).status).toBe(403);
  });

  it('runs end to end through the worker: upsert, then an incremental second run', async () => {
    const queued = await h.call(s.dev!, 'POST', `${API}/pipelines/${pipelineId}/run`);
    expect(queued.status).toBe(202);
    expect(queued.body.status).toBe('queued');
    const run = await eventually(
      () => h.call(s.dev!, 'GET', `${API}/pipelines/${pipelineId}/runs/${queued.body.id}`),
      (r) => ['succeeded', 'failed', 'cancelled'].includes(r.body.status),
    );
    expect(run.body, JSON.stringify(run.body.log)).toMatchObject({
      status: 'succeeded',
      trigger: 'manual',
      rowsRead: 30,
      rowsWritten: 30,
      rowsRejected: 0,
      watermarkFrom: '2000-01-01T00:00:00Z',
      watermarkTo: '2026-01-02T06:00:00.000Z',
    });
    expect(run.body.log.some((l: LooseJson) => /Batch 5: 2 read/.test(l.message))).toBe(true);
    const dim = await exec(`select customer_code, name, region from ${SCHEMA}.customer_dim order by 1`);
    expect(dim.rows).toHaveLength(30);
    expect(dim.rows[1]).toEqual({ customer_code: 'c00002', name: 'Customer 2', region: 'EAST' });

    // Only rows changed after the watermark are read the second time.
    await exec(
      `update ${SCHEMA}.customers set name = '  Renamed  ', updated_at = timestamptz '2026-02-01 00:00:00+00' where code in ('C00002', 'C00003')`,
    );
    const again = await h.call(s.dev!, 'POST', `${API}/pipelines/${pipelineId}/run`);
    const second = await eventually(
      () => h.call(s.dev!, 'GET', `${API}/pipelines/${pipelineId}/runs/${again.body.id}`),
      (r) => ['succeeded', 'failed'].includes(r.body.status),
    );
    expect(second.body).toMatchObject({
      status: 'succeeded',
      rowsRead: 2,
      rowsWritten: 2,
      watermarkFrom: '2026-01-02T06:00:00.000Z',
      watermarkTo: '2026-02-01T00:00:00.000Z',
    });
    const renamed = await exec(`select name from ${SCHEMA}.customer_dim where customer_code = 'c00002'`);
    expect(renamed.rows[0]).toEqual({ name: 'Renamed' });
    const detail = await h.call(s.viewer!, 'GET', `${API}/pipelines/${pipelineId}`);
    expect(detail.body).toMatchObject({
      watermark: '2026-02-01T00:00:00.000Z',
      lastRun: { status: 'succeeded' },
    });
    expect(detail.body.stats).toMatchObject({ runs: 2, succeeded: 2 });
  });

  it('rolls back failed runs, notifies the owner, and refuses a second concurrent run', async () => {
    const patched = await h.call(s.dev!, 'PATCH', `${API}/pipelines/${pipelineId}`, {
      mappings: [
        { source: 'code', target: 'customer_code', transform: 'lower' },
        { source: 'name', target: 'name', transform: 'constant:x' },
        { source: 'region', target: 'region', transform: 'constant:way-too-long-for-varchar-16' },
      ],
      resetWatermark: true,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.watermark).toBeNull();
    const queued = await h.call(s.dev!, 'POST', `${API}/pipelines/${pipelineId}/run`);
    const failed = await eventually(
      () => h.call(s.dev!, 'GET', `${API}/pipelines/${pipelineId}/runs/${queued.body.id}`),
      (r) => ['succeeded', 'failed'].includes(r.body.status),
    );
    expect(failed.body.status).toBe('failed');
    expect(failed.body.error).toMatch(/22001/);
    const dim = await exec(`select count(*)::int as n from ${SCHEMA}.customer_dim where name = 'x'`);
    expect(dim.rows[0]).toEqual({ n: 0 });
    const notified = await eventually(
      () =>
        h.kernel.db.execute(
          sql`select count(*)::int as n from core.notifications where user_id = ${ids.dev} and type = 'etl.pipeline.failed'`,
        ),
      (r) => Number((r.rows[0] as LooseJson).n) > 0,
    );
    expect(Number((notified.rows[0] as LooseJson).n)).toBe(1);

    // A queued run blocks "Run now" until it is cancelled.
    const [blocking] = await h.kernel.db
      .insert(pipelineRuns)
      .values({ pipelineId, trigger: 'manual', status: 'queued', log: [] })
      .returning();
    const busy = await h.call(s.dev!, 'POST', `${API}/pipelines/${pipelineId}/run`);
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('JOB_RUNNING');
    const cancelled = await h.call(
      s.dev!,
      'POST',
      `${API}/pipelines/${pipelineId}/runs/${blocking!.id}/cancel`,
    );
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('runs as the etl.pipeline task type for Scheduled Jobs', async () => {
    await h.call(s.dev!, 'PATCH', `${API}/pipelines/${pipelineId}`, {
      mappings: [
        { source: 'code', target: 'customer_code', transform: 'upper' },
        { source: 'name', target: 'name', transform: 'trim' },
        { source: 'region', target: 'region', transform: 'none' },
      ],
    });
    const ctx = h.kernel.registry.context('etl');
    const devUser = (await h.kernel.db.select().from(users).where(eq(users.id, ids.dev)))[0]!;
    const viewerUser = (await h.kernel.db.select().from(users).where(eq(users.id, ids.viewer)))[0]!;
    const authOf = async (u: typeof devUser) =>
      buildAuthContext(
        { type: 'user', id: u.id, name: u.displayName },
        toSessionUser(u),
        null,
        await h.kernel.rbac.permissionsFor(u.id),
      );
    expect(ctx.taskTypes.list().map((t) => t.type)).toContain('etl.pipeline');
    await expect(
      ctx.taskTypes.validate('etl.pipeline', { pipelineId }, await authOf(devUser)),
    ).resolves.toEqual({
      pipelineId,
    });
    await expect(
      ctx.taskTypes.validate('etl.pipeline', { pipelineId }, await authOf(viewerUser)),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      ctx.taskTypes.validate('etl.pipeline', { pipelineId: 'x' }, await authOf(devUser)),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await ctx.taskTypes.describe('etl.pipeline', { pipelineId })).toEqual({
      label: 'Pipeline: Customers to dim',
      href: `/etl/pipelines/${pipelineId}`,
    });

    const lines: string[] = [];
    const task: TaskContext = {
      runId: 'sched-run-1',
      jobId: 'job-1',
      attempt: 1,
      scheduledFor: new Date(),
      lastSuccessAt: null,
      signal: new AbortController().signal,
      log: (m) => lines.push(m),
    };
    const outcome = await ctx.taskTypes.run('etl.pipeline', { pipelineId }, task);
    expect(outcome.metrics).toEqual({ rowsRead: 30, rowsWritten: 30, rowsRejected: 0 });
    expect(outcome.summary).toBe('30 rows written (30 read, 0 rejected)');
    expect(outcome.href).toMatch(new RegExp(`^/etl/pipelines/${pipelineId}/runs/`));
    expect(lines.some((l) => l.startsWith('Committed'))).toBe(true);
    const [scheduled] = await h.kernel.db
      .select()
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.pipelineId, pipelineId), eq(pipelineRuns.taskRunId, 'sched-run-1')));
    expect(scheduled).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    const dim = await exec(`select customer_code from ${SCHEMA}.customer_dim where customer_code = 'C00002'`);
    expect(dim.rows).toHaveLength(1);

    // An aborted (timed out) task rolls back and fails.
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      ctx.taskTypes.run(
        'etl.pipeline',
        { pipelineId },
        { ...task, runId: 'sched-run-2', signal: aborted.signal },
      ),
    ).rejects.toThrow(/Stopped by Scheduled Jobs/);
  });

  it('flags endpoints and pipelines whose connection is deleted', async () => {
    const [other] = await h.kernel.db
      .insert(dbConnections)
      .values({
        key: 'itest-doomed',
        name: 'Doomed',
        engine: 'postgres',
        host: 'localhost',
        username: 'x',
        purposes: ['data'],
      })
      .returning();
    await h.call(s.dev!, 'POST', `${API}/endpoints`, {
      name: 'Doomed',
      slug: 'itest-doomed',
      connectionId: other!.id,
    });
    const del = await h.call(s.admin!, 'DELETE', `/api/v1/databases/${other!.id}`);
    expect([200, 204]).toContain(del.status);
    const ep = await eventually(
      () => h.call(s.dev!, 'GET', `${API}/endpoints/itest-doomed`),
      (r) => r.body.connection?.status === 'missing',
    );
    expect(ep.body.connection).toMatchObject({ status: 'missing' });
    const audit = await eventually(
      () =>
        h.kernel.db.select().from(auditLogs).where(eq(auditLogs.action, 'etl.endpoint.connection_missing')),
      (r) => r.length > 0,
    );
    expect(audit[0]!.entityLabel).toBe('Doomed');
  });

  it('deletes a pipeline with its runs', async () => {
    expect((await h.call(s.dev!, 'DELETE', `${API}/pipelines/${pipelineId}`)).status).toBe(204);
    expect(await h.kernel.db.select().from(pipelines).where(eq(pipelines.id, pipelineId))).toHaveLength(0);
    expect(
      await h.kernel.db.select().from(pipelineRuns).where(eq(pipelineRuns.pipelineId, pipelineId)),
    ).toHaveLength(0);
  });
});
