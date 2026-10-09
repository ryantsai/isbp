/**
 * The core's contributions to My work (`manifest.work`): approval decisions waiting for the person and the forms
 * assigned to them or their groups (the "To do" list).
 */
import {
  approvalTasks,
  formAssignments,
  forms,
  groupMembers,
  users,
  workflowInstances,
} from '@isbp/db/schema';
import { localize, type WorkProvider } from '@isbp/sdk/server';
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { assignmentHref } from './services/form-assignments';

const approvals: WorkProvider = async (auth, ctx, { limit, locale }) => {
  const me = auth.user!.id;
  const where = and(
    eq(approvalTasks.assigneeId, me),
    eq(approvalTasks.status, 'pending'),
    eq(workflowInstances.status, 'running'),
  );
  const [[total], rows] = await Promise.all([
    ctx.db
      .select({ n: count() })
      .from(approvalTasks)
      .innerJoin(workflowInstances, eq(workflowInstances.id, approvalTasks.instanceId))
      .where(where),
    limit > 0
      ? ctx.db
          .select({
            id: approvalTasks.id,
            dueAt: approvalTasks.dueAt,
            createdAt: approvalTasks.createdAt,
            subject: workflowInstances.subjectLabel,
            requester: users.displayName,
          })
          .from(approvalTasks)
          .innerJoin(workflowInstances, eq(workflowInstances.id, approvalTasks.instanceId))
          .leftJoin(users, eq(users.id, workflowInstances.requesterId))
          .where(where)
          .orderBy(sql`${approvalTasks.dueAt} asc nulls last`, desc(approvalTasks.createdAt))
          .limit(limit)
      : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map((r) => {
      const title = localize(r.subject, locale);
      return {
        id: r.id,
        title,
        // Subjects often name the requester already ("Laptop request — 林雅婷").
        subtitle: r.requester && !title.includes(r.requester) ? r.requester : null,
        href: `/approvals?task=${r.id}`,
        due: r.dueAt,
        since: r.createdAt,
      };
    }),
  };
};

const assignedForms: WorkProvider = async (auth, ctx, { limit, locale }) => {
  const me = auth.user!.id;
  const mine = await ctx.db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, me));
  const groupIds = mine.map((g) => g.groupId);
  const a = formAssignments;
  const where = and(
    or(eq(a.assigneeUserId, me), groupIds.length ? inArray(a.assigneeGroupId, groupIds) : undefined),
    eq(a.status, 'open'),
    isNull(forms.archivedAt),
  );
  const [[total], rows] = await Promise.all([
    ctx.db.select({ n: count() }).from(a).innerJoin(forms, eq(forms.id, a.formId)).where(where),
    limit > 0
      ? ctx.db
          .select({
            id: a.id,
            title: a.title,
            dueAt: a.dueAt,
            createdAt: a.createdAt,
            formKey: forms.key,
            formName: forms.name,
          })
          .from(a)
          .innerJoin(forms, eq(forms.id, a.formId))
          .where(where)
          .orderBy(asc(a.dueAt), asc(a.id))
          .limit(limit)
      : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map((r) => {
      const form = localize(r.formName, locale);
      return {
        id: r.id,
        title: r.title,
        subtitle: form === r.title ? null : form,
        href: assignmentHref(r.formKey, r.id),
        due: r.dueAt,
        since: r.createdAt,
      };
    }),
  };
};

export const coreWork = { approvals, forms: assignedForms };
