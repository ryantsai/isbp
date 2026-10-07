import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  likePattern,
  type ModuleContext,
  type Page,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, type SQL, sql } from 'drizzle-orm';
import type { LogLineOut, LogsPageOut, RunDetailOut, RunQueryOut, RunSummaryOut } from '../contracts';
import { ACTIVE_STATUSES, FINAL_STATUSES, RUN_STATUSES, type RunStatus } from '../model';
import { personOf } from './access';
import type { Engine, RunRow } from './engine';
import type { JobService } from './jobs';
import { jobs, runLogs, runs } from './schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SORTS: Record<string, SQL> = {
  queuedAt: sql`${runs.createdAt}`,
  scheduledFor: sql`${runs.scheduledFor}`,
  startedAt: sql`${runs.startedAt}`,
  durationMs: sql`${runs.durationMs}`,
  status: sql`${runs.status}`,
  job: sql`lower(${jobs.name})`,
};

function orderBy(sort: string | undefined): SQL[] {
  const key = sort?.replace(/^-/, '') ?? 'queuedAt';
  const desc = sort ? sort.startsWith('-') : true;
  const col = SORTS[key] ?? SORTS.queuedAt!;
  return [sql`${col} ${desc ? sql`desc nulls last` : sql`asc nulls last`}`, sql`${runs.id} desc`];
}

type Joined = { run: RunRow; job: { id: string; name: string; type: string } };

export class RunService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly engine: Engine,
    private readonly jobService: JobService,
  ) {}

  async row(id: string): Promise<Joined> {
    if (!UUID_RE.test(id)) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Run not found');
    const [r] = await this.ctx.db
      .select({ run: runs, job: { id: jobs.id, name: jobs.name, type: jobs.type } })
      .from(runs)
      .innerJoin(jobs, eq(jobs.id, runs.jobId))
      .where(eq(runs.id, id));
    if (!r) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Run not found');
    return r;
  }

  private async summaries(rows: Joined[]): Promise<RunSummaryOut[]> {
    const ids = [...new Set(rows.map((r) => r.run.triggeredBy).filter((x): x is string => Boolean(x)))];
    const people = ids.length
      ? await this.ctx.db
          .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, ids))
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    return rows.map(({ run, job }) => ({
      id: run.id,
      job,
      status: run.status,
      trigger: run.trigger,
      skipReason: run.skipReason,
      attempt: Math.min(run.attempt, run.maxAttempts),
      maxAttempts: run.maxAttempts,
      scheduledFor: run.scheduledFor,
      queuedAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      summary: run.summary,
      error: run.error,
      triggeredBy: run.triggeredBy ? (byId.get(run.triggeredBy) ?? null) : null,
    }));
  }

  async list(q: RunQueryOut): Promise<Page<RunSummaryOut>> {
    const where: (SQL | undefined)[] = [];
    if (q.jobId) where.push(eq(runs.jobId, q.jobId));
    if (q.q) where.push(ilike(jobs.name, likePattern(q.q)));
    if (q.trigger) where.push(eq(runs.trigger, q.trigger));
    if (q.status) {
      const statuses = q.status
        .split(',')
        .filter((s): s is RunStatus => RUN_STATUSES.includes(s as RunStatus));
      if (statuses.length) where.push(inArray(runs.status, statuses));
    }
    if (q.view === 'failed') where.push(inArray(runs.status, ['failed', 'timed_out']));
    if (q.view === 'active') where.push(inArray(runs.status, [...ACTIVE_STATUSES]));
    if (q.hours) where.push(gte(runs.createdAt, new Date(Date.now() - q.hours * 3_600_000)));
    const cond = and(...where);
    const [rows, totals] = await Promise.all([
      this.ctx.db
        .select({ run: runs, job: { id: jobs.id, name: jobs.name, type: jobs.type } })
        .from(runs)
        .innerJoin(jobs, eq(jobs.id, runs.jobId))
        .where(cond)
        .orderBy(...orderBy(q.sort))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ total: count() }).from(runs).innerJoin(jobs, eq(jobs.id, runs.jobId)).where(cond),
    ]);
    return {
      items: await this.summaries(rows),
      total: totals[0]?.total ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string, auth: AuthContext): Promise<RunDetailOut> {
    const joined = await this.row(id);
    const { run } = joined;
    const job = await this.jobService.row(run.jobId);
    const [summary] = await this.summaries([joined]);
    const [task] = (await this.jobService.summaries([job])).map((j) => j.task);
    let upstreamRun: RunDetailOut['upstreamRun'] = null;
    if (run.upstreamRunId) {
      const [u] = await this.ctx.db
        .select({ id: runs.id, job: { id: jobs.id, name: jobs.name, type: jobs.type } })
        .from(runs)
        .innerJoin(jobs, eq(jobs.id, runs.jobId))
        .where(eq(runs.id, run.upstreamRunId));
      upstreamRun = u ?? null;
    }
    const viewer = await this.jobService.access.viewer(auth, job);
    const active = ACTIVE_STATUSES.includes(run.status);
    return {
      ...summary!,
      task: task!,
      metrics: run.metrics,
      href: run.href,
      attempts: run.attempts.map((a) => ({
        attempt: a.attempt,
        startedAt: new Date(a.startedAt),
        finishedAt: a.finishedAt ? new Date(a.finishedAt) : null,
        status: a.status,
        error: a.error,
        durationMs: a.finishedAt ? new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime() : null,
      })),
      cancelRequested: run.cancelRequested,
      heartbeatAt: run.heartbeatAt,
      nextAttemptAt: run.nextAttemptAt,
      upstreamRun,
      logCount: run.logCount,
      logTruncated: run.logTruncated,
      viewer: {
        canCancel: viewer.canRun && active && !run.cancelRequested,
        canRetry: viewer.canRun && !active,
      },
    };
  }

  async cancel(id: string, auth: AuthContext): Promise<void> {
    const { run } = await this.row(id);
    const job = await this.jobService.row(run.jobId);
    await this.jobService.access.requireRun(auth, job);
    await this.engine.cancel(run, job, personOf(auth));
  }

  /** Runs the job again (a new run, trigger `retry`). */
  async retry(id: string, auth: AuthContext): Promise<RunRow> {
    const { run } = await this.row(id);
    if (ACTIVE_STATUSES.includes(run.status))
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The run is still in progress');
    const job = await this.jobService.row(run.jobId);
    await this.jobService.access.requireRun(auth, job);
    return this.engine.request(job, { trigger: 'retry', userId: personOf(auth), fromRunId: run.id });
  }

  async logs(id: string, after: number, limit: number): Promise<LogsPageOut> {
    const { run } = await this.row(id);
    const items = await this.lines(id, after, limit);
    return {
      items,
      status: run.status,
      done: FINAL_STATUSES.includes(run.status) && items.length < limit,
      truncated: run.logTruncated,
    };
  }

  async lines(runId: string, after: number, limit: number): Promise<LogLineOut[]> {
    const rows = await this.ctx.db
      .select()
      .from(runLogs)
      .where(and(eq(runLogs.runId, runId), gt(runLogs.seq, after)))
      .orderBy(asc(runLogs.seq))
      .limit(limit);
    return rows.map((l) => ({
      seq: l.seq,
      at: l.at,
      level: l.level,
      attempt: l.attempt,
      message: l.message,
    }));
  }

  async status(runId: string): Promise<RunStatus | null> {
    const [r] = await this.ctx.db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
    return r?.status ?? null;
  }

  /** Recent runs of a job, newest first (AI tools, record pages). */
  async recent(jobId: string, limit = 5) {
    return this.ctx.db
      .select()
      .from(runs)
      .where(eq(runs.jobId, jobId))
      .orderBy(desc(runs.createdAt))
      .limit(limit);
  }
}
