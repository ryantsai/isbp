import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  type Page,
  type RemoteRecord,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm';
import type { ConflictDetailOut, ConflictQueryOut, ConflictSummaryOut } from '../contracts';
import type { Snapshot } from '../merge';
import { safeHttpUrl } from '../model';
import { RESOLVE } from './access';
import type { ConnectionService } from './connections';
import { toLocal, toRemote, UNMAPPABLE } from './convert';
import { resolveLocals } from './links';
import { withLock } from './lock';
import { RunLog } from './runs';
import { conflicts, connections, links, profiles } from './schema';
import { agreeOnStored } from './reconcile';
import { openSession, remoteValue, sourceOf } from './session';

type ConflictRow = typeof conflicts.$inferSelect;

export class ConflictService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly deps: { connections: ConnectionService },
  ) {}

  private select() {
    return this.ctx.db
      .select({
        c: conflicts,
        profile: { id: profiles.id, name: profiles.name },
        connection: { id: connections.id, name: connections.name, type: connections.type },
        link: {
          localRef: links.localRef,
          localTitle: links.localTitle,
          remoteUrl: links.remoteUrl,
          remoteId: links.remoteId,
        },
        resolvedBy: { id: users.id, displayName: users.displayName },
      })
      .from(conflicts)
      .innerJoin(profiles, eq(profiles.id, conflicts.profileId))
      .innerJoin(connections, eq(connections.id, conflicts.connectionId))
      .innerJoin(links, eq(links.id, conflicts.linkId))
      .leftJoin(users, eq(users.id, conflicts.resolvedBy));
  }

  async list(q: ConflictQueryOut, auth: AuthContext): Promise<Page<ConflictSummaryOut>> {
    const where: SQL[] = [];
    if (q.connectionId) where.push(eq(conflicts.connectionId, q.connectionId));
    if (q.profileId) where.push(eq(conflicts.profileId, q.profileId));
    if (q.status) where.push(eq(conflicts.status, q.status));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [total]] = await Promise.all([
      this.select()
        .where(cond)
        .orderBy(q.sort === 'createdAt' ? asc(conflicts.createdAt) : desc(conflicts.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(conflicts).where(cond),
    ]);
    const local = await resolveLocals(
      this.ctx,
      rows.map((r) => ({
        entity: r.c.entity,
        localId: r.c.localId,
        localRef: r.link.localRef,
        localTitle: r.link.localTitle,
      })),
      auth,
    );
    return {
      items: rows.map((r) => this.summary(r, local)),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private summary(
    r: Awaited<ReturnType<ConflictService['select']>>[number],
    local: Awaited<ReturnType<typeof resolveLocals>>,
  ): ConflictSummaryOut {
    return {
      id: r.c.id,
      linkId: r.c.linkId,
      profile: r.profile,
      connection: r.connection,
      entity: r.c.entity,
      local: local({
        entity: r.c.entity,
        localId: r.c.localId,
        localRef: r.link.localRef,
        localTitle: r.link.localTitle,
      }),
      remoteRef: r.c.remoteRef,
      remoteUrl: safeHttpUrl(r.link.remoteUrl),
      status: r.c.status,
      fields: r.c.fields.map((f) => f.field),
      resolvedBy: r.resolvedBy?.id ? r.resolvedBy : null,
      resolvedAt: r.c.resolvedAt,
      createdAt: r.c.createdAt,
      updatedAt: r.c.updatedAt,
    };
  }

  async detail(id: string, auth: AuthContext): Promise<ConflictDetailOut> {
    const [r] = await this.select().where(eq(conflicts.id, id));
    if (!r) throw httpErrors.notFound('Conflict not found');
    const local = await resolveLocals(
      this.ctx,
      [
        {
          entity: r.c.entity,
          localId: r.c.localId,
          localRef: r.link.localRef,
          localTitle: r.link.localTitle,
        },
      ],
      auth,
    );
    const summary = this.summary(r, local);
    const hidden = summary.local?.hidden ?? false;
    return {
      ...summary,
      // Values of a record the caller can't see stay hidden.
      details: r.c.fields.map((f) => (hidden ? { ...f, base: null, local: null, remote: null } : f)),
      choices: r.c.choices ?? null,
      canResolve: r.c.status === 'open' && !hidden && auth.can(RESOLVE),
    };
  }

  private async open(id: string, auth: AuthContext): Promise<ConflictRow> {
    auth.require(RESOLVE);
    const [c] = await this.ctx.db.select().from(conflicts).where(eq(conflicts.id, id));
    if (!c) throw httpErrors.notFound('Conflict not found');
    const recordType = this.ctx.sync.entities().find((e) => e.entity === c.entity)?.recordType;
    if (recordType && !(await this.ctx.records.get({ type: c.entity, id: c.localId }, auth)))
      throw httpErrors.notFound('Conflict not found');
    if (c.status !== 'open')
      throw new HttpError(409, ErrorCodes.CONFLICT_RESOLVED, 'This conflict was already resolved', {
        status: c.status,
      });
    return c;
  }

  /**
   * Picks a side per field: "ISBP" pushes the current local value, "remote" writes the current remote value
   * locally. Both commit with the link's new snapshot; the link is `ok` again.
   */
  async resolve(id: string, choices: Record<string, 'local' | 'remote'>, auth: AuthContext) {
    const c = await this.open(id, auth);
    const missing = c.fields.filter((f) => !choices[f.field]).map((f) => f.field);
    if (missing.length)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Choose a side for every field', {
        issues: missing.map((f) => ({ path: `choices.${f}`, message: 'required' })),
      });
    return this.apply(c, auth, choices);
  }

  /** "Keep both as they are": the current values become the agreed ones; nothing is written. */
  async dismiss(id: string, auth: AuthContext) {
    const c = await this.open(id, auth);
    return this.apply(c, auth, null);
  }

  private async apply(c: ConflictRow, auth: AuthContext, choices: Record<string, 'local' | 'remote'> | null) {
    const [link] = await this.ctx.db.select().from(links).where(eq(links.id, c.linkId));
    const [profile] = await this.ctx.db.select().from(profiles).where(eq(profiles.id, c.profileId));
    if (!link || !profile || !link.localId) throw httpErrors.notFound('Conflict not found');
    const s = await openSession(this.ctx, this.deps.connections, profile, {
      log: new RunLog(this.ctx, null),
    });
    await withLock(
      this.ctx.cache,
      `lock:${profile.id}:r:${link.remoteId.replace(/[^\w:.@/+=-]/g, '_').slice(0, 200)}`,
      async () => {
        const [fresh] = await this.ctx.db.select().from(conflicts).where(eq(conflicts.id, c.id));
        if (fresh?.status !== 'open')
          throw new HttpError(409, ErrorCodes.CONFLICT_RESOLVED, 'This conflict was already resolved');
        const local = await this.ctx.sync.read(profile.entity, link.localId!);
        let remote: RemoteRecord | null = await s.conn.get(profile.objectType, link.remoteId, {
          scope: profile.remoteScope,
        });
        if (!local || !remote || remote.deleted)
          throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The record no longer exists on one side');
        const [current] = await this.ctx.db.select().from(links).where(eq(links.id, link.id));
        const snap: Snapshot = { ...(current?.snapshot ?? {}) };
        const localWrites: Record<string, unknown> = {};
        const remoteWrites: Record<string, unknown> = {};
        const pushed: { key: string; remoteKey: string; local: unknown; sent: unknown }[] = [];
        for (const f of c.fields) {
          const row = s.rows.find((r) => r.m.local === f.field);
          if (!row) continue;
          const localNow = local.values[f.field] ?? null;
          const remoteNow = remoteValue(remote, row);
          if (!choices) {
            snap[f.field] = { l: localNow, r: remoteNow };
            continue;
          }
          if (choices[f.field] === 'remote') {
            const v = await toLocal(remoteNow, row.rf, row.lf, row.m, s.resolver);
            if (v === UNMAPPABLE)
              throw new HttpError(
                422,
                ErrorCodes.VALIDATION_FAILED,
                `The remote value of ${f.field} can’t be used in ISBP`,
                {
                  issues: [{ path: `choices.${f.field}`, message: 'unmappable' }],
                },
              );
            localWrites[f.field] = v;
            snap[f.field] = { l: v, r: remoteNow };
          } else {
            const v = await toRemote(localNow, row.lf, row.rf, row.m, s.resolver);
            if (v === UNMAPPABLE)
              throw new HttpError(
                422,
                ErrorCodes.VALIDATION_FAILED,
                `The ISBP value of ${f.field} can’t be sent`,
                {
                  issues: [{ path: `choices.${f.field}`, message: 'unmappable' }],
                },
              );
            remoteWrites[row.m.remote] = v;
            pushed.push({ key: f.field, remoteKey: row.m.remote, local: localNow, sent: v });
          }
        }
        if (pushed.length) {
          remote = await s.conn.update(profile.objectType, link.remoteId, remoteWrites, {
            expectedVersion: remote.version,
            scope: profile.remoteScope,
          });
          for (const p of pushed) {
            const back = remote.values[p.remoteKey];
            snap[p.key] = { l: p.local, r: back === undefined ? p.sent : back };
          }
        }
        const outcome = choices ? 'resolved' : 'dismissed';
        await this.ctx.transaction(async (tx) => {
          if (Object.keys(localWrites).length) {
            const { record } = await this.ctx.sync.write(
              profile.entity,
              { id: local.id, values: localWrites },
              { auth: s.agent, tx, source: sourceOf(s, remote!) },
            );
            agreeOnStored(snap, Object.keys(localWrites), record);
          }
          await tx
            .update(links)
            .set({
              snapshot: snap,
              remoteVersion: remote!.version,
              state: 'ok',
              lastError: null,
              lastSyncedAt: new Date(),
              rev: (current?.rev ?? link.rev) + 1,
            })
            .where(eq(links.id, link.id));
          await tx
            .update(conflicts)
            .set({ status: outcome, choices, resolvedBy: auth.user?.id ?? null, resolvedAt: new Date() })
            .where(eq(conflicts.id, c.id));
          await this.ctx.audit.record(
            {
              action: `integrations.conflict.${outcome}`,
              entityType: 'integrations.conflict',
              entityId: c.id,
              entityLabel: `${local.ref ?? local.title} ↔ ${remote!.ref}`,
              metadata: { choices, fields: c.fields.map((f) => f.field) },
            },
            { tx },
          );
          await this.ctx.events.publish(
            'integrations.conflict.resolved',
            {
              conflictId: c.id,
              linkId: link.id,
              profileId: profile.id,
              connectionId: c.connectionId,
              entity: c.entity,
              localId: c.localId,
              outcome,
              choices: choices ?? {},
            },
            { tx },
          );
        });
      },
    );
    return this.detail(c.id, auth);
  }
}
