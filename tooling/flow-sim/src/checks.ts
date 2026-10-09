/**
 * Global checks around a run: did background work drain (outbox, BullMQ queues, process actions), what failed in the
 * background (failed jobs, failed process-action runs, worker handler errors), and what the API and worker logged at
 * error level. Everything here is read-only: counts against the simulator's database and Redis, the worker's
 * Prometheus endpoint and the log files.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { Redis } from 'ioredis';
import pg from 'pg';
import { excerpt } from './recorder';
import { assertSimDatabase } from './safety';
import { normalizeMessage } from './signature';

export interface ChecksConfig {
  databaseUrl: string | null;
  redisUrl: string | null;
  workerMetricsUrl: string | null;
  logs: { name: string; path: string }[];
  runToken: string;
}

export interface QueueCounts {
  wait: number;
  active: number;
  delayed: number;
  prioritized: number;
  paused: number;
  failed: number;
}

export interface BackgroundState {
  at: string;
  outbox: { pending: number; withErrors: number; oldestPendingSeconds: number | null } | null;
  processActions: Record<string, number> | null;
  queues: Record<string, QueueCounts> | null;
  worker: { handlerErrors: number; handled: number; jobsFailed: number } | null;
  unavailable: string[];
}

export interface FailedJob {
  queue: string;
  id: string;
  name: string;
  attempts: number;
  reason: string;
}

export interface FailedRun {
  id: string;
  type: string;
  actionId: string;
  errorCode: string | null;
  error: string;
  attempts: number;
}

export interface LogGroup {
  source: string;
  level: number;
  signature: string;
  count: number;
  first: { time: string | null; msg: string; err: string | null; stack: string | null; req: string | null };
}

export interface DrainResult {
  drained: boolean;
  waitedMs: number;
  final: BackgroundState;
  /** Why it isn't drained (when it isn't). */
  pending: string[];
}

const QUEUE_KEYS: [keyof QueueCounts, 'list' | 'zset'][] = [
  ['wait', 'list'],
  ['active', 'list'],
  ['paused', 'list'],
  ['delayed', 'zset'],
  ['prioritized', 'zset'],
  ['failed', 'zset'],
];

/** Queues whose delayed jobs are retries (module queues also hold their recurring schedules there). */
const RETRY_QUEUES = new Set(['isbp-events', 'isbp-process-actions']);

export class BackgroundChecks {
  private pool: pg.Pool | null = null;
  private redis: Redis | null = null;
  private logOffsets = new Map<string, number>();
  readonly startedAt = new Date();

  constructor(private readonly config: ChecksConfig) {}

  async open() {
    if (this.config.databaseUrl) {
      assertSimDatabase(decodeURIComponent(new URL(this.config.databaseUrl).pathname.slice(1)));
      // Read-only sessions: every check is a count or a select.
      this.pool = new pg.Pool({
        connectionString: this.config.databaseUrl,
        max: 2,
        options: '-c default_transaction_read_only=on',
      });
    }
    if (this.config.redisUrl)
      this.redis = new Redis(this.config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    for (const log of this.config.logs)
      this.logOffsets.set(log.path, existsSync(log.path) ? statSync(log.path).size : 0);
    return this.state();
  }

  async close() {
    await this.pool?.end().catch(() => undefined);
    this.redis?.disconnect();
  }

  async state(): Promise<BackgroundState> {
    const unavailable: string[] = [];
    const [outbox, processActions, queues, worker] = await Promise.all([
      this.outbox().catch((e: Error) => (unavailable.push(`outbox: ${e.message}`), null)),
      this.processActionCounts().catch(
        (e: Error) => (unavailable.push(`process actions: ${e.message}`), null),
      ),
      this.queueCounts().catch((e: Error) => (unavailable.push(`queues: ${e.message}`), null)),
      this.workerMetrics().catch((e: Error) => (unavailable.push(`worker metrics: ${e.message}`), null)),
    ]);
    if (!this.pool) unavailable.push('database checks off (no --db)');
    if (!this.redis) unavailable.push('queue checks off (no --redis)');
    if (!this.config.workerMetricsUrl) unavailable.push('worker metrics off (no --worker-metrics)');
    return { at: new Date().toISOString(), outbox, processActions, queues, worker, unavailable };
  }

  private async outbox() {
    if (!this.pool) return null;
    const { rows } = await this.pool.query<{ pending: number; errors: number; oldest: number | null }>(
      `select count(*)::int as pending,
              count(*) filter (where last_error is not null)::int as errors,
              extract(epoch from now() - min(occurred_at))::int as oldest
         from core.outbox_events where dispatched_at is null`,
    );
    const r = rows[0]!;
    return { pending: r.pending, withErrors: r.errors, oldestPendingSeconds: r.oldest };
  }

  private async processActionCounts() {
    if (!this.pool) return null;
    const { rows } = await this.pool.query<{ status: string; n: number }>(
      'select status, count(*)::int as n from core.process_action_runs group by status',
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  private async queueNames(): Promise<string[]> {
    const names = new Set<string>();
    let cursor = '0';
    do {
      const [next, keys] = await this.redis!.scan(cursor, 'MATCH', 'bull:*:meta', 'COUNT', 500);
      cursor = next;
      for (const k of keys) names.add(k.slice('bull:'.length, -':meta'.length));
    } while (cursor !== '0');
    return [...names].sort();
  }

  private async queueCounts(): Promise<Record<string, QueueCounts> | null> {
    if (!this.redis) return null;
    if (this.redis.status === 'wait') await this.redis.connect();
    const out: Record<string, QueueCounts> = {};
    for (const q of await this.queueNames()) {
      const pipe = this.redis.pipeline();
      for (const [suffix, type] of QUEUE_KEYS)
        if (type === 'list') pipe.llen(`bull:${q}:${suffix}`);
        else pipe.zcard(`bull:${q}:${suffix}`);
      const res = (await pipe.exec()) ?? [];
      const counts = {} as QueueCounts;
      QUEUE_KEYS.forEach(([suffix], i) => (counts[suffix] = Number(res[i]?.[1] ?? 0)));
      out[q] = counts;
    }
    return out;
  }

  private async workerMetrics() {
    if (!this.config.workerMetricsUrl) return null;
    const res = await fetch(this.config.workerMetricsUrl, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let handlerErrors = 0;
    let handled = 0;
    let jobsFailed = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith('#')) continue;
      const value = Number(line.slice(line.lastIndexOf(' ') + 1));
      if (!Number.isFinite(value)) continue;
      if (line.startsWith('isbp_events_total{') && line.includes('stage="handled"')) {
        if (line.includes('status="error"')) handlerErrors += value;
        else handled += value;
      } else if (line.startsWith('isbp_jobs_total{') && line.includes('status="failed"')) jobsFailed += value;
    }
    return { handlerErrors, handled, jobsFailed };
  }

  /** Polls until background work has drained, or `timeoutMs` passed. */
  async drain(timeoutMs: number): Promise<DrainResult> {
    const started = Date.now();
    for (;;) {
      const s = await this.state();
      const pending = pendingWork(s);
      if (!pending.length || Date.now() - started > timeoutMs)
        return { drained: !pending.length, waitedMs: Date.now() - started, final: s, pending };
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  /** Jobs that failed (for good) since the run started, per queue (a few each). */
  async failedJobs(perQueue = 5): Promise<{ count: number; jobs: FailedJob[] }> {
    if (!this.redis) return { count: 0, jobs: [] };
    if (this.redis.status === 'wait') await this.redis.connect();
    const since = this.startedAt.getTime();
    let count = 0;
    const jobs: FailedJob[] = [];
    for (const q of await this.queueNames()) {
      const ids = await this.redis.zrangebyscore(`bull:${q}:failed`, since, '+inf');
      count += ids.length;
      for (const id of ids.slice(0, perQueue)) {
        const [name, reason, attempts] = await this.redis.hmget(
          `bull:${q}:${id}`,
          'name',
          'failedReason',
          'attemptsMade',
        );
        jobs.push({
          queue: q,
          id,
          name: name ?? '?',
          attempts: Number(attempts ?? 0),
          reason: excerpt(reason ?? '', 400),
        });
      }
    }
    return { count, jobs };
  }

  /** Process-action runs of requests made since the run started that failed. */
  async failedProcessActions(limit = 20): Promise<{ count: number; runs: FailedRun[] }> {
    if (!this.pool) return { count: 0, runs: [] };
    const { rows } = await this.pool.query<{
      id: string;
      type: string;
      action_id: string;
      error_code: string | null;
      error: string | null;
      attempts: number;
      total: number;
    }>(
      `select id, type, action_id, error_code, error, attempts, count(*) over ()::int as total
         from core.process_action_runs
        where status = 'failed' and created_at >= $1
        order by created_at limit $2`,
      [this.startedAt, limit],
    );
    return {
      count: rows[0]?.total ?? 0,
      runs: rows.map((r) => ({
        id: r.id,
        type: r.type,
        actionId: r.action_id,
        errorCode: r.error_code,
        error: excerpt(r.error ?? '', 400),
        attempts: r.attempts,
      })),
    };
  }

  /** Error-level (≥ 50) log entries written since the run started, grouped; and warning counts. */
  scanLogs(): { errors: LogGroup[]; warnings: { source: string; msg: string; count: number }[] } {
    const groups = new Map<string, LogGroup>();
    const warnings = new Map<string, { source: string; msg: string; count: number }>();
    for (const log of this.config.logs) {
      if (!existsSync(log.path)) continue;
      const from = this.logOffsets.get(log.path) ?? 0;
      const size = statSync(log.path).size;
      // A restarted process rotates its log: read the new file from the start.
      const start = size < from ? 0 : from;
      for (const line of readLines(log.path, start, size)) {
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const level = levelOf(entry.level);
        const msg = String(entry.msg ?? '');
        if (level === 40) {
          const key = `${log.name}|${normalizeMessage(msg, this.config.runToken)}`;
          const w = warnings.get(key) ?? {
            source: log.name,
            msg: normalizeMessage(msg, this.config.runToken),
            count: 0,
          };
          w.count++;
          warnings.set(key, w);
        }
        if (level < 50) continue;
        const err = entry.err as { type?: string; message?: string; stack?: string } | undefined;
        const errText = err ? `${err.type ?? 'Error'}: ${err.message ?? ''}` : null;
        const signature = normalizeMessage(`${msg}${errText ? ` | ${errText}` : ''}`, this.config.runToken);
        const key = `${log.name}|${signature}`;
        const g = groups.get(key);
        if (g) {
          g.count++;
          continue;
        }
        const req = entry.req as { method?: string; url?: string } | undefined;
        groups.set(key, {
          source: log.name,
          level,
          signature,
          count: 1,
          first: {
            time:
              typeof entry.time === 'number'
                ? new Date(entry.time).toISOString()
                : typeof entry.time === 'string'
                  ? entry.time
                  : null,
            msg: excerpt(msg, 300),
            err: errText ? excerpt(errText, 500) : null,
            stack: err?.stack ? err.stack.split('\n').slice(0, 6).join('\n') : null,
            req: req?.url ? `${req.method ?? ''} ${req.url}`.trim() : null,
          },
        });
      }
    }
    return {
      errors: [...groups.values()].sort((a, b) => b.count - a.count),
      warnings: [...warnings.values()].sort((a, b) => b.count - a.count).slice(0, 20),
    };
  }
}

const LEVELS: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

/** pino levels, as numbers or labels (the API's logger writes labels). */
function levelOf(v: unknown): number {
  if (typeof v === 'number') return v;
  return LEVELS[String(v)] ?? 0;
}

/** What still runs or waits, in words (empty when drained). */
export function pendingWork(s: BackgroundState): string[] {
  const out: string[] = [];
  if (s.outbox && s.outbox.pending > 0) out.push(`${s.outbox.pending} outbox events not relayed`);
  const pa = s.processActions ?? {};
  if ((pa.queued ?? 0) + (pa.running ?? 0) > 0)
    out.push(`${pa.queued ?? 0} process actions queued, ${pa.running ?? 0} running`);
  for (const [q, c] of Object.entries(s.queues ?? {})) {
    const busy = c.wait + c.active + c.prioritized + (RETRY_QUEUES.has(q) ? c.delayed : 0);
    if (busy > 0)
      out.push(
        `${q}: ${c.wait} waiting, ${c.active} active${RETRY_QUEUES.has(q) ? `, ${c.delayed} retrying` : ''}`,
      );
  }
  return out;
}

function* readLines(path: string, start: number, end: number): Generator<string> {
  const fd = openSync(path, 'r');
  try {
    const chunk = Buffer.alloc(1 << 20);
    const decoder = new StringDecoder('utf8');
    let pos = start;
    let rest = '';
    while (pos < end) {
      const n = readSync(fd, chunk, 0, Math.min(chunk.length, end - pos), pos);
      if (n <= 0) break;
      pos += n;
      const text = rest + decoder.write(chunk.subarray(0, n));
      const lines = text.split('\n');
      rest = lines.pop() ?? '';
      yield* lines;
    }
    if (rest) yield rest;
  } finally {
    closeSync(fd);
  }
}
