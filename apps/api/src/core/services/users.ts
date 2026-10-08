import {
  applications,
  departments,
  groupMembers,
  groups,
  roleAssignments,
  roles,
  sessions,
  users,
} from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, count, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  createUserSchema,
  offboardUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  userListQuerySchema,
} from '@isbp/contracts';
import { hashPassword } from '../../kernel/passwords';
import { PLATFORM_APP_KEY } from '../../kernel/rbac';
import { getKernel } from '../kernel-ref';
import { likePattern, orderBy, pageOffset, reachFilter } from '../util';

type UserRow = typeof users.$inferSelect;

const manager = alias(users, 'manager');

export function summaryOf(u: UserRow, dept: { id: string; name: string } | null) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    jobTitle: u.jobTitle,
    status: u.status,
    authSource: u.authSource,
    avatarUrl: u.avatarUrl,
    department: dept,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

/** People lifecycle: create → onboard → (suspend ↔ reactivate) → offboard, each audited and evented. */
export class UserService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  async find(id: string): Promise<UserRow> {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw httpErrors.notFound('User not found');
    return u;
  }

  async list(q: z.output<typeof userListQuerySchema>, auth: AuthContext) {
    const conditions = [
      reachFilter(auth.reach('core.users.read'), users.departmentId, users.id, 'user'),
      q.status ? eq(users.status, q.status) : undefined,
      q.authSource ? eq(users.authSource, q.authSource) : undefined,
      q.departmentId
        ? q.subtree
          ? sql`${users.departmentId} in (select d.id from core.departments d where d.path like (select p.path from core.departments p where p.id = ${q.departmentId}) || '%')`
          : eq(users.departmentId, q.departmentId)
        : undefined,
      q.groupId
        ? inArray(
            users.id,
            this.db
              .select({ id: groupMembers.userId })
              .from(groupMembers)
              .where(eq(groupMembers.groupId, q.groupId)),
          )
        : undefined,
      q.q
        ? or(
            ilike(users.displayName, likePattern(q.q)),
            ilike(users.email, likePattern(q.q)),
            ilike(users.username, likePattern(q.q)),
            ilike(users.employeeId, likePattern(q.q)),
          )
        : undefined,
      // Custom-field filters use the GIN (jsonb_path_ops) index through `@>` containment.
      ...(q.attr ?? []).map((pair) => {
        const at = pair.indexOf(':');
        const key = at > 0 ? pair.slice(0, at) : pair;
        const value = at > 0 ? pair.slice(at + 1) : '';
        const typed: unknown[] = [value];
        if (value !== '' && Number.isFinite(Number(value))) typed.push(Number(value));
        if (value === 'true' || value === 'false') typed.push(value === 'true');
        return or(...typed.map((v) => sql`${users.attributes} @> ${JSON.stringify({ [key]: v })}::jsonb`));
      }),
    ];
    const where = and(...conditions);
    const order = orderBy(
      q.sort,
      {
        displayName: users.displayName,
        email: users.email,
        username: users.username,
        status: users.status,
        createdAt: users.createdAt,
        lastLoginAt: sql`${users.lastLoginAt} nulls last`,
        department: departments.name,
      },
      'displayName',
      users.id,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ u: users, deptId: departments.id, deptName: departments.name })
        .from(users)
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .where(where)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(users).where(where),
    ]);
    return {
      items: rows.map((r) => summaryOf(r.u, r.deptId ? { id: r.deptId, name: r.deptName! } : null)),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string, auth: AuthContext) {
    const [row] = await this.db
      .select({
        u: users,
        deptId: departments.id,
        deptName: departments.name,
        mgrId: manager.id,
        mgrName: manager.displayName,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .leftJoin(manager, eq(manager.id, users.managerId))
      .where(eq(users.id, id));
    if (!row) throw httpErrors.notFound('User not found');
    if (auth.user?.id !== id)
      auth.require('core.users.read', { departmentId: row.u.departmentId, recordType: 'user', recordId: id });

    const [memberOf, [reports], [activeSessions]] = await Promise.all([
      this.db
        .select({ id: groups.id, key: groups.key, name: groups.name })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(eq(groupMembers.userId, id))
        .orderBy(groups.name),
      this.db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.managerId, id), sql`${users.status} <> 'offboarded'`)),
      this.db
        .select({ n: count() })
        .from(sessions)
        .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))),
    ]);
    const u = row.u;
    return {
      ...summaryOf(u, row.deptId ? { id: row.deptId, name: row.deptName! } : null),
      givenName: u.givenName,
      familyName: u.familyName,
      phone: u.phone,
      employeeId: u.employeeId,
      locale: u.locale,
      timezone: u.timezone,
      manager: row.mgrId ? { id: row.mgrId, displayName: row.mgrName! } : null,
      attributes: u.attributes,
      mustChangePassword: u.mustChangePassword,
      lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null,
      onboardedAt: u.onboardedAt,
      offboardedAt: u.offboardedAt,
      updatedAt: u.updatedAt,
      groups: memberOf,
      directReports: reports?.n ?? 0,
      activeSessions: activeSessions?.n ?? 0,
    };
  }

  async create(input: z.output<typeof createUserSchema>, auth: AuthContext) {
    auth.require('core.users.create', { departmentId: input.departmentId ?? null });
    const { password, groupIds, attributes: rawAttributes, ...fields } = input;
    const attributes = rawAttributes ? await this.ctx.fields.validate('core.user', rawAttributes) : {};
    const passwordHash = password ? await hashPassword(password) : null;
    const now = new Date();
    const user = await this.ctx.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          ...fields,
          attributes,
          email: fields.email.toLowerCase(),
          departmentId: fields.departmentId ?? null,
          managerId: fields.managerId ?? null,
          authSource: 'local',
          passwordHash,
          mustChangePassword: Boolean(password),
          onboardedAt: fields.status === 'active' ? now : null,
        })
        .returning();
      if (groupIds.length) {
        await tx
          .insert(groupMembers)
          .values(groupIds.map((groupId) => ({ groupId, userId: created!.id, addedBy: auth.user?.id })));
      }
      const ref = { userId: created!.id, email: created!.email };
      await this.ctx.audit.record(
        {
          action: 'core.user.created',
          entityType: 'user',
          entityId: created!.id,
          entityLabel: created!.displayName,
          metadata: { status: created!.status, groups: groupIds.length },
        },
        { tx },
      );
      await this.ctx.events.publish('core.user.created', { ...ref, status: created!.status }, { tx });
      if (created!.status === 'active') await this.ctx.events.publish('core.user.onboarded', ref, { tx });
      return created!;
    });
    if (groupIds.length) await getKernel().rbac.bump();
    return user;
  }

  async update(id: string, input: z.output<typeof updateUserSchema>, auth: AuthContext) {
    const before = await this.find(id);
    auth.require('core.users.update', {
      departmentId: before.departmentId,
      recordType: 'user',
      recordId: id,
    });
    if (input.departmentId !== undefined && input.departmentId !== before.departmentId) {
      auth.require('core.users.update', { departmentId: input.departmentId ?? null });
    }
    if (input.managerId === id) throw httpErrors.badRequest('A user cannot be their own manager');
    const patch = {
      ...input,
      ...(input.email ? { email: input.email.toLowerCase() } : {}),
      ...(input.attributes
        ? { attributes: await this.ctx.fields.validate('core.user', input.attributes, before.attributes) }
        : {}),
    };
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    return this.ctx.transaction(async (tx) => {
      const [updated] = await tx.update(users).set(patch).where(eq(users.id, id)).returning();
      await this.ctx.audit.record(
        {
          action: 'core.user.updated',
          entityType: 'user',
          entityId: id,
          entityLabel: updated!.displayName,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.user.updated',
        { userId: id, email: updated!.email, changes: Object.keys(changes) },
        { tx },
      );
      if ((before.departmentId ?? null) !== (updated!.departmentId ?? null))
        await this.transferred(tx, before, updated!);
      return updated!;
    });
  }

  /**
   * A department change: publishes `core.user.transferred` and asks the old and the new manager to review the
   * person's access — their role assignments, with the ones scoped to the old department (or below it) "to review".
   * Nothing is revoked: access follows the people who know the job, not the move.
   */
  private async transferred(tx: Db, before: UserRow, after: UserRow) {
    const fromId = before.departmentId ?? null;
    const toId = after.departmentId ?? null;
    const ids = [fromId, toId].filter((x): x is string => Boolean(x));
    const depts = ids.length
      ? await tx
          .select({
            id: departments.id,
            name: departments.name,
            path: departments.path,
            managerId: departments.managerId,
          })
          .from(departments)
          .where(inArray(departments.id, ids))
      : [];
    const from = depts.find((d) => d.id === fromId) ?? null;
    const to = depts.find((d) => d.id === toId) ?? null;
    await this.ctx.events.publish(
      'core.user.transferred',
      { userId: after.id, fromDepartmentId: fromId, toDepartmentId: toId },
      { tx },
    );
    const scope = alias(departments, 'scope_department');
    const assignments = await tx
      .select({
        role: roles.name,
        application: applications.name,
        isPlatform: sql<boolean>`${applications.key} = ${PLATFORM_APP_KEY}`,
        scopeType: roleAssignments.scopeType,
        scopeName: scope.name,
        scopePath: scope.path,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .leftJoin(scope, eq(scope.id, roleAssignments.scopeDepartmentId))
      .where(
        and(
          eq(roleAssignments.userId, after.id),
          or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())),
        ),
      )
      .orderBy(roles.name);
    const label = (a: (typeof assignments)[number]) =>
      [a.role, a.isPlatform ? null : a.application, a.scopeName].filter(Boolean).join(' · ');
    // Scoped to the old department or a department below it: probably for the old job.
    const review = assignments.filter(
      (a) => a.scopeType === 'department' && from && a.scopePath?.startsWith(from.path),
    );
    const oldManager = before.managerId ?? from?.managerId ?? null;
    const newManager =
      (after.managerId !== before.managerId ? after.managerId : null) ?? to?.managerId ?? null;
    const recipients = [...new Set([oldManager, newManager])].filter(
      (x): x is string => Boolean(x) && x !== after.id,
    );
    if (!recipients.length) return;
    await this.ctx.notifications.notify(
      {
        type: 'core.user.transferred',
        recipients,
        params: {
          name: after.displayName,
          hasFrom: from ? 'yes' : 'no',
          from: from?.name ?? '',
          hasTo: to ? 'yes' : 'no',
          to: to?.name ?? '',
          count: assignments.length,
          roles: assignments.map(label).join(', '),
          reviewCount: review.length,
          review: review.map(label).join(', '),
        },
        data: { userId: after.id, fromDepartmentId: fromId, toDepartmentId: toId },
      },
      { tx },
    );
  }

  async onboard(id: string, auth: AuthContext) {
    const user = await this.find(id);
    auth.require('core.users.lifecycle', { departmentId: user.departmentId });
    if (user.status !== 'pending' && user.status !== 'offboarded') {
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        `Only pending or offboarded users can be onboarded (current: ${user.status})`,
      );
    }
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: 'active', onboardedAt: new Date(), offboardedAt: null })
        .where(eq(users.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.user.onboarded',
          entityType: 'user',
          entityId: id,
          entityLabel: user.displayName,
          changes: { status: [user.status, 'active'] },
        },
        { tx },
      );
      await this.ctx.events.publish('core.user.onboarded', { userId: id, email: user.email }, { tx });
    });
    await getKernel().rbac.bump();
  }

  async offboard(id: string, input: z.output<typeof offboardUserSchema>, auth: AuthContext) {
    const user = await this.find(id);
    auth.require('core.users.lifecycle', { departmentId: user.departmentId });
    if (auth.user?.id === id)
      throw new HttpError(409, ErrorCodes.SELF_LOCKOUT, 'You cannot offboard yourself');
    if (user.status === 'offboarded')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'User is already offboarded');
    const kernel = getKernel();
    const result = await this.ctx.transaction(async (tx) => {
      await tx.update(users).set({ status: 'offboarded', offboardedAt: new Date() }).where(eq(users.id, id));
      const revokedSessions = await kernel.sessions.revokeAllForUser(id, 'offboarded', undefined, tx);
      const removedGroups = input.removeGroupMemberships
        ? (await tx.delete(groupMembers).where(eq(groupMembers.userId, id)).returning()).length
        : 0;
      const removedRoles = input.removeRoleAssignments
        ? (await tx.delete(roleAssignments).where(eq(roleAssignments.userId, id)).returning()).length
        : 0;
      let transferredReports = 0;
      if (input.transferReportsTo) {
        transferredReports = (
          await tx
            .update(users)
            .set({ managerId: input.transferReportsTo })
            .where(eq(users.managerId, id))
            .returning({ id: users.id })
        ).length;
      }
      const metadata = {
        reason: input.reason ?? null,
        revokedSessions,
        removedGroups,
        removedRoles,
        transferredReports,
      };
      await this.ctx.audit.record(
        {
          action: 'core.user.offboarded',
          entityType: 'user',
          entityId: id,
          entityLabel: user.displayName,
          changes: { status: [user.status, 'offboarded'] },
          metadata,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.user.offboarded',
        { userId: id, email: user.email, reason: input.reason ?? null },
        { tx },
      );
      return metadata;
    });
    await kernel.rbac.bump();
    return result;
  }

  async setStatus(id: string, status: 'active' | 'suspended', reason: string | undefined, auth: AuthContext) {
    const user = await this.find(id);
    auth.require('core.users.lifecycle', { departmentId: user.departmentId });
    if (auth.user?.id === id)
      throw new HttpError(409, ErrorCodes.SELF_LOCKOUT, 'You cannot change your own status');
    const allowed = status === 'suspended' ? user.status === 'active' : user.status === 'suspended';
    if (!allowed)
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        `Cannot change status from ${user.status} to ${status}`,
      );
    const kernel = getKernel();
    await this.ctx.transaction(async (tx) => {
      await tx.update(users).set({ status }).where(eq(users.id, id));
      if (status === 'suspended') await kernel.sessions.revokeAllForUser(id, 'suspended', undefined, tx);
      const action = status === 'suspended' ? 'core.user.suspended' : 'core.user.reactivated';
      await this.ctx.audit.record(
        {
          action,
          category: 'security',
          entityType: 'user',
          entityId: id,
          entityLabel: user.displayName,
          changes: { status: [user.status, status] },
          metadata: { reason: reason ?? null },
        },
        { tx },
      );
      await this.ctx.events.publish(action, { userId: id, email: user.email }, { tx });
    });
    await kernel.rbac.bump();
  }

  async resetPassword(id: string, input: z.output<typeof resetPasswordSchema>, auth: AuthContext) {
    const user = await this.find(id);
    auth.require('core.users.credentials', { departmentId: user.departmentId });
    if (user.authSource !== 'local') {
      throw new HttpError(
        409,
        ErrorCodes.PASSWORD_MANAGED_EXTERNALLY,
        'Passwords of directory/SSO users are managed by their identity provider',
      );
    }
    const passwordHash = await hashPassword(input.password);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: input.mustChangePassword,
          failedLoginCount: 0,
          lockedUntil: null,
        })
        .where(eq(users.id, id));
      await getKernel().sessions.revokeAllForUser(id, 'password_reset', undefined, tx);
      await this.ctx.audit.record(
        {
          action: 'core.user.password_reset',
          category: 'security',
          entityType: 'user',
          entityId: id,
          entityLabel: user.displayName,
        },
        { tx },
      );
    });
  }

  async revokeSessions(id: string, auth: AuthContext) {
    const user = await this.find(id);
    auth.require('core.users.lifecycle', { departmentId: user.departmentId });
    const n = await getKernel().sessions.revokeAllForUser(id, 'admin_revoked');
    await this.ctx.audit.record({
      action: 'core.user.sessions_revoked',
      category: 'security',
      entityType: 'user',
      entityId: id,
      entityLabel: user.displayName,
      metadata: { count: n },
    });
    return n;
  }
}
