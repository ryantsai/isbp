/**
 * The customisation kinds of Scheduled Jobs (`scheduler.job`), Data APIs & ETL (`etl.pipeline`, `etl.endpoint`),
 * the Integrations Hub (`integrations.profile`, against the ServiceDesk Plus stand-in) and the service desk
 * (`itsm.category`, `itsm.sla-policy`, `itsm.catalog-item`), through the kernel's `ctx.customizations`: create,
 * update, archive, restore and delete, value round trips, stale base versions, check issues, permissions, guided
 * templates and dry runs in rolled-back transactions that leave nothing behind.
 *
 *   DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_b_test REDIS_URL=redis://localhost:6379/12 \
 *   npx vitest run --project integration test/integration/customizations-modules.test.ts
 */
import {
  auditLogs,
  dbConnections,
  forms,
  groups,
  outboxEvents,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { createMockServer, MOCK_CREDENTIALS } from '@isbp/integration-mocks';
import { endpoints } from '@isbp/module-etl/schema';
import { createConnection, services as hub } from '@isbp/module-integrations/server';
import { businessCalendars } from '@isbp/module-itsm/schema';
import { jobs } from '@isbp/module-scheduler/schema';
import {
  type AuthContext,
  type CustomizationChange,
  type CustomizationValidation,
  type Db,
  HttpError,
} from '@isbp/sdk/server';
import { count, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { toSessionUser } from '../../src/kernel/sessions';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

const MODULES = process.env.ISBP_TEST_MODULES;
const SCHEMA = 'itest_cz';

let h: Harness;
let mock: FastifyInstance;
let admin: Session;
const as = {} as Record<'admin' | 'reader' | 'outsider', AuthContext>;
const ids = {} as Record<'reader' | 'ops' | 'conn' | 'sdp' | 'calendar', string>;

const cz = () => h.kernel.customizations;
const exec = (statement: string) => h.kernel.db.execute(sql.raw(statement));

async function authOf(userId: string): Promise<AuthContext> {
  const [u] = await h.kernel.db.select().from(users).where(eq(users.id, userId));
  return buildAuthContext(
    { type: 'user', id: userId, name: u!.displayName },
    toSessionUser(u!),
    null,
    await h.kernel.rbac.permissionsFor(userId),
  );
}

type Change = CustomizationChange & { baseVersion?: string | null };

/** Applies one change in its own (committed) transaction. */
const apply = (kind: string, change: Change, auth = as.admin) =>
  h.kernel.db.transaction((tx) => cz().apply(kind, change, { auth, tx: tx as unknown as Db }));

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back, and returns what it returned. */
async function rolledBack<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await h.kernel.db.transaction(async (tx) => {
      out = await fn(tx as unknown as Db);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return out as T;
}

const dryRun = (kind: string, change: Change, auth = as.admin) =>
  rolledBack((tx) => cz().apply(kind, change, { auth, tx, dryRun: true }));

async function refused(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

const issues = (v: CustomizationValidation) => v.issues.map((i) => `${i.path}:${i.code}`);
const validate = (kind: string, change: CustomizationChange, auth = as.admin) =>
  cz().validate(kind, change, auth);

/** Everything a write leaves behind: audit entries, outbox events and the rows of every kind. */
async function traces() {
  const [audit] = await h.kernel.db.select({ n: count() }).from(auditLogs);
  const [events] = await h.kernel.db.select({ n: count() }).from(outboxEvents);
  const [rows] = (
    await h.kernel.db.execute<Record<string, number>>(sql`
      select (select count(*) from scheduler.jobs)::int as jobs,
             (select count(*) from etl.pipelines)::int as pipelines,
             (select count(*) from etl.endpoints)::int as endpoints,
             (select count(*) from integrations.profiles)::int as profiles,
             (select count(*) from itsm.categories)::int as categories,
             (select count(*) from itsm.sla_policies)::int as policies,
             (select count(*) from itsm.catalog_items)::int as catalog`)
  ).rows;
  return { audit: audit!.n, events: events!.n, ...rows };
}

/** Applying `get().value` as an update keeps the version; a stale base version is refused. */
async function roundTrips(kind: string, id: string) {
  const now = (await cz().get(kind, id, as.admin))!;
  const same = await apply(kind, { op: 'update', id, value: now.value, baseVersion: now.version });
  expect(same.before!.version).toBe(now.version);
  expect(same.after!.version).toBe(now.version);
  expect(same.after!.value).toEqual(now.value);
  const stale = await refused(
    apply(kind, { op: 'update', id, value: now.value, baseVersion: 'not-the-version' }),
  );
  expect([stale.statusCode, stale.code]).toEqual([409, 'CHANGE_SET_STALE']);
}

/** Archive hides the object from default lists; restore brings back the same version. */
async function archivesAndRestores(kind: string, id: string) {
  const before = (await cz().get(kind, id, as.admin))!;
  const archived = await apply(kind, { op: 'archive', id, value: null, baseVersion: before.version });
  expect(archived.after!.archived).toBe(true);
  expect((await cz().list(kind, {}, as.admin)).map((o) => o.id)).not.toContain(id);
  expect((await cz().list(kind, { includeArchived: true }, as.admin)).map((o) => o.id)).toContain(id);
  expect(issues(await validate(kind, { op: 'archive', id, value: null }))).toEqual([':archived']);
  const restored = await apply(kind, { op: 'restore', id, value: null });
  expect(restored.after!.archived).toBe(false);
  expect(restored.after!.version).toBe(before.version);
}

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? 'cmdb,itsm,scheduler,etl,integrations,sdp';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  const db = h.kernel.db;
  mock = await createMockServer();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const mockBase = `http://localhost:${(mock.server.address() as { port: number }).port}`;

  // A reader of jobs, pipelines, endpoints and connections who may apply nothing.
  const [reader] = await db
    .insert(users)
    .values({
      email: 'reader@test.example',
      username: 'reader',
      displayName: 'Reader',
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  ids.reader = reader!.id;
  const roleId = async (key: string) =>
    (await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;
  for (const key of ['scheduler-viewer', 'etl-viewer', 'integrations-viewer'])
    await db.insert(roleAssignments).values({ roleId: await roleId(key), userId: ids.reader });
  await h.kernel.rbac.bump();
  as.admin = await authOf(h.ids.admin);
  as.reader = await authOf(ids.reader);
  as.outsider = await authOf(h.ids.outsider);
  admin = await h.login('admin');

  const [ops] = await db.insert(groups).values({ key: 'cz-ops', name: 'Operations' }).returning();
  ids.ops = ops!.id;

  // Tables in the test database itself, reached through a data connection.
  await exec(`drop schema if exists ${SCHEMA} cascade`);
  await exec(`
    create schema ${SCHEMA};
    create table ${SCHEMA}.src (id serial primary key, code varchar(12) not null, name varchar(120) not null,
                                updated_at timestamptz not null default now());
    insert into ${SCHEMA}.src (code, name) values ('C1', 'One'), ('C2', 'Two');
    create table ${SCHEMA}.dim (code varchar(12) primary key, name varchar(120) not null);
  `);
  const url = new URL(process.env.DATABASE_URL!);
  const [conn] = await db
    .insert(dbConnections)
    .values({
      key: 'cz-data',
      name: 'cz-data',
      engine: 'postgres',
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      username: decodeURIComponent(url.username),
      passwordSealed: h.kernel.box.encrypt(decodeURIComponent(url.password)),
      options: { tls: 'off', ca: null, instanceName: null, domain: null },
      status: 'ok',
      purposes: ['data'],
      readOnly: false,
      maxRows: 5_000,
    })
    .returning();
  ids.conn = conn!.id;

  // A connection to the ServiceDesk Plus stand-in.
  const { connection } = await createConnection(h.kernel.registry.context('integrations'), {
    name: 'ServiceDesk Plus (stand-in)',
    type: 'sdp.server',
    config: { baseUrl: `${mockBase}/sdp` },
    secrets: { apiKey: MOCK_CREDENTIALS.sdp.apiKey },
  });
  ids.sdp = connection.id;

  const [calendar] = await db
    .insert(businessCalendars)
    .values({
      name: 'Taipei office',
      timezone: 'Asia/Taipei',
      hours: { days: [[], ...Array(5).fill([{ start: '09:00', end: '18:00' }]), []] },
      holidays: [],
      alwaysOpen: false,
    })
    .returning();
  ids.calendar = calendar!.id;

  // A published request form for the service catalog.
  const form = await h.call(admin, 'POST', '/api/v1/forms', {
    key: 'cz-monitor',
    name: { en: 'Request a monitor' },
    icon: 'monitor',
  });
  expect(form.status, JSON.stringify(form.body)).toBe(201);
  await h.call(admin, 'PATCH', `/api/v1/forms/${form.body.id}`, {
    draft: { elements: [{ id: 'a', key: 'size', type: 'text', label: { en: 'Size' } }] },
  });
  expect((await h.call(admin, 'POST', `/api/v1/forms/${form.body.id}/publish`)).status).toBe(200);
}, 120_000);

afterAll(async () => {
  await exec(`drop schema if exists ${SCHEMA} cascade`).catch(() => undefined);
  await mock?.close();
  await h?.close();
});

const KINDS = [
  'etl.endpoint',
  'etl.pipeline',
  'integrations.profile',
  'itsm.catalog-item',
  'itsm.category',
  'itsm.sla-policy',
  'scheduler.job',
];

describe('kinds', () => {
  it('lists the kinds each person may read, and whether they may apply them', () => {
    const mine = cz()
      .kinds(as.admin)
      .filter((k) => KINDS.includes(k.kind));
    expect(mine.map((k) => k.kind)).toEqual(KINDS);
    expect(mine.every((k) => k.canApply)).toBe(true);
    expect(mine.find((k) => k.kind === 'etl.endpoint')!.operations).toEqual(['create', 'update', 'delete']);
    expect(mine.find((k) => k.kind === 'scheduler.job')!.templates.map((t) => t.id)).toEqual(['http-check']);

    const reader = cz()
      .kinds(as.reader)
      .filter((k) => KINDS.includes(k.kind));
    expect(reader.map((k) => k.kind)).toEqual([
      'etl.endpoint',
      'etl.pipeline',
      'integrations.profile',
      'scheduler.job',
    ]);
    expect(reader.some((k) => k.canApply)).toBe(false);
    expect(
      cz()
        .kinds(as.outsider)
        .filter((k) => KINDS.includes(k.kind)),
    ).toEqual([]);
  });

  it('describes every kind with a JSON schema, a guide with live reference data and a valid example', async () => {
    for (const kind of KINDS) {
      const d = await cz().describe(kind, as.admin);
      expect(Object.keys((d.schema.properties ?? {}) as object).length, kind).toBeGreaterThan(3);
      expect(d.guide.instructions.length, kind).toBeGreaterThan(100);
      expect(d.guide.reference, kind).toBeTruthy();
      const example = d.guide.examples![0]!.value;
      expect((await validate(kind, { op: 'create', id: null, value: example })).value, kind).not.toBeNull();
    }
    const guide = (await cz().describe('integrations.profile', as.admin)).guide.reference as LooseJson;
    const sdp = guide.connections.find((c: LooseJson) => c.id === ids.sdp);
    const request = sdp.objects.find((o: LooseJson) => o.type === 'request');
    expect(request.defaultMappings['itsm.ticket'].length).toBeGreaterThan(3);
    expect(JSON.stringify(guide)).not.toContain(MOCK_CREDENTIALS.sdp.apiKey);
    const jobs = (await cz().describe('scheduler.job', as.admin)).guide.reference as LooseJson;
    expect(jobs.taskTypes.map((t: LooseJson) => t.type)).toEqual(
      expect.arrayContaining(['scheduler.http', 'scheduler.sql', 'etl.pipeline', 'integrations.sync']),
    );
    expect(jobs.dataConnections.map((c: LooseJson) => c.id)).toContain(ids.conn);
  });

  it('refuses readers who lack the read permission', async () => {
    const err = await refused(cz().list('itsm.category', {}, as.outsider));
    expect([err.statusCode, err.code]).toEqual([403, 'FORBIDDEN']);
  });
});

/* ───────────────────────────── scheduler.job ───────────────────────────── */

const httpJob = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: null,
  ownerGroupId: null,
  type: 'scheduler.http',
  config: { method: 'GET', url: 'https://status.example.com/health' },
  trigger: { kind: 'interval', intervalMinutes: 15 },
  ...extra,
});

describe('scheduler.job', () => {
  let jobId = '';

  it('builds a job from the HTTP check template', async () => {
    const fields = await cz().templateFields('scheduler.job', 'http-check', as.admin);
    expect(fields.map((f) => f.key)).toEqual(['name', 'url', 'everyMinutes']);
    expect(fields[1]!.label).toEqual({
      en: 'URL to check',
      'zh-TW': '要檢查的 URL',
      'ja-JP': 'チェックする URL',
    });
    const built = await cz().buildTemplate(
      'scheduler.job',
      'http-check',
      { name: 'Intranet check', url: 'https://intranet.example.com/', everyMinutes: '10' },
      as.admin,
    );
    expect(built).toMatchObject({ op: 'create', label: 'Intranet check' });
    const v = await validate('scheduler.job', { op: 'create', id: null, value: built.value });
    expect(v.issues).toEqual([]);
    const created = await apply('scheduler.job', { op: 'create', id: null, value: built.value });
    jobId = created.id;
    expect(created.after).toMatchObject({
      archived: false,
      href: `/scheduler/jobs/${jobId}`,
      value: { trigger: { kind: 'interval', intervalMinutes: 10 }, ownerId: h.ids.admin },
    });
    const [row] = await h.kernel.db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(row!.enabled).toBe(true);
    expect(row!.nextRunAt).not.toBeNull();
  });

  it('updates, round-trips, archives (disables) and restores', async () => {
    const now = (await cz().get('scheduler.job', jobId, as.admin))!;
    const updated = await apply('scheduler.job', {
      op: 'update',
      id: jobId,
      value: {
        ...(now.value as object),
        trigger: { kind: 'cron', cron: '0 2 * * *', timezone: 'Asia/Taipei' },
      },
      baseVersion: now.version,
    });
    expect(updated.after!.version).not.toBe(now.version);
    expect(updated.after!.value).toMatchObject({ trigger: { kind: 'cron', timezone: 'Asia/Taipei' } });
    await roundTrips('scheduler.job', jobId);
    await archivesAndRestores('scheduler.job', jobId);
    const [row] = await h.kernel.db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(row!.enabled).toBe(true);
  });

  it('never returns secrets, and keeps them when the value comes back', async () => {
    const created = await apply('scheduler.job', {
      op: 'create',
      id: null,
      value: httpJob('Authenticated check', {
        config: {
          method: 'GET',
          url: 'https://api.example.com/ping',
          auth: { type: 'bearer', token: 'tok-very-secret' },
        },
      }),
    });
    expect(JSON.stringify(created.after)).not.toContain('tok-very-secret');
    expect(created.after!.value).toMatchObject({ config: { auth: { token: { secret: true, set: true } } } });
    await roundTrips('scheduler.job', created.id);
    const [row] = await h.kernel.db.select().from(jobs).where(eq(jobs.id, created.id));
    expect((row!.config as LooseJson).auth.token.sealed).toBeTruthy();
    await apply('scheduler.job', { op: 'delete', id: created.id, value: null });
  });

  it('checks the type, names, owners, upstream jobs and the task config', async () => {
    const now = (await cz().get('scheduler.job', jobId, as.admin))!;
    expect(
      issues(
        await validate('scheduler.job', {
          op: 'update',
          id: jobId,
          value: { ...(now.value as object), type: 'scheduler.sql' },
        }),
      ),
    ).toEqual(['type:immutable']);
    const missing = '0190a0a0-0000-7000-8000-000000000000';
    const v = await validate('scheduler.job', {
      op: 'create',
      id: null,
      value: httpJob('intranet CHECK', {
        ownerGroupId: missing,
        trigger: { kind: 'after', upstreamIds: [jobId, missing] },
        config: { method: 'GET', url: 'ftp://nope' },
      }),
    });
    expect([...new Set(issues(v))].sort()).toEqual([
      'config.url:invalid',
      'name:duplicate_name',
      'ownerGroupId:unknown_group',
      'trigger.upstreamIds.1:unknown_job',
    ]);
    expect(
      issues(
        await validate('scheduler.job', {
          op: 'create',
          id: null,
          value: httpJob('x', { type: 'nope.task' }),
        }),
      ),
    ).toEqual(['type:unknown_type']);
    expect(
      issues(
        await validate('scheduler.job', {
          op: 'create',
          id: null,
          value: httpJob('Bad cron', { trigger: { kind: 'cron', cron: '61 * * * *', timezone: 'UTC' } }),
        }),
      ),
    ).toEqual(['trigger.cron:invalid_cron']);
  });

  it('refuses people without the apply permission, and services still check the person in a dry run', async () => {
    const value = httpJob('Reader job');
    const err = await refused(apply('scheduler.job', { op: 'create', id: null, value }, as.reader));
    expect([err.statusCode, err.code]).toEqual([403, 'FORBIDDEN']);
    // The dry run assumes scheduler.jobs.manage; creating still needs scheduler.jobs.create.
    const dry = await refused(dryRun('scheduler.job', { op: 'create', id: null, value }, as.reader));
    expect(dry.statusCode).toBe(403);
  });

  it('leaves nothing behind after a dry run', async () => {
    const before = await traces();
    const created = await dryRun('scheduler.job', { op: 'create', id: null, value: httpJob('Dry job') });
    expect(created.after!.label).toBe('Dry job');
    await dryRun('scheduler.job', { op: 'archive', id: jobId, value: null });
    await dryRun('scheduler.job', { op: 'delete', id: jobId, value: null });
    expect(await traces()).toEqual(before);
    expect((await cz().get('scheduler.job', jobId, as.admin))!.archived).toBe(false);
  });

  it('deletes, refusing jobs others run after', async () => {
    const after = await apply('scheduler.job', {
      op: 'create',
      id: null,
      value: httpJob('Runs after the check', {
        trigger: { kind: 'after', upstreamIds: [jobId], mode: 'all' },
      }),
    });
    expect(issues(await validate('scheduler.job', { op: 'delete', id: jobId, value: null }))).toEqual([
      ':in_use',
    ]);
    await apply('scheduler.job', { op: 'delete', id: after.id, value: null });
    await apply('scheduler.job', { op: 'delete', id: jobId, value: null });
    expect(await cz().get('scheduler.job', jobId, as.admin)).toBeNull();
  });
});

/* ───────────────────────────── etl.pipeline ───────────────────────────── */

const pipeline = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: null,
  ownerId: null,
  source: {
    connectionId: ids.conn,
    sql: `select code, name, updated_at from ${SCHEMA}.src where updated_at > :watermark`,
    params: {},
  },
  incremental: { column: 'updated_at', initial: '2000-01-01T00:00:00Z' },
  target: { connectionId: ids.conn, schema: SCHEMA, table: 'dim', mode: 'upsert', keys: ['code'] },
  mappings: [
    { source: 'code', target: 'code', transform: 'trim' },
    { source: 'name', target: 'name' },
  ],
  batchSize: 100,
  ...extra,
});

describe('etl.pipeline', () => {
  let id = '';

  it('creates a live pipeline, updates, round-trips, archives (disables) and restores it', async () => {
    const created = await apply('etl.pipeline', {
      op: 'create',
      id: null,
      value: pipeline('Customers to dim'),
    });
    id = created.id;
    expect(created.after).toMatchObject({
      archived: false,
      href: `/etl/pipelines/${id}`,
      value: { mappings: [{ transform: 'trim' }, { transform: 'none' }] },
    });
    const updated = await apply('etl.pipeline', {
      op: 'update',
      id,
      value: { ...(created.after!.value as object), description: 'Nightly copy' },
      baseVersion: created.after!.version,
    });
    expect(updated.after!.description).toBe('Nightly copy');
    await roundTrips('etl.pipeline', id);
    await archivesAndRestores('etl.pipeline', id);
  });

  it('checks names, connections, the target table and the mappings', async () => {
    const v = await validate('etl.pipeline', {
      op: 'create',
      id: null,
      value: pipeline('customers TO DIM', { mappings: [{ source: 'code', target: 'nope' }] }),
    });
    expect(issues(v).map((i) => i.split(':')[0])).toEqual(
      expect.arrayContaining(['name', 'mappings.0.target']),
    );
    const unknown = await validate('etl.pipeline', {
      op: 'create',
      id: null,
      value: pipeline('Elsewhere', {
        target: { connectionId: '0190a0a0-0000-7000-8000-000000000000', table: 'dim', mode: 'insert' },
      }),
    });
    expect(issues(unknown)).toEqual(['target.connectionId:invalid']);
  });

  it('refuses readers, and a reader’s dry run leaves nothing behind', async () => {
    const err = await refused(
      apply('etl.pipeline', { op: 'create', id: null, value: pipeline('R') }, as.reader),
    );
    expect(err.code).toBe('FORBIDDEN');
    const before = await traces();
    const dry = await dryRun(
      'etl.pipeline',
      { op: 'create', id: null, value: pipeline('Dry pipeline') },
      as.reader,
    );
    expect(dry.after!.label).toBe('Dry pipeline');
    await dryRun('etl.pipeline', { op: 'delete', id, value: null });
    expect(await traces()).toEqual(before);
  });

  it('deletes', async () => {
    await apply('etl.pipeline', { op: 'delete', id, value: null });
    expect(await cz().get('etl.pipeline', id, as.admin)).toBeNull();
  });
});

/* ───────────────────────────── etl.endpoint ───────────────────────────── */

const endpoint = (slug: string, extra: Record<string, unknown> = {}) => ({
  name: 'Customer by code',
  slug,
  description: 'One customer',
  definition: {
    method: 'GET',
    connectionId: ids.conn,
    kind: 'query',
    sql: `select code, name from ${SCHEMA}.src where code = :code`,
    params: [{ name: 'code', type: 'string', required: true }],
  },
  allowUsers: true,
  allowedClients: [],
  rateLimitPerMinute: 30,
  ...extra,
});

describe('etl.endpoint', () => {
  let id = '';

  it('saves the draft only: nothing is tested or published', async () => {
    const created = await apply('etl.endpoint', { op: 'create', id: null, value: endpoint('cz-customer') });
    id = created.id;
    expect(created.after).toMatchObject({
      href: '/etl/endpoints/cz-customer',
      value: { slug: 'cz-customer', rateLimitPerMinute: 30, definition: { kind: 'query', maxRows: 1000 } },
    });
    const [row] = await h.kernel.db.select().from(endpoints).where(eq(endpoints.id, id));
    expect(row!.latestVersion).toBeNull();
    expect(row!.draftTestedHash).toBeNull();
    expect(row!.draft.sql).toContain(':code');
    const detail = await h.call(admin, 'GET', `/api/v1/etl/endpoints/${id}`);
    expect(detail.body).toMatchObject({ status: 'draft', draftTested: false, versions: [] });
  });

  it('updates (the slug too while unpublished) and round-trips', async () => {
    const now = (await cz().get('etl.endpoint', id, as.admin))!;
    const updated = await apply('etl.endpoint', {
      op: 'update',
      id,
      value: { ...(now.value as object), slug: 'cz-customer-by-code', allowUsers: false },
      baseVersion: now.version,
    });
    expect(updated.after!.value).toMatchObject({ slug: 'cz-customer-by-code', allowUsers: false });
    await roundTrips('etl.endpoint', id);
  });

  it('checks slugs (fixed once published), the definition and the API clients', async () => {
    const now = (await cz().get('etl.endpoint', id, as.admin))!;
    expect(
      issues(
        await validate('etl.endpoint', { op: 'create', id: null, value: endpoint('cz-customer-by-code') }),
      ),
    ).toEqual(['slug:duplicate_slug']);
    expect(
      issues(await validate('etl.endpoint', { op: 'create', id: null, value: endpoint('openapi') })),
    ).toEqual(['slug:reserved']);
    const writes = await validate('etl.endpoint', {
      op: 'create',
      id: null,
      value: endpoint('cz-writer', {
        definition: {
          connectionId: ids.conn,
          sql: `delete from ${SCHEMA}.src where code = :code`,
          params: [],
        },
        allowedClients: ['0190a0a0-0000-7000-8000-000000000000'],
      }),
    });
    expect(issues(writes)).toEqual([
      'definition.allowsWrites:writes_not_allowed',
      'allowedClients.0:unknown_client',
    ]);
    await h.kernel.db.update(endpoints).set({ latestVersion: 1 }).where(eq(endpoints.id, id));
    expect(
      issues(
        await validate('etl.endpoint', {
          op: 'update',
          id,
          value: { ...(now.value as object), slug: 'other' },
        }),
      ),
    ).toEqual(['slug:immutable']);
    await h.kernel.db.update(endpoints).set({ latestVersion: null }).where(eq(endpoints.id, id));
  });

  it('refuses readers; a dry run leaves nothing behind; deletes', async () => {
    const err = await refused(
      apply('etl.endpoint', { op: 'create', id: null, value: endpoint('cz-reader') }, as.reader),
    );
    expect(err.code).toBe('FORBIDDEN');
    const before = await traces();
    await dryRun('etl.endpoint', { op: 'create', id: null, value: endpoint('cz-dry') });
    await dryRun('etl.endpoint', { op: 'delete', id, value: null });
    expect(await traces()).toEqual(before);
    await apply('etl.endpoint', { op: 'delete', id, value: null });
    expect(await cz().get('etl.endpoint', id, as.admin)).toBeNull();
  });
});

/* ───────────────────────────── integrations.profile ───────────────────────────── */

describe('integrations.profile', () => {
  let id = '';
  let mappings: unknown[] = [];

  const profile = (name: string, extra: Record<string, unknown> = {}) => ({
    connectionId: ids.sdp,
    objectType: 'request',
    remoteScope: null,
    entity: 'itsm.ticket',
    containerId: null,
    name,
    direction: 'pull',
    createLocal: true,
    createRemote: false,
    matchRule: null,
    pushFilter: [],
    mappings,
    conflictPolicy: 'manual',
    comments: false,
    intervalMinutes: 0,
    ...extra,
  });

  beforeAll(async () => {
    mappings = (
      await hub(h.kernel.registry.context('integrations')).profiles.defaultMapping({
        connectionId: ids.sdp,
        objectType: 'request',
        entity: 'itsm.ticket',
      })
    ).mappings;
    expect(mappings.length).toBeGreaterThan(3);
  });

  it('creates a live profile (mappings checked against both catalogues), updates and round-trips it', async () => {
    const created = await apply('integrations.profile', {
      op: 'create',
      id: null,
      value: profile('SDP requests'),
    });
    id = created.id;
    expect(created.after).toMatchObject({
      archived: false,
      description: 'request ↔ itsm.ticket',
      href: `/integrations/connections/${ids.sdp}/profiles/${id}`,
    });
    const updated = await apply('integrations.profile', {
      op: 'update',
      id,
      value: { ...(created.after!.value as object), direction: 'both', conflictPolicy: 'newest' },
      baseVersion: created.after!.version,
    });
    expect(updated.after!.value).toMatchObject({ direction: 'both', conflictPolicy: 'newest' });
    await roundTrips('integrations.profile', id);
    await archivesAndRestores('integrations.profile', id);
  });

  it('refuses mappings the remote catalogue does not have', async () => {
    const err = await refused(
      apply('integrations.profile', {
        op: 'create',
        id: null,
        value: profile('Broken', {
          mappings: [{ local: 'title', remote: 'no_such_field', direction: 'both' }],
        }),
      }),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
  });

  it('checks the fixed binding and the references', async () => {
    const now = (await cz().get('integrations.profile', id, as.admin))!;
    expect(
      issues(
        await validate('integrations.profile', {
          op: 'update',
          id,
          value: { ...(now.value as object), objectType: 'problem' },
        }),
      ),
    ).toEqual(['objectType:immutable']);
    expect(
      issues(
        await validate('integrations.profile', {
          op: 'create',
          id: null,
          value: profile('Nowhere', { connectionId: '0190a0a0-0000-7000-8000-000000000000' }),
        }),
      ),
    ).toEqual(['connectionId:unknown_connection']);
    expect(
      issues(
        await validate('integrations.profile', {
          op: 'create',
          id: null,
          value: profile('Odd', { objectType: 'spaceship', entity: 'itsm.nothing' }),
        }),
      ),
    ).toEqual(['objectType:unknown_object', 'entity:unknown_entity']);
  });

  it('refuses readers; a reader’s dry run needs the entity’s sync permission; an admin’s leaves nothing', async () => {
    const value = profile('Reader profile');
    expect(
      (await refused(apply('integrations.profile', { op: 'create', id: null, value }, as.reader))).code,
    ).toBe('FORBIDDEN');
    expect(
      (await refused(dryRun('integrations.profile', { op: 'create', id: null, value }, as.reader)))
        .statusCode,
    ).toBe(403);
    const before = await traces();
    await dryRun('integrations.profile', { op: 'create', id: null, value: profile('Dry profile') });
    await dryRun('integrations.profile', { op: 'archive', id, value: null });
    expect(await traces()).toEqual(before);
  });

  it('deletes', async () => {
    await apply('integrations.profile', { op: 'delete', id, value: null });
    expect(await cz().get('integrations.profile', id, as.admin)).toBeNull();
  });
});

/* ───────────────────────────── itsm.category ───────────────────────────── */

describe('itsm.category', () => {
  const ids_ = {} as Record<'network' | 'vpn', string>;

  it('creates, updates, round-trips, archives (deactivates) and restores', async () => {
    const network = await apply('itsm.category', {
      op: 'create',
      id: null,
      value: { key: 'cz-network', name: { en: 'Network', 'zh-TW': '網路' }, ticketTypes: ['incident'] },
    });
    ids_.network = network.id;
    expect(network.after).toMatchObject({
      label: 'Network',
      value: { parentId: null, defaultGroupId: null, sortOrder: 0 },
    });
    const vpn = await apply('itsm.category', {
      op: 'create',
      id: null,
      value: {
        key: 'cz-vpn',
        name: { en: 'VPN' },
        parentId: network.id,
        ticketTypes: ['incident', 'service_request'],
        defaultGroupId: ids.ops,
      },
    });
    ids_.vpn = vpn.id;
    const updated = await apply('itsm.category', {
      op: 'update',
      id: vpn.id,
      value: { ...(vpn.after!.value as object), sortOrder: 5 },
      baseVersion: vpn.after!.version,
    });
    expect(updated.after!.value).toMatchObject({ sortOrder: 5, parentId: network.id });
    await roundTrips('itsm.category', vpn.id);
    await archivesAndRestores('itsm.category', vpn.id);
    const list = await h.call(admin, 'GET', '/api/v1/itsm/categories');
    expect(list.body.items.find((c: LooseJson) => c.key === 'cz-vpn')).toMatchObject({
      path: 'Network › VPN',
    });
  });

  it('checks keys, parents (no loops) and groups', async () => {
    const now = (await cz().get('itsm.category', ids_.network, as.admin))!;
    expect(
      issues(
        await validate('itsm.category', {
          op: 'update',
          id: ids_.network,
          value: { ...(now.value as object), key: 'cz-vpn', parentId: ids_.vpn },
        }),
      ),
    ).toEqual(['key:duplicate_key', 'parentId:invalid_parent']);
    const missing = '0190a0a0-0000-7000-8000-000000000000';
    expect(
      issues(
        await validate('itsm.category', {
          op: 'create',
          id: null,
          value: {
            key: 'cz-x',
            name: { en: 'X' },
            ticketTypes: ['incident'],
            parentId: missing,
            defaultGroupId: missing,
          },
        }),
      ),
    ).toEqual(['parentId:unknown_parent', 'defaultGroupId:unknown_group']);
  });

  it('a dry run leaves nothing behind, not even in the category cache', async () => {
    const warm = await h.call(admin, 'GET', '/api/v1/itsm/categories?includeInactive=true');
    expect(warm.status).toBe(200);
    const before = await traces();
    await dryRun('itsm.category', {
      op: 'create',
      id: null,
      value: { key: 'cz-dry', name: { en: 'Dry' }, ticketTypes: ['incident'] },
    });
    await dryRun('itsm.category', { op: 'archive', id: ids_.network, value: null });
    expect(await traces()).toEqual(before);
    const after = await h.call(admin, 'GET', '/api/v1/itsm/categories?includeInactive=true');
    expect(after.body.items.map((c: LooseJson) => c.key)).not.toContain('cz-dry');
    expect(after.body.items.find((c: LooseJson) => c.key === 'cz-network').active).toBe(true);
  });

  it('refuses people without itsm.config.manage', async () => {
    const value = { key: 'cz-nope', name: { en: 'Nope' }, ticketTypes: ['incident'] };
    expect((await refused(apply('itsm.category', { op: 'create', id: null, value }, as.reader))).code).toBe(
      'FORBIDDEN',
    );
    expect(
      (await refused(validate('itsm.category', { op: 'create', id: null, value }, as.reader))).code,
    ).toBe('FORBIDDEN');
  });
});

/* ───────────────────────────── itsm.sla-policy ───────────────────────────── */

describe('itsm.sla-policy', () => {
  let id = '';

  it('builds a policy from the SLA targets template', async () => {
    const fields = await cz().templateFields('itsm.sla-policy', 'sla-targets', as.admin);
    expect(fields.map((f) => f.key)).toEqual([
      'name',
      'ticketTypes',
      'calendarId',
      'p1Response',
      'p1Resolution',
      'p2Response',
      'p2Resolution',
      'p3Response',
      'p3Resolution',
      'p4Response',
      'p4Resolution',
    ]);
    expect(fields[3]!.label).toEqual({
      en: 'P1 · Critical: response time (minutes)',
      'zh-TW': 'P1 · 緊急：回應時間（分鐘）',
      'ja-JP': 'P1 · 緊急: 応答時間 (分)',
    });
    expect(fields.find((f) => f.key === 'calendarId')!.options!.map((o) => o.value)).toEqual([ids.calendar]);
    const answers = Object.fromEntries(
      fields.map((f) => [f.key, f.defaultValue ?? (f.key === 'name' ? 'Standard incidents' : null)]),
    );
    const built = await cz().buildTemplate('itsm.sla-policy', 'sla-targets', answers, as.admin);
    expect(built.value).toMatchObject({
      name: 'Standard incidents',
      calendarId: ids.calendar,
      targets: { '1': { responseMinutes: 15, resolutionMinutes: 240 } },
    });
    expect(
      (await validate('itsm.sla-policy', { op: 'create', id: null, value: built.value })).issues,
    ).toEqual([]);
    const created = await apply('itsm.sla-policy', { op: 'create', id: null, value: built.value });
    id = created.id;
    expect(created.after).toMatchObject({ archived: false, value: { warnAt: 0.75, sortOrder: 100 } });
  });

  it('updates with a condition, round-trips, archives (deactivates) and restores', async () => {
    const now = (await cz().get('itsm.sla-policy', id, as.admin))!;
    const updated = await apply('itsm.sla-policy', {
      op: 'update',
      id,
      value: {
        ...(now.value as object),
        condition: { fact: 'ticket.categoryKey', op: 'eq', value: 'cz-vpn' },
        sortOrder: 10,
      },
      baseVersion: now.version,
    });
    expect(updated.after!.value).toMatchObject({ condition: { fact: 'ticket.categoryKey' }, sortOrder: 10 });
    await roundTrips('itsm.sla-policy', id);
    await archivesAndRestores('itsm.sla-policy', id);
  });

  it('checks the calendar and the condition’s facts and category keys', async () => {
    const now = (await cz().get('itsm.sla-policy', id, as.admin))!;
    const v = await validate('itsm.sla-policy', {
      op: 'update',
      id,
      value: {
        ...(now.value as object),
        calendarId: '0190a0a0-0000-7000-8000-000000000000',
        condition: {
          all: [
            { fact: 'ticket.colour', op: 'eq', value: 'red' },
            { fact: 'ticket.categoryKey', op: 'in', value: ['cz-vpn', 'cz-nothing'] },
          ],
        },
      },
    });
    expect(issues(v)).toEqual([
      'calendarId:unknown_calendar',
      'condition:unknown_fact',
      'condition:unknown_category',
    ]);
    const partial = await validate('itsm.sla-policy', {
      op: 'update',
      id,
      value: { ...(now.value as object), targets: { '1': { responseMinutes: 5, resolutionMinutes: 10 } } },
    });
    expect(partial.value).toBeNull();
  });

  it('a dry run leaves nothing behind', async () => {
    const now = (await cz().get('itsm.sla-policy', id, as.admin))!;
    const before = await traces();
    await dryRun('itsm.sla-policy', {
      op: 'create',
      id: null,
      value: { ...(now.value as object), name: 'Dry' },
    });
    await dryRun('itsm.sla-policy', { op: 'archive', id, value: null });
    expect(await traces()).toEqual(before);
  });
});

/* ───────────────────────────── itsm.catalog-item ───────────────────────────── */

describe('itsm.catalog-item', () => {
  it('adds a published form to the catalog, updates, round-trips and deletes it', async () => {
    const created = await apply('itsm.catalog-item', {
      op: 'create',
      id: null,
      value: { formKey: 'cz-monitor', groupId: ids.ops, priority: 2, fulfilOn: 'submitted' },
    });
    expect(created.id).toBe('cz-monitor');
    expect(created.after).toMatchObject({
      label: 'Request a monitor',
      href: '/itsm/settings?tab=catalog',
      value: { formKey: 'cz-monitor', active: true, categoryId: null, groupId: ids.ops, priority: 2 },
    });
    const updated = await apply('itsm.catalog-item', {
      op: 'update',
      id: 'cz-monitor',
      value: { ...(created.after!.value as object), priority: 3, fulfilOn: 'approved' },
      baseVersion: created.after!.version,
    });
    expect(updated.after!.value).toMatchObject({ priority: 3, fulfilOn: 'approved' });
    await roundTrips('itsm.catalog-item', 'cz-monitor');
    const catalog = await h.call(admin, 'GET', '/api/v1/itsm/catalog');
    expect(catalog.body.items.find((i: LooseJson) => i.formKey === 'cz-monitor').fulfilment).toMatchObject({
      priority: 3,
    });
  });

  it('checks the form key (fixed), the form, the category and the group', async () => {
    const now = (await cz().get('itsm.catalog-item', 'cz-monitor', as.admin))!;
    expect(
      issues(
        await validate('itsm.catalog-item', {
          op: 'update',
          id: 'cz-monitor',
          value: { ...(now.value as object), formKey: 'other' },
        }),
      ),
    ).toEqual(['formKey:immutable', 'formKey:unknown_form']);
    expect(issues(await validate('itsm.catalog-item', { op: 'create', id: null, value: now.value }))).toEqual(
      ['formKey:duplicate_key'],
    );
    const missing = '0190a0a0-0000-7000-8000-000000000000';
    expect(
      issues(
        await validate('itsm.catalog-item', {
          op: 'create',
          id: null,
          value: { formKey: 'cz-unknown', categoryId: missing, groupId: missing },
        }),
      ),
    ).toEqual(['formKey:unknown_form', 'categoryId:unknown_category', 'groupId:unknown_group']);
  });

  it('sees a form published earlier in the same transaction (a change set publishing both)', async () => {
    const before = await traces();
    const applied = await rolledBack(async (tx) => {
      await tx.insert(forms).values({
        key: 'cz-tx-form',
        name: { en: 'Published in this change set' },
        draft: { elements: [] },
        publishedVersion: 1,
      });
      return cz().apply(
        'itsm.catalog-item',
        { op: 'create', id: null, value: { formKey: 'cz-tx-form' } },
        { auth: as.admin, tx },
      );
    });
    expect(applied.after).toMatchObject({ id: 'cz-tx-form', label: 'Published in this change set' });
    expect(await traces()).toEqual(before);
  });

  it('a dry run leaves nothing behind; deletes', async () => {
    const before = await traces();
    await dryRun('itsm.catalog-item', { op: 'delete', id: 'cz-monitor', value: null });
    expect(await traces()).toEqual(before);
    await apply('itsm.catalog-item', { op: 'delete', id: 'cz-monitor', value: null });
    expect(await cz().get('itsm.catalog-item', 'cz-monitor', as.admin)).toBeNull();
  });
});
