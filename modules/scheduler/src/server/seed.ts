/**
 * Demo data: a handful of jobs on the built-in task types (HTTP, SQL on the demo ERP/warehouse, a script)
 * with two weeks of history — successes, a failure streak with retries, a timeout, a cancelled run, a
 * missed slot — and live logs for the last two days. `seedJob` / `seedRunHistory` are exported for the
 * platform seed, which adds jobs of other modules' task types (ETL pipelines, inventory syncs) after every
 * module has seeded.
 */
import { groupMembers, groups, users } from '@isbp/db/schema';
import { type ModuleContext, type RunProblem, runProblemFromText } from '@isbp/sdk/server';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { DEFAULT_ALERTS, DEFAULT_RETRIES, type TriggerInput } from '../contracts';
import { manifest } from '../manifest';
import {
  BUILTIN_TYPES,
  isBuiltin,
  type LogLevel,
  type RunStatus,
  type RunTrigger,
  sealConfig,
  type SkipReason,
} from '../model';
import { firstRun, type ScheduleSpec, slotAfter } from '../schedule';
import { specOf } from './engine';
import { type AttemptRecord, jobs, jobUpstreams, runLogs, runs } from './schema';

export interface SeedJobInput {
  name: string;
  description?: string;
  /** `<module>.<type>`, e.g. `scheduler.http` or `etl.pipeline`. */
  type: string;
  config: Record<string, unknown>;
  /** As in the API, or `{ kind: 'after', upstream: ['Job name', …] }` to refer to jobs by name. */
  trigger: TriggerInput | { kind: 'after'; upstream: string[]; mode?: 'all' | 'any' };
  ownerUsername?: string;
  ownerGroupKey?: string;
  enabled?: boolean;
  timeoutSeconds?: number;
  retries?: Partial<{ maxAttempts: number; backoff: 'fixed' | 'exponential'; delaySeconds: number }>;
  concurrency?: 'skip' | 'queue';
  alerts?: Partial<{ onFailure: boolean; channels: boolean; autoDisableAfter: number }>;
}

/** Config schema of a built-in type (defaults applied). */
function parseBuiltin(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const def = manifest.taskTypes.find((t) => `${manifest.id}.${t.type}` === type);
  return def ? (def.config.parse(config) as Record<string, unknown>) : config;
}

/**
 * Creates a job unless one with the same name exists (case-insensitive); returns its id. Secrets in
 * built-in configs are sealed; the owner defaults to the first member of the owner group.
 */
export async function seedJob(ctx: ModuleContext, input: SeedJobInput): Promise<string> {
  const db = ctx.db;
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(sql`lower(${jobs.name}) = lower(${input.name})`);
  if (existing) return existing.id;

  const [group] = input.ownerGroupKey
    ? await db.select({ id: groups.id }).from(groups).where(eq(groups.key, input.ownerGroupKey))
    : [];
  let ownerId: string | null = null;
  if (input.ownerUsername) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, input.ownerUsername));
    ownerId = u?.id ?? null;
  } else if (group) {
    const [m] = await db
      .select({ id: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, group.id), eq(users.status, 'active')))
      .orderBy(asc(users.username))
      .limit(1);
    ownerId = m?.id ?? null;
  }

  const t = input.trigger;
  let upstreamIds: string[] = [];
  if (t.kind === 'after') {
    if ('upstream' in t) {
      const names = t.upstream.map((n) => n.toLowerCase());
      const found = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(sql`lower(${jobs.name})`, names));
      upstreamIds = found.map((f) => f.id);
    } else upstreamIds = t.upstreamIds;
    if (!upstreamIds.length) throw new Error(`seedJob(${input.name}): no upstream jobs found`);
  }
  const cols = {
    triggerKind: t.kind,
    cron: t.kind === 'cron' ? t.cron : null,
    timezone: t.kind === 'cron' ? (t.timezone ?? 'UTC') : 'UTC',
    intervalMinutes: t.kind === 'interval' ? t.intervalMinutes : null,
    afterMode: t.kind === 'after' ? (t.mode ?? 'all') : null,
  } as const;
  const enabled = input.enabled ?? true;
  const config = isBuiltin(input.type)
    ? sealConfig(input.type, parseBuiltin(input.type, input.config), (p) => ctx.secrets.seal(p))
    : input.config;
  const retries = { ...DEFAULT_RETRIES, ...input.retries };
  const alerts = { ...DEFAULT_ALERTS, ...input.alerts };

  return ctx.transaction(async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        name: input.name,
        description: input.description ?? null,
        ownerId,
        ownerGroupId: group?.id ?? null,
        type: input.type,
        config,
        ...cols,
        enabled,
        nextRunAt: enabled ? firstRun(specOf(cols), new Date()) : null,
        timeoutSeconds: input.timeoutSeconds ?? 3_600,
        maxAttempts: retries.maxAttempts,
        backoff: retries.backoff,
        retryDelaySeconds: retries.delaySeconds,
        concurrency: input.concurrency ?? 'skip',
        notifyOnFailure: alerts.onFailure,
        notifyChannels: alerts.channels,
        autoDisableAfter: alerts.autoDisableAfter,
        createdBy: ownerId,
        updatedBy: ownerId,
      })
      .returning();
    if (upstreamIds.length)
      await tx.insert(jobUpstreams).values(upstreamIds.map((upstreamId) => ({ jobId: row!.id, upstreamId })));
    await ctx.audit.record(
      {
        action: 'scheduler.job.created',
        entityType: 'scheduler.job',
        entityId: row!.id,
        entityLabel: row!.name,
        metadata: { type: row!.type, trigger: row!.triggerKind, seeded: true },
      },
      { tx },
    );
    return row!.id;
  });
}

/* ───────────────────────────── synthetic history ───────────────────────────── */

export interface HistoryOptions {
  /** How far back (default 14 days). */
  days?: number;
  /** Share of runs that fail (default 3 %). */
  failureRate?: number;
  /** The last N runs fail (a current failure streak). */
  failLast?: number;
  /** Typical duration range in ms. */
  durationMs?: [number, number];
  /** Failure messages to pick from. */
  errors?: string[];
  /** Lines a successful run logs (besides the standard ones). */
  lines?: (n: number) => string[];
  /** Summary of a successful run: an i18n key (with `summaryParams`) or plain text. */
  summary?: (n: number) => string;
  summaryParams?: (n: number) => Record<string, string | number>;
  /** What the failures are about, for their plain explanation (the connection to fix, the host called). */
  connection?: { id: string; name: string } | null;
  host?: string;
  /** Metrics of a successful run. */
  metrics?: (n: number) => Record<string, number>;
  /** One run that timed out, one cancelled, one missed slot (for the demo). */
  timeouts?: number;
  cancelled?: number;
  missed?: number;
  /** Who started manual runs and cancelled the cancelled one. */
  actorId?: string | null;
}

/** Deterministic pseudo-random numbers (mulberry32), seeded per job. */
function rng(seed: string) {
  let a = 0;
  for (const ch of seed) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SynthRun {
  id?: string;
  jobId: string;
  scheduledFor: Date;
  trigger: RunTrigger;
  status: RunStatus;
  skipReason: SkipReason | null;
  attempt: number;
  maxAttempts: number;
  attempts: AttemptRecord[];
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  summary: string | null;
  summaryParams: Record<string, string | number> | null;
  metrics: Record<string, number>;
  error: string | null;
  problem: RunProblem | null;
  triggeredBy: string | null;
  upstreamRunId: string | null;
  cancelRequested: boolean;
  cancelledBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  logs: { level: LogLevel; message: string; attempt: number; at: Date }[];
}

/** Slots of a job's schedule in [from, to]. */
function slots(spec: ScheduleSpec, from: Date, to: Date, cap = 3_000): Date[] {
  const out: Date[] = [];
  let at = firstRun(spec, from);
  while (at && at.getTime() <= to.getTime() && out.length < cap) {
    out.push(at);
    at = slotAfter(spec, at);
  }
  return out;
}

/**
 * Adds synthetic run history to a job (skipped when it already has runs): its schedule's slots over the
 * last `days` (an `after` job follows its upstreams' successful runs; a manual job runs every few days),
 * mostly successful with realistic durations, plus the failures, retries, timeouts, cancellations and
 * misses the options ask for. Runs of the last two days get log lines.
 */
export async function seedRunHistory(
  ctx: ModuleContext,
  jobId: string,
  opts: HistoryOptions = {},
): Promise<number> {
  const db = ctx.db;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return 0;
  const [{ n }] = (await db.select({ n: count() }).from(runs).where(eq(runs.jobId, jobId))) as [
    { n: number },
  ];
  if (n > 0) return 0;

  const rand = rng(job.id);
  const now = new Date();
  const days = opts.days ?? 14;
  const from = new Date(now.getTime() - days * 86_400_000);
  const recentFrom = now.getTime() - 2 * 86_400_000;
  const [dMin, dMax] = opts.durationMs ?? defaultDuration(job.type);
  const errors = opts.errors ?? defaultErrors(job.type);
  const problemOf = (error: string) =>
    runProblemFromText(error, { connection: opts.connection ?? null, host: opts.host ?? null });

  let times: { at: Date; trigger: RunTrigger; upstreamRunId?: string }[];
  if (job.triggerKind === 'cron' || job.triggerKind === 'interval') {
    times = slots(specOf(job), from, new Date(now.getTime() - 60_000)).map((at) => ({
      at,
      trigger: 'schedule',
    }));
  } else if (job.triggerKind === 'after') {
    const ups = await db
      .select({ id: runs.id, finishedAt: runs.finishedAt })
      .from(runs)
      .innerJoin(jobUpstreams, eq(jobUpstreams.upstreamId, runs.jobId))
      .where(and(eq(jobUpstreams.jobId, job.id), eq(runs.status, 'succeeded')))
      .orderBy(asc(runs.finishedAt));
    times = ups
      .filter((u) => u.finishedAt && u.finishedAt.getTime() >= from.getTime())
      .map((u) => ({
        at: new Date(u.finishedAt!.getTime() + 2_000),
        trigger: 'dependency',
        upstreamRunId: u.id,
      }));
  } else {
    times = [];
    for (
      let at = from.getTime() + 86_400_000;
      at < now.getTime() - 3_600_000;
      at += (2 + Math.floor(rand() * 3)) * 86_400_000
    )
      times.push({ at: new Date(at + Math.floor(rand() * 8 * 3_600_000)), trigger: 'manual' });
  }
  if (!times.length) return 0;

  // Where the special runs go: spread over the older part of the history.
  const pick = (count: number, avoid: Set<number>) => {
    const chosen: number[] = [];
    for (let i = 0; i < count && times.length > 4; i++) {
      let idx = Math.floor(times.length * (0.15 + rand() * 0.6));
      while (avoid.has(idx)) idx = (idx + 1) % times.length;
      avoid.add(idx);
      chosen.push(idx);
    }
    return new Set(chosen);
  };
  const taken = new Set<number>();
  const failTail = Math.min(opts.failLast ?? 0, times.length);
  for (let i = times.length - failTail; i < times.length; i++) taken.add(i);
  const timeoutAt = pick(opts.timeouts ?? 0, taken);
  const cancelAt = pick(opts.cancelled ?? 0, taken);
  const missedAt = pick(opts.missed ?? 0, taken);

  const out: SynthRun[] = [];
  times.forEach((t, i) => {
    const recent = t.at.getTime() >= recentFrom;
    const lag = 200 + Math.floor(rand() * 1_500);
    const started = new Date(t.at.getTime() + lag);
    const duration = Math.round(dMin + (dMax - dMin) * rand() ** 1.6);
    const base: SynthRun = {
      jobId: job.id,
      scheduledFor: t.at,
      trigger: t.trigger,
      status: 'succeeded',
      skipReason: null,
      attempt: 1,
      maxAttempts: job.maxAttempts,
      attempts: [],
      startedAt: started,
      finishedAt: null,
      durationMs: null,
      summary: null,
      summaryParams: null,
      metrics: {},
      error: null,
      problem: null,
      triggeredBy: t.trigger === 'manual' ? (opts.actorId ?? null) : null,
      upstreamRunId: t.upstreamRunId ?? null,
      cancelRequested: false,
      cancelledBy: null,
      createdAt: new Date(Math.min(t.at.getTime(), t.at.getTime() - 30_000 + Math.floor(rand() * 20_000))),
      updatedAt: t.at,
      logs: [],
    };
    const log = (level: LogLevel, message: string, attempt: number, at: Date) => {
      if (recent) base.logs.push({ level, message, attempt, at });
    };

    if (missedAt.has(i)) {
      out.push({
        ...base,
        status: 'skipped',
        skipReason: 'missed',
        startedAt: null,
        finishedAt: new Date(t.at.getTime() + 75 * 60_000),
        summary: 'scheduler.results.missed',
        summaryParams: { count: 1 },
        logs: [
          {
            level: 'warn',
            attempt: 1,
            at: new Date(t.at.getTime() + 75 * 60_000),
            message: `Missed: the run due at ${t.at.toISOString()} was more than 60 minutes late (the misfire grace), so it did not run. 1 scheduled run(s) were missed in total.`,
          },
        ],
      });
      return;
    }

    let attempt = 1;
    let at = started;
    const attemptStart = (a: number, when: Date) =>
      log(
        'info',
        `Attempt ${a}${job.maxAttempts > 1 ? ` of ${job.maxAttempts}` : ''} started (${job.type}, timeout ${job.timeoutSeconds} s)`,
        a,
        when,
      );

    const finalFailure = i >= times.length - failTail || rand() < (opts.failureRate ?? 0.03);
    const isTimeout = timeoutAt.has(i);
    const isCancelled = cancelAt.has(i);
    const attempts: AttemptRecord[] = [];

    // Failed attempts before the last one (retries), when the job retries.
    const failedAttempts = isCancelled
      ? 0
      : finalFailure || isTimeout
        ? job.maxAttempts - 1
        : job.maxAttempts > 1 && rand() < 0.08
          ? 1
          : 0;
    for (let a = 1; a <= failedAttempts; a++) {
      const d = Math.round(duration * (0.3 + rand() * 0.5));
      const err = errors[Math.floor(rand() * errors.length)]!;
      attemptStart(a, at);
      log('error', err, a, new Date(at.getTime() + d));
      const end = new Date(at.getTime() + d);
      attempts.push({
        attempt: a,
        startedAt: at.toISOString(),
        finishedAt: end.toISOString(),
        status: 'failed',
        error: err,
        problem: problemOf(err),
      });
      const delay = Math.min(job.retryDelaySeconds * (job.backoff === 'fixed' ? 1 : 2 ** (a - 1)), 3_600);
      log(
        'warn',
        `Retrying in ${delay} s (attempt ${a + 1} of ${job.maxAttempts}, ${job.backoff} backoff)`,
        a,
        end,
      );
      at = new Date(end.getTime() + delay * 1_000);
      attempt = a + 1;
    }

    attemptStart(attempt, at);
    let status: RunStatus = 'succeeded';
    let error: string | null = null;
    let d = duration;
    if (isCancelled) {
      status = 'cancelled';
      error = 'Cancelled';
      d = Math.round(duration * 0.4);
      log('warn', 'Cancellation requested', attempt, new Date(at.getTime() + d - 200));
      log('warn', 'Cancelled', attempt, new Date(at.getTime() + d));
    } else if (isTimeout) {
      status = 'timed_out';
      d = job.timeoutSeconds * 1_000;
      error = `Timed out after ${job.timeoutSeconds} s`;
      log('error', error, attempt, new Date(at.getTime() + d));
    } else if (finalFailure) {
      status = 'failed';
      error = errors[Math.floor(rand() * errors.length)]!;
      d = Math.round(duration * (0.3 + rand() * 0.5));
      log('error', error, attempt, new Date(at.getTime() + d));
    } else {
      for (const line of opts.lines?.(i) ?? [])
        log('info', line, attempt, new Date(at.getTime() + Math.round(d * 0.6)));
      const summary = opts.summary?.(i) ?? null;
      const plain = summary && !/^[a-z][\w-]*(\.[\w-]+)+$/i.test(summary) ? `: ${summary}` : '';
      log('info', `Succeeded in ${d} ms${plain}`, attempt, new Date(at.getTime() + d));
    }
    const end = new Date(at.getTime() + d);
    attempts.push({
      attempt,
      startedAt: at.toISOString(),
      finishedAt: end.toISOString(),
      status,
      error,
      problem: error ? problemOf(error) : null,
    });
    out.push({
      ...base,
      status,
      attempt,
      attempts,
      finishedAt: end,
      durationMs: d,
      error,
      problem: error ? problemOf(error) : null,
      summary: status === 'succeeded' ? (opts.summary?.(i) ?? null) : null,
      summaryParams: status === 'succeeded' ? (opts.summaryParams?.(i) ?? null) : null,
      metrics: status === 'succeeded' ? (opts.metrics?.(i) ?? { durationMs: d }) : {},
      cancelRequested: isCancelled,
      cancelledBy: isCancelled ? (opts.actorId ?? null) : null,
      updatedAt: end,
    });
  });

  // Insert in batches; logs after their runs.
  for (let i = 0; i < out.length; i += 400) {
    const batch = out.slice(i, i + 400);
    const inserted = await db
      .insert(runs)
      .values(batch.map(({ logs, ...r }) => ({ ...r, logCount: logs.length })))
      .onConflictDoNothing({ target: [runs.jobId, runs.scheduledFor] })
      .returning({ id: runs.id, scheduledFor: runs.scheduledFor });
    const idBySlot = new Map(inserted.map((r) => [r.scheduledFor.getTime(), r.id]));
    const lines = batch.flatMap((r) => {
      const id = idBySlot.get(r.scheduledFor.getTime());
      return id ? r.logs.map((l, k) => ({ runId: id, seq: k + 1, ...l })) : [];
    });
    for (let k = 0; k < lines.length; k += 1_000) await db.insert(runLogs).values(lines.slice(k, k + 1_000));
  }

  // The job's bookkeeping follows its history.
  const finished = out.filter((r) => r.status !== 'skipped' && r.status !== 'cancelled');
  let streak = 0;
  for (
    let i = finished.length - 1;
    i >= 0 && (finished[i]!.status === 'failed' || finished[i]!.status === 'timed_out');
    i--
  )
    streak++;
  const lastSuccess = [...out].reverse().find((r) => r.status === 'succeeded');
  await db
    .update(jobs)
    .set({
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      failureStreak: streak,
      lastQueuedAt: out.at(-1)!.createdAt,
      updatedAt: sql`updated_at`,
    })
    .where(eq(jobs.id, job.id));
  return out.length;
}

function defaultDuration(type: string): [number, number] {
  if (type === BUILTIN_TYPES.http) return [120, 1_400];
  if (type === BUILTIN_TYPES.sql) return [600, 7_500];
  if (type === BUILTIN_TYPES.script) return [2_500, 18_000];
  return [8_000, 95_000];
}

function defaultErrors(type: string): string[] {
  if (type === BUILTIN_TYPES.http)
    return ['Unexpected status 503 (expected 200-299)', 'Upstream request failed (network)'];
  if (type === BUILTIN_TYPES.sql)
    return ['57014: canceling statement due to statement timeout', '40P01: deadlock detected'];
  if (type === BUILTIN_TYPES.script) return ['The script exited with code 1'];
  return ['The task failed'];
}

/* ───────────────────────────── module seed ───────────────────────────── */

/** Demo jobs of the built-in types, with history. Idempotent: does nothing once jobs exist. */
export async function seed(ctx: ModuleContext) {
  const [{ n }] = (await ctx.db.select({ n: count() }).from(jobs)) as [{ n: number }];
  if (n > 0) return;
  const connections = await ctx.databases.list({ purpose: 'data' });
  const dw = connections.find((c) => c.key === 'contoso-dw');
  const erp = connections.find((c) => c.key === 'contoso-erp');
  const runner = ctx.sandbox.status();
  const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
  const actorId = admin?.id ?? null;
  const api = process.env.API_INTERNAL_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;

  const health = await seedJob(ctx, {
    name: 'Platform health check',
    description:
      'Calls the API readiness probe (database and Redis) every 15 minutes, so an outage shows up here and in the failure notifications even when nobody is signed in.',
    type: BUILTIN_TYPES.http,
    config: { method: 'GET', url: `${api}/readyz`, expectedStatus: '200', timeoutSeconds: 10 },
    trigger: { kind: 'interval', intervalMinutes: 15 },
    ownerGroupKey: 'it-admins',
    timeoutSeconds: 30,
    retries: { maxAttempts: 2, backoff: 'fixed', delaySeconds: 30 },
    alerts: { onFailure: true, channels: true, autoDisableAfter: 0 },
  });
  await seedRunHistory(ctx, health, {
    durationMs: [9, 140],
    failureRate: 0.004,
    timeouts: 1,
    missed: 1,
    errors: ['Unexpected status 503 (expected 200)', 'Upstream request failed (network)'],
    lines: () => ['HTTP 200 in 18 ms (15 bytes)', '{"status":"ready"}'],
    summary: () => 'scheduler.results.http',
    summaryParams: (i) => ({ status: 200, ms: 12 + (i % 9) }),
    metrics: (i) => ({ status: 200, durationMs: 12 + (i % 9), bytes: 15 }),
    actorId,
  });

  if (dw) {
    const purge = await seedJob(ctx, {
      name: 'Purge old warehouse rows',
      description:
        'Keeps two years of daily sales in the warehouse (`dw.sales_daily`). Runs on Sunday nights.',
      type: BUILTIN_TYPES.sql,
      config: {
        connectionId: dw.id,
        statement:
          "DELETE FROM dw.sales_daily WHERE sales_date < CAST(:scheduled_for AS date) - INTERVAL '2 years'",
        mode: 'execute',
        params: [{ name: 'scheduled_for', source: 'scheduled_for', type: 'datetime', value: null }],
      },
      trigger: { kind: 'cron', cron: '0 3 * * 0', timezone: 'Asia/Taipei' },
      ownerGroupKey: 'dba-team',
      timeoutSeconds: 600,
      retries: { maxAttempts: 3, backoff: 'exponential', delaySeconds: 300 },
    });
    await seedRunHistory(ctx, purge, {
      durationMs: [1_800, 4_200],
      failureRate: 0,
      lines: (i) => [':scheduled_for = (the run time)', `${(1_180 + i * 37) % 1_500} row(s) affected`],
      summary: () => 'scheduler.results.affected',
      summaryParams: (i) => ({ count: (1_180 + i * 37) % 1_500 }),
      metrics: (i) => ({ affected: (1_180 + i * 37) % 1_500 }),
      actorId,
    });
  }

  let quality: string | null = null;
  if (erp) {
    quality = await seedJob(ctx, {
      name: 'Data quality: orders without lines',
      description:
        'Lists ERP orders that have no order lines (they would invoice nothing). An empty result is good news.',
      type: BUILTIN_TYPES.sql,
      config: {
        connectionId: erp.id,
        statement:
          "SELECT o.order_no, o.order_date, o.status, o.total\n  FROM erp.orders o\n WHERE NOT EXISTS (SELECT 1 FROM erp.order_lines l WHERE l.order_id = o.id)\n   AND o.status <> 'cancelled'\n ORDER BY o.order_date DESC",
        mode: 'query',
        params: [],
      },
      trigger: { kind: 'cron', cron: '0 7 * * *', timezone: 'Asia/Taipei' },
      ownerGroupKey: 'dba-team',
      timeoutSeconds: 300,
      retries: { maxAttempts: 2, backoff: 'fixed', delaySeconds: 120 },
    });
    await seedRunHistory(ctx, quality, {
      durationMs: [350, 1_600],
      failureRate: 0,
      timeouts: 1,
      lines: () => ['Query on Contoso ERP (reporting) (postgres)', '0 row(s) in 412 ms'],
      summary: () => 'scheduler.results.rows',
      summaryParams: () => ({ count: 0 }),
      metrics: () => ({ rows: 0 }),
      actorId,
    });
  }

  await seedJob(ctx, {
    name: 'Rotate report cache',
    description: 'Drops cached report extracts older than a day so the reporting portal regenerates them.',
    type: BUILTIN_TYPES.script,
    config: {
      language: 'node',
      image: runner.images.find((i) => i.startsWith('node')) ?? runner.images[0] ?? 'node:24-alpine',
      script: [
        'const cutoff = Date.now() - 24 * 60 * 60 * 1000;',
        "console.log('Scanning the report cache…');",
        'const files = Array.from({ length: 12 }, (_, i) => ({ name: `extract-${i + 1}.parquet`, at: Date.now() - i * 3 * 60 * 60 * 1000 }));',
        'const stale = files.filter((f) => f.at < cutoff);',
        'for (const f of stale) console.log(`removed ${f.name}`);',
        'console.log(`${stale.length} of ${files.length} extracts removed`);',
      ].join('\n'),
      env: [{ name: 'CACHE_TTL_HOURS', value: '24', secret: false }],
      timeoutSeconds: 120,
      network: 'none',
    },
    trigger: { kind: 'cron', cron: '30 2 * * *', timezone: 'Asia/Taipei' },
    ownerGroupKey: 'it-admins',
    enabled: runner.runner !== 'none',
    timeoutSeconds: 300,
  }).then((id) =>
    seedRunHistory(ctx, id, {
      durationMs: [1_200, 3_400],
      failureRate: 0.05,
      cancelled: 1,
      lines: () => [
        'Scanning the report cache…',
        'removed extract-10.parquet',
        'removed extract-11.parquet',
        'removed extract-12.parquet',
        '3 of 12 extracts removed',
      ],
      summary: () => 'scheduler.results.script',
      summaryParams: (i) => ({ ms: 1_400 + (i % 7) * 90 }),
      metrics: () => ({ exitCode: 0 }),
      actorId,
    }),
  );

  const feed = await seedJob(ctx, {
    name: 'Partner feed import',
    description:
      'Asks the partner integration service to import the latest product feed. The partner endpoint has been unreachable since this morning.',
    type: BUILTIN_TYPES.http,
    config: {
      method: 'POST',
      url: 'https://partner-feeds.contoso.example/import',
      headers: [
        { name: 'X-Api-Key', value: 'demo-partner-key-7f3a9c', secret: true },
        { name: 'Accept', value: 'application/json', secret: false },
      ],
      bodyType: 'json',
      body: '{\n  "feed": "products",\n  "mode": "incremental"\n}',
      expectedStatus: '200-299',
      timeoutSeconds: 20,
    },
    trigger: { kind: 'cron', cron: '5 * * * *', timezone: 'Asia/Taipei' },
    ownerGroupKey: 'it-admins',
    timeoutSeconds: 60,
    retries: { maxAttempts: 3, backoff: 'exponential', delaySeconds: 60 },
    alerts: { onFailure: true, channels: false, autoDisableAfter: 0 },
  });
  await seedRunHistory(ctx, feed, {
    durationMs: [380, 2_600],
    failureRate: 0.02,
    failLast: 6,
    errors: [
      'Upstream request failed (network): getaddrinfo ENOTFOUND partner-feeds.contoso.example',
      'Unexpected status 502 (expected 200-299)',
    ],
    lines: (i) => [
      'POST https://partner-feeds.contoso.example/import',
      `HTTP 202 in ${400 + (i % 13) * 37} ms (64 bytes)`,
      '{"accepted":true,"items":' + (180 + (i % 40)) + '}',
    ],
    summary: () => 'scheduler.results.http',
    summaryParams: (i) => ({ status: 202, ms: 400 + (i % 13) * 37 }),
    host: 'partner-feeds.contoso.example',
    metrics: (i) => ({ status: 202, durationMs: 400 + (i % 13) * 37 }),
    actorId,
  });

  if (quality && erp) {
    const report = await seedJob(ctx, {
      name: 'Weekly capacity report',
      description:
        'Revenue and order volume by region for the last seven days, for capacity planning. Runs once the data-quality check has passed.',
      type: BUILTIN_TYPES.sql,
      config: {
        connectionId: erp.id,
        statement:
          'SELECT * FROM erp.sales_by_region(CAST(:scheduled_for AS date) - 7, CAST(:scheduled_for AS date))',
        mode: 'query',
        params: [{ name: 'scheduled_for', source: 'scheduled_for', type: 'datetime', value: null }],
      },
      trigger: { kind: 'after', upstream: ['Data quality: orders without lines'], mode: 'any' },
      ownerGroupKey: 'dba-team',
      timeoutSeconds: 300,
    });
    await seedRunHistory(ctx, report, {
      durationMs: [700, 2_200],
      failureRate: 0,
      lines: () => [
        'region | orders | revenue',
        'north | 64 | 1843220.50',
        'east | 59 | 1702114.00',
        '… 3 more row(s)',
      ],
      summary: () => 'scheduler.results.rows',
      summaryParams: () => ({ count: 5 }),
      metrics: () => ({ rows: 5 }),
      actorId,
    });
  }
}
