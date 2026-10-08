import { approvalDelegations, departments, groupMembers, groups, users } from '@isbp/db/schema';
import { type ApproverRule, type Db, getFact } from '@isbp/sdk/server';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { PLATFORM_APP_KEY } from '../rbac';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A group slot fans out to at most this many people. */
export const MAX_SLOT_ASSIGNEES = 100;

export interface ResolveContext {
  requesterId: string | null;
  /** Whose manager chain and department `manager` / `department-head` rules use. */
  subjectUserId: string | null;
  facts: Record<string, unknown>;
}

export interface Assignee {
  userId: string;
  /** Set when an out-of-office delegation redirected the task. */
  delegatedFromId: string | null;
}

/** Turns approver rules into active people, honouring fallbacks, exclusions and delegations. */
export class ApproverResolver {
  constructor(private readonly db: Db) {}

  private async candidates(tx: Db, rule: ApproverRule, ctx: ResolveContext): Promise<string[]> {
    switch (rule.type) {
      case 'user':
        return [rule.userId];
      case 'requester':
        return ctx.requesterId ? [ctx.requesterId] : [];
      case 'fact': {
        const v = getFact(ctx.facts, rule.fact);
        const list = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string');
        if (rule.kind === 'group') {
          // Group keys (e.g. a CI's owner group): any member approves.
          const keys = [...new Set(list.filter((k) => k && k.length <= 64))].slice(0, 20);
          if (!keys.length) return [];
          const rows = await tx
            .select({ id: groupMembers.userId })
            .from(groupMembers)
            .innerJoin(groups, eq(groups.id, groupMembers.groupId))
            .where(inArray(groups.key, keys))
            .limit(MAX_SLOT_ASSIGNEES * 2);
          return rows.map((r) => r.id);
        }
        return list.filter((x) => UUID_RE.test(x));
      }
      case 'group': {
        const rows = await tx
          .select({ id: groupMembers.userId })
          .from(groupMembers)
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .where(eq(groups.key, rule.groupKey))
          .limit(MAX_SLOT_ASSIGNEES * 2);
        return rows.map((r) => r.id);
      }
      case 'role': {
        // Holders of a platform role at global scope, directly or through a group (never "everyone").
        const res = await tx.execute<{ id: string }>(sql`
          select distinct coalesce(ra.user_id, gm.user_id) as id
            from core.role_assignments ra
            join core.roles r on r.id = ra.role_id and r.key = ${rule.roleKey}
            join core.applications app on app.id = r.application_id and app.key = ${PLATFORM_APP_KEY}
            left join core.group_members gm on gm.group_id = ra.group_id
           where ra.scope_type = 'global'
             and (ra.expires_at is null or ra.expires_at > now())
             and coalesce(ra.user_id, gm.user_id) is not null
           limit ${MAX_SLOT_ASSIGNEES * 2}`);
        return res.rows.map((r) => r.id);
      }
      case 'manager': {
        let current = ctx.subjectUserId;
        for (let i = 0; i < (rule.level ?? 1) && current; i++) {
          const [row] = await tx
            .select({ managerId: users.managerId })
            .from(users)
            .where(eq(users.id, current));
          current = row?.managerId ?? null;
        }
        return current && current !== ctx.subjectUserId ? [current] : [];
      }
      case 'department-head': {
        if (!ctx.subjectUserId) return [];
        const [row] = await tx
          .select({ managerId: departments.managerId })
          .from(users)
          .innerJoin(departments, eq(departments.id, users.departmentId))
          .where(eq(users.id, ctx.subjectUserId));
        return row?.managerId ? [row.managerId] : [];
      }
    }
  }

  private async active(tx: Db, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.status, 'active')));
    return new Set(rows.map((r) => r.id));
  }

  /** Active people for a rule minus `excluded`; walks `fallback` when nobody is left. */
  async resolve(
    rule: ApproverRule,
    ctx: ResolveContext,
    excluded: ReadonlySet<string>,
    tx: Db = this.db,
    depth = 0,
  ): Promise<string[]> {
    const ids = [...new Set(await this.candidates(tx, rule, ctx))];
    const active = await this.active(tx, ids);
    const result = ids.filter((id) => active.has(id) && !excluded.has(id)).slice(0, MAX_SLOT_ASSIGNEES);
    if (!result.length && 'fallback' in rule && rule.fallback && depth < 5)
      return this.resolve(rule.fallback, ctx, excluded, tx, depth + 1);
    return result;
  }

  /**
   * Redirects people who are out of office to their active delegate (one hop, so delegations can't
   * loop). A delegate who is excluded (e.g. the requester) or inactive is ignored.
   */
  async applyDelegations(tx: Db, userIds: string[], excluded: ReadonlySet<string>): Promise<Assignee[]> {
    if (!userIds.length) return [];
    const now = new Date();
    const rows = await tx
      .select({ userId: approvalDelegations.userId, delegateId: approvalDelegations.delegateId })
      .from(approvalDelegations)
      .where(
        and(
          inArray(approvalDelegations.userId, userIds),
          lte(approvalDelegations.startsAt, now),
          gt(approvalDelegations.endsAt, now),
        ),
      );
    const delegates = await this.active(
      tx,
      rows.map((r) => r.delegateId),
    );
    const byUser = new Map(
      rows
        .filter((r) => delegates.has(r.delegateId) && !excluded.has(r.delegateId))
        .map((r) => [r.userId, r.delegateId]),
    );
    const out = new Map<string, Assignee>();
    for (const id of userIds) {
      const delegate = byUser.get(id);
      const a: Assignee = delegate
        ? { userId: delegate, delegatedFromId: id }
        : { userId: id, delegatedFromId: null };
      if (!out.has(a.userId) || !a.delegatedFromId) out.set(a.userId, a);
    }
    return [...out.values()];
  }
}
