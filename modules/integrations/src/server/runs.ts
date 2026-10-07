import { users } from '@isbp/db/schema';
import { type Db, ErrorCodes, HttpError, httpErrors, type ModuleContext, type Page } from '@isbp/sdk/server';
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { RunDetailOut, RunQueryOut, RunSummaryOut } from '../contracts';
import {
  appendCapped,
  type CountKey,
  emptyCounts,
  EXCLUSIVE_RUN_KINDS,
  type LogEntry,
  type LogLevel,
  type LogRef,
  type RunCounts,
  type RunKind,
  type RunTrigger,
} from '../model';
import { connections, profiles, runs } from './schema';

export type RunRow = typeof runs.$inferSelect;

/**
 * A run's live log and counters, kept in memory and written to the run row every second (and at the
 * end), so the run page can follow it. Capped (`appendCapped`).
 */
export class RunLog {
  private entries: LogEntry[];
  private dropped: number;
  readonly counts: RunCounts;
  private dirty = false;
  private lastFlush = 0;

  constructor(
    private readonly ctx: ModuleContext,
    readonly runId: string | null,
    existing?: { log: LogEntry[]; logDropped: number; counts: RunCounts },
    private readonly onLine?: (entry: LogEntry) => void,
  ) {
    this.entries = existing?.log ?? [];
    this.dropped = existing?.logDropped ?? 0;
    this.counts = { ...emptyCounts(), ...(existing?.counts ?? {}) };
  }

  private add(level: LogLevel, message: string, ref?: LogRef) {
    const entry: LogEntry = { at: new Date().toISOString(), level, message: message.slice(0, 2_000) };
    if (ref && (ref.remote || ref.local || ref.linkId)) entry.ref = ref;
    const next = appendCapped(this.entries, entry, this.dropped);
    this.entries = next.log;
    this.dropped = next.dropped;
    this.dirty = true;
    this.onLine?.(entry);
    void this.flush();
  }

  info(message: string, ref?: LogRef) {
    this.add('info', message, ref);
  }
  warn(message: string, ref?: LogRef) {
    this.add('warn', message, ref);
  }
  error(message: string, ref?: LogRef) {
    this.add('error', message, ref);
  }

  count(key: CountKey, n = 1) {
    this.counts[key] += n;
    this.dirty = true;
  }

  get snapshot() {
    return { log: this.entries, logDropped: this.dropped, counts: this.counts };
  }

  /** Writes the log and counters (at most once a second unless `force`), and beats the heartbeat. */
  async flush(force = false) {
    if (!this.runId) return;
    const now = Date.now();
    if (!force && (!this.dirty || now - this.lastFlush < 1_000)) return;
    this.lastFlush = now;
    this.dirty = false;
    try {
      await this.ctx.db
        .update(runs)
        .set({ log: this.entries, logDropped: this.dropped, counts: this.counts, heartbeatAt: new Date() })
        .where(eq(runs.id, this.runId));
    } catch (err) {
      this.ctx.logger.warn({ err, runId: this.runId }, 'could not write the run log');
    }
  }
}

const durationOf = (r: Pick<RunRow, 'startedAt' | 'finishedAt'>) =>
  r.startedAt && r.finishedAt ? Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime()) : null;

export class RunService {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * Queues a run. Pulls and exports hold their profile: a second one while one is queued or running is
   * refused with 409 `SYNC_RUNNING` (the partial unique index decides, so replicas agree).
   */
  async create(
    tx: Db,
    profile: { id: string; connectionId: string },
    kind: RunKind,
    trigger: RunTrigger,
    opts: { params?: Record<string, unknown>; triggeredBy?: string | null } = {},
  ): Promise<RunRow> {
    const values = {
      profileId: profile.id,
      connectionId: profile.connectionId,
      kind,
      trigger,
      status: 'queued' as const,
      params: opts.params ?? {},
      counts: emptyCounts(),
      triggeredBy: opts.triggeredBy ?? null,
    };
    if (!EXCLUSIVE_RUN_KINDS.includes(kind)) {
      const [row] = await tx.insert(runs).values(values).returning();
      return row!;
    }
    const [row] = await tx
      .insert(runs)
      .values(values)
      .onConflictDoNothing({
        target: runs.profileId,
        where: sql`${runs.status} in ('queued', 'running', 'waiting') and ${runs.kind} in ('pull', 'export')`,
      })
      .returning();
    if (!row)
      throw new HttpError(
        409,
        ErrorCodes.SYNC_RUNNING,
        'A sync of this profile is already queued or running',
        {
          profileId: profile.id,
        },
      );
    return row;
  }

  async row(id: string): Promise<RunRow> {
    const [row] = await this.ctx.db.select().from(runs).where(eq(runs.id, id));
    if (!row) throw httpErrors.notFound('Run not found');
    return row;
  }

  async list(q: RunQueryOut): Promise<Page<RunSummaryOut>> {
    const where: SQL[] = [];
    if (q.connectionId) where.push(eq(runs.connectionId, q.connectionId));
    if (q.profileId) where.push(eq(runs.profileId, q.profileId));
    if (q.status) where.push(eq(runs.status, q.status));
    if (q.trigger) where.push(eq(runs.trigger, q.trigger));
    if (q.kind) where.push(eq(runs.kind, q.kind));
    const cond = where.length ? and(...where) : undefined;
    const order = q.sort === 'createdAt' ? asc(runs.createdAt) : desc(runs.createdAt);
    const [rows, [total]] = await Promise.all([
      this.select()
        .where(cond)
        .orderBy(order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(runs).where(cond),
    ]);
    return {
      items: rows.map((r) => this.summary(r)),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string): Promise<RunDetailOut> {
    const [row] = await this.select().where(eq(runs.id, id));
    if (!row) throw httpErrors.notFound('Run not found');
    return {
      ...this.summary(row),
      log: row.run.log,
      logDropped: row.run.logDropped,
    };
  }

  /** Latest run per profile (overview cards and profile lists). */
  async latestByProfile(profileIds: string[]) {
    if (!profileIds.length) return new Map<string, RunRow>();
    const rows = await this.ctx.db
      .selectDistinctOn([runs.profileId])
      .from(runs)
      .where(
        and(inArray(runs.profileId, profileIds), inArray(runs.kind, ['pull', 'export', 'webhook', 'resync'])),
      )
      .orderBy(runs.profileId, desc(runs.createdAt));
    return new Map(rows.map((r) => [r.profileId, r]));
  }

  private select() {
    return this.ctx.db
      .select({
        run: runs,
        profile: {
          id: profiles.id,
          name: profiles.name,
          entity: profiles.entity,
          objectType: profiles.objectType,
        },
        connection: { id: connections.id, name: connections.name, type: connections.type },
        triggeredBy: { id: users.id, displayName: users.displayName },
      })
      .from(runs)
      .innerJoin(profiles, eq(profiles.id, runs.profileId))
      .innerJoin(connections, eq(connections.id, runs.connectionId))
      .leftJoin(users, eq(users.id, runs.triggeredBy));
  }

  private summary(r: {
    run: RunRow;
    profile: { id: string; name: string; entity: string; objectType: string };
    connection: { id: string; name: string; type: string };
    triggeredBy: { id: string; displayName: string } | null;
  }): RunSummaryOut {
    return {
      id: r.run.id,
      profile: r.profile,
      connection: r.connection,
      kind: r.run.kind,
      trigger: r.run.trigger,
      status: r.run.status,
      counts: { ...emptyCounts(), ...r.run.counts },
      error: r.run.error,
      errorCode: r.run.errorCode,
      triggeredBy: r.triggeredBy?.id ? r.triggeredBy : null,
      resumeAt: r.run.resumeAt,
      startedAt: r.run.startedAt,
      finishedAt: r.run.finishedAt,
      durationMs: durationOf(r.run),
      createdAt: r.run.createdAt,
    };
  }
}
