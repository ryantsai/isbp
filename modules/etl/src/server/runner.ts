import { ErrorCodes, HttpError, type ModuleContext, type SqlRow, type TableWriter } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import {
  MAX_RUN_LOG_LINES,
  maxWatermark,
  runHref,
  type RunStatus,
  transformRow,
  WATERMARK_PARAM,
} from '../model';
import { errorInfo } from './endpoints';
import { PIPELINE_TYPE } from './access';
import { pipelineRuns, pipelines, type RunLogEntry } from './schema';

export type RunRow = typeof pipelineRuns.$inferSelect;
export type PipelineRow = typeof pipelines.$inferSelect;

/** A run whose worker has not reported for this long is considered dead (it no longer blocks new runs). */
export const STALE_RUN_MS = 2 * 60_000;
/** A queued run nobody picked up within this time no longer blocks new runs. */
export const STALE_QUEUE_MS = 30 * 60_000;
const HEARTBEAT_MS = 2_000;
const MAX_REJECTION_LINES = 20;

export interface RunOptions {
  /** Fires on timeout or cancel from Scheduled Jobs. */
  signal?: AbortSignal;
  /** Mirrors log lines (Scheduled Jobs' live log). */
  log?: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/** Why a run stopped: a person cancelled it, or Scheduled Jobs aborted it (timeout/cancel). */
class Stopped extends Error {
  constructor(readonly reason: 'cancelled' | 'aborted') {
    super(reason === 'cancelled' ? 'Cancelled by a person' : 'Stopped by Scheduled Jobs (timeout or cancel)');
  }
}

function describeError(err: unknown): string {
  if (err instanceof Stopped) return err.message;
  if (err instanceof HttpError) {
    const info = errorInfo(err);
    return `${err.code}${info.dbCode ? ` ${info.dbCode}` : ''}: ${info.message}`;
  }
  return String((err as Error)?.message ?? err);
}

/**
 * Executes a queued pipeline run: streams the source in batches (read-only), maps and transforms each row,
 * writes through one target transaction (`insert | upsert | replace`) and commits only at the end —
 * failures and cancellation roll everything back. Progress, counters and a capped log are flushed to the run
 * row as it goes. Never throws for a failed run: the run row carries the outcome.
 */
export async function executeRun(ctx: ModuleContext, runId: string, opts: RunOptions = {}): Promise<RunRow> {
  const [run] = await ctx.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
  if (!run) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Pipeline run not found');
  if (run.status !== 'queued') return run;
  const [p] = await ctx.db.select().from(pipelines).where(eq(pipelines.id, run.pipelineId));
  if (!p) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Pipeline not found');

  const started = new Date();
  const lines: RunLogEntry[] = [];
  let truncatedLog = false;
  const log = (message: string, level: RunLogEntry['level'] = 'info') => {
    opts.log?.(message, level);
    if (lines.length < MAX_RUN_LOG_LINES - 1) lines.push({ at: new Date().toISOString(), level, message });
    else if (!truncatedLog) {
      truncatedLog = true;
      lines.push({
        at: new Date().toISOString(),
        level: 'warn',
        message: 'Log limit reached; later lines are not kept',
      });
    }
  };
  const counts = { rowsRead: 0, rowsWritten: 0, rowsRejected: 0 };
  const incremental = Boolean(p.watermarkColumn);
  const watermarkFrom = incremental ? (p.watermark ?? p.watermarkInitial) : null;
  let watermark: string | null = watermarkFrom;

  // Claim it (another worker may have picked it up in a race).
  const claimed = await ctx.db
    .update(pipelineRuns)
    .set({ status: 'running', startedAt: started, heartbeatAt: started, watermarkFrom })
    .where(sql`${pipelineRuns.id} = ${runId} and ${pipelineRuns.status} = 'queued'`)
    .returning({ id: pipelineRuns.id });
  if (!claimed.length)
    return (await ctx.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)))[0]!;

  const flush = () =>
    ctx.db
      .update(pipelineRuns)
      .set({ ...counts, log: lines, heartbeatAt: new Date() })
      .where(eq(pipelineRuns.id, runId));

  const controller = new AbortController();
  const state: { stopped: Stopped | null } = { stopped: null };
  const stop = (reason: Stopped['reason']) => {
    if (state.stopped) return;
    state.stopped = new Stopped(reason);
    controller.abort(state.stopped);
  };
  const onOuterAbort = () => stop('aborted');
  if (opts.signal?.aborted) stop('aborted');
  opts.signal?.addEventListener('abort', onOuterAbort);
  const heartbeat = setInterval(() => {
    void ctx.db
      .update(pipelineRuns)
      .set({ heartbeatAt: new Date() })
      .where(eq(pipelineRuns.id, runId))
      .returning({ cancel: pipelineRuns.cancelRequested })
      .then(([r]) => {
        if (r?.cancel) stop('cancelled');
      })
      .catch(() => undefined);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  let writer: TableWriter | null = null;
  let status: RunStatus = 'succeeded';
  let error: string | null = null;
  try {
    const columns = [...new Set(p.mappings.map((m) => m.target))];
    const target = `${p.targetSchema ? `${p.targetSchema}.` : ''}${p.targetTable}`;
    log(`Run started (${run.trigger}): ${p.mode} into ${target}, batches of ${p.batchSize}`);
    if (!p.enabled) throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The pipeline is disabled');
    if (incremental) log(`Incremental: rows after watermark ${watermarkFrom ?? '(none)'}`);
    const params = { ...p.sourceParams, ...(incremental ? { [WATERMARK_PARAM]: watermarkFrom } : {}) };
    writer = await ctx.databases.writer(
      p.targetConnectionId,
      { schema: p.targetSchema, name: p.targetTable },
      {
        purpose: 'data',
        columns,
        mode: p.mode,
        keys: p.mode === 'upsert' ? p.keyColumns : undefined,
        signal: controller.signal,
      },
    );
    if (p.mode === 'replace') log('Target emptied (replace mode, inside the transaction)');
    const keys = p.mode === 'upsert' ? p.keyColumns : [];
    let batchNo = 0;
    let rejectionLines = 0;
    for await (const batch of ctx.databases.stream(p.sourceConnectionId, p.sourceSql, {
      purpose: 'data',
      params,
      readOnly: true,
      batchSize: p.batchSize,
      signal: controller.signal,
    })) {
      if (state.stopped) throw state.stopped;
      batchNo++;
      const good: SqlRow[] = [];
      for (const source of batch.rows) {
        counts.rowsRead++;
        if (incremental) watermark = maxWatermark(watermark, source[p.watermarkColumn!]);
        const r = transformRow(source, p.mappings, keys);
        if (r.ok) good.push(r.row);
        else {
          counts.rowsRejected++;
          if (rejectionLines < MAX_REJECTION_LINES) {
            rejectionLines++;
            log(`Row ${counts.rowsRead} rejected (${r.column}): ${r.reason}`, 'warn');
          }
        }
      }
      if (good.length) counts.rowsWritten += await writer.write(good);
      log(`Batch ${batchNo}: ${batch.rows.length} read, ${good.length} written`);
      await flush();
    }
    if (state.stopped) throw state.stopped;
    if (rejectionLines >= MAX_REJECTION_LINES && counts.rowsRejected > rejectionLines)
      log(`${counts.rowsRejected - rejectionLines} more rows rejected`, 'warn');
    await writer.commit();
    writer = null;
    log(
      `Committed: ${counts.rowsRead} read, ${counts.rowsWritten} written, ${counts.rowsRejected} rejected` +
        (incremental ? `; watermark ${watermark ?? '(unchanged)'}` : ''),
    );
  } catch (err) {
    const cause = state.stopped ?? err;
    status = cause instanceof Stopped && cause.reason === 'cancelled' ? 'cancelled' : 'failed';
    error = describeError(cause);
    log(status === 'cancelled' ? 'Cancelled: the load was rolled back' : `Failed: ${error}`, 'error');
    if (writer) await writer.rollback().catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }

  const finished = new Date();
  const durationMs = finished.getTime() - started.getTime();
  const ref = { pipelineId: p.id, name: p.name, runId, trigger: run.trigger };
  const [done] = await ctx.transaction(async (tx) => {
    const row = await tx
      .update(pipelineRuns)
      .set({
        ...counts,
        status,
        error,
        log: lines,
        finishedAt: finished,
        durationMs,
        heartbeatAt: finished,
        watermarkTo: status === 'succeeded' ? watermark : null,
      })
      .where(eq(pipelineRuns.id, runId))
      .returning();
    await tx
      .update(pipelines)
      .set({
        lastRunId: runId,
        ...(status === 'succeeded' && incremental && watermark !== null ? { watermark } : {}),
      })
      .where(eq(pipelines.id, p.id));
    await ctx.audit.record(
      {
        action: status === 'succeeded' ? 'etl.pipeline.run_succeeded' : 'etl.pipeline.run_failed',
        entityType: PIPELINE_TYPE,
        entityId: p.id,
        entityLabel: p.name,
        outcome: status === 'succeeded' ? 'success' : 'failure',
        metadata: { runId, trigger: run.trigger, status, ...counts, durationMs, error },
      },
      { tx },
    );
    if (status === 'succeeded')
      await ctx.events.publish(
        'etl.pipeline.run_succeeded',
        { ...ref, rowsRead: counts.rowsRead, rowsWritten: counts.rowsWritten },
        { tx },
      );
    else {
      await ctx.events.publish('etl.pipeline.run_failed', { ...ref, error: error ?? status }, { tx });
      if (status === 'failed' && run.trigger === 'manual' && p.ownerId)
        await ctx.notifications.notify(
          {
            type: 'etl.pipeline.failed',
            recipients: [p.ownerId],
            params: { pipeline: p.name, error: (error ?? '').slice(0, 300) },
            href: runHref(p.id, runId),
          },
          { tx },
        );
    }
    return row;
  });
  return done!;
}
