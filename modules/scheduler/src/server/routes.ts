import { groups } from '@isbp/db/schema';
import { type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import {
  attentionSchema,
  catalogSchema,
  createJobSchema,
  dashboardSchema,
  dbConnectionSummarySchema,
  jobDetailSchema,
  jobQuerySchema,
  jobRefSchema,
  jobSummarySchema,
  logsPageSchema,
  logsQuerySchema,
  lookupItemSchema,
  previewQuerySchema,
  previewSchema,
  runDetailSchema,
  runQuerySchema,
  runSummarySchema,
  taskTypesSchema,
  updateJobSchema,
} from '../contracts';
import { FINAL_STATUSES, type RunStatus } from '../model';
import { cronError, nextRuns } from '../schedule';
import { CREATE, READ, SQL } from './access';
import { services } from './services';

const idParams = z.object({ id: z.uuid() });
const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/** SSE: poll the log table every second; a comment every 15 s keeps proxies from closing the stream. */
const POLL_MS = 1_000;
const PING_EVERY = 15;
/** Streams end after an hour; EventSource reconnects with `Last-Event-ID`. */
const MAX_STREAM_MS = 60 * 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * REST API mounted at /api/v1/scheduler. Every route declares a permission; routes that job owners may
 * use with `scheduler.jobs.create` check the ownership rule in the services (`JobAccess`), so API
 * clients, AI tools and the UI meet the same rules.
 */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = services(ctx);
  const jobsTag = ['Scheduled jobs'];
  const runsTag = ['Job runs'];
  const metaTag = ['Scheduled jobs: setup'];

  /* ───────────── jobs ───────────── */

  app.get(
    '/jobs',
    {
      config: { permission: READ },
      schema: {
        tags: jobsTag,
        summary: 'List jobs (views: failing, running, disabled, mine; filters: q, type, trigger, enabled)',
        querystring: jobQuerySchema,
        response: { 200: pageSchema(jobSummarySchema) },
      },
    },
    async (req) => s.jobs.list(req.query, req.auth),
  );

  app.post(
    '/jobs',
    {
      config: { permission: CREATE },
      schema: {
        tags: jobsTag,
        summary: "Create a job (needs the task type's permission, e.g. scheduler.sql.run for SQL jobs)",
        body: createJobSchema,
        response: { 201: jobDetailSchema },
      },
    },
    async (req, reply) => {
      const job = await s.jobs.create(req.body, req.auth);
      return reply.status(201).send(await s.jobs.detail(job.id, req.auth));
    },
  );

  app.get(
    '/jobs/:id',
    {
      config: { permission: READ },
      schema: {
        tags: jobsTag,
        summary: 'Get a job: trigger, task, dependencies, what you may do (secrets are never returned)',
        params: idParams,
        response: { 200: jobDetailSchema },
      },
    },
    async (req) => s.jobs.detail(req.params.id, req.auth),
  );

  app.patch(
    '/jobs/:id',
    {
      config: { permission: READ },
      schema: {
        tags: jobsTag,
        summary:
          'Edit a job (owners, owner-group members or scheduler.jobs.manage); placeholders keep secrets',
        params: idParams,
        body: updateJobSchema,
        response: { 200: jobDetailSchema },
      },
    },
    async (req) => {
      const job = await s.jobs.update(req.params.id, req.body, req.auth);
      return s.jobs.detail(job.id, req.auth);
    },
  );

  app.delete(
    '/jobs/:id',
    {
      config: { permission: READ },
      schema: {
        tags: jobsTag,
        summary: 'Delete a job and its history (refused while a run is in progress: JOB_RUNNING)',
        params: idParams,
      },
    },
    async (req, reply) => {
      await s.jobs.remove(req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  for (const action of ['enable', 'disable'] as const)
    app.post(
      `/jobs/:id/${action}`,
      {
        config: { permission: READ },
        schema: {
          tags: jobsTag,
          summary: action === 'enable' ? 'Enable a job (schedules its next run)' : 'Disable a job',
          params: idParams,
          response: { 200: jobDetailSchema },
        },
      },
      async (req) => {
        const job = await s.jobs.setEnabled(req.params.id, action === 'enable', req.auth);
        return s.jobs.detail(job.id, req.auth);
      },
    );

  app.post(
    '/jobs/:id/run',
    {
      config: { permission: READ },
      schema: {
        tags: jobsTag,
        summary: 'Run a job now (owners, scheduler.jobs.run or scheduler.jobs.manage)',
        params: idParams,
        response: { 201: runDetailSchema },
      },
    },
    async (req, reply) => {
      const run = await s.jobs.run(req.params.id, req.auth);
      return reply.status(201).send(await s.runs.detail(run.id, req.auth));
    },
  );

  /* ───────────── runs ───────────── */

  app.get(
    '/runs',
    {
      config: { permission: READ },
      schema: {
        tags: runsTag,
        summary: 'List runs (views: failed, active; filters: jobId, status, trigger, hours, q = job name)',
        querystring: runQuerySchema,
        response: { 200: pageSchema(runSummarySchema) },
      },
    },
    async (req) => s.runs.list(req.query),
  );

  app.get(
    '/runs/:id',
    {
      config: { permission: READ },
      schema: {
        tags: runsTag,
        summary: 'Get a run with its attempts',
        params: idParams,
        response: { 200: runDetailSchema },
      },
    },
    async (req) => s.runs.detail(req.params.id, req.auth),
  );

  app.post(
    '/runs/:id/cancel',
    {
      config: { permission: READ },
      schema: {
        tags: runsTag,
        summary: 'Cancel a queued, retrying or running run',
        params: idParams,
        response: { 200: runDetailSchema },
      },
    },
    async (req) => {
      await s.runs.cancel(req.params.id, req.auth);
      return s.runs.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/runs/:id/retry',
    {
      config: { permission: READ },
      schema: {
        tags: runsTag,
        summary: 'Run the job again after a finished run (a new run, trigger "retry")',
        params: idParams,
        response: { 201: runDetailSchema },
      },
    },
    async (req, reply) => {
      const run = await s.runs.retry(req.params.id, req.auth);
      return reply.status(201).send(await s.runs.detail(run.id, req.auth));
    },
  );

  app.get(
    '/runs/:id/logs',
    {
      config: { permission: READ },
      schema: {
        tags: runsTag,
        summary: 'Log lines of a run after a sequence number',
        params: idParams,
        querystring: logsQuerySchema,
        response: { 200: logsPageSchema },
      },
    },
    async (req) => s.runs.logs(req.params.id, req.query.after, req.query.limit),
  );

  /**
   * Server-Sent Events: `lines` events (arrays of log lines, `id` = last sequence number), `status` when
   * the run's status changes, and `end` when it is over. Polls the table, so it works across replicas.
   */
  app.get(
    '/runs/:id/logs/stream',
    {
      config: { permission: READ },
      schema: {
        tags: runsTag,
        summary: 'Live log of a run (text/event-stream)',
        params: idParams,
        querystring: z.object({ after: z.coerce.number().int().min(0).default(0) }),
        hide: true,
      },
    },
    async (req, reply) => {
      const id = req.params.id;
      await s.runs.row(id); // 404 before the stream starts
      const lastEventId = Number(req.headers['last-event-id']);
      let after = Math.max(req.query.after, Number.isFinite(lastEventId) ? lastEventId : 0);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      let closed = false;
      const onClose = () => {
        closed = true;
      };
      req.raw.on('close', onClose);
      res.on('close', onClose);
      const open = () => !closed && !res.writableEnded && !res.destroyed;
      const send = (event: string, data: unknown, eventId?: number) => {
        if (open())
          res.write(`${eventId ? `id: ${eventId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const drain = async (limit: number) => {
        const lines = await s.runs.lines(id, after, limit);
        if (lines.length) {
          after = lines.at(-1)!.seq;
          send('lines', lines, after);
        }
        return lines.length;
      };
      res.write('retry: 3000\n\n');
      const started = Date.now();
      let status: RunStatus | null = null;
      let ticks = 0;
      try {
        while (open() && Date.now() - started < MAX_STREAM_MS) {
          if ((await drain(500)) === 500) continue;
          const now = await s.runs.status(id);
          if (now !== status) {
            status = now;
            if (now) send('status', { status: now });
          }
          if (!now || FINAL_STATUSES.includes(now)) {
            while ((await drain(1_000)) === 1_000 && open());
            send('end', { status: now });
            break;
          }
          await sleep(POLL_MS);
          if (++ticks % PING_EVERY === 0 && open()) res.write(': ping\n\n');
        }
      } catch (err) {
        req.log.warn({ err, runId: id }, 'run log stream failed');
      } finally {
        if (!res.writableEnded) res.end();
      }
    },
  );

  /* ───────────── dashboard ───────────── */

  app.get(
    '/dashboard',
    {
      config: { permission: READ },
      schema: {
        tags: jobsTag,
        summary: 'Monitoring: KPIs, runs per hour by status (24 h), upcoming runs, failing and slowest jobs',
        response: { 200: dashboardSchema },
      },
    },
    async () => s.dashboard.dashboard(),
  );

  app.get(
    '/attention',
    {
      config: { permission: READ },
      schema: {
        tags: jobsTag,
        summary: 'Failing jobs (home dashboard card)',
        response: { 200: attentionSchema },
      },
    },
    async () => s.dashboard.attention(),
  );

  /* ───────────── setup ───────────── */

  app.get(
    '/task-types',
    {
      config: { permission: READ },
      schema: {
        tags: metaTag,
        summary: 'Task types you may create jobs of (all=true: every enabled type), and the script runner',
        querystring: z.object({ all: z.stringbool().optional() }),
        response: { 200: taskTypesSchema },
      },
    },
    async (req) => ({
      items: ctx.taskTypes
        .list(req.query.all ? undefined : req.auth)
        .map((t) => ({ ...t, builtin: t.moduleId === ctx.module.id })),
      sandbox: ctx.sandbox.status(),
    }),
  );

  app.get(
    '/schedule/preview',
    {
      config: { permission: READ },
      schema: {
        tags: metaTag,
        summary:
          'Check a cron expression (five fields, in a time zone) or interval and list the next run times',
        querystring: previewQuerySchema,
        response: { 200: previewSchema },
      },
    },
    async (req) => {
      const q = req.query;
      if (q.kind === 'cron') {
        const tz = q.timezone || 'UTC';
        const error = cronError(q.cron ?? '', tz);
        if (error) return { valid: false, error, next: [] };
        return {
          valid: true,
          error: null,
          next: nextRuns({ kind: 'cron', cron: q.cron, timezone: tz }, new Date(), q.count),
        };
      }
      if (!q.intervalMinutes) return { valid: false, error: 'Enter the minutes between runs', next: [] };
      return {
        valid: true,
        error: null,
        next: nextRuns({ kind: 'interval', intervalMinutes: q.intervalMinutes }, new Date(), q.count),
      };
    },
  );

  app.get(
    '/connections',
    {
      config: { permission: SQL },
      schema: {
        tags: metaTag,
        summary: 'Enabled database connections for data (SQL jobs)',
        response: { 200: items(dbConnectionSummarySchema) },
      },
    },
    async () => ({
      items: (await ctx.databases.list({ purpose: 'data', enabledOnly: true })).map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        engine: c.engine,
        database: c.database,
        readOnly: c.readOnly,
        enabled: c.enabled,
        status: c.status,
      })),
    }),
  );

  app.get(
    '/connections/:id/catalog',
    {
      config: { permission: SQL },
      schema: {
        tags: metaTag,
        summary: "Tables, views and routines of a data connection (for the SQL editor's autocompletion)",
        params: idParams,
        querystring: z.object({ refresh: z.stringbool().optional() }),
        response: { 200: catalogSchema },
      },
    },
    async (req) => ctx.databases.catalog(req.params.id, { purpose: 'data', refresh: req.query.refresh }),
  );

  app.get(
    '/lookups/groups',
    {
      config: { permission: READ },
      schema: {
        tags: metaTag,
        summary: 'Groups that can own jobs',
        response: { 200: items(lookupItemSchema) },
      },
    },
    async () => ({
      items: await ctx.db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .orderBy(asc(groups.name))
        .limit(1_000),
    }),
  );

  app.get(
    '/lookups/jobs',
    {
      config: { permission: READ },
      schema: {
        tags: metaTag,
        summary: 'Jobs by name (upstream pickers and filters)',
        querystring: z.object({ q: z.string().trim().max(200).optional() }),
        response: { 200: items(jobRefSchema) },
      },
    },
    async (req) => ({ items: await s.jobs.options(req.query.q) }),
  );
}
