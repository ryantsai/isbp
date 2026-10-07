/**
 * Grants: provisioning and revocation in the worker (verified, retried, audited), the one-time credential
 * reveal, expiry, offboarding, adoption of unmanaged access, and the grant DTOs every page uses.
 */
import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AdoptInput, GrantOut as Grant, RevealOut as Reveal, RevokeUnmanagedInput } from '../contracts';
import {
  type EndReason,
  EXPIRING_DAYS,
  grantExpiry,
  type GrantStatus,
  isValidAccountName,
  isValidRoleName,
  LIVE_GRANT_STATUSES,
  loginNameFor,
  type ManagedEngine,
  MAX_ATTEMPTS,
  nameKey,
  REVEAL_DAYS,
  retryDelaySeconds,
  todayIn,
  viewStatus,
  accountNameFor,
  checkDuration,
  bareAccountName,
} from '../model';
import { groupsOf, isRoleOwner, PERMISSIONS, personOf } from './access';
import {
  createAccountSteps,
  generatePassword,
  grantRoleSteps,
  revokeRoleSteps,
  setEnabledSteps,
  setPasswordSteps,
  validUntilSteps,
} from './ddl';
import { connectionOf, DbExecutor, errorMessage } from './engine';
import {
  accounts,
  grants,
  inventoryAccounts,
  inventoryMemberships,
  requestableRoles,
  requests,
  reveals,
  servers,
} from './schema';
import type { ServerService } from './servers';
import {
  activeMembers,
  peopleByIds,
  personById,
  personRef,
  roleRef,
  type RoleRow,
  serverRef,
  type ServerRow,
} from './support';
import { formatRequestRef } from '../model';

export type GrantRow = typeof grants.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

const GRANT_ENTITY = 'dbaccess.grant';
const ACCOUNT_ENTITY = 'dbaccess.account';
const DAY_MS = 86_400_000;
const STUCK_MS = 15 * 60_000;

export interface JobLog {
  log?: (line: string) => void;
  signal?: AbortSignal;
}

export class GrantService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly serversSvc: ServerService,
  ) {}

  private get db() {
    return this.ctx.db;
  }

  async row(id: string): Promise<GrantRow> {
    const [row] = await this.db.select().from(grants).where(eq(grants.id, id));
    if (!row) throw httpErrors.notFound('Grant not found');
    return row;
  }

  /* ───────────── DTOs ───────────── */

  async toDtos(rows: GrantRow[], auth: AuthContext | null): Promise<Grant[]> {
    if (!rows.length) return [];
    const now = new Date();
    const roleRows = await this.db
      .select()
      .from(requestableRoles)
      .where(inArray(requestableRoles.id, [...new Set(rows.map((r) => r.roleId))]));
    const roleBy = new Map(roleRows.map((r) => [r.id, r]));
    const serverBy = await this.serversSvc.rowsByIds(rows.map((r) => r.serverId));
    const people = await peopleByIds(
      this.db,
      rows.map((r) => r.userId),
    );
    const requestIds = rows.map((r) => r.requestId).filter((x): x is string => Boolean(x));
    const requestRows = requestIds.length
      ? await this.db
          .select({ id: requests.id, number: requests.number })
          .from(requests)
          .where(inArray(requests.id, requestIds))
      : [];
    const requestBy = new Map(requestRows.map((r) => [r.id, r]));
    const me = auth ? personOf(auth) : null;
    const revealRows = me
      ? await this.db
          .select()
          .from(reveals)
          .where(
            and(
              inArray(
                reveals.grantId,
                rows.map((r) => r.id),
              ),
              eq(reveals.userId, me),
            ),
          )
          .orderBy(desc(reveals.createdAt))
      : [];
    const revealBy = new Map<string, (typeof revealRows)[number]>();
    for (const r of revealRows) if (!revealBy.has(r.grantId)) revealBy.set(r.grantId, r);
    const groups = auth ? await groupsOf(this.db, auth) : new Set<string>();
    const canManage = auth?.can(PERMISSIONS.grantsManage) ?? false;
    const canRead = auth?.can(PERMISSIONS.grantsRead) ?? false;
    return rows.map((g) => {
      const role = roleBy.get(g.roleId)!;
      const server = serverBy.get(g.serverId)!;
      const vs = viewStatus(g.status, g.expiresAt, now);
      const owner = isRoleOwner(me, role, groups);
      const mine = Boolean(me && g.userId === me);
      const revocable =
        g.status === 'active' ||
        (g.status === 'failed' && g.operation === 'grant') ||
        g.status === 'provisioning';
      const reveal = mine ? revealBy.get(g.id) : undefined;
      const request = g.requestId ? requestBy.get(g.requestId) : undefined;
      return {
        id: g.id,
        status: g.status,
        viewStatus: vs,
        source: g.source,
        operation: g.operation,
        grantee: personRef(g.userId ? people.get(g.userId) : null),
        role: roleRef(role),
        server: serverRef(server),
        accountName: g.accountName,
        expiresAt: g.expiresAt,
        grantedAt: g.grantedAt,
        endedAt: g.endedAt,
        endReason: g.endReason,
        endNote: g.endNote,
        attempts: g.attempts,
        lastError: canRead || canManage ? g.lastError : null,
        request: request ? { id: request.id, reference: formatRequestRef(request.number) } : null,
        reveal: reveal
          ? {
              id: reveal.id,
              expiresAt: reveal.expiresAt,
              available: !reveal.viewedAt && Boolean(reveal.secretSealed) && reveal.expiresAt > now,
            }
          : null,
        viewer: {
          canRevoke: revocable && (canManage || owner),
          canRetry: g.status === 'failed' && canManage,
          canRelinquish: mine && (g.status === 'active' || g.status === 'failed'),
          canExtend: mine && g.status === 'active' && g.expiresAt !== null && role.active,
        },
        createdAt: g.createdAt,
      };
    });
  }

  async detail(id: string, auth: AuthContext): Promise<Grant> {
    const g = await this.row(id);
    await this.requireView(g, auth);
    return (await this.toDtos([g], auth))[0]!;
  }

  /** Grantee, grants readers, the role owner and the grantee's manager may see a grant. */
  private async requireView(g: GrantRow, auth: AuthContext) {
    const me = personOf(auth);
    if (me && g.userId === me) return;
    if (auth.can(PERMISSIONS.grantsRead)) return;
    const role = await this.serversSvc.roleRow(g.roleId);
    if (isRoleOwner(me, role, await groupsOf(this.db, auth))) return;
    if (me && g.userId) {
      const [u] = await this.db
        .select({ managerId: users.managerId })
        .from(users)
        .where(eq(users.id, g.userId));
      if (u?.managerId === me) return;
    }
    auth.require(PERMISSIONS.grantsRead);
  }

  async list(
    query: {
      page: number;
      pageSize: number;
      q?: string;
      sort?: string;
      status?: string;
      serverId?: string;
      roleId?: string;
      risk?: string;
      userId?: string;
      source?: string;
    },
    auth: AuthContext,
  ) {
    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRING_DAYS * DAY_MS);
    const where: (SQL | undefined)[] = [];
    switch (query.status) {
      case undefined:
        break;
      case 'live':
        where.push(inArray(grants.status, [...LIVE_GRANT_STATUSES]));
        break;
      case 'ended':
        where.push(inArray(grants.status, ['revoked', 'expired']));
        break;
      case 'expiring':
        where.push(eq(grants.status, 'active'), isNotNull(grants.expiresAt), lte(grants.expiresAt, soon));
        break;
      case 'active':
        where.push(eq(grants.status, 'active'), or(isNull(grants.expiresAt), gt(grants.expiresAt, soon)));
        break;
      default:
        where.push(eq(grants.status, query.status as GrantStatus));
    }
    if (query.serverId) where.push(eq(grants.serverId, query.serverId));
    if (query.roleId) where.push(eq(grants.roleId, query.roleId));
    if (query.userId) where.push(eq(grants.userId, query.userId));
    if (query.source) where.push(eq(grants.source, query.source as GrantRow['source']));
    if (query.risk) where.push(eq(requestableRoles.risk, query.risk as RoleRow['risk']));
    if (query.q) {
      const p = likePattern(query.q);
      where.push(
        or(
          ilike(grants.accountName, p),
          ilike(requestableRoles.roleName, p),
          sql`${requestableRoles.name}::text ilike ${p}`,
          ilike(users.displayName, p),
          ilike(users.username, p),
        ),
      );
    }
    const cond = and(...where);
    const desc_ = query.sort?.startsWith('-');
    const field = query.sort?.replace(/^-/, '');
    const col =
      field === 'expiresAt'
        ? grants.expiresAt
        : field === 'grantee'
          ? users.displayName
          : field === 'role'
            ? requestableRoles.roleName
            : field === 'status'
              ? grants.status
              : grants.createdAt;
    const order = field
      ? desc_
        ? sql`${col} desc nulls last`
        : sql`${col} asc nulls last`
      : desc(grants.createdAt);
    const base = this.db
      .select({ g: grants })
      .from(grants)
      .innerJoin(requestableRoles, eq(requestableRoles.id, grants.roleId))
      .leftJoin(users, eq(users.id, grants.userId))
      .where(cond);
    const rows = await base
      .orderBy(order, asc(grants.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await this.db
      .select({ n: count() })
      .from(grants)
      .innerJoin(requestableRoles, eq(requestableRoles.id, grants.roleId))
      .leftJoin(users, eq(users.id, grants.userId))
      .where(cond);
    return {
      items: await this.toDtos(
        rows.map((r) => r.g),
        auth,
      ),
      total: total?.n ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** A person's grants (people page): DBAs and readers, or the person's manager. */
  async ofPerson(userId: string, auth: AuthContext): Promise<Grant[]> {
    const me = personOf(auth);
    if (!auth.can(PERMISSIONS.grantsRead) && me !== userId) {
      const [u] = await this.db
        .select({ managerId: users.managerId })
        .from(users)
        .where(eq(users.id, userId));
      if (!me || u?.managerId !== me) auth.require(PERMISSIONS.grantsRead);
    }
    const rows = await this.db
      .select()
      .from(grants)
      .where(and(eq(grants.userId, userId), inArray(grants.status, [...LIVE_GRANT_STATUSES])))
      .orderBy(asc(grants.expiresAt));
    return this.toDtos(rows, auth);
  }

  async mine(auth: AuthContext): Promise<Grant[]> {
    const me = personOf(auth);
    if (!me) return [];
    const since = new Date(Date.now() - 90 * DAY_MS);
    const rows = await this.db
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.userId, me),
          or(inArray(grants.status, [...LIVE_GRANT_STATUSES]), gt(grants.endedAt, since)),
        ),
      )
      .orderBy(desc(grants.createdAt));
    return this.toDtos(rows, auth);
  }

  /* ───────────── creation (approval, adoption) ───────────── */

  /** Creates a grant to provision (inside the approval transaction); enqueue it after commit. */
  async createForRequest(tx: Db, req: typeof requests.$inferSelect, role: RoleRow): Promise<GrantRow> {
    const [row] = await tx
      .insert(grants)
      .values({
        serverId: req.serverId,
        roleId: req.roleId,
        userId: req.requesterId,
        requestId: req.id,
        source: 'request',
        status: 'provisioning',
        operation: 'grant',
        expiresAt: grantExpiry(req.expiresOn, role, req.timeZone),
      })
      .returning();
    await this.ctx.audit.record(
      {
        action: 'dbaccess.grant.requested',
        entityType: GRANT_ENTITY,
        entityId: row!.id,
        entityLabel: role.roleName,
        metadata: { requestId: req.id, expiresAt: row!.expiresAt?.toISOString() ?? null },
      },
      { tx },
    );
    return row!;
  }

  async enqueue(op: 'provision' | 'revoke', grantId: string, delaySeconds = 0) {
    await this.ctx.jobs.enqueue(op, { grantId }, delaySeconds ? { delayMs: delaySeconds * 1_000 } : {});
  }

  /* ───────────── provisioning (worker) ───────────── */

  private async context(g: GrantRow) {
    const [server] = await this.db.select().from(servers).where(eq(servers.id, g.serverId));
    const [role] = await this.db.select().from(requestableRoles).where(eq(requestableRoles.id, g.roleId));
    if (!server || !role) throw new Error('The server or role of this grant was removed');
    return { server, role };
  }

  /** PostgreSQL `VALID UNTIL` for an account: its latest live grant (`infinity` if one is permanent, now if none). */
  private async validUntil(accountId: string, exclude?: string): Promise<string> {
    const rows = await this.db
      .select({ expiresAt: grants.expiresAt })
      .from(grants)
      .where(
        and(
          eq(grants.accountId, accountId),
          inArray(grants.status, ['provisioning', 'active']),
          exclude ? ne(grants.id, exclude) : undefined,
        ),
      );
    if (rows.some((r) => r.expiresAt === null)) return 'infinity';
    const max = Math.max(0, ...rows.map((r) => r.expiresAt!.getTime()));
    return new Date(max || Date.now()).toISOString();
  }

  /**
   * Ensures the account, grants the role and verifies the membership by reading it back. Idempotent: does
   * nothing unless the grant is `provisioning`. Failures are retried with backoff, then the grant fails and
   * the server's DBAs are alerted.
   */
  async provision(grantId: string, opts: JobLog = {}): Promise<GrantStatus> {
    const g = await this.row(grantId);
    if (g.status !== 'provisioning') return g.status;
    const log = opts.log ?? (() => undefined);
    try {
      const { server, role } = await this.context(g);
      const connection = await connectionOf(this.ctx, server.connectionId);
      const exec = new DbExecutor(this.ctx, connection, { signal: opts.signal, log });
      const engine = exec.engine;
      if (!isValidRoleName(role.roleName, engine))
        throw new Error(`Refusing an invalid role name: ${role.roleName}`);
      await this.requireInInventory(server, role);
      if (!g.userId) throw new Error('The grant has no grantee');
      const person = await personById(this.db, g.userId);
      if (!person || person.status !== 'active') throw new Error('The grantee is not an active person');

      const account = await this.ensureAccount(exec, engine, server, g, person, log);
      const target = { login: account.name, role: role.roleName, database: role.database };
      if (!(await exec.isMember(target))) await exec.run(grantRoleSteps(engine, target));
      if (engine === 'postgres')
        await exec.run(validUntilSteps(account.name, await this.validUntilWith(account.id, g)));
      if (!(await exec.isMember(target))) throw new Error('The membership could not be verified after GRANT');
      log(`${account.name} is a member of ${role.roleName}`);

      await this.ctx.transaction(async (tx) => {
        const [done] = await tx
          .update(grants)
          .set({
            status: 'active',
            accountId: account.id,
            accountName: account.name,
            grantedAt: new Date(),
            attempts: g.attempts + 1,
            lastAttemptAt: new Date(),
            lastError: null,
          })
          .where(and(eq(grants.id, g.id), eq(grants.status, 'provisioning')))
          .returning();
        if (!done) return;
        await tx
          .insert(inventoryMemberships)
          .values({
            serverId: server.id,
            database: role.database,
            roleName: role.roleName,
            memberName: account.name,
            syncedAt: new Date(),
          })
          .onConflictDoNothing();
        await this.ctx.audit.record(
          {
            action: 'dbaccess.grant.provisioned',
            entityType: GRANT_ENTITY,
            entityId: g.id,
            entityLabel: `${account.name} → ${role.roleName}`,
            metadata: {
              server: server.displayName,
              expiresAt: done.expiresAt?.toISOString() ?? null,
              verified: true,
            },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'dbaccess.grant.provisioned',
          {
            grantId: g.id,
            userId: g.userId,
            serverId: g.serverId,
            roleId: g.roleId,
            accountName: account.name,
            expiresAt: done.expiresAt?.toISOString() ?? null,
          },
          { tx },
        );
        await this.ctx.notifications.notify(
          {
            type: 'dbaccess.grant.ready',
            recipients: [g.userId],
            params: {
              role: role.name,
              server: server.displayName,
              account: account.name,
              permanent: done.expiresAt ? 'no' : 'yes',
              expiresAt: done.expiresAt,
            },
            href: '/dbaccess',
          },
          { tx },
        );
        if (g.requestId) await this.trackRequest(tx, g.requestId, 'active');
      });
      return 'active';
    } catch (err) {
      return this.failed(g, 'grant', err, log);
    }
  }

  private async validUntilWith(accountId: string, g: GrantRow): Promise<string> {
    const others = await this.validUntil(accountId, g.id);
    if (others === 'infinity' || g.expiresAt === null) return 'infinity';
    return new Date(Math.max(Date.parse(others), g.expiresAt.getTime())).toISOString();
  }

  /** Requestable roles must exist in the synced inventory (names never come from free text). */
  private async requireInInventory(server: ServerRow, role: RoleRow) {
    const [seen] = await this.db
      .execute<{ n: number }>(
        sql`
      select count(*)::int as n from dbaccess.inventory_roles
       where server_id = ${server.id} and database = ${role.database}
         and (name = ${role.roleName} or (${server.engine} <> 'postgres' and lower(name) = lower(${role.roleName})))`,
      )
      .then((r) => r.rows);
    if (!seen || seen.n === 0)
      throw new Error(`Role ${role.roleName} is not in the server inventory: sync the server`);
  }

  /** The person's account on the server: found, re-enabled, adopted or created (with a one-time reveal). */
  private async ensureAccount(
    exec: DbExecutor,
    engine: ManagedEngine,
    server: ServerRow,
    g: GrantRow,
    person: { id: string; username: string; email: string },
    log: (line: string) => void,
  ): Promise<AccountRow> {
    const [existing] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.serverId, server.id), eq(accounts.userId, person.id)));
    const bare = existing
      ? bareAccountName(existing.name)
      : accountNameFor(server.accountPattern, person, engine);
    if (!bare || !isValidAccountName(engine === 'oracle' ? bare.toUpperCase() : bare, engine))
      throw new Error(
        `No valid account name for ${person.username} from the pattern ${server.accountPattern}`,
      );
    const login = existing?.name ?? loginNameFor(bare, engine, server.authMode, server.windowsDomain);
    const live = await exec.account(login);
    let password: string | null = null;
    let created = false;
    if (!live) {
      password = server.authMode === 'password' ? generatePassword(server.passwordLength, engine) : null;
      const validUntil = g.expiresAt ? g.expiresAt.toISOString() : 'infinity';
      await exec.run(createAccountSteps(engine, { login, mode: server.authMode, password, validUntil }));
      created = true;
      log(`Created account ${login}`);
    } else {
      if (!live.enabled) {
        await exec.run(setEnabledSteps(engine, login, true));
        log(`Re-enabled account ${login}`);
      }
      // An account the platform created that holds nothing any more gets a fresh password (the old one may
      // be long forgotten or leaked), shown once like a new account's.
      if (
        server.authMode === 'password' &&
        existing?.createdByPlatform &&
        !(await this.holdsOther(existing.id, g.id))
      ) {
        password = generatePassword(server.passwordLength, engine);
        await exec.run(setPasswordSteps(engine, login, password));
        log(`Reset the password of ${login}`);
      }
    }
    return this.ctx.transaction(async (tx) => {
      const [row] = existing
        ? await tx
            .update(accounts)
            .set({
              status: 'active',
              disabledAt: null,
              lastError: null,
              ...(created ? { createdByPlatform: true } : {}),
            })
            .where(eq(accounts.id, existing.id))
            .returning()
        : await tx
            .insert(accounts)
            .values({
              serverId: server.id,
              userId: person.id,
              name: login,
              authMode: server.authMode,
              createdByPlatform: created,
            })
            .onConflictDoUpdate({
              target: [accounts.serverId, accounts.name],
              set: { userId: person.id, status: 'active', disabledAt: null },
            })
            .returning();
      const account = row!;
      if (created) {
        await tx
          .insert(inventoryAccounts)
          .values({ serverId: server.id, name: login, kind: 'login', enabled: true, syncedAt: new Date() })
          .onConflictDoNothing();
        await this.ctx.audit.record(
          {
            action: 'dbaccess.account.created',
            entityType: ACCOUNT_ENTITY,
            entityId: account.id,
            entityLabel: login,
            metadata: { server: server.displayName, authMode: server.authMode, userId: person.id },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'dbaccess.account.created',
          { accountId: account.id, serverId: server.id, userId: person.id, name: login },
          { tx },
        );
      } else if (live && (!live.enabled || password)) {
        await this.ctx.audit.record(
          {
            action: 'dbaccess.account.enabled',
            entityType: ACCOUNT_ENTITY,
            entityId: account.id,
            entityLabel: login,
            category: 'security',
            metadata: {
              server: server.displayName,
              reenabled: !live.enabled,
              passwordReset: Boolean(password),
            },
          },
          { tx },
        );
      }
      if (password) {
        // Stored before the role is granted, so a later failure never loses the only copy of the password.
        await tx.insert(reveals).values({
          grantId: g.id,
          accountId: account.id,
          userId: person.id,
          secretSealed: this.ctx.secrets.seal(password),
          expiresAt: new Date(Date.now() + REVEAL_DAYS * DAY_MS),
        });
      }
      await tx.update(grants).set({ accountId: account.id, accountName: login }).where(eq(grants.id, g.id));
      return account;
    });
  }

  /** The account holds (or is getting, or still loses) another grant than `grantId`. */
  private async holdsOther(accountId: string, grantId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ n: count() })
      .from(grants)
      .where(
        and(
          eq(grants.accountId, accountId),
          ne(grants.id, grantId),
          inArray(grants.status, ['provisioning', 'active', 'revoking', 'failed']),
        ),
      );
    return (row?.n ?? 0) > 0;
  }

  /** Records a failed attempt: retries with backoff, or marks the grant failed and alerts the DBAs. */
  private async failed(g: GrantRow, operation: 'grant' | 'revoke', err: unknown, log: (l: string) => void) {
    const message = errorMessage(err);
    const attempts = g.attempts + 1;
    log(`Attempt ${attempts} failed: ${message}`);
    const final = attempts >= MAX_ATTEMPTS;
    await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(grants)
        .set({
          attempts,
          lastAttemptAt: new Date(),
          lastError: message,
          ...(final ? { status: 'failed' as const, operation } : {}),
        })
        .where(
          and(eq(grants.id, g.id), eq(grants.status, operation === 'grant' ? 'provisioning' : 'revoking')),
        )
        .returning();
      if (!row || !final) return;
      const server = (await this.db.select().from(servers).where(eq(servers.id, g.serverId)))[0];
      const role = (
        await this.db.select().from(requestableRoles).where(eq(requestableRoles.id, g.roleId))
      )[0];
      const person = g.userId ? await personById(this.db, g.userId) : null;
      await this.ctx.audit.record(
        {
          action:
            operation === 'grant' ? 'dbaccess.grant.provisioning_failed' : 'dbaccess.grant.revocation_failed',
          entityType: GRANT_ENTITY,
          entityId: g.id,
          entityLabel: `${g.accountName ?? person?.username ?? '?'} → ${role?.roleName ?? '?'}`,
          outcome: 'failure',
          metadata: { attempts, error: message, server: server?.displayName },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'dbaccess.grant.failed',
        {
          grantId: g.id,
          userId: g.userId,
          serverId: g.serverId,
          roleId: g.roleId,
          accountName: g.accountName,
          operation,
          error: message,
        },
        { tx },
      );
      const dbas = server?.ownerGroupId ? await activeMembers(tx, server.ownerGroupId) : [];
      await this.ctx.notifications.notify(
        {
          type: 'dbaccess.provisioning.failed',
          recipients: dbas.length ? dbas : [role?.ownerUserId],
          params: {
            operation,
            role: role?.name ?? g.roleId,
            server: server?.displayName ?? '',
            person: person?.displayName ?? g.accountName ?? '',
            error: message,
          },
          href: '/dbaccess/grants?status=failed',
        },
        { tx },
      );
      if (g.requestId && operation === 'grant') await this.trackRequest(tx, g.requestId, 'failed');
    });
    if (!final) {
      const base = Number(await this.ctx.settings.get<number>('provisioning.retrySeconds')) || 30;
      await this.enqueue(
        operation === 'grant' ? 'provision' : 'revoke',
        g.id,
        retryDelaySeconds(base, attempts),
      );
      return operation === 'grant' ? 'provisioning' : 'revoking';
    }
    return 'failed';
  }

  /* ───────────── revocation ───────────── */

  /**
   * Starts ending a grant (status `revoking`, reason recorded) inside `tx`; the worker removes the role.
   * Returns false when the grant was not live.
   */
  async beginRevoke(
    tx: Db,
    g: GrantRow,
    reason: EndReason,
    note: string | null,
    by: string | null,
  ): Promise<boolean> {
    const [row] = await tx
      .update(grants)
      .set({
        status: 'revoking',
        operation: 'revoke',
        endReason: reason,
        endNote: note,
        endedBy: by,
        attempts: 0,
        lastError: null,
      })
      .where(and(eq(grants.id, g.id), inArray(grants.status, ['provisioning', 'active', 'failed'])))
      .returning();
    if (!row) return false;
    await this.ctx.audit.record(
      {
        action: 'dbaccess.grant.revoke_requested',
        entityType: GRANT_ENTITY,
        entityId: g.id,
        entityLabel: g.accountName ?? g.id,
        metadata: { reason, note },
      },
      { tx },
    );
    return true;
  }

  /** Revokes the role (idempotent), verifies it is gone and closes the grant. */
  async revoke(grantId: string, opts: JobLog = {}): Promise<GrantStatus> {
    const g = await this.row(grantId);
    if (g.status !== 'revoking') return g.status;
    const log = opts.log ?? (() => undefined);
    try {
      const { server, role } = await this.context(g);
      if (g.accountName) {
        const connection = await connectionOf(this.ctx, server.connectionId);
        const exec = new DbExecutor(this.ctx, connection, { signal: opts.signal, log });
        const engine = exec.engine;
        if (!isValidRoleName(role.roleName, engine))
          throw new Error(`Refusing an invalid role name: ${role.roleName}`);
        const target = { login: g.accountName, role: role.roleName, database: role.database };
        if (await exec.isMember(target)) await exec.run(revokeRoleSteps(engine, target));
        if (await exec.isMember(target)) {
          const grantors = engine === 'postgres' ? await exec.grantors(target) : [];
          throw new Error(
            grantors.length
              ? `The membership was granted by ${grantors.join(', ')}: PostgreSQL lets only that role (or a superuser) revoke it`
              : 'The membership is still there after REVOKE (it may have been granted by another role)',
          );
        }
        if (engine === 'postgres' && g.accountId && (await exec.account(g.accountName)))
          await exec.run(validUntilSteps(g.accountName, await this.validUntil(g.accountId, g.id)));
        log(`${g.accountName} is no longer a member of ${role.roleName}`);
      }
      const final: GrantStatus = g.endReason === 'expired' ? 'expired' : 'revoked';
      await this.ctx.transaction(async (tx) => {
        const [done] = await tx
          .update(grants)
          .set({
            status: final,
            endedAt: new Date(),
            attempts: g.attempts + 1,
            lastAttemptAt: new Date(),
            lastError: null,
          })
          .where(and(eq(grants.id, g.id), eq(grants.status, 'revoking')))
          .returning();
        if (!done) return;
        if (g.accountName)
          await tx
            .delete(inventoryMemberships)
            .where(
              and(
                eq(inventoryMemberships.serverId, server.id),
                eq(inventoryMemberships.database, role.database),
                eq(inventoryMemberships.roleName, role.roleName),
                eq(inventoryMemberships.memberName, g.accountName),
              ),
            );
        await this.ctx.audit.record(
          {
            action: final === 'expired' ? 'dbaccess.grant.expired' : 'dbaccess.grant.revoked',
            entityType: GRANT_ENTITY,
            entityId: g.id,
            entityLabel: `${g.accountName ?? '?'} → ${role.roleName}`,
            metadata: {
              server: server.displayName,
              reason: g.endReason,
              note: g.endNote,
              verified: Boolean(g.accountName),
            },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'dbaccess.grant.revoked',
          {
            grantId: g.id,
            userId: g.userId,
            serverId: g.serverId,
            roleId: g.roleId,
            accountName: g.accountName,
            reason: g.endReason ?? 'revoked',
          },
          { tx },
        );
        if (g.userId && g.endReason !== 'relinquished' && g.endReason !== 'offboarded')
          await this.ctx.notifications.notify(
            {
              type: 'dbaccess.grant.revoked',
              recipients: [g.userId],
              params: {
                role: role.name,
                server: server.displayName,
                account: g.accountName ?? '',
                reason: g.endReason ?? 'revoked',
                note: g.endNote ?? '',
              },
              href: '/dbaccess',
            },
            { tx },
          );
        if (g.requestId) await this.trackRequest(tx, g.requestId, final);
      });
      return final;
    } catch (err) {
      return this.failed(g, 'revoke', err, log);
    }
  }

  /** Early revocation by a DBA or the role owner, with a reason. */
  async revokeEarly(id: string, reason: string, auth: AuthContext): Promise<Grant> {
    const g = await this.row(id);
    const role = await this.serversSvc.roleRow(g.roleId);
    const owner = isRoleOwner(personOf(auth), role, await groupsOf(this.db, auth));
    if (!owner) auth.require(PERMISSIONS.grantsManage);
    const started = await this.ctx.transaction((tx) =>
      this.beginRevoke(tx, g, 'revoked', reason, personOf(auth)),
    );
    if (!started) throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This access is not active');
    await this.enqueue('revoke', g.id);
    return this.detail(id, auth);
  }

  /** The grantee gives access back. */
  async relinquish(id: string, reason: string, auth: AuthContext): Promise<Grant> {
    const g = await this.row(id);
    const me = personOf(auth);
    if (!me || g.userId !== me)
      throw httpErrors.forbidden('Only the person who holds this access can give it back');
    const started = await this.ctx.transaction((tx) => this.beginRevoke(tx, g, 'relinquished', reason, me));
    if (!started) throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This access is not active');
    await this.enqueue('revoke', g.id);
    return this.detail(id, auth);
  }

  /** Runs a failed provisioning or revocation again (DBAs). */
  async retry(id: string, auth: AuthContext): Promise<Grant> {
    auth.require(PERMISSIONS.grantsManage);
    const g = await this.row(id);
    if (g.status !== 'failed')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Only failed access can be retried');
    const next = g.operation === 'grant' ? 'provisioning' : 'revoking';
    await this.ctx.transaction(async (tx) => {
      await tx.update(grants).set({ status: next, attempts: 0, lastError: null }).where(eq(grants.id, id));
      await this.ctx.audit.record(
        {
          action: 'dbaccess.grant.retried',
          entityType: GRANT_ENTITY,
          entityId: id,
          entityLabel: g.accountName ?? id,
          metadata: { operation: g.operation, previousError: g.lastError },
        },
        { tx },
      );
      if (g.requestId && g.operation === 'grant') await this.trackRequest(tx, g.requestId, 'provisioning');
    });
    await this.enqueue(g.operation === 'grant' ? 'provision' : 'revoke', id);
    return this.detail(id, auth);
  }

  /** PostgreSQL: moves `VALID UNTIL` after an extension (other engines keep no password expiry here). */
  async refreshValidity(grantId: string) {
    const g = await this.row(grantId);
    if (!g.accountId || !g.accountName) return;
    const { server } = await this.context(g);
    const exec = new DbExecutor(this.ctx, await connectionOf(this.ctx, server.connectionId));
    if (exec.engine !== 'postgres') return;
    await exec.run(validUntilSteps(g.accountName, await this.validUntil(g.accountId)));
  }

  /* ───────────── reveal ───────────── */

  /** The generated password, once, to the grantee only (audited); then 410 REVEAL_EXPIRED. */
  async reveal(revealId: string, auth: AuthContext): Promise<Reveal> {
    const me = personOf(auth);
    const [r] = await this.db.select().from(reveals).where(eq(reveals.id, revealId));
    if (!r || !me || r.userId !== me) throw httpErrors.notFound('Nothing to reveal');
    const [opened] = await this.db
      .update(reveals)
      .set({ viewedAt: new Date(), secretSealed: null })
      .where(
        and(
          eq(reveals.id, revealId),
          isNull(reveals.viewedAt),
          isNotNull(reveals.secretSealed),
          gt(reveals.expiresAt, new Date()),
        ),
      )
      .returning({ id: reveals.id });
    if (!opened || !r.secretSealed) {
      await this.ctx.audit.record({
        action: 'dbaccess.credential.revealed',
        entityType: ACCOUNT_ENTITY,
        entityId: r.accountId,
        outcome: 'denied',
        category: 'security',
        metadata: { revealId, reason: r.viewedAt ? 'already_viewed' : 'expired' },
      });
      throw new HttpError(410, ErrorCodes.REVEAL_EXPIRED, 'This password was already shown or has expired');
    }
    const password = this.ctx.secrets.open(r.secretSealed);
    const [account] = await this.db.select().from(accounts).where(eq(accounts.id, r.accountId));
    const [server] = await this.db.select().from(servers).where(eq(servers.id, account!.serverId));
    const connection = await this.ctx.databases.get(server!.connectionId);
    await this.ctx.audit.record({
      action: 'dbaccess.credential.revealed',
      entityType: ACCOUNT_ENTITY,
      entityId: account!.id,
      entityLabel: account!.name,
      category: 'security',
      metadata: { revealId, grantId: r.grantId, server: server!.displayName },
    });
    return {
      accountName: account!.name,
      password,
      server: serverRef(server!),
      connection: {
        engine: (connection?.engine ?? server!.engine) as Reveal['connection']['engine'],
        host: connection?.host ?? '',
        port: connection?.port ?? null,
        database: connection?.database ?? null,
      },
    };
  }

  /* ───────────── lifecycle jobs ───────────── */

  /**
   * Every 5 minutes: expired grants start revoking, grantees ending soon get a reminder, reveals past their
   * week are wiped, and work stuck in the queue (lost jobs) is enqueued again.
   */
  async sweep(log: (l: string) => void = () => undefined) {
    const now = new Date();
    const expired = await this.db
      .select()
      .from(grants)
      .where(and(eq(grants.status, 'active'), isNotNull(grants.expiresAt), lte(grants.expiresAt, now)));
    for (const g of expired) {
      const started = await this.ctx.transaction((tx) => this.beginRevoke(tx, g, 'expired', null, null));
      if (started) await this.enqueue('revoke', g.id);
    }
    const soon = new Date(now.getTime() + EXPIRING_DAYS * DAY_MS);
    const ending = await this.db
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.status, 'active'),
          isNotNull(grants.expiresAt),
          lte(grants.expiresAt, soon),
          gt(grants.expiresAt, now),
          isNull(grants.expiryRemindedAt),
        ),
      );
    for (const g of ending) {
      const { server, role } = await this.context(g);
      await this.ctx.transaction(async (tx) => {
        const [claimed] = await tx
          .update(grants)
          .set({ expiryRemindedAt: now })
          .where(and(eq(grants.id, g.id), isNull(grants.expiryRemindedAt)))
          .returning();
        if (!claimed || !g.userId) return;
        await this.ctx.notifications.notify(
          {
            type: 'dbaccess.grant.expiring',
            recipients: [g.userId],
            params: { role: role.name, server: server.displayName, expiresAt: g.expiresAt },
            href: `/dbaccess/request?extend=${g.id}`,
          },
          { tx },
        );
      });
    }
    await this.db
      .update(reveals)
      .set({ secretSealed: null })
      .where(and(isNotNull(reveals.secretSealed), lte(reveals.expiresAt, now)));
    const stuck = await this.db
      .select({ id: grants.id, status: grants.status })
      .from(grants)
      .where(
        and(
          inArray(grants.status, ['provisioning', 'revoking']),
          lte(grants.updatedAt, new Date(now.getTime() - STUCK_MS)),
        ),
      );
    for (const s of stuck) {
      await this.db.update(grants).set({ updatedAt: now }).where(eq(grants.id, s.id));
      await this.enqueue(s.status === 'provisioning' ? 'provision' : 'revoke', s.id);
    }
    log(`${expired.length} expired, ${ending.length} reminded, ${stuck.length} re-queued`);
    return { expired: expired.length, reminded: ending.length, requeued: stuck.length };
  }

  /** `core.user.offboarded`: every grant of the person is revoked and their accounts are disabled. */
  async offboard(userId: string) {
    const live = await this.db
      .select()
      .from(grants)
      .where(and(eq(grants.userId, userId), inArray(grants.status, ['provisioning', 'active', 'failed'])));
    const started: string[] = [];
    await this.ctx.transaction(async (tx) => {
      for (const g of live) if (await this.beginRevoke(tx, g, 'offboarded', null, null)) started.push(g.id);
      // Pending requests of a leaver are withdrawn.
      const pending = await tx
        .select()
        .from(requests)
        .where(and(eq(requests.requesterId, userId), eq(requests.status, 'pending')));
      for (const r of pending) {
        await tx
          .update(requests)
          .set({ status: 'cancelled', decidedAt: new Date(), decisionComment: 'Offboarded' })
          .where(eq(requests.id, r.id));
        if (r.instanceId)
          await this.ctx.workflows.cancel(r.instanceId, 'The requester was offboarded', { tx });
      }
    });
    for (const id of started) await this.enqueue('revoke', id);
    await this.ctx.jobs.enqueue('disable-accounts', { userId });
    return started.length;
  }

  /** Disables (never drops) a person's accounts: `NOLOGIN`, `ALTER LOGIN … DISABLE`, `ACCOUNT LOCK`. */
  async disableAccounts(userId: string, opts: JobLog = {}): Promise<{ disabled: number; failed: number }> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.status, 'active')));
    let disabled = 0;
    let failed = 0;
    for (const a of rows) {
      const [server] = await this.db.select().from(servers).where(eq(servers.id, a.serverId));
      try {
        const connection = await connectionOf(this.ctx, server!.connectionId);
        const exec = new DbExecutor(this.ctx, connection, opts);
        if (await exec.account(a.name)) await exec.run(setEnabledSteps(exec.engine, a.name, false));
        await this.ctx.transaction(async (tx) => {
          await tx
            .update(accounts)
            .set({ status: 'disabled', disabledAt: new Date(), lastError: null })
            .where(eq(accounts.id, a.id));
          await tx
            .update(inventoryAccounts)
            .set({ enabled: false })
            .where(and(eq(inventoryAccounts.serverId, a.serverId), eq(inventoryAccounts.name, a.name)));
          await this.ctx.audit.record(
            {
              action: 'dbaccess.account.disabled',
              entityType: ACCOUNT_ENTITY,
              entityId: a.id,
              entityLabel: a.name,
              metadata: { server: server!.displayName, reason: 'offboarded' },
            },
            { tx },
          );
          await this.ctx.events.publish(
            'dbaccess.account.disabled',
            { accountId: a.id, serverId: a.serverId, userId: a.userId, name: a.name },
            { tx },
          );
        });
        disabled++;
      } catch (err) {
        failed++;
        await this.db
          .update(accounts)
          .set({ lastError: errorMessage(err) })
          .where(eq(accounts.id, a.id));
      }
    }
    if (failed) throw new Error(`${failed} account(s) could not be disabled yet`);
    return { disabled, failed };
  }

  /* ───────────── drift actions ───────────── */

  private async unmanagedTarget(input: { serverId: string; roleId: string; memberName: string }) {
    const server = await this.serversSvc.row(input.serverId);
    const role = await this.serversSvc.roleRow(input.roleId);
    if (role.serverId !== server.id) throw httpErrors.badRequest('The role belongs to another server');
    const drift = await this.serversSvc.drift(server, await this.ctx.databases.get(server.connectionId));
    const key = nameKey(drift.engine, input.memberName);
    const found = drift.unmanaged.find(
      (u) => u.roleId === role.id && nameKey(drift.engine, u.memberName) === key,
    );
    if (!found)
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        'This membership is not unmanaged access (sync the server?)',
      );
    return { server, role, drift, memberName: found.memberName };
  }

  /** Adopts unmanaged access: a grant for a person (and their account), with an owner-defined expiry. */
  async adopt(
    input: AdoptInput & { serverId: string; roleId: string; memberName: string; userId: string },
    auth: AuthContext,
  ) {
    auth.require(PERMISSIONS.grantsManage);
    const { server, role, memberName } = await this.unmanagedTarget(input);
    const person = await personById(this.db, input.userId);
    if (!person || person.status !== 'active')
      throw new HttpError(
        409,
        ErrorCodes.PRINCIPAL_OFFBOARDED,
        'Access can only be adopted for active people',
      );
    const expiresOn = input.expiresOn ?? null;
    const today = todayIn(auth.user?.timezone ?? 'UTC');
    if (checkDuration(role, expiresOn, today) !== 'ok')
      throw new HttpError(409, ErrorCodes.DURATION_TOO_LONG, 'The end date is outside what the role allows', {
        maxDays: role.maxDays,
        allowPermanent: role.allowPermanent,
      });
    const row = await this.ctx.transaction(async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({
          serverId: server.id,
          userId: person.id,
          name: memberName,
          authMode: server.authMode,
          createdByPlatform: false,
        })
        .onConflictDoUpdate({ target: [accounts.serverId, accounts.name], set: { userId: person.id } })
        .returning();
      const [g] = await tx
        .insert(grants)
        .values({
          serverId: server.id,
          roleId: role.id,
          userId: person.id,
          accountId: account!.id,
          accountName: memberName,
          source: 'adopted',
          status: 'active',
          operation: 'grant',
          grantedAt: new Date(),
          expiresAt: grantExpiry(expiresOn, role, auth.user?.timezone ?? 'UTC'),
          endNote: input.note ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'dbaccess.grant.adopted',
          entityType: GRANT_ENTITY,
          entityId: g!.id,
          entityLabel: `${memberName} → ${role.roleName}`,
          metadata: {
            server: server.displayName,
            userId: person.id,
            expiresAt: g!.expiresAt?.toISOString() ?? null,
            note: input.note ?? null,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'dbaccess.grant.adopted',
        { grantId: g!.id, userId: person.id, serverId: server.id, roleId: role.id, accountName: memberName },
        { tx },
      );
      return g!;
    });
    return (await this.toDtos([row], auth))[0]!;
  }

  /** Revokes unmanaged access through the worker (recorded as a grant ending, so history shows it). */
  async revokeUnmanaged(
    input: RevokeUnmanagedInput & { serverId: string; roleId: string; memberName: string; reason: string },
    auth: AuthContext,
  ) {
    auth.require(PERMISSIONS.grantsManage);
    const { server, role, drift, memberName } = await this.unmanagedTarget(input);
    const match = drift.people.get(nameKey(drift.engine, bareAccountName(memberName)));
    const row = await this.ctx.transaction(async (tx) => {
      const [g] = await tx
        .insert(grants)
        .values({
          serverId: server.id,
          roleId: role.id,
          userId: match?.userId ?? null,
          accountName: memberName,
          source: 'unmanaged',
          status: 'revoking',
          operation: 'revoke',
          endReason: 'revoked',
          endNote: input.reason,
          endedBy: personOf(auth),
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'dbaccess.grant.revoke_requested',
          entityType: GRANT_ENTITY,
          entityId: g!.id,
          entityLabel: `${memberName} → ${role.roleName}`,
          metadata: { server: server.displayName, unmanaged: true, reason: input.reason },
        },
        { tx },
      );
      return g!;
    });
    await this.enqueue('revoke', row.id);
    return (await this.toDtos([row], auth))[0]!;
  }

  /* ───────────── portal ───────────── */

  /** Keeps the request's "My requests" entry in step with its grant. */
  async trackRequest(
    tx: Db,
    requestId: string,
    grantState: GrantStatus | 'pending' | 'rejected' | 'cancelled',
  ) {
    const [r] = await tx.select().from(requests).where(eq(requests.id, requestId));
    if (!r) return;
    const [role] = await tx.select().from(requestableRoles).where(eq(requestableRoles.id, r.roleId));
    const [server] = await tx.select().from(servers).where(eq(servers.id, r.serverId));
    if (!role || !server) return;
    const closed = !['pending', 'provisioning'].includes(grantState);
    const tone =
      grantState === 'active'
        ? 'success'
        : grantState === 'failed' || grantState === 'rejected'
          ? 'danger'
          : grantState === 'pending' || grantState === 'provisioning'
            ? 'info'
            : 'neutral';
    await this.ctx.portal.track(
      {
        kind: 'dbaccess.request',
        id: r.id,
        reference: formatRequestRef(r.number),
        title: Object.fromEntries(
          (['en', 'zh-TW', 'ja-JP'] as const).map((l) => [
            l,
            `${role.name[l] || role.name.en || role.roleName} · ${server.displayName}`,
          ]),
        ),
        state: closed ? 'closed' : 'open',
        statusKey: `dbaccess.portalStatus.${grantState}`,
        tone,
        href: `/dbaccess/requests/${formatRequestRef(r.number)}`,
        icon: 'database',
        people: [r.requesterId],
        createdAt: r.createdAt,
      },
      { tx },
    );
  }
}
