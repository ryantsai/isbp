/**
 * Projects on My work (`manifest.work`): the person's open tasks, and the sidebar check that shows Projects to the
 * people who take part in a project (or run the portfolio), not to everyone who may see internal projects.
 */
import type { NavigationCheck, WorkProvider } from '@isbp/sdk/server';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { formatTaskRef, OPEN_TASK_STATUSES, PERMISSIONS } from '../model';
import { seesAll, visibleProjects } from './access';
import { members, projects, tasks } from './schema';
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

export const projectsWork = { tasks: myTasks };
export const projectsNavigation = { portfolio };
