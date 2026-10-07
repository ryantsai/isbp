import { apiClients, dbConnections, groupMembers, groups, users } from '@isbp/db/schema';
import { endpointDefinitionSchema } from '@isbp/module-etl/contracts';
import { allowDemoClient } from '@isbp/module-etl/seed';
import { calls, endpoints, endpointVersions, pipelineRuns, pipelines } from '@isbp/module-etl/schema';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/**
 * The demo data, without the demo database: the connections the platform seed creates are inserted as rows
 * (the seed never connects), plus the demo API client and a few people.
 */
const MODULES = process.env.ISBP_TEST_MODULES;
const API = '/api/v1/etl';
let h: Harness;
let admin: Session;
let clientId: string;

const seed = () => h.kernel.registry.get('etl')!.seed!(h.kernel.registry.context('etl'));

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? 'etl';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  const db = h.kernel.db;
  const conn = (
    key: string,
    engine: 'postgres' | 'mssql' | 'mysql',
    purposes: ('data' | 'admin')[],
    readOnly: boolean,
  ) => ({
    key,
    name: key,
    engine,
    host: `${key}.corp.contoso.example`,
    port: 5432,
    database: 'isbp_demo',
    username: 'x',
    passwordSealed: h.kernel.box.encrypt('x'),
    purposes,
    readOnly,
  });
  await db
    .insert(dbConnections)
    .values([
      conn('contoso-erp', 'postgres', ['data'], true),
      conn('contoso-dw', 'postgres', ['data'], false),
      conn('contoso-erp-admin', 'postgres', ['admin'], false),
      conn('hr-sql01', 'mssql', ['data', 'admin'], false),
      conn('crm-mysql', 'mysql', ['data'], true),
    ]);
  const [client] = await db
    .insert(apiClients)
    .values({ clientId: 'bi-reports', name: 'Contoso BI', permissions: ['etl.endpoints.invoke'] })
    .returning();
  clientId = client!.id;
  const [team] = await db
    .insert(groups)
    .values({ key: 'dev-team', name: 'Application Development' })
    .returning();
  for (const username of ['helpdesk', 'auditor', 'dev1', 'dev2']) {
    const [u] = await db
      .insert(users)
      .values({
        email: `${username}@test.example`,
        username,
        displayName: username,
        passwordHash: await hashPassword(PASSWORD),
      })
      .returning();
    if (username.startsWith('dev'))
      await db.insert(groupMembers).values({ groupId: team!.id, userId: u!.id });
  }
  admin = await h.login('admin');
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('etl seed', () => {
  it('creates endpoints, versions, a call log and pipelines with history, once', async () => {
    await seed();
    await seed();
    const db = h.kernel.db;
    const slugs = (await db.select({ slug: endpoints.slug }).from(endpoints)).map((r) => r.slug).sort();
    expect(slugs).toEqual([
      'customer-orders',
      'customers-by-region',
      'hr-headcount',
      'open-invoices',
      'product-search',
      'sales-by-region',
    ]);
    const versionCount = (await db.select({ n: count() }).from(endpointVersions))[0]!.n;
    expect(versionCount).toBe(6);
    const callCount = (await db.select({ n: count() }).from(calls))[0]!.n;
    expect(callCount).toBeGreaterThan(2_500);
    expect(callCount).toBeLessThan(3_500);
    const names = (await db.select({ name: pipelines.name }).from(pipelines)).map((p) => p.name).sort();
    expect(names).toEqual(['CRM accounts to warehouse', 'Customer dimension', 'Daily sales to warehouse']);
    const runCount = (await db.select({ n: count() }).from(pipelineRuns))[0]!.n;
    expect(runCount).toBeGreaterThan(100);
  });

  it('stores valid, tested definitions and lets the demo API client call the published ones', async () => {
    const rows = await h.kernel.db.select().from(endpoints);
    for (const r of rows) {
      expect(endpointDefinitionSchema.safeParse(r.draft).success, r.slug).toBe(true);
      if (r.slug === 'open-invoices') expect(r.allowedClients).toEqual([]);
      else expect(r.allowedClients, r.slug).toEqual([clientId]);
    }
    const list = await h.call(admin, 'GET', `${API}/endpoints?pageSize=50`);
    const bySlug = Object.fromEntries(list.body.items.map((e: LooseJson) => [e.slug, e]));
    expect(bySlug['customers-by-region']).toMatchObject({
      status: 'published',
      latestVersion: 2,
      draftChanged: false,
    });
    expect(bySlug['open-invoices']).toMatchObject({ status: 'draft', latestVersion: null });
    expect(bySlug['hr-headcount'].connection).toMatchObject({ engine: 'mssql' });
    const drafts = await h.call(admin, 'GET', `${API}/endpoints?status=draft`);
    expect(drafts.body.items.map((e: LooseJson) => e.slug)).toEqual(['open-invoices']);
    const published = await h.call(admin, 'GET', `${API}/endpoints?status=published&sort=-updatedAt`);
    expect(published.body.total).toBe(5);
    expect((await h.call(admin, 'GET', `${API}/endpoints?status=retired`)).body.total).toBe(0);
    const search = await h.call(admin, 'GET', `${API}/endpoints?q=region`);
    expect(search.body.items.map((e: LooseJson) => e.slug).sort()).toEqual([
      'customers-by-region',
      'sales-by-region',
    ]);
    const detail = await h.call(admin, 'GET', `${API}/endpoints/customers-by-region`);
    expect(detail.body.draftTested).toBe(true);
    expect(detail.body.versions.map((v: LooseJson) => [v.version, v.status])).toEqual([
      [2, 'published'],
      [1, 'deprecated'],
    ]);
  });

  it('shows the history: stats, errors on hr-headcount, cache hits on product-search, failing CRM runs', async () => {
    const week = await h.call(admin, 'GET', `${API}/endpoints/product-search/stats?period=7d`);
    expect(week.body.calls).toBeGreaterThan(100);
    expect(week.body.cacheHits).toBeGreaterThan(week.body.calls / 3);
    const errors = await h.call(admin, 'GET', `${API}/calls?status=error&period=30d&pageSize=200`);
    const hr = errors.body.items.filter((c: LooseJson) => c.endpoint.slug === 'hr-headcount');
    expect(hr.length).toBeGreaterThan(errors.body.items.length / 2);
    expect(hr[0]).toMatchObject({ status: 422, errorCode: 'DATABASE_ERROR' });
    const callers = await h.call(admin, 'GET', `${API}/calls/callers`);
    expect(callers.body.items.map((c: LooseJson) => c.name)).toContain('Contoso BI');

    const pipelinesPage = await h.call(admin, 'GET', `${API}/pipelines`);
    const crm = pipelinesPage.body.items.find((p: LooseJson) => p.name === 'CRM accounts to warehouse');
    expect(crm.lastRun).toMatchObject({ status: 'failed', trigger: 'schedule' });
    const failing = await h.call(admin, 'GET', `${API}/pipelines?status=failed`);
    expect(failing.body.items.map((p: LooseJson) => p.name)).toContain('CRM accounts to warehouse');
    expect((await h.call(admin, 'GET', `${API}/pipelines?enabled=false`)).body.total).toBe(0);
    const daily = pipelinesPage.body.items.find((p: LooseJson) => p.name === 'Daily sales to warehouse');
    expect(daily).toMatchObject({ incremental: true, targetTable: 'dw.sales_daily' });
    const [dailyRow] = await h.kernel.db
      .select()
      .from(pipelines)
      .where(eq(pipelines.name, 'Daily sales to warehouse'));
    expect(dailyRow!.watermark).toBeNull();
    const detail = await h.call(admin, 'GET', `${API}/pipelines/${daily.id}`);
    expect(detail.body.stats.runs).toBeGreaterThan(50);
  });

  it('lets a demo API client created later call the published Data APIs', async () => {
    const [late] = await h.kernel.db
      .insert(apiClients)
      .values({ clientId: 'late-client', name: 'Late client', permissions: ['etl.endpoints.invoke'] })
      .returning();
    await allowDemoClient(h.kernel.registry.context('etl'), late!.id);
    await allowDemoClient(h.kernel.registry.context('etl'), late!.id);
    for (const r of await h.kernel.db.select().from(endpoints))
      expect(r.allowedClients.filter((id) => id === late!.id).length, r.slug).toBe(
        r.slug === 'open-invoices' ? 0 : 1,
      );
  });
});
