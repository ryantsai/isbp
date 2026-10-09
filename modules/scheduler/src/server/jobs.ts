import { groups, users } from '@isbp/db/schema';
import type { Locale } from '@isbp/sdk';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  likePattern,
  type ModuleContext,
  type Page,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, exists, gt, ilike, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import type {
  CreateJob,
  JobDetailOut,
  JobQueryOut,
  JobSummaryOut,
  LastRunOut,
  TaskInfo,
  Trigger,
  updateJobSchema,
} from '../contracts';
import {
  ACTIVE_STATUSES,
  BUILTIN_TYPES,
  findCycle,
  isBuiltin,
  jobReference,
  mergeSecrets,
  redactConfig,
  type RunStatus,
  sealConfig,
  problemOfRun,
} from '../model';
import { cronError, firstRun, isValidTimezone } from '../schedule';
import { CREATE, groupsOf, JobAccess, MANAGE, personOf } from './access';
import { type Engine, type JobRow, type RunRow, specOf } from './engine';
import { jobs, jobUpstreams, runs } from './schema';
import type { z } from 'zod';

type UpdateJob = z.infer<typeof updateJobSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalid = (issues: { path: string; message: string }[], message = 'Validation failed') =>
  new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues });

const SORTS: Record<string, SQL> = {
  name: sql`lower(${jobs.name})`,
  nextRunAt: sql`${jobs.nextRunAt}`,
  lastRunAt: sql`${jobs.lastQueuedAt}`,
  failureStreak: sql`${jobs.failureStreak}`,
  updatedAt: sql`${jobs.updatedAt}`,
  number: sql`${jobs.number}`,
};

function orderBy(sort: string | undefined): SQL[] {
  const key = sort?.replace(/^-/, '') ?? 'name';
  const dir = sort?.startsWith('-') ? sql`desc nulls last` : sql`asc nulls last`;
  const col = SORTS[key] ?? SORTS.name!;
  return [sql`${col} ${dir}`, sql`${jobs.number} asc`];
}

/** Trigger columns of a job. */
function triggerColumns(t: Trigger) {
  return {
    triggerKind: t.kind,
    cron: t.kind === 'cron' ? t.cron.trim().replace(/\s+/g, ' ') : null,
    timezone: t.kind === 'cron' ? t.timezone : 'UTC',
    intervalMinutes: t.kind === 'interval' ? t.intervalMinutes : null,
    afterMode: t.kind === 'after' ? t.mode : null,
  } as const;
}

export class JobService {
  readonly access: JobAccess;

  constructor(
    private readonly ctx: ModuleContext,
    private readonly engine: Engine,
  ) {
    this.access = new JobAccess(ctx.db);
  }

  /* ───────────────────────────── reading ───────────────────────────── */

  async row(id: string, db: Db = this.ctx.db): Promise<JobRow> {
    if (!UUID_RE.test(id)) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Job not found');
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Job not found');
    return job;
  }

  /** By id, `JOB-00042` or name (case-insensitive). */
  async resolve(ref: string): Promise<JobRow> {
    const term = ref.trim();
    const m = /^JOB-?0*(\d+)$/i.exec(term);
    const [job] = await this.ctx.db
      .select()
      .from(jobs)
      .where(
        UUID_RE.test(term)
          ? eq(jobs.id, term)
          : m
            ? eq(jobs.number, Number(m[1]))
            : sql`lower(${jobs.name}) = lower(${term})`,
      );
    if (!job) throw new HttpError(404, ErrorCodes.NOT_FOUND, `No job "${term}"`);
    return job;
  }

  /** Latest run per job. */
  async lastRuns(ids: string[]): Promise<Map<string, RunRow>> {
    if (!ids.length) return new Map();
    const rows = await this.ctx.db
      .selectDistinctOn([runs.jobId])
      .from(runs)
      .where(inArray(runs.jobId, ids))
      .orderBy(runs.jobId, desc(runs.createdAt));
    return new Map(rows.map((r) => [r.jobId, r]));
  }

  private async taskInfo(
    job: Pick<JobRow, 'type' | 'config'>,
    available: Map<string, { name: string; icon: string | null }>,
    locale?: Locale,
  ): Promise<TaskInfo> {
    const type = available.get(job.type);
    const d = await this.ctx.taskTypes.describe(job.type, job.config, { db: this.ctx.db, locale });
    return {
      name: type?.name ?? job.type,
      icon: type?.icon ?? null,
      label: d.label,
      href: d.href,
      available: Boolean(type),
    };
  }

  private types() {
    return new Map(this.ctx.taskTypes.list().map((t) => [t.type, { name: t.name, icon: t.icon }]));
  }

  /** `locale`: the reader's language, for the task's label ("Assign … every month"). */
  async summaries(rows: JobRow[], locale?: Locale): Promise<JobSummaryOut[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const personIds = [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => Boolean(x)))];
    const groupIds = [...new Set(rows.map((r) => r.ownerGroupId).filter((x): x is string => Boolean(x)))];
    const [people, teams, last, running, ups] = await Promise.all([
      personIds.length
        ? this.ctx.db
            .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
            .from(users)
            .where(inArray(users.id, personIds))
        : [],
      groupIds.length
        ? this.ctx.db
            .select({ id: groups.id, name: groups.name })
            .from(groups)
            .where(inArray(groups.id, groupIds))
        : [],
      this.lastRuns(ids),
      this.ctx.db
        .selectDistinct({ jobId: runs.jobId })
        .from(runs)
        .where(and(inArray(runs.jobId, ids), eq(runs.status, 'running'))),
      this.ctx.db
        .select({ jobId: jobUpstreams.jobId, id: jobs.id, name: jobs.name, type: jobs.type })
        .from(jobUpstreams)
        .innerJoin(jobs, eq(jobs.id, jobUpstreams.upstreamId))
        .where(inArray(jobUpstreams.jobId, ids))
        .orderBy(jobs.name),
    ]);
    const personById = new Map(people.map((p) => [p.id, p]));
    const groupById = new Map(teams.map((g) => [g.id, g]));
    const runningSet = new Set(running.map((r) => r.jobId));
    const types = this.types();
    return Promise.all(
      rows.map(async (j) => {
        const lr = last.get(j.id);
        const lastRun: LastRunOut | null = lr
          ? {
              id: lr.id,
              status: lr.status,
              trigger: lr.trigger,
              scheduledFor: lr.scheduledFor,
              startedAt: lr.startedAt,
              finishedAt: lr.finishedAt,
              durationMs: lr.durationMs,
              summary: lr.summary,
              summaryParams: lr.summaryParams ?? null,
              error: lr.error,
              problem: problemOfRun(lr),
            }
          : null;
        return {
          id: j.id,
          number: j.number,
          reference: jobReference(j.number),
          name: j.name,
          description: j.description,
          type: j.type,
          task: await this.taskInfo(j, types, locale),
          trigger: {
            kind: j.triggerKind,
            cron: j.cron,
            timezone: j.timezone,
            intervalMinutes: j.intervalMinutes,
            mode: j.afterMode,
            upstream: ups
              .filter((u) => u.jobId === j.id)
              .map((u) => ({ id: u.id, name: u.name, type: u.type })),
          },
          enabled: j.enabled,
          disabledReason: j.disabledReason,
          nextRunAt: j.nextRunAt,
          lastRun,
          lastSuccessAt: j.lastSuccessAt,
          failureStreak: j.failureStreak,
          running: runningSet.has(j.id),
          owner: j.ownerId ? (personById.get(j.ownerId) ?? null) : null,
          ownerGroup: j.ownerGroupId ? (groupById.get(j.ownerGroupId) ?? null) : null,
          updatedAt: j.updatedAt,
        };
      }),
    );
  }

  async list(q: JobQueryOut, auth: AuthContext): Promise<Page<JobSummaryOut>> {
    const where: (SQL | undefined)[] = [];
    if (q.q) {
      const p = likePattern(q.q);
      const m = /^JOB-?0*(\d+)$/i.exec(q.q.trim());
      where.push(
        or(ilike(jobs.name, p), ilike(jobs.description, p), m ? eq(jobs.number, Number(m[1])) : undefined),
      );
    }
    if (q.type) where.push(eq(jobs.type, q.type));
    if (q.trigger) where.push(eq(jobs.triggerKind, q.trigger));
    if (q.enabled !== undefined) where.push(eq(jobs.enabled, q.enabled));
    switch (q.view) {
      case 'failing':
        where.push(gt(jobs.failureStreak, 0));
        break;
      case 'running':
        where.push(
          exists(
            this.ctx.db
              .select({ one: sql`1` })
              .from(runs)
              .where(and(eq(runs.jobId, jobs.id), inArray(runs.status, [...ACTIVE_STATUSES]))),
          ),
        );
        break;
      case 'disabled':
        where.push(eq(jobs.enabled, false));
        break;
      case 'mine': {
        const me = personOf(auth);
        const mine = [...(await groupsOf(this.ctx.db, auth))];
        where.push(
          or(
            me ? eq(jobs.ownerId, me) : sql`false`,
            mine.length ? inArray(jobs.ownerGroupId, mine) : undefined,
          ),
        );
        break;
      }
    }
    const cond = and(...where);
    const [rows, totals] = await Promise.all([
      this.ctx.db
        .select()
        .from(jobs)
        .where(cond)
        .orderBy(...orderBy(q.sort))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ total: count() }).from(jobs).where(cond),
    ]);
    return {
      items: await this.summaries(rows, auth.user?.locale),
      total: totals[0]?.total ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string, auth: AuthContext): Promise<JobDetailOut> {
    const job = await this.row(id);
    const [summary] = await this.summaries([job], auth.user?.locale);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [ups, downs, [counts], creator] = await Promise.all([
      this.ctx.db
        .select({ id: jobs.id, name: jobs.name, type: jobs.type, lastSuccessAt: jobs.lastSuccessAt })
        .from(jobUpstreams)
        .innerJoin(jobs, eq(jobs.id, jobUpstreams.upstreamId))
        .where(eq(jobUpstreams.jobId, job.id))
        .orderBy(jobs.name),
      this.ctx.db
        .select({
          id: jobs.id,
          name: jobs.name,
          type: jobs.type,
          mode: jobs.afterMode,
          enabled: jobs.enabled,
        })
        .from(jobUpstreams)
        .innerJoin(jobs, eq(jobs.id, jobUpstreams.jobId))
        .where(eq(jobUpstreams.upstreamId, job.id))
        .orderBy(jobs.name),
      this.ctx.db
        .select({
          total: count(),
          succeeded7d: sql<number>`count(*) filter (where ${runs.status} = 'succeeded' and ${runs.createdAt} >= ${weekAgo})::int`,
          failed7d: sql<number>`count(*) filter (where ${runs.status} in ('failed', 'timed_out') and ${runs.createdAt} >= ${weekAgo})::int`,
        })
        .from(runs)
        .where(eq(runs.jobId, job.id)),
      job.createdBy
        ? this.ctx.db
            .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
            .from(users)
            .where(eq(users.id, job.createdBy))
        : Promise.resolve([]),
    ]);
    const last = await this.lastRuns([...ups.map((u) => u.id), ...downs.map((d) => d.id)]);
    const status = (jobId: string): RunStatus | null => last.get(jobId)?.status ?? null;
    return {
      ...summary!,
      config: redactConfig(job.type, job.config),
      timeoutSeconds: job.timeoutSeconds,
      retries: { maxAttempts: job.maxAttempts, backoff: job.backoff, delaySeconds: job.retryDelaySeconds },
      concurrency: job.concurrency,
      alerts: {
        onFailure: job.notifyOnFailure,
        channels: job.notifyChannels,
        autoDisableAfter: job.autoDisableAfter,
      },
      upstream: ups.map((u) => ({
        id: u.id,
        name: u.name,
        type: u.type,
        lastStatus: status(u.id),
        lastSuccessAt: u.lastSuccessAt,
      })),
      downstream: downs.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        mode: d.mode ?? 'all',
        enabled: d.enabled,
        lastStatus: status(d.id),
      })),
      runs: { total: counts!.total, succeeded7d: counts!.succeeded7d, failed7d: counts!.failed7d },
      viewer: await this.access.viewer(auth, job),
      createdBy: creator[0] ?? null,
      createdAt: job.createdAt,
    };
  }

  /* ───────────────────────────── validation ───────────────────────────── */

  /** Resolves secrets, validates with the type (and its permission) and seals. Paths are `config.*`. */
  async prepareConfig(
    type: string,
    incoming: Record<string, unknown>,
    stored: Record<string, unknown> | null,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    let config = incoming;
    if (isBuiltin(type)) {
      const merged = mergeSecrets(type, incoming, stored);
      if (merged.forged.length)
        throw invalid(
          merged.forged.map((p) => ({ path: `config.${p}`, message: 'Enter the secret value itself' })),
        );
      if (merged.missing.length)
        throw invalid(merged.missing.map((p) => ({ path: `config.${p}`, message: 'Enter a value' })));
      config = merged.config;
    }
    let parsed: unknown;
    try {
      parsed = await this.ctx.taskTypes.validate(type, config, auth, { db: this.ctx.db });
    } catch (err) {
      if (err instanceof HttpError && err.code === ErrorCodes.NOT_FOUND)
        throw invalid([{ path: 'type', message: `Unknown task type ${type}` }]);
      if (err instanceof HttpError && err.code === ErrorCodes.VALIDATION_FAILED) {
        const issues =
          (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
        throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, err.message, {
          issues: issues.map((i) => ({ path: i.path ? `config.${i.path}` : 'config', message: i.message })),
        });
      }
      throw err;
    }
    const out = (parsed ?? {}) as Record<string, unknown>;
    return isBuiltin(type) ? sealConfig(type, out, (p) => this.ctx.secrets.seal(p)) : out;
  }

  /** Checks a trigger; for `after`, the upstream jobs (cycles are checked in the transaction). */
  private async checkTrigger(t: Trigger, jobId: string | null) {
    if (t.kind === 'cron') {
      if (!isValidTimezone(t.timezone))
        throw invalid([{ path: 'trigger.timezone', message: 'Unknown time zone' }]);
      const err = cronError(t.cron, t.timezone);
      if (err) throw invalid([{ path: 'trigger.cron', message: err }], 'Invalid cron expression');
    }
    if (t.kind === 'after') {
      const ids = [...new Set(t.upstreamIds)];
      if (jobId && ids.includes(jobId))
        throw invalid([{ path: 'trigger.upstreamIds', message: 'A job cannot run after itself' }]);
      const found = await this.ctx.db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.id, ids));
      if (found.length !== ids.length)
        throw invalid([{ path: 'trigger.upstreamIds', message: 'Some of these jobs no longer exist' }]);
    }
  }

  /** Inside the transaction (serialised): the new upstream edges must not close a loop. */
  private async assertNoCycle(tx: Db, jobId: string, upstreamIds: string[]) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('scheduler.job_upstreams'))`);
    const edges = await tx.select().from(jobUpstreams).where(ne(jobUpstreams.jobId, jobId));
    const graph = new Map<string, string[]>();
    for (const e of edges) graph.set(e.jobId, [...(graph.get(e.jobId) ?? []), e.upstreamId]);
    graph.set(jobId, upstreamIds);
    const cycle = findCycle(graph, jobId);
    if (!cycle) return;
    const names = await tx.select({ id: jobs.id, name: jobs.name }).from(jobs).where(inArray(jobs.id, cycle));
    const byId = new Map(names.map((n) => [n.id, n.name]));
    throw new HttpError(422, ErrorCodes.JOB_CYCLE, 'These jobs would wait for each other forever', {
      path: cycle.map((id) => ({ id, name: byId.get(id) ?? id })),
    });
  }

  private async checkPeople(ownerId: string | null, ownerGroupId: string | null) {
    if (ownerId) {
      const [u] = await this.ctx.db.select({ id: users.id }).from(users).where(eq(users.id, ownerId));
      if (!u) throw invalid([{ path: 'ownerId', message: 'Unknown person' }]);
    }
    if (ownerGroupId) {
      const [g] = await this.ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.id, ownerGroupId));
      if (!g) throw invalid([{ path: 'ownerGroupId', message: 'Unknown group' }]);
    }
  }

  private async checkName(name: string, exceptId: string | null) {
    const [dupe] = await this.ctx.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(sql`lower(${jobs.name}) = lower(${name})`, exceptId ? ne(jobs.id, exceptId) : undefined));
    if (dupe) throw invalid([{ path: 'name', message: 'Another job already has this name' }]);
  }

  /** Script jobs need a script runner to be enabled. */
  private checkRunnable(type: string) {
    if (type === BUILTIN_TYPES.script && this.ctx.sandbox.status().runner === 'none')
      throw new HttpError(
        422,
        ErrorCodes.SANDBOX_UNAVAILABLE,
        'No script runner is configured, so script jobs cannot be enabled',
        { reason: 'runner' },
      );
  }

  /** The type's permission (editing any field of, say, a SQL job needs `scheduler.sql.run`). */
  private requireTypePermission(type: string, auth: AuthContext) {
    const def = this.ctx.taskTypes.list().find((t) => t.type === type);
    if (def) {
      const r = auth.reach(def.permission);
      if (!(r.global || r.departmentIds.length || r.records.length)) auth.require(def.permission);
    }
  }

  /* ───────────────────────────── writing ───────────────────────────── */

  async create(input: CreateJob, auth: AuthContext): Promise<JobRow> {
    auth.require(CREATE);
    const me = personOf(auth);
    const ownerId = input.ownerId === undefined ? me : input.ownerId;
    await this.checkName(input.name, null);
    await this.checkPeople(ownerId, input.ownerGroupId);
    await this.checkTrigger(input.trigger, null);
    const config = await this.prepareConfig(input.type, input.config, null, auth);
    if (input.enabled) this.checkRunnable(input.type);
    const now = new Date();
    const cols = triggerColumns(input.trigger);
    const job = await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(jobs)
        .values({
          name: input.name,
          description: input.description,
          ownerId,
          ownerGroupId: input.ownerGroupId,
          type: input.type,
          config,
          ...cols,
          enabled: input.enabled,
          nextRunAt: input.enabled ? firstRun(specOf(cols), now) : null,
          timeoutSeconds: input.timeoutSeconds,
          maxAttempts: input.retries.maxAttempts,
          backoff: input.retries.backoff,
          retryDelaySeconds: input.retries.delaySeconds,
          concurrency: input.concurrency,
          notifyOnFailure: input.alerts.onFailure,
          notifyChannels: input.alerts.channels,
          autoDisableAfter: input.alerts.autoDisableAfter,
          createdBy: me,
          updatedBy: me,
        })
        .returning();
      if (input.trigger.kind === 'after')
        await tx
          .insert(jobUpstreams)
          .values(
            [...new Set(input.trigger.upstreamIds)].map((upstreamId) => ({ jobId: row!.id, upstreamId })),
          );
      await this.ctx.audit.record(
        {
          action: 'scheduler.job.created',
          entityType: 'scheduler.job',
          entityId: row!.id,
          entityLabel: row!.name,
          metadata: { type: row!.type, trigger: row!.triggerKind, enabled: row!.enabled },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'scheduler.job.created',
        { jobId: row!.id, name: row!.name, type: row!.type, trigger: row!.triggerKind },
        { tx },
      );
      return row!;
    });
    return job;
  }

  async update(id: string, input: UpdateJob, auth: AuthContext): Promise<JobRow> {
    const before = await this.row(id);
    await this.access.requireEdit(auth, before);
    this.requireTypePermission(before.type, auth);
    if (input.name !== undefined) await this.checkName(input.name, id);
    if (input.ownerId !== undefined || input.ownerGroupId !== undefined)
      await this.checkPeople(input.ownerId ?? null, input.ownerGroupId ?? null);
    if (input.trigger) await this.checkTrigger(input.trigger, id);
    const config =
      input.config !== undefined
        ? await this.prepareConfig(before.type, input.config, before.config, auth)
        : undefined;
    const enabled = input.enabled ?? before.enabled;
    if (enabled && (!before.enabled || config)) this.checkRunnable(before.type);

    const cols = input.trigger ? triggerColumns(input.trigger) : null;
    const scheduleChanged =
      Boolean(cols) &&
      (cols!.triggerKind !== before.triggerKind ||
        cols!.cron !== before.cron ||
        cols!.timezone !== before.timezone ||
        cols!.intervalMinutes !== before.intervalMinutes);
    const now = new Date();
    let nextRunAt = before.nextRunAt;
    if (!enabled) nextRunAt = null;
    else if (scheduleChanged || !before.enabled || !before.nextRunAt)
      nextRunAt = firstRun(specOf(cols ?? before), now);

    const me = personOf(auth);
    const patch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.ownerGroupId !== undefined ? { ownerGroupId: input.ownerGroupId } : {}),
      ...(config ? { config } : {}),
      ...(cols ?? {}),
      ...(input.enabled !== undefined && input.enabled !== before.enabled
        ? { enabled: input.enabled, disabledReason: null }
        : {}),
      ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {}),
      ...(input.retries
        ? {
            maxAttempts: input.retries.maxAttempts,
            backoff: input.retries.backoff,
            retryDelaySeconds: input.retries.delaySeconds,
          }
        : {}),
      ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
      ...(input.alerts
        ? {
            notifyOnFailure: input.alerts.onFailure,
            notifyChannels: input.alerts.channels,
            autoDisableAfter: input.alerts.autoDisableAfter,
          }
        : {}),
      nextRunAt,
      updatedBy: me,
    };
    const { config: _c, ...comparable } = patch;
    void _c;
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      comparable as unknown as Record<string, unknown>,
      Object.keys(comparable).filter((k) => !['nextRunAt', 'updatedBy'].includes(k)),
    );
    if (config && JSON.stringify(config) !== JSON.stringify(before.config)) changes.config = ['…', '…'];

    return this.ctx.transaction(async (tx) => {
      if (input.trigger) {
        await tx.delete(jobUpstreams).where(eq(jobUpstreams.jobId, id));
        if (input.trigger.kind === 'after') {
          const ids = [...new Set(input.trigger.upstreamIds)];
          await this.assertNoCycle(tx, id, ids);
          await tx.insert(jobUpstreams).values(ids.map((upstreamId) => ({ jobId: id, upstreamId })));
        }
      }
      const [row] = await tx.update(jobs).set(patch).where(eq(jobs.id, id)).returning();
      if (Object.keys(changes).length) {
        await this.ctx.audit.record(
          {
            action: 'scheduler.job.updated',
            entityType: 'scheduler.job',
            entityId: id,
            entityLabel: row!.name,
            changes,
          },
          { tx },
        );
        await this.ctx.events.publish(
          'scheduler.job.updated',
          { jobId: id, name: row!.name, type: row!.type, changes: Object.keys(changes) },
          { tx },
        );
      }
      if (input.enabled !== undefined && input.enabled !== before.enabled)
        await this.publishToggle(tx, row!, input.enabled);
      return row!;
    });
  }

  private async publishToggle(tx: Db, job: JobRow, enabled: boolean) {
    await this.ctx.audit.record(
      {
        action: enabled ? 'scheduler.job.enabled' : 'scheduler.job.disabled',
        entityType: 'scheduler.job',
        entityId: job.id,
        entityLabel: job.name,
        changes: { enabled: [!enabled, enabled] },
      },
      { tx },
    );
    await this.ctx.events.publish(
      enabled ? 'scheduler.job.enabled' : 'scheduler.job.disabled',
      enabled
        ? { jobId: job.id, name: job.name, type: job.type }
        : { jobId: job.id, name: job.name, type: job.type, automatic: false },
      { tx },
    );
  }

  async setEnabled(id: string, enabled: boolean, auth: AuthContext): Promise<JobRow> {
    const before = await this.row(id);
    await this.access.requireEdit(auth, before);
    if (enabled) this.checkRunnable(before.type);
    if (before.enabled === enabled) return before;
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(jobs)
        .set({
          enabled,
          disabledReason: null,
          nextRunAt: enabled ? firstRun(specOf(before), new Date()) : null,
          updatedBy: personOf(auth),
        })
        .where(eq(jobs.id, id))
        .returning();
      await this.publishToggle(tx, row!, enabled);
      return row!;
    });
  }

  async remove(id: string, auth: AuthContext): Promise<void> {
    const job = await this.row(id);
    const viewer = await this.access.viewer(auth, job);
    if (!viewer.canDelete) auth.require(MANAGE);
    const [active] = await this.ctx.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.jobId, id), inArray(runs.status, [...ACTIVE_STATUSES])))
      .limit(1);
    if (active)
      throw new HttpError(409, ErrorCodes.JOB_RUNNING, 'The job has a run in progress: cancel it first', {
        runId: active.id,
      });
    const dependents = await this.ctx.db
      .select({ id: jobs.id, name: jobs.name })
      .from(jobUpstreams)
      .innerJoin(jobs, eq(jobs.id, jobUpstreams.jobId))
      .where(eq(jobUpstreams.upstreamId, id));
    if (dependents.length)
      throw new HttpError(409, ErrorCodes.IN_USE, 'Other jobs run after this one', { jobs: dependents });
    await this.ctx.transaction(async (tx) => {
      await tx.delete(jobs).where(eq(jobs.id, id));
      await this.ctx.records.forget({ type: 'scheduler.job', id }, { tx });
      await this.ctx.audit.record(
        {
          action: 'scheduler.job.deleted',
          entityType: 'scheduler.job',
          entityId: id,
          entityLabel: job.name,
          metadata: { type: job.type },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'scheduler.job.deleted',
        { jobId: id, name: job.name, type: job.type },
        { tx },
      );
    });
  }

  /** "Run now" (owners, `scheduler.jobs.run`, `scheduler.jobs.manage`). */
  async run(id: string, auth: AuthContext): Promise<RunRow> {
    const job = await this.row(id);
    await this.access.requireRun(auth, job);
    return this.engine.request(job, { trigger: 'manual', userId: personOf(auth) });
  }

  /** People who leave stop owning jobs; their group (if any) keeps them. */
  async releaseOwner(userId: string) {
    const released = await this.ctx.db
      .update(jobs)
      .set({ ownerId: null })
      .where(eq(jobs.ownerId, userId))
      .returning({ id: jobs.id, name: jobs.name });
    for (const j of released)
      await this.ctx.audit.record({
        action: 'scheduler.job.owner_released',
        entityType: 'scheduler.job',
        entityId: j.id,
        entityLabel: j.name,
        metadata: { userId },
        category: 'system',
      });
    return released.length;
  }

  /** Jobs the caller may pick as upstreams or filter by. */
  async options(q: string | undefined, limit = 50) {
    return this.ctx.db
      .select({ id: jobs.id, name: jobs.name, type: jobs.type })
      .from(jobs)
      .where(q ? ilike(jobs.name, likePattern(q)) : undefined)
      .orderBy(asc(sql`lower(${jobs.name})`))
      .limit(limit);
  }
}
