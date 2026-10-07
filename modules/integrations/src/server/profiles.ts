import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  type SyncEntityInfo,
} from '@isbp/sdk/server';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type {
  DefaultMappingOut,
  FieldMapping,
  PreviewOut,
  ProfileDraft,
  ProfileOut,
  UpdateProfileInput,
} from '../contracts';
import { fitValueMap, validateProfile } from '../mapping';
import { ACTIVE_RUN_STATUSES, isCompatible, LIMITS, matchesFilter } from '../model';
import { canConfigure, MANAGE, personOf, requireConfigure } from './access';
import type { ConnectionService } from './connections';
import { display, toLocal, toRemote, UNMAPPABLE } from './convert';
import { planMerge } from './reconcile';
import { RunLog, type RunService } from './runs';
import { conflicts, links, profiles, runs } from './schema';
import {
  entityOf,
  openSession,
  profileDraftRow,
  type ProfileLike,
  type ProfileRow,
  remoteValue,
  type Session,
} from './session';

const invalid = (
  issues: { path: string; message: string; code?: string; params?: Record<string, string> }[],
) => new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Invalid sync profile', { issues });

export class ProfileService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly deps: { connections: ConnectionService; runs: RunService },
  ) {}

  async row(id: string): Promise<ProfileRow> {
    const [p] = await this.ctx.db.select().from(profiles).where(eq(profiles.id, id));
    if (!p) throw httpErrors.notFound('Profile not found');
    return p;
  }

  async list(connectionId: string | undefined, auth: AuthContext): Promise<ProfileOut[]> {
    const rows = await this.ctx.db
      .select()
      .from(profiles)
      .where(connectionId ? eq(profiles.connectionId, connectionId) : undefined)
      .orderBy(profiles.name);
    return this.views(rows, auth);
  }

  async get(id: string, auth: AuthContext): Promise<ProfileOut> {
    return (await this.views([await this.row(id)], auth))[0]!;
  }

  private async views(rows: ProfileRow[], auth: AuthContext): Promise<ProfileOut[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [linkStats, conflictStats, latest] = await Promise.all([
      this.ctx.db
        .select({
          id: links.profileId,
          n: count(),
          errors: sql<number>`count(*) filter (where ${links.state} = 'error')::int`,
        })
        .from(links)
        .where(inArray(links.profileId, ids))
        .groupBy(links.profileId),
      this.ctx.db
        .select({ id: conflicts.profileId, n: count() })
        .from(conflicts)
        .where(and(inArray(conflicts.profileId, ids), eq(conflicts.status, 'open')))
        .groupBy(conflicts.profileId),
      this.deps.runs.latestByProfile(ids),
    ]);
    const ls = new Map(linkStats.map((r) => [r.id, r]));
    const cs = new Map(conflictStats.map((r) => [r.id, r.n]));
    const entities = new Map(this.ctx.sync.entities().map((e) => [e.entity, e]));
    return rows.map((p) => {
      const run = latest.get(p.id);
      const entity = entities.get(p.entity);
      return {
        id: p.id,
        connectionId: p.connectionId,
        name: p.name,
        objectType: p.objectType,
        remoteScope: p.remoteScope,
        remoteScopeName: p.remoteScopeName,
        entity: p.entity,
        containerId: p.containerId,
        containerLabel: p.containerLabel,
        direction: p.direction,
        createLocal: p.createLocal,
        createRemote: p.createRemote,
        matchRule: p.matchRule ?? null,
        pushFilter: p.pushFilter,
        mappings: p.mappings,
        conflictPolicy: p.conflictPolicy,
        comments: p.comments,
        intervalMinutes: p.intervalMinutes,
        enabled: p.enabled,
        cursor: p.cursor,
        nextRunAt: p.nextRunAt,
        lastRun: run
          ? { id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt }
          : null,
        stats: {
          links: ls.get(p.id)?.n ?? 0,
          conflicts: cs.get(p.id) ?? 0,
          errors: Number(ls.get(p.id)?.errors ?? 0),
        },
        canEdit: Boolean(entity && canConfigure(auth, entity)),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });
  }

  /* ───────────────────────────── validation ───────────────────────────── */

  /**
   * Checks a profile against both catalogues (the remote object's fields come from the connector, so this
   * signs in to the remote system). Returns what the save needs to store.
   */
  private async check(draft: ProfileDraft, auth: AuthContext) {
    const entity = entityOf(this.ctx, draft.entity);
    requireConfigure(auth, entity);
    const connection = await this.deps.connections.row(draft.connectionId);
    const info = this.ctx.connectors.list().find((c) => c.type === connection.type);
    if (!info)
      throw new HttpError(
        409,
        ErrorCodes.MODULE_DISABLED,
        `The ${connection.type} connector is not available`,
      );
    const object = info.objects.find((o) => o.type === draft.objectType);
    if (!object)
      throw invalid([{ path: 'objectType', message: 'Unknown remote object type', code: 'unknown_object' }]);
    if (object.scoped && !draft.remoteScope)
      throw invalid([
        { path: 'remoteScope', message: 'Choose where in the remote system', code: 'scope_required' },
      ]);
    if (entity.container && !draft.containerId)
      throw invalid([{ path: 'containerId', message: 'Choose where in ISBP', code: 'container_required' }]);
    const conn = this.deps.connections.open(connection);
    const [localFields, remoteFields, scopes] = await Promise.all([
      this.ctx.sync.fields(draft.entity, { containerId: draft.containerId }),
      conn.fields(draft.objectType, draft.remoteScope),
      object.scoped ? conn.scopes(draft.objectType) : Promise.resolve([]),
    ]);
    const issues = validateProfile(draft, localFields, remoteFields, {
      object: object.capabilities,
      entity: { comments: entity.comments, matchKeys: entity.matchKeys },
    });
    if (issues.length) throw invalid(issues);
    const scopeName = draft.remoteScope
      ? (scopes.find((s) => s.id === draft.remoteScope)?.name ?? null)
      : null;
    if (object.scoped && draft.remoteScope && scopes.length && !scopeName)
      throw invalid([{ path: 'remoteScope', message: 'Unknown remote scope', code: 'unknown_scope' }]);
    const containerLabel = draft.containerId
      ? await this.containerLabel(entity, draft.containerId, auth)
      : null;
    return { entity, connection, object, scopeName, containerLabel, localFields, remoteFields };
  }

  /** The container's name, which the caller must be able to see. */
  private async containerLabel(entity: SyncEntityInfo, id: string, auth: AuthContext): Promise<string> {
    const containerEntity = entity.container!;
    const asSync = this.ctx.sync.entities().find((e) => e.entity === containerEntity);
    // A container that isn't itself synced (ALM applications) is checked through the record registry.
    if (!asSync || asSync.recordType) {
      const r = await this.ctx.records.get({ type: containerEntity, id }, auth).catch(() => null);
      if (!r) throw invalid([{ path: 'containerId', message: 'Not found', code: 'unknown_container' }]);
      return `${r.reference ? `${r.reference} ` : ''}${r.title}`.slice(0, 300);
    }
    const rec = await this.ctx.sync.read(containerEntity, id);
    if (!rec) throw invalid([{ path: 'containerId', message: 'Not found', code: 'unknown_container' }]);
    return `${rec.ref ? `${rec.ref} ` : ''}${rec.title}`.slice(0, 300);
  }

  /* ───────────────────────────── writes ───────────────────────────── */

  async create(draft: ProfileDraft, auth: AuthContext): Promise<ProfileOut> {
    const checked = await this.check(draft, auth);
    const row = await this.ctx.transaction(async (tx) => {
      const [p] = await tx
        .insert(profiles)
        .values({
          connectionId: draft.connectionId,
          name: draft.name,
          objectType: draft.objectType,
          remoteScope: draft.remoteScope,
          remoteScopeName: checked.scopeName,
          entity: draft.entity,
          containerId: draft.containerId,
          containerLabel: checked.containerLabel,
          direction: draft.direction,
          createLocal: draft.createLocal,
          createRemote: draft.createRemote,
          matchRule: draft.matchRule,
          pushFilter: draft.pushFilter,
          mappings: draft.mappings,
          conflictPolicy: draft.conflictPolicy,
          comments: draft.comments,
          intervalMinutes: draft.intervalMinutes,
          enabled: draft.enabled,
          nextRunAt: new Date(),
          createdBy: personOf(auth),
          updatedBy: personOf(auth),
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'integrations.profile.created',
          entityType: 'integrations.profile',
          entityId: p!.id,
          entityLabel: p!.name,
          metadata: {
            connectionId: p!.connectionId,
            objectType: p!.objectType,
            entity: p!.entity,
            direction: p!.direction,
            mappings: p!.mappings.length,
          },
        },
        { tx },
      );
      await this.ctx.events.publish('integrations.profile.created', this.eventOf(p!), { tx });
      return p!;
    });
    return this.get(row.id, auth);
  }

  private eventOf(p: ProfileRow) {
    return {
      profileId: p.id,
      connectionId: p.connectionId,
      name: p.name,
      entity: p.entity,
      objectType: p.objectType,
      direction: p.direction,
    };
  }

  async update(id: string, input: UpdateProfileInput, auth: AuthContext): Promise<ProfileOut> {
    const before = await this.row(id);
    const draft: ProfileDraft = {
      connectionId: before.connectionId,
      objectType: before.objectType,
      remoteScope: before.remoteScope,
      entity: before.entity,
      containerId: before.containerId,
      name: input.name ?? before.name,
      direction: input.direction ?? before.direction,
      createLocal: input.createLocal ?? before.createLocal,
      createRemote: input.createRemote ?? before.createRemote,
      matchRule: input.matchRule === undefined ? (before.matchRule ?? null) : input.matchRule,
      pushFilter: (input.pushFilter as ProfileDraft['pushFilter'] | undefined) ?? before.pushFilter,
      mappings: (input.mappings as FieldMapping[] | undefined) ?? before.mappings,
      conflictPolicy: input.conflictPolicy ?? before.conflictPolicy,
      comments: input.comments ?? before.comments,
      intervalMinutes: input.intervalMinutes ?? before.intervalMinutes,
      enabled: input.enabled ?? before.enabled,
    };
    await this.check(draft, auth);
    await this.ctx.transaction(async (tx) => {
      const scheduleChanged =
        draft.intervalMinutes !== before.intervalMinutes || (draft.enabled && !before.enabled);
      const [p] = await tx
        .update(profiles)
        .set({
          name: draft.name,
          direction: draft.direction,
          createLocal: draft.createLocal,
          createRemote: draft.createRemote,
          matchRule: draft.matchRule,
          pushFilter: draft.pushFilter,
          mappings: draft.mappings,
          conflictPolicy: draft.conflictPolicy,
          comments: draft.comments,
          intervalMinutes: draft.intervalMinutes,
          enabled: draft.enabled,
          ...(scheduleChanged ? { nextRunAt: new Date() } : {}),
          updatedBy: personOf(auth),
        })
        .where(eq(profiles.id, id))
        .returning();
      const changes = this.ctx.audit.diff(
        {
          name: before.name,
          direction: before.direction,
          createLocal: before.createLocal,
          createRemote: before.createRemote,
          matchRule: before.matchRule,
          pushFilter: before.pushFilter,
          mappings: before.mappings,
          conflictPolicy: before.conflictPolicy,
          comments: before.comments,
          intervalMinutes: before.intervalMinutes,
          enabled: before.enabled,
        } as Record<string, unknown>,
        {
          name: p!.name,
          direction: p!.direction,
          createLocal: p!.createLocal,
          createRemote: p!.createRemote,
          matchRule: p!.matchRule,
          pushFilter: p!.pushFilter,
          mappings: p!.mappings,
          conflictPolicy: p!.conflictPolicy,
          comments: p!.comments,
          intervalMinutes: p!.intervalMinutes,
          enabled: p!.enabled,
        },
      );
      await this.ctx.audit.record(
        {
          action: 'integrations.profile.updated',
          entityType: 'integrations.profile',
          entityId: id,
          entityLabel: p!.name,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'integrations.profile.updated',
        { ...this.eventOf(p!), changes: Object.keys(changes) },
        { tx },
      );
    });
    return this.get(id, auth);
  }

  async remove(id: string, auth: AuthContext): Promise<void> {
    auth.require(MANAGE);
    const p = await this.row(id);
    await this.ctx.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.profileId, id), inArray(runs.status, [...ACTIVE_RUN_STATUSES])))
        .limit(1);
      if (active) throw new HttpError(409, ErrorCodes.SYNC_RUNNING, 'A sync of this profile is running');
      const [linked] = await tx.select({ n: count() }).from(links).where(eq(links.profileId, id));
      await tx.delete(profiles).where(eq(profiles.id, id));
      await this.ctx.audit.record(
        {
          action: 'integrations.profile.deleted',
          entityType: 'integrations.profile',
          entityId: id,
          entityLabel: p.name,
          metadata: { links: linked?.n ?? 0, entity: p.entity, objectType: p.objectType },
        },
        { tx },
      );
      await this.ctx.events.publish('integrations.profile.deleted', this.eventOf(p), { tx });
    });
  }

  /* ───────────────────────────── helpers for the editor ───────────────────────────── */

  /** The connector's suggestion for an object ↔ entity pair, minus rows the catalogues can't take. */
  async defaultMapping(q: {
    connectionId: string;
    objectType: string;
    entity: string;
    scope?: string;
    containerId?: string;
  }): Promise<DefaultMappingOut> {
    const connection = await this.deps.connections.row(q.connectionId);
    const conn = this.deps.connections.open(connection);
    const suggested = conn.defaultMapping(q.objectType, q.entity);
    if (!suggested.length) return { mappings: [], dropped: 0 };
    const [localFields, remoteFields] = await Promise.all([
      this.ctx.sync.fields(q.entity, { containerId: q.containerId ?? null }),
      conn.fields(q.objectType, q.scope ?? null),
    ]);
    const L = new Map(localFields.map((f) => [f.key, f]));
    const R = new Map(remoteFields.map((f) => [f.key, f]));
    const local = new Set<string>();
    const remote = new Set<string>();
    const mappings: FieldMapping[] = [];
    for (const m of suggested) {
      const lf = L.get(m.local);
      const rf = R.get(m.remote);
      if (!lf || !rf || !isCompatible(lf.type, rf.type) || local.has(m.local) || remote.has(m.remote))
        continue;
      local.add(m.local);
      remote.add(m.remote);
      const values = m.values ? fitValueMap(m.values, lf, rf) : undefined;
      mappings.push({
        local: m.local,
        remote: m.remote,
        direction: m.direction,
        ...(values?.length ? { values } : {}),
      });
    }
    return { mappings, dropped: suggested.length - mappings.length };
  }

  /* ───────────────────────────── preview (dry run) ───────────────────────────── */

  /**
   * What the next sync would do with the next few remote changes (or, for push-only profiles, the first few
   * local records), per field, without writing anything or moving the cursor.
   */
  async preview(draft: ProfileDraft & { id?: string }, auth: AuthContext): Promise<PreviewOut> {
    const saved = draft.id ? await this.row(draft.id) : null;
    if (
      saved &&
      (saved.connectionId !== draft.connectionId ||
        saved.entity !== draft.entity ||
        saved.objectType !== draft.objectType)
    )
      throw httpErrors.badRequest('The connection, remote object and entity of a profile can’t change');
    await this.check(draft, auth);
    const profile: ProfileLike = profileDraftRow(
      { ...draft, ...(saved ? { id: saved.id } : {}) },
      saved?.cursor ?? null,
    );
    const s = await openSession(this.ctx, this.deps.connections, profile, {
      log: new RunLog(this.ctx, null),
      dryRun: true,
    });
    if (profile.direction === 'push') return this.previewLocal(s, Boolean(saved));
    const page = await s.conn.changes(profile.objectType, {
      scope: profile.remoteScope,
      cursor: profile.cursor,
      limit: LIMITS.previewItems,
    });
    const items = [];
    for (const remote of page.items.slice(0, LIMITS.previewItems)) {
      const base = {
        remoteId: remote.id,
        remoteRef: remote.ref,
        remoteUrl: null as string | null,
        title: remote.title,
        localId: null as string | null,
        localTitle: null as string | null,
        actions: [] as PreviewOut['items'][number]['actions'],
        notes: [] as string[],
        changes: [] as PreviewOut['items'][number]['changes'],
        error: null as { code: string; message: string } | null,
      };
      try {
        await this.previewRemote(s, remote, base, Boolean(saved));
      } catch (err) {
        if (
          err instanceof HttpError &&
          (err.code === ErrorCodes.REMOTE_AUTH_FAILED || err.code === ErrorCodes.REMOTE_RATE_LIMITED)
        )
          throw err;
        base.error =
          err instanceof HttpError
            ? { code: err.code, message: err.message }
            : { code: ErrorCodes.INTERNAL, message: String(err) };
      }
      items.push(base);
    }
    return { source: 'remote', items, hasMore: page.hasMore };
  }

  private async previewRemote(
    s: Session,
    remote: Awaited<ReturnType<Session['conn']['get']>> & object,
    out: PreviewOut['items'][number],
    saved: boolean,
  ) {
    const [link] = saved
      ? await this.ctx.db
          .select()
          .from(links)
          .where(and(eq(links.profileId, s.profile.id), eq(links.remoteId, remote.id)))
      : [];
    if (remote.deleted) {
      out.actions.push(link?.localId ? 'orphan' : 'skip');
      out.notes.push('deleted');
      return;
    }
    if (link?.state === 'orphaned') {
      out.actions.push('skip');
      out.notes.push('orphaned');
      return;
    }
    let local = link?.localId ? await this.ctx.sync.read(s.profile.entity, link.localId) : null;
    let snapshot = link?.snapshot ?? {};
    if (link?.localId && !local) {
      out.actions.push('orphan');
      return;
    }
    if (link?.localId && link.state === 'ok' && link.remoteVersion === remote.version) {
      out.localId = link.localId;
      out.localTitle = local?.ref ?? local?.title ?? null;
      out.actions.push('skip');
      out.notes.push('unchanged');
      return;
    }
    if (!local && s.profile.matchRule) {
      const rule = s.profile.matchRule;
      const lf = s.localFields.find((f) => f.key === rule.local);
      const rf = s.remoteFields.find((f) => f.key === rule.remote);
      if (lf && rf) {
        const v = await toLocal(remote.values[rule.remote] ?? null, rf, lf, {}, s.resolver);
        if (v !== UNMAPPABLE && v !== null && v !== '')
          local = await this.ctx.sync.findBy(s.profile.entity, rule.local, v, {
            containerId: s.profile.containerId,
          });
        if (local) {
          out.actions.push('link');
          snapshot = {};
        }
      }
    }
    if (!local) {
      if (!s.profile.createLocal) {
        out.actions.push('skip');
        out.notes.push('not_linked');
        return;
      }
      out.actions.push('create');
      for (const row of s.rows) {
        if (!row.pullCreate) continue;
        const rv = remoteValue(remote, row);
        if (rv === null || rv === '') continue;
        const v = await toLocal(rv, row.rf, row.lf, row.m, s.resolver);
        if (v === UNMAPPABLE) {
          out.notes.push(row.lf.type === 'parent' ? 'parent_unlinked' : `unmappable:${row.m.local}`);
          continue;
        }
        out.changes.push({
          field: row.m.local,
          remoteField: row.m.remote,
          direction: 'pull',
          before: null,
          after: display(row.lf.type, v),
        });
      }
      return;
    }
    out.localId = local.id;
    out.localTitle = local.ref ?? local.title;
    const open =
      link?.state === 'conflict'
        ? (
            await this.ctx.db
              .select()
              .from(conflicts)
              .where(and(eq(conflicts.linkId, link.id), eq(conflicts.status, 'open')))
          )[0]
        : undefined;
    const plan = await planMerge(s, snapshot, local, remote, open?.fields ?? []);
    for (const c of plan.changes)
      out.changes.push({
        field: c.row.m.local,
        remoteField: c.row.m.remote,
        direction: c.direction,
        before: display(c.direction === 'push' ? c.row.rf.type : c.row.lf.type, c.before),
        after: display(c.direction === 'push' ? c.row.rf.type : c.row.lf.type, c.after),
      });
    if (Object.keys(plan.localWrites).length) out.actions.push('update');
    if (plan.pushed.length) out.actions.push('push');
    if (plan.conflicts.length) out.actions.push('conflict');
    if (plan.parentPending) out.notes.push('parent_unlinked');
    for (const field of plan.unmapped) out.notes.push(`unmappable:${field}`);
    if (!out.actions.length) {
      out.actions.push('skip');
      out.notes.push('unchanged');
    }
  }

  private async previewLocal(s: Session, saved: boolean): Promise<PreviewOut> {
    const page = await this.ctx.sync.list(s.profile.entity, {
      containerId: s.profile.containerId,
      limit: LIMITS.previewItems,
    });
    const items = [];
    for (const local of page.items) {
      const out: PreviewOut['items'][number] = {
        remoteId: null,
        remoteRef: null,
        remoteUrl: null,
        title: local.title,
        localId: local.id,
        localTitle: local.ref ?? local.title,
        actions: [],
        notes: [],
        changes: [],
        error: null,
      };
      const [link] = saved
        ? await this.ctx.db
            .select()
            .from(links)
            .where(and(eq(links.profileId, s.profile.id), eq(links.localId, local.id)))
        : [];
      if (link) {
        out.remoteId = link.remoteId;
        out.remoteRef = link.remoteRef;
        for (const row of s.rows) {
          if (!row.push) continue;
          const snap = link.snapshot[row.m.local];
          const now = local.values[row.m.local] ?? null;
          if (snap && JSON.stringify(snap.l ?? null) === JSON.stringify(now)) continue;
          const sent = await toRemote(now, row.lf, row.rf, row.m, s.resolver);
          if (sent === UNMAPPABLE) continue;
          out.changes.push({
            field: row.m.local,
            remoteField: row.m.remote,
            direction: 'push',
            before: display(row.rf.type, snap?.r ?? null),
            after: display(row.rf.type, sent),
          });
        }
        out.actions.push(out.changes.length ? 'push' : 'skip');
        if (!out.changes.length) out.notes.push('unchanged');
      } else if (!s.profile.createRemote) {
        out.actions.push('skip');
        out.notes.push('not_linked');
      } else if (!matchesFilter(s.profile.pushFilter, local.values)) {
        out.actions.push('skip');
        out.notes.push('filtered');
      } else {
        out.actions.push('remoteCreate');
        for (const row of s.rows) {
          if (!row.pushCreate) continue;
          const v = local.values[row.m.local] ?? null;
          if (v === null || v === '') continue;
          const sent = await toRemote(v, row.lf, row.rf, row.m, s.resolver);
          if (sent === UNMAPPABLE) continue;
          out.changes.push({
            field: row.m.local,
            remoteField: row.m.remote,
            direction: 'push',
            before: null,
            after: display(row.rf.type, sent),
          });
        }
      }
      items.push(out);
    }
    return { source: 'local', items, hasMore: Boolean(page.next) };
  }
}
