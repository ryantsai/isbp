/**
 * Servers (admin connections plus the module's settings), their requestable roles, inventory sync, and
 * what the inventory says about drift: unmanaged access and orphan accounts.
 */
import { groupMembers, groups } from '@isbp/db/schema';
import {
  type AuthContext,
  type DbConnectionInfo,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type {
  ConnectionInfoOut as ConnectionInfo,
  CreateRoleInput,
  CreateServerInput,
  InventoryAccountOut as InventoryAccount,
  InventoryOut as Inventory,
  RequestableRoleOut as RequestableRole,
  ServerOut as Server,
  ServersOut as Servers,
  SyncResultOut as SyncResult,
  UnmanagedOut as Unmanaged,
  UpdateRoleInput,
  UpdateServerInput,
} from '../contracts';
import { createRoleSchema, updateRoleSchema } from '../contracts';
import {
  authModesFor,
  bareAccountName,
  durationPolicyProblem,
  isManagedEngine,
  isValidRoleName,
  LIVE_GRANT_STATUSES,
  type ManagedEngine,
  nameKey,
  patternProblem,
  personIndex,
  unmanagedMemberships,
} from '../model';
import { PERMISSIONS, personOf, requireAny } from './access';
import { connectionOf, DbExecutor, errorMessage, truthy } from './engine';
import {
  accounts,
  grants,
  inventoryAccounts,
  inventoryMemberships,
  inventoryRoles,
  requestableRoles,
  servers,
} from './schema';
import {
  allPeople,
  dbIn,
  dbOut,
  groupsByIds,
  peopleByIds,
  personRef,
  type RoleRow,
  serverRef,
  type ServerRow,
} from './support';

const SERVER_ENTITY = 'dbaccess.server';
const ROLE_ENTITY = 'dbaccess.role';

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === '' || v === 'infinity') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() > 9000 ? null : d;
};

const connectionInfo = (c: DbConnectionInfo): ConnectionInfo => ({
  id: c.id,
  key: c.key,
  name: c.name,
  engine: c.engine,
  host: c.host,
  port: c.port,
  database: c.database,
  enabled: c.enabled,
  status: c.status,
  serverVersion: c.serverVersion,
});

function chunks<T>(list: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export interface Drift {
  engine: string;
  unmanaged: { roleId: string; database: string; roleName: string; memberName: string }[];
  orphans: Set<string>;
  /** Account name (engine key) → person. */
  people: Map<string, { userId: string; active: boolean }>;
  /** Logins of the platform's own connections (engine keys). */
  services: Set<string>;
  syncedAt: Date | null;
}

export class ServerService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  async row(id: string): Promise<ServerRow> {
    const [row] = await this.db.select().from(servers).where(eq(servers.id, id));
    if (!row) throw httpErrors.notFound('Server not found');
    return row;
  }

  async roleRow(id: string): Promise<RoleRow> {
    const [row] = await this.db.select().from(requestableRoles).where(eq(requestableRoles.id, id));
    if (!row) throw httpErrors.notFound('Requestable role not found');
    return row;
  }

  async rowsByIds(ids: readonly string[]): Promise<Map<string, ServerRow>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select()
      .from(servers)
      .where(inArray(servers.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /* ───────────── servers ───────────── */

  async list(): Promise<Servers> {
    const rows = await this.db.select().from(servers).orderBy(asc(servers.displayName));
    const connections = await this.ctx.databases.list({ purpose: 'admin' });
    const configured = new Set(rows.map((r) => r.connectionId));
    return {
      items: await Promise.all(rows.map((r) => this.dto(r, connections))),
      unconfigured: connections.filter((c) => !configured.has(c.id)).map(connectionInfo),
    };
  }

  async detail(id: string): Promise<Server> {
    return this.dto(await this.row(id), await this.ctx.databases.list({ purpose: 'admin' }));
  }

  private async dto(s: ServerRow, connections: DbConnectionInfo[]): Promise<Server> {
    const connection = connections.find((c) => c.id === s.connectionId) ?? null;
    const [group] = s.ownerGroupId
      ? [(await groupsByIds(this.db, [s.ownerGroupId])).get(s.ownerGroupId)]
      : [];
    const [roleCount] = await this.db
      .select({ n: count() })
      .from(requestableRoles)
      .where(and(eq(requestableRoles.serverId, s.id), eq(requestableRoles.active, true)));
    const [accountCount] = await this.db
      .select({ n: count() })
      .from(inventoryAccounts)
      .where(eq(inventoryAccounts.serverId, s.id));
    const grantCounts = await this.db
      .select({ status: grants.status, n: count() })
      .from(grants)
      .where(eq(grants.serverId, s.id))
      .groupBy(grants.status);
    const live = new Set<string>(LIVE_GRANT_STATUSES);
    const drift = await this.drift(s, connection);
    return {
      id: s.id,
      connectionId: s.connectionId,
      connection: connection ? connectionInfo(connection) : null,
      displayName: s.displayName,
      engine: (connection?.engine ?? s.engine) as Server['engine'],
      environment: s.environment,
      accountPattern: s.accountPattern,
      authMode: s.authMode,
      windowsDomain: s.windowsDomain,
      passwordLength: s.passwordLength,
      autoSync: s.autoSync,
      ownerGroup: group ? { id: group.id, name: group.name } : null,
      lastSyncAt: s.lastSyncAt,
      lastSyncStatus: s.lastSyncStatus,
      lastSyncError: s.lastSyncError,
      counts: {
        roles: roleCount?.n ?? 0,
        accounts: accountCount?.n ?? 0,
        liveGrants: grantCounts.filter((g) => live.has(g.status)).reduce((n, g) => n + g.n, 0),
        unmanaged: drift.unmanaged.length,
        orphans: drift.orphans.size,
        failed: grantCounts.find((g) => g.status === 'failed')?.n ?? 0,
      },
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  private validateSettings(
    engine: ManagedEngine,
    v: { accountPattern?: string; authMode?: string; windowsDomain?: string | null },
  ) {
    if (v.accountPattern !== undefined && patternProblem(v.accountPattern))
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'The account name pattern is not valid', {
        issues: [{ path: 'accountPattern', message: 'Letters, digits, "_" and {username} or {email_local}' }],
      });
    if (v.authMode && !authModesFor(engine).includes(v.authMode as never))
      throw new HttpError(
        400,
        ErrorCodes.VALIDATION_FAILED,
        `${v.authMode} logins are not available on ${engine}`,
        {
          issues: [{ path: 'authMode', message: 'Windows logins exist on SQL Server only' }],
        },
      );
    if (v.authMode === 'windows' && !v.windowsDomain)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Windows logins need a domain', {
        issues: [{ path: 'windowsDomain', message: 'Required for Windows logins' }],
      });
  }

  async create(input: CreateServerInput & { connectionId: string; displayName: string }, auth: AuthContext) {
    const connection = await connectionOf(this.ctx, input.connectionId);
    if (!isManagedEngine(connection.engine))
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        `${connection.engine} servers are not managed by Database access`,
      );
    const values = {
      connectionId: connection.id,
      displayName: input.displayName,
      engine: connection.engine,
      environment: input.environment ?? 'production',
      accountPattern: input.accountPattern ?? '{username}',
      authMode: input.authMode ?? 'password',
      windowsDomain: input.authMode === 'windows' ? (input.windowsDomain ?? null) : null,
      passwordLength: input.passwordLength ?? 24,
      autoSync: input.autoSync ?? true,
      ownerGroupId: input.ownerGroupId ?? null,
      createdBy: personOf(auth),
    };
    this.validateSettings(connection.engine, values);
    const [dup] = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.connectionId, connection.id));
    if (dup) throw httpErrors.conflict('This connection is already a server', { serverId: dup.id });
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx.insert(servers).values(values).returning();
      await this.ctx.audit.record(
        {
          action: 'dbaccess.server.created',
          entityType: SERVER_ENTITY,
          entityId: row!.id,
          entityLabel: row!.displayName,
          metadata: { connection: connection.key, engine: connection.engine, authMode: values.authMode },
        },
        { tx },
      );
      return row!;
    });
  }

  async update(id: string, input: UpdateServerInput) {
    const before = await this.row(id);
    const connection = await this.ctx.databases.get(before.connectionId);
    const engine = (connection?.engine ?? before.engine) as ManagedEngine;
    const next = { ...before, ...input };
    if (next.authMode !== 'windows') next.windowsDomain = null;
    this.validateSettings(engine, next);
    return this.ctx.transaction(async (tx) => {
      const patch = {
        displayName: next.displayName,
        environment: next.environment,
        accountPattern: next.accountPattern,
        authMode: next.authMode,
        windowsDomain: next.windowsDomain,
        passwordLength: next.passwordLength,
        autoSync: next.autoSync,
        ownerGroupId: next.ownerGroupId,
      };
      const [row] = await tx.update(servers).set(patch).where(eq(servers.id, id)).returning();
      await this.ctx.audit.record(
        {
          action: 'dbaccess.server.updated',
          entityType: SERVER_ENTITY,
          entityId: id,
          entityLabel: row!.displayName,
          changes: this.ctx.audit.diff(before as unknown as Record<string, unknown>, patch),
        },
        { tx },
      );
      return row!;
    });
  }

  async remove(id: string) {
    const s = await this.row(id);
    const [live] = await this.db
      .select({ n: count() })
      .from(grants)
      .where(and(eq(grants.serverId, id), inArray(grants.status, [...LIVE_GRANT_STATUSES])));
    if (live && live.n > 0)
      throw new HttpError(
        409,
        ErrorCodes.IN_USE,
        'People still hold access on this server: revoke it first',
        {
          liveGrants: live.n,
        },
      );
    await this.ctx.transaction(async (tx) => {
      await tx.delete(servers).where(eq(servers.id, id));
      await this.ctx.audit.record(
        {
          action: 'dbaccess.server.deleted',
          entityType: SERVER_ENTITY,
          entityId: id,
          entityLabel: s.displayName,
        },
        { tx },
      );
    });
  }

  /** Servers people can filter by or request on (with active requestable roles). */
  async options() {
    const rows = await this.db
      .select({
        id: servers.id,
        displayName: servers.displayName,
        engine: servers.engine,
        environment: servers.environment,
        // The outer column is wrapped in its own `sql`: a single-table select writes bare column names ("id"),
        // which inside the subquery would mean the role's own id.
        roles: sql<number>`(select count(*)::int from dbaccess.roles r where r.server_id = ${sql`${servers.id}`} and r.active)`,
      })
      .from(servers)
      .orderBy(asc(servers.displayName));
    return rows.map((r) => ({ ...serverRef(r), roles: r.roles }));
  }

  async groupOptions(q?: string) {
    const rows = await this.db
      .select({
        id: groups.id,
        key: groups.key,
        name: groups.name,
        members: sql<number>`(select count(*)::int from ${groupMembers} gm where gm.group_id = ${sql`${groups.id}`})`,
      })
      .from(groups)
      .where(q ? or(ilike(groups.name, likePattern(q)), ilike(groups.key, likePattern(q))) : undefined)
      .orderBy(asc(groups.name))
      .limit(50);
    return rows;
  }

  /* ───────────── inventory sync ───────────── */

  async sync(
    serverId: string,
    opts: { log?: (line: string) => void; signal?: AbortSignal } = {},
  ): Promise<SyncResult> {
    const server = await this.row(serverId);
    const connection = await connectionOf(this.ctx, server.connectionId);
    const exec = new DbExecutor(this.ctx, connection, opts);
    const started = Date.now();
    try {
      const engine = exec.engine;
      const roles = await this.db
        .select({ database: requestableRoles.database })
        .from(requestableRoles)
        .where(eq(requestableRoles.serverId, serverId));
      const databases =
        engine === 'mssql'
          ? [...new Set([connection.database ?? '', ...roles.map((r) => r.database)].filter(Boolean))]
          : [];
      opts.log?.(`Reading accounts, roles and memberships from ${connection.name}`);
      const raw = await exec.inventory(databases);
      const known = new Set(
        (
          await this.db.select({ name: accounts.name }).from(accounts).where(eq(accounts.serverId, serverId))
        ).map((a) => a.name),
      );
      const now = new Date();
      const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
      let accountRows = raw.accounts;
      let roleRows = raw.roles;
      if (engine === 'postgres') {
        // Roles and accounts are one thing: login roles (and accounts the platform knows) are accounts.
        accountRows = raw.accounts.filter((a) => truthy(a.can_login) || known.has(str(a.name)));
        roleRows = raw.accounts
          .filter((a) => !truthy(a.can_login) && !known.has(str(a.name)))
          .map((a) => ({ name: a.name, database: '' }));
      }
      const acc = new Map<string, typeof inventoryAccounts.$inferInsert>();
      for (const a of accountRows) {
        const name = str(a.name);
        if (!name) continue;
        acc.set(name, {
          serverId,
          name,
          kind: a.kind === undefined || a.kind === null ? null : str(a.kind).slice(0, 60),
          enabled: a.enabled === undefined ? true : truthy(a.enabled),
          createdOn: toDate(a.created_at),
          lastLoginAt: toDate(a.last_login_at),
          validUntil: toDate(a.valid_until),
          syncedAt: now,
        });
      }
      const rol = new Map<string, typeof inventoryRoles.$inferInsert>();
      for (const r of roleRows) {
        const name = str(r.name);
        if (name)
          rol.set(`${str(r.database)}\u0000${name}`, {
            serverId,
            database: str(r.database),
            name,
            syncedAt: now,
          });
      }
      const mem = new Map<string, typeof inventoryMemberships.$inferInsert>();
      for (const m of raw.memberships) {
        const roleName = str(m.role_name);
        const memberName = str(m.member_name);
        if (!roleName || !memberName) continue;
        mem.set(`${str(m.database)}\u0000${roleName}\u0000${memberName}`, {
          serverId,
          database: str(m.database),
          roleName,
          memberName,
          syncedAt: now,
        });
      }
      await this.ctx.transaction(async (tx) => {
        await tx.delete(inventoryAccounts).where(eq(inventoryAccounts.serverId, serverId));
        await tx.delete(inventoryRoles).where(eq(inventoryRoles.serverId, serverId));
        await tx.delete(inventoryMemberships).where(eq(inventoryMemberships.serverId, serverId));
        for (const c of chunks([...acc.values()])) await tx.insert(inventoryAccounts).values(c);
        for (const c of chunks([...rol.values()])) await tx.insert(inventoryRoles).values(c);
        for (const c of chunks([...mem.values()])) await tx.insert(inventoryMemberships).values(c);
        await tx
          .update(servers)
          .set({ lastSyncAt: now, lastSyncStatus: 'ok', lastSyncError: null, engine: connection.engine })
          .where(eq(servers.id, serverId));
      });
      const drift = await this.drift({ ...server, lastSyncAt: now }, connection);
      const result: SyncResult = {
        serverId,
        syncedAt: now,
        accounts: acc.size,
        roles: rol.size,
        memberships: mem.size,
        unmanaged: drift.unmanaged.length,
        orphans: drift.orphans.size,
      };
      await this.ctx.transaction(async (tx) => {
        await this.ctx.audit.record(
          {
            action: 'dbaccess.server.synced',
            entityType: SERVER_ENTITY,
            entityId: serverId,
            entityLabel: server.displayName,
            metadata: { ...result, durationMs: Date.now() - started, limited: raw.limited },
            category: 'system',
          },
          { tx },
        );
        await this.ctx.events.publish(
          'dbaccess.server.synced',
          {
            serverId,
            accounts: result.accounts,
            roles: result.roles,
            memberships: result.memberships,
            unmanaged: result.unmanaged,
          },
          { tx },
        );
      });
      opts.log?.(
        `${result.accounts} accounts, ${result.roles} roles, ${result.memberships} memberships, ${result.unmanaged} unmanaged`,
      );
      return result;
    } catch (err) {
      const message = errorMessage(err);
      await this.db
        .update(servers)
        .set({ lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncError: message })
        .where(eq(servers.id, serverId));
      await this.ctx.audit.record({
        action: 'dbaccess.server.synced',
        entityType: SERVER_ENTITY,
        entityId: serverId,
        entityLabel: server.displayName,
        outcome: 'failure',
        category: 'system',
        metadata: { error: message },
      });
      throw err;
    }
  }

  /** Requestable-role picker: roles of the last sync with member counts. */
  async inventory(serverId: string): Promise<Inventory> {
    const server = await this.row(serverId);
    const roles = await this.db
      .select()
      .from(inventoryRoles)
      .where(eq(inventoryRoles.serverId, serverId))
      .orderBy(asc(inventoryRoles.database), asc(inventoryRoles.name));
    const members = await this.db
      .select({
        database: inventoryMemberships.database,
        roleName: inventoryMemberships.roleName,
        n: count(),
      })
      .from(inventoryMemberships)
      .where(eq(inventoryMemberships.serverId, serverId))
      .groupBy(inventoryMemberships.database, inventoryMemberships.roleName);
    const requestable = await this.db
      .select({
        id: requestableRoles.id,
        database: requestableRoles.database,
        roleName: requestableRoles.roleName,
      })
      .from(requestableRoles)
      .where(eq(requestableRoles.serverId, serverId));
    const key = (db: string, name: string) => `${db}\u0000${nameKey(server.engine, name)}`;
    const memberCount = new Map(members.map((m) => [key(m.database, m.roleName), m.n]));
    const requestableId = new Map(requestable.map((r) => [key(r.database, r.roleName), r.id]));
    return {
      syncedAt:
        server.lastSyncStatus === 'ok' || roles.length ? (roles[0]?.syncedAt ?? server.lastSyncAt) : null,
      databases: [...new Set(roles.map((r) => r.database).filter(Boolean))],
      roles: roles.map((r) => ({
        database: dbOut(r.database),
        name: r.name,
        members: memberCount.get(key(r.database, r.name)) ?? 0,
        requestableRoleId: requestableId.get(key(r.database, r.name)) ?? null,
      })),
    };
  }

  /* ───────────── requestable roles ───────────── */

  async roleDtos(rows: RoleRow[]): Promise<RequestableRole[]> {
    if (!rows.length) return [];
    const serverRows = await this.rowsByIds(rows.map((r) => r.serverId));
    const people = await peopleByIds(
      this.db,
      rows.map((r) => r.ownerUserId),
    );
    const groupRows = await groupsByIds(
      this.db,
      rows.map((r) => r.ownerGroupId),
    );
    const live = await this.db
      .select({ roleId: grants.roleId, n: count() })
      .from(grants)
      .where(
        and(
          inArray(
            grants.roleId,
            rows.map((r) => r.id),
          ),
          inArray(grants.status, [...LIVE_GRANT_STATUSES]),
        ),
      )
      .groupBy(grants.roleId);
    const liveBy = new Map(live.map((l) => [l.roleId, l.n]));
    return rows.map((r) => {
      const person = r.ownerUserId ? people.get(r.ownerUserId) : undefined;
      const group = r.ownerGroupId ? groupRows.get(r.ownerGroupId) : undefined;
      return {
        id: r.id,
        server: serverRef(serverRows.get(r.serverId)!),
        database: dbOut(r.database),
        roleName: r.roleName,
        name: r.name,
        description: r.description ?? null,
        owner: person
          ? { kind: 'user', id: person.id, name: person.displayName }
          : group
            ? { kind: 'group', id: group.id, name: group.name }
            : null,
        risk: r.risk,
        defaultDays: r.defaultDays,
        maxDays: r.maxDays,
        allowPermanent: r.allowPermanent,
        justificationRequired: r.justificationRequired,
        active: r.active,
        liveGrants: liveBy.get(r.id) ?? 0,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  async roles(serverId: string): Promise<RequestableRole[]> {
    await this.row(serverId);
    const rows = await this.db
      .select()
      .from(requestableRoles)
      .where(eq(requestableRoles.serverId, serverId))
      .orderBy(asc(requestableRoles.database), asc(requestableRoles.roleName));
    return this.roleDtos(rows);
  }

  private checkRole(v: {
    ownerUserId: string | null;
    ownerGroupId: string | null;
    defaultDays: number | null;
    maxDays: number | null;
    allowPermanent: boolean;
  }) {
    if (v.ownerUserId && v.ownerGroupId)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'The owner is a person or a group, not both', {
        issues: [{ path: 'ownerGroupId', message: 'Choose a person or a group' }],
      });
    if (!v.ownerUserId && !v.ownerGroupId)
      throw new HttpError(
        400,
        ErrorCodes.VALIDATION_FAILED,
        'Every requestable role needs an owner (the approver)',
        {
          issues: [{ path: 'ownerUserId', message: 'Choose who approves requests' }],
        },
      );
    const problem = durationPolicyProblem(v);
    if (problem)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'The durations are not consistent', {
        issues: [
          problem === 'max_required'
            ? { path: 'maxDays', message: 'Set a maximum, or allow permanent access' }
            : { path: 'defaultDays', message: 'The default cannot exceed the maximum' },
        ],
      });
  }

  async createRole(serverId: string, raw: CreateRoleInput) {
    const input = createRoleSchema.parse(raw);
    const server = await this.row(serverId);
    const engine = server.engine as ManagedEngine;
    const database = engine === 'mssql' ? dbIn(input.database) : '';
    if (!isValidRoleName(input.roleName, engine))
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Not a valid role name', {
        issues: [{ path: 'roleName', message: 'Not a valid role name' }],
      });
    this.checkRole(input);
    // Only roles the last sync saw can be offered (names never come from free text).
    const [seen] = await this.db
      .select({ name: inventoryRoles.name })
      .from(inventoryRoles)
      .where(
        and(
          eq(inventoryRoles.serverId, serverId),
          eq(inventoryRoles.database, database),
          engine === 'postgres'
            ? eq(inventoryRoles.name, input.roleName)
            : sql`lower(${inventoryRoles.name}) = lower(${input.roleName})`,
        ),
      );
    if (!seen)
      throw new HttpError(
        400,
        ErrorCodes.VALIDATION_FAILED,
        'The role is not in the server inventory: sync the server',
        {
          issues: [{ path: 'roleName', message: 'Not in the inventory (sync the server first)' }],
        },
      );
    const [dup] = await this.db
      .select({ id: requestableRoles.id })
      .from(requestableRoles)
      .where(
        and(
          eq(requestableRoles.serverId, serverId),
          eq(requestableRoles.database, database),
          eq(requestableRoles.roleName, seen.name),
        ),
      );
    if (dup) throw httpErrors.conflict('This role is already requestable', { roleId: dup.id });
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(requestableRoles)
        .values({ ...input, serverId, database, roleName: seen.name })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'dbaccess.role.created',
          entityType: ROLE_ENTITY,
          entityId: row!.id,
          entityLabel: `${server.displayName}: ${row!.roleName}`,
          metadata: { risk: row!.risk, maxDays: row!.maxDays, allowPermanent: row!.allowPermanent },
        },
        { tx },
      );
      return row!;
    });
  }

  async updateRole(id: string, raw: UpdateRoleInput) {
    const input = updateRoleSchema.parse(raw);
    const before = await this.roleRow(id);
    const next = { ...before, ...input };
    this.checkRole(next);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(requestableRoles)
        .set(input)
        .where(eq(requestableRoles.id, id))
        .returning();
      await this.ctx.audit.record(
        {
          action: 'dbaccess.role.updated',
          entityType: ROLE_ENTITY,
          entityId: id,
          entityLabel: before.roleName,
          changes: this.ctx.audit.diff(before as unknown as Record<string, unknown>, input),
        },
        { tx },
      );
      return row!;
    });
  }

  async removeRole(id: string) {
    const role = await this.roleRow(id);
    const [used] = await this.db.select({ n: count() }).from(grants).where(eq(grants.roleId, id));
    if (used && used.n > 0)
      throw new HttpError(409, ErrorCodes.IN_USE, 'This role was granted: deactivate it instead', {
        grants: used.n,
      });
    await this.ctx.transaction(async (tx) => {
      await tx.delete(requestableRoles).where(eq(requestableRoles.id, id));
      await this.ctx.audit.record(
        {
          action: 'dbaccess.role.deleted',
          entityType: ROLE_ENTITY,
          entityId: id,
          entityLabel: role.roleName,
        },
        { tx },
      );
    });
  }

  /* ───────────── drift ───────────── */

  /** Unmanaged memberships and orphan accounts of one server, from its last sync. */
  async drift(server: ServerRow, connection?: DbConnectionInfo | null): Promise<Drift> {
    const engine = (connection?.engine ?? server.engine) as ManagedEngine;
    const memberships = await this.db
      .select()
      .from(inventoryMemberships)
      .where(eq(inventoryMemberships.serverId, server.id));
    const roles = await this.db
      .select({
        id: requestableRoles.id,
        database: requestableRoles.database,
        roleName: requestableRoles.roleName,
      })
      .from(requestableRoles)
      .where(eq(requestableRoles.serverId, server.id));
    const grantKeys = await this.db
      .select({ roleId: grants.roleId, accountName: grants.accountName, status: grants.status })
      .from(grants)
      .where(and(eq(grants.serverId, server.id), inArray(grants.status, [...LIVE_GRANT_STATUSES])));
    // Logins of the platform's own connections to this server (the admin login holds ADMIN OPTION on the
    // roles it manages) are service accounts: neither unmanaged access nor orphans.
    const own = connection ?? (await this.ctx.databases.get(server.connectionId));
    const services = new Set(
      (await this.ctx.databases.list())
        .filter(
          (c) => c.id === server.connectionId || (own && c.engine === own.engine && c.host === own.host),
        )
        .map((c) => nameKey(engine, c.username)),
    );
    const isService = (name: string) =>
      services.has(nameKey(engine, name)) || services.has(nameKey(engine, bareAccountName(name)));
    const unmanaged = unmanagedMemberships(
      engine,
      memberships.filter((m) => !isService(m.memberName)),
      roles,
      grantKeys,
    );
    const invAccounts = await this.db
      .select({ name: inventoryAccounts.name })
      .from(inventoryAccounts)
      .where(eq(inventoryAccounts.serverId, server.id));
    const known = await this.db
      .select({ accountName: accounts.name, userId: accounts.userId })
      .from(accounts)
      .where(eq(accounts.serverId, server.id));
    const people = personIndex(
      isManagedEngine(engine) ? engine : 'postgres',
      server.accountPattern,
      await allPeople(this.db),
      known.map((k) => ({ ...k, accountName: bareAccountName(k.accountName) })),
    );
    const orphans = new Set<string>();
    for (const a of invAccounts) {
      if (isService(a.name)) continue;
      if (!people.get(nameKey(engine, bareAccountName(a.name)))?.active) orphans.add(a.name);
    }
    return { engine, unmanaged, orphans, people, services, syncedAt: server.lastSyncAt };
  }

  async unmanaged(serverId: string | undefined): Promise<Unmanaged[]> {
    const rows = serverId ? [await this.row(serverId)] : await this.db.select().from(servers);
    const out: Unmanaged[] = [];
    const connections = await this.ctx.databases.list({ purpose: 'admin' });
    for (const s of rows) {
      const drift = await this.drift(
        s,
        connections.find((c) => c.id === s.connectionId),
      );
      if (!drift.unmanaged.length) continue;
      const roleRows = await this.db
        .select()
        .from(requestableRoles)
        .where(inArray(requestableRoles.id, [...new Set(drift.unmanaged.map((u) => u.roleId))]));
      const roleBy = new Map(roleRows.map((r) => [r.id, r]));
      const suggestions = drift.unmanaged.map(
        (u) => drift.people.get(nameKey(drift.engine, bareAccountName(u.memberName)))?.userId ?? null,
      );
      const people = await peopleByIds(this.db, suggestions);
      drift.unmanaged.forEach((u, i) => {
        const role = roleBy.get(u.roleId)!;
        const suggested = suggestions[i] ? people.get(suggestions[i]!) : undefined;
        out.push({
          server: serverRef(s),
          role: {
            id: role.id,
            name: role.name,
            roleName: role.roleName,
            database: dbOut(role.database),
            risk: role.risk,
          },
          database: dbOut(u.database),
          memberName: u.memberName,
          suggested: suggested && suggested.status === 'active' ? personRef(suggested) : null,
          syncedAt: s.lastSyncAt,
        });
      });
    }
    return out;
  }

  /** Accounts across servers with the person they belong to, orphan and managed flags and their roles. */
  async accounts(query: {
    page: number;
    pageSize: number;
    q?: string;
    serverId?: string;
    orphan?: boolean;
    managed?: boolean;
    sort?: string;
  }) {
    const serverRows = query.serverId
      ? [await this.row(query.serverId)]
      : await this.db.select().from(servers);
    const connections = await this.ctx.databases.list({ purpose: 'admin' });
    const all: (InventoryAccount & { userId: string | null })[] = [];
    for (const s of serverRows) {
      const drift = await this.drift(
        s,
        connections.find((c) => c.id === s.connectionId),
      );
      const engine = drift.engine;
      const inv = await this.db
        .select()
        .from(inventoryAccounts)
        .where(
          and(
            eq(inventoryAccounts.serverId, s.id),
            query.q ? ilike(inventoryAccounts.name, likePattern(query.q)) : undefined,
          ),
        );
      const managedRows = await this.db
        .select({ name: accounts.name })
        .from(accounts)
        .where(eq(accounts.serverId, s.id));
      const managed = new Set(managedRows.map((m) => nameKey(engine, m.name)));
      const mems = await this.db
        .select({
          memberName: inventoryMemberships.memberName,
          roleName: inventoryMemberships.roleName,
          database: inventoryMemberships.database,
        })
        .from(inventoryMemberships)
        .where(eq(inventoryMemberships.serverId, s.id));
      const rolesOf = new Map<string, string[]>();
      for (const m of mems) {
        const key = nameKey(engine, m.memberName);
        rolesOf.set(key, [
          ...(rolesOf.get(key) ?? []),
          m.database ? `${m.database}.${m.roleName}` : m.roleName,
        ]);
      }
      for (const a of inv) {
        const match = drift.people.get(nameKey(engine, bareAccountName(a.name)));
        all.push({
          server: serverRef(s),
          name: a.name,
          kind: a.kind,
          enabled: a.enabled,
          createdAt: a.createdOn,
          lastLoginAt: a.lastLoginAt,
          validUntil: a.validUntil,
          person: null,
          userId: match?.userId ?? null,
          orphan: drift.orphans.has(a.name),
          managed: managed.has(nameKey(engine, a.name)),
          roles: (rolesOf.get(nameKey(engine, a.name)) ?? []).sort(),
          syncedAt: a.syncedAt,
        });
      }
    }
    let rows = all;
    if (query.orphan !== undefined) rows = rows.filter((r) => r.orphan === query.orphan);
    if (query.managed !== undefined) rows = rows.filter((r) => r.managed === query.managed);
    const desc = query.sort?.startsWith('-');
    const field = query.sort?.replace(/^-/, '') ?? 'name';
    const value = (r: (typeof rows)[number]) =>
      field === 'server'
        ? r.server.displayName
        : field === 'lastLoginAt'
          ? String(r.lastLoginAt ?? '')
          : field === 'createdAt'
            ? String(r.createdAt ?? '')
            : r.name.toLowerCase();
    rows.sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * (desc ? -1 : 1));
    const page = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const people = await peopleByIds(
      this.db,
      page.map((r) => r.userId),
    );
    return {
      items: page.map(({ userId, ...r }) => ({
        ...r,
        person: userId ? personRef(people.get(userId)) : null,
      })),
      total: rows.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** A DBA view of one server, or any grants reader. */
  requireServerReader(auth: AuthContext) {
    requireAny(auth, [PERMISSIONS.servers, PERMISSIONS.grantsRead]);
  }
}
