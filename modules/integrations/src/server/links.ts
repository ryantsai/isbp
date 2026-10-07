import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
  type Page,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { LinkOut, LinkQueryOut, RecordLinkOut } from '../contracts';
import { safeHttpUrl } from '../model';
import { MANAGE, READ } from './access';
import type { ConnectionService } from './connections';
import type { Engine } from './engine';
import { connections, links, profiles } from './schema';
import type { LinkRow } from './session';

/** Local side of links as the caller may see it: record types resolve through `ctx.records`. */
export async function resolveLocals(
  ctx: ModuleContext,
  rows: { entity: string; localId: string | null; localRef: string | null; localTitle: string | null }[],
  auth: AuthContext,
) {
  const recordTypes = new Set(
    ctx.sync
      .entities()
      .filter((e) => e.recordType)
      .map((e) => e.entity),
  );
  const refs = rows
    .filter((r) => r.localId && recordTypes.has(r.entity))
    .map((r) => ({ type: r.entity, id: r.localId! }));
  const resolved = refs.length ? await ctx.records.resolve(refs, auth) : new Map();
  return (r: (typeof rows)[number]) => {
    if (!r.localId) return null;
    if (recordTypes.has(r.entity)) {
      const rec = resolved.get(`${r.entity}:${r.localId}`);
      return rec
        ? { id: r.localId, reference: rec.reference ?? null, title: rec.title, href: rec.href, hidden: false }
        : { id: r.localId, reference: null, title: '', href: null, hidden: true };
    }
    return {
      id: r.localId,
      reference: r.localRef,
      title: r.localTitle ?? r.localId,
      href: null,
      hidden: false,
    };
  };
}

export class LinkService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly deps: { connections: ConnectionService; engine: () => Engine },
  ) {}

  async row(id: string): Promise<LinkRow> {
    const [l] = await this.ctx.db.select().from(links).where(eq(links.id, id));
    if (!l) throw httpErrors.notFound('Link not found');
    return l;
  }

  async list(q: LinkQueryOut, auth: AuthContext, only?: string): Promise<Page<LinkOut>> {
    const where: SQL[] = [];
    if (only) where.push(eq(links.id, only));
    if (q.connectionId) where.push(eq(links.connectionId, q.connectionId));
    if (q.profileId) where.push(eq(links.profileId, q.profileId));
    if (q.state) where.push(eq(links.state, q.state));
    if (q.q) {
      const p = likePattern(q.q);
      where.push(or(ilike(links.remoteRef, p), ilike(links.remoteTitle, p), ilike(links.localRef, p))!);
    }
    const cond = where.length ? and(...where) : undefined;
    const sorts: Record<string, SQL> = {
      lastSyncedAt: asc(links.lastSyncedAt),
      '-lastSyncedAt': desc(links.lastSyncedAt),
      remoteRef: asc(links.remoteRef),
      '-remoteRef': desc(links.remoteRef),
      createdAt: asc(links.createdAt),
      '-createdAt': desc(links.createdAt),
    };
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select({ link: links, profileName: profiles.name })
        .from(links)
        .innerJoin(profiles, eq(profiles.id, links.profileId))
        .where(cond)
        .orderBy(sorts[q.sort ?? ''] ?? desc(links.lastSyncedAt), desc(links.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(links).where(cond),
    ]);
    const local = await resolveLocals(
      this.ctx,
      rows.map((r) => r.link),
      auth,
    );
    return {
      items: rows.map(({ link: l, profileName }) => ({
        id: l.id,
        profileId: l.profileId,
        profileName,
        connectionId: l.connectionId,
        entity: l.entity,
        local: local(l),
        remoteId: l.remoteId,
        remoteRef: l.remoteRef,
        remoteTitle: l.remoteTitle,
        remoteUrl: safeHttpUrl(l.remoteUrl),
        remoteVersion: l.remoteVersion,
        origin: l.origin,
        state: l.state,
        lastError: l.lastError ?? null,
        lastSyncedAt: l.lastSyncedAt,
        createdAt: l.createdAt,
      })),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * The record panel ("Synced with"): whoever can read the record sees its links. For entities that are not
   * record types, `integrations.connections.read` is needed; types that don't sync have no links.
   */
  async byRecord(entity: string, id: string, auth: AuthContext): Promise<{ items: RecordLinkOut[] }> {
    const info = this.ctx.sync.entities().find((e) => e.entity === entity);
    // Not a sync entity (any record page asks): nothing can be linked.
    if (!info) return { items: [] };
    if (info.recordType) {
      const visible = await this.ctx.records.get({ type: entity, id }, auth);
      if (!visible) throw httpErrors.notFound('Record not found');
    } else auth.require(READ);
    const rows = await this.ctx.db
      .select({ link: links, connection: connections })
      .from(links)
      .innerJoin(connections, eq(connections.id, links.connectionId))
      .where(and(eq(links.entity, entity), eq(links.localId, id)))
      .orderBy(connections.name);
    const infos = new Map(this.ctx.connectors.list().map((c) => [c.type, c]));
    const canSync = auth.can(MANAGE);
    return {
      items: rows.map(({ link: l, connection: c }) => ({
        id: l.id,
        state: l.state,
        connection: { id: c.id, name: c.name, type: c.type, icon: infos.get(c.type)?.icon ?? null },
        connectorName: infos.get(c.type)?.name ?? c.type,
        remoteRef: l.remoteRef,
        remoteUrl: safeHttpUrl(l.remoteUrl),
        lastSyncedAt: l.lastSyncedAt,
        lastErrorCode: l.lastError?.code ?? null,
        canSync,
      })),
    };
  }

  /** "Sync now": a resync run for this link (async; the run page follows it). */
  async resync(id: string, auth: AuthContext) {
    auth.require(MANAGE);
    const l = await this.row(id);
    const run = await this.deps.engine().resync(l.profileId, [l.id], auth);
    return { runId: run.id };
  }

  /** Points the local record at another remote record (a wrong match), then syncs it. */
  async relink(id: string, remoteId: string, auth: AuthContext): Promise<LinkOut> {
    auth.require(MANAGE);
    const l = await this.row(id);
    const [p] = await this.ctx.db.select().from(profiles).where(eq(profiles.id, l.profileId));
    const conn = this.deps.connections.open(await this.deps.connections.row(l.connectionId));
    const remote = await conn.get(p!.objectType, remoteId, { scope: p!.remoteScope });
    if (!remote) throw httpErrors.notFound('No such remote record');
    await this.ctx.transaction(async (tx) => {
      const [taken] = await tx
        .select({ id: links.id })
        .from(links)
        .where(and(eq(links.profileId, l.profileId), eq(links.remoteId, remote.id)));
      if (taken && taken.id !== l.id)
        throw new HttpError(409, ErrorCodes.CONFLICT, 'That remote record is linked to another record', {
          linkId: taken.id,
        });
      await tx
        .update(links)
        .set({
          remoteId: remote.id,
          remoteRef: remote.ref.slice(0, 200),
          remoteTitle: remote.title.slice(0, 500),
          remoteUrl: safeHttpUrl(remote.url),
          remoteVersion: null,
          origin: 'matched',
          snapshot: {},
          state: 'ok',
          lastError: null,
          rev: l.rev + 1,
        })
        .where(eq(links.id, l.id));
      await this.ctx.audit.record(
        {
          action: 'integrations.link.relinked',
          entityType: 'integrations.link',
          entityId: l.id,
          entityLabel: `${l.localRef ?? l.localTitle ?? l.localId} ↔ ${remote.ref}`,
          changes: { remote: [l.remoteRef ?? l.remoteId, remote.ref] },
        },
        { tx },
      );
    });
    await this.deps.engine().resync(l.profileId, [l.id], auth);
    return this.one(l.id, auth);
  }

  async one(id: string, auth: AuthContext): Promise<LinkOut> {
    const page = await this.list({ page: 1, pageSize: 1 }, auth, id);
    if (!page.items[0]) throw httpErrors.notFound('Link not found');
    return page.items[0];
  }

  /** Forgets the link (and its comment links); nothing is deleted on either side. */
  async unlink(id: string, auth: AuthContext) {
    auth.require(MANAGE);
    const l = await this.row(id);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(links).where(eq(links.id, id));
      await this.ctx.audit.record(
        {
          action: 'integrations.link.unlinked',
          entityType: 'integrations.link',
          entityId: id,
          entityLabel: `${l.localRef ?? l.localTitle ?? l.localId ?? '—'} ↔ ${l.remoteRef ?? l.remoteId}`,
          metadata: { profileId: l.profileId, entity: l.entity, localId: l.localId, remoteId: l.remoteId },
        },
        { tx },
      );
    });
  }
}
