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
import { and, count, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  changeUserGroupsSchema,
  createUserSchema,
  offboardUserSchema,
  resetPasswordSchema,
  transferUserSchema,
  updateUserSchema,
  userListQuerySchema,
} from '@isbp/contracts';
import { hashPassword } from '../../kernel/passwords';
import { EVERYONE_GROUP_KEY, PLATFORM_APP_KEY } from '../../kernel/rbac';
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
        .select({
          id: groups.id,
          key: groups.key,
          name: groups.name,
          source: groupMembers.source,
          groupSource: groups.source,
        })
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
    if (!Object.keys(this.ctx.audit.diff(before as unknown as Record<string, unknown>, patch)).length)
      return before;
    return this.ctx.transaction(async (tx) => {
      // The change is worked out against the locked row: of two simultaneous edits, the second sees the first's
      // result and records (and notifies) only what it changes itself.
      const locked = await this.lock(tx, id);
      const changes = this.ctx.audit.diff(
        locked as unknown as Record<string, unknown>,
        patch as Record<string, unknown>,
      );
      if (!Object.keys(changes).length) return locked;
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
      if ((locked.departmentId ?? null) !== (updated!.departmentId ?? null))
        await this.transferred(tx, locked, updated!);
      return updated!;
    });
  }

  /** The person's row, locked until the transaction ends (concurrent changes to them wait for it). */
  private async lock(tx: Db, id: string): Promise<UserRow> {
    const [row] = await tx.select().from(users).where(eq(users.id, id)).for('update');
    if (!row) throw httpErrors.notFound('User not found');
    return row;
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

  /* ───────────────────────── groups and transfers ───────────────────────── */

  /**
   * Checks the groups a person joins and leaves: each one exists, the caller may manage it, it isn't "Everyone"
   * (implicit) and a membership kept by a directory sync isn't removed here (the next sync would add it back).
   */
  private async checkGroupChange(userId: string, add: string[], remove: string[], auth: AuthContext) {
    const join = [...new Set(add)];
    const leave = [...new Set(remove)].filter((g) => !join.includes(g));
    const ids = [...join, ...leave];
    if (!ids.length) return { join, leave, names: new Map<string, string>() };
    const rows = await this.db
      .select({ id: groups.id, key: groups.key, name: groups.name, isSystem: groups.isSystem })
      .from(groups)
      .where(inArray(groups.id, ids));
    const byId = new Map(rows.map((g) => [g.id, g]));
    for (const groupId of ids) {
      const g = byId.get(groupId);
      if (!g) throw httpErrors.notFound('Group not found');
      auth.require('core.groups.manage', { recordType: 'group', recordId: groupId });
      if (g.isSystem && g.key === EVERYONE_GROUP_KEY)
        throw new HttpError(409, ErrorCodes.SYSTEM_GROUP, 'Membership of "Everyone" is implicit');
    }
    if (leave.length) {
      const synced = await this.db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.userId, userId),
            inArray(groupMembers.groupId, leave),
            ne(groupMembers.source, 'manual'),
          ),
        );
      if (synced.length)
        throw new HttpError(
          409,
          ErrorCodes.INVALID_STATE,
          'These memberships are kept by a directory sync: change them in the directory',
          { reason: 'synced_membership', groupIds: synced.map((r) => r.groupId) },
        );
    }
    return { join, leave, names: new Map(rows.map((g) => [g.id, g.name])) };
  }

  /**
   * Applies a checked group change in `tx`. Each group's history gets its usual entry (`via` marks the ones a
   * transfer made: the person's own history shows the transfer instead).
   */
  private async applyGroupChange(
    tx: Db,
    userId: string,
    change: { join: string[]; leave: string[]; names: Map<string, string> },
    auth: AuthContext,
    via?: string,
  ) {
    const joined: string[] = [];
    for (const groupId of change.join) {
      const rows = await tx
        .insert(groupMembers)
        .values({ groupId, userId, addedBy: auth.user?.id ?? null })
        .onConflictDoNothing()
        .returning({ groupId: groupMembers.groupId });
      if (rows.length) joined.push(groupId);
    }
    const left = change.leave.length
      ? (
          await tx
            .delete(groupMembers)
            .where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, change.leave)))
            .returning({ groupId: groupMembers.groupId })
        ).map((r) => r.groupId)
      : [];
    const metadata = { userIds: [userId], ...(via ? { via } : {}) };
    for (const [ids, action, added] of [
      [joined, 'core.group.members_added', true],
      [left, 'core.group.members_removed', false],
    ] as const) {
      for (const groupId of ids) {
        await this.ctx.audit.record(
          {
            action,
            entityType: 'group',
            entityId: groupId,
            entityLabel: change.names.get(groupId),
            metadata,
          },
          { tx },
        );
        await this.ctx.events.publish(
          'core.group.members_changed',
          { groupId, added: added ? [userId] : [], removed: added ? [] : [userId] },
          { tx },
        );
      }
    }
    return { joined, left };
  }

  /** Adds a person to groups and takes them out of others, in one transaction. */
  async changeGroups(id: string, input: z.output<typeof changeUserGroupsSchema>, auth: AuthContext) {
    const user = await this.find(id);
    auth.require('core.users.read', { departmentId: user.departmentId, recordType: 'user', recordId: id });
    if (user.status === 'offboarded')
      throw new HttpError(409, ErrorCodes.PRINCIPAL_OFFBOARDED, 'The person is offboarded');
    const change = await this.checkGroupChange(id, input.add, input.remove, auth);
    const result = await this.ctx.transaction((tx) => this.applyGroupChange(tx, id, change, auth));
    if (result.joined.length || result.left.length) await getKernel().rbac.bump();
    return { added: result.joined.length, removed: result.left.length };
  }

  /**
   * What a move suggests: the new department's manager, the groups to leave (shared by at least half of the
   * person's current department, and not by half of the new one) and to join (shared by at least half of the new
   * department), and the person's department-scoped roles (the ones scoped to the current department or below it
   * are probably for the old job).
   */
  async transferOptions(id: string, departmentId: string | undefined, auth: AuthContext) {
    const user = await this.find(id);
    auth.require('core.users.update', { departmentId: user.departmentId, recordType: 'user', recordId: id });
    const deptIds = [user.departmentId, departmentId].filter((x): x is string => Boolean(x));
    const depts = deptIds.length
      ? await this.db
          .select({
            id: departments.id,
            name: departments.name,
            path: departments.path,
            managerId: departments.managerId,
            managerName: manager.displayName,
          })
          .from(departments)
          .leftJoin(manager, eq(manager.id, departments.managerId))
          .where(inArray(departments.id, deptIds))
      : [];
    const from = depts.find((d) => d.id === user.departmentId) ?? null;
    const to = departmentId ? (depts.find((d) => d.id === departmentId) ?? null) : null;
    if (departmentId && !to) throw httpErrors.notFound('Department not found');

    // Local groups (not "Everyone", not synced) that at least half of a department's other active members share.
    const shared = async (deptId: string | null | undefined) => {
      if (!deptId) return new Set<string>();
      const [rows, [size]] = await Promise.all([
        this.db
          .select({ groupId: groupMembers.groupId, n: count() })
          .from(groupMembers)
          .innerJoin(users, eq(users.id, groupMembers.userId))
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .where(
            and(
              eq(users.departmentId, deptId),
              ne(users.id, id),
              ne(users.status, 'offboarded'),
              eq(groups.source, 'local'),
              eq(groups.isSystem, false),
            ),
          )
          .groupBy(groupMembers.groupId),
        this.db
          .select({ n: count() })
          .from(users)
          .where(and(eq(users.departmentId, deptId), ne(users.id, id), ne(users.status, 'offboarded'))),
      ]);
      const total = size?.n ?? 0;
      return new Set(total ? rows.filter((r) => r.n * 2 >= total).map((r) => r.groupId) : []);
    };
    const [mine, oldShared, newShared] = await Promise.all([
      this.db
        .select({ groupId: groupMembers.groupId, source: groupMembers.source })
        .from(groupMembers)
        .where(eq(groupMembers.userId, id)),
      shared(from?.id),
      shared(to?.id),
    ]);
    const member = new Set(mine.map((m) => m.groupId));
    const leave = mine
      .filter((m) => m.source === 'manual' && oldShared.has(m.groupId) && !newShared.has(m.groupId))
      .map((m) => m.groupId);
    const join = [...newShared].filter((g) => !member.has(g));

    const scope = alias(departments, 'scope_department');
    const assignments = await this.db
      .select({
        assignmentId: roleAssignments.id,
        roleId: roles.id,
        key: roles.key,
        name: roles.name,
        moduleId: roles.moduleId,
        application: applications.name,
        isPlatform: sql<boolean>`${applications.key} = ${PLATFORM_APP_KEY}`,
        scopeId: scope.id,
        scopeName: scope.name,
        scopePath: scope.path,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .innerJoin(scope, eq(scope.id, roleAssignments.scopeDepartmentId))
      .where(
        and(
          eq(roleAssignments.userId, id),
          eq(roleAssignments.scopeType, 'department'),
          or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())),
        ),
      )
      .orderBy(roles.name);

    return {
      department: to
        ? {
            id: to.id,
            name: to.name,
            manager: to.managerId ? { id: to.managerId, displayName: to.managerName ?? '' } : null,
          }
        : null,
      leave,
      join,
      roles: assignments.map((a) => ({
        assignmentId: a.assignmentId,
        role: { id: a.roleId, key: a.key, name: a.name, moduleId: a.moduleId },
        application: a.isPlatform ? null : a.application,
        scope: { id: a.scopeId, name: a.scopeName },
        oldDepartment: Boolean(from && a.scopePath.startsWith(from.path)),
      })),
    };
  }

  /**
   * Moves a person to another department in one transaction: department, manager and job title; the groups they
   * leave and join; the department-scoped role assignments to remove. The person's history gets one entry,
   * `core.user.transferred`, that lists all of it; each group keeps its own entry and every removed role its
   * `core.role-assignment.revoked` (both marked `via`). The old and the new manager are asked to review the rest.
   */
  async transfer(id: string, input: z.output<typeof transferUserSchema>, auth: AuthContext) {
    const before = await this.find(id);
    auth.require('core.users.update', {
      departmentId: before.departmentId,
      recordType: 'user',
      recordId: id,
    });
    const departmentId = input.departmentId ?? null;
    if (departmentId === (before.departmentId ?? null))
      throw httpErrors.badRequest('The person is already in that department');
    auth.require('core.users.update', { departmentId });
    if (before.status === 'offboarded')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Offboarded people cannot be moved');
    if (input.managerId === id) throw httpErrors.badRequest('A user cannot be their own manager');
    if (departmentId) {
      const [d] = await this.db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, departmentId));
      if (!d) throw httpErrors.notFound('Department not found');
    }
    if (input.managerId) {
      const [m] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, input.managerId));
      if (!m) throw httpErrors.notFound('Manager not found');
    }
    const groupChange = await this.checkGroupChange(id, input.joinGroupIds, input.leaveGroupIds, auth);

    // Role assignments to remove: the person's own, each checked like a revocation.
    const revokeIds = [...new Set(input.revokeAssignmentIds)];
    const revoking = revokeIds.length
      ? await this.db
          .select({
            id: roleAssignments.id,
            userId: roleAssignments.userId,
            roleId: roles.id,
            key: roles.key,
            scopeType: roleAssignments.scopeType,
            scopeDepartmentId: roleAssignments.scopeDepartmentId,
            applicationId: applications.id,
            isPlatform: sql<boolean>`${applications.key} = ${PLATFORM_APP_KEY}`,
          })
          .from(roleAssignments)
          .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
          .innerJoin(applications, eq(applications.id, roles.applicationId))
          .where(inArray(roleAssignments.id, revokeIds))
      : [];
    for (const assignmentId of revokeIds) {
      const a = revoking.find((r) => r.id === assignmentId);
      if (!a || a.userId !== id) throw httpErrors.notFound('Assignment not found');
      if (!a.isPlatform)
        auth.require('core.applications.manage', { recordType: 'application', recordId: a.applicationId });
      else if (a.scopeType === 'department')
        auth.require('core.roles.assign', { departmentId: a.scopeDepartmentId });
      else auth.require('core.roles.assign');
      if (id === auth.user?.id && a.key === 'platform-admin')
        throw new HttpError(
          409,
          ErrorCodes.SELF_LOCKOUT,
          'You cannot remove your own platform administrator role',
        );
    }

    const patch: Partial<UserRow> = { departmentId };
    if (input.managerId !== undefined) patch.managerId = input.managerId ?? null;
    if (input.jobTitle !== undefined) patch.jobTitle = input.jobTitle?.trim() || null;
    const via = 'core.user.transferred';

    const result = await this.ctx.transaction(async (tx) => {
      // Against the locked row: a second, simultaneous move to the same department finds it done and is refused
      // (nothing is recorded or sent twice).
      const locked = await this.lock(tx, id);
      if ((locked.departmentId ?? null) === departmentId)
        throw httpErrors.badRequest('The person is already in that department');
      if (locked.status === 'offboarded')
        throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Offboarded people cannot be moved');
      const changes = this.ctx.audit.diff(
        locked as unknown as Record<string, unknown>,
        patch as Record<string, unknown>,
      );
      const [updated] = await tx.update(users).set(patch).where(eq(users.id, id)).returning();
      const { joined, left } = await this.applyGroupChange(tx, id, groupChange, auth, via);
      const removed = revoking.length
        ? new Set(
            (
              await tx
                .delete(roleAssignments)
                .where(and(inArray(roleAssignments.id, revokeIds), eq(roleAssignments.userId, id)))
                .returning({ id: roleAssignments.id })
            ).map((r) => r.id),
          )
        : new Set<string>();
      const revoked = revoking.filter((a) => removed.has(a.id));
      for (const a of revoked) {
        await this.ctx.audit.record(
          {
            action: 'core.role-assignment.revoked',
            category: 'security',
            entityType: 'user',
            entityId: id,
            entityLabel: updated!.displayName,
            metadata: { assignmentId: a.id, role: a.key, roleId: a.roleId, scopeType: a.scopeType, via },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'core.role-assignment.revoked',
          { assignmentId: a.id, roleId: a.roleId },
          { tx },
        );
      }
      await this.ctx.audit.record(
        {
          action: 'core.user.transferred',
          category: revoked.length ? 'security' : 'data',
          entityType: 'user',
          entityId: id,
          entityLabel: updated!.displayName,
          changes,
          metadata: {
            groupsJoined: joined,
            groupsLeft: left,
            rolesRevoked: revoked.map((a) => a.roleId),
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.user.updated',
        { userId: id, email: updated!.email, changes: Object.keys(changes) },
        { tx },
      );
      await this.transferred(tx, locked, updated!);
      return { joined: joined.length, left: left.length, revoked: revoked.length };
    });
    await getKernel().rbac.bump();
    return result;
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
