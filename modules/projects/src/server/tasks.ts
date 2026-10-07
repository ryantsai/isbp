import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  max,
  min,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  boardQuerySchema,
  createTaskSchema,
  moveTaskSchema,
  taskQuerySchema,
  timelineQuerySchema,
  updateTaskSchema,
} from '../contracts';
import {
  addDays,
  BOARD_COLUMNS,
  blockingDependencies,
  CLOSED_TASK_STATUSES,
  completedAtFor,
  dueBucket,
  formatTaskRef,
  isUuid,
  type MemberRole,
  needsDependenciesDone,
  OPEN_TASK_STATUSES,
  parseTaskRef,
  RANK_MAX_LENGTH,
  rankBetween,
  rankSequence,
  type TaskStatus,
  todayIn,
  weekStart,
} from '../model';
import { accessFor, type ProjectAccess, visibleProjects } from './access';
import type { ProjectService } from './projects';
import {
  type ActivityKind,
  members,
  milestones,
  type ProjectRow,
  projects,
  taskActivity,
  taskComments,
  taskDependencies,
  type TaskRow,
  tasks,
} from './schema';
import { viaOf, writerOf } from './sync-support';
import {
  actorOf,
  forbidden,
  hoursOrNull,
  invalid,
  notFound,
  peopleByIds,
  personRef,
  taskAuditLabel,
  TASK_ENTITY,
  taskHref,
} from './shared';

type CreateInput = z.output<typeof createTaskSchema>;
type UpdateInput = z.output<typeof updateTaskSchema>;
type MoveInput = z.output<typeof moveTaskSchema>;
type ListQuery = z.output<typeof taskQuerySchema>;
type BoardQuery = z.output<typeof boardQuerySchema>;
type TimelineQuery = z.output<typeof timelineQuerySchema>;

const CLOSED = [...CLOSED_TASK_STATUSES];
const OPEN = [...OPEN_TASK_STATUSES];
/** Cards listed per board column (the rest are counted; the list view pages through all). */
export const BOARD_LIMIT = 200;

const STATUS_RANK = sql`case ${tasks.status} when 'backlog' then 0 when 'todo' then 1 when 'in_progress' then 2 when 'in_review' then 3 when 'done' then 4 else 5 end`;
const PRIORITY_RANK = sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

const SORTABLE: Record<string, SQL[]> = {
  reference: [sql`${projects.key}`, sql`${tasks.number}`],
  title: [sql`${tasks.title}`],
  status: [STATUS_RANK],
  priority: [PRIORITY_RANK],
  due: [sql`${tasks.dueDate}`],
  start: [sql`${tasks.startDate}`],
  updated: [sql`${tasks.updatedAt}`],
  assignee: [sql`${users.displayName}`],
};

export interface LoadedTask {
  task: TaskRow;
  project: ProjectRow;
  access: ProjectAccess;
}

interface ActivityEntry {
  kind: ActivityKind;
  field?: string | null;
  from?: string | null;
  to?: string | null;
}

const dep = alias(tasks, 'dep');

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : Array.isArray(v) ? v.join(', ') : String(v);

/** Fields whose values the timeline keeps (long text and custom fields only say "changed"). */
const VALUE_FIELDS = new Set([
  'title',
  'type',
  'priority',
  'milestoneId',
  'parentId',
  'reporterId',
  'startDate',
  'dueDate',
  'estimateHours',
  'remainingHours',
  'labels',
]);

/** Tasks, the board, the timeline, dependencies, comments and activity — for any principal. */
export class TaskService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly projectSvc: ProjectService,
  ) {}

  /* ───────────── lookups ───────────── */

  /** A task by reference (`NET-12`) or id, with its project; 404 otherwise. */
  async findRow(ref: string, db: Db = this.ctx.db): Promise<{ task: TaskRow; project: ProjectRow }> {
    const parsed = parseTaskRef(ref);
    if (!parsed) throw notFound('task');
    const [row] = await db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        'id' in parsed
          ? eq(tasks.id, parsed.id)
          : and(eq(projects.key, parsed.key), eq(tasks.number, parsed.number)),
      );
    if (!row) throw notFound('task');
    return row;
  }

  /** The task and what the caller may do; 404 when the caller can't see its project. */
  async load(ref: string, auth: AuthContext): Promise<LoadedTask> {
    const { task, project } = await this.findRow(ref);
    const role = await this.projectSvc.roleOf(project.id, auth);
    const access = accessFor(project, role, auth);
    if (!access.canView) throw notFound('task');
    return { task, project, access };
  }

  private async editable(ref: string, auth: AuthContext): Promise<LoadedTask> {
    const loaded = await this.load(ref, auth);
    if (!loaded.access.canEditTasks)
      throw forbidden(
        loaded.project.archivedAt
          ? 'The project is archived'
          : 'Only project members and managers can change tasks',
      );
    return loaded;
  }

  private selectItems() {
    return this.ctx.db
      .select({
        task: tasks,
        projectKey: projects.key,
        projectName: projects.name,
        assigneeName: users.displayName,
        assigneeAvatar: users.avatarUrl,
        milestoneName: milestones.name,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(milestones, eq(milestones.id, tasks.milestoneId));
  }

  private toItem(r: {
    task: TaskRow;
    projectKey: string;
    projectName: string;
    assigneeName: string | null;
    assigneeAvatar: string | null;
    milestoneName: string | null;
  }) {
    const t = r.task;
    return {
      id: t.id,
      reference: formatTaskRef(r.projectKey, t.number),
      number: t.number,
      title: t.title,
      type: t.type,
      status: t.status,
      priority: t.priority,
      assignee: t.assigneeId
        ? { id: t.assigneeId, displayName: r.assigneeName ?? '—', avatarUrl: r.assigneeAvatar ?? null }
        : null,
      startDate: t.startDate,
      dueDate: t.dueDate,
      labels: t.labels,
      project: { id: t.projectId, key: r.projectKey, name: r.projectName },
      milestone: t.milestoneId ? { id: t.milestoneId, name: r.milestoneName ?? '—' } : null,
      estimateHours: hoursOrNull(t.estimateHours),
      remainingHours: hoursOrNull(t.remainingHours),
      updatedAt: t.updatedAt,
    };
  }

  private assigneeFilter(value: string | undefined, auth: AuthContext): SQL | undefined {
    if (!value) return undefined;
    if (value === 'me') return auth.user ? eq(tasks.assigneeId, auth.user.id) : sql`false`;
    if (value === 'none') return isNull(tasks.assigneeId);
    if (isUuid(value)) return eq(tasks.assigneeId, value);
    throw invalid('assignee', 'Use "me", "none" or a person id');
  }

  /** Title text, or a reference (`NET-12`, `12`) within the projects in scope. */
  private textFilter(q: string): SQL {
    const parsed = parseTaskRef(q);
    const byTitle = ilike(tasks.title, likePattern(q));
    if (parsed && 'key' in parsed)
      return or(byTitle, and(eq(projects.key, parsed.key), eq(tasks.number, parsed.number)))!;
    if (/^\d{1,9}$/.test(q.trim())) return or(byTitle, eq(tasks.number, Number(q.trim())))!;
    return byTitle;
  }

  /* ───────────── lists ───────────── */

  async list(q: ListQuery, auth: AuthContext) {
    const today = todayIn(auth.user?.timezone);
    const endOfWeek = addDays(weekStart(today), 6);
    let projectFilter: SQL | undefined;
    if (q.project) {
      const { project } = await this.projectSvc.load(q.project, auth);
      projectFilter = eq(tasks.projectId, project.id);
    }
    const where = and(
      visibleProjects(auth),
      projectFilter,
      this.assigneeFilter(q.assignee, auth),
      q.status === 'open'
        ? inArray(tasks.status, OPEN)
        : q.status === 'closed'
          ? inArray(tasks.status, CLOSED)
          : q.status
            ? eq(tasks.status, q.status)
            : undefined,
      q.due === 'overdue' ? and(lt(tasks.dueDate, today), inArray(tasks.status, OPEN)) : undefined,
      q.due === 'week'
        ? and(gte(tasks.dueDate, today), lte(tasks.dueDate, endOfWeek), inArray(tasks.status, OPEN))
        : undefined,
      q.type ? eq(tasks.type, q.type) : undefined,
      q.priority ? eq(tasks.priority, q.priority) : undefined,
      q.milestone ? eq(tasks.milestoneId, q.milestone) : undefined,
      q.label ? arrayContains(tasks.labels, [q.label]) : undefined,
      q.q ? this.textFilter(q.q) : undefined,
    );
    const key = q.sort?.replace(/^-/, '');
    const columns = key ? SORTABLE[key] : undefined;
    const descending = q.sort?.startsWith('-');
    const order: SQL[] = columns
      ? columns.map((c) => (descending ? sql`${c} desc nulls last` : sql`${c} asc nulls last`))
      : [sql`${tasks.updatedAt} desc`];
    const [rows, [total]] = await Promise.all([
      this.selectItems()
        .where(where)
        .orderBy(...order, asc(tasks.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db
        .select({ n: count() })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .where(where),
    ]);
    return { items: rows.map((r) => this.toItem(r)), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  /** Open tasks assigned to the caller across projects, grouped by due date. */
  async myTasks(auth: AuthContext, opts: { project?: string } = {}) {
    const me = actorOf(auth);
    if (!me) throw forbidden('My tasks are only available to people');
    const today = todayIn(auth.user?.timezone);
    const rows = await this.selectItems()
      .where(
        and(
          visibleProjects(auth),
          eq(tasks.assigneeId, me),
          inArray(tasks.status, OPEN),
          isNull(projects.archivedAt),
          opts.project ? eq(projects.key, opts.project.toUpperCase()) : undefined,
        ),
      )
      .orderBy(sql`${tasks.dueDate} asc nulls last`, PRIORITY_RANK, asc(projects.key), asc(tasks.number))
      .limit(500);
    const groups = { overdue: [], today: [], thisWeek: [], later: [], noDate: [] } as Record<
      ReturnType<typeof dueBucket>,
      ReturnType<TaskService['toItem']>[]
    >;
    for (const r of rows) groups[dueBucket(r.task.dueDate, today)].push(this.toItem(r));
    return { today, total: rows.length, groups };
  }

  /** Comment and link counts and "blocked" flags for cards. */
  private async cardExtras(ids: string[]) {
    const comments = new Map<string, number>();
    const links = new Map<string, number>();
    const blocked = new Set<string>();
    if (!ids.length) return { comments, links, blocked };
    const [c, linkCounts, b] = await Promise.all([
      this.ctx.db
        .select({ id: taskComments.taskId, n: count() })
        .from(taskComments)
        .where(inArray(taskComments.taskId, ids))
        .groupBy(taskComments.taskId),
      this.ctx.records.counts(ids.map((id) => ({ type: TASK_ENTITY, id }))),
      this.ctx.db
        .selectDistinct({ id: taskDependencies.taskId })
        .from(taskDependencies)
        .innerJoin(dep, eq(dep.id, taskDependencies.dependsOnId))
        .where(and(inArray(taskDependencies.taskId, ids), notInArray(dep.status, CLOSED))),
    ]);
    for (const r of c) comments.set(r.id, r.n);
    for (const id of ids) {
      const n = linkCounts.get(`${TASK_ENTITY}:${id}`);
      if (n) links.set(id, n);
    }
    for (const r of b) blocked.add(r.id);
    return { comments, links, blocked };
  }

  private boardFilter(projectId: string, q: BoardQuery | TimelineQuery, auth: AuthContext) {
    return and(
      eq(tasks.projectId, projectId),
      this.assigneeFilter(q.assignee, auth),
      q.milestone ? eq(tasks.milestoneId, q.milestone) : undefined,
      q.label ? arrayContains(tasks.labels, [q.label]) : undefined,
      q.type ? eq(tasks.type, q.type) : undefined,
      q.q ? this.textFilter(q.q) : undefined,
    );
  }

  async board(key: string, q: BoardQuery, auth: AuthContext) {
    const { project } = await this.projectSvc.load(key, auth);
    const statuses: TaskStatus[] = q.cancelled ? [...BOARD_COLUMNS, 'cancelled'] : [...BOARD_COLUMNS];
    const filter = this.boardFilter(project.id, q, auth);
    const [columns, totals] = await Promise.all([
      Promise.all(
        statuses.map((status) =>
          this.selectItems()
            .where(and(filter, eq(tasks.status, status)))
            .orderBy(asc(tasks.rank), asc(tasks.number))
            .limit(BOARD_LIMIT),
        ),
      ),
      this.ctx.db
        .select({ status: tasks.status, n: count() })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(filter, inArray(tasks.status, statuses)))
        .groupBy(tasks.status),
    ]);
    const extras = await this.cardExtras(columns.flat().map((r) => r.task.id));
    const totalOf = new Map(totals.map((t) => [t.status, t.n]));
    return {
      project: { id: project.id, key: project.key, name: project.name },
      limit: BOARD_LIMIT,
      columns: statuses.map((status, i) => ({
        status,
        total: totalOf.get(status) ?? 0,
        tasks: columns[i]!.map((r) => {
          const item = this.toItem(r);
          return {
            id: item.id,
            reference: item.reference,
            number: item.number,
            title: item.title,
            type: item.type,
            status: item.status,
            priority: item.priority,
            assignee: item.assignee,
            startDate: item.startDate,
            dueDate: item.dueDate,
            labels: item.labels,
            milestoneId: r.task.milestoneId,
            parentId: r.task.parentId,
            estimateHours: item.estimateHours,
            remainingHours: item.remainingHours,
            rank: r.task.rank,
            commentCount: extras.comments.get(item.id) ?? 0,
            linkCount: extras.links.get(item.id) ?? 0,
            blocked: extras.blocked.has(item.id),
          };
        }),
      })),
    };
  }

  async timeline(key: string, q: TimelineQuery, auth: AuthContext) {
    const { project, access } = await this.projectSvc.load(key, auth);
    const rows = await this.selectItems()
      .where(
        and(
          this.boardFilter(project.id, q, auth),
          q.closed === false ? inArray(tasks.status, OPEN) : undefined,
        ),
      )
      .orderBy(sql`coalesce(${tasks.startDate}, ${tasks.dueDate}) asc nulls last`, asc(tasks.number))
      .limit(2_000);
    const ids = rows.map((r) => r.task.id);
    const [deps, milestoneRows] = await Promise.all([
      ids.length
        ? this.ctx.db
            .select({ taskId: taskDependencies.taskId, dependsOnId: taskDependencies.dependsOnId })
            .from(taskDependencies)
            .where(and(inArray(taskDependencies.taskId, ids), inArray(taskDependencies.dependsOnId, ids)))
        : Promise.resolve([]),
      this.projectSvc.milestoneList(project.id),
    ]);
    const items = rows.map((r) => {
      const t = r.task;
      const estimate = t.estimateHours ?? 0;
      const progress =
        t.status === 'done'
          ? 1
          : estimate > 0 && t.remainingHours !== null
            ? Math.max(0, Math.min(1, (estimate - t.remainingHours) / estimate))
            : 0;
      return {
        id: t.id,
        reference: formatTaskRef(project.key, t.number),
        title: t.title,
        type: t.type,
        status: t.status,
        priority: t.priority,
        startDate: t.startDate,
        dueDate: t.dueDate,
        milestoneId: t.milestoneId,
        parentId: t.parentId,
        assignee: this.toItem(r).assignee,
        progress: Math.round(progress * 100) / 100,
      };
    });
    return {
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        startDate: project.startDate,
        targetDate: project.targetDate,
      },
      tasks: items.filter((t) => t.startDate || t.dueDate),
      unscheduled: items.filter((t) => !t.startDate && !t.dueDate),
      dependencies: deps,
      milestones: milestoneRows,
      canEdit: access.canEditTasks,
    };
  }

  /* ───────────── detail ───────────── */

  private async refs(ids: readonly (string | null | undefined)[], db: Db = this.ctx.db) {
    const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!wanted.length)
      return new Map<
        string,
        { id: string; reference: string; title: string; status: TaskStatus; type: TaskRow['type'] }
      >();
    const rows = await db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        status: tasks.status,
        type: tasks.type,
        key: projects.key,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(inArray(tasks.id, wanted));
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          reference: formatTaskRef(r.key, r.number),
          title: r.title,
          status: r.status,
          type: r.type,
        },
      ]),
    );
  }

  async detail(ref: string, auth: AuthContext) {
    const { task, project, access } = await this.load(ref, auth);
    const [[row], children, blockedByRows, blockingRows, [comments]] = await Promise.all([
      this.selectItems().where(eq(tasks.id, task.id)),
      this.ctx.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.parentId, task.id))
        .orderBy(asc(tasks.number))
        .limit(200),
      this.ctx.db
        .select({ id: taskDependencies.dependsOnId })
        .from(taskDependencies)
        .where(eq(taskDependencies.taskId, task.id)),
      this.ctx.db
        .select({ id: taskDependencies.taskId })
        .from(taskDependencies)
        .where(eq(taskDependencies.dependsOnId, task.id)),
      this.ctx.db.select({ n: count() }).from(taskComments).where(eq(taskComments.taskId, task.id)),
    ]);
    const [refs, people] = await Promise.all([
      this.refs([
        task.parentId,
        ...children.map((c) => c.id),
        ...blockedByRows.map((r) => r.id),
        ...blockingRows.map((r) => r.id),
      ]),
      peopleByIds(this.ctx.db, [task.reporterId]),
    ]);
    const pick = (ids: { id: string }[]) => ids.map((r) => refs.get(r.id)).filter((x) => x !== undefined);
    return {
      ...this.toItem(row!),
      description: task.description,
      reporter: personRef(task.reporterId ? people.get(task.reporterId) : null),
      parent: task.parentId ? (refs.get(task.parentId) ?? null) : null,
      children: pick(children),
      blockedBy: pick(blockedByRows),
      blocking: pick(blockingRows),
      attributes: task.attributes,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      commentCount: comments?.n ?? 0,
      projectStatus: project.status,
      viewer: {
        canEdit: access.canEditTasks,
        canComment: access.canComment,
        canDelete: access.canManage,
        canManage: access.canManage,
      },
    };
  }

  /* ───────────── validation ───────────── */

  /** Assignees must be active members (or managers) of the project. */
  private async assertAssignee(projectId: string, userId: string) {
    const [m] = await this.ctx.db
      .select({ role: members.role, status: users.status })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.projectId, projectId), eq(members.userId, userId)));
    if (!m || m.status !== 'active' || (m.role as MemberRole) === 'viewer')
      throw invalid('assigneeId', 'Assign the task to an active member of the project');
  }

  private async assertReporter(userId: string) {
    const [u] = await this.ctx.db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!u) throw invalid('reporterId', 'Unknown person');
  }

  private async assertMilestone(projectId: string, id: string) {
    const [m] = await this.ctx.db
      .select({ id: milestones.id })
      .from(milestones)
      .where(and(eq(milestones.id, id), eq(milestones.projectId, projectId)));
    if (!m) throw invalid('milestoneId', 'Pick a milestone of this project');
  }

  /** The parent must be another task of the project, and not one of the task's own descendants. */
  private async assertParent(projectId: string, parentId: string, taskId: string | null) {
    const [p] = await this.ctx.db
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, parentId));
    if (!p || p.projectId !== projectId)
      throw new HttpError(400, ErrorCodes.INVALID_PARENT, 'The parent must be a task of the same project', {
        issues: [{ path: 'parentId', message: 'Pick a task of this project' }],
      });
    if (!taskId) return;
    const loop = await this.ctx.db.execute<{ id: string }>(sql`
      with recursive up(id, parent_id) as (
        select id, parent_id from ${tasks} where id = ${parentId}
        union
        select t.id, t.parent_id from ${tasks} t join up on t.id = up.parent_id
      )
      select id from up where id = ${taskId} limit 1`);
    if (loop.rows.length)
      throw new HttpError(400, ErrorCodes.INVALID_PARENT, 'A task cannot be the parent of its own parent', {
        issues: [{ path: 'parentId', message: 'This would make a loop' }],
      });
  }

  private assertDates(start: string | null | undefined, due: string | null | undefined) {
    if (start && due && due < start) throw invalid('dueDate', 'The due date is before the start date');
  }

  /** Dependencies of the task that are not done yet (they block `in_progress`). */
  private async blockers(taskId: string, db: Db = this.ctx.db) {
    const rows = await db
      .select({ id: dep.id, number: dep.number, title: dep.title, status: dep.status, key: projects.key })
      .from(taskDependencies)
      .innerJoin(dep, eq(dep.id, taskDependencies.dependsOnId))
      .innerJoin(projects, eq(projects.id, dep.projectId))
      .where(eq(taskDependencies.taskId, taskId));
    return blockingDependencies(rows).map((r) => ({
      id: r.id,
      reference: formatTaskRef(r.key, r.number),
      title: r.title,
      status: r.status,
    }));
  }

  private async assertCanMoveTo(task: TaskRow, to: TaskStatus, db: Db = this.ctx.db) {
    if (task.status === to || !needsDependenciesDone(to)) return;
    const blockedBy = await this.blockers(task.id, db);
    if (blockedBy.length)
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        `Blocked by ${blockedBy.map((b) => b.reference).join(', ')}: finish those first`,
        { reason: 'blocked', blockedBy },
      );
  }

  /* ───────────── shared write helpers ───────────── */

  private async record(
    tx: Db,
    taskId: string,
    actorId: string | null,
    entries: ActivityEntry[],
    actorName: string | null = null,
  ) {
    if (!entries.length) return;
    // A sync names its agent and the record it copied ("via Azure DevOps Bug 812").
    const via = viaOf(this.ctx);
    await tx.insert(taskActivity).values(
      entries.map((e) => ({
        taskId,
        kind: e.kind,
        field: e.field ?? null,
        fromValue: e.from ?? null,
        toValue: e.to ?? null,
        actorId,
        actorName: actorName ?? (actorId ? null : writerOf(this.ctx)),
        via,
      })),
    );
  }

  private eventRef(task: TaskRow, project: ProjectRow) {
    return {
      taskId: task.id,
      projectId: project.id,
      reference: formatTaskRef(project.key, task.number),
      title: task.title,
    };
  }

  private async notifyAssigned(tx: Db, task: TaskRow, project: ProjectRow, actorId: string | null) {
    if (!task.assigneeId || task.assigneeId === actorId) return;
    await this.ctx.notifications.notify(
      {
        type: 'projects.task.assigned',
        recipients: [task.assigneeId],
        params: {
          reference: formatTaskRef(project.key, task.number),
          title: task.title,
          project: project.name,
          due: task.dueDate ?? '',
        },
        href: taskHref(formatTaskRef(project.key, task.number)),
      },
      { tx },
    );
  }

  /** Locks the project row: task numbers, ranks and dependencies change one at a time per project. */
  private async lockProject(tx: Db, projectId: string) {
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update');
  }

  /** Re-spaces a column's ranks evenly (when keys grew long or collided). */
  private async rebalance(tx: Db, projectId: string, status: TaskStatus, excludeId: string | null) {
    const rows = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, status),
          excludeId ? ne(tasks.id, excludeId) : undefined,
        ),
      )
      .orderBy(asc(tasks.rank), asc(tasks.number));
    const ranks = rankSequence(rows.length);
    for (const [i, r] of rows.entries())
      await tx.update(tasks).set({ rank: ranks[i]! }).where(eq(tasks.id, r.id));
  }

  /** A rank at the top or bottom of a column. */
  private async edgeRank(
    tx: Db,
    projectId: string,
    status: TaskStatus,
    position: 'top' | 'bottom',
  ): Promise<string> {
    const [row] = await tx
      .select({ lo: min(tasks.rank), hi: max(tasks.rank) })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.status, status)));
    const rank = position === 'top' ? rankBetween(null, row?.lo ?? null) : rankBetween(row?.hi ?? null, null);
    if (rank.length > RANK_MAX_LENGTH) {
      await this.rebalance(tx, projectId, status, null);
      return this.edgeRank(tx, projectId, status, position);
    }
    return rank;
  }

  /* ───────────── create / update / delete ───────────── */

  async create(projectRef: string, input: CreateInput, auth: AuthContext) {
    const { project, access } = await this.projectSvc.load(projectRef, auth);
    if (!access.canEditTasks)
      throw forbidden(project.archivedAt ? 'The project is archived' : 'Only project members can add tasks');
    const actor = actorOf(auth);
    if (input.assigneeId) await this.assertAssignee(project.id, input.assigneeId);
    if (input.reporterId) await this.assertReporter(input.reporterId);
    if (input.milestoneId) await this.assertMilestone(project.id, input.milestoneId);
    if (input.parentId) await this.assertParent(project.id, input.parentId, null);
    this.assertDates(input.startDate, input.dueDate);
    const attributes = await this.ctx.fields.validate(TASK_ENTITY, input.attributes ?? {});
    const status = input.status ?? 'todo';
    return this.ctx.transaction(async (tx) => {
      // Takes the project row lock: concurrent creates get distinct numbers and ranks.
      const [{ number } = { number: 0 }] = await tx
        .update(projects)
        .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
        .where(eq(projects.id, project.id))
        .returning({ number: sql<number>`${projects.nextTaskNumber} - 1`.mapWith(Number) });
      const rank = await this.edgeRank(tx, project.id, status, input.position ?? 'top');
      const [row] = await tx
        .insert(tasks)
        .values({
          projectId: project.id,
          number,
          title: input.title,
          description: input.description?.trim() || null,
          type: input.type ?? 'task',
          status,
          priority: input.priority ?? 'medium',
          assigneeId: input.assigneeId ?? null,
          reporterId: input.reporterId ?? actor,
          milestoneId: input.milestoneId ?? null,
          parentId: input.parentId ?? null,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          estimateHours: input.estimateHours ?? null,
          remainingHours: input.remainingHours ?? null,
          labels: [...new Set(input.labels ?? [])],
          rank,
          completedAt: status === 'done' ? new Date() : null,
          attributes,
        })
        .returning();
      const task = row!;
      await this.record(tx, task.id, actor, [{ kind: 'created', to: status }]);
      await this.ctx.audit.record(
        {
          action: 'projects.task.created',
          entityType: TASK_ENTITY,
          entityId: task.id,
          entityLabel: taskAuditLabel(project.key, task),
          metadata: { projectId: project.id, status, assigneeId: task.assigneeId },
        },
        { tx },
      );
      const ref = this.eventRef(task, project);
      await this.ctx.events.publish('projects.task.created', { ...ref, assigneeId: task.assigneeId }, { tx });
      if (task.assigneeId) {
        await this.ctx.events.publish(
          'projects.task.assigned',
          { ...ref, assigneeId: task.assigneeId, previousId: null },
          { tx },
        );
        await this.notifyAssigned(tx, task, project, actor);
      }
      return { task, project };
    });
  }

  async update(ref: string, input: UpdateInput, auth: AuthContext) {
    const { task: before, project } = await this.editable(ref, auth);
    const actor = actorOf(auth);
    const patch: Partial<typeof tasks.$inferInsert> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.type !== undefined) patch.type = input.type;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.startDate !== undefined) patch.startDate = input.startDate;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.estimateHours !== undefined) patch.estimateHours = input.estimateHours;
    if (input.remainingHours !== undefined) patch.remainingHours = input.remainingHours;
    if (input.labels !== undefined) patch.labels = [...new Set(input.labels)];
    if (input.assigneeId !== undefined && input.assigneeId !== before.assigneeId) {
      if (input.assigneeId) await this.assertAssignee(project.id, input.assigneeId);
      patch.assigneeId = input.assigneeId;
    }
    if (input.reporterId !== undefined && input.reporterId !== before.reporterId) {
      if (input.reporterId) await this.assertReporter(input.reporterId);
      patch.reporterId = input.reporterId;
    }
    if (input.milestoneId !== undefined && input.milestoneId !== before.milestoneId) {
      if (input.milestoneId) await this.assertMilestone(project.id, input.milestoneId);
      patch.milestoneId = input.milestoneId;
    }
    if (input.parentId !== undefined && input.parentId !== before.parentId) {
      if (input.parentId) {
        if (input.parentId === before.id)
          throw new HttpError(400, ErrorCodes.INVALID_PARENT, 'A task cannot be its own parent', {
            issues: [{ path: 'parentId', message: 'Pick another task' }],
          });
        await this.assertParent(project.id, input.parentId, before.id);
      }
      patch.parentId = input.parentId;
    }
    if (input.status !== undefined && input.status !== before.status) {
      await this.assertCanMoveTo(before, input.status);
      patch.status = input.status;
      patch.completedAt = completedAtFor(before.status, input.status, before.completedAt);
    }
    if (input.attributes)
      patch.attributes = await this.ctx.fields.validate(TASK_ENTITY, input.attributes, before.attributes);
    this.assertDates(
      patch.startDate === undefined ? before.startDate : patch.startDate,
      patch.dueDate === undefined ? before.dueDate : patch.dueDate,
    );
    const { completedAt: _completed, ...audited } = patch;
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      audited as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    return this.ctx.transaction(async (tx) => {
      if (patch.status) {
        // Re-check under the project lock so a dependency reopened meanwhile still blocks.
        await this.lockProject(tx, project.id);
        await this.assertCanMoveTo(before, patch.status, tx);
      }
      const [row] = await tx.update(tasks).set(patch).where(eq(tasks.id, before.id)).returning();
      const task = row!;
      const entries: ActivityEntry[] = [];
      for (const [field, [from, to]] of Object.entries(changes)) {
        if (field === 'status') entries.push({ kind: 'status', field, from: str(from), to: str(to) });
        else if (field === 'assigneeId')
          entries.push({ kind: 'assignee', field, from: str(from), to: str(to) });
        else if (VALUE_FIELDS.has(field))
          entries.push({ kind: 'field', field, from: str(from), to: str(to) });
        else entries.push({ kind: 'field', field });
      }
      await this.record(tx, task.id, actor, entries);
      await this.ctx.audit.record(
        {
          action: 'projects.task.updated',
          entityType: TASK_ENTITY,
          entityId: task.id,
          entityLabel: taskAuditLabel(project.key, task),
          changes,
        },
        { tx },
      );
      const evRef = this.eventRef(task, project);
      await this.ctx.events.publish(
        'projects.task.updated',
        { ...evRef, changes: Object.keys(changes) },
        { tx },
      );
      if ('status' in changes)
        await this.ctx.events.publish(
          'projects.task.status_changed',
          { ...evRef, from: before.status, to: task.status },
          { tx },
        );
      if ('assigneeId' in changes) {
        await this.ctx.events.publish(
          'projects.task.assigned',
          { ...evRef, assigneeId: task.assigneeId, previousId: before.assigneeId },
          { tx },
        );
        await this.notifyAssigned(tx, task, project, actor);
      }
      return task;
    });
  }

  /**
   * Board move: a new column and a place between two neighbours (`before`/`after`, references or ids).
   * The project row is locked so concurrent moves see each other's ranks; ranks are rebalanced when they
   * collide or grow long. Without neighbours the task goes to the top of the column.
   */
  async move(ref: string, input: MoveInput, auth: AuthContext) {
    const { task: initial, project } = await this.editable(ref, auth);
    const actor = actorOf(auth);
    const neighbour = async (value: string | null | undefined) => {
      if (!value) return null;
      try {
        const { task } = await this.findRow(value);
        return task.projectId === project.id && task.id !== initial.id ? task.id : null;
      } catch {
        return null;
      }
    };
    const [beforeId, afterId] = await Promise.all([neighbour(input.before), neighbour(input.after)]);
    return this.ctx.transaction(async (tx) => {
      await this.lockProject(tx, project.id);
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, initial.id));
      if (!task) throw notFound('task');
      if (input.status !== task.status) await this.assertCanMoveTo(task, input.status, tx);
      const column = and(
        eq(tasks.projectId, project.id),
        eq(tasks.status, input.status),
        ne(tasks.id, task.id),
      );
      const rankOf = async (id: string | null) => {
        if (!id) return null;
        const [n] = await tx
          .select({ rank: tasks.rank })
          .from(tasks)
          .where(and(column, eq(tasks.id, id)));
        return n?.rank ?? null; // a neighbour that moved to another column meanwhile is ignored
      };
      const bounds = async (): Promise<[string | null, string | null]> => {
        const after = await rankOf(afterId);
        const before = await rankOf(beforeId);
        if (after !== null && before !== null && after < before) return [after, before];
        if (after !== null) {
          const [next] = await tx
            .select({ rank: min(tasks.rank) })
            .from(tasks)
            .where(and(column, sql`${tasks.rank} > ${after}`));
          return [after, next?.rank ?? null];
        }
        if (before !== null) {
          const [prev] = await tx
            .select({ rank: max(tasks.rank) })
            .from(tasks)
            .where(and(column, sql`${tasks.rank} < ${before}`));
          return [prev?.rank ?? null, before];
        }
        const [top] = await tx
          .select({ rank: min(tasks.rank) })
          .from(tasks)
          .where(column);
        return [null, top?.rank ?? null];
      };
      let [lo, hi] = await bounds();
      if (lo !== null && hi !== null && lo >= hi) {
        await this.rebalance(tx, project.id, input.status, task.id);
        [lo, hi] = await bounds();
      }
      let rank = rankBetween(lo, hi);
      if (rank.length > RANK_MAX_LENGTH) {
        await this.rebalance(tx, project.id, input.status, task.id);
        [lo, hi] = await bounds();
        rank = rankBetween(lo, hi);
      }
      const statusChanged = input.status !== task.status;
      const [row] = await tx
        .update(tasks)
        .set({
          rank,
          status: input.status,
          completedAt: statusChanged
            ? completedAtFor(task.status, input.status, task.completedAt)
            : task.completedAt,
        })
        .where(eq(tasks.id, task.id))
        .returning();
      const moved = row!;
      const evRef = this.eventRef(moved, project);
      if (statusChanged) {
        await this.record(tx, moved.id, actor, [
          { kind: 'status', field: 'status', from: task.status, to: moved.status },
        ]);
        await this.ctx.events.publish(
          'projects.task.status_changed',
          { ...evRef, from: task.status, to: moved.status },
          { tx },
        );
      }
      await this.ctx.audit.record(
        {
          action: statusChanged ? 'projects.task.status_changed' : 'projects.task.moved',
          entityType: TASK_ENTITY,
          entityId: moved.id,
          entityLabel: taskAuditLabel(project.key, moved),
          changes: statusChanged ? { status: [task.status, moved.status] } : undefined,
          metadata: { rank },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.task.updated',
        { ...evRef, changes: statusChanged ? ['status', 'rank'] : ['rank'] },
        { tx },
      );
      return moved;
    });
  }

  async remove(ref: string, auth: AuthContext) {
    const { task, project, access } = await this.load(ref, auth);
    if (!access.canManage) throw forbidden('Only the project managers can delete tasks');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(tasks).where(eq(tasks.id, task.id));
      await this.ctx.records.forget({ type: TASK_ENTITY, id: task.id }, { tx });
      await this.ctx.audit.record(
        {
          action: 'projects.task.deleted',
          entityType: TASK_ENTITY,
          entityId: task.id,
          entityLabel: taskAuditLabel(project.key, task),
          metadata: { projectId: project.id, status: task.status },
        },
        { tx },
      );
      await this.ctx.events.publish('projects.task.deleted', this.eventRef(task, project), { tx });
    });
  }

  /* ───────────── dependencies ───────────── */

  private relationshipInvalid(reason: 'self' | 'duplicate' | 'cycle' | 'cross_project') {
    const message = {
      self: 'A task cannot depend on itself',
      duplicate: 'This dependency already exists',
      cycle: 'This would make a dependency loop',
      cross_project: 'Dependencies link tasks of the same project',
    }[reason];
    return new HttpError(409, ErrorCodes.RELATIONSHIP_INVALID, message, { reason });
  }

  async addDependency(ref: string, dependsOnRef: string, auth: AuthContext) {
    const { task, project } = await this.editable(ref, auth);
    const { task: other } = await this.findRow(dependsOnRef).catch(() => {
      throw invalid('dependsOn', 'Unknown task');
    });
    if (other.id === task.id) throw this.relationshipInvalid('self');
    if (other.projectId !== project.id) throw this.relationshipInvalid('cross_project');
    const actor = actorOf(auth);
    await this.ctx.transaction(async (tx) => {
      await this.lockProject(tx, project.id);
      const [existing] = await tx
        .select({ taskId: taskDependencies.taskId })
        .from(taskDependencies)
        .where(and(eq(taskDependencies.taskId, task.id), eq(taskDependencies.dependsOnId, other.id)));
      if (existing) throw this.relationshipInvalid('duplicate');
      // Does `other` already (transitively) depend on `task`? Then the new edge closes a loop.
      const loop = await tx.execute<{ id: string }>(sql`
        with recursive chain(id) as (
          select depends_on_id from ${taskDependencies} where task_id = ${other.id}
          union
          select d.depends_on_id from ${taskDependencies} d join chain c on d.task_id = c.id
        )
        select id from chain where id = ${task.id} limit 1`);
      if (loop.rows.length) throw this.relationshipInvalid('cycle');
      await tx.insert(taskDependencies).values({ taskId: task.id, dependsOnId: other.id, createdBy: actor });
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
      await this.record(tx, task.id, actor, [{ kind: 'dependency', field: 'added', to: other.id }]);
      await this.ctx.audit.record(
        {
          action: 'projects.task.dependency_added',
          entityType: TASK_ENTITY,
          entityId: task.id,
          entityLabel: taskAuditLabel(project.key, task),
          metadata: { dependsOnId: other.id, dependsOn: formatTaskRef(project.key, other.number) },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.task.updated',
        { ...this.eventRef(task, project), changes: ['dependencies'] },
        { tx },
      );
    });
    return this.detail(task.id, auth);
  }

  async removeDependency(ref: string, dependsOnRef: string, auth: AuthContext) {
    const { task, project } = await this.editable(ref, auth);
    const { task: other } = await this.findRow(dependsOnRef);
    const actor = actorOf(auth);
    await this.ctx.transaction(async (tx) => {
      const removed = await tx
        .delete(taskDependencies)
        .where(and(eq(taskDependencies.taskId, task.id), eq(taskDependencies.dependsOnId, other.id)))
        .returning({ id: taskDependencies.taskId });
      if (!removed.length) throw notFound('task');
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
      await this.record(tx, task.id, actor, [{ kind: 'dependency', field: 'removed', from: other.id }]);
      await this.ctx.audit.record(
        {
          action: 'projects.task.dependency_removed',
          entityType: TASK_ENTITY,
          entityId: task.id,
          entityLabel: taskAuditLabel(project.key, task),
          metadata: { dependsOnId: other.id, dependsOn: formatTaskRef(project.key, other.number) },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.task.updated',
        { ...this.eventRef(task, project), changes: ['dependencies'] },
        { tx },
      );
    });
    return this.detail(task.id, auth);
  }

  /* ───────────── comments and activity ───────────── */

  private toComment(
    c: typeof taskComments.$inferSelect,
    people: Map<string, Parameters<typeof personRef>[0] & object>,
    auth: AuthContext,
    access: ProjectAccess,
  ) {
    const mine = Boolean(auth.user && c.authorId === auth.user.id);
    return {
      id: c.id,
      body: c.body,
      author: personRef(c.authorId ? people.get(c.authorId) : null),
      authorName: c.authorName,
      via: c.via ? { connection: c.via.connection, ref: c.via.ref, url: c.via.url } : null,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      canEdit: mine && access.canComment,
      canDelete: (mine && access.canComment) || access.canManage,
    };
  }

  async comments(ref: string, auth: AuthContext) {
    const { task, access } = await this.load(ref, auth);
    const rows = await this.ctx.db
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, task.id))
      .orderBy(asc(taskComments.createdAt))
      .limit(1_000);
    const people = await peopleByIds(
      this.ctx.db,
      rows.map((r) => r.authorId),
    );
    return rows.map((c) => this.toComment(c, people, auth, access));
  }

  /**
   * Adds a comment. `opts.author` is a person of another system (a sync copying their comment): they are
   * named on it, and `opts.at` keeps the time they wrote it.
   */
  async addComment(
    ref: string,
    body: string,
    auth: AuthContext,
    opts: { author?: { name: string; email?: string | null }; at?: Date } = {},
  ) {
    const { task, project, access } = await this.load(ref, auth);
    if (!access.canComment) throw forbidden('Only project members can comment');
    const remote = opts.author;
    const actor = remote ? null : actorOf(auth);
    const now = new Date();
    const comment = await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(taskComments)
        .values({
          taskId: task.id,
          authorId: actor,
          authorName: remote?.name ?? null,
          authorEmail: remote?.email ?? null,
          via: viaOf(this.ctx),
          body,
          ...(opts.at && opts.at < now ? { createdAt: opts.at } : {}),
        })
        .returning();
      const c = row!;
      await tx.update(tasks).set({ updatedAt: now }).where(eq(tasks.id, task.id));
      await this.record(tx, task.id, actor, [{ kind: 'comment', to: c.id }], remote?.name ?? null);
      await this.ctx.audit.record(
        {
          action: 'projects.task.commented',
          entityType: TASK_ENTITY,
          entityId: task.id,
          entityLabel: taskAuditLabel(project.key, task),
          metadata: { commentId: c.id },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.task.commented',
        { ...this.eventRef(task, project), commentId: c.id },
        { tx },
      );
      const recipients = [task.assigneeId, task.reporterId].filter((id) => id && id !== actor);
      if (recipients.length) {
        const [author] = actor
          ? await tx.select({ name: users.displayName }).from(users).where(eq(users.id, actor))
          : [];
        const reference = formatTaskRef(project.key, task.number);
        await this.ctx.notifications.notify(
          {
            type: 'projects.task.commented',
            recipients,
            params: {
              reference,
              title: task.title,
              author: remote?.name ?? author?.name ?? auth.principal.name,
              excerpt: body.length > 200 ? `${body.slice(0, 197)}…` : body,
            },
            href: taskHref(reference),
          },
          { tx },
        );
      }
      return c;
    });
    const people = await peopleByIds(this.ctx.db, [comment.authorId]);
    return this.toComment(comment, people, auth, access);
  }

  private async loadComment(id: string, auth: AuthContext) {
    const [c] = await this.ctx.db.select().from(taskComments).where(eq(taskComments.id, id));
    if (!c) throw notFound('comment');
    const loaded = await this.load(c.taskId, auth);
    return { comment: c, ...loaded };
  }

  async editComment(id: string, body: string, auth: AuthContext) {
    const { comment, task, project, access } = await this.loadComment(id, auth);
    if (!auth.user || comment.authorId !== auth.user.id || !access.canComment)
      throw forbidden('Only the author can edit a comment');
    const [row] = await this.ctx.transaction(async (tx) => {
      const updated = await tx
        .update(taskComments)
        .set({ body, editedAt: new Date() })
        .where(eq(taskComments.id, comment.id))
        .returning();
      await this.ctx.audit.record(
        {
          action: 'projects.comment.updated',
          entityType: TASK_ENTITY,
          entityId: task.id,
          entityLabel: taskAuditLabel(project.key, task),
          metadata: { commentId: comment.id },
        },
        { tx },
      );
      return updated;
    });
    const people = await peopleByIds(this.ctx.db, [row!.authorId]);
    return this.toComment(row!, people, auth, access);
  }

  async deleteComment(id: string, auth: AuthContext) {
    const { comment, task, project, access } = await this.loadComment(id, auth);
    const mine = Boolean(auth.user && comment.authorId === auth.user.id);
    if (!(mine && access.canComment) && !access.canManage)
      throw forbidden('Only the author or a project manager can delete a comment');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(taskComments).where(eq(taskComments.id, comment.id));
      await this.ctx.audit.record(
        {
          action: 'projects.comment.deleted',
          entityType: TASK_ENTITY,
          entityId: task.id,
          entityLabel: taskAuditLabel(project.key, task),
          metadata: { commentId: comment.id, authorId: comment.authorId },
        },
        { tx },
      );
    });
  }

  async activity(ref: string, auth: AuthContext) {
    const { task } = await this.load(ref, auth);
    const rows = await this.ctx.db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.taskId, task.id))
      .orderBy(asc(taskActivity.createdAt))
      .limit(1_000);
    const personIds = rows.flatMap((r) => [
      r.actorId,
      ...(r.kind === 'assignee' || r.field === 'reporterId' ? [r.fromValue, r.toValue] : []),
    ]);
    const taskIds = rows.flatMap((r) =>
      r.kind === 'dependency' || r.field === 'parentId' ? [r.fromValue, r.toValue] : [],
    );
    const milestoneIds = rows
      .filter((r) => r.field === 'milestoneId')
      .flatMap((r) => [r.fromValue, r.toValue])
      .filter((x): x is string => Boolean(x && isUuid(x)));
    const [people, refs, ms] = await Promise.all([
      peopleByIds(
        this.ctx.db,
        personIds.filter((x) => !x || isUuid(x)),
      ),
      this.refs(taskIds.filter((x) => !x || isUuid(x))),
      milestoneIds.length
        ? this.ctx.db
            .select({ id: milestones.id, name: milestones.name })
            .from(milestones)
            .where(inArray(milestones.id, milestoneIds))
        : Promise.resolve([]),
    ]);
    const milestoneName = new Map(ms.map((m) => [m.id, m.name]));
    const label = (r: (typeof rows)[number], value: string | null) => {
      if (!value) return null;
      if (r.kind === 'assignee' || r.field === 'reporterId') return people.get(value)?.displayName ?? null;
      if (r.kind === 'dependency' || r.field === 'parentId') {
        const t = refs.get(value);
        return t ? `${t.reference} ${t.title}` : null;
      }
      if (r.field === 'milestoneId') return milestoneName.get(value) ?? null;
      return null;
    };
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      field: r.field,
      from: r.fromValue,
      to: r.toValue,
      fromLabel: label(r, r.fromValue),
      toLabel: label(r, r.toValue),
      actor: personRef(r.actorId ? people.get(r.actorId) : null),
      actorName: r.actorName,
      via: r.via ? { connection: r.via.connection, ref: r.via.ref, url: r.via.url } : null,
      createdAt: r.createdAt,
    }));
  }

  /* ───────────── jobs ───────────── */

  /**
   * "Due tomorrow" reminders (daily, 08:00 Asia/Taipei): once per task per due date, claimed atomically
   * with `reminded_due_date` so a retried or overlapping run never notifies twice.
   */
  async dueReminders(now: Date = new Date()) {
    const tomorrow = addDays(todayIn('Asia/Taipei', now), 1);
    return this.ctx.transaction(async (tx) => {
      const claimed = await tx
        .update(tasks)
        .set({ remindedDueDate: tomorrow })
        .where(
          and(
            eq(tasks.dueDate, tomorrow),
            inArray(tasks.status, OPEN),
            sql`${tasks.assigneeId} is not null`,
            sql`${tasks.remindedDueDate} is distinct from ${tasks.dueDate}`,
            sql`exists (select 1 from ${projects} p where p.id = ${tasks.projectId} and p.archived_at is null and p.status in ('active', 'on_hold'))`,
          ),
        )
        .returning();
      if (!claimed.length) return 0;
      const keys = await tx
        .select({ id: projects.id, key: projects.key, name: projects.name })
        .from(projects)
        .where(inArray(projects.id, [...new Set(claimed.map((t) => t.projectId))]));
      const byId = new Map(keys.map((k) => [k.id, k]));
      for (const t of claimed) {
        const p = byId.get(t.projectId)!;
        const reference = formatTaskRef(p.key, t.number);
        await this.ctx.notifications.notify(
          {
            type: 'projects.task.due_soon',
            recipients: [t.assigneeId],
            params: { reference, title: t.title, project: p.name, due: t.dueDate ?? '' },
            href: taskHref(reference),
          },
          { tx },
        );
      }
      return claimed.length;
    });
  }

  /* ───────────── search and records ───────────── */

  /** Tasks the caller can see, by reference or title (empty query: my open tasks, then recent ones). */
  async searchTasks(query: string, auth: AuthContext, limit: number) {
    const q = query.trim();
    const me = auth.user?.id;
    const rows = await this.ctx.db
      .select({ task: tasks, key: projects.key, projectName: projects.name, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(visibleProjects(auth), q ? this.textFilter(q) : undefined))
      .orderBy(
        ...(q
          ? []
          : me
            ? [
                sql`case when ${tasks.assigneeId} = ${me} and ${tasks.status} not in ('done', 'cancelled') then 0 else 1 end`,
              ]
            : []),
        desc(tasks.updatedAt),
      )
      .limit(limit);
    return rows;
  }
}

export type TaskItem = ReturnType<TaskService['detail']> extends Promise<infer T> ? T : never;

/** Members of a set of projects with their role (for resolvers that check many records at once). */
export async function rolesIn(db: Db, projectIds: string[], userId: string | null) {
  if (!userId || !projectIds.length) return new Map<string, MemberRole>();
  const rows = await db
    .select({ projectId: members.projectId, role: members.role })
    .from(members)
    .where(and(inArray(members.projectId, projectIds), eq(members.userId, userId)));
  return new Map(rows.map((r) => [r.projectId, r.role]));
}
