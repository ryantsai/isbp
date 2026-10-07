/**
 * Per-record sync (docs/architecture.md §12.3): pull one remote record, push one local record, sync their
 * comments, mark orphans. Every record is handled under a short lock (pulls, pushes, webhooks and people
 * take turns), and its local write, link and snapshot commit in one transaction whose link update checks
 * the link's `rev` (optimistic concurrency with anything that slipped past the lock).
 */
import { type Db, ErrorCodes, HttpError, type RemoteRecord, type SyncRecord } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { decideField, newerSide, sameValue, type Snapshot } from '../merge';
import { type CountKey, isEmpty, type LogRef, matchesFilter, safeHttpUrl } from '../model';
import {
  display,
  escapeHtml,
  htmlToMarkdown,
  markdownToHtml,
  toLocal,
  toRemote,
  UNMAPPABLE,
} from './convert';
import { withLock } from './lock';
import { holdersOf } from './people';
import { MANAGE } from './access';
import { commentLinks, type ConflictFieldRow, conflicts, links } from './schema';
import { type LinkRow, type Row, remoteValue, type Session, sourceOf } from './session';

/** What happened to one record. */
export type Outcome =
  | 'skipped'
  | 'unchanged'
  | 'linked'
  | 'created'
  | 'updated'
  | 'pushed'
  | 'remoteCreated'
  | 'conflict'
  | 'orphaned'
  | 'deferred'
  | 'filtered';

/** The link changed under us: reload and try again. */
class StaleLink extends Error {}

const UNMAPPED_MARK = { unmappable: true };

/** Errors that stop a whole run instead of one item. */
export function isFatal(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true;
  return (
    err instanceof HttpError &&
    (err.code === ErrorCodes.REMOTE_RATE_LIMITED || err.code === ErrorCodes.REMOTE_AUTH_FAILED)
  );
}

export const errorInfo = (err: unknown) =>
  err instanceof HttpError
    ? {
        code: err.code,
        message: err.message.slice(0, 2_000),
        ...(err.details !== undefined ? { details: err.details } : {}),
      }
    : {
        code: ErrorCodes.INTERNAL,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 2_000),
      };

const lockKey = (s: Session, side: 'r' | 'l', id: string) =>
  `lock:${s.profile.id}:${side}:${id.replace(/[^\w:.@/+=-]/g, '_').slice(0, 200)}`;

const refOf = (
  remote: Pick<RemoteRecord, 'ref' | 'title'> | null,
  local?: Pick<SyncRecord, 'ref' | 'title'> | null,
  linkId?: string,
): LogRef => ({
  ...(remote ? { remote: remote.ref } : {}),
  ...(local ? { local: local.ref ?? local.title } : {}),
  ...(linkId ? { linkId } : {}),
});

function count(s: Session, key: CountKey) {
  s.log.count(key);
}

async function findByRemote(s: Session, remoteId: string): Promise<LinkRow | null> {
  const [l] = await s.ctx.db
    .select()
    .from(links)
    .where(and(eq(links.profileId, s.profile.id), eq(links.remoteId, remoteId)));
  return l ?? null;
}

export async function findByLocal(s: Session, localId: string): Promise<LinkRow | null> {
  const [l] = await s.ctx.db
    .select()
    .from(links)
    .where(and(eq(links.profileId, s.profile.id), eq(links.localId, localId)));
  return l ?? null;
}

async function openConflictOf(db: Db, linkId: string) {
  const [c] = await db
    .select()
    .from(conflicts)
    .where(and(eq(conflicts.linkId, linkId), eq(conflicts.status, 'open')));
  return c ?? null;
}

/* ───────────────────────────── planning (no writes) ───────────────────────────── */

export interface PlannedChange {
  row: Row;
  direction: 'pull' | 'push' | 'conflict';
  before: unknown;
  after: unknown;
}

export interface MergePlan {
  localWrites: Record<string, unknown>;
  remoteWrites: Record<string, unknown>;
  pushed: { row: Row; local: unknown; sent: unknown }[];
  conflicts: ConflictFieldRow[];
  /** Fields of an open conflict, with refreshed current values. */
  refreshed: ConflictFieldRow[];
  snap: Snapshot;
  changes: PlannedChange[];
  /** A `parent` field waits for its parent to be linked. */
  parentPending: string | null;
  /** Log lines (English) about fields that were skipped. */
  notes: string[];
  /** The skipped fields' keys (for previews). */
  unmapped: string[];
}

/** Decides every mapped field of a linked pair. Reads only. */
export async function planMerge(
  s: Session,
  snapshot: Snapshot,
  local: SyncRecord,
  remote: RemoteRecord,
  openFields: ConflictFieldRow[] = [],
): Promise<MergePlan> {
  const plan: MergePlan = {
    localWrites: {},
    remoteWrites: {},
    pushed: [],
    conflicts: [],
    refreshed: [],
    snap: { ...snapshot },
    changes: [],
    parentPending: null,
    notes: [],
    unmapped: [],
  };
  const open = new Map(openFields.map((f) => [f.field, f]));
  const newer = newerSide(local.updatedAt, remote.updatedAt);
  for (const row of s.rows) {
    if (!row.pull && !row.push) continue;
    // The other system didn't report this field for this record (e.g. fields of a product type it only
    // returns from another endpoint): unknown, not empty, so neither side is filled from it.
    if (!(row.m.remote in remote.values) && row.rf.type !== 'parent') continue;
    const key = row.m.local;
    const localNow = local.values[key] ?? null;
    const remoteNow = remoteValue(remote, row);
    const converted = await toLocal(remoteNow, row.rf, row.lf, row.m, s.resolver);
    const pending = open.get(key);
    if (pending) {
      // Waiting for a person: keep the base, refresh what each side holds now.
      plan.refreshed.push({
        ...pending,
        local: localNow,
        remote: converted === UNMAPPABLE ? display(row.rf.type, remoteNow) : converted,
      });
      continue;
    }
    const d = decideField({
      localType: row.lf.type,
      remoteType: row.rf.type,
      snap: snapshot[key],
      local: localNow,
      remote: remoteNow,
      remoteAsLocal: converted === UNMAPPABLE ? UNMAPPED_MARK : converted,
      canPull: row.pull,
      canPush: row.push,
      policy: s.profile.conflictPolicy,
      newer,
    });
    switch (d.action) {
      case 'same':
      case 'ignore':
        if (d.snap) plan.snap[key] = d.snap;
        break;
      case 'pull':
        if (converted === UNMAPPABLE) {
          if (row.lf.type === 'parent' && !isEmpty(remoteNow)) plan.parentPending = String(remoteNow);
          else {
            plan.notes.push(unmappableNote(row, remoteNow, 'pull'));
            plan.unmapped.push(key);
          }
          break;
        }
        plan.localWrites[key] = converted;
        plan.snap[key] = { l: converted, r: remoteNow };
        plan.changes.push({ row, direction: 'pull', before: localNow, after: converted });
        break;
      case 'push': {
        const sent = await toRemote(localNow, row.lf, row.rf, row.m, s.resolver);
        if (sent === UNMAPPABLE) {
          plan.notes.push(unmappableNote(row, localNow, 'push'));
          plan.unmapped.push(key);
          break;
        }
        plan.remoteWrites[row.m.remote] = sent;
        plan.pushed.push({ row, local: localNow, sent });
        plan.changes.push({ row, direction: 'push', before: remoteNow, after: sent });
        break;
      }
      case 'conflict': {
        const remoteLocal = converted === UNMAPPABLE ? display(row.rf.type, remoteNow) : converted;
        plan.conflicts.push({
          field: key,
          remoteField: row.m.remote,
          label: row.lf.label,
          type: row.lf.type,
          base: snapshot[key]?.l ?? null,
          local: localNow,
          remote: remoteLocal,
        });
        plan.changes.push({ row, direction: 'conflict', before: localNow, after: remoteLocal });
        break;
      }
    }
  }
  return plan;
}

function unmappableNote(row: Row, value: unknown, way: 'pull' | 'push'): string {
  const shown = display(way === 'pull' ? row.rf.type : row.lf.type, value);
  const v = typeof shown === 'string' ? shown : JSON.stringify(shown);
  switch (way === 'pull' ? row.lf.type : row.rf.type) {
    case 'user':
      return `${row.m.local}: no ${way === 'pull' ? 'ISBP user' : 'email'} for ${v}; field skipped`;
    case 'choice':
      return `${row.m.local}: "${v}" has no matching choice; add it to the value map. Field skipped`;
    case 'parent':
      return `${row.m.local}: the parent is not linked; field skipped`;
    default:
      return `${row.m.local}: "${v}" can't be converted; field skipped`;
  }
}

/* ───────────────────────────── pull side ───────────────────────────── */

export interface PullOptions {
  /** Process even when the remote version is the one we already have. */
  force?: boolean;
  /** Parent-depth guard for "sync the parent first". */
  depth?: number;
}

/** Handles one remote record (from the change feed, a webhook or a resync). */
export function pullRecord(s: Session, remote: RemoteRecord, opts: PullOptions = {}): Promise<Outcome> {
  return withLock(s.ctx.cache, lockKey(s, 'r', remote.id), async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const outcome = await pullLocked(s, remote, opts);
        s.consecutiveErrors = 0;
        return outcome;
      } catch (err) {
        if (err instanceof StaleLink && attempt < 3) continue;
        throw err;
      }
    }
  });
}

async function pullLocked(s: Session, remote: RemoteRecord, opts: PullOptions): Promise<Outcome> {
  let link = await findByRemote(s, remote.id);
  const ref = refOf(remote, null, link?.id);
  if (remote.deleted) {
    if (link?.localId) await orphan(s, link, 'remote');
    else count(s, 'skipped');
    return 'orphaned';
  }
  if (link?.state === 'orphaned') {
    count(s, 'skipped');
    return 'skipped';
  }
  if (link?.localId && !opts.force && link.state === 'ok' && link.remoteVersion === remote.version) {
    count(s, 'skipped');
    return 'skipped';
  }

  if (!link?.localId) {
    if (s.profile.matchRule) {
      const found = await matchLocal(s, remote);
      if (found) {
        const other = await findByLocal(s, found.id);
        if (other && other.id !== link?.id) {
          s.log.warn(
            `${remote.ref} matches ${found.ref ?? found.title}, which is already linked to ${other.remoteRef ?? other.remoteId}; not linked`,
            ref,
          );
          count(s, 'skipped');
          return 'skipped';
        }
        link = await linkMatched(s, remote, found, link);
        count(s, 'linked');
        s.log.info(`Linked ${remote.ref} to ${found.ref ?? found.title}`, refOf(remote, found, link.id));
        await mergeLinked(s, link, found, remote, opts, 0);
        await syncComments(s, link);
        return 'linked';
      }
    }
    if (!s.profile.createLocal || s.profile.direction === 'push') {
      count(s, 'skipped');
      return 'skipped';
    }
    return createLocal(s, remote, link, opts);
  }

  const local = await s.ctx.sync.read(s.profile.entity, link.localId);
  if (!local) {
    await orphan(s, link, 'local');
    return 'orphaned';
  }
  const outcome = await mergeLinked(s, link, local, remote, opts, 0);
  if (outcome !== 'deferred') await syncComments(s, (await findByRemote(s, remote.id)) ?? link);
  return outcome;
}

/** The local record the match rule points at (`findBy` on a natural key). */
async function matchLocal(s: Session, remote: RemoteRecord): Promise<SyncRecord | null> {
  const rule = s.profile.matchRule!;
  const lf = s.localFields.find((f) => f.key === rule.local);
  const rf = s.remoteFields.find((f) => f.key === rule.remote);
  if (!lf || !rf) return null;
  const mapping = s.profile.mappings.find((m) => m.local === rule.local && m.remote === rule.remote) ?? {};
  const value = await toLocal(remote.values[rule.remote] ?? null, rf, lf, mapping, s.resolver);
  if (value === UNMAPPABLE || isEmpty(value)) return null;
  return s.ctx.sync.findBy(s.profile.entity, rule.local, value, { containerId: s.profile.containerId });
}

const remoteColumns = (remote: RemoteRecord) => ({
  remoteRef: remote.ref.slice(0, 200),
  remoteTitle: remote.title.slice(0, 500),
  remoteUrl: safeHttpUrl(remote.url),
  remoteUpdatedAt: Number.isNaN(Date.parse(remote.updatedAt)) ? null : new Date(remote.updatedAt),
});

const localColumns = (local: SyncRecord) => ({
  localRef: local.ref?.slice(0, 100) ?? null,
  localTitle: local.title.slice(0, 500),
});

/**
 * Links an existing local record instead of creating a duplicate. The snapshot starts empty: the merge
 * that follows fills empty fields on either side and treats differing values by the conflict policy.
 */
async function linkMatched(
  s: Session,
  remote: RemoteRecord,
  local: SyncRecord,
  existing: LinkRow | null,
): Promise<LinkRow> {
  const values = {
    localId: local.id,
    ...localColumns(local),
    ...remoteColumns(remote),
    remoteVersion: null,
    origin: 'matched' as const,
    snapshot: {},
    state: 'ok' as const,
    lastError: null,
  };
  if (existing) {
    const [row] = await s.ctx.db
      .update(links)
      .set({ ...values, rev: existing.rev + 1 })
      .where(and(eq(links.id, existing.id), eq(links.rev, existing.rev)))
      .returning();
    if (!row) throw new StaleLink();
    return row;
  }
  const [row] = await s.ctx.db
    .insert(links)
    .values({
      profileId: s.profile.id,
      connectionId: s.connection.id,
      entity: s.profile.entity,
      remoteId: remote.id,
      ...values,
    })
    .returning();
  return row!;
}

/** The record's parent (remote id) isn't linked yet: sync it first (up to 3 levels). */
async function syncParentFirst(s: Session, remoteParentId: string, depth: number): Promise<boolean> {
  if (depth >= 3) return false;
  const parent = await s.conn.get(s.profile.objectType, remoteParentId, { scope: s.profile.remoteScope });
  if (!parent || parent.deleted) return false;
  count(s, 'read');
  const outcome = await pullRecord(s, parent, { depth: depth + 1 });
  return outcome !== 'skipped' && outcome !== 'orphaned' && outcome !== 'deferred'
    ? true
    : Boolean(await s.resolver.localParent(remoteParentId));
}

async function createLocal(
  s: Session,
  remote: RemoteRecord,
  errorLink: LinkRow | null,
  opts: PullOptions,
): Promise<Outcome> {
  const values: Record<string, unknown> = {};
  const snap: Snapshot = {};
  for (const row of s.rows) {
    if (!row.pullCreate) continue;
    const rv = remoteValue(remote, row);
    if (isEmpty(rv)) continue;
    let v = await toLocal(rv, row.rf, row.lf, row.m, s.resolver);
    if (v === UNMAPPABLE && row.lf.type === 'parent') {
      if (s.deferParents) return 'deferred';
      if (await syncParentFirst(s, String(rv), opts.depth ?? 0))
        v = await toLocal(rv, row.rf, row.lf, row.m, s.resolver);
    }
    if (v === UNMAPPABLE) {
      s.log.warn(`${remote.ref}: ${unmappableNote(row, rv, 'pull')}`, refOf(remote));
      continue;
    }
    values[row.m.local] = v;
    snap[row.m.local] = { l: v, r: rv };
  }
  const link = await s.ctx.transaction(async (tx) => {
    const { id, record } = await s.ctx.sync.write(
      s.profile.entity,
      { containerId: s.profile.containerId, values },
      { auth: s.agent, tx, source: sourceOf(s, remote) },
    );
    agreeOnStored(snap, Object.keys(values), record);
    const columns = {
      localId: id,
      ...remoteColumns(remote),
      remoteVersion: remote.version,
      origin: 'remote' as const,
      snapshot: snap,
      state: 'ok' as const,
      lastError: null,
      lastSyncedAt: new Date(),
    };
    if (errorLink) {
      const [row] = await tx
        .update(links)
        .set({ ...columns, rev: errorLink.rev + 1 })
        .where(and(eq(links.id, errorLink.id), eq(links.rev, errorLink.rev)))
        .returning();
      if (!row) throw new StaleLink();
      return row;
    }
    const [row] = await tx
      .insert(links)
      .values({
        profileId: s.profile.id,
        connectionId: s.connection.id,
        entity: s.profile.entity,
        remoteId: remote.id,
        ...columns,
      })
      .returning();
    return row!;
  });
  // Fields we didn't write (defaults, push-only ones): agree on them when the remote side has a value, so a
  // default never overwrites it; leave them open when it's empty, so ISBP's value is pushed.
  const local = await s.ctx.sync.read(s.profile.entity, link.localId!);
  let current = link;
  if (local) {
    const fill: Snapshot = {};
    for (const row of s.rows) {
      if (row.m.local in snap) continue;
      const rv = remoteValue(remote, row);
      if (!isEmpty(rv)) fill[row.m.local] = { l: local.values[row.m.local] ?? null, r: rv };
    }
    const [row] = await s.ctx.db
      .update(links)
      .set({ snapshot: { ...snap, ...fill }, ...localColumns(local), rev: link.rev + 1 })
      .where(and(eq(links.id, link.id), eq(links.rev, link.rev)))
      .returning();
    if (row) current = row;
  }
  count(s, 'created');
  s.log.info(
    `Created ${local?.ref ?? local?.title ?? link.localId} from ${remote.ref}`,
    refOf(remote, local, link.id),
  );
  await syncComments(s, current);
  return 'created';
}

/** Three-way merge of a linked pair: pushes first (with the version just read), then the local write. */
async function mergeLinked(
  s: Session,
  link: LinkRow,
  local: SyncRecord,
  remote: RemoteRecord,
  opts: PullOptions,
  attempt: number,
): Promise<Outcome> {
  const open = link.state === 'conflict' ? await openConflictOf(s.ctx.db, link.id) : null;
  let plan = await planMerge(s, link.snapshot, local, remote, open?.fields ?? []);
  if (plan.parentPending) {
    if (s.deferParents) return 'deferred';
    if (await syncParentFirst(s, plan.parentPending, opts.depth ?? 0))
      plan = await planMerge(s, link.snapshot, local, remote, open?.fields ?? []);
  }
  const ref = refOf(remote, local, link.id);
  for (const note of plan.notes) s.log.warn(`${remote.ref}: ${note}`, ref);
  if (plan.parentPending)
    s.log.warn(`${remote.ref}: the parent ${plan.parentPending} is not linked; field skipped`, ref);

  let after = remote;
  if (plan.pushed.length) {
    try {
      after = await s.conn.update(s.profile.objectType, remote.id, plan.remoteWrites, {
        expectedVersion: remote.version,
        scope: s.profile.remoteScope,
      });
    } catch (err) {
      if (err instanceof HttpError && err.code === ErrorCodes.REMOTE_CONFLICT && attempt < 3) {
        const fresh = await s.conn.get(s.profile.objectType, remote.id, { scope: s.profile.remoteScope });
        if (!fresh || fresh.deleted) {
          await orphan(s, link, 'remote');
          return 'orphaned';
        }
        s.log.info(`${remote.ref} changed meanwhile; merging again`, ref);
        return mergeLinked(s, link, local, fresh, opts, attempt + 1);
      }
      throw err;
    }
    for (const p of plan.pushed) {
      const back = after.values[p.row.m.remote];
      plan.snap[p.row.m.local] = { l: p.local, r: back === undefined ? p.sent : back };
    }
  }

  const writes = Object.keys(plan.localWrites);
  const newConflict = plan.conflicts.length > 0;
  await s.ctx.transaction(async (tx) => {
    if (writes.length) {
      const { record } = await s.ctx.sync.write(
        s.profile.entity,
        { id: local.id, values: plan.localWrites },
        { auth: s.agent, tx, source: sourceOf(s, after) },
      );
      agreeOnStored(plan.snap, writes, record);
    }
    const [row] = await tx
      .update(links)
      .set({
        snapshot: plan.snap,
        remoteVersion: after.version,
        ...remoteColumns(after),
        ...localColumns(local),
        state: newConflict || open ? 'conflict' : 'ok',
        lastError: null,
        lastSyncedAt: new Date(),
        rev: link.rev + 1,
      })
      .where(and(eq(links.id, link.id), eq(links.rev, link.rev)))
      .returning({ id: links.id });
    if (!row) throw new StaleLink();
    if (newConflict || (open && plan.refreshed.length))
      await saveConflict(s, tx, link, local, after, plan, open);
  });

  if (writes.length) {
    count(s, 'updated');
    s.log.info(`Updated ${local.ref ?? local.title} from ${remote.ref}: ${writes.join(', ')}`, ref);
  }
  if (plan.pushed.length) {
    count(s, 'pushed');
    s.log.info(`Pushed ${plan.pushed.map((p) => p.row.m.local).join(', ')} to ${after.ref}`, ref);
  }
  if (newConflict) {
    count(s, 'conflicts');
    s.log.warn(`Conflict on ${plan.conflicts.map((c) => c.field).join(', ')} (${after.ref})`, ref);
  }
  if (!writes.length && !plan.pushed.length && !newConflict) {
    count(s, 'skipped');
    return 'unchanged';
  }
  return newConflict ? 'conflict' : writes.length ? 'updated' : 'pushed';
}

/**
 * After a local write, the snapshot holds what the module stored (it may normalize: a default note, a status
 * named for the record's type), so that difference isn't mistaken for a change made in ISBP and pushed back.
 */
export function agreeOnStored(snap: Snapshot, keys: readonly string[], record: SyncRecord | null) {
  if (!record) return;
  for (const k of keys) {
    const entry = snap[k];
    if (entry && k in record.values) snap[k] = { l: record.values[k] ?? null, r: entry.r };
  }
}

async function saveConflict(
  s: Session,
  tx: Db,
  link: LinkRow,
  local: SyncRecord,
  remote: RemoteRecord,
  plan: MergePlan,
  open: typeof conflicts.$inferSelect | null,
) {
  if (open) {
    const merged = new Map(open.fields.map((f) => [f.field, f]));
    for (const f of [...plan.refreshed, ...plan.conflicts]) merged.set(f.field, f);
    await tx
      .update(conflicts)
      .set({ fields: [...merged.values()], remoteRef: remote.ref })
      .where(eq(conflicts.id, open.id));
    return;
  }
  const [row] = await tx
    .insert(conflicts)
    .values({
      linkId: link.id,
      profileId: s.profile.id,
      connectionId: s.connection.id,
      entity: s.profile.entity,
      localId: local.id,
      remoteRef: remote.ref,
      status: 'open',
      fields: plan.conflicts,
    })
    .returning();
  const payload = {
    conflictId: row!.id,
    linkId: link.id,
    profileId: s.profile.id,
    connectionId: s.connection.id,
    entity: s.profile.entity,
    localId: local.id,
    remoteRef: remote.ref,
    fields: plan.conflicts.map((c) => c.field),
  };
  await s.ctx.audit.record(
    {
      action: 'integrations.conflict.created',
      entityType: 'integrations.conflict',
      entityId: row!.id,
      entityLabel: `${local.ref ?? local.title} ↔ ${remote.ref}`,
      metadata: { fields: payload.fields, connectionId: s.connection.id },
    },
    { tx },
  );
  await s.ctx.events.publish('integrations.conflict.created', payload, { tx });
  // One notice per profile per hour, so a burst of conflicts doesn't flood anyone.
  if ((await s.ctx.cache.increment(`notify:conflict:${s.profile.id}`, 3_600)) === 1) {
    await s.ctx.notifications.notify(
      {
        type: 'integrations.conflict.created',
        recipients: await holdersOf(s.ctx, MANAGE),
        params: { profile: s.profile.name, record: local.ref ?? local.title, remote: remote.ref },
        href: `/integrations/conflicts?conflict=${row!.id}`,
      },
      { tx },
    );
  }
}

/** A record deleted on one side: the link stays, marked `orphaned`; nothing is deleted on the other side. */
export async function orphan(s: Session, link: LinkRow, side: 'remote' | 'local') {
  if (link.state === 'orphaned') return;
  await s.ctx.db
    .update(links)
    .set({ state: 'orphaned', lastSyncedAt: new Date(), rev: link.rev + 1 })
    .where(eq(links.id, link.id));
  count(s, 'skipped');
  s.log.warn(
    side === 'remote'
      ? `${link.remoteRef ?? link.remoteId} was deleted in ${s.connection.name}; the ISBP record is kept`
      : `${link.localRef ?? link.localTitle ?? link.localId} was deleted in ISBP; ${link.remoteRef ?? link.remoteId} is kept`,
    {
      remote: link.remoteRef ?? undefined,
      local: link.localRef ?? link.localTitle ?? undefined,
      linkId: link.id,
    },
  );
}

/* ───────────────────────────── push side ───────────────────────────── */

/** Pushes one local record (a change event, an export, a resync). */
export async function pushRecord(
  s: Session,
  localId: string,
  opts: { depth?: number } = {},
): Promise<Outcome> {
  if (s.profile.direction === 'pull') {
    count(s, 'skipped');
    return 'skipped';
  }
  const link = await findByLocal(s, localId);
  if (link)
    return withLock(s.ctx.cache, lockKey(s, 'r', link.remoteId), async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const fresh = await findByLocal(s, localId);
          if (!fresh) return 'skipped';
          return await pushLinked(s, fresh);
        } catch (err) {
          if (err instanceof StaleLink && attempt < 3) continue;
          throw err;
        }
      }
    });
  return withLock(s.ctx.cache, lockKey(s, 'l', localId), async () => {
    const again = await findByLocal(s, localId);
    if (again) return pushLinked(s, again);
    return createRemote(s, localId, opts.depth ?? 0);
  });
}

async function pushLinked(s: Session, link: LinkRow): Promise<Outcome> {
  if (link.state === 'orphaned' || !link.localId) return 'skipped';
  const local = await s.ctx.sync.read(s.profile.entity, link.localId);
  if (!local) {
    await orphan(s, link, 'local');
    return 'orphaned';
  }
  const ref = refOf({ ref: link.remoteRef ?? link.remoteId, title: link.remoteTitle ?? '' }, local, link.id);
  const open = link.state === 'conflict' ? await openConflictOf(s.ctx.db, link.id) : null;
  const pending = new Set(open?.fields.map((f) => f.field) ?? []);
  const writes: Record<string, unknown> = {};
  const pushed: { row: Row; local: unknown; sent: unknown }[] = [];
  for (const row of s.rows) {
    if (!row.push || pending.has(row.m.local)) continue;
    const snap = link.snapshot[row.m.local];
    const now = local.values[row.m.local] ?? null;
    const changed = snap ? !sameLocal(row, now, snap.l) : !isEmpty(now);
    if (!changed) continue;
    const sent = await toRemote(now, row.lf, row.rf, row.m, s.resolver);
    if (sent === UNMAPPABLE) {
      s.log.warn(`${local.ref ?? local.title}: ${unmappableNote(row, now, 'push')}`, ref);
      continue;
    }
    writes[row.m.remote] = sent;
    pushed.push({ row, local: now, sent });
  }
  if (!pushed.length) {
    count(s, 'skipped');
    await syncComments(s, link);
    return 'unchanged';
  }
  let after: RemoteRecord;
  try {
    after = await s.conn.update(s.profile.objectType, link.remoteId, writes, {
      expectedVersion: link.remoteVersion,
      scope: s.profile.remoteScope,
    });
  } catch (err) {
    if (err instanceof HttpError && err.code === ErrorCodes.REMOTE_CONFLICT) {
      const fresh = await s.conn.get(s.profile.objectType, link.remoteId, { scope: s.profile.remoteScope });
      if (!fresh || fresh.deleted) {
        await orphan(s, link, 'remote');
        return 'orphaned';
      }
      s.log.info(`${fresh.ref} changed in ${s.connection.name}; merging`, ref);
      count(s, 'read');
      const outcome = await mergeLinked(s, link, local, fresh, {}, 1);
      await syncComments(s, (await findByLocal(s, local.id)) ?? link);
      return outcome;
    }
    throw err;
  }
  const snap = { ...link.snapshot };
  for (const p of pushed) {
    const back = after.values[p.row.m.remote];
    snap[p.row.m.local] = { l: p.local, r: back === undefined ? p.sent : back };
  }
  const [row] = await s.ctx.db
    .update(links)
    .set({
      snapshot: snap,
      remoteVersion: after.version,
      ...remoteColumns(after),
      ...localColumns(local),
      state: open ? 'conflict' : 'ok',
      lastError: null,
      lastSyncedAt: new Date(),
      rev: link.rev + 1,
    })
    .where(and(eq(links.id, link.id), eq(links.rev, link.rev)))
    .returning();
  if (!row) throw new StaleLink();
  count(s, 'pushed');
  s.log.info(
    `Pushed ${pushed.map((p) => p.row.m.local).join(', ')} of ${local.ref ?? local.title} to ${after.ref}`,
    ref,
  );
  await syncComments(s, row);
  return 'pushed';
}

function sameLocal(row: Row, a: unknown, b: unknown) {
  return sameValue(row.lf.type, a, b);
}

/** Creates the remote record for an unlinked local one (profile allows it and the push filter matches). */
async function createRemote(s: Session, localId: string, depth: number): Promise<Outcome> {
  const skip = (o: Outcome) => {
    count(s, 'skipped');
    return o;
  };
  if (!s.profile.createRemote) return skip('skipped');
  const local = await s.ctx.sync.read(s.profile.entity, localId);
  if (!local) return skip('skipped');
  if (s.profile.containerId && local.containerId && local.containerId !== s.profile.containerId)
    return skip('filtered');
  if (!matchesFilter(s.profile.pushFilter, local.values)) return skip('filtered');
  const values: Record<string, unknown> = {};
  let parentId: string | null = null;
  for (const row of s.rows) {
    if (!row.pushCreate) continue;
    const v = local.values[row.m.local] ?? null;
    if (isEmpty(v)) continue;
    let sent = await toRemote(v, row.lf, row.rf, row.m, s.resolver);
    if (sent === UNMAPPABLE && row.rf.type === 'parent' && depth < 3) {
      // Push the parent first.
      const outcome = await pushRecord(s, String(v), { depth: depth + 1 });
      if (outcome === 'remoteCreated' || outcome === 'pushed' || outcome === 'unchanged')
        sent = await toRemote(v, row.lf, row.rf, row.m, s.resolver);
    }
    if (sent === UNMAPPABLE) {
      s.log.warn(`${local.ref ?? local.title}: ${unmappableNote(row, v, 'push')}`, refOf(null, local));
      continue;
    }
    if (row.rf.type === 'parent') parentId = String(sent);
    values[row.m.remote] = sent;
  }
  const created = await s.conn.create(s.profile.objectType, values, {
    scope: s.profile.remoteScope,
    parentId,
  });
  const snap: Snapshot = {};
  for (const row of s.rows) {
    if (!row.pull && !row.push) continue;
    snap[row.m.local] = { l: local.values[row.m.local] ?? null, r: remoteValue(created, row) };
  }
  const [link] = await s.ctx.db
    .insert(links)
    .values({
      profileId: s.profile.id,
      connectionId: s.connection.id,
      entity: s.profile.entity,
      localId: local.id,
      ...localColumns(local),
      remoteId: created.id,
      ...remoteColumns(created),
      remoteVersion: created.version,
      origin: 'local',
      snapshot: snap,
      state: 'ok',
      lastSyncedAt: new Date(),
    })
    .returning();
  count(s, 'remoteCreated');
  s.log.info(
    `Created ${created.ref} in ${s.connection.name} from ${local.ref ?? local.title}`,
    refOf(created, local, link!.id),
  );
  await syncComments(s, link!);
  return 'remoteCreated';
}

/* ───────────────────────────── comments ───────────────────────────── */

/** A comment was added locally: sync the record's comments (or create the remote record when unlinked). */
export async function pushComments(s: Session, localId: string): Promise<Outcome> {
  const link = await findByLocal(s, localId);
  if (!link) return pushRecord(s, localId);
  await withLock(s.ctx.cache, lockKey(s, 'r', link.remoteId), async () => {
    const fresh = await findByLocal(s, localId);
    if (fresh) await syncComments(s, fresh);
  });
  return 'unchanged';
}

/**
 * Append-only, both ways, each comment once (`comment_links`). Comments older than the link are left alone
 * unless the record was created by the sync (then its history comes along). Internal notes stay internal.
 */
export async function syncComments(s: Session, link: LinkRow) {
  if (!s.comments || s.dryRun || !link.localId || link.state === 'orphaned') return;
  const pull = s.profile.direction !== 'push';
  const push = s.profile.direction !== 'pull';
  const [localList, remoteList, existing] = await Promise.all([
    s.ctx.sync.comments.list(s.profile.entity, link.localId),
    s.conn.comments.list(s.profile.objectType, link.remoteId, { scope: s.profile.remoteScope }),
    s.ctx.db.select().from(commentLinks).where(eq(commentLinks.linkId, link.id)),
  ]);
  // Copies: an adapter may hand out live lists, and we add to both sides below.
  const localBefore = [...localList];
  const remoteBefore = [...remoteList];
  const seenRemote = new Set(existing.map((c) => c.remoteId));
  const seenLocal = new Set(existing.map((c) => c.localId));
  const since = link.createdAt.getTime();
  const byTime = <T extends { createdAt: string }>(a: T, b: T) =>
    Date.parse(a.createdAt) - Date.parse(b.createdAt);
  const ref = {
    remote: link.remoteRef ?? undefined,
    local: link.localRef ?? link.localTitle ?? undefined,
    linkId: link.id,
  };
  let pulled = 0;
  let pushedCount = 0;
  if (pull)
    for (const rc of remoteBefore.sort(byTime)) {
      if (seenRemote.has(rc.id)) continue;
      if (link.origin !== 'remote' && Date.parse(rc.createdAt) < since) continue;
      const body = rc.format === 'html' ? htmlToMarkdown(rc.body) : rc.body.trim();
      if (!body) continue;
      await s.ctx.transaction(async (tx) => {
        const { id } = await s.ctx.sync.comments.add(
          s.profile.entity,
          link.localId!,
          {
            body,
            authorName: rc.author.name || rc.author.email || s.connection.name,
            authorEmail: rc.author.email,
            createdAt: rc.createdAt,
            internal: rc.internal ?? false,
          },
          {
            auth: s.agent,
            tx,
            source: sourceOf(s, { ref: link.remoteRef ?? link.remoteId, url: link.remoteUrl }),
          },
        );
        await tx
          .insert(commentLinks)
          .values({ linkId: link.id, localId: id, remoteId: rc.id, origin: 'remote' });
        seenLocal.add(id);
      });
      seenRemote.add(rc.id);
      pulled++;
    }
  if (push)
    for (const lc of localBefore.sort(byTime)) {
      if (seenLocal.has(lc.id)) continue;
      if (link.origin !== 'local' && Date.parse(lc.createdAt) < since) continue;
      const html = markdownToHtml(lc.body);
      if (!html) continue;
      const rc = await s.conn.comments.add(
        s.profile.objectType,
        link.remoteId,
        {
          body: `<p><strong>${escapeHtml(lc.authorName)}</strong>:</p>${html}`,
          format: 'html',
          internal: lc.internal ?? false,
        },
        { scope: s.profile.remoteScope },
      );
      await s.ctx.db
        .insert(commentLinks)
        .values({ linkId: link.id, localId: lc.id, remoteId: rc.id, origin: 'local' })
        .onConflictDoNothing();
      seenLocal.add(lc.id);
      seenRemote.add(rc.id);
      pushedCount++;
    }
  if (pulled) s.log.info(`${pulled} comment(s) from ${link.remoteRef ?? link.remoteId}`, ref);
  if (pushedCount) s.log.info(`${pushedCount} comment(s) sent to ${link.remoteRef ?? link.remoteId}`, ref);
}

/* ───────────────────────────── errors on items ───────────────────────────── */

/**
 * An item failed (the adapter refused a write, the remote system rejected it): the link records it (state
 * `error`, retried by the next run), the run counts it, and the run carries on.
 */
export async function recordItemError(
  s: Session,
  err: unknown,
  item: { remote?: Pick<RemoteRecord, 'id' | 'ref' | 'title' | 'url'>; localId?: string },
) {
  const e = errorInfo(err);
  count(s, 'errors');
  s.consecutiveErrors++;
  let link: LinkRow | null = null;
  if (item.remote) link = await findByRemote(s, item.remote.id);
  else if (item.localId) link = await findByLocal(s, item.localId);
  if (link) {
    await s.ctx.db
      .update(links)
      .set({
        state: link.state === 'orphaned' ? 'orphaned' : 'error',
        lastError: e,
        lastSyncedAt: new Date(),
        rev: link.rev + 1,
      })
      .where(eq(links.id, link.id));
  } else if (item.remote) {
    // Not created yet: keep the remote record visible (and retried) as an error link without a local side.
    await s.ctx.db
      .insert(links)
      .values({
        profileId: s.profile.id,
        connectionId: s.connection.id,
        entity: s.profile.entity,
        localId: null,
        remoteId: item.remote.id,
        remoteRef: item.remote.ref.slice(0, 200),
        remoteTitle: item.remote.title.slice(0, 500),
        remoteUrl: safeHttpUrl(item.remote.url),
        origin: 'remote',
        state: 'error',
        lastError: e,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [links.profileId, links.remoteId],
        set: { state: 'error', lastError: e, lastSyncedAt: new Date() },
      });
  }
  const what = item.remote?.ref ?? link?.localRef ?? link?.localTitle ?? item.localId ?? '?';
  s.log.error(`${what}: ${e.message}${e.code !== ErrorCodes.INTERNAL ? ` (${e.code})` : ''}`, {
    ...(item.remote ? { remote: item.remote.ref } : {}),
    ...(link ? { linkId: link.id } : {}),
  });
}
