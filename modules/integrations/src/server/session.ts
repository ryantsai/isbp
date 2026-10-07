import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  type ModuleContext,
  type OpenConnector,
  type RemoteFieldDef,
  type RemoteRecord,
  type SyncEntityInfo,
  type SyncFieldDef,
  type SyncSource,
} from '@isbp/sdk/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { FieldMapping, ProfileDraft } from '../contracts';
import { effectiveDirections } from '../merge';
import type { ConnectorInfoDto } from '../contracts';
import { safeHttpUrl } from '../model';
import type { ConvertResolver } from './convert';
import { People } from './people';
import type { RunLog } from './runs';
import type { ConnectionRow, ConnectionService } from './connections';
import { connections, links, type profiles } from './schema';

export type ProfileRow = typeof profiles.$inferSelect;
export type LinkRow = typeof links.$inferSelect;

/** One mapping row with both fields and what it may do. */
export interface Row {
  m: FieldMapping;
  lf: SyncFieldDef;
  rf: RemoteFieldDef;
  /** On updates of linked records. */
  pull: boolean;
  push: boolean;
  /** When creating a record on that side. */
  pullCreate: boolean;
  pushCreate: boolean;
}

/** The profile's settings the engine reads (a saved row, or a draft for previews). */
export type ProfileLike = Pick<
  ProfileRow,
  | 'id'
  | 'connectionId'
  | 'objectType'
  | 'remoteScope'
  | 'entity'
  | 'containerId'
  | 'direction'
  | 'createLocal'
  | 'createRemote'
  | 'matchRule'
  | 'pushFilter'
  | 'mappings'
  | 'conflictPolicy'
  | 'comments'
  | 'cursor'
  | 'name'
>;

/**
 * Everything one sync of one profile needs: the bound connector, both field catalogues, the mapping rows,
 * the hub's agent identity and lookups. Built once per run (or preview).
 */
export interface Session {
  ctx: ModuleContext;
  profile: ProfileLike;
  connection: ConnectionRow;
  conn: OpenConnector;
  entity: SyncEntityInfo;
  object: ConnectorInfoDto['objects'][number];
  rows: Row[];
  localFields: SyncFieldDef[];
  remoteFields: RemoteFieldDef[];
  agent: AuthContext;
  people: People;
  resolver: ConvertResolver;
  /** Comments sync both ways for this pair (and the profile wants them). */
  comments: boolean;
  log: RunLog;
  /** A dry run: nothing is written (previews). */
  dryRun: boolean;
  /** Pull runs defer children whose parent isn't linked yet to the end of the run. */
  deferParents: boolean;
  signal?: AbortSignal;
  consecutiveErrors: number;
}

export function sourceOf(s: Session, remote: Pick<RemoteRecord, 'ref' | 'url'>): SyncSource {
  return {
    connectionId: s.connection.id,
    connectionName: s.connection.name,
    connector: s.connection.type,
    remoteRef: remote.ref,
    remoteUrl: safeHttpUrl(remote.url),
  };
}

/** The remote value a mapping reads (`parent` falls back to the record's `parentId`). */
export function remoteValue(remote: RemoteRecord, row: Row): unknown {
  const v = remote.values[row.m.remote];
  if (v === undefined && row.rf.type === 'parent') return remote.parentId ?? null;
  return v ?? null;
}

export const profileDraftRow = (
  d: ProfileDraft & { id?: string },
  cursor: string | null = null,
): ProfileLike => ({
  id: d.id ?? '00000000-0000-0000-0000-000000000000',
  connectionId: d.connectionId,
  objectType: d.objectType,
  remoteScope: d.remoteScope,
  entity: d.entity,
  containerId: d.containerId,
  direction: d.direction,
  createLocal: d.createLocal,
  createRemote: d.createRemote,
  matchRule: d.matchRule,
  pushFilter: d.pushFilter,
  mappings: d.mappings,
  conflictPolicy: d.conflictPolicy,
  comments: d.comments,
  cursor,
  name: d.name,
});

/** The sync entity, or 409 when its module is disabled or gone. */
export function entityOf(ctx: ModuleContext, entity: string): SyncEntityInfo {
  const e = ctx.sync.entities().find((x) => x.entity === entity);
  if (!e)
    throw new HttpError(
      409,
      ErrorCodes.MODULE_DISABLED,
      `${entity} can't be synced (its module is disabled or gone)`,
      {
        entity,
      },
    );
  return e;
}

export async function openSession(
  ctx: ModuleContext,
  connectionsService: ConnectionService,
  profile: ProfileLike,
  opts: {
    log: RunLog;
    dryRun?: boolean;
    deferParents?: boolean;
    signal?: AbortSignal;
    connection?: ConnectionRow;
  },
): Promise<Session> {
  const connection =
    opts.connection ??
    (await ctx.db.select().from(connections).where(eq(connections.id, profile.connectionId)))[0];
  if (!connection) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Connection not found');
  if (!connection.enabled && !opts.dryRun)
    throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The connection is disabled', {
      connectionId: connection.id,
    });
  const entity = entityOf(ctx, profile.entity);
  const conn = connectionsService.open(connection, opts.signal);
  const object = conn.info.objects.find((o) => o.type === profile.objectType);
  if (!object)
    throw new HttpError(
      404,
      ErrorCodes.NOT_FOUND,
      `${connection.type} has no object type ${profile.objectType}`,
    );
  const [localFields, remoteFields] = await Promise.all([
    ctx.sync.fields(profile.entity, { containerId: profile.containerId }),
    conn.fields(profile.objectType, profile.remoteScope),
  ]);
  const L = new Map(localFields.map((f) => [f.key, f]));
  const R = new Map(remoteFields.map((f) => [f.key, f]));
  const rows: Row[] = [];
  for (const m of profile.mappings) {
    const lf = L.get(m.local);
    const rf = R.get(m.remote);
    if (!lf || !rf) {
      opts.log.warn(
        `Mapping ${m.local} ↔ ${m.remote} skipped: ${!lf ? `ISBP has no field "${m.local}"` : `the remote object has no field "${m.remote}"`}`,
      );
      continue;
    }
    const update = effectiveDirections(profile.direction, m.direction, lf, rf, {
      remoteUpdatable: object.capabilities.update,
    });
    const create = effectiveDirections(profile.direction, m.direction, lf, rf, {
      remoteUpdatable: object.capabilities.update,
      onCreate: true,
    });
    rows.push({
      m,
      lf,
      rf,
      pull: update.canPull,
      push: update.canPush,
      pullCreate: create.canPull,
      pushCreate: create.canPush,
    });
  }
  const people = new People(ctx.db);
  const sameSide = and(
    eq(links.connectionId, connection.id),
    eq(links.entity, profile.entity),
    isNotNull(links.localId),
  );
  const resolver: ConvertResolver = {
    userIdByEmail: (email) => people.userIdByEmail(email),
    user: (id) => people.user(id),
    localParent: async (remoteId) => {
      const [l] = await ctx.db
        .select({ id: links.localId })
        .from(links)
        .where(and(sameSide, eq(links.remoteId, remoteId)))
        .limit(1);
      return l?.id ?? null;
    },
    remoteParent: async (localId) => {
      const [l] = await ctx.db
        .select({ id: links.remoteId })
        .from(links)
        .where(and(sameSide, eq(links.localId, localId)))
        .limit(1);
      return l?.id ?? null;
    },
  };
  return {
    ctx,
    profile,
    connection,
    conn,
    entity,
    object,
    rows,
    localFields,
    remoteFields,
    agent: ctx.ai.agent(),
    people,
    resolver,
    comments: profile.comments && entity.comments && object.capabilities.comments,
    log: opts.log,
    dryRun: opts.dryRun ?? false,
    deferParents: opts.deferParents ?? false,
    signal: opts.signal,
    consecutiveErrors: 0,
  };
}
