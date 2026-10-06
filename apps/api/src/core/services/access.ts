import type {
  createRoleAssignmentSchema,
  createRoleSchema,
  roleAssignmentQuerySchema,
  updateRoleSchema,
} from '@isbp/contracts';
import type { roleRequestSettingsSchema } from '@isbp/contracts';
import {
  applications,
  departments,
  groups,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  workflowDefinitions,
} from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  patternCovers,
} from '@isbp/sdk/server';
import { and, count, eq, gt, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { EVERYONE_GROUP_KEY, PLATFORM_APP_KEY } from '../../kernel/rbac';
import { getKernel } from '../kernel-ref';
import { likePattern, orderBy, pageOffset } from '../util';

const grantor = alias(users, 'grantor');
const owner = alias(users, 'role_owner');

type RoleRow = typeof roles.$inferSelect;
interface RoleJoin {
  app: { id: string; key: string; name: string };
  ownerName: string | null;
  workflowName: string | null;
}

/** Roles, the permission catalog, assignments and "why does X have access" explanations. */
export class AccessService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  private async platformAppId(): Promise<string> {
    const [app] = await this.db
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.key, PLATFORM_APP_KEY));
    if (!app) throw new Error('Platform application is missing — run migrations');
    return app.id;
  }

  /** Privilege-escalation guard: you can only hand out permissions you hold globally yourself. */
  private assertCanGrant(patterns: string[], auth: AuthContext) {
    const held = auth.permissions.grants.filter((g) => g.s === 'g').map((g) => g.p);
    const missing = patterns.filter((p) => !held.some((h) => patternCovers(h, p)));
    if (missing.length) {
      throw new HttpError(
        403,
        ErrorCodes.PRIVILEGE_ESCALATION,
        `You cannot grant permissions you do not hold: ${missing.slice(0, 5).join(', ')}`,
        {
          missing,
        },
      );
    }
  }

  async permissionCatalog() {
    const appId = await this.platformAppId();
    const rows = await this.db
      .select()
      .from(permissions)
      .where(and(eq(permissions.applicationId, appId), eq(permissions.deprecated, false)))
      .orderBy(permissions.key);
    return rows.map((p) => ({
      key: p.key,
      moduleId: p.moduleId,
      description: p.description,
      scopes: p.scopes,
    }));
  }

  async listRoles(q: { q?: string }, applicationId?: string) {
    const appId = applicationId ?? (await this.platformAppId());
    const assignmentCounts = this.db
      .select({ roleId: roleAssignments.roleId, n: count().as('n') })
      .from(roleAssignments)
      .where(or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())))
      .groupBy(roleAssignments.roleId)
      .as('rc');
    const rows = await this.db
      .select({
        r: roles,
        n: assignmentCounts.n,
        app: { id: applications.id, key: applications.key, name: applications.name },
        ownerName: owner.displayName,
        workflowName: workflowDefinitions.name,
      })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .leftJoin(owner, eq(owner.id, roles.ownerId))
      .leftJoin(workflowDefinitions, eq(workflowDefinitions.id, roles.requestWorkflowId))
      .leftJoin(assignmentCounts, eq(assignmentCounts.roleId, roles.id))
      .where(
        and(
          eq(roles.applicationId, appId),
          q.q ? or(ilike(roles.name, likePattern(q.q)), ilike(roles.key, likePattern(q.q))) : undefined,
        ),
      )
      .orderBy(sql`${roles.isSystem} desc`, roles.name);
    const perms = await this.db
      .select()
      .from(rolePermissions)
      .where(
        inArray(
          rolePermissions.roleId,
          rows.map((r) => r.r.id).concat('00000000-0000-0000-0000-000000000000'),
        ),
      );
    const byRole = new Map<string, string[]>();
    for (const p of perms) byRole.set(p.roleId, [...(byRole.get(p.roleId) ?? []), p.permission]);
    return rows.map((r) => this.roleDto(r.r, byRole.get(r.r.id) ?? [], Number(r.n ?? 0), r));
  }

  private roleDto(r: RoleRow, perms: string[], assignmentCount: number, join: RoleJoin) {
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      moduleId: r.moduleId,
      application: { ...join.app, isPlatform: join.app.key === PLATFORM_APP_KEY },
      permissions: perms.sort(),
      assignmentCount,
      requestable: r.requestable,
      riskLevel: r.riskLevel,
      owner: r.ownerId ? { id: r.ownerId, displayName: join.ownerName ?? '?' } : null,
      maxDurationDays: r.maxDurationDays,
      requestWorkflow: r.requestWorkflowId
        ? { id: r.requestWorkflowId, name: join.workflowName ?? '?' }
        : null,
      updatedAt: r.updatedAt,
    };
  }

  async getRole(id: string) {
    const [row] = await this.db
      .select({
        r: roles,
        app: { id: applications.id, key: applications.key, name: applications.name },
        ownerName: owner.displayName,
        workflowName: workflowDefinitions.name,
      })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .leftJoin(owner, eq(owner.id, roles.ownerId))
      .leftJoin(workflowDefinitions, eq(workflowDefinitions.id, roles.requestWorkflowId))
      .where(eq(roles.id, id));
    if (!row) throw httpErrors.notFound('Role not found');
    const r = row.r;
    const [perms, [n]] = await Promise.all([
      this.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, id)),
      this.db
        .select({ n: count() })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.roleId, id),
            or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())),
          ),
        ),
    ]);
    return this.roleDto(
      r,
      perms.map((p) => p.permission),
      n!.n,
      row,
    );
  }

  /** Custom role of the platform, or (with `applicationId`) of an external application. */
  async createRole(input: z.output<typeof createRoleSchema>, auth: AuthContext, applicationId?: string) {
    if (!applicationId) this.assertCanGrant(input.permissions, auth);
    const appId = applicationId ?? (await this.platformAppId());
    const role = await this.ctx.transaction(async (tx) => {
      const [r] = await tx
        .insert(roles)
        .values({
          applicationId: appId,
          key: input.key,
          name: input.name,
          description: input.description ?? null,
        })
        .returning();
      const unique = [...new Set(input.permissions)];
      if (unique.length)
        await tx.insert(rolePermissions).values(unique.map((permission) => ({ roleId: r!.id, permission })));
      await this.ctx.audit.record(
        {
          action: 'core.role.created',
          entityType: 'role',
          entityId: r!.id,
          entityLabel: r!.name,
          metadata: { permissions: unique },
        },
        { tx },
      );
      await this.ctx.events.publish('core.role.created', { roleId: r!.id }, { tx });
      return r!;
    });
    return this.getRole(role.id);
  }

  async updateRole(
    id: string,
    input: z.output<typeof updateRoleSchema>,
    auth: AuthContext,
    opts: { applicationId?: string } = {},
  ) {
    const before = await this.getRole(id);
    this.assertSameApp(before, opts.applicationId);
    if (before.isSystem) {
      throw new HttpError(
        409,
        ErrorCodes.SYSTEM_ROLE_READONLY,
        'System roles are defined by module manifests and are read-only',
      );
    }
    // Only newly added permissions need to be held by the editor; removing access is always allowed.
    if (input.permissions && before.application.isPlatform)
      this.assertCanGrant(
        input.permissions.filter((p) => !before.permissions.includes(p)),
        auth,
      );
    const changes = this.ctx.audit.diff(
      { name: before.name, description: before.description, permissions: before.permissions },
      {
        name: input.name,
        description: input.description,
        permissions: input.permissions ? [...new Set(input.permissions)].sort() : undefined,
      },
    );
    await this.ctx.transaction(async (tx) => {
      const patch = { name: input.name, description: input.description };
      if (patch.name !== undefined || patch.description !== undefined)
        await tx.update(roles).set(patch).where(eq(roles.id, id));
      else await tx.update(roles).set({ updatedAt: new Date() }).where(eq(roles.id, id));
      if (input.permissions) {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        const unique = [...new Set(input.permissions)];
        if (unique.length)
          await tx.insert(rolePermissions).values(unique.map((permission) => ({ roleId: id, permission })));
      }
      await this.ctx.audit.record(
        {
          action: 'core.role.updated',
          entityType: 'role',
          entityId: id,
          entityLabel: input.name ?? before.name,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish('core.role.updated', { roleId: id }, { tx });
    });
    await getKernel().rbac.bump();
    return this.getRole(id);
  }

  /** Platform routes manage platform roles; application routes manage that application's roles. */
  private assertSameApp(role: { application: { id: string; isPlatform: boolean } }, applicationId?: string) {
    const ok = applicationId ? role.application.id === applicationId : role.application.isPlatform;
    if (!ok) throw httpErrors.notFound('Role not found');
  }

  async deleteRole(id: string, opts: { applicationId?: string } = {}) {
    const role = await this.getRole(id);
    this.assertSameApp(role, opts.applicationId);
    if (role.isSystem)
      throw new HttpError(409, ErrorCodes.SYSTEM_ROLE_READONLY, 'System roles cannot be deleted');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(roles).where(eq(roles.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.role.deleted',
          entityType: 'role',
          entityId: id,
          entityLabel: role.name,
          metadata: { assignments: role.assignmentCount },
        },
        { tx },
      );
      await this.ctx.events.publish('core.role.deleted', { roleId: id }, { tx });
    });
    await getKernel().rbac.bump();
  }

  /** Self-service settings: requestable, risk, owner, longest grant, workflow override. */
  async updateRequestSettings(
    id: string,
    input: z.output<typeof roleRequestSettingsSchema>,
    auth: AuthContext,
    opts: { applicationId?: string } = {},
  ) {
    const role = await this.getRole(id);
    this.assertSameApp(role, opts.applicationId);
    if (role.application.isPlatform) auth.require('core.roles.manage');
    else
      auth.require('core.applications.manage', { recordType: 'application', recordId: role.application.id });
    if (input.requestWorkflowId) {
      const [w] = await this.db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, input.requestWorkflowId));
      if (!w || w.archivedAt || w.triggerKey !== 'core.access-request' || w.publishedVersion === null)
        throw httpErrors.badRequest('Choose a published access-request workflow');
    }
    if (input.ownerId) {
      const [u] = await this.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, input.ownerId));
      if (!u || u.status !== 'active') throw httpErrors.badRequest('The owner must be an active person');
    }
    const [before] = await this.db.select().from(roles).where(eq(roles.id, id));
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    await this.ctx.transaction(async (tx) => {
      await tx.update(roles).set(input).where(eq(roles.id, id));
      if (Object.keys(changes).length)
        await this.ctx.audit.record(
          {
            action: 'core.role.request_settings_updated',
            category: 'security',
            entityType: 'role',
            entityId: id,
            entityLabel: role.name,
            changes,
          },
          { tx },
        );
    });
    return this.getRole(id);
  }

  /* ───────────── assignments ───────────── */

  async listAssignments(
    q: z.output<typeof roleAssignmentQuerySchema>,
    auth: AuthContext,
    opts: { applicationId?: string } = {},
  ) {
    const appId = opts.applicationId ?? q.applicationId ?? (await this.platformAppId());
    const visible = opts.applicationId
      ? auth.can('core.applications.read', { recordType: 'application', recordId: appId }) ||
        auth.can('core.roles.read')
      : auth.reach('core.roles.read').global;
    const where = and(
      eq(roles.applicationId, appId),
      q.roleId ? eq(roleAssignments.roleId, q.roleId) : undefined,
      q.userId ? eq(roleAssignments.userId, q.userId) : undefined,
      q.groupId ? eq(roleAssignments.groupId, q.groupId) : undefined,
      q.includeExpired
        ? undefined
        : or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())),
      q.q
        ? or(
            ilike(users.displayName, likePattern(q.q)),
            ilike(groups.name, likePattern(q.q)),
            ilike(roles.name, likePattern(q.q)),
          )
        : undefined,
      visible ? undefined : sql`false`,
    );
    const base = this.db
      .select({
        a: roleAssignments,
        roleKey: roles.key,
        roleName: roles.name,
        userName: users.displayName,
        userEmail: users.email,
        groupName: groups.name,
        groupKey: groups.key,
        deptName: departments.name,
        grantorName: grantor.displayName,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .leftJoin(users, eq(users.id, roleAssignments.userId))
      .leftJoin(groups, eq(groups.id, roleAssignments.groupId))
      .leftJoin(departments, eq(departments.id, roleAssignments.scopeDepartmentId))
      .leftJoin(grantor, eq(grantor.id, roleAssignments.grantedBy))
      .where(where);
    const [rows, [total]] = await Promise.all([
      base
        .orderBy(
          ...orderBy(
            q.sort,
            { grantedAt: roleAssignments.grantedAt, expiresAt: roleAssignments.expiresAt, role: roles.name },
            '-grantedAt',
            roleAssignments.id,
          ),
        )
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db
        .select({ n: count() })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .leftJoin(users, eq(users.id, roleAssignments.userId))
        .leftJoin(groups, eq(groups.id, roleAssignments.groupId))
        .where(where),
    ]);
    const now = Date.now();
    return {
      items: rows.map((r) => ({
        id: r.a.id,
        role: { id: r.a.roleId, key: r.roleKey, name: r.roleName },
        principal: r.a.userId
          ? { type: 'user' as const, id: r.a.userId, name: r.userName ?? '?', detail: r.userEmail }
          : { type: 'group' as const, id: r.a.groupId!, name: r.groupName ?? '?', detail: r.groupKey },
        scopeType: r.a.scopeType,
        scope: {
          departmentId: r.a.scopeDepartmentId,
          departmentName: r.deptName,
          recordType: r.a.scopeRecordType,
          recordId: r.a.scopeRecordId,
        },
        expiresAt: r.a.expiresAt,
        expired: Boolean(r.a.expiresAt && r.a.expiresAt.getTime() <= now),
        source: r.a.source,
        reason: r.a.reason,
        grantedBy: r.a.grantedBy ? { id: r.a.grantedBy, displayName: r.grantorName ?? '?' } : null,
        grantedAt: r.a.grantedAt,
      })),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async assign(
    input: z.output<typeof createRoleAssignmentSchema>,
    auth: AuthContext,
    opts: { applicationId?: string } = {},
  ) {
    const role = await this.getRole(input.roleId);
    this.assertSameApp(role, opts.applicationId);
    if (role.application.isPlatform) {
      if (input.scopeType === 'department')
        auth.require('core.roles.assign', { departmentId: input.scopeDepartmentId! });
      else auth.require('core.roles.assign');
      this.assertCanGrant(role.permissions, auth);
    } else {
      auth.require('core.applications.manage', { recordType: 'application', recordId: role.application.id });
    }

    const [principal] =
      input.principalType === 'user'
        ? await this.db
            .select({ id: users.id, name: users.displayName, status: users.status })
            .from(users)
            .where(eq(users.id, input.principalId))
        : await this.db
            .select({ id: groups.id, name: groups.name, status: sql<string>`'active'` })
            .from(groups)
            .where(eq(groups.id, input.principalId));
    if (!principal)
      throw httpErrors.notFound(`${input.principalType === 'user' ? 'User' : 'Group'} not found`);
    if (principal.status === 'offboarded')
      throw new HttpError(409, ErrorCodes.PRINCIPAL_OFFBOARDED, 'Cannot assign roles to an offboarded user');

    const assignment = await this.ctx.transaction(async (tx) => {
      const [a] = await tx
        .insert(roleAssignments)
        .values({
          roleId: input.roleId,
          userId: input.principalType === 'user' ? input.principalId : null,
          groupId: input.principalType === 'group' ? input.principalId : null,
          scopeType: input.scopeType,
          scopeDepartmentId: input.scopeType === 'department' ? input.scopeDepartmentId! : null,
          scopeRecordType: input.scopeType === 'record' ? input.scopeRecordType! : null,
          scopeRecordId: input.scopeType === 'record' ? input.scopeRecordId! : null,
          expiresAt: input.expiresAt ?? null,
          reason: input.reason ?? null,
          grantedBy: auth.user?.id ?? null,
          source: 'manual',
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.role-assignment.granted',
          category: 'security',
          entityType: input.principalType,
          entityId: input.principalId,
          entityLabel: principal.name,
          metadata: {
            assignmentId: a!.id,
            role: role.key,
            scopeType: input.scopeType,
            scopeDepartmentId: input.scopeDepartmentId ?? null,
            expiresAt: input.expiresAt?.toISOString() ?? null,
            reason: input.reason ?? null,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.role-assignment.granted',
        { assignmentId: a!.id, roleId: role.id },
        { tx },
      );
      if (input.principalType === 'user')
        await this.ctx.notifications.notify(
          {
            type: 'core.access.granted',
            recipients: [input.principalId],
            params: { role: role.name, actor: auth.user?.displayName ?? auth.principal.name },
            href: '/settings#access',
          },
          { tx },
        );
      return a!;
    });
    await getKernel().rbac.bump();
    return assignment;
  }

  async revoke(id: string, auth: AuthContext, opts: { applicationId?: string } = {}) {
    const [a] = await this.db.select().from(roleAssignments).where(eq(roleAssignments.id, id));
    if (!a) throw httpErrors.notFound('Assignment not found');
    const role = await this.getRole(a.roleId);
    this.assertSameApp(role, opts.applicationId);
    if (!role.application.isPlatform)
      auth.require('core.applications.manage', { recordType: 'application', recordId: role.application.id });
    else if (a.scopeType === 'department')
      auth.require('core.roles.assign', { departmentId: a.scopeDepartmentId });
    else auth.require('core.roles.assign');
    if (a.userId && a.userId === auth.user?.id && role.key === 'platform-admin') {
      throw new HttpError(
        409,
        ErrorCodes.SELF_LOCKOUT,
        'You cannot remove your own platform administrator role',
      );
    }
    await this.ctx.transaction(async (tx) => {
      await tx.delete(roleAssignments).where(eq(roleAssignments.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.role-assignment.revoked',
          category: 'security',
          entityType: a.userId ? 'user' : 'group',
          entityId: a.userId ?? a.groupId,
          metadata: { assignmentId: id, role: role.key, scopeType: a.scopeType },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.role-assignment.revoked',
        { assignmentId: id, roleId: a.roleId },
        { tx },
      );
    });
    await getKernel().rbac.bump();
  }

  /** Deletes expired assignments (the resolver already ignores them; this keeps data tidy and audited). */
  async expireAssignments(): Promise<number> {
    const expired = await this.db
      .select()
      .from(roleAssignments)
      .where(lte(roleAssignments.expiresAt, new Date()))
      .limit(500);
    for (const a of expired) {
      await this.ctx.transaction(async (tx) => {
        await tx.delete(roleAssignments).where(eq(roleAssignments.id, a.id));
        await this.ctx.audit.record(
          {
            action: 'core.role-assignment.expired',
            category: 'security',
            entityType: a.userId ? 'user' : 'group',
            entityId: a.userId ?? a.groupId,
            metadata: { assignmentId: a.id, roleId: a.roleId, expiresAt: a.expiresAt?.toISOString() },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'core.role-assignment.expired',
          { assignmentId: a.id, roleId: a.roleId },
          { tx },
        );
      });
    }
    if (expired.length) await getKernel().rbac.bump();
    return expired.length;
  }

  async effectivePermissions(userId: string) {
    const kernel = getKernel();
    const [set, sources] = await Promise.all([
      kernel.rbac.permissionsFor(userId),
      kernel.rbac.assignmentSources(userId),
    ]);
    return {
      grants: [...set.grants],
      sources: sources.map((s) => ({
        permission: s.permission,
        role: { id: s.role_id, key: s.role_key, name: s.role_name },
        via: s.user_id
          ? ('direct' as const)
          : s.group_key === EVERYONE_GROUP_KEY
            ? ('everyone' as const)
            : ('group' as const),
        group: s.group_id ? { id: s.group_id, name: s.group_name ?? '' } : null,
        scopeType: s.scope_type,
        scopeLabel:
          s.scope_type === 'department'
            ? s.department_name
            : s.scope_type === 'record'
              ? `${s.scope_record_type}:${s.scope_record_id}`
              : null,
        expiresAt: s.expires_at ? new Date(s.expires_at) : null,
      })),
    };
  }
}
