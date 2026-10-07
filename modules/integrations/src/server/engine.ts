/**
 * The sync engine's orchestration (docs/architecture.md §12.3): the minute tick, runs (pull, push, webhook,
 * resync, export) with their live log, rate-limit pauses, connection health and notifications, webhooks and
 * local change routing. The per-record work is in `reconcile.ts`.
 */
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  type RemoteRecord,
  type SyncChange,
} from '@isbp/sdk/server';
import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { CursorTracker } from '../merge';
import { type LogEntry, LIMITS, type RunKind, type RunStatus } from '../model';
import { MANAGE, personOf } from './access';
import {
  type ConnectionRow,
  type ConnectionService,
  presentedSecret,
  webhookSecretMatches,
} from './connections';
import { holdersOf } from './people';
import {
  errorInfo,
  isFatal,
  orphan,
  pullRecord,
  pushComments,
  pushRecord,
  recordItemError,
} from './reconcile';
import { RunLog, type RunRow, type RunService } from './runs';
import { connections, links, pendingPushes, profiles, runs } from './schema';
import { openSession, type ProfileRow, type Session } from './session';

/** A running run whose heartbeat is older than this lost its worker. */
const STALE_MS = 5 * 60_000;
/** A queued run nobody picked up for this long lost its queue job (e.g. Redis was flushed). */
const LOST_MS = 2 * 60_000;
/** Runs are kept this long. */
const RETENTION_DAYS = 30;
/** Failed runs in a row before integration admins hear about it. */
const FAILING_STREAK = 3;

type WebhookItem = { objectType: string; id: string; scope?: string | null };
type PushItem = { localId: string; kind: 'record' | 'comment' };

function abortError() {
  const e = new Error('The run was cancelled');
  e.name = 'AbortError';
  return e;
}

/** Keep `updated_at` (engine bookkeeping is not an edit). */
const keepProfileUpdatedAt = { updatedAt: sql`${profiles.updatedAt}` };

export class Engine {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly deps: { connections: ConnectionService; runs: RunService },
  ) {}

  /* ───────────────────────────── queueing ───────────────────────────── */

  /** Enqueues the job that executes a run (after the transaction that created it committed). */
  async wake(run: Pick<RunRow, 'id' | 'kind'>, delayMs = 0, fresh = false) {
    const job = run.kind === 'webhook' ? 'webhook-items' : 'pull';
    try {
      await this.ctx.jobs.enqueue(
        job,
        { runId: run.id },
        {
          delayMs: Math.max(0, Math.round(delayMs)),
          jobId: `run-${run.id}-${fresh ? Date.now() : Math.round(delayMs)}`,
        },
      );
    } catch (err) {
      // The tick re-enqueues runs that waited too long.
      this.ctx.logger.warn({ err, runId: run.id }, 'could not enqueue a sync run');
    }
  }

  private async profileRow(id: string): Promise<ProfileRow> {
    const [p] = await this.ctx.db.select().from(profiles).where(eq(profiles.id, id));
    if (!p) throw httpErrors.notFound('Profile not found');
    return p;
  }

  /** "Run now" (pull; a push-only profile sweeps its records) or "Push existing records" (export). */
  async request(profileId: string, kind: 'pull' | 'export', auth: AuthContext): Promise<RunRow> {
    auth.require(MANAGE);
    const p = await this.profileRow(profileId);
    const effective: RunKind = p.direction === 'push' ? 'export' : kind;
    if (effective === 'export' && p.direction === 'pull')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'A pull-only profile has nothing to push');
    const run = await this.ctx.transaction(async (tx) => {
      const r = await this.deps.runs.create(tx, p, effective, 'manual', { triggeredBy: personOf(auth) });
      await this.ctx.audit.record(
        {
          action: 'integrations.run.requested',
          entityType: 'integrations.profile',
          entityId: p.id,
          entityLabel: p.name,
          metadata: { runId: r.id, kind: effective },
        },
        { tx },
      );
      return r;
    });
    await this.wake(run);
    return run;
  }

  /** "Sync now" for chosen links (the record panel, relink). */
  async resync(profileId: string, linkIds: string[], auth: AuthContext | null): Promise<RunRow> {
    const p = await this.profileRow(profileId);
    const run = await this.ctx.transaction((tx) =>
      this.deps.runs.create(tx, p, 'resync', 'manual', {
        params: { linkIds },
        triggeredBy: auth ? personOf(auth) : null,
      }),
    );
    await this.wake(run);
    return run;
  }

  /**
   * Creates and runs a pull (an export for push-only profiles) to the end, in this process. For Scheduled
   * Jobs, seeds and tests. 409 `SYNC_RUNNING` when one is already queued or running.
   */
  async runNow(
    profileId: string,
    trigger: 'schedule' | 'manual' = 'manual',
    opts: { signal?: AbortSignal; onLog?: (e: LogEntry) => void; triggeredBy?: string | null } = {},
  ): Promise<RunRow> {
    const p = await this.profileRow(profileId);
    const run = await this.ctx.transaction((tx) =>
      this.deps.runs.create(tx, p, p.direction === 'push' ? 'export' : 'pull', trigger, {
        triggeredBy: opts.triggeredBy ?? null,
      }),
    );
    return (await this.execute(run.id, opts)) ?? (await this.deps.runs.row(run.id));
  }

  /* ───────────────────────────── execution ───────────────────────────── */

  /**
   * Executes one run. Claims it (`queued`/`waiting` → `running`, so a redelivered job does nothing), opens the
   * profile's session and does the kind's work. Rate limiting pauses the run (`waiting`) until the remote
   * system's `retryAfterSeconds`; an authentication failure fails it and flags the connection.
   */
  async execute(
    runId: string,
    opts: { signal?: AbortSignal; onLog?: (e: LogEntry) => void } = {},
  ): Promise<RunRow | null> {
    const [run] = await this.ctx.db
      .update(runs)
      .set({
        status: 'running',
        startedAt: sql`coalesce(${runs.startedAt}, now())`,
        heartbeatAt: new Date(),
        resumeAt: null,
      })
      .where(and(eq(runs.id, runId), inArray(runs.status, ['queued', 'waiting'])))
      .returning();
    if (!run) return null;
    const log = new RunLog(this.ctx, run.id, run, opts.onLog);
    const [profile] = await this.ctx.db.select().from(profiles).where(eq(profiles.id, run.profileId));
    if (!profile) return null;
    let status: RunStatus = 'succeeded';
    let error: string | null = null;
    let errorCode: string | null = null;
    let session: Session | null = null;
    try {
      session = await openSession(this.ctx, this.deps.connections, profile, {
        log,
        deferParents: run.kind === 'pull',
        signal: opts.signal,
      });
      if (run.kind === 'pull' && !run.params.resumed)
        log.info(
          `Reading changes in ${session.connection.name} (${profile.objectType}) from ${profile.cursor ? 'the last position' : 'the beginning'}`,
        );
      switch (run.kind) {
        case 'pull':
          await this.pullFeed(session, profile);
          break;
        case 'export':
          await this.exportAll(session);
          break;
        case 'resync':
          await this.resyncLinks(session, (run.params.linkIds as string[] | undefined) ?? []);
          break;
        case 'webhook':
          await this.webhookItems(session, (run.params.items as WebhookItem[] | undefined) ?? []);
          break;
        case 'push':
          await this.pushItems(session, (run.params.items as PushItem[] | undefined) ?? []);
          break;
      }
      status = log.counts.errors > 0 ? 'partial' : 'succeeded';
    } catch (err) {
      if (err instanceof HttpError && err.code === ErrorCodes.REMOTE_RATE_LIMITED) {
        const d = err.details as { retryAfterSeconds?: number } | undefined;
        const wait = Math.min(3_600, Math.max(1, Math.round(Number(d?.retryAfterSeconds) || 60)));
        log.warn(
          `${session?.connection.name ?? 'The remote system'} is rate limiting; continuing in ${wait} s`,
        );
        await log.flush(true);
        const resumeAt = new Date(Date.now() + wait * 1_000);
        await this.ctx.db
          .update(runs)
          .set({ status: 'waiting', resumeAt, params: { ...run.params, resumed: true } })
          .where(eq(runs.id, run.id));
        await this.wake(run, wait * 1_000, true);
        return (await this.ctx.db.select().from(runs).where(eq(runs.id, run.id)))[0] ?? null;
      }
      const e = errorInfo(err);
      status = 'failed';
      error = e.message;
      errorCode = e.code;
      log.error(err instanceof Error && err.name === 'AbortError' ? 'Cancelled' : `Run failed: ${e.message}`);
      if (e.code === ErrorCodes.REMOTE_AUTH_FAILED) {
        const [c] = await this.ctx.db.select().from(connections).where(eq(connections.id, run.connectionId));
        if (c) await this.markFailing(c, e.message);
      }
    }
    return this.finish(run, status, log, error, errorCode);
  }

  private async finish(
    run: RunRow,
    status: RunStatus,
    log: RunLog,
    error: string | null,
    errorCode: string | null,
  ) {
    const counts = log.counts;
    // A push batch that only confirmed nothing changed (echoes of our own writes) leaves no run behind.
    const trivial =
      run.kind === 'push' &&
      status === 'succeeded' &&
      counts.pushed +
        counts.remoteCreated +
        counts.created +
        counts.updated +
        counts.conflicts +
        counts.linked ===
        0;
    const finished = await this.ctx.transaction(async (tx) => {
      if (trivial) {
        await tx.delete(runs).where(eq(runs.id, run.id));
        return null;
      }
      const [row] = await tx
        .update(runs)
        .set({
          status,
          error,
          errorCode,
          ...log.snapshot,
          finishedAt: new Date(),
          heartbeatAt: new Date(),
        })
        .where(eq(runs.id, run.id))
        .returning();
      await this.ctx.events.publish(
        'integrations.run.finished',
        {
          runId: run.id,
          profileId: run.profileId,
          connectionId: run.connectionId,
          kind: run.kind,
          trigger: run.trigger,
          status,
          counts,
        },
        { tx },
      );
      return row ?? null;
    });
    if (!trivial) await this.afterRun(run.connectionId, status, errorCode);
    return finished;
  }

  /** Health follows the runs: a good run heals the connection; a streak of failures flags it. */
  private async afterRun(connectionId: string, status: RunStatus, errorCode: string | null) {
    const [c] = await this.ctx.db.select().from(connections).where(eq(connections.id, connectionId));
    if (!c) return;
    if (status !== 'failed') {
      if (c.health !== 'ok')
        await this.ctx.db
          .update(connections)
          .set({
            health: 'ok',
            healthMessage: null,
            failingNotifiedAt: null,
            updatedAt: sql`${connections.updatedAt}`,
          })
          .where(eq(connections.id, c.id));
      return;
    }
    if (errorCode === ErrorCodes.REMOTE_AUTH_FAILED) return;
    const recent = await this.ctx.db
      .select({ status: runs.status, error: runs.error })
      .from(runs)
      .where(and(eq(runs.connectionId, c.id), inArray(runs.status, ['succeeded', 'partial', 'failed'])))
      .orderBy(sql`${runs.finishedAt} desc nulls last`)
      .limit(FAILING_STREAK);
    if (recent.length === FAILING_STREAK && recent.every((r) => r.status === 'failed'))
      await this.markFailing(c, recent[0]?.error ?? 'Sync runs keep failing');
  }

  /** Flags the connection `failing` and tells integration admins once (until it works again). */
  async markFailing(c: ConnectionRow, message: string) {
    await this.ctx.transaction(async (tx) => {
      // Only the update that sets `failing_notified_at` notifies (concurrent runs and checks agree).
      const [first] = await tx
        .update(connections)
        .set({
          health: 'failing',
          healthMessage: message.slice(0, 2_000),
          lastCheckedAt: new Date(),
          failingNotifiedAt: new Date(),
          updatedAt: sql`${connections.updatedAt}`,
        })
        .where(and(eq(connections.id, c.id), isNull(connections.failingNotifiedAt)))
        .returning({ id: connections.id });
      if (!first) {
        await tx
          .update(connections)
          .set({
            health: 'failing',
            healthMessage: message.slice(0, 2_000),
            lastCheckedAt: new Date(),
            updatedAt: sql`${connections.updatedAt}`,
          })
          .where(eq(connections.id, c.id));
        return;
      }
      await this.ctx.notifications.notify(
        {
          type: 'integrations.connection.failing',
          recipients: await holdersOf(this.ctx, MANAGE),
          params: { name: c.name, message: message.slice(0, 300) },
          href: `/integrations/connections/${c.id}`,
        },
        { tx },
      );
    });
  }

  private checkSignal(s: Session) {
    if (s.signal?.aborted) throw abortError();
  }

  private async item<T>(s: Session, fn: () => Promise<T>, onError: (err: unknown) => Promise<void>) {
    this.checkSignal(s);
    try {
      return await fn();
    } catch (err) {
      if (isFatal(err)) throw err;
      await onError(err);
      if (s.consecutiveErrors >= LIMITS.consecutiveErrors)
        throw new HttpError(
          502,
          ErrorCodes.UPSTREAM_FAILED,
          `${s.consecutiveErrors} records in a row failed; stopping`,
        );
      return null;
    } finally {
      await s.log.flush();
    }
  }

  private async saveCursor(profileId: string, cursor: string | null) {
    await this.ctx.db
      .update(profiles)
      .set({ cursor, ...keepProfileUpdatedAt })
      .where(eq(profiles.id, profileId));
  }

  /** Retries links in error, then reads the change feed page by page from the stored cursor. */
  private async pullFeed(s: Session, profile: ProfileRow) {
    const errored = await this.ctx.db
      .select()
      .from(links)
      .where(and(eq(links.profileId, profile.id), eq(links.state, 'error')))
      .orderBy(links.updatedAt)
      .limit(50);
    if (errored.length) s.log.info(`Retrying ${errored.length} record(s) that failed before`);
    for (const l of errored) {
      const remote = {
        id: l.remoteId,
        ref: l.remoteRef ?? l.remoteId,
        title: l.remoteTitle ?? '',
        url: l.remoteUrl,
      };
      await this.item(
        s,
        async () => {
          const r = await s.conn.get(profile.objectType, l.remoteId, { scope: profile.remoteScope });
          s.log.count('read');
          if (!r || r.deleted) return orphan(s, l, 'remote');
          return pullRecord(s, r, { force: true });
        },
        (err) => recordItemError(s, err, { remote }),
      );
    }

    const tracker = new CursorTracker(profile.cursor);
    const deferred: RemoteRecord[] = [];
    for (let page = 0; page < LIMITS.maxPagesPerRun; page++) {
      this.checkSignal(s);
      const res = await s.conn.changes(profile.objectType, {
        scope: profile.remoteScope,
        cursor: tracker.read,
        limit: LIMITS.pageSize,
      });
      let deferredHere = false;
      for (const remote of res.items) {
        s.log.count('read');
        const outcome = await this.item(
          s,
          () => pullRecord(s, remote),
          (err) => recordItemError(s, err, { remote }),
        );
        if (outcome === 'deferred') {
          deferred.push(remote);
          deferredHere = true;
        }
      }
      await this.saveCursor(profile.id, tracker.page(res.cursor, deferredHere));
      if (!res.hasMore || !res.items.length) break;
      if (page === LIMITS.maxPagesPerRun - 1) s.log.info('More changes are waiting; the next run continues');
    }

    if (deferred.length) {
      s.deferParents = false;
      s.log.info(`${deferred.length} record(s) waited for their parent; syncing them now`);
      for (const remote of deferred)
        await this.item(
          s,
          () => pullRecord(s, remote),
          (err) => recordItemError(s, err, { remote }),
        );
      await this.saveCursor(profile.id, tracker.release());
    }
    const c = s.log.counts;
    s.log.info(
      `Done: ${c.read} read, ${c.created} created, ${c.updated} updated, ${c.pushed} pushed, ${c.linked} linked, ${c.conflicts} conflicts, ${c.errors} errors`,
    );
  }

  /** Pushes every local record in scope: changed linked ones, and unlinked ones when creating remotely. */
  private async exportAll(s: Session) {
    if (s.profile.direction === 'pull')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'A pull-only profile has nothing to push');
    let after: string | null = null;
    for (let page = 0; page < 2_000; page++) {
      this.checkSignal(s);
      const res = await this.ctx.sync.list(s.profile.entity, {
        containerId: s.profile.containerId,
        after,
        limit: LIMITS.pageSize,
      });
      for (const rec of res.items) {
        s.log.count('read');
        await this.item(
          s,
          () => pushRecord(s, rec.id),
          (err) => recordItemError(s, err, { localId: rec.id }),
        );
      }
      if (!res.next || !res.items.length) break;
      after = res.next;
    }
    const c = s.log.counts;
    s.log.info(
      `Done: ${c.read} read, ${c.remoteCreated} created remotely, ${c.pushed} pushed, ${c.errors} errors`,
    );
  }

  private async resyncLinks(s: Session, linkIds: string[]) {
    if (!linkIds.length) return;
    const rows = await this.ctx.db
      .select()
      .from(links)
      .where(and(eq(links.profileId, s.profile.id), inArray(links.id, linkIds.slice(0, 500))));
    for (const l of rows) {
      const remote = {
        id: l.remoteId,
        ref: l.remoteRef ?? l.remoteId,
        title: l.remoteTitle ?? '',
        url: l.remoteUrl,
      };
      await this.item(
        s,
        async () => {
          if (s.profile.direction === 'push') return l.localId ? pushRecord(s, l.localId) : 'skipped';
          const r = await s.conn.get(s.profile.objectType, l.remoteId, { scope: s.profile.remoteScope });
          s.log.count('read');
          if (!r || r.deleted) return orphan(s, l, 'remote');
          return pullRecord(s, r, { force: true });
        },
        (err) => recordItemError(s, err, { remote }),
      );
    }
  }

  /** Re-reads every record a webhook named (the body is never trusted for data). */
  private async webhookItems(s: Session, items: WebhookItem[]) {
    for (const it of items) {
      if (it.objectType !== s.profile.objectType) continue;
      const remote = { id: it.id, ref: it.id, title: '', url: null };
      await this.item(
        s,
        async () => {
          const r = await s.conn.get(s.profile.objectType, it.id, {
            scope: it.scope ?? s.profile.remoteScope,
          });
          s.log.count('read');
          if (!r) {
            const [l] = await this.ctx.db
              .select()
              .from(links)
              .where(and(eq(links.profileId, s.profile.id), eq(links.remoteId, it.id)));
            if (l?.localId) await orphan(s, l, 'remote');
            return 'orphaned';
          }
          return pullRecord(s, r);
        },
        (err) => recordItemError(s, err, { remote }),
      );
    }
  }

  private async pushItems(s: Session, items: PushItem[]) {
    for (const it of items)
      await this.item(
        s,
        () => (it.kind === 'comment' ? pushComments(s, it.localId) : pushRecord(s, it.localId)),
        (err) => recordItemError(s, err, { localId: it.localId }),
      );
  }

  /* ───────────────────────────── local changes ───────────────────────────── */

  /**
   * `onSyncChange`: a sync entity's record (or comment) changed locally. Queues a push for every enabled
   * push/two-way profile of the entity that links the record, or may create it remotely. Pushes are batched
   * per profile (`pending_pushes`, drained by the `push` job).
   */
  async onLocalChange(change: SyncChange) {
    const candidates = await this.ctx.db
      .select({ profile: profiles })
      .from(profiles)
      .innerJoin(connections, eq(connections.id, profiles.connectionId))
      .where(
        and(
          eq(profiles.entity, change.entity),
          eq(profiles.enabled, true),
          inArray(profiles.direction, ['push', 'both']),
          eq(connections.enabled, true),
        ),
      );
    for (const { profile } of candidates) {
      if (change.kind === 'comment' && !profile.comments) continue;
      const [linked] = await this.ctx.db
        .select({ id: links.id })
        .from(links)
        .where(and(eq(links.profileId, profile.id), eq(links.localId, change.id)));
      if (!linked && !profile.createRemote) continue;
      await this.ctx.db
        .insert(pendingPushes)
        .values({ profileId: profile.id, localId: change.id, kind: change.kind })
        .onConflictDoNothing();
      // A unique job per change (a finished job's id would swallow a new one): the first to run after the
      // short delay drains everything queued so far; the others find nothing and leave no run.
      await this.ctx.jobs.enqueue(
        'push',
        { profileId: profile.id },
        {
          delayMs: 1_500,
          jobId: `push-${profile.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      );
    }
  }

  /** The `push` job: takes up to 200 queued changes of a profile into one run (trigger `event`). */
  async drainPushes(profileId: string) {
    const [p] = await this.ctx.db.select().from(profiles).where(eq(profiles.id, profileId));
    if (!p) return null;
    const run = await this.ctx.transaction(async (tx) => {
      const pending = await tx
        .select()
        .from(pendingPushes)
        .where(eq(pendingPushes.profileId, profileId))
        .orderBy(pendingPushes.queuedAt)
        .limit(200)
        .for('update', { skipLocked: true });
      if (!pending.length) return null;
      await tx.delete(pendingPushes).where(
        and(
          eq(pendingPushes.profileId, profileId),
          sql`(${pendingPushes.localId}, ${pendingPushes.kind}) in (${sql.join(
            pending.map((x) => sql`(${x.localId}, ${x.kind})`),
            sql`, `,
          )})`,
        ),
      );
      return this.deps.runs.create(tx, p, 'push', 'event', {
        params: { items: pending.map((x) => ({ localId: x.localId, kind: x.kind })) },
      });
    });
    if (!run) return null;
    const done = await this.execute(run.id);
    const [more] = await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pendingPushes)
      .where(eq(pendingPushes.profileId, profileId));
    if (more?.n)
      await this.ctx.jobs.enqueue('push', { profileId }, { jobId: `push-${profileId}-${Date.now()}` });
    return done;
  }

  /* ───────────────────────────── webhooks ───────────────────────────── */

  /**
   * `POST /hooks/:connectionId`: checks the secret (constant time) and the per-connection rate limit, asks the
   * connector which records changed, and queues a webhook run per matching profile. 401 `WEBHOOK_INVALID`
   * for a missing or wrong secret (or an unknown connection, so ids can't be probed).
   */
  async acceptWebhook(
    connectionId: string,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<{ accepted: number }> {
    const limit = await this.ctx.cache.rateLimit(`hook:${connectionId}`, LIMITS.webhookPerMinute, 60);
    if (!limit.allowed)
      throw new HttpError(429, ErrorCodes.RATE_LIMITED, 'Too many webhook calls', {
        retryAfterSeconds: limit.resetSeconds,
      });
    const [c] = await this.ctx.db.select().from(connections).where(eq(connections.id, connectionId));
    if (!c || !c.enabled || !webhookSecretMatches(presentedSecret(headers), c.webhookSecretHash)) {
      if (c && (await this.ctx.cache.increment(`hook-denied:${c.id}`, 60)) === 1)
        await this.ctx.audit.record({
          action: 'integrations.webhook.rejected',
          entityType: 'integrations.connection',
          entityId: c.id,
          entityLabel: c.name,
          outcome: 'denied',
          category: 'security',
          metadata: { reason: c.enabled ? 'secret' : 'disabled' },
        });
      throw new HttpError(401, ErrorCodes.WEBHOOK_INVALID, 'Missing or invalid webhook secret');
    }
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      const key = k.toLowerCase();
      if (['x-isbp-webhook-secret', 'authorization', 'cookie'].includes(key) || v === undefined) continue;
      flat[key] = Array.isArray(v) ? v.join(', ') : v;
    }
    const conn = this.deps.connections.open(c);
    const items = (await conn.webhook({ headers: flat, body })).slice(0, LIMITS.webhookItems);
    if (!items.length) return { accepted: 0 };
    const targets = await this.ctx.db
      .select()
      .from(profiles)
      .where(
        and(
          eq(profiles.connectionId, c.id),
          eq(profiles.enabled, true),
          inArray(profiles.direction, ['pull', 'both']),
          inArray(profiles.objectType, [...new Set(items.map((i) => i.objectType))]),
        ),
      );
    const created: RunRow[] = [];
    let accepted = 0;
    for (const p of targets) {
      const its = items.filter(
        (i) => i.objectType === p.objectType && (!p.remoteScope || !i.scope || i.scope === p.remoteScope),
      );
      if (!its.length) continue;
      accepted += its.length;
      created.push(
        await this.ctx.transaction((tx) =>
          this.deps.runs.create(tx, p, 'webhook', 'webhook', {
            params: {
              items: its.map((i) => ({ objectType: i.objectType, id: String(i.id), scope: i.scope ?? null })),
            },
          }),
        ),
      );
    }
    for (const r of created) await this.wake(r);
    return { accepted };
  }

  /* ───────────────────────────── housekeeping ───────────────────────────── */

  /**
   * Every minute: starts due scheduled pulls, fails runs whose worker stopped, re-queues lost runs and
   * stalled pushes.
   */
  async tick(now = new Date()) {
    let started = 0;
    const due = await this.ctx.db
      .select({ profile: profiles })
      .from(profiles)
      .innerJoin(connections, eq(connections.id, profiles.connectionId))
      .where(
        and(
          eq(profiles.enabled, true),
          gt(profiles.intervalMinutes, 0),
          inArray(profiles.direction, ['pull', 'both']),
          eq(connections.enabled, true),
          or(isNull(profiles.nextRunAt), lte(profiles.nextRunAt, now)),
        ),
      )
      .limit(100);
    for (const { profile } of due) {
      const [claimed] = await this.ctx.db
        .update(profiles)
        .set({
          nextRunAt: new Date(now.getTime() + profile.intervalMinutes * 60_000),
          ...keepProfileUpdatedAt,
        })
        .where(and(eq(profiles.id, profile.id), or(isNull(profiles.nextRunAt), lte(profiles.nextRunAt, now))))
        .returning({ id: profiles.id });
      if (!claimed) continue;
      try {
        const run = await this.ctx.transaction((tx) =>
          this.deps.runs.create(tx, profile, 'pull', 'schedule'),
        );
        await this.wake(run);
        started++;
      } catch (err) {
        if (!(err instanceof HttpError && err.code === ErrorCodes.SYNC_RUNNING)) throw err;
      }
    }

    const stale = await this.ctx.db
      .update(runs)
      .set({
        status: 'failed',
        error: 'The worker running this sync stopped',
        errorCode: ErrorCodes.INTERNAL,
        finishedAt: now,
      })
      .where(and(eq(runs.status, 'running'), lt(runs.heartbeatAt, new Date(now.getTime() - STALE_MS))))
      .returning({ id: runs.id });

    const lost = await this.ctx.db
      .select({ id: runs.id, kind: runs.kind })
      .from(runs)
      .where(
        or(
          and(eq(runs.status, 'queued'), lt(runs.createdAt, new Date(now.getTime() - LOST_MS))),
          and(eq(runs.status, 'waiting'), lt(runs.resumeAt, new Date(now.getTime() - LOST_MS))),
        ),
      )
      .limit(50);
    for (const r of lost) await this.wake(r, 0, true);

    const stalled = await this.ctx.db
      .selectDistinct({ profileId: pendingPushes.profileId })
      .from(pendingPushes)
      .where(lt(pendingPushes.queuedAt, new Date(now.getTime() - 30_000)))
      .limit(50);
    for (const p of stalled)
      await this.ctx.jobs.enqueue(
        'push',
        { profileId: p.profileId },
        { jobId: `push-${p.profileId}-${Date.now()}` },
      );

    return { started, stale: stale.length, requeued: lost.length + stalled.length };
  }

  /** Every 15 minutes: tests each enabled connection; a new failure tells integration admins once. */
  async checkConnections() {
    const rows = await this.ctx.db.select().from(connections).where(eq(connections.enabled, true));
    let failing = 0;
    for (const c of rows) {
      let result: { ok: boolean; message: string | null; account?: string | null };
      try {
        const r = await this.deps.connections.open(c).test();
        result = { ok: r.ok, message: r.message ?? null, account: r.account ?? null };
      } catch (err) {
        result = { ok: false, message: errorInfo(err).message };
      }
      if (result.ok) await this.deps.connections.recordHealth(c, result);
      else {
        failing++;
        await this.markFailing(c, result.message ?? 'The connection test failed');
      }
    }
    const purged = await this.ctx.db
      .delete(runs)
      .where(
        and(
          inArray(runs.status, ['succeeded', 'partial', 'failed']),
          lt(runs.createdAt, new Date(Date.now() - RETENTION_DAYS * 86_400_000)),
        ),
      )
      .returning({ id: runs.id });
    return { checked: rows.length, failing, purged: purged.length };
  }
}
