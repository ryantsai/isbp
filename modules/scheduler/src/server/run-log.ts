import type { Db, ModuleContext } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import { LOG_LIMITS, LogBuffer, type LogLevel, truncateLine } from '../model';
import { runLogs, runs } from './schema';

/**
 * The live log of one attempt: `task.log()` lines are buffered and written every second or every 50
 * lines (whichever comes first), so a chatty task costs a few inserts a second. The run page polls the
 * table (SSE), which works across replicas.
 */
export class RunLog {
  private readonly buffer: LogBuffer;
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly ctx: ModuleContext,
    private readonly runId: string,
    attempt: number,
    alreadyWritten: number,
    secrets: readonly string[] = [],
  ) {
    this.buffer = new LogBuffer(alreadyWritten, attempt, secrets);
  }

  start() {
    this.timer = setInterval(() => void this.flush(), LOG_LIMITS.flushMs);
    this.timer.unref?.();
    return this;
  }

  push(message: string, level: LogLevel = 'info') {
    this.buffer.push(message, level);
    if (this.buffer.size >= LOG_LIMITS.flushLines) void this.flush();
  }

  /** Writes what is buffered (serialised: flushes never overlap). Never throws. */
  flush(): Promise<void> {
    this.chain = this.chain.then(async () => {
      const lines = this.buffer.take();
      if (!lines.length) return;
      try {
        await this.ctx.db
          .insert(runLogs)
          .values(lines.map((l) => ({ runId: this.runId, ...l })))
          .onConflictDoNothing();
        await this.ctx.db
          .update(runs)
          .set({
            logCount: sql`greatest(${runs.logCount}, ${this.buffer.total})`,
            logTruncated: this.buffer.truncated,
          })
          .where(eq(runs.id, this.runId));
      } catch (err) {
        this.ctx.logger.warn({ err, runId: this.runId }, 'could not write run log lines');
      }
    });
    return this.chain;
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}

/**
 * Appends lines written by the engine itself (missed slots, skips, lost workers). Sequence numbers are
 * allocated atomically from the run's `log_count`, so they never collide with an executor's lines.
 */
export async function appendLog(
  db: Db,
  runId: string,
  lines: { level: LogLevel; message: string; attempt?: number }[],
): Promise<void> {
  if (!lines.length) return;
  const [row] = await db
    .update(runs)
    .set({ logCount: sql`least(${runs.logCount} + ${lines.length}, ${LOG_LIMITS.lines})` })
    .where(eq(runs.id, runId))
    .returning({ count: runs.logCount, attempt: runs.attempt });
  if (!row) return;
  const first = row.count - lines.length + 1;
  const values = lines
    .map((l, i) => ({
      runId,
      seq: first + i,
      level: l.level,
      attempt: l.attempt ?? row.attempt,
      message: truncateLine(l.message),
    }))
    .filter((l) => l.seq >= 1);
  if (values.length) await db.insert(runLogs).values(values).onConflictDoNothing();
}
