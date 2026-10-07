/**
 * Record resolvers (`projects.project`, `projects.task`) and the global search provider. They apply the
 * same visibility rules as the module's pages (`access.ts`), in one indexed query per call.
 */
import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  likePattern,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
  type SearchHit,
} from '@isbp/sdk/server';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  formatTaskRef,
  isUuid,
  PROJECT_KEY_RE,
  PROJECT_STATUS_TONE,
  type ProjectStatus,
  TASK_STATUS_TONE,
  type TaskStatus,
} from '../model';
import { accessFor, myRoleColumn, visibleProjects } from './access';
import { type ProjectRow, projects, tasks } from './schema';
import { services } from './services';
import { rolesIn } from './tasks';
import { actorOf, projectHref, taskHref } from './shared';

const projectStatus = (s: ProjectStatus) => ({
  key: `projects.projectStatus.${s}`,
  tone: PROJECT_STATUS_TONE[s],
});
const taskStatus = (s: TaskStatus) => ({ key: `projects.taskStatus.${s}`, tone: TASK_STATUS_TONE[s] });

function projectSummary(
  p: ProjectRow,
  ownerName: string | null,
  role: Parameters<typeof accessFor>[1],
  auth: AuthContext,
): RecordSummary {
  const access = accessFor(p, role, auth);
  return {
    id: p.id,
    reference: p.key,
    title: p.name,
    subtitle: ownerName,
    status: projectStatus(p.status),
    href: projectHref(p.key),
    editable: access.canManage,
  };
}

async function selectProjects(
  ctx: ModuleContext,
  auth: AuthContext,
  where: ReturnType<typeof and>,
  limit: number,
  recent = false,
) {
  return ctx.db
    .select({ project: projects, ownerName: users.displayName, role: myRoleColumn(auth) })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(and(visibleProjects(auth), where))
    .orderBy(
      ...(recent
        ? [desc(projects.updatedAt)]
        : [
            sql`case when ${projects.status} in ('active', 'on_hold', 'proposed') then 0 else 1 end`,
            projects.key,
          ]),
    )
    .limit(limit);
}

export const projectRecords: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const wanted = ids.filter(isUuid);
    if (!wanted.length) return [];
    const rows = await selectProjects(ctx, auth, inArray(projects.id, wanted), wanted.length);
    return rows.map((r) => projectSummary(r.project, r.ownerName, r.role, auth));
  },
  async search(query, ctx, auth, limit) {
    const q = query.trim();
    const where = q
      ? or(
          ilike(projects.name, likePattern(q)),
          PROJECT_KEY_RE.test(q.toUpperCase()) ? eq(projects.key, q.toUpperCase()) : undefined,
        )
      : undefined;
    const rows = await selectProjects(ctx, auth, where, limit, !q);
    return rows.map((r) => projectSummary(r.project, r.ownerName, r.role, auth));
  },
};

async function taskSummaries(
  ctx: ModuleContext,
  auth: AuthContext,
  rows: { task: typeof tasks.$inferSelect; project: ProjectRow }[],
): Promise<RecordSummary[]> {
  const roles = await rolesIn(ctx.db, [...new Set(rows.map((r) => r.project.id))], actorOf(auth));
  return rows.map(({ task, project }) => {
    const access = accessFor(project, roles.get(project.id) ?? null, auth);
    const reference = formatTaskRef(project.key, task.number);
    return {
      id: task.id,
      reference,
      title: task.title,
      subtitle: project.name,
      status: taskStatus(task.status),
      href: taskHref(reference),
      editable: access.canEditTasks || access.canManage,
    };
  });
}

export const taskRecords: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const wanted = ids.filter(isUuid);
    if (!wanted.length) return [];
    const rows = await ctx.db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(visibleProjects(auth), inArray(tasks.id, wanted)))
      .limit(wanted.length);
    return taskSummaries(ctx, auth, rows);
  },
  async search(query, ctx, auth, limit) {
    const rows = await services(ctx).tasks.searchTasks(query, auth, limit);
    return taskSummaries(
      ctx,
      auth,
      rows.map((r) => ({ task: r.task, project: r.project })),
    );
  },
};

/** Command palette: projects by key or name, tasks by reference or title (visible to the caller). */
export async function search(
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const [projectHits, taskHits] = await Promise.all([
    projectRecords.search(q, ctx, auth, Math.max(1, Math.ceil(limit / 2))),
    taskRecords.search(q, ctx, auth, limit),
  ]);
  const hits: SearchHit[] = [
    ...projectHits.map((p) => ({
      id: p.id,
      type: 'project',
      title: p.title,
      subtitle: [p.reference, p.subtitle].filter(Boolean).join(' · '),
      href: p.href,
      icon: 'folder-kanban',
    })),
    ...taskHits.map((t) => ({
      id: t.id,
      type: 'task',
      title: t.title,
      subtitle: [t.reference, t.subtitle].filter(Boolean).join(' · '),
      href: t.href,
      icon: 'list-todo',
    })),
  ];
  return hits.slice(0, limit);
}
