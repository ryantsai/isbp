/**
 * The scheduling engine. Postgres is the source of truth (`jobs.next_run_at`, `runs`); BullMQ only
 * executes (`execute-run`). Every state change is a conditional update, so replicas, retried ticks and
 * redelivered queue jobs can't run anything twice.
 */
import { groupMembers } from '@isbp/db/schema';
import {
  type Db,
  ErrorCodes,
  HttpError,
  type ModuleContext,
  type NotificationParam,
  type TaskContext,
  type TaskOutcome,
} from '@isbp/sdk/server';
import { and, eq, inArray, isNotNull, lt, lte, ne, notInArray, sql } from 'drizzle-orm';
import {
  ACTIVE_STATUSES,
  afterSatisfied,
  BUILTIN_TYPES,
  FINAL_STATUSES,
  isBuiltin,
  LIMITS,
  type LogLevel,
  openConfig,
  retryDelaySeconds,
  type RunStatus,
  type RunTrigger,
  runHref,
  jobHref,
} from '../model';
import { planDue, type ScheduleSpec } from '../schedule';
import { appendLog, RunLog } from './run-log';
import { type AttemptRecord, jobs, jobUpstreams, runs } from './schema';

export type JobRow = typeof jobs.$inferSelect;
export type RunRow = typeof runs.$inferSelect;

/** Runs are created up to one tick early and enqueued with a delay, so they start on time. */
const LOOKAHEAD_MS = 30_000;
/** A `queue` run waiting for the previous one checks again after this long. */
const QUEUE_WAIT_MS = 5_000;
/** After a timeout or cancel, how long the handler gets to stop before the run is closed anyway. */
const ABORT_GRACE_MS = 5_000;
/** Queued runs whose wake-up time passed this long ago lost their queue job (e.g. Redis was flushed). */
const STALE_WAKE_MS = 2 * 60_000;

/** Keeps `updated_at` (engine bookkeeping is not an edit). */
const KEEP_UPDATED_AT = sql`updated_at`;

/** Runs executing in this process: a cancel aborts them at once (other processes see it on the heartbeat). */
const active = new Map<string, AbortController>();

export const specOf = (
  job: Pick<JobRow, 'triggerKind' | 'cron' | 'timezone' | 'intervalMinutes'>,
): ScheduleSpec => ({
  kind: job.triggerKind,
  cron: job.cron,
  timezone: job.timezone,
  intervalMinutes: job.intervalMinutes,
});

interface Wake {
  runId: string;
  attempt: number;
  delayMs: number;
  /** A new queue job even if one with the canonical id exists (re-enqueues). */
  fresh?: boolean;
}

type AttemptResult =
  | { ok: true; outcome: TaskOutcome }
  | { ok: false; status: 'failed' | 'timed_out' | 'cancelled'; error: string };

/** A one-line, credential-free reason for the run list (database and HTTP failures include the server's text). */
export function errorText(err: unknown): string {
  if (err instanceof HttpError) {
    const d = err.details as { message?: string; dbCode?: string | null; reason?: string } | undefined;
    if (err.code === ErrorCodes.DATABASE_ERROR && d?.message)
      return `${d.dbCode ? `${d.dbCode}: ` : ''}${d.message}`.slice(0, 2_000);
    if (err.code === ErrorCodes.UPSTREAM_FAILED && d?.reason)
      return `${err.message} (${d.reason})`.slice(0, 2_000);
    return err.message.slice(0, 2_000);
  }
  if (err instanceof Error) return err.message.slice(0, 2_000) || err.name;
  return String(err).slice(0, 2_000);
}

const isTimeout = (err: unknown) => err instanceof Error && err.name === 'TimeoutError';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Engine {
  constructor(private readonly ctx: ModuleContext) {}

  private async graceMs(): Promise<number> {
    const minutes = Number(await this.ctx.settings.get('misfireGraceMinutes'));
    return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 60) * 60_000;
  }

  /** Enqueues `execute-run` for each run (after the transaction that created them committed). */
  async wake(list: readonly Wake[]) {
    for (const w of list) {
      try {
        await this.ctx.jobs.enqueue(
          'execute-run',
          { runId: w.runId, attempt: w.attempt },
          {
            delayMs: Math.max(0, Math.round(w.delayMs)),
            jobId: `run-${w.runId}-${w.attempt}${w.fresh ? `-${Date.now()}` : ''}`,
          },
        );
      } catch (err) {
        // The tick re-enqueues runs whose wake-up time passed (STALE_WAKE_MS).
        this.ctx.logger.warn({ err, runId: w.runId }, 'could not enqueue a run');
      }
    }
  }

  /**
   * Creates a queued run (idempotent per job and slot). Returns null when the slot already has a run.
   * Call `wake()` after the transaction commits.
   */
  async insertRun(
    tx: Db,
    job: JobRow,
    opts: {
      scheduledFor: Date;
      trigger: RunTrigger;
      triggeredBy?: string | null;
      upstreamRunId?: string | null;
      now?: Date;
    },
  ): Promise<RunRow | null> {
    const now = opts.now ?? new Date();
    const [run] = await tx
      .insert(runs)
      .values({
        jobId: job.id,
        scheduledFor: opts.scheduledFor,
        trigger: opts.trigger,
        status: 'queued',
        maxAttempts: job.maxAttempts,
        triggeredBy: opts.triggeredBy ?? null,
        upstreamRunId: opts.upstreamRunId ?? null,
        wakeAt: new Date(Math.max(opts.scheduledFor.getTime(), now.getTime())),
      })
      .onConflictDoNothing({ target: [runs.jobId, runs.scheduledFor] })
      .returning();
    if (!run) return null;
    await tx.update(jobs).set({ lastQueuedAt: now, updatedAt: KEEP_UPDATED_AT }).where(eq(jobs.id, job.id));
    return run;
  }

  /* ───────────────────────────── tick ───────────────────────────── */

  /**
   * Every 30 s: claims due jobs (`FOR UPDATE SKIP LOCKED`), creates their runs and advances `next_run_at`;
   * logs slots missed beyond the grace as skipped; fails runs whose worker stopped heart-beating (and
   * retries them per policy); re-enqueues queued runs that lost their queue job.
   */
  async tick(now = new Date()) {
    const grace = await this.graceMs();
    const wake: Wake[] = [];
    let created = 0;
    let missed = 0;
    await this.ctx.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.enabled, true),
            isNotNull(jobs.nextRunAt),
            lte(jobs.nextRunAt, new Date(now.getTime() + LOOKAHEAD_MS)),
            inArray(jobs.triggerKind, ['cron', 'interval']),
          ),
        )
        .orderBy(jobs.nextRunAt)
        .limit(200)
        .for('update', { skipLocked: true });
      for (const job of due) {
        const plan = planDue(specOf(job), job.nextRunAt!, now, grace);
        if (plan.run) {
          const run = await this.insertRun(tx, job, { scheduledFor: plan.run, trigger: 'schedule', now });
          if (run) {
            created++;
            wake.push({ runId: run.id, attempt: 1, delayMs: plan.run.getTime() - now.getTime() });
            if (plan.missedCount > 0)
              await appendLog(tx, run.id, [
                {
                  level: 'warn',
                  message: `Catching up: ${plan.missedCount} earlier scheduled run(s) were missed while the scheduler was not running; this slot runs once.`,
                },
              ]);
          }
        }
        if (plan.missed) {
          const [run] = await tx
            .insert(runs)
            .values({
              jobId: job.id,
              scheduledFor: plan.missed,
              trigger: 'schedule',
              status: 'skipped',
              skipReason: 'missed',
              maxAttempts: job.maxAttempts,
              finishedAt: now,
              summary: `Missed ${plan.missedCount} scheduled run(s)`,
            })
            .onConflictDoNothing({ target: [runs.jobId, runs.scheduledFor] })
            .returning({ id: runs.id });
          if (run) {
            missed++;
            await appendLog(tx, run.id, [
              {
                level: 'warn',
                message: `Missed: the run due at ${plan.missed.toISOString()} was more than ${Math.round(grace / 60_000)} minutes late (the misfire grace), so it did not run. ${plan.missedCount} scheduled run(s) were missed in total.`,
              },
            ]);
          }
        }
        await tx
          .update(jobs)
          .set({ nextRunAt: plan.next, updatedAt: KEEP_UPDATED_AT })
          .where(eq(jobs.id, job.id));
      }
    });
    await this.wake(wake);
    const lost = await this.failLostRuns(now);
    const requeued = await this.requeueStale(now);
    return { due: created, missed, lost, requeued };
  }

  /** Running runs without a heartbeat for 2 minutes: the worker died. Retried per policy. */
  private async failLostRuns(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - LIMITS.heartbeatLostMs);
    const lost = await this.ctx.db
      .select({ id: runs.id, attempt: runs.attempt })
      .from(runs)
      .where(and(eq(runs.status, 'running'), lt(runs.heartbeatAt, cutoff)))
      .limit(100);
    let n = 0;
    for (const r of lost) {
      if (active.has(r.id)) continue;
      const done = await this.finishAttempt(
        r.id,
        r.attempt,
        { ok: false, status: 'failed', error: 'Worker lost: no heartbeat for 2 minutes' },
        { requireStaleHeartbeat: cutoff },
      );
      if (done) n++;
    }
    return n;
  }

  /** Queued or retrying runs whose wake-up passed long ago lost their queue job: enqueue them again. */
  private async requeueStale(now: Date): Promise<number> {
    const stale = await this.ctx.db
      .update(runs)
      .set({ wakeAt: now })
      .where(
        and(
          inArray(runs.status, ['queued', 'retrying']),
          lt(runs.wakeAt, new Date(now.getTime() - STALE_WAKE_MS)),
        ),
      )
      .returning({ id: runs.id, attempt: runs.attempt });
    await this.wake(stale.map((r) => ({ runId: r.id, attempt: r.attempt, delayMs: 0, fresh: true })));
    return stale.length;
  }

  /* ───────────────────────────── execution ───────────────────────────── */

  /**
   * `execute-run`: one attempt of a run. Never throws (retries are the engine's, not the queue's); a stale
   * or duplicate delivery is a no-op.
   */
  async execute(data: { runId: string; attempt: number }): Promise<{ status: RunStatus | 'ignored' }> {
    try {
      const claim = await this.claim(data.runId, data.attempt);
      if (claim.kind === 'ignored') return { status: 'ignored' };
      if (claim.kind === 'wait') {
        await this.wake([{ runId: data.runId, attempt: data.attempt, delayMs: QUEUE_WAIT_MS, fresh: true }]);
        return { status: 'queued' };
      }
      if (claim.kind === 'done') return { status: claim.status };
      const result = await this.attempt(claim.run, claim.job);
      await this.finishAttempt(claim.run.id, claim.run.attempt, result);
      return { status: result.ok ? 'succeeded' : result.status };
    } catch (err) {
      this.ctx.logger.error({ err, runId: data.runId }, 'run execution failed');
      return { status: 'ignored' };
    }
  }

  /** Marks the run running, honouring cancel requests and the job's concurrency policy. */
  private async claim(
    runId: string,
    attempt: number,
  ): Promise<
    | { kind: 'ignored' }
    | { kind: 'wait' }
    | { kind: 'done'; status: RunStatus }
    | { kind: 'run'; run: RunRow; job: JobRow }
  > {
    return this.ctx.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
      if (!run || run.attempt !== attempt || (run.status !== 'queued' && run.status !== 'retrying'))
        return { kind: 'ignored' as const };
      // One claim per job at a time: the concurrency check and the start are atomic.
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, run.jobId)).for('update');
      if (!job) return { kind: 'ignored' as const };
      const now = new Date();
      if (run.cancelRequested) {
        await this.close(tx, run, { status: 'cancelled', error: 'Cancelled before it started', now });
        return { kind: 'done' as const, status: 'cancelled' as const };
      }
      const busy = await tx
        .select({ id: runs.id, status: runs.status })
        .from(runs)
        .where(
          and(
            eq(runs.jobId, job.id),
            ne(runs.id, run.id),
            inArray(runs.status, attempt > 1 ? ['running'] : ['running', 'retrying']),
          ),
        )
        .limit(1);
      if (busy.length) {
        if (job.concurrency === 'queue' || attempt > 1) {
          await tx
            .update(runs)
            .set({ wakeAt: new Date(now.getTime() + QUEUE_WAIT_MS) })
            .where(eq(runs.id, run.id));
          return { kind: 'wait' as const };
        }
        await this.close(tx, run, {
          status: 'skipped',
          skipReason: 'overlap',
          summary: 'Skipped: the previous run was still going',
          now,
        });
        await appendLog(tx, run.id, [
          {
            level: 'warn',
            message: `Skipped: run ${busy[0]!.id} of this job is still ${busy[0]!.status} and the job's concurrency policy is "skip".`,
          },
        ]);
        return { kind: 'done' as const, status: 'skipped' as const };
      }
      const record: AttemptRecord = {
        attempt,
        startedAt: now.toISOString(),
        finishedAt: null,
        status: 'running',
        error: null,
      };
      const [started] = await tx
        .update(runs)
        .set({
          status: 'running',
          startedAt: run.startedAt ?? now,
          heartbeatAt: now,
          wakeAt: null,
          nextAttemptAt: null,
          attempts: [...run.attempts, record],
        })
        .where(
          and(eq(runs.id, run.id), inArray(runs.status, ['queued', 'retrying']), eq(runs.attempt, attempt)),
        )
        .returning();
      if (!started) return { kind: 'ignored' as const };
      return { kind: 'run' as const, run: started, job };
    });
  }

  /** Runs the task once, with heartbeat, timeout and cancel wired to an AbortSignal. */
  private async attempt(run: RunRow, job: JobRow): Promise<AttemptResult> {
    const controller = new AbortController();
    active.set(run.id, controller);
    const state: { reason: 'timeout' | 'cancelled' | 'lost' | null } = { reason: null };
    const abort = (why: 'timeout' | 'cancelled' | 'lost') => {
      if (controller.signal.aborted) return;
      state.reason = why;
      controller.abort(
        new Error(why === 'timeout' ? 'Timed out' : why === 'cancelled' ? 'Cancelled' : 'Lost'),
      );
    };

    let config = job.config;
    let secrets: string[] = [];
    if (isBuiltin(job.type)) {
      try {
        ({ config, secrets } = openConfig(job.type, job.config, (s) => this.ctx.secrets.open(s)));
      } catch {
        config = job.config;
      }
    }
    const log = new RunLog(this.ctx, run.id, run.attempt, run.logCount, secrets).start();
    const timeout = setTimeout(() => abort('timeout'), job.timeoutSeconds * 1_000);
    const heartbeat = setInterval(() => {
      void this.ctx.db
        .update(runs)
        .set({ heartbeatAt: new Date() })
        .where(and(eq(runs.id, run.id), eq(runs.status, 'running'), eq(runs.attempt, run.attempt)))
        .returning({ cancel: runs.cancelRequested })
        .then(([r]) => {
          if (!r) abort('lost');
          else if (r.cancel) abort('cancelled');
        })
        .catch((err: unknown) => this.ctx.logger.warn({ err, runId: run.id }, 'heartbeat failed'));
    }, LIMITS.heartbeatMs);
    heartbeat.unref?.();

    const retries = run.maxAttempts > 1 ? ` of ${run.maxAttempts}` : '';
    log.push(`Attempt ${run.attempt}${retries} started (${job.type}, timeout ${job.timeoutSeconds} s)`);
    const task: TaskContext = {
      runId: run.id,
      jobId: job.id,
      attempt: run.attempt,
      scheduledFor: run.scheduledFor,
      lastSuccessAt: job.lastSuccessAt,
      timeoutMs: job.timeoutSeconds * 1_000,
      signal: controller.signal,
      log: (message, level) => log.push(message, level),
    };
    const started = Date.now();
    try {
      const work = this.ctx.taskTypes.run(job.type, config, task);
      const stopped = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => void sleep(ABORT_GRACE_MS).then(() => reject(controller.signal.reason as Error)),
          { once: true },
        );
      });
      // Whichever loses the race settles later: don't leak unhandled rejections.
      work.catch(() => undefined);
      stopped.catch(() => undefined);
      const outcome = await Promise.race([work, stopped]);
      if (state.reason) throw controller.signal.reason;
      log.push(`Succeeded in ${Date.now() - started} ms${outcome.summary ? `: ${outcome.summary}` : ''}`);
      return { ok: true, outcome };
    } catch (err) {
      const why = state.reason;
      const status =
        why === 'cancelled' ? 'cancelled' : why === 'timeout' || isTimeout(err) ? 'timed_out' : 'failed';
      const error =
        why === 'timeout'
          ? `Timed out after ${job.timeoutSeconds} s`
          : why === 'cancelled'
            ? 'Cancelled'
            : why === 'lost'
              ? 'The run was taken over (no heartbeat)'
              : errorText(err);
      log.push(error, status === 'cancelled' ? 'warn' : 'error');
      return { ok: false, status, error };
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      active.delete(run.id);
      await log.close();
    }
  }

  /** Writes a final state (no retry) and the matching attempt record. */
  private async close(
    tx: Db,
    run: RunRow,
    opts: {
      status: RunStatus;
      error?: string | null;
      summary?: string | null;
      skipReason?: 'missed' | 'overlap';
      now: Date;
      outcome?: TaskOutcome;
    },
  ): Promise<number | null> {
    const attempts = run.attempts.map((a) =>
      a.attempt === run.attempt && a.finishedAt === null
        ? { ...a, finishedAt: opts.now.toISOString(), status: opts.status, error: opts.error ?? null }
        : a,
    );
    const current = attempts.find((a) => a.attempt === run.attempt);
    const durationMs = current ? opts.now.getTime() - new Date(current.startedAt).getTime() : null;
    await tx
      .update(runs)
      .set({
        status: opts.status,
        skipReason: opts.skipReason ?? null,
        finishedAt: opts.now,
        durationMs,
        error: opts.error ?? null,
        summary: opts.outcome?.summary ?? opts.summary ?? null,
        metrics: opts.outcome?.metrics ?? {},
        href: opts.outcome?.href ?? null,
        attempts,
        wakeAt: null,
        nextAttemptAt: null,
      })
      .where(eq(runs.id, run.id));
    return durationMs;
  }

  /**
   * Ends an attempt: success (downstream `after` jobs, recovery notice), a retry with backoff, or the final
   * failure (notifications, failure streak, auto-disable). Returns false when the run moved on meanwhile.
   */
  async finishAttempt(
    runId: string,
    attempt: number,
    result: AttemptResult,
    opts: { requireStaleHeartbeat?: Date } = {},
  ): Promise<boolean> {
    const wake: Wake[] = [];
    const out = await this.ctx.transaction(async (tx): Promise<{ done: boolean; succeeded?: string }> => {
      const [run] = await tx
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.id, runId),
            eq(runs.status, 'running'),
            eq(runs.attempt, attempt),
            opts.requireStaleHeartbeat ? lt(runs.heartbeatAt, opts.requireStaleHeartbeat) : undefined,
          ),
        )
        .for('update', { skipLocked: true });
      if (!run) return { done: false };
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, run.jobId)).for('update');
      if (!job) return { done: false };
      const now = new Date();
      const ref = { runId: run.id, jobId: job.id, name: job.name };

      if (result.ok) {
        const durationMs = await this.close(tx, run, { status: 'succeeded', now, outcome: result.outcome });
        const streak = job.failureStreak;
        await tx
          .update(jobs)
          .set({ lastSuccessAt: now, failureStreak: 0, updatedAt: KEEP_UPDATED_AT })
          .where(eq(jobs.id, job.id));
        await this.ctx.events.publish(
          'scheduler.run.succeeded',
          { ...ref, durationMs, summary: result.outcome.summary ?? null },
          { tx },
        );
        if (streak > 0 && job.notifyOnFailure)
          await this.ctx.notifications.notify(
            {
              type: 'scheduler.run.recovered',
              recipients: await this.recipients(tx, job),
              params: { job: job.name, streak },
              href: runHref(run.id),
            },
            { tx },
          );
        return { done: true, succeeded: job.id };
      }

      // Lost runs that someone asked to cancel end as cancelled.
      const status = run.cancelRequested ? 'cancelled' : result.status;
      if (status !== 'cancelled' && run.attempt < run.maxAttempts) {
        const delay = retryDelaySeconds(run.attempt, job.backoff, job.retryDelaySeconds);
        const next = new Date(now.getTime() + delay * 1_000);
        const attempts = run.attempts.map((a) =>
          a.attempt === run.attempt && a.finishedAt === null
            ? { ...a, finishedAt: now.toISOString(), status, error: result.error }
            : a,
        );
        await tx
          .update(runs)
          .set({
            status: 'retrying',
            attempt: run.attempt + 1,
            attempts,
            error: result.error,
            nextAttemptAt: next,
            wakeAt: next,
            heartbeatAt: null,
          })
          .where(eq(runs.id, run.id));
        await appendLog(tx, run.id, [
          {
            level: 'warn',
            attempt: run.attempt,
            message: `Retrying in ${delay} s (attempt ${run.attempt + 1} of ${run.maxAttempts}, ${job.backoff} backoff)`,
          },
        ]);
        wake.push({ runId: run.id, attempt: run.attempt + 1, delayMs: delay * 1_000 });
        return { done: true };
      }

      await this.close(tx, run, { status, error: result.error, now });
      if (status === 'cancelled') return { done: true };
      const streak = job.failureStreak + 1;
      const autoDisable = job.enabled && job.autoDisableAfter > 0 && streak >= job.autoDisableAfter;
      await tx
        .update(jobs)
        .set({
          failureStreak: streak,
          ...(autoDisable ? { enabled: false, nextRunAt: null, disabledReason: 'auto' } : {}),
          updatedAt: KEEP_UPDATED_AT,
        })
        .where(eq(jobs.id, job.id));
      await this.ctx.events.publish(
        'scheduler.run.failed',
        { ...ref, status, error: result.error, streak },
        { tx },
      );
      const params: Record<string, NotificationParam> = {
        job: job.name,
        status,
        error: result.error.slice(0, 300),
        attempts: run.attempt,
        streak,
      };
      if (job.notifyOnFailure)
        await this.ctx.notifications.notify(
          {
            type: 'scheduler.run.failed',
            recipients: await this.recipients(tx, job),
            params,
            href: runHref(run.id),
          },
          { tx },
        );
      if (job.notifyChannels)
        await this.ctx.notifications.broadcast(
          { type: 'scheduler.run.failed', params, href: runHref(run.id) },
          { tx },
        );
      if (autoDisable) {
        await this.ctx.audit.record(
          {
            action: 'scheduler.job.auto_disabled',
            entityType: 'scheduler.job',
            entityId: job.id,
            entityLabel: job.name,
            changes: { enabled: [true, false] },
            metadata: { failures: streak, runId: run.id },
            category: 'system',
          },
          { tx },
        );
        await this.ctx.events.publish(
          'scheduler.job.disabled',
          { jobId: job.id, name: job.name, type: job.type, automatic: true },
          { tx },
        );
        await this.ctx.notifications.notify(
          {
            type: 'scheduler.job.auto_disabled',
            recipients: await this.recipients(tx, job),
            params: { job: job.name, failures: streak },
            href: jobHref(job.id),
          },
          { tx },
        );
      }
      return { done: true };
    });
    await this.wake(wake);
    if (out.succeeded) await this.triggerDownstream(out.succeeded, runId);
    return out.done;
  }

  /** The job's owner and the members of its owner group. */
  async recipients(tx: Db, job: Pick<JobRow, 'ownerId' | 'ownerGroupId'>): Promise<string[]> {
    const ids = new Set<string>();
    if (job.ownerId) ids.add(job.ownerId);
    if (job.ownerGroupId) {
      const members = await tx
        .select({ id: groupMembers.userId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, job.ownerGroupId));
      for (const m of members) ids.add(m.id);
    }
    return [...ids];
  }

  /** Starts the enabled `after` jobs of `upstreamId` whose condition (`all` / `any`) is now met. */
  async triggerDownstream(upstreamId: string, upstreamRunId: string) {
    const downstream = await this.ctx.db
      .select({ id: jobs.id })
      .from(jobUpstreams)
      .innerJoin(jobs, eq(jobs.id, jobUpstreams.jobId))
      .where(
        and(eq(jobUpstreams.upstreamId, upstreamId), eq(jobs.enabled, true), eq(jobs.triggerKind, 'after')),
      );
    for (const d of downstream) {
      const wake: Wake[] = [];
      await this.ctx.transaction(async (tx) => {
        const [job] = await tx.select().from(jobs).where(eq(jobs.id, d.id)).for('update');
        if (!job || !job.enabled || job.triggerKind !== 'after') return;
        const ups = await tx
          .select({ lastSuccessAt: jobs.lastSuccessAt })
          .from(jobUpstreams)
          .innerJoin(jobs, eq(jobs.id, jobUpstreams.upstreamId))
          .where(eq(jobUpstreams.jobId, job.id));
        if (
          !afterSatisfied(
            job.afterMode ?? 'all',
            ups.map((u) => u.lastSuccessAt),
            job.lastQueuedAt,
          )
        )
          return;
        const now = new Date();
        const run = await this.insertRun(tx, job, {
          scheduledFor: now,
          trigger: 'dependency',
          upstreamRunId,
          now,
        });
        if (run) wake.push({ runId: run.id, attempt: 1, delayMs: 0 });
      });
      await this.wake(wake);
    }
  }

  /* ───────────────────────────── requests ───────────────────────────── */

  /** A manual (or retry) run, queued now. Callers check permissions; audit and event are recorded here. */
  async request(
    job: JobRow,
    opts: { trigger: 'manual' | 'retry'; userId: string | null; fromRunId?: string },
  ): Promise<RunRow> {
    if (job.concurrency === 'skip') {
      const [busy] = await this.ctx.db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.jobId, job.id), inArray(runs.status, [...ACTIVE_STATUSES])))
        .limit(1);
      if (busy)
        throw new HttpError(409, ErrorCodes.JOB_RUNNING, `${job.name} is already running`, {
          runId: busy.id,
        });
    }
    if (job.type === BUILTIN_TYPES.script && this.ctx.sandbox.status().runner === 'none')
      throw new HttpError(422, ErrorCodes.SANDBOX_UNAVAILABLE, 'No script runner is configured', {
        reason: 'runner',
      });
    const run = await this.ctx.transaction(async (tx) => {
      let created: RunRow | null = null;
      for (let i = 0; !created && i < 5; i++)
        created = await this.insertRun(tx, job, {
          scheduledFor: new Date(Date.now() + i),
          trigger: opts.trigger,
          triggeredBy: opts.userId,
        });
      if (!created) throw new HttpError(409, ErrorCodes.CONFLICT, 'Try again');
      if (opts.fromRunId)
        await appendLog(tx, created.id, [{ level: 'info', message: `Retry of run ${opts.fromRunId}` }]);
      await this.ctx.audit.record(
        {
          action: 'scheduler.run.requested',
          entityType: 'scheduler.job',
          entityId: job.id,
          entityLabel: job.name,
          metadata: {
            runId: created.id,
            trigger: opts.trigger,
            ...(opts.fromRunId ? { retryOf: opts.fromRunId } : {}),
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'scheduler.run.requested',
        { runId: created.id, jobId: job.id, name: job.name, trigger: opts.trigger },
        { tx },
      );
      return created;
    });
    await this.wake([{ runId: run.id, attempt: 1, delayMs: 0 }]);
    return run;
  }

  /**
   * Cancels a run: queued and retrying runs end at once; a running one is asked to stop (its AbortSignal
   * fires here or on the executor's next heartbeat).
   */
  async cancel(run: RunRow, job: JobRow, userId: string | null): Promise<void> {
    if (!ACTIVE_STATUSES.includes(run.status))
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The run has already finished');
    await this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(runs).where(eq(runs.id, run.id)).for('update');
      if (!locked || !ACTIVE_STATUSES.includes(locked.status))
        throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The run has already finished');
      if (locked.status === 'running') {
        await tx.update(runs).set({ cancelRequested: true, cancelledBy: userId }).where(eq(runs.id, run.id));
      } else {
        await this.close(tx, locked, {
          status: 'cancelled',
          error: 'Cancelled before it started',
          now: new Date(),
        });
        await tx.update(runs).set({ cancelRequested: true, cancelledBy: userId }).where(eq(runs.id, run.id));
      }
      await appendLog(tx, run.id, [{ level: 'warn', message: 'Cancellation requested' }]);
      await this.ctx.audit.record(
        {
          action: 'scheduler.run.cancelled',
          entityType: 'scheduler.job',
          entityId: job.id,
          entityLabel: job.name,
          metadata: { runId: run.id, status: locked.status },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'scheduler.run.cancelled',
        { runId: run.id, jobId: job.id, name: job.name },
        { tx },
      );
    });
    active.get(run.id)?.abort(new Error('Cancelled'));
  }

  /* ───────────────────────────── retention ───────────────────────────── */

  /** Deletes finished runs (and their logs) older than `retentionDays`, keeping each job's latest run. */
  async purge(now = new Date()): Promise<number> {
    const days = Number(await this.ctx.settings.get('retentionDays'));
    const keepDays = Number.isFinite(days) && days >= 1 ? days : 90;
    const cutoff = new Date(now.getTime() - keepDays * 86_400_000);
    const deleted = await this.ctx.db
      .delete(runs)
      .where(
        and(
          lt(runs.createdAt, cutoff),
          inArray(runs.status, [...FINAL_STATUSES]),
          notInArray(
            runs.id,
            sql`(select distinct on (r.job_id) r.id from scheduler.runs r order by r.job_id, r.created_at desc)`,
          ),
        ),
      )
      .returning({ id: runs.id });
    return deleted.length;
  }

  /** Logs a line on a run from outside an attempt. */
  log(runId: string, level: LogLevel, message: string) {
    return appendLog(this.ctx.db, runId, [{ level, message }]);
  }
}
