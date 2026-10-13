/**
 * Handlers of `manifest.ai.tools`. Inputs are validated against the manifest schemas by the gateway;
 * every handler goes through the same services (and access rules) as the UI.
 */
import { users } from '@isbp/db/schema';
import { type AiToolHandler, type AuthContext, likePattern, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import {
  aiCreateTaskInput,
  aiFindTasksInput,
  aiMyTasksInput,
  aiPostStatusUpdateInput,
  aiProjectStatusInput,
  aiStatusReportInput,
  aiUpdateTaskStatusInput,
} from '../contracts';
import { PROJECT_KEY_RE, todayIn } from '../model';
import { visibleProjects } from './access';
import { type ProjectRow, projects } from './schema';
import { services } from './services';
import { invalid, notFound, projectHref, taskHref } from './shared';
import { reasonText } from './status-report';
import { updatesHref } from './status-updates';
import { textLocale } from './text';

interface Item {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  project: { key: string; name: string };
  assignee: { displayName: string } | null;
  dueDate: string | null;
}

/** A task as tools return it: plain strings a model can quote, plus a link for the UI. */
const compact = (t: Item) => ({
  id: t.id,
  reference: t.reference,
  title: t.title,
  status: t.status,
  priority: t.priority,
  project: t.project.key,
  projectName: t.project.name,
  assignee: t.assignee?.displayName ?? null,
  dueDate: t.dueDate,
  href: taskHref(t.reference),
});

/** A project by key (`NET`) or (part of) its name, among the ones the caller can see. */
async function resolveProject(ctx: ModuleContext, text: string, auth: AuthContext): Promise<ProjectRow> {
  const v = text.trim();
  if (PROJECT_KEY_RE.test(v.toUpperCase())) {
    const [byKey] = await ctx.db
      .select()
      .from(projects)
      .where(and(visibleProjects(auth), eq(projects.key, v.toUpperCase())));
    if (byKey) return byKey;
  }
  const [byName] = await ctx.db
    .select()
    .from(projects)
    .where(and(visibleProjects(auth), ilike(projects.name, likePattern(v))))
    .orderBy(
      sql`case when lower(${projects.name}) = lower(${v}) then 0 else 1 end`,
      sql`case when ${projects.status} in ('active', 'on_hold', 'proposed') then 0 else 1 end`,
      asc(projects.name),
    )
    .limit(1);
  if (!byName) throw notFound('project');
  return byName;
}

async function userByEmail(ctx: ModuleContext, email: string, path: string) {
  const [u] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  if (!u) throw invalid(path, `Nobody has the email address ${email}`);
  return u.id;
}

export const aiTools: Record<string, AiToolHandler> = {
  'projects.my_tasks': async (input, ctx, auth) => {
    const { status } = aiMyTasksInput.parse(input);
    if (!auth.user) return { tasks: [] };
    const page = await services(ctx).tasks.list(
      {
        page: 1,
        pageSize: 50,
        assignee: 'me',
        status: status === 'open' ? 'open' : undefined,
        sort: status === 'open' ? 'due' : '-updated',
      },
      auth,
    );
    return { total: page.total, tasks: page.items.map(compact) };
  },

  'projects.find_tasks': async (input, ctx, auth) => {
    const q = aiFindTasksInput.parse(input);
    const project = q.project ? await resolveProject(ctx, q.project, auth) : null;
    const assignee = q.assignee
      ? q.assignee.toLowerCase() === 'me'
        ? 'me'
        : await userByEmail(ctx, q.assignee, 'assignee')
      : undefined;
    const page = await services(ctx).tasks.list(
      {
        page: 1,
        pageSize: q.limit,
        q: q.query || undefined,
        project: project?.key,
        assignee,
        status: q.status,
        sort: '-updated',
      },
      auth,
    );
    return { total: page.total, tasks: page.items.map(compact) };
  },

  'projects.create_task': async (input, ctx, auth) => {
    const q = aiCreateTaskInput.parse(input);
    const project = await resolveProject(ctx, q.project, auth);
    const assigneeId = q.assigneeEmail ? await userByEmail(ctx, q.assigneeEmail, 'assigneeEmail') : undefined;
    const svc = services(ctx).tasks;
    const { task } = await svc.create(
      project.key,
      {
        title: q.title,
        description: q.description,
        assigneeId,
        dueDate: q.dueDate,
        priority: q.priority,
      },
      auth,
    );
    return compact(await svc.detail(task.id, auth));
  },

  'projects.update_task_status': async (input, ctx, auth) => {
    const q = aiUpdateTaskStatusInput.parse(input);
    const svc = services(ctx).tasks;
    await svc.update(q.task, { status: q.status }, auth);
    if (q.comment) await svc.addComment(q.task, q.comment, auth);
    return compact(await svc.detail(q.task, auth));
  },

  'projects.project_status': async (input, ctx, auth) => {
    const { project: text } = aiProjectStatusInput.parse(input);
    const project = await resolveProject(ctx, text, auth);
    const s = services(ctx);
    const detail = await s.projects.detail(project.id, auth);
    const today = todayIn(auth.user?.timezone);
    const [overdue, open] = await Promise.all([
      s.tasks.list({ page: 1, pageSize: 10, project: project.key, due: 'overdue', sort: 'due' }, auth),
      s.tasks.list({ page: 1, pageSize: 200, project: project.key, status: 'open', sort: 'due' }, auth),
    ]);
    const board = await s.tasks.board(project.key, {}, auth);
    const blocked = board.columns
      .flatMap((c) => c.tasks)
      .filter((t) => t.blocked)
      .slice(0, 10)
      .map((t) => ({
        reference: t.reference,
        title: t.title,
        status: t.status,
        href: taskHref(t.reference),
      }));
    return {
      project: { key: detail.key, name: detail.name, href: projectHref(detail.key) },
      status: detail.status,
      health: detail.health,
      healthNote: detail.healthNote,
      healthUpdatedAt: detail.healthUpdatedAt,
      owner: detail.owner?.displayName ?? null,
      startDate: detail.startDate,
      targetDate: detail.targetDate,
      today,
      progress: {
        percent: detail.progress,
        done: detail.doneTasks,
        total: detail.totalTasks,
        open: open.total,
      },
      overdue: { count: detail.overdueCount, tasks: overdue.items.map(compact) },
      blocked: { count: detail.kpis.blocked, tasks: blocked },
      nextMilestones: detail.milestones
        .filter((m) => m.status === 'open')
        .slice(0, 3)
        .map((m) => ({ name: m.name, dueDate: m.dueDate, done: m.doneCount, total: m.taskCount })),
      approval: detail.approval?.status ?? null,
    };
  },

  'projects.status_report': async (input, ctx, auth) => {
    const q = aiStatusReportInput.parse(input);
    const s = services(ctx);
    const schedule = await s.reporting.schedule();
    const current = s.reporting.periodAt(schedule);
    const period = q.period === 'previous' ? s.reporting.shift(schedule, current, -1) : current;
    const report = await s.reports.build({ period: period.key, scope: q.scope }, auth);
    const locale = textLocale(auth.user?.locale);
    return {
      period: {
        key: report.period.key,
        start: report.period.start,
        end: report.period.end,
        due: report.period.due,
      },
      counts: report.counts,
      truncated: report.truncated,
      projects: report.projects.map((p) => ({
        key: p.key,
        name: p.name,
        href: p.href,
        state: p.state,
        reasons: p.reasons.map((r) => reasonText(locale, r)),
        reportedStatus: p.reported,
        mismatch: p.mismatch,
        targetDate: p.targetDate,
        expectedFinish: p.forecastDate,
        progress: p.progress,
        manager: p.manager?.displayName ?? null,
        summary: (p.updates.find((u) => u.byManager) ?? p.updates.at(-1))?.summary ?? null,
        blockers: p.updates.map((u) => u.blockers).filter(Boolean),
        missingUpdatesFrom: p.missing.map((m) => m.displayName),
      })),
      href: `/projects/status-report?period=${encodeURIComponent(report.period.key)}`,
    };
  },

  'projects.post_status_update': async (input, ctx, auth) => {
    const { project: text, ...update } = aiPostStatusUpdateInput.parse(input);
    const project = await resolveProject(ctx, text, auth);
    const saved = await services(ctx).statusUpdates.post(project.key, update, auth);
    return {
      project: project.key,
      period: saved.period.key,
      status: saved.status,
      late: saved.standing === 'late',
      setsHealth: saved.byManager,
      href: updatesHref(project.key),
    };
  },
};
