import type {
  appMembersQuerySchema,
  createApiClientSchema,
  createAppPermissionSchema,
  createApplicationSchema,
  createAppRoleSchema,
  roleQueryCheckSchema,
  roleQueryMembersQuerySchema,
  updateApiClientSchema,
  updateApplicationSchema,
} from '@isbp/contracts';
import {
  apiClientSecrets,
  apiClients,
  applications,
  departments,
  permissions,
  rolePermissions,
  roles,
  users,
} from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  type Grant,
  HttpError,
  httpErrors,
  matchPermission,
  type ModuleContext,
  patternCovers,
  PermissionSet,
} from '@isbp/sdk/server';
import { and, asc, count, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { generateClientId, generateSecret } from '../../kernel/api-clients';
import { EVERYONE_GROUP_KEY, PLATFORM_APP_KEY } from '../../kernel/rbac';
import { getKernel } from '../kernel-ref';
import { likePattern, pageOffset } from '../util';
import type { AccessService } from './access';
import { peopleById, ref } from './people';

type AppRow = typeof applications.$inferSelect;
type ClientRow = typeof apiClients.$inferSelect;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

type AccessRow = {
  role_key: string;
  role_name: string;
  permission: string | null;
  user_id: string | null;
  group_key: string | null;
  group_name: string | null;
  scope_type: 'global' | 'department' | 'record';
  scope_department_id: string | null;
  department_path: string | null;
  department_code: string | null;
  scope_record_type: string | null;
  scope_record_id: string | null;
  expires_at: Date | null;
};

interface QueryScope {
  type: AccessRow['scope_type'];
  departmentId: string | null;
  departmentCode: string | null;
  recordType: string | null;
  recordId: string | null;
}

/* ───────────────────────────── applications ───────────────────────────── */

/** External applications, their permission catalogs and roles (answered by the Role Query API). */
export class ApplicationService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly access: AccessService,
  ) {}

  private get db() {
    return this.ctx.db;
  }

  private async dtos(rows: AppRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [roleCounts, permCounts, memberCounts, clientRows] = await Promise.all([
      this.db
        .select({ id: roles.applicationId, n: count() })
        .from(roles)
        .where(inArray(roles.applicationId, ids))
        .groupBy(roles.applicationId),
      this.db
        .select({ id: permissions.applicationId, n: count() })
        .from(permissions)
        .where(and(inArray(permissions.applicationId, ids), eq(permissions.deprecated, false)))
        .groupBy(permissions.applicationId),
      this.db.execute<{ id: string; n: number }>(sql`
        select r.application_id as id, count(distinct coalesce(ra.user_id, gm.user_id))::int as n
          from core.role_assignments ra
          join core.roles r on r.id = ra.role_id
          left join core.group_members gm on gm.group_id = ra.group_id
         where r.application_id in (${sql.join(
           ids.map((id) => sql`${id}`),
           sql`, `,
         )}) and (ra.expires_at is null or ra.expires_at > now())
         group by r.application_id`),
      this.db
        .select({ ids: apiClients.applicationIds, all: apiClients.allApplications })
        .from(apiClients)
        .where(isNull(apiClients.revokedAt)),
    ]);
    const people = await peopleById(
      this.db,
      rows.map((r) => r.ownerId),
    );
    return rows.map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      homepageUrl: a.homepageUrl,
      owner: ref(people, a.ownerId),
      isSystem: a.isSystem,
      counts: {
        roles: roleCounts.find((c) => c.id === a.id)?.n ?? 0,
        permissions: permCounts.find((c) => c.id === a.id)?.n ?? 0,
        members: memberCounts.rows.find((c) => c.id === a.id)?.n ?? 0,
        clients: clientRows.filter((c) => c.all || c.ids.includes(a.id)).length,
      },
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  }

  async list(q: { q?: string }, auth: AuthContext) {
    const reach = auth.reach('core.applications.read');
    const visible = reach.global
      ? undefined
      : inArray(
          applications.id,
          reach.records
            .filter((r) => r.type === 'application')
            .map((r) => r.id)
            .concat('00000000-0000-0000-0000-000000000000'),
        );
    const rows = await this.db
      .select()
      .from(applications)
      .where(
        and(
          visible,
          q.q
            ? or(ilike(applications.name, likePattern(q.q)), ilike(applications.key, likePattern(q.q)))
            : undefined,
        ),
      )
      .orderBy(sql`${applications.isSystem} desc`, asc(applications.name));
    return this.dtos(rows);
  }

  async find(id: string): Promise<AppRow> {
    const [a] = await this.db.select().from(applications).where(eq(applications.id, id));
    if (!a) throw httpErrors.notFound('Application not found');
    return a;
  }

  async get(id: string, auth: AuthContext) {
    auth.require('core.applications.read', { recordType: 'application', recordId: id });
    return (await this.dtos([await this.find(id)]))[0]!;
  }

  private requireManage(id: string, auth: AuthContext) {
    auth.require('core.applications.manage', { recordType: 'application', recordId: id });
  }

  private assertExternal(a: AppRow) {
    if (a.isSystem)
      throw new HttpError(409, ErrorCodes.SYSTEM_ROLE_READONLY, 'The platform is managed on the Roles page');
  }

  async create(input: z.output<typeof createApplicationSchema>, auth: AuthContext) {
    auth.require('core.applications.manage');
    if (input.key === PLATFORM_APP_KEY) throw httpErrors.conflict('This key is reserved');
    const row = await this.ctx.transaction(async (tx) => {
      const [a] = await tx
        .insert(applications)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          homepageUrl: input.homepageUrl ?? null,
          ownerId: input.ownerId ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.application.created',
          entityType: 'application',
          entityId: a!.id,
          entityLabel: a!.name,
        },
        { tx },
      );
      await this.ctx.events.publish('core.application.created', { applicationId: a!.id }, { tx });
      return a!;
    });
    return (await this.dtos([row]))[0]!;
  }

  async update(id: string, input: z.output<typeof updateApplicationSchema>, auth: AuthContext) {
    this.requireManage(id, auth);
    const before = await this.find(id);
    this.assertExternal(before);
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    await this.ctx.transaction(async (tx) => {
      await tx.update(applications).set(input).where(eq(applications.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.application.updated',
          entityType: 'application',
          entityId: id,
          entityLabel: input.name ?? before.name,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish('core.application.updated', { applicationId: id }, { tx });
    });
    return this.get(id, auth);
  }

  async remove(id: string, auth: AuthContext) {
    auth.require('core.applications.manage');
    const a = await this.find(id);
    this.assertExternal(a);
    // Its roles go with it, and access requests for them must stay on record.
    const own = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.applicationId, id));
    await this.access.assertNoRequestHistory(own.map((r) => r.id));
    await this.ctx.transaction(async (tx) => {
      await tx.delete(applications).where(eq(applications.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.application.deleted',
          category: 'security',
          entityType: 'application',
          entityId: id,
          entityLabel: a.name,
        },
        { tx },
      );
      await this.ctx.events.publish('core.application.deleted', { applicationId: id }, { tx });
    });
    await getKernel().rbac.bump();
  }

  /* ───────────── permission catalog ───────────── */

  async permissions(id: string, auth: AuthContext) {
    auth.require('core.applications.read', { recordType: 'application', recordId: id });
    const [rows, rolePerms] = await Promise.all([
      this.db
        .select()
        .from(permissions)
        .where(and(eq(permissions.applicationId, id), eq(permissions.deprecated, false)))
        .orderBy(asc(permissions.key)),
      this.db
        .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
        .where(eq(roles.applicationId, id)),
    ]);
    return rows.map((p) => ({
      id: p.id,
      key: p.key,
      description: p.description,
      roleCount: new Set(
        rolePerms.filter((rp) => matchPermission(rp.permission, p.key)).map((rp) => rp.roleId),
      ).size,
    }));
  }

  async addPermission(id: string, input: z.output<typeof createAppPermissionSchema>, auth: AuthContext) {
    this.requireManage(id, auth);
    this.assertExternal(await this.find(id));
    await this.ctx.transaction(async (tx) => {
      await tx
        .insert(permissions)
        .values({
          applicationId: id,
          key: input.key,
          description: input.description,
          scopes: ['global', 'department', 'record'],
        })
        .onConflictDoUpdate({
          target: [permissions.applicationId, permissions.key],
          set: { description: input.description, deprecated: false },
        });
      await this.ctx.audit.record(
        {
          action: 'core.application.permission_added',
          entityType: 'application',
          entityId: id,
          metadata: { key: input.key },
        },
        { tx },
      );
    });
    return this.permissions(id, auth);
  }

  async removePermission(id: string, permissionId: string, auth: AuthContext) {
    this.requireManage(id, auth);
    this.assertExternal(await this.find(id));
    const [p] = await this.db
      .select()
      .from(permissions)
      .where(and(eq(permissions.id, permissionId), eq(permissions.applicationId, id)));
    if (!p) throw httpErrors.notFound('Permission not found');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(permissions).where(eq(permissions.id, permissionId));
      await this.ctx.audit.record(
        {
          action: 'core.application.permission_removed',
          entityType: 'application',
          entityId: id,
          metadata: { key: p.key },
        },
        { tx },
      );
    });
  }

  /* ───────────── roles ───────────── */

  async roles(id: string, auth: AuthContext) {
    auth.require('core.applications.read', { recordType: 'application', recordId: id });
    await this.find(id);
    return this.access.listRoles({}, id);
  }

  async createRole(id: string, input: z.output<typeof createAppRoleSchema>, auth: AuthContext) {
    this.requireManage(id, auth);
    this.assertExternal(await this.find(id));
    return this.access.createRole(input, auth, id);
  }

  async updateRole(
    id: string,
    roleId: string,
    input: z.output<typeof createAppRoleSchema>,
    auth: AuthContext,
  ) {
    this.requireManage(id, auth);
    const { key: _key, ...rest } = input;
    return this.access.updateRole(roleId, rest, auth, { applicationId: id });
  }

  async deleteRole(id: string, roleId: string, auth: AuthContext) {
    this.requireManage(id, auth);
    await this.access.deleteRole(roleId, { applicationId: id });
  }

  members(id: string, q: z.output<typeof appMembersQuerySchema>, auth: AuthContext) {
    auth.require('core.applications.read', { recordType: 'application', recordId: id });
    return this.access.listAssignments(
      { page: q.page, pageSize: q.pageSize, q: q.q, sort: q.sort, roleId: q.roleId, includeExpired: false },
      auth,
      { applicationId: id },
    );
  }
}

/* ───────────────────────────── API clients ───────────────────────────── */

export class ApiClientService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  /** Clients act as service principals: you can only give them platform permissions you hold. */
  private assertCanGrant(patterns: string[], auth: AuthContext) {
    const held = auth.permissions.grants.filter((g) => g.s === 'g').map((g) => g.p);
    const missing = patterns.filter((p) => !held.some((h) => patternCovers(h, p)));
    if (missing.length)
      throw new HttpError(
        403,
        ErrorCodes.PRIVILEGE_ESCALATION,
        'You cannot grant permissions you do not hold',
        { missing },
      );
  }

  private async dtos(rows: ClientRow[]) {
    if (!rows.length) return [];
    const appIds = [...new Set(rows.flatMap((r) => r.applicationIds))];
    const [apps, secrets] = await Promise.all([
      appIds.length
        ? this.db
            .select({ id: applications.id, key: applications.key, name: applications.name })
            .from(applications)
            .where(inArray(applications.id, appIds))
        : Promise.resolve([]),
      this.db
        .select()
        .from(apiClientSecrets)
        .where(
          inArray(
            apiClientSecrets.apiClientId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(apiClientSecrets.createdAt)),
    ]);
    const people = await peopleById(
      this.db,
      rows.map((r) => r.createdBy),
    );
    const now = Date.now();
    return rows.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      name: c.name,
      description: c.description,
      applications: c.applicationIds
        .map((id) => apps.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a)),
      allApplications: c.allApplications,
      permissions: c.permissions,
      allowedCidrs: c.allowedCidrs,
      revokedAt: c.revokedAt,
      lastUsedAt: c.lastUsedAt,
      lastUsedIp: c.lastUsedIp,
      createdAt: c.createdAt,
      createdBy: ref(people, c.createdBy),
      secrets: secrets
        .filter((s) => s.apiClientId === c.id)
        .map((s) => ({
          id: s.id,
          prefix: s.prefix,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          lastUsedAt: s.lastUsedAt,
          revokedAt: s.revokedAt,
          active: !s.revokedAt && (!s.expiresAt || s.expiresAt.getTime() > now) && !c.revokedAt,
        })),
    }));
  }

  async list() {
    const rows = await this.db
      .select()
      .from(apiClients)
      .orderBy(sql`${apiClients.revokedAt} is not null`, asc(apiClients.name));
    return this.dtos(rows);
  }

  private async find(id: string) {
    const [c] = await this.db.select().from(apiClients).where(eq(apiClients.id, id));
    if (!c) throw httpErrors.notFound('API client not found');
    return c;
  }

  async get(id: string) {
    return (await this.dtos([await this.find(id)]))[0]!;
  }

  private async assertApps(ids: string[]) {
    if (!ids.length) return;
    const found = await this.db
      .select({ id: applications.id })
      .from(applications)
      .where(inArray(applications.id, ids));
    if (found.length !== new Set(ids).size) throw httpErrors.badRequest('Unknown application');
  }

  async create(input: z.output<typeof createApiClientSchema>, auth: AuthContext) {
    this.assertCanGrant(input.permissions, auth);
    await this.assertApps(input.applicationIds);
    const secret = generateSecret();
    const row = await this.ctx.transaction(async (tx) => {
      const [c] = await tx
        .insert(apiClients)
        .values({
          clientId: generateClientId(),
          name: input.name,
          description: input.description ?? null,
          applicationIds: [...new Set(input.applicationIds)],
          allApplications: input.allApplications,
          permissions: [...new Set(input.permissions)],
          allowedCidrs: input.allowedCidrs,
          createdBy: auth.user?.id ?? null,
        })
        .returning();
      await tx.insert(apiClientSecrets).values({
        apiClientId: c!.id,
        prefix: secret.prefix,
        secretHash: secret.hash,
        expiresAt: input.secretExpiresInDays ? new Date(Date.now() + input.secretExpiresInDays * DAY) : null,
        createdBy: auth.user?.id ?? null,
      });
      await this.ctx.audit.record(
        {
          action: 'core.api-client.created',
          category: 'security',
          entityType: 'api_client',
          entityId: c!.id,
          entityLabel: c!.name,
          metadata: {
            clientId: c!.clientId,
            applications: input.allApplications ? 'all' : input.applicationIds,
            permissions: input.permissions,
          },
        },
        { tx },
      );
      await this.ctx.events.publish('core.api-client.created', { apiClientId: c!.id }, { tx });
      return c!;
    });
    return { client: await this.get(row.id), secret: secret.secret };
  }

  async update(id: string, input: z.output<typeof updateApiClientSchema>, auth: AuthContext) {
    const before = await this.find(id);
    if (before.revokedAt)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Revoked clients cannot be changed');
    if (input.permissions)
      this.assertCanGrant(
        input.permissions.filter((p) => !before.permissions.includes(p)),
        auth,
      );
    if (input.applicationIds) await this.assertApps(input.applicationIds);
    const patch = {
      name: input.name,
      description: input.description,
      applicationIds: input.applicationIds ? [...new Set(input.applicationIds)] : undefined,
      allApplications: input.allApplications,
      permissions: input.permissions ? [...new Set(input.permissions)] : undefined,
      allowedCidrs: input.allowedCidrs,
    };
    await this.ctx.transaction(async (tx) => {
      await tx.update(apiClients).set(patch).where(eq(apiClients.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.api-client.updated',
          category: 'security',
          entityType: 'api_client',
          entityId: id,
          entityLabel: input.name ?? before.name,
          changes: this.ctx.audit.diff(
            before as unknown as Record<string, unknown>,
            patch as Record<string, unknown>,
          ),
        },
        { tx },
      );
      await this.ctx.events.publish('core.api-client.updated', { apiClientId: id }, { tx });
    });
    // Access tokens carry the client's reach — reissue after any change.
    await getKernel().apiClients.revokeTokens(id);
    return this.get(id);
  }

  async rotate(id: string, expiresInDays: number | null | undefined, auth: AuthContext) {
    const c = await this.find(id);
    if (c.revokedAt)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Revoked clients cannot get new secrets');
    const secret = generateSecret();
    await this.ctx.transaction(async (tx) => {
      await tx.insert(apiClientSecrets).values({
        apiClientId: id,
        prefix: secret.prefix,
        secretHash: secret.hash,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * DAY) : null,
        createdBy: auth.user?.id ?? null,
      });
      await this.ctx.audit.record(
        {
          action: 'core.api-client.secret_created',
          category: 'security',
          entityType: 'api_client',
          entityId: id,
          entityLabel: c.name,
          metadata: { prefix: secret.prefix },
        },
        { tx },
      );
    });
    return { client: await this.get(id), secret: secret.secret };
  }

  async revokeSecret(id: string, secretId: string) {
    const c = await this.find(id);
    const [s] = await this.db
      .select()
      .from(apiClientSecrets)
      .where(and(eq(apiClientSecrets.id, secretId), eq(apiClientSecrets.apiClientId, id)));
    if (!s) throw httpErrors.notFound('Secret not found');
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(apiClientSecrets)
        .set({ revokedAt: new Date() })
        .where(eq(apiClientSecrets.id, secretId));
      await this.ctx.audit.record(
        {
          action: 'core.api-client.secret_revoked',
          category: 'security',
          entityType: 'api_client',
          entityId: id,
          entityLabel: c.name,
          metadata: { prefix: s.prefix },
        },
        { tx },
      );
    });
    await getKernel().apiClients.revokeTokens(id);
    return this.get(id);
  }

  async revoke(id: string) {
    const c = await this.find(id);
    if (c.revokedAt) return this.get(id);
    await this.ctx.transaction(async (tx) => {
      await tx.update(apiClients).set({ revokedAt: new Date() }).where(eq(apiClients.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.api-client.revoked',
          category: 'security',
          entityType: 'api_client',
          entityId: id,
          entityLabel: c.name,
        },
        { tx },
      );
      await this.ctx.events.publish('core.api-client.revoked', { apiClientId: id }, { tx });
    });
    await getKernel().apiClients.revokeTokens(id);
    return this.get(id);
  }
}

/* ───────────────────────────── Role Query API ───────────────────────────── */

/** "What roles and permissions does user X have in application Y?" — for external applications. */
export class RoleQueryService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  async app(key: string, auth: AuthContext) {
    const [a] = await this.db.select().from(applications).where(eq(applications.key, key));
    // Same answer for "unknown" and "not yours", so clients can't enumerate applications.
    if (!a || !auth.can('core.role-query.read', { recordType: 'application', recordId: a.id }))
      throw httpErrors.notFound('Application not found');
    return a;
  }

  async user(identifier: string) {
    const id = identifier.trim();
    const where = UUID_RE.test(id)
      ? eq(users.id, id)
      : id.includes('@')
        ? sql`lower(${users.email}) = lower(${id})`
        : sql`lower(${users.username}) = lower(${id})`;
    const [u] = await this.db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        deptId: departments.id,
        deptCode: departments.code,
        deptName: departments.name,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(where);
    if (!u) throw httpErrors.notFound('User not found');
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
      department: u.deptId ? { id: u.deptId, code: u.deptCode!, name: u.deptName! } : null,
    };
  }

  private async rows(userId: string, appId: string): Promise<AccessRow[]> {
    const kernel = getKernel();
    const version = (await kernel.redis.get('isbp:rbac:version')) ?? '0';
    const cacheKey = `isbp:rq:${appId}:${userId}:${version}`;
    const cached = await kernel.redis.get(cacheKey);
    if (cached)
      return (JSON.parse(cached) as AccessRow[]).map((r) => ({
        ...r,
        expires_at: r.expires_at ? new Date(r.expires_at) : null,
      }));
    const res = await this.db.execute<AccessRow>(sql`
      select r.key as role_key, r.name as role_name, rp.permission,
             ra.user_id, g.key as group_key, g.name as group_name,
             ra.scope_type, ra.scope_department_id, d.path as department_path, d.code as department_code,
             ra.scope_record_type, ra.scope_record_id, ra.expires_at
        from core.role_assignments ra
        join core.roles r on r.id = ra.role_id and r.application_id = ${appId}
        left join core.role_permissions rp on rp.role_id = r.id
        left join core.groups g on g.id = ra.group_id
        left join core.departments d on d.id = ra.scope_department_id
       where (ra.expires_at is null or ra.expires_at > now())
         and (ra.user_id = ${userId}
              or ra.group_id in (select gm.group_id from core.group_members gm where gm.user_id = ${userId})
              or ra.group_id in (select eg.id from core.groups eg where eg.key = ${EVERYONE_GROUP_KEY} and eg.is_system))
       order by r.key, rp.permission`);
    await kernel.redis.set(cacheKey, JSON.stringify(res.rows), 'EX', 60);
    return res.rows;
  }

  private scope(r: AccessRow): QueryScope {
    return {
      type: r.scope_type,
      departmentId: r.scope_department_id,
      departmentCode: r.department_code,
      recordType: r.scope_record_type,
      recordId: r.scope_record_id,
    };
  }

  private source(r: AccessRow) {
    return r.user_id
      ? ('direct' as const)
      : r.group_key === EVERYONE_GROUP_KEY
        ? ('everyone' as const)
        : ('group' as const);
  }

  async access(userIdent: string, appKey: string, auth: AuthContext) {
    const app = await this.app(appKey, auth);
    const user = await this.user(userIdent);
    const active = user.status === 'active';
    const rows = active ? await this.rows(user.id, app.id) : [];
    const catalog = (
      await this.db
        .select({ key: permissions.key })
        .from(permissions)
        .where(and(eq(permissions.applicationId, app.id), eq(permissions.deprecated, false)))
    ).map((p) => p.key);

    const roleMap = new Map<string, ReturnType<RoleQueryService['roleOut']>>();
    for (const r of rows) {
      const key = `${r.role_key}|${r.scope_type}|${r.scope_department_id}|${r.scope_record_id}|${r.group_key}`;
      if (!roleMap.has(key)) roleMap.set(key, this.roleOut(r));
    }
    const expand = (pattern: string) => {
      const hits = catalog.filter((k) => matchPermission(pattern, k));
      return hits.length ? hits : pattern.includes('*') ? [] : [pattern];
    };
    const global = new Set<string>();
    const scoped = new Map<string, { permission: string; scope: QueryScope }>();
    for (const r of rows) {
      if (!r.permission) continue;
      for (const p of expand(r.permission)) {
        if (r.scope_type === 'global') global.add(p);
        else
          scoped.set(`${p}|${r.scope_type}|${r.scope_department_id}|${r.scope_record_id}`, {
            permission: p,
            scope: this.scope(r),
          });
      }
    }
    return {
      user,
      application: { key: app.key, name: app.name },
      active,
      roles: [...roleMap.values()],
      permissions: [...global].sort(),
      scopedPermissions: [...scoped.values()].filter((s) => !global.has(s.permission)),
      evaluatedAt: new Date(),
    };
  }

  private roleOut(r: AccessRow) {
    return {
      key: r.role_key,
      name: r.role_name,
      scope: this.scope(r),
      expiresAt: r.expires_at ? new Date(r.expires_at) : null,
      source: this.source(r),
      group: r.group_key ? { key: r.group_key, name: r.group_name ?? r.group_key } : null,
    };
  }

  async check(input: z.output<typeof roleQueryCheckSchema>, auth: AuthContext) {
    const app = await this.app(input.application, auth);
    const user = await this.user(input.user);
    const rows = user.status === 'active' ? await this.rows(user.id, app.id) : [];
    // Compile app-scoped grants exactly like platform permissions (department scopes cover subtrees).
    const grants: Grant[] = [];
    const roleOf = new Map<Grant, string>();
    for (const r of rows) {
      if (!r.permission) continue;
      let g: Grant | null = null;
      if (r.scope_type === 'global') g = { p: r.permission, s: 'g' };
      else if (r.scope_type === 'department' && r.department_path) {
        const sub = await this.db.execute<{ id: string }>(
          sql`select id from core.departments where path like ${`${r.department_path}%`}`,
        );
        g = { p: r.permission, s: 'd', d: sub.rows.map((x) => x.id) };
      } else if (r.scope_type === 'record' && r.scope_record_type && r.scope_record_id)
        g = { p: r.permission, s: 'r', t: r.scope_record_type, id: r.scope_record_id };
      if (g) {
        grants.push(g);
        roleOf.set(g, r.role_key);
      }
    }
    const resource =
      input.departmentId || input.recordId
        ? { departmentId: input.departmentId ?? null, recordType: input.recordType, recordId: input.recordId }
        : undefined;
    const set = new PermissionSet(grants);
    const allowed = set.can(input.permission, resource);
    const matched = allowed
      ? [
          ...new Set(
            grants
              .filter((g) => new PermissionSet([g]).can(input.permission, resource))
              .map((g) => roleOf.get(g)!),
          ),
        ]
      : [];
    return {
      allowed,
      user: { id: user.id, username: user.username },
      application: app.key,
      permission: input.permission,
      matchedRoles: matched,
      evaluatedAt: new Date(),
    };
  }

  async members(appKey: string, q: z.output<typeof roleQueryMembersQuerySchema>, auth: AuthContext) {
    const app = await this.app(appKey, auth);
    const roleFilter = q.role ? sql`and r.key = ${q.role}` : sql``;
    const base = sql`
      from core.role_assignments ra
      join core.roles r on r.id = ra.role_id and r.application_id = ${app.id}
      left join core.groups g on g.id = ra.group_id
      left join core.group_members gm on gm.group_id = ra.group_id
      join core.users u on u.id = coalesce(ra.user_id, gm.user_id) and u.status = 'active'
     where (ra.expires_at is null or ra.expires_at > now()) ${roleFilter}`;
    const [ids, total] = await Promise.all([
      this.db.execute<{ id: string }>(
        sql`select distinct u.id, u.display_name ${base} order by u.display_name, u.id limit ${q.pageSize} offset ${pageOffset(q.page, q.pageSize)}`,
      ),
      this.db.execute<{ n: number }>(sql`select count(distinct u.id)::int as n ${base}`),
    ]);
    const userIds = ids.rows.map((r) => r.id);
    const items = [];
    for (const id of userIds) {
      const [user, rows] = await Promise.all([this.user(id), this.rows(id, app.id)]);
      const seen = new Set<string>();
      const roles = rows
        .filter((r) => !q.role || r.role_key === q.role)
        .filter((r) => {
          const k = `${r.role_key}|${r.scope_type}|${r.scope_department_id}|${r.scope_record_id}|${r.group_key}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((r) => {
          const { name: _n, ...rest } = this.roleOut(r);
          return rest;
        });
      items.push({ user, roles });
    }
    return { items, total: total.rows[0]?.n ?? 0, page: q.page, pageSize: q.pageSize };
  }
}
