/**
 * Projects on My work (`manifest.work`): the person's open tasks and the status updates they owe, and the sidebar check
 * that shows Projects to the people who take part in a project (or run the portfolio), not to everyone who may see
 * internal projects.
 */
import type { NavigationCheck, WorkProvider } from '@isbp/sdk/server';
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { formatTaskRef, OPEN_TASK_STATUSES, PERMISSIONS } from '../model';
import { seesAll, visibleProjects } from './access';
import { composeHref } from './reporting';
import { members, projects, statusUpdates, tasks } from './schema';
import { taskHref } from './shared';

/** Open tasks assigned to the person in projects they can see, soonest due first. */
const myTasks: WorkProvider = async (auth, ctx, { limit }) => {
  const where = and(
    visibleProjects(auth),
    eq(tasks.assigneeId, auth.user!.id),
    inArray(tasks.status, [...OPEN_TASK_STATUSES]),
    isNull(projects.archivedAt),
  );
  const [[total], rows] = await Promise.all([
    ctx.db
      .select({ n: count() })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(where),
    limit > 0
      ? ctx.db
          .select({
            id: tasks.id,
            number: tasks.number,
            title: tasks.title,
            dueDate: tasks.dueDate,
            key: projects.key,
            project: projects.name,
          })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(where)
          .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(projects.key), asc(tasks.number))
          .limit(limit)
      : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map((r) => {
      const reference = formatTaskRef(r.key, r.number);
      return {
        id: r.id,
        title: r.title,
        subtitle: `${reference} · ${r.project}`,
        href: taskHref(reference),
        due: r.dueDate,
      };
    }),
  };
};

/** Status updates the person owes for periods still open (sent ones and missed ones are not work any more). */
const myStatusUpdates: WorkProvider = async (auth, ctx, { limit }) => {
  const where = and(
    eq(statusUpdates.authorId, auth.user!.id),
    eq(statusUpdates.state, 'pending'),
    gt(statusUpdates.closesAt, new Date()),
    visibleProjects(auth),
    isNull(projects.archivedAt),
  );
  const [[total], rows] = await Promise.all([
    ctx.db
      .select({ n: count() })
      .from(statusUpdates)
      .innerJoin(projects, eq(projects.id, statusUpdates.projectId))
      .where(where),
    limit > 0
      ? ctx.db
          .select({
            id: statusUpdates.id,
            dueAt: statusUpdates.dueAt,
            createdAt: statusUpdates.createdAt,
            key: projects.key,
            name: projects.name,
          })
          .from(statusUpdates)
          .innerJoin(projects, eq(projects.id, statusUpdates.projectId))
          .where(where)
          .orderBy(asc(statusUpdates.dueAt), asc(projects.key))
          .limit(limit)
      : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: r.key,
      detail: { key: 'projects.work.statusUpdateDetail' },
      href: composeHref(r.key),
      due: r.dueAt,
      since: r.createdAt,
    })),
  };
};

/** Projects in the sidebar: members of a project, people who create projects and portfolio readers. */
const portfolio: NavigationCheck = async (auth, ctx) => {
  if (seesAll(auth) || auth.can(PERMISSIONS.create)) return true;
  const me = auth.user?.id;
  if (!me) return false;
  const [row] = await ctx.db
    .select({ id: members.id })
    .from(members)
    .innerJoin(projects, eq(projects.id, members.projectId))
    .where(and(eq(members.userId, me), isNull(projects.archivedAt)))
    .limit(1);
  return Boolean(row);
};

export const projectsWork = { tasks: myTasks, 'status-updates': myStatusUpdates };
export const projectsNavigation = { portfolio };
