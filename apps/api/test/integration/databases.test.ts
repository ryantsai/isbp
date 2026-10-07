import { auditLogs } from '@isbp/db/schema';
import {
  type AuthContext,
  defineManifest,
  defineServerModule,
  HttpError,
  httpErrors,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHarness, type Harness, type Session } from './harness';

/** A module contributing a task type, to exercise `ctx.taskTypes` without Scheduled Jobs. */
const taskModule = defineServerModule(
  defineManifest({
    id: 'itest-tasks',
    version: '1.0.0',
    name: 'Test tasks',
    permissions: [{ key: 'itest-tasks.jobs.run', description: 'Run test tasks' }],
    taskTypes: [
      {
        type: 'echo',
        name: 'Echo',
        permission: 'itest-tasks.jobs.run',
        config: z.object({ message: z.string().min(1) }),
      },
    ],
  }),
  {
    taskTypes: {
      echo: {
        validate: async (config: { message: string }) => {
          if (config.message === 'forbidden') throw httpErrors.forbidden('Not this message');
        },
        describe: async (config: { message: string }) => ({ label: `Echo ${config.message}`, href: '/x' }),
        run: async (config: { message: string }, task) => {
          task.log(config.message);
          return { summary: `said ${config.message}`, metrics: { words: config.message.split(' ').length } };
        },
      },
    },
  },
);

const authWith = (global: boolean) =>
  ({ reach: () => ({ global, departmentIds: [], records: [] }) }) as unknown as AuthContext;

let h: Harness;
let admin: Session;
let ctx: ModuleContext;
const url = new URL(process.env.DATABASE_URL ?? 'postgres://isbp:isbp@localhost:5432/isbp_test');
const draft = {
  engine: 'postgres',
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.slice(1),
  username: decodeURIComponent(url.username),
  options: { tls: 'off' },
  purposes: ['data'],
};

beforeAll(async () => {
  h = await createHarness({ extraModules: [taskModule] });
  admin = await h.login('admin');
  ctx = h.kernel.registry.context('core');
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  await c.query('drop table if exists public.itest_items');
  await c.query('create table public.itest_items (id int primary key, name text not null)');
  await c.query("insert into public.itest_items select g, 'item ' || g from generate_series(1, 25) g");
  await c.end();
}, 120_000);

afterAll(async () => {
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  await c.query('drop table if exists public.itest_items');
  await c.end();
  await h?.close();
});

describe('database connections', () => {
  let id: string;

  it('registers a connection; the password is write-only and the change is audited', async () => {
    const res = await h.call(admin, 'POST', '/api/v1/databases', {
      ...draft,
      key: 'itest-pg',
      name: 'Integration Postgres',
      password: decodeURIComponent(url.password),
    });
    expect(res.status).toBe(201);
    id = res.body.id;
    expect(res.body).toMatchObject({
      key: 'itest-pg',
      hasPassword: true,
      status: 'unknown',
      purposes: ['data'],
    });
    expect(Object.keys(res.body)).not.toContain('password');
    expect(Object.keys(res.body)).not.toContain('passwordSealed');
    const audits = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.db-connection.created'), eq(auditLogs.entityId, id)));
    expect(audits).toHaveLength(1);
    const dup = await h.call(admin, 'POST', '/api/v1/databases', {
      ...draft,
      key: 'itest-pg',
      name: 'x',
      password: null,
    });
    expect(dup.status).toBe(409);
  });

  it('tests a saved connection and records its status', async () => {
    const res = await h.call(admin, 'POST', `/api/v1/databases/${id}/test`);
    expect(res.body).toMatchObject({ ok: true, error: null });
    expect(res.body.version).toMatch(/PostgreSQL/);
    const row = await h.call(admin, 'GET', `/api/v1/databases/${id}`);
    expect(row.body).toMatchObject({ status: 'ok' });
    expect(row.body.lastCheckedAt).toBeTruthy();
  });

  it('tests unsaved settings, reusing the stored password for an existing connection', async () => {
    const wrong = await h.call(admin, 'POST', '/api/v1/databases/test', {
      ...draft,
      password: 'wrong-password',
    });
    expect(wrong.body).toMatchObject({ ok: false, error: { kind: 'auth' } });
    const reuse = await h.call(admin, 'POST', '/api/v1/databases/test', { ...draft, id });
    expect(reuse.body.ok).toBe(true);
  });

  it('browses the catalog visible to the login', async () => {
    const res = await h.call(admin, 'GET', `/api/v1/databases/${id}/catalog?refresh=true`);
    expect(res.status).toBe(200);
    const table = res.body.tables.find((t: { name: string }) => t.name === 'itest_items');
    expect(table.columns.map((c: { name: string; key: boolean }) => [c.name, c.key])).toEqual([
      ['id', true],
      ['name', false],
    ]);
  });

  it('refuses link-local and metadata hosts', async () => {
    const res = await h.call(admin, 'POST', '/api/v1/databases', {
      ...draft,
      key: 'metadata',
      name: 'Nope',
      host: '169.254.169.254',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TARGET_BLOCKED');
  });

  it('gives modules bound queries, limited to the connection’s purposes and limits', async () => {
    const r = await ctx.databases.query(
      id,
      'select id, name from public.itest_items where id <= :max order by id',
      {
        purpose: 'data',
        params: { max: 3 },
      },
    );
    expect(r.rows).toEqual([
      { id: 1, name: 'item 1' },
      { id: 2, name: 'item 2' },
      { id: 3, name: 'item 3' },
    ]);
    await expect(ctx.databases.query(id, 'select 1', { purpose: 'admin' })).rejects.toMatchObject({
      code: 'CONNECTION_PURPOSE',
    });
    await expect(
      ctx.databases.query(id, 'select * from public.itest_missing', { purpose: 'data' }),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR', details: { kind: 'not_found', dbCode: '42P01' } });

    await h.call(admin, 'PATCH', `/api/v1/databases/${id}`, { maxRows: 5 });
    const capped = await ctx.databases.query(id, 'select * from public.itest_items', {
      purpose: 'data',
      maxRows: 1000,
    });
    expect(capped.rows).toHaveLength(5);
    expect(capped.truncated).toBe(true);
  });

  it('writes through a transactional writer unless the connection is read-only', async () => {
    const w = await ctx.databases.writer(
      id,
      { schema: 'public', name: 'itest_items' },
      {
        purpose: 'data',
        columns: ['id', 'name'],
        mode: 'upsert',
        keys: ['id'],
      },
    );
    await w.write([
      { id: 1, name: 'first' },
      { id: 26, name: 'new' },
    ]);
    await w.commit();
    const r = await ctx.databases.query(
      id,
      'select name from public.itest_items where id in (:ids) order by id',
      {
        purpose: 'data',
        params: { ids: [1, 26] },
      },
    );
    expect(r.rows.map((x) => x.name)).toEqual(['first', 'new']);

    await h.call(admin, 'PATCH', `/api/v1/databases/${id}`, { readOnly: true });
    await expect(
      ctx.databases.writer(id, { name: 'itest_items' }, { purpose: 'data', columns: ['id'], mode: 'insert' }),
    ).rejects.toMatchObject({ code: 'CONNECTION_READ_ONLY' });
    await expect(
      ctx.databases.query(id, 'delete from public.itest_items', { purpose: 'data' }),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR', details: { kind: 'read_only' } });
  });

  it('refuses disabled connections and keeps credentials when other settings change', async () => {
    await h.call(admin, 'PATCH', `/api/v1/databases/${id}`, { enabled: false, readOnly: false });
    await expect(ctx.databases.query(id, 'select 1', { purpose: 'data' })).rejects.toMatchObject({
      code: 'CONNECTION_DISABLED',
    });
    await h.call(admin, 'PATCH', `/api/v1/databases/${id}`, { enabled: true });
    expect((await ctx.databases.query(id, 'select 1 as one', { purpose: 'data' })).rows).toEqual([
      { one: 1 },
    ]);
    const changed = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.db-connection.updated'), eq(auditLogs.entityId, id)));
    expect(changed.length).toBeGreaterThan(0);
  });

  it('needs core.databases.* permissions', async () => {
    const outsider = await h.login('outsider');
    expect((await h.call(outsider, 'GET', '/api/v1/databases')).status).toBe(403);
    expect((await h.call(outsider, 'POST', '/api/v1/databases/test', draft)).status).toBe(403);
  });

  it('deletes a connection', async () => {
    expect((await h.call(admin, 'DELETE', `/api/v1/databases/${id}`)).status).toBe(204);
    expect(await ctx.databases.get(id)).toBeNull();
    await expect(ctx.databases.query(id, 'select 1', { purpose: 'data' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('module cache', () => {
  it('stores JSON values per module and rate-limits in fixed windows', async () => {
    const cache = h.kernel.registry.context('itest-tasks').cache;
    await cache.set('answer', { n: 42 }, 60);
    expect(await cache.get('answer')).toEqual({ n: 42 });
    expect(await ctx.cache.get('answer')).toBeNull(); // another module's namespace
    await cache.delete('answer');
    expect(await cache.get('answer')).toBeNull();
    expect(await cache.increment('hits', 60)).toBe(1);
    expect(await cache.increment('hits', 60)).toBe(2);
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push(await cache.rateLimit('client-a', 2, 60));
    expect(hits.map((x) => x.allowed)).toEqual([true, true, false]);
    expect(hits[2]!.remaining).toBe(0);
    expect(hits[2]!.resetSeconds).toBeGreaterThan(0);
  });
});

describe('task types', () => {
  it('lists types by permission, validates config and runs the handler in its module', async () => {
    const all = ctx.taskTypes.list();
    expect(all.map((t) => t.type)).toContain('itest-tasks.echo');
    expect(ctx.taskTypes.list(authWith(false)).map((t) => t.type)).not.toContain('itest-tasks.echo');
    const info = all.find((t) => t.type === 'itest-tasks.echo')!;
    expect(info.configSchema).toMatchObject({ type: 'object', properties: { message: { type: 'string' } } });

    await expect(
      ctx.taskTypes.validate('itest-tasks.echo', { message: '' }, authWith(true)),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      ctx.taskTypes.validate('itest-tasks.echo', { message: 'hi' }, authWith(false)),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      ctx.taskTypes.validate('itest-tasks.echo', { message: 'forbidden' }, authWith(true)),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(ctx.taskTypes.validate('nope.nothing', {}, authWith(true))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await ctx.taskTypes.describe('itest-tasks.echo', { message: 'hi' })).toEqual({
      label: 'Echo hi',
      href: '/x',
    });

    const lines: string[] = [];
    const outcome = await ctx.taskTypes.run(
      'itest-tasks.echo',
      { message: 'hello world' },
      {
        runId: 'r1',
        jobId: 'j1',
        attempt: 1,
        scheduledFor: new Date(),
        lastSuccessAt: null,
        signal: new AbortController().signal,
        log: (m) => lines.push(m),
      },
    );
    expect(outcome).toEqual({ summary: 'said hello world', metrics: { words: 2 } });
    expect(lines).toEqual(['hello world']);
  });
});
