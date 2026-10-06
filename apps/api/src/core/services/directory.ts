import type {
  createDepartmentSchema,
  createGroupSchema,
  groupListQuerySchema,
  updateDepartmentSchema,
  updateGroupSchema,
} from '@isbp/contracts';
import { departments, groupMembers, groups, roleAssignments, users, uuidv7 } from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type listQuerySchema,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, count, eq, ilike, inArray, like, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { EVERYONE_GROUP_KEY } from '../../kernel/rbac';
import { getKernel } from '../kernel-ref';
import { likePattern, orderBy, pageOffset } from '../util';

const manager = alias(users, 'dept_manager');

/** Departments (org hierarchy with materialized paths) and groups (with memberships). */
export class DirectoryService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  /* ───────────── departments ───────────── */

  async listDepartments() {
    const memberCounts = this.db
      .select({ departmentId: users.departmentId, n: count().as('n') })
      .from(users)
      .where(sql`${users.status} in ('active', 'pending')`)
      .groupBy(users.departmentId)
      .as('member_counts');
    const rows = await this.db
      .select({ d: departments, mgrId: manager.id, mgrName: manager.displayName, members: memberCounts.n })
      .from(departments)
      .leftJoin(manager, eq(manager.id, departments.managerId))
      .leftJoin(memberCounts, eq(memberCounts.departmentId, departments.id))
      .orderBy(departments.sortOrder, departments.name);
    return rows.map((r) => ({
      id: r.d.id,
      code: r.d.code,
      name: r.d.name,
      description: r.d.description,
      parentId: r.d.parentId,
      path: r.d.path,
      manager: r.mgrId ? { id: r.mgrId, displayName: r.mgrName! } : null,
      memberCount: Number(r.members ?? 0),
      sortOrder: r.d.sortOrder,
      createdAt: r.d.createdAt,
    }));
  }

  private async findDepartment(id: string) {
    const [d] = await this.db.select().from(departments).where(eq(departments.id, id));
    if (!d) throw httpErrors.notFound('Department not found');
    return d;
  }

  async createDepartment(input: z.output<typeof createDepartmentSchema>, auth: AuthContext) {
    if (input.parentId) auth.require('core.departments.manage', { departmentId: input.parentId });
    else auth.require('core.departments.manage');
    const parent = input.parentId ? await this.findDepartment(input.parentId) : null;
    const id = uuidv7();
    const dept = await this.ctx.transaction(async (tx) => {
      const [created] = await tx
        .insert(departments)
        .values({
          id,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          parentId: parent?.id ?? null,
          managerId: input.managerId ?? null,
          sortOrder: input.sortOrder,
          path: `${parent?.path ?? '/'}${id}/`,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.department.created',
          entityType: 'department',
          entityId: id,
          entityLabel: created!.name,
        },
        { tx },
      );
      await this.ctx.events.publish('core.department.created', { departmentId: id }, { tx });
      return created!;
    });
    return dept;
  }

  async updateDepartment(id: string, input: z.output<typeof updateDepartmentSchema>, auth: AuthContext) {
    const before = await this.findDepartment(id);
    auth.require('core.departments.manage', { departmentId: id });
    const moving = input.parentId !== undefined && (input.parentId ?? null) !== before.parentId;
    let newPath = before.path;
    if (moving) {
      if (input.parentId) {
        auth.require('core.departments.manage', { departmentId: input.parentId });
        const parent = await this.findDepartment(input.parentId);
        if (parent.path.startsWith(before.path))
          throw new HttpError(409, ErrorCodes.INVALID_PARENT, 'A department cannot be moved under itself');
        newPath = `${parent.path}${id}/`;
      } else {
        auth.require('core.departments.manage');
        newPath = `/${id}/`;
      }
    }
    const patch = {
      code: input.code,
      name: input.name,
      description: input.description,
      managerId: input.managerId,
      sortOrder: input.sortOrder,
      ...(moving ? { parentId: input.parentId ?? null } : {}),
    };
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    const updated = await this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(departments).set(patch).where(eq(departments.id, id)).returning();
      if (moving) {
        // Re-root the whole subtree in one statement.
        await tx
          .update(departments)
          .set({ path: sql`${newPath} || substr(${departments.path}, ${before.path.length + 1})` })
          .where(like(departments.path, `${before.path}%`));
      }
      await this.ctx.audit.record(
        {
          action: 'core.department.updated',
          entityType: 'department',
          entityId: id,
          entityLabel: row!.name,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish('core.department.updated', { departmentId: id }, { tx });
      return row!;
    });
    if (moving) await getKernel().rbac.bump();
    return updated;
  }

  async deleteDepartment(id: string, auth: AuthContext) {
    const dept = await this.findDepartment(id);
    auth.require('core.departments.manage', { departmentId: id });
    const [children] = await this.db
      .select({ n: count() })
      .from(departments)
      .where(eq(departments.parentId, id));
    if (children!.n > 0)
      throw new HttpError(409, ErrorCodes.HAS_CHILDREN, 'Move or delete the sub-departments first');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(departments).where(eq(departments.id, id));
      await this.ctx.audit.record(
        { action: 'core.department.deleted', entityType: 'department', entityId: id, entityLabel: dept.name },
        { tx },
      );
      await this.ctx.events.publish('core.department.deleted', { departmentId: id }, { tx });
    });
    await getKernel().rbac.bump();
  }

  /* ───────────── groups ───────────── */

  async listGroups(q: z.output<typeof groupListQuerySchema>) {
    const memberCounts = this.db
      .select({ groupId: groupMembers.groupId, n: count().as('members') })
      .from(groupMembers)
      .groupBy(groupMembers.groupId)
      .as('gm');
    const roleCounts = this.db
      .select({ groupId: roleAssignments.groupId, n: count().as('roles') })
      .from(roleAssignments)
      .groupBy(roleAssignments.groupId)
      .as('gr');
    const where = and(
      q.source ? eq(groups.source, q.source) : undefined,
      q.q ? or(ilike(groups.name, likePattern(q.q)), ilike(groups.key, likePattern(q.q))) : undefined,
    );
    const [rows, [total], [everyone]] = await Promise.all([
      this.db
        .select({ g: groups, members: memberCounts.n, roles: roleCounts.n })
        .from(groups)
        .leftJoin(memberCounts, eq(memberCounts.groupId, groups.id))
        .leftJoin(roleCounts, eq(roleCounts.groupId, groups.id))
        .where(where)
        .orderBy(
          ...orderBy(
            q.sort,
            { name: groups.name, key: groups.key, createdAt: groups.createdAt, source: groups.source },
            'name',
            groups.id,
          ),
        )
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(groups).where(where),
      this.db.select({ n: count() }).from(users).where(eq(users.status, 'active')),
    ]);
    return {
      items: rows.map((r) => ({
        ...this.groupDto(r.g),
        memberCount: r.g.key === EVERYONE_GROUP_KEY && r.g.isSystem ? everyone!.n : Number(r.members ?? 0),
        roleCount: Number(r.roles ?? 0),
      })),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private groupDto(g: typeof groups.$inferSelect) {
    return {
      id: g.id,
      key: g.key,
      name: g.name,
      description: g.description,
      source: g.source,
      isSystem: g.isSystem,
      createdAt: g.createdAt,
      memberCount: 0,
      roleCount: 0,
    };
  }

  async findGroup(id: string) {
    const [g] = await this.db.select().from(groups).where(eq(groups.id, id));
    if (!g) throw httpErrors.notFound('Group not found');
    return g;
  }

  async getGroup(id: string) {
    const g = await this.findGroup(id);
    const [[members], [roles]] = await Promise.all([
      g.isSystem && g.key === EVERYONE_GROUP_KEY
        ? this.db.select({ n: count() }).from(users).where(eq(users.status, 'active'))
        : this.db.select({ n: count() }).from(groupMembers).where(eq(groupMembers.groupId, id)),
      this.db.select({ n: count() }).from(roleAssignments).where(eq(roleAssignments.groupId, id)),
    ]);
    return { ...this.groupDto(g), memberCount: members!.n, roleCount: roles!.n };
  }

  async createGroup(input: z.output<typeof createGroupSchema>, auth: AuthContext) {
    auth.require('core.groups.manage');
    return this.ctx.transaction(async (tx) => {
      const [g] = await tx
        .insert(groups)
        .values({ key: input.key, name: input.name, description: input.description ?? null })
        .returning();
      await this.ctx.audit.record(
        { action: 'core.group.created', entityType: 'group', entityId: g!.id, entityLabel: g!.name },
        { tx },
      );
      await this.ctx.events.publish('core.group.created', { groupId: g!.id }, { tx });
      return g!;
    });
  }

  async updateGroup(id: string, input: z.output<typeof updateGroupSchema>, auth: AuthContext) {
    const before = await this.findGroup(id);
    auth.require('core.groups.manage', { recordType: 'group', recordId: id });
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    return this.ctx.transaction(async (tx) => {
      const [g] = await tx.update(groups).set(input).where(eq(groups.id, id)).returning();
      await this.ctx.audit.record(
        { action: 'core.group.updated', entityType: 'group', entityId: id, entityLabel: g!.name, changes },
        { tx },
      );
      await this.ctx.events.publish('core.group.updated', { groupId: id }, { tx });
      return g!;
    });
  }

  async deleteGroup(id: string, auth: AuthContext) {
    const g = await this.findGroup(id);
    auth.require('core.groups.manage', { recordType: 'group', recordId: id });
    if (g.isSystem) throw new HttpError(409, ErrorCodes.SYSTEM_GROUP, 'System groups cannot be deleted');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(groups).where(eq(groups.id, id));
      await this.ctx.audit.record(
        { action: 'core.group.deleted', entityType: 'group', entityId: id, entityLabel: g.name },
        { tx },
      );
      await this.ctx.events.publish('core.group.deleted', { groupId: id }, { tx });
    });
    await getKernel().rbac.bump();
  }

  async listMembers(id: string, q: z.output<typeof listQuerySchema>) {
    const g = await this.findGroup(id);
    if (g.isSystem && g.key === EVERYONE_GROUP_KEY) {
      return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    }
    const where = and(
      eq(groupMembers.groupId, id),
      q.q ? or(ilike(users.displayName, likePattern(q.q)), ilike(users.email, likePattern(q.q))) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ u: users, source: groupMembers.source, addedAt: groupMembers.addedAt })
        .from(groupMembers)
        .innerJoin(users, eq(users.id, groupMembers.userId))
        .where(where)
        .orderBy(
          ...orderBy(
            q.sort,
            { displayName: users.displayName, addedAt: groupMembers.addedAt },
            'displayName',
            users.id,
          ),
        )
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db
        .select({ n: count() })
        .from(groupMembers)
        .innerJoin(users, eq(users.id, groupMembers.userId))
        .where(where),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.u.id,
        displayName: r.u.displayName,
        email: r.u.email,
        status: r.u.status,
        avatarUrl: r.u.avatarUrl,
        source: r.source,
        addedAt: r.addedAt,
      })),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async addMembers(id: string, userIds: string[], auth: AuthContext) {
    const g = await this.findGroup(id);
    auth.require('core.groups.manage', { recordType: 'group', recordId: id });
    if (g.isSystem && g.key === EVERYONE_GROUP_KEY)
      throw new HttpError(409, ErrorCodes.SYSTEM_GROUP, 'Membership of "Everyone" is implicit');
    const added = await this.ctx.transaction(async (tx) => {
      const rows = await tx
        .insert(groupMembers)
        .values(userIds.map((userId) => ({ groupId: id, userId, addedBy: auth.user?.id ?? null })))
        .onConflictDoNothing()
        .returning({ userId: groupMembers.userId });
      const ids = rows.map((r) => r.userId);
      if (ids.length) {
        await this.ctx.audit.record(
          {
            action: 'core.group.members_added',
            entityType: 'group',
            entityId: id,
            entityLabel: g.name,
            metadata: { userIds: ids },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'core.group.members_changed',
          { groupId: id, added: ids, removed: [] },
          { tx },
        );
      }
      return ids;
    });
    if (added.length) await getKernel().rbac.bump();
    return added.length;
  }

  async removeMembers(id: string, userIds: string[], auth: AuthContext) {
    const g = await this.findGroup(id);
    auth.require('core.groups.manage', { recordType: 'group', recordId: id });
    const removed = await this.ctx.transaction(async (tx) => {
      const rows = await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, id), inArray(groupMembers.userId, userIds)))
        .returning({ userId: groupMembers.userId });
      const ids = rows.map((r) => r.userId);
      if (ids.length) {
        await this.ctx.audit.record(
          {
            action: 'core.group.members_removed',
            entityType: 'group',
            entityId: id,
            entityLabel: g.name,
            metadata: { userIds: ids },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'core.group.members_changed',
          { groupId: id, added: [], removed: ids },
          { tx },
        );
      }
      return ids;
    });
    if (removed.length) await getKernel().rbac.bump();
    return removed.length;
  }
}
