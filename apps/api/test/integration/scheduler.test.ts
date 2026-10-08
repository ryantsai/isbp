import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  auditLogs,
  dbConnections,
  groupMembers,
  groups,
  notifications,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { services } from '@isbp/module-scheduler/server';
import { jobs, runLogs, runs } from '@isbp/module-scheduler/schema';
import {
  defineManifest,
  defineServerModule,
  httpErrors,
  type ModuleContext,
  type TaskContext,
} from '@isbp/sdk/server';
import { and, asc, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/** Only Scheduled jobs (other Phase 4 modules may be mid-change); restored after setup. */
const MODULES = process.env.ISBP_TEST_MODULES;
const API = '/api/v1/scheduler';

/** What the scheduler last handed the echo task. */
let lastTask: TaskContext | null = null;

/** A module contributing a task type, like ETL's `etl.pipeline`. */
const echoModule = defineServerModule(
  defineManifest({
    id: 'sched-itest',
    version: '1.0.0',
    name: 'Scheduler test tasks',
    permissions: [{ key: 'sched-itest.echo.run', description: 'Run echo tasks' }],
    taskTypes: [
      {
        type: 'echo',
        name: 'sched-itest.taskTypes.echo.name',
        permission: 'sched-itest.echo.run',
        config: z.object({ message: z.string().min(1), words: z.number().int().default(1) }),
      },
    ],
  }),
  {
    taskTypes: {
      echo: {
        validate: async (config: { message: string }) => {
          if (config.message === 'forbidden') throw httpErrors.forbidden('Not this message');
        },
        describe: async (config: { message: string }) => ({
          label: `Echo: ${config.message}`,
          href: '/echo',
        }),
        run: async (config: { message: string }, task) => {
          lastTask = task;
          task.log(`echo ${config.message} (attempt ${task.attempt})`);
          return {
            summary: `said ${config.message}`,
            metrics: { words: config.message.split(' ').length },
            href: '/echo/1',
          };
        },
      },
    },
  },
);

let h: Harness;
let ctx: ModuleContext;
let stopWorker: () => Promise<void>;
let server: Server;
let base: string;
const s: Record<string, Session> = {};
const ids = {} as Record<'operator' | 'operator2' | 'viewer' | 'opsTeam' | 'conn', string>;
const hits: { path: string; headers: IncomingMessage['headers']; body: string }[] = [];
const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgres://isbp:isbp@localhost:5432/isbp_test');

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
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

const getRun = async (id: string) => (await h.call(s.admin!, 'GET', `${API}/runs/${id}`)).body as LooseJson;
const waitRun = (id: string, done: (r: LooseJson) => boolean, timeoutMs?: number) =>
  eventually(() => getRun(id), done, timeoutMs);
const finished = (r: LooseJson) =>
  ['succeeded', 'failed', 'timed_out', 'cancelled', 'skipped'].includes(r.status);
const logsOf = async (runId: string) =>
  h.kernel.db.select().from(runLogs).where(eq(runLogs.runId, runId)).orderBy(asc(runLogs.seq));

/** A job with sensible defaults (manual trigger, no retries). */
async function createJob(who: string, body: Record<string, unknown>) {
  return h.call(s[who]!, 'POST', `${API}/jobs`, {
    trigger: { kind: 'manual' },
    timeoutSeconds: 30,
    ...body,
  });
}

const http = (path: string, extra: Record<string, unknown> = {}) => ({
  type: 'scheduler.http',
  config: { method: 'GET', url: `${base}${path}`, ...extra },
});

async function runNow(jobId: string, who = 'admin') {
  const res = await h.call(s[who]!, 'POST', `${API}/jobs/${jobId}/run`);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? 'scheduler';
  try {
    h = await createHarness({ extraModules: [echoModule] });
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  ctx = h.kernel.registry.context('scheduler');
  stopWorker = await startWorker(h.kernel);

  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0]!;
      hits.push({ path, headers: req.headers, body });
      if (path === '/ok') return res.writeHead(200, { 'content-type': 'text/plain' }).end('pong');
      if (path === '/echo')
        return res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ key: req.headers['x-api-key'], auth: req.headers.authorization }));
      if (path === '/fail')
        return res.writeHead(503, { 'content-type': 'text/plain' }).end('down for maintenance');
      if (path === '/slow') {
        const t = setTimeout(() => res.writeHead(200).end('late'), 4_000);
        res.on('close', () => clearTimeout(t));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const db = h.kernel.db;
  ids.operator = await mkUser('operator');
  ids.operator2 = await mkUser('operator2');
  ids.viewer = await mkUser('viewer');
  const [team] = await db.insert(groups).values({ key: 'ops-team', name: 'Operations' }).returning();
  ids.opsTeam = team!.id;
  await db.insert(groupMembers).values({ groupId: team!.id, userId: ids.operator2 });
  await db.insert(roleAssignments).values([
    { roleId: await roleId('scheduler-operator'), userId: ids.operator },
    { roleId: await roleId('scheduler-operator'), userId: ids.operator2 },
    { roleId: await roleId('scheduler-viewer'), userId: ids.viewer },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'operator', 'operator2', 'viewer']) s[u] = await h.login(u);

  // A data connection to the test database itself, and a table for SQL jobs.
  const c = new pg.Client({ connectionString: dbUrl.toString() });
  await c.connect();
  await c.query('drop schema if exists sched_itest cascade');
  await c.query('create schema sched_itest');
  await c.query(
    'create table sched_itest.events (id serial primary key, note text not null, at timestamptz)',
  );
  await c.query("insert into sched_itest.events (note) select 'seed ' || g from generate_series(1, 12) g");
  await c.end();
  const [conn] = await db
    .insert(dbConnections)
    .values({
      key: 'sched-itest',
      name: 'Scheduler test database',
      engine: 'postgres',
      host: dbUrl.hostname,
      port: Number(dbUrl.port || 5432),
      database: dbUrl.pathname.slice(1),
      username: decodeURIComponent(dbUrl.username),
      passwordSealed: h.kernel.box.encrypt(decodeURIComponent(dbUrl.password)),
      options: { tls: 'off' },
      purposes: ['data'],
    })
    .returning();
  ids.conn = conn!.id;
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  const c = new pg.Client({ connectionString: dbUrl.toString() });
  await c.connect();
  await c.query('drop schema if exists sched_itest cascade');
  await c.end();
  await h?.close();
});

describe('HTTP jobs', () => {
  let jobId: string;

  it('creates an HTTP job; secrets are sealed and never returned', async () => {
    const res = await createJob('admin', {
      name: 'Echo endpoint',
      ...http('/echo', {
        headers: [
          { name: 'X-Api-Key', value: 'k3y-sup3r-s3cret', secret: true },
          { name: 'Accept', value: 'application/json', secret: false },
        ],
        auth: { type: 'bearer', token: 'b3arer-t0ken-xyz' },
        expectedStatus: '200',
      }),
      ownerGroupId: ids.opsTeam,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    jobId = res.body.id;
    expect(res.body.reference).toMatch(/^JOB-\d{5}$/);
    expect(res.body.config.headers[0].value).toEqual({ secret: true, set: true });
    expect(res.body.config.auth).toEqual({ type: 'bearer', token: { secret: true, set: true } });
    const text = JSON.stringify((await h.call(s.admin!, 'GET', `${API}/jobs/${jobId}`)).body);
    expect(text).not.toContain('k3y-sup3r-s3cret');
    expect(text).not.toContain('sealed');
    const [row] = await h.kernel.db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(JSON.stringify(row!.config)).not.toContain('k3y-sup3r-s3cret');
    expect(
      (await h.kernel.db.select().from(auditLogs).where(eq(auditLogs.action, 'scheduler.job.created')))
        .length,
    ).toBe(1);
  });

  it('runs now: succeeded, with the secrets sent and masked in the log', async () => {
    const runId = await runNow(jobId);
    const run = await waitRun(runId, finished);
    expect(run.status, JSON.stringify(run)).toBe('succeeded');
    expect(run.trigger).toBe('manual');
    expect(run.summary).toMatch(/^HTTP 200/);
    expect(run.metrics.status).toBe(200);
    const hit = hits.find((x) => x.path === '/echo')!;
    expect(hit.headers['x-api-key']).toBe('k3y-sup3r-s3cret');
    expect(hit.headers.authorization).toBe('Bearer b3arer-t0ken-xyz');
    const lines = await logsOf(runId);
    const text = lines.map((l) => l.message).join('\n');
    expect(text).toContain('HTTP 200');
    expect(text).toContain('••••••');
    expect(text).not.toContain('k3y-sup3r-s3cret');
    expect(lines.map((l) => l.seq)).toEqual(lines.map((_, i) => i + 1));
  });

  it('keeps stored secrets when the placeholder comes back on edit', async () => {
    const detail = (await h.call(s.admin!, 'GET', `${API}/jobs/${jobId}`)).body;
    const res = await h.call(s.admin!, 'PATCH', `${API}/jobs/${jobId}`, {
      config: { ...detail.config, url: `${base}/echo?v=2` },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const runId = await runNow(jobId);
    expect((await waitRun(runId, finished)).status).toBe('succeeded');
    expect(hits.at(-1)!.headers['x-api-key']).toBe('k3y-sup3r-s3cret');
    // A forged sealed value is refused.
    const forged = await h.call(s.admin!, 'PATCH', `${API}/jobs/${jobId}`, {
      config: { ...detail.config, auth: { type: 'bearer', token: { sealed: 'v1:abc' } } },
    });
    expect(forged.status).toBe(400);
    expect(forged.body.error.details.issues[0].path).toBe('config.auth.token');
  });

  it('retries a failing job with backoff, then fails and notifies the owner and owner group', async () => {
    const res = await createJob('admin', {
      name: 'Failing endpoint',
      ...http('/fail'),
      ownerId: ids.operator,
      ownerGroupId: ids.opsTeam,
      retries: { maxAttempts: 3, backoff: 'fixed', delaySeconds: 1 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const runId = await runNow(res.body.id);
    const retrying = await waitRun(runId, (r) => r.status === 'retrying' || finished(r));
    expect(retrying.status).toBe('retrying');
    const run = await waitRun(runId, finished);
    expect(run.status).toBe('failed');
    expect(run.attempt).toBe(3);
    expect(run.attempts.map((a: LooseJson) => a.status)).toEqual(['failed', 'failed', 'failed']);
    expect(run.error).toMatch(/Unexpected status 503/);
    const starts = run.attempts.map((a: LooseJson) => new Date(a.startedAt).getTime());
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(900);
    const text = (await logsOf(runId)).map((l) => l.message).join('\n');
    expect(text).toContain('Retrying in 1 s (attempt 2 of 3');
    expect(text).toContain('down for maintenance');
    for (const user of [ids.operator, ids.operator2]) {
      const rows = await h.kernel.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, user), eq(notifications.type, 'scheduler.run.failed')));
      expect(rows.length, user).toBe(1);
    }
    const job = (await h.call(s.admin!, 'GET', `${API}/jobs/${res.body.id}`)).body;
    expect(job.failureStreak).toBe(1);
    expect(job.lastRun.status).toBe('failed');
  });

  it('auto-disables a job after N consecutive failures', async () => {
    const res = await createJob('admin', {
      name: 'Flaky endpoint',
      ...http('/fail'),
      ownerId: ids.operator,
      trigger: { kind: 'interval', intervalMinutes: 60 },
      alerts: { onFailure: true, channels: false, autoDisableAfter: 2 },
    });
    expect(res.body.enabled).toBe(true);
    for (let i = 0; i < 2; i++) {
      const runId = await runNow(res.body.id);
      expect((await waitRun(runId, finished)).status).toBe('failed');
    }
    const job = (await h.call(s.admin!, 'GET', `${API}/jobs/${res.body.id}`)).body;
    expect(job).toMatchObject({ enabled: false, disabledReason: 'auto', failureStreak: 2, nextRunAt: null });
    const notes = await h.kernel.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, ids.operator), eq(notifications.type, 'scheduler.job.auto_disabled')),
      );
    expect(notes).toHaveLength(1);
  });

  it('times out a slow call', async () => {
    const res = await createJob('admin', { name: 'Slow endpoint', ...http('/slow'), timeoutSeconds: 1 });
    const runId = await runNow(res.body.id);
    const run = await waitRun(runId, finished);
    expect(run.status).toBe('timed_out');
    expect(run.error).toBe('Timed out after 1 s');
  });

  it('cancels a running run', async () => {
    const res = await createJob('admin', { name: 'Cancel me', ...http('/slow'), timeoutSeconds: 30 });
    const runId = await runNow(res.body.id);
    await waitRun(runId, (r) => r.status === 'running');
    // A running run can't be deleted.
    const del = await h.call(s.admin!, 'DELETE', `${API}/jobs/${res.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('JOB_RUNNING');
    const cancel = await h.call(s.admin!, 'POST', `${API}/runs/${runId}/cancel`);
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const run = await waitRun(runId, finished);
    expect(run.status).toBe('cancelled');
    expect(
      (await h.kernel.db.select().from(auditLogs).where(eq(auditLogs.action, 'scheduler.run.cancelled')))
        .length,
    ).toBe(1);
    expect((await h.call(s.admin!, 'DELETE', `${API}/jobs/${res.body.id}`)).status).toBe(204);
  });

  it('skips a run while the previous one is still going (concurrency "skip")', async () => {
    const res = await createJob('admin', {
      name: 'Overlapping job',
      ...http('/slow'),
      trigger: { kind: 'interval', intervalMinutes: 60 },
      concurrency: 'skip',
    });
    const first = await runNow(res.body.id);
    await waitRun(first, (r) => r.status === 'running');
    // Run now refuses; a scheduled slot that comes up meanwhile is skipped.
    const again = await h.call(s.admin!, 'POST', `${API}/jobs/${res.body.id}/run`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('JOB_RUNNING');
    await h.kernel.db
      .update(jobs)
      .set({ nextRunAt: new Date(Date.now() - 1_000) })
      .where(eq(jobs.id, res.body.id));
    await services(ctx).engine.tick();
    const scheduled = await eventually(
      () =>
        h.kernel.db
          .select()
          .from(runs)
          .where(and(eq(runs.jobId, res.body.id), eq(runs.trigger, 'schedule'))),
      (rows) => rows.some((r) => r.status === 'skipped'),
    );
    expect(scheduled[0]).toMatchObject({ status: 'skipped', skipReason: 'overlap' });
    expect((await waitRun(first, finished)).status).toBe('succeeded');
  });

  it('queues a run behind the previous one (concurrency "queue")', async () => {
    const res = await createJob('admin', { name: 'Queued job', ...http('/slow'), concurrency: 'queue' });
    const first = await runNow(res.body.id);
    await waitRun(first, (r) => r.status === 'running');
    const second = await runNow(res.body.id);
    await new Promise((r) => setTimeout(r, 1_000));
    expect((await getRun(second)).status).toBe('queued');
    const a = await waitRun(first, finished);
    const b = await waitRun(second, finished, 30_000);
    expect([a.status, b.status]).toEqual(['succeeded', 'succeeded']);
    expect(new Date(b.startedAt).getTime()).toBeGreaterThanOrEqual(new Date(a.finishedAt).getTime());
  });

  it('streams the log over Server-Sent Events until the run ends', async () => {
    const runId = await runNow(jobId);
    const res = await h.app.inject({
      method: 'GET',
      url: `${API}/runs/${runId}/logs/stream`,
      headers: { cookie: s.viewer!.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('event: lines');
    expect(res.body).toMatch(/event: end\ndata: \{"status":"succeeded"\}/);
    const frames = res.body
      .split('\n\n')
      .filter((f) => f.includes('event: lines'))
      .flatMap((f) => JSON.parse(f.split('\ndata: ')[1]!) as { seq: number; message: string }[]);
    expect(frames.some((l) => l.message.includes('HTTP 200'))).toBe(true);
    // Resuming after the last line yields nothing new.
    const resumed = await h.app.inject({
      method: 'GET',
      url: `${API}/runs/${runId}/logs/stream`,
      headers: { cookie: s.viewer!.cookie, 'last-event-id': String(frames.at(-1)!.seq) },
    });
    expect(resumed.body).not.toContain('event: lines');
    const page = await h.call(s.viewer!, 'GET', `${API}/runs/${runId}/logs?after=0`);
    expect(page.body).toMatchObject({ status: 'succeeded', done: true });
    expect(page.body.items.length).toBe(frames.length);
  });
});

describe('dependencies', () => {
  it('starts "any" jobs after an upstream succeeds, and "all" jobs once every upstream has', async () => {
    const a = (await createJob('admin', { name: 'Upstream A', ...http('/ok') })).body;
    const c = (await createJob('admin', { name: 'Upstream C', ...http('/ok') })).body;
    const any = await createJob('admin', {
      name: 'After A (any)',
      ...http('/ok'),
      trigger: { kind: 'after', upstreamIds: [a.id], mode: 'any' },
    });
    expect(any.status, JSON.stringify(any.body)).toBe(201);
    const all = await createJob('admin', {
      name: 'After A and C (all)',
      ...http('/ok'),
      trigger: { kind: 'after', upstreamIds: [a.id, c.id], mode: 'all' },
    });
    expect(all.status).toBe(201);

    const runA = await runNow(a.id);
    await waitRun(runA, finished);
    const anyRuns = await eventually(
      () => h.kernel.db.select().from(runs).where(eq(runs.jobId, any.body.id)),
      (rows) => rows.some((r) => r.status === 'succeeded'),
    );
    expect(anyRuns[0]).toMatchObject({ trigger: 'dependency', upstreamRunId: runA, status: 'succeeded' });
    expect(await h.kernel.db.select().from(runs).where(eq(runs.jobId, all.body.id))).toHaveLength(0);

    const runC = await runNow(c.id);
    await waitRun(runC, finished);
    const allRuns = await eventually(
      () => h.kernel.db.select().from(runs).where(eq(runs.jobId, all.body.id)),
      (rows) => rows.some((r) => r.status === 'succeeded'),
    );
    expect(allRuns).toHaveLength(1);

    const detail = (await h.call(s.admin!, 'GET', `${API}/jobs/${a.id}`)).body;
    expect(detail.downstream.map((d: LooseJson) => d.name).sort()).toEqual([
      'After A (any)',
      'After A and C (all)',
    ]);

    // A → after "After A (any)" would close a loop.
    const cycle = await h.call(s.admin!, 'PATCH', `${API}/jobs/${a.id}`, {
      trigger: { kind: 'after', upstreamIds: [any.body.id], mode: 'any' },
    });
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.code).toBe('JOB_CYCLE');
    expect(cycle.body.error.details.path.map((p: LooseJson) => p.name)).toEqual([
      'Upstream A',
      'After A (any)',
      'Upstream A',
    ]);
    // Deleting an upstream other jobs wait for is refused.
    expect((await h.call(s.admin!, 'DELETE', `${API}/jobs/${c.id}`)).body.error.code).toBe('IN_USE');
  });
});

describe('SQL jobs', () => {
  it('executes a statement with bound parameters on a data connection', async () => {
    const res = await createJob('admin', {
      name: 'Insert an event',
      type: 'scheduler.sql',
      config: {
        connectionId: ids.conn,
        statement: 'INSERT INTO sched_itest.events (note, at) VALUES (:note, :scheduled_for)',
        mode: 'execute',
        params: [
          { name: 'note', source: 'static', type: 'string', value: 'from a job' },
          { name: 'scheduled_for', source: 'scheduled_for', type: 'datetime', value: null },
        ],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.task.label).toContain('Scheduler test database');
    const run = await waitRun(await runNow(res.body.id), finished);
    expect(run.status, run.error).toBe('succeeded');
    expect(run.summary).toBe('1 rows affected');
    const c = new pg.Client({ connectionString: dbUrl.toString() });
    await c.connect();
    const { rows } = await c.query("select note, at from sched_itest.events where note = 'from a job'");
    await c.end();
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].at).getTime()).toBe(new Date(run.scheduledFor).getTime());
  });

  it('queries with a row count and a preview', async () => {
    const res = await createJob('admin', {
      name: 'Count events',
      type: 'scheduler.sql',
      config: {
        connectionId: ids.conn,
        statement: "SELECT id, note FROM sched_itest.events WHERE note LIKE 'seed%' ORDER BY id",
        mode: 'query',
      },
    });
    const run = await waitRun(await runNow(res.body.id), finished);
    expect(run.status, run.error).toBe('succeeded');
    expect(run.metrics.rows).toBe(12);
    const text = (await logsOf(run.id)).map((l) => l.message).join('\n');
    expect(text).toContain('id | note');
    expect(text).toContain('… 2 more row(s)');
  });

  it('validates the statement and its parameters', async () => {
    const twoStatements = await createJob('admin', {
      name: 'Two statements',
      type: 'scheduler.sql',
      config: { connectionId: ids.conn, statement: 'SELECT 1; SELECT 2', mode: 'query' },
    });
    expect(twoStatements.status).toBe(400);
    expect(twoStatements.body.error.details.issues[0].path).toBe('config.statement');
    const missing = await createJob('admin', {
      name: 'Missing parameter',
      type: 'scheduler.sql',
      config: { connectionId: ids.conn, statement: 'SELECT :x', mode: 'query' },
    });
    expect(missing.body.error.details.issues[0].path).toBe('config.params');
  });

  it('records database errors with the server message', async () => {
    const res = await createJob('admin', {
      name: 'Broken query',
      type: 'scheduler.sql',
      config: { connectionId: ids.conn, statement: 'SELECT * FROM sched_itest.nope', mode: 'query' },
    });
    const run = await waitRun(await runNow(res.body.id), finished);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/42P01.*nope/);
  });
});

describe('script jobs', () => {
  it('runs a Node.js script on the local runner, streaming its output', async () => {
    const tasks = (await h.call(s.admin!, 'GET', `${API}/task-types`)).body;
    expect(tasks.sandbox.runner).toBe('local');
    const res = await createJob('admin', {
      name: 'Node script',
      type: 'scheduler.script',
      config: {
        language: 'node',
        image: 'node:24-alpine',
        script:
          "console.log('hello from ' + process.env.WHO);\nconsole.error('token is ' + process.env.TOKEN);",
        env: [
          { name: 'WHO', value: 'the sandbox', secret: false },
          { name: 'TOKEN', value: 'sh-secret-123', secret: true },
        ],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.config.env[1].value).toEqual({ secret: true, set: true });
    const run = await waitRun(await runNow(res.body.id), finished);
    expect(run.status, run.error).toBe('succeeded');
    const lines = await logsOf(run.id);
    expect(lines.find((l) => l.message === 'hello from the sandbox')?.level).toBe('info');
    expect(lines.find((l) => l.message.startsWith('token is'))).toMatchObject({
      level: 'warn',
      message: 'token is ••••••',
    });
  });

  it('fails on a non-zero exit code and refuses images off the allow-list', async () => {
    const res = await createJob('admin', {
      name: 'Exit 3',
      type: 'scheduler.script',
      config: { language: 'node', image: 'node:24-alpine', script: 'process.exit(3)' },
    });
    const run = await waitRun(await runNow(res.body.id), finished);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('The script exited with code 3');
    const bad = await createJob('admin', {
      name: 'Bad image',
      type: 'scheduler.script',
      config: { language: 'node', image: 'evil/image:latest', script: 'console.log(1)' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues[0].path).toBe('config.image');
  });
});

describe('module task types', () => {
  it("runs another module's task type through the registry", async () => {
    const types = (await h.call(s.admin!, 'GET', `${API}/task-types`)).body.items.map(
      (t: LooseJson) => t.type,
    );
    expect(types).toEqual(
      expect.arrayContaining(['scheduler.http', 'scheduler.sql', 'scheduler.script', 'sched-itest.echo']),
    );
    const res = await createJob('admin', {
      name: 'Echo task',
      type: 'sched-itest.echo',
      config: { message: 'hello world' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.config).toEqual({ message: 'hello world', words: 1 });
    expect(res.body.task).toMatchObject({
      label: 'Echo: hello world',
      href: '/echo',
      name: 'sched-itest.taskTypes.echo.name',
    });
    const run = await waitRun(await runNow(res.body.id), finished);
    expect(run).toMatchObject({
      status: 'succeeded',
      summary: 'said hello world',
      href: '/echo/1',
      metrics: { words: 2 },
    });
    // The task learns whether it is the last attempt and who the job alerts itself, so a task type that sends
    // its own failure notice (ETL's) leaves those people out.
    expect(lastTask).toMatchObject({ attempt: 1, maxAttempts: 1, failureRecipients: [h.ids.admin] });
    const quiet = await createJob('admin', {
      name: 'Quiet echo',
      type: 'sched-itest.echo',
      config: { message: 'shh' },
      ownerId: ids.operator,
      ownerGroupId: ids.opsTeam,
      retries: { maxAttempts: 2, backoff: 'fixed', delaySeconds: 1 },
      alerts: { onFailure: false, channels: false, autoDisableAfter: 0 },
    });
    expect(quiet.status, JSON.stringify(quiet.body)).toBe(201);
    await waitRun(await runNow(quiet.body.id), finished);
    expect(lastTask).toMatchObject({ maxAttempts: 2, failureRecipients: [] });
    const alerting = await h.call(s.admin!, 'PATCH', `${API}/jobs/${quiet.body.id}`, {
      alerts: { onFailure: true, channels: false, autoDisableAfter: 0 },
    });
    expect(alerting.status, JSON.stringify(alerting.body)).toBe(200);
    await waitRun(await runNow(quiet.body.id), finished);
    expect([...(lastTask?.failureRecipients ?? [])].sort()).toEqual([ids.operator, ids.operator2].sort());
    const refused = await createJob('admin', {
      name: 'Refused echo',
      type: 'sched-itest.echo',
      config: { message: 'forbidden' },
    });
    expect(refused.status).toBe(403);
    const invalid = await createJob('admin', {
      name: 'Empty echo',
      type: 'sched-itest.echo',
      config: { message: '' },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.issues[0].path).toBe('config.message');
  });
});

describe('permissions', () => {
  it('needs the task type permission to save a job', async () => {
    const sql = await createJob('operator', {
      name: 'Operator SQL',
      type: 'scheduler.sql',
      config: { connectionId: ids.conn, statement: 'SELECT 1', mode: 'query' },
    });
    expect(sql.status).toBe(403);
    const echo = await createJob('operator', {
      name: 'Operator echo',
      type: 'sched-itest.echo',
      config: { message: 'x' },
    });
    expect(echo.status).toBe(403);
    expect((await createJob('viewer', { name: 'Viewer job', ...http('/ok') })).status).toBe(403);
    expect((await h.call(s.operator!, 'GET', `${API}/connections`)).status).toBe(403);
    const types = (await h.call(s.operator!, 'GET', `${API}/task-types`)).body.items.map(
      (t: LooseJson) => t.type,
    );
    expect(types).toEqual(['scheduler.http']);
  });

  it('lets owners and owner-group members edit their jobs; others may only run them', async () => {
    const own = await createJob('operator', {
      name: 'Operator job',
      ...http('/ok'),
      ownerGroupId: ids.opsTeam,
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body.owner.id).toBe(ids.operator);
    expect(own.body.viewer).toEqual({ canEdit: true, canRun: true, canDelete: true });
    // operator2 is in the owner group.
    const byGroup = await h.call(s.operator2!, 'PATCH', `${API}/jobs/${own.body.id}`, {
      description: 'Edited by the team',
    });
    expect(byGroup.status).toBe(200);
    // Admin-owned job: operators can run it (scheduler.jobs.run) but not edit it.
    const adminJob = (await createJob('admin', { name: 'Admin job', ...http('/ok') })).body;
    const view = (await h.call(s.operator!, 'GET', `${API}/jobs/${adminJob.id}`)).body;
    expect(view.viewer).toEqual({ canEdit: false, canRun: true, canDelete: false });
    expect(
      (await h.call(s.operator!, 'PATCH', `${API}/jobs/${adminJob.id}`, { description: 'x' })).status,
    ).toBe(403);
    expect((await h.call(s.operator!, 'POST', `${API}/jobs/${adminJob.id}/disable`)).status).toBe(403);
    expect((await h.call(s.operator!, 'POST', `${API}/jobs/${adminJob.id}/run`)).status).toBe(201);
    // Viewers read but never run.
    expect((await h.call(s.viewer!, 'GET', `${API}/jobs/${adminJob.id}`)).status).toBe(200);
    expect((await h.call(s.viewer!, 'POST', `${API}/jobs/${adminJob.id}/run`)).status).toBe(403);
  });
});

describe('the engine', () => {
  it('validates cron expressions and previews the next runs', async () => {
    const bad = await createJob('admin', {
      name: 'Bad cron',
      ...http('/ok'),
      trigger: { kind: 'cron', cron: '61 * * * *', timezone: 'UTC' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues[0].path).toBe('trigger.cron');
    const preview = await h.call(
      s.viewer!,
      'GET',
      `${API}/schedule/preview?kind=cron&cron=0%207%20*%20*%20*&timezone=Asia/Taipei`,
    );
    expect(preview.body.valid).toBe(true);
    expect(preview.body.next).toHaveLength(5);
    expect(new Date(preview.body.next[0]).getUTCHours()).toBe(23);
    const invalid = await h.call(s.viewer!, 'GET', `${API}/schedule/preview?kind=cron&cron=*%20*%20*`);
    expect(invalid.body).toMatchObject({ valid: false, next: [] });
  });

  it('the tick picks up a due cron job and advances next_run_at', async () => {
    const res = await createJob('admin', {
      name: 'Every five minutes',
      ...http('/ok'),
      trigger: { kind: 'cron', cron: '*/5 * * * *', timezone: 'Asia/Taipei' },
    });
    expect(new Date(res.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    const due = new Date(Date.now() - 10_000);
    await h.kernel.db.update(jobs).set({ nextRunAt: due }).where(eq(jobs.id, res.body.id));
    const result = await services(ctx).engine.tick();
    expect(result.due).toBeGreaterThanOrEqual(1);
    const [run] = await h.kernel.db.select().from(runs).where(eq(runs.jobId, res.body.id));
    expect(run).toMatchObject({ trigger: 'schedule' });
    expect(run!.scheduledFor.getTime()).toBe(due.getTime());
    expect((await waitRun(run!.id, finished)).status).toBe('succeeded');
    const [job] = await h.kernel.db.select().from(jobs).where(eq(jobs.id, res.body.id));
    expect(job!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(job!.nextRunAt!.getUTCMinutes() % 5).toBe(0);
    // A second tick does not fire the same slot again (it may queue the next slot if that is close).
    await services(ctx).engine.tick();
    const slots = (await h.kernel.db.select().from(runs).where(eq(runs.jobId, res.body.id))).map((r) =>
      r.scheduledFor.getTime(),
    );
    expect(slots.filter((t) => t === due.getTime())).toHaveLength(1);
    expect(slots.every((t) => t === due.getTime() || t === job!.nextRunAt!.getTime())).toBe(true);
  });

  it('logs slots missed beyond the grace period as skipped', async () => {
    const res = await createJob('admin', {
      name: 'Yearly',
      ...http('/ok'),
      trigger: { kind: 'cron', cron: '0 0 1 1 *', timezone: 'UTC' },
    });
    await h.kernel.db
      .update(jobs)
      .set({ nextRunAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(jobs.id, res.body.id));
    await services(ctx).engine.tick();
    const [run] = await h.kernel.db.select().from(runs).where(eq(runs.jobId, res.body.id));
    expect(run).toMatchObject({ status: 'skipped', skipReason: 'missed', trigger: 'schedule' });
    expect((await logsOf(run!.id))[0]!.message).toMatch(/^Missed:/);
    const [job] = await h.kernel.db.select().from(jobs).where(eq(jobs.id, res.body.id));
    expect(job!.nextRunAt!.getUTCMonth()).toBe(0);
  });

  it('fails runs whose worker stopped heart-beating, and retries them per policy', async () => {
    const res = await createJob('admin', {
      name: 'Lost worker',
      ...http('/ok'),
      retries: { maxAttempts: 2, backoff: 'fixed', delaySeconds: 1 },
    });
    const old = new Date(Date.now() - 5 * 60_000);
    const [run] = await h.kernel.db
      .insert(runs)
      .values({
        jobId: res.body.id,
        scheduledFor: old,
        trigger: 'schedule',
        status: 'running',
        maxAttempts: 2,
        startedAt: old,
        heartbeatAt: old,
        attempts: [
          { attempt: 1, startedAt: old.toISOString(), finishedAt: null, status: 'running', error: null },
        ],
      })
      .returning();
    const result = await services(ctx).engine.tick();
    expect(result.lost).toBeGreaterThanOrEqual(1);
    const done = await waitRun(run!.id, finished);
    expect(done.status).toBe('succeeded');
    expect(done.attempts.map((a: LooseJson) => [a.attempt, a.status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(done.attempts[0].error).toMatch(/Worker lost/);
  });

  it('purges old runs but keeps the latest run of each job', async () => {
    const res = await createJob('admin', { name: 'Old history', ...http('/ok') });
    const old = new Date(Date.now() - 120 * 86_400_000);
    const values = [0, 1].map((i) => ({
      jobId: res.body.id,
      scheduledFor: new Date(old.getTime() + i * 60_000),
      trigger: 'schedule' as const,
      status: 'succeeded' as const,
      createdAt: new Date(old.getTime() + i * 60_000),
      finishedAt: new Date(old.getTime() + i * 60_000),
    }));
    await h.kernel.db.insert(runs).values(values);
    const deleted = await services(ctx).engine.purge();
    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = await h.kernel.db.select().from(runs).where(eq(runs.jobId, res.body.id));
    expect(left).toHaveLength(1);
    expect(left[0]!.scheduledFor.getTime()).toBe(values[1]!.scheduledFor.getTime());
  });

  it('serves the dashboard and the home card', async () => {
    const d = (await h.call(s.viewer!, 'GET', `${API}/dashboard`)).body;
    expect(d.kpis.runs24h).toBeGreaterThan(10);
    expect(d.kpis.failingJobs).toBeGreaterThanOrEqual(2);
    expect(d.hourly).toHaveLength(24);
    expect(d.hourly.at(-1).counts.succeeded).toBeGreaterThan(0);
    expect(d.failing.map((f: LooseJson) => f.job.name)).toEqual(expect.arrayContaining(['Failing endpoint']));
    expect(d.upcoming.length).toBeGreaterThan(0);
    const a = (await h.call(s.viewer!, 'GET', `${API}/attention`)).body;
    expect(a.failingJobs).toBe(d.kpis.failingJobs);
    const list = (await h.call(s.viewer!, 'GET', `${API}/jobs?view=failing`)).body;
    expect(list.items.every((j: LooseJson) => j.failureStreak > 0)).toBe(true);
    const failedRuns = (await h.call(s.viewer!, 'GET', `${API}/runs?view=failed&pageSize=100`)).body;
    expect(failedRuns.items.every((r: LooseJson) => ['failed', 'timed_out'].includes(r.status))).toBe(true);
  });
});

describe('demo data', () => {
  it('seeds jobs with two weeks of history, idempotently', async () => {
    for (const key of ['contoso-dw', 'contoso-erp'])
      await h.kernel.db.insert(dbConnections).values({
        key,
        name: key,
        engine: 'postgres',
        host: dbUrl.hostname,
        port: Number(dbUrl.port || 5432),
        database: dbUrl.pathname.slice(1),
        username: decodeURIComponent(dbUrl.username),
        passwordSealed: h.kernel.box.encrypt(decodeURIComponent(dbUrl.password)),
        options: { tls: 'off' },
        purposes: ['data'],
        readOnly: key === 'contoso-erp',
      });
    // The seed only runs on an empty module.
    await h.kernel.db.delete(jobs);
    const mod = h.kernel.registry.get('scheduler')!;
    await mod.seed!(ctx);
    await mod.seed!(ctx);
    const all = await h.kernel.db.select().from(jobs).orderBy(asc(jobs.name));
    expect(all.map((j) => j.name)).toEqual([
      'Data quality: orders without lines',
      'Partner feed import',
      'Platform health check',
      'Purge old warehouse rows',
      'Rotate report cache',
      'Weekly capacity report',
    ]);
    const byName = new Map(all.map((j) => [j.name, j]));
    expect(byName.get('Partner feed import')!.failureStreak).toBe(6);
    expect(byName.get('Platform health check')!.failureStreak).toBe(0);
    expect(JSON.stringify(byName.get('Partner feed import')!.config)).not.toContain('demo-partner-key');
    const history = await h.kernel.db.select().from(runs);
    const statuses = new Set(history.map((r) => r.status));
    for (const st of ['succeeded', 'failed', 'timed_out', 'cancelled', 'skipped'])
      expect(statuses, st).toContain(st);
    expect(history.filter((r) => r.jobId === byName.get('Platform health check')!.id).length).toBeGreaterThan(
      1_000,
    );
    expect(history.some((r) => r.attempts.length > 1)).toBe(true);
    const report = history.filter((r) => r.jobId === byName.get('Weekly capacity report')!.id);
    expect(report.length).toBeGreaterThan(5);
    expect(report.every((r) => r.trigger === 'dependency' && r.upstreamRunId)).toBe(true);
    const recent = history.filter((r) => r.createdAt.getTime() > Date.now() - 86_400_000 && r.logCount > 0);
    expect(recent.length).toBeGreaterThan(10);
    const d = (await h.call(s.viewer!, 'GET', `${API}/dashboard`)).body;
    expect(d.kpis.runs24h).toBeGreaterThan(90);
    expect(d.slowest.length).toBeGreaterThan(0);
    expect(d.failing.map((f: LooseJson) => f.job.name)).toContain('Partner feed import');
  });
});
