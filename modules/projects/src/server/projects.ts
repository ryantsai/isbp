import { departments, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  likePattern,
  type ModuleContext,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import type {
  addMemberSchema,
  createMilestoneSchema,
  createProjectSchema,
  projectHealthChangeSchema,
  projectQuerySchema,
  projectStatusChangeSchema,
  updateMemberSchema,
  updateMilestoneSchema,
  updateProjectSchema,
} from '../contracts';
import {
  CLOSED_TASK_STATUSES,
  completionProblem,
  isUuid,
  type MemberRole,
  PERMISSIONS,
  PROJECT_KEY_RE,
  type ProjectHealth,
  projectTransitions,
  TASK_STATUSES,
  type TaskStatus,
  todayIn,
  weekStart,
} from '../model';
import {
  accessFor,
  isAdmin,
  memberOf,
  myRoleColumn,
  roleWhere,
  transitionsFor,
  visibleProjects,
} from './access';
import {
  members,
  milestones,
  type ProjectRow,
  projects,
  projectUpdates,
  taskActivity,
  taskDependencies,
  tasks,
} from './schema';
import { viaOf, writerOf } from './sync-support';
import {
  actorOf,
  forbidden,
  invalid,
  notFound,
  peopleByIds,
  personRef,
  pgCode,
  PROJECT_ENTITY,
  projectAuditLabel,
  projectHref,
} from './shared';

type CreateInput = z.output<typeof createProjectSchema>;
type UpdateInput = z.output<typeof updateProjectSchema>;
type ListQuery = z.output<typeof projectQuerySchema>;

const OPEN = ['proposed', 'active', 'on_hold'] as const;
const CLOSED = [...CLOSED_TASK_STATUSES];

const STATUS_RANK = sql`case ${projects.status} when 'active' then 0 when 'on_hold' then 1 when 'proposed' then 2 when 'completed' then 3 else 4 end`;
const HEALTH_RANK = sql`case ${projects.health} when 'off_track' then 0 when 'at_risk' then 1 else 2 end`;
const PRIORITY_RANK = sql`case ${projects.priority} when 'high' then 0 when 'medium' then 1 else 2 end`;

const SORTABLE: Record<string, SQL> = {
  key: sql`${projects.key}`,
  name: sql`${projects.name}`,
  status: STATUS_RANK,
  health: HEALTH_RANK,
  priority: PRIORITY_RANK,
  targetDate: sql`${projects.targetDate}`,
  updatedAt: sql`${projects.updatedAt}`,
};

type Stats = {
  counts: Record<TaskStatus, number>;
  overdue: number;
  members: number;
  next: { id: string; name: string; dueDate: string | null } | null;
};

const emptyCounts = () => Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;

export interface LoadedProject {
  project: ProjectRow;
  access: ReturnType<typeof accessFor>;
}

/** Projects, members, milestones, health, status and the proposal approval — for any principal. */
export class ProjectService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── lookups and access ───────────── */

  /** A project by key (`NET`, any case) or id; 404 otherwise. */
  async find(ref: string, db: Db = this.ctx.db): Promise<ProjectRow> {
    const v = ref.trim();
    const where = isUuid(v)
      ? eq(projects.id, v)
      : PROJECT_KEY_RE.test(v.toUpperCase())
        ? eq(projects.key, v.toUpperCase())
        : null;
    if (!where) throw notFound('project');
    const [row] = await db.select().from(projects).where(where);
    if (!row) throw notFound('project');
    return row;
  }

  async roleOf(projectId: string, auth: AuthContext, db: Db = this.ctx.db): Promise<MemberRole | null> {
    const me = actorOf(auth);
    if (!me) return null;
    const [row] = await db.select({ role: members.role }).from(members).where(roleWhere(projectId, me));
    return row?.role ?? null;
  }

  async hasTasks(projectId: string, db: Db = this.ctx.db): Promise<boolean> {
    const [row] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .limit(1);
    return Boolean(row);
  }

  /** The project and what the caller may do in it; 404 when the caller can't see it. */
  async load(ref: string, auth: AuthContext, db: Db = this.ctx.db): Promise<LoadedProject> {
    const project = await this.find(ref, db);
    const role = await this.roleOf(project.id, auth, db);
    const access = accessFor(project, role, auth);
    if (!access.canView) throw notFound('project');
    return { project, access };
  }

  /** Like `load`, but the caller must manage the project (403 otherwise). */
  async manageable(ref: string, auth: AuthContext): Promise<LoadedProject> {
    const loaded = await this.load(ref, auth);
    if (!loaded.access.canManage) throw forbidden('Only the project managers can do this');
    return loaded;
  }

  async settings() {
    const [hoursPerWeek, threshold] = await Promise.all([
      this.ctx.settings.get<number>('hoursPerWeek'),
      this.ctx.settings.get<number>('proposalThresholdHours'),
    ]);
    return {
      hoursPerWeek: Number(hoursPerWeek) > 0 ? Number(hoursPerWeek) : 40,
      proposalThresholdHours: Number(threshold) >= 0 ? Number(threshold) : 400,
    };
  }

  /* ───────────── reading ───────────── */

  private selectSummaries(auth: AuthContext) {
    return this.ctx.db
      .select({
        project: projects,
        ownerName: users.displayName,
        ownerAvatar: users.avatarUrl,
        departmentName: departments.name,
        myRole: myRoleColumn(auth),
      })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.ownerId))
      .leftJoin(departments, eq(departments.id, projects.departmentId));
  }

  /** Task counts by status, overdue tasks, member counts and the next open milestone, per project. */
  private async stats(ids: string[], today: string): Promise<Map<string, Stats>> {
    const out = new Map<string, Stats>(
      ids.map((id) => [id, { counts: emptyCounts(), overdue: 0, members: 0, next: null }]),
    );
    if (!ids.length) return out;
    const [counts, memberCounts, next] = await Promise.all([
      this.ctx.db
        .select({
          projectId: tasks.projectId,
          status: tasks.status,
          n: count(),
          overdue:
            sql<number>`count(*) filter (where ${tasks.dueDate} < ${today}::date and ${tasks.status} not in ('done', 'cancelled'))`.mapWith(
              Number,
            ),
        })
        .from(tasks)
        .where(inArray(tasks.projectId, ids))
        .groupBy(tasks.projectId, tasks.status),
      this.ctx.db
        .select({ projectId: members.projectId, n: count() })
        .from(members)
        .where(inArray(members.projectId, ids))
        .groupBy(members.projectId),
      this.ctx.db
        .selectDistinctOn([milestones.projectId], {
          projectId: milestones.projectId,
          id: milestones.id,
          name: milestones.name,
          dueDate: milestones.dueDate,
        })
        .from(milestones)
        .where(and(inArray(milestones.projectId, ids), eq(milestones.status, 'open')))
        .orderBy(milestones.projectId, sql`${milestones.dueDate} asc nulls last`, asc(milestones.sort)),
    ]);
    for (const c of counts) {
      const s = out.get(c.projectId)!;
      s.counts[c.status] = c.n;
      s.overdue += c.overdue;
    }
    for (const m of memberCounts) out.get(m.projectId)!.members = m.n;
    for (const m of next) out.get(m.projectId)!.next = { id: m.id, name: m.name, dueDate: m.dueDate };
    return out;
  }

  private toSummary(
    r: {
      project: ProjectRow;
      ownerName: string | null;
      ownerAvatar: string | null;
      departmentName: string | null;
      myRole: MemberRole | null;
    },
    s: Stats,
  ) {
    const p = r.project;
    const total = TASK_STATUSES.filter((x) => x !== 'cancelled').reduce((n, x) => n + s.counts[x], 0);
    const done = s.counts.done;
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      status: p.status,
      health: p.health,
      healthNote: p.healthNote,
      priority: p.priority,
      visibility: p.visibility,
      owner: p.ownerId
        ? { id: p.ownerId, displayName: r.ownerName ?? '—', avatarUrl: r.ownerAvatar ?? null }
        : null,
      department: p.departmentId ? { id: p.departmentId, name: r.departmentName ?? '—' } : null,
      startDate: p.startDate,
      targetDate: p.targetDate,
      completedAt: p.completedAt,
      budgetHours: p.budgetHours,
      archivedAt: p.archivedAt,
      approvalStatus: p.approvalStatus,
      taskCounts: s.counts,
      totalTasks: total,
      doneTasks: done,
      progress: total ? Math.round((done / total) * 100) : 0,
      overdueCount: s.overdue,
      nextMilestone: s.next,
      memberCount: s.members,
      myRole: r.myRole,
      updatedAt: p.updatedAt,
    };
  }

  async list(q: ListQuery, auth: AuthContext) {
    const me = actorOf(auth);
    const today = todayIn(auth.user?.timezone);
    const where = and(
      visibleProjects(auth),
      q.archived ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt),
      q.status === 'open'
        ? inArray(projects.status, [...OPEN])
        : q.status
          ? eq(projects.status, q.status)
          : undefined,
      q.health ? eq(projects.health, q.health) : undefined,
      q.mine ? (me ? memberOf(me) : sql`false`) : undefined,
      q.owner ? eq(projects.ownerId, q.owner) : undefined,
      q.department ? eq(projects.departmentId, q.department) : undefined,
      q.q ? or(ilike(projects.name, likePattern(q.q)), ilike(projects.key, likePattern(q.q))) : undefined,
    );
    const key = q.sort?.replace(/^-/, '');
    const column = key ? SORTABLE[key] : undefined;
    const order: SQL[] = column
      ? [q.sort!.startsWith('-') ? desc(column) : asc(column)]
      : [asc(STATUS_RANK), sql`${projects.targetDate} asc nulls last`];
    const [rows, [total]] = await Promise.all([
      this.selectSummaries(auth)
        .where(where)
        .orderBy(...order, asc(projects.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(projects).where(where),
    ]);
    const stats = await this.stats(
      rows.map((r) => r.project.id),
      today,
    );
    return {
      items: rows.map((r) => this.toSummary(r, stats.get(r.project.id)!)),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Milestones with how many of their tasks are done. */
  async milestoneList(projectId: string) {
    const rows = await this.ctx.db
      .select({
        milestone: milestones,
        taskCount: sql<number>`count(${tasks.id}) filter (where ${tasks.status} <> 'cancelled')`.mapWith(
          Number,
        ),
        doneCount: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')`.mapWith(Number),
      })
      .from(milestones)
      .leftJoin(tasks, eq(tasks.milestoneId, milestones.id))
      .where(eq(milestones.projectId, projectId))
      .groupBy(milestones.id)
      .orderBy(asc(milestones.sort), sql`${milestones.dueDate} asc nulls last`, asc(milestones.createdAt));
    return rows.map((r) => ({
      id: r.milestone.id,
      name: r.milestone.name,
      description: r.milestone.description,
      dueDate: r.milestone.dueDate,
      status: r.milestone.status,
      completedAt: r.milestone.completedAt,
      sort: r.milestone.sort,
      taskCount: r.taskCount,
      doneCount: r.doneCount,
    }));
  }

  async memberList(project: ProjectRow) {
    const rows = await this.ctx.db
      .select({
        member: members,
        displayName: users.displayName,
        email: users.email,
        jobTitle: users.jobTitle,
        avatarUrl: users.avatarUrl,
        status: users.status,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.projectId, project.id))
      .orderBy(
        sql`case ${members.role} when 'manager' then 0 when 'member' then 1 else 2 end`,
        asc(users.displayName),
      );
    return rows.map((r) => ({
      userId: r.member.userId,
      displayName: r.displayName,
      email: r.email,
      jobTitle: r.jobTitle,
      avatarUrl: r.avatarUrl,
      role: r.member.role,
      allocationPct: r.member.allocationPct,
      active: r.status === 'active',
      isOwner: r.member.userId === project.ownerId,
      via: r.member.via
        ? { connection: r.member.via.connection, ref: r.member.via.ref, url: r.member.via.url }
        : null,
    }));
  }

  async detail(ref: string, auth: AuthContext) {
    const { project: found } = await this.load(ref, auth);
    const today = todayIn(auth.user?.timezone);
    const monday = weekStart(today);
    const [[row], stats, memberRows, milestoneRows, [kpi], [blocked], updates, labels, settings, hasTasks] =
      await Promise.all([
        this.selectSummaries(auth).where(eq(projects.id, found.id)),
        this.stats([found.id], today),
        this.memberList(found),
        this.milestoneList(found.id),
        this.ctx.db
          .select({
            doneThisWeek:
              sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= ${monday}::date)`.mapWith(
                Number,
              ),
          })
          .from(tasks)
          .where(eq(tasks.projectId, found.id)),
        this.ctx.db
          .execute<{ n: number }>(
            sql`
          select count(distinct t.id)::int as n
            from ${tasks} t
            join ${taskDependencies} d on d.task_id = t.id
            join ${tasks} dep on dep.id = d.depends_on_id
           where t.project_id = ${found.id}
             and t.status not in ('done', 'cancelled')
             and dep.status not in ('done', 'cancelled')`,
          )
          .then((r) => r.rows),
        this.ctx.db
          .select()
          .from(projectUpdates)
          .where(eq(projectUpdates.projectId, found.id))
          .orderBy(desc(projectUpdates.createdAt))
          .limit(20),
        this.ctx.db
          .execute<{ label: string }>(
            sql`select distinct unnest(${tasks.labels}) as label from ${tasks} where ${tasks.projectId} = ${found.id} order by 1 limit 200`,
          )
          .then((r) => r.rows.map((x) => x.label)),
        this.settings(),
        this.hasTasks(found.id),
      ]);
    // Everything below comes from this one read of the project row: the status and the approval change
    // together when a proposal is approved, so mixing two reads could show "active" with a pending approval.
    if (!row) throw notFound('project');
    const project = row.project;
    const access = accessFor(project, row.myRole, auth, { hasTasks });
    const people = await peopleByIds(
      this.ctx.db,
      updates.map((u) => u.authorId),
    );
    const s = stats.get(found.id)!;
    const summary = this.toSummary(row, s);
    const open = TASK_STATUSES.filter((x) => !CLOSED.includes(x)).reduce((n, x) => n + s.counts[x], 0);
    return {
      ...summary,
      description: project.description,
      healthUpdatedAt: project.healthUpdatedAt,
      attributes: project.attributes,
      createdAt: project.createdAt,
      members: memberRows.map((m) => ({ ...m, isOwner: m.userId === project.ownerId })),
      milestones: milestoneRows,
      kpis: {
        overdue: s.overdue,
        doneThisWeek: kpi?.doneThisWeek ?? 0,
        blocked: Number(blocked?.n ?? 0),
        open,
      },
      approval: project.approvalStatus
        ? {
            instanceId: project.approvalInstanceId,
            status: project.approvalStatus,
            comment: project.approvalComment,
            decidedAt: project.approvalDecidedAt,
          }
        : null,
      updates: updates.map((u) => ({
        id: u.id,
        kind: u.kind,
        from: u.fromValue,
        to: u.toValue,
        note: u.note,
        author: personRef(u.authorId ? people.get(u.authorId) : null),
        authorName: u.authorName,
        via: u.via ? { connection: u.via.connection, ref: u.via.ref, url: u.via.url } : null,
        createdAt: u.createdAt,
      })),
      labels,
      viewer: {
        role: access.role,
        canManage: access.canManage,
        canEditTasks: access.canEditTasks,
        canComment: access.canComment,
        canDelete: access.canDelete,
        transitions: transitionsFor(project.status, access),
        canStart:
          access.canManage &&
          !project.archivedAt &&
          project.status === 'proposed' &&
          project.approvalStatus !== 'pending',
      },
      settings,
    };
  }

  /* ───────────── writing: projects ───────────── */

  private async assertPerson(userId: string, path: string) {
    const [u] = await this.ctx.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    if (!u || u.status !== 'active') throw invalid(path, 'Unknown or inactive person');
  }

  private async assertDepartment(id: string) {
    const [d] = await this.ctx.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.id, id));
    if (!d) throw invalid('departmentId', 'Unknown department');
  }

  private assertDates(start: string | null | undefined, target: string | null | undefined) {
    if (start && target && target < start)
      throw invalid('targetDate', 'The target date is before the start date');
  }

  private keyTaken(key: string) {
    return new HttpError(409, ErrorCodes.CONFLICT, `The key ${key} is already used by another project`, {
      field: 'key',
      issues: [{ path: 'key', message: 'Already used by another project' }],
    });
  }

  async create(input: CreateInput, auth: AuthContext) {
    if (!auth.can(PERMISSIONS.create) && !isAdmin(auth))
      throw forbidden('Creating projects needs projects.projects.create');
    const actor = actorOf(auth);
    const ownerId = input.ownerId ?? actor;
    // A project a sync brings in from another system (e.g. an Azure DevOps team project) may have no
    // manager yet; everyone else names one.
    if (!ownerId && !viaOf(this.ctx)) throw invalid('ownerId', 'Choose the project manager');
    if (ownerId) await this.assertPerson(ownerId, 'ownerId');
    if (input.departmentId) await this.assertDepartment(input.departmentId);
    this.assertDates(input.startDate, input.targetDate);
    const [taken] = await this.ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, input.key));
    if (taken) throw this.keyTaken(input.key);
    const attributes = await this.ctx.fields.validate(PROJECT_ENTITY, input.attributes ?? {});
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(projects)
          .values({
            key: input.key,
            name: input.name,
            description: input.description?.trim() || null,
            status: 'proposed',
            priority: input.priority ?? 'medium',
            visibility: input.visibility ?? 'internal',
            ownerId,
            departmentId: input.departmentId ?? null,
            startDate: input.startDate ?? null,
            targetDate: input.targetDate ?? null,
            budgetHours: input.budgetHours ?? null,
            attributes,
            createdBy: actor,
          })
          .returning();
        const project = row!;
        const managers = [...new Set([ownerId, actor].filter((x): x is string => Boolean(x)))];
        if (managers.length)
          await tx
            .insert(members)
            .values(managers.map((userId) => ({ projectId: project.id, userId, role: 'manager' as const })));
        await this.ctx.audit.record(
          {
            action: 'projects.project.created',
            entityType: PROJECT_ENTITY,
            entityId: project.id,
            entityLabel: projectAuditLabel(project),
            metadata: { visibility: project.visibility, budgetHours: project.budgetHours, ownerId },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'projects.project.created',
          { projectId: project.id, key: project.key, name: project.name, ownerId },
          { tx },
        );
        if (ownerId && ownerId !== actor)
          await this.ctx.notifications.notify(
            {
              type: 'projects.member.added',
              recipients: [ownerId],
              params: { key: project.key, name: project.name, role: 'manager' },
              href: projectHref(project.key),
            },
            { tx },
          );
        return project;
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw this.keyTaken(input.key);
      throw err;
    }
  }

  async update(ref: string, input: UpdateInput, auth: AuthContext) {
    const { project: before } = await this.manageable(ref, auth);
    const actor = actorOf(auth);
    const patch: Partial<typeof projects.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.visibility !== undefined) patch.visibility = input.visibility;
    if (input.startDate !== undefined) patch.startDate = input.startDate;
    if (input.targetDate !== undefined) patch.targetDate = input.targetDate;
    if (input.budgetHours !== undefined) patch.budgetHours = input.budgetHours;
    if (input.departmentId !== undefined) {
      if (input.departmentId) await this.assertDepartment(input.departmentId);
      patch.departmentId = input.departmentId;
    }
    if (input.ownerId !== undefined && input.ownerId !== before.ownerId) {
      if (!input.ownerId) throw invalid('ownerId', 'A project needs a project manager');
      await this.assertPerson(input.ownerId, 'ownerId');
      patch.ownerId = input.ownerId;
    }
    if (input.key !== undefined && input.key !== before.key) {
      if (await this.hasTasks(before.id))
        throw new HttpError(
          409,
          ErrorCodes.INVALID_STATE,
          "The key can't change once the project has tasks",
          {
            field: 'key',
          },
        );
      const [taken] = await this.ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.key, input.key));
      if (taken) throw this.keyTaken(input.key);
      patch.key = input.key;
    }
    if (input.archived !== undefined && input.archived !== Boolean(before.archivedAt))
      patch.archivedAt = input.archived ? new Date() : null;
    if (input.attributes)
      patch.attributes = await this.ctx.fields.validate(PROJECT_ENTITY, input.attributes, before.attributes);
    this.assertDates(
      patch.startDate === undefined ? before.startDate : patch.startDate,
      patch.targetDate === undefined ? before.targetDate : patch.targetDate,
    );
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    const archiving = 'archivedAt' in changes;
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx.update(projects).set(patch).where(eq(projects.id, before.id)).returning();
        const project = row!;
        if (patch.ownerId) {
          await tx
            .insert(members)
            .values({ projectId: project.id, userId: patch.ownerId, role: 'manager' })
            .onConflictDoUpdate({
              target: [members.projectId, members.userId],
              set: { role: 'manager', updatedAt: new Date() },
            });
          if (patch.ownerId !== actor)
            await this.ctx.notifications.notify(
              {
                type: 'projects.member.added',
                recipients: [patch.ownerId],
                params: { key: project.key, name: project.name, role: 'manager' },
                href: projectHref(project.key),
              },
              { tx },
            );
        }
        const action = archiving
          ? patch.archivedAt
            ? 'projects.project.archived'
            : 'projects.project.unarchived'
          : 'projects.project.updated';
        await this.ctx.audit.record(
          {
            action,
            entityType: PROJECT_ENTITY,
            entityId: project.id,
            entityLabel: projectAuditLabel(project),
            changes,
          },
          { tx },
        );
        await this.ctx.events.publish(
          'projects.project.updated',
          { projectId: project.id, key: project.key, name: project.name, changes: Object.keys(changes) },
          { tx },
        );
        return project;
      });
    } catch (err) {
      if (pgCode(err) === '23505' && patch.key) throw this.keyTaken(patch.key);
      throw err;
    }
  }

  /* ───────────── proposal approval ───────────── */

  /** "Start project": submits the proposal to the `projects.proposal` workflow. */
  async start(ref: string, auth: AuthContext) {
    const { project } = await this.manageable(ref, auth);
    if (project.archivedAt)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Archived projects cannot start');
    if (project.status !== 'proposed')
      throw new HttpError(409, ErrorCodes.INVALID_TRANSITION, 'Only proposed projects can be started', {
        from: project.status,
        allowed: projectTransitions(project.status),
      });
    if (project.approvalStatus === 'pending')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The proposal is already waiting for approval', {
        instanceId: project.approvalInstanceId,
      });
    return this.submit(project.id, actorOf(auth));
  }

  /**
   * Submits a proposed project to the `projects.proposal` workflow as `actorId` (the owner's manager
   * decides on large ones). Also used by the seed, so the demo has a real pending approval.
   */
  async submit(projectId: string, actorId: string | null) {
    const actor = actorId;
    const [{ n: memberCount } = { n: 0 }] = await this.ctx.db
      .select({ n: count() })
      .from(members)
      .where(eq(members.projectId, projectId));
    return this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
      if (!locked || locked.status !== 'proposed' || locked.approvalStatus === 'pending')
        throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The proposal was submitted meanwhile');
      const started = await this.ctx.workflows.start(
        'projects.proposal',
        {
          subject: {
            type: 'project',
            id: locked.id,
            label: `${locked.key} · ${locked.name}`,
            href: projectHref(locked.key),
          },
          facts: {
            ...(await this.ctx.fields.facts('projects.project', locked.attributes)),
            project: {
              budgetHours: locked.budgetHours ?? 0,
              priority: locked.priority,
              departmentId: locked.departmentId,
              memberCount,
            },
          },
          requesterId: actor,
          subjectUserId: locked.ownerId ?? actor,
        },
        { tx },
      );
      const instanceId = started?.instanceId ?? null;
      await tx
        .update(projects)
        .set({
          approvalInstanceId: instanceId,
          approvalStatus: 'pending',
          approvalComment: null,
          approvalDecidedAt: null,
        })
        .where(eq(projects.id, locked.id));
      await this.ctx.audit.record(
        {
          action: 'projects.project.submitted',
          entityType: PROJECT_ENTITY,
          entityId: locked.id,
          entityLabel: projectAuditLabel(locked),
          metadata: { instanceId, budgetHours: locked.budgetHours },
        },
        { tx },
      );
      // No approval step applied (within the threshold, or nobody to ask): decide now.
      if (!started || started.status === 'approved')
        await this.decide(tx, locked.id, instanceId, 'approved', null, { actorId: actor });
      else if (started.status === 'rejected')
        await this.decide(tx, locked.id, instanceId, 'rejected', null, { actorId: actor });
      const [row] = await tx.select().from(projects).where(eq(projects.id, locked.id));
      return row!;
    });
  }

  /** Applies a proposal decision once (row lock + instance check make redelivery harmless). */
  private async decide(
    tx: Db,
    projectId: string,
    instanceId: string | null,
    outcome: 'approved' | 'rejected' | 'cancelled',
    comment: string | null,
    opts: { actorId?: string | null } = {},
  ) {
    const [p] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
    if (
      !p ||
      p.status !== 'proposed' ||
      p.approvalStatus !== 'pending' ||
      p.approvalInstanceId !== instanceId
    )
      return false;
    const now = new Date();
    if (outcome === 'approved') {
      await tx
        .update(projects)
        .set({
          status: 'active',
          approvalStatus: 'approved',
          approvalDecidedAt: now,
          approvalComment: comment,
        })
        .where(eq(projects.id, p.id));
      await tx.insert(projectUpdates).values({
        projectId: p.id,
        kind: 'status',
        fromValue: 'proposed',
        toValue: 'active',
        note: comment,
        authorId: null,
      });
      await this.ctx.audit.record(
        {
          action: 'projects.project.status_changed',
          entityType: PROJECT_ENTITY,
          entityId: p.id,
          entityLabel: projectAuditLabel(p),
          changes: { status: ['proposed', 'active'] },
          metadata: { reason: 'proposal_approved', instanceId },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.project.status_changed',
        { projectId: p.id, key: p.key, name: p.name, from: 'proposed', to: 'active' },
        { tx },
      );
    } else {
      await tx
        .update(projects)
        .set({ approvalStatus: outcome, approvalDecidedAt: now, approvalComment: comment })
        .where(eq(projects.id, p.id));
      await this.ctx.audit.record(
        {
          action:
            outcome === 'rejected'
              ? 'projects.project.proposal_rejected'
              : 'projects.project.proposal_cancelled',
          entityType: PROJECT_ENTITY,
          entityId: p.id,
          entityLabel: projectAuditLabel(p),
          metadata: { instanceId, comment },
        },
        { tx },
      );
    }
    if (outcome !== 'cancelled' && p.ownerId && p.ownerId !== opts.actorId)
      await this.ctx.notifications.notify(
        {
          type: 'projects.proposal.decided',
          recipients: [p.ownerId],
          params: { key: p.key, name: p.name, outcome, comment: comment ?? '' },
          href: projectHref(p.key),
        },
        { tx },
      );
    return true;
  }

  /** The proposal workflow finished (outbox, at-least-once). */
  async onProposalCompleted(result: WorkflowCompletion) {
    if (result.subjectType !== 'project') return;
    await this.ctx.transaction((tx) =>
      this.decide(tx, result.subjectId, result.instanceId, result.outcome, result.comment),
    );
  }

  /* ───────────── status and health ───────────── */

  async changeStatus(ref: string, input: z.output<typeof projectStatusChangeSchema>, auth: AuthContext) {
    const { project } = await this.manageable(ref, auth);
    const allowed = projectTransitions(project.status);
    if (!allowed.includes(input.status))
      throw new HttpError(
        409,
        ErrorCodes.INVALID_TRANSITION,
        input.status === 'active' && project.status === 'proposed'
          ? 'Start the project to submit its proposal for approval'
          : `A ${project.status} project can't move to ${input.status}`,
        { from: project.status, allowed },
      );
    const comment = input.comment?.trim() || null;
    if (input.status === 'completed') {
      const [{ n: openTasks } = { n: 0 }] = await this.ctx.db
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.projectId, project.id), notInArray(tasks.status, CLOSED)));
      const problem = completionProblem({ openTasks, force: input.force, comment });
      if (problem === 'open_tasks')
        throw new HttpError(409, ErrorCodes.INVALID_STATE, `${openTasks} task(s) are still open`, {
          reason: 'open_tasks',
          openTasks,
        });
      if (problem === 'comment_required')
        throw new HttpError(
          400,
          ErrorCodes.COMMENT_REQUIRED,
          'Say why the project completes with open tasks',
          {
            openTasks,
          },
        );
    }
    const actor = actorOf(auth);
    return this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(projects).where(eq(projects.id, project.id)).for('update');
      if (!locked || locked.status !== project.status)
        throw new HttpError(
          409,
          ErrorCodes.INVALID_STATE,
          'The project changed meanwhile; reload and try again',
        );
      if (input.status === 'cancelled' && locked.approvalStatus === 'pending' && locked.approvalInstanceId)
        await this.ctx.workflows.cancel(locked.approvalInstanceId, 'The project was cancelled', { tx });
      const [row] = await tx
        .update(projects)
        .set({
          status: input.status,
          completedAt: input.status === 'completed' ? new Date() : locked.completedAt,
          ...(input.status === 'cancelled' && locked.approvalStatus === 'pending'
            ? { approvalStatus: 'cancelled' as const, approvalDecidedAt: new Date() }
            : {}),
        })
        .where(eq(projects.id, locked.id))
        .returning();
      await tx.insert(projectUpdates).values({
        projectId: locked.id,
        kind: 'status',
        fromValue: locked.status,
        toValue: input.status,
        note: comment,
        authorId: actor,
        authorName: actor ? null : writerOf(this.ctx),
        via: viaOf(this.ctx),
      });
      await this.ctx.audit.record(
        {
          action: 'projects.project.status_changed',
          entityType: PROJECT_ENTITY,
          entityId: locked.id,
          entityLabel: projectAuditLabel(locked),
          changes: { status: [locked.status, input.status] },
          metadata: { comment, force: Boolean(input.force) },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.project.status_changed',
        { projectId: locked.id, key: locked.key, name: locked.name, from: locked.status, to: input.status },
        { tx },
      );
      return row!;
    });
  }

  async setHealth(ref: string, input: z.output<typeof projectHealthChangeSchema>, auth: AuthContext) {
    const { project } = await this.manageable(ref, auth);
    return this.ctx.transaction((tx) =>
      this.applyHealth(tx, project, input.health, input.note, actorOf(auth)),
    );
  }

  /**
   * Sets the health and its note in `tx`: history, audit, `projects.project.health_changed` and, when it turns at risk
   * or off track, a notice to the other members. Used by "Update health" and by a manager's status update.
   */
  async applyHealth(tx: Db, project: ProjectRow, health: ProjectHealth, note: string, actor: string | null) {
    const from: ProjectHealth = project.health;
    const changed = from !== health;
    const [row] = await tx
      .update(projects)
      .set({ health, healthNote: note, healthUpdatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .returning();
    await tx.insert(projectUpdates).values({
      projectId: project.id,
      kind: 'health',
      fromValue: from,
      toValue: health,
      note,
      authorId: actor,
    });
    await this.ctx.audit.record(
      {
        action: 'projects.project.health_changed',
        entityType: PROJECT_ENTITY,
        entityId: project.id,
        entityLabel: projectAuditLabel(project),
        changes: changed
          ? { health: [from, health], healthNote: [project.healthNote, note] }
          : { healthNote: [project.healthNote, note] },
      },
      { tx },
    );
    if (changed) {
      await this.ctx.events.publish(
        'projects.project.health_changed',
        { projectId: project.id, key: project.key, name: project.name, from, to: health, note },
        { tx },
      );
      if (health !== 'on_track') {
        const recipients = await tx
          .select({ userId: members.userId })
          .from(members)
          .where(and(eq(members.projectId, project.id), actor ? ne(members.userId, actor) : undefined));
        await this.ctx.notifications.notify(
          {
            type: 'projects.project.health_changed',
            recipients: recipients.map((r) => r.userId),
            params: { key: project.key, name: project.name, health, note },
            href: projectHref(project.key),
          },
          { tx },
        );
      }
    }
    return row!;
  }

  /** Admins delete any project; managers only empty ones (archive the rest). */
  async remove(ref: string, auth: AuthContext) {
    const { project, access } = await this.load(ref, auth);
    if (!access.canManage) throw forbidden('Only the project managers can do this');
    const admin = isAdmin(auth);
    if (!admin && (await this.hasTasks(project.id)))
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        'Only empty projects can be deleted; archive it instead',
        {
          reason: 'has_tasks',
        },
      );
    await this.ctx.transaction(async (tx) => {
      if (project.approvalStatus === 'pending' && project.approvalInstanceId)
        await this.ctx.workflows.cancel(project.approvalInstanceId, 'The project was deleted', { tx });
      const taskIds = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, project.id));
      await tx.delete(projects).where(eq(projects.id, project.id));
      for (const t of taskIds) await this.ctx.records.forget({ type: 'projects.task', id: t.id }, { tx });
      await this.ctx.records.forget({ type: PROJECT_ENTITY, id: project.id }, { tx });
      await this.ctx.audit.record(
        {
          action: 'projects.project.deleted',
          entityType: PROJECT_ENTITY,
          entityId: project.id,
          entityLabel: projectAuditLabel(project),
          metadata: { tasks: taskIds.length },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.project.deleted',
        { projectId: project.id, key: project.key, name: project.name },
        { tx },
      );
    });
  }

  /* ───────────── members ───────────── */

  async members(ref: string, auth: AuthContext) {
    const { project } = await this.load(ref, auth);
    return this.memberList(project);
  }

  private async touchProject(tx: Db, project: ProjectRow, changes: string[]) {
    await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, project.id));
    await this.ctx.events.publish(
      'projects.project.updated',
      { projectId: project.id, key: project.key, name: project.name, changes },
      { tx },
    );
  }

  async addMember(ref: string, input: z.output<typeof addMemberSchema>, auth: AuthContext) {
    const { project } = await this.manageable(ref, auth);
    await this.assertPerson(input.userId, 'userId');
    const actor = actorOf(auth);
    try {
      await this.ctx.transaction(async (tx) => {
        await tx.insert(members).values({
          projectId: project.id,
          userId: input.userId,
          role: input.role,
          allocationPct: input.allocationPct,
          via: viaOf(this.ctx),
        });
        await this.ctx.audit.record(
          {
            action: 'projects.member.added',
            entityType: PROJECT_ENTITY,
            entityId: project.id,
            entityLabel: projectAuditLabel(project),
            metadata: { userId: input.userId, role: input.role, allocationPct: input.allocationPct },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'projects.member.added',
          {
            projectId: project.id,
            key: project.key,
            name: project.name,
            userId: input.userId,
            role: input.role,
          },
          { tx },
        );
        await this.touchProject(tx, project, ['members']);
        if (input.userId !== actor)
          await this.ctx.notifications.notify(
            {
              type: 'projects.member.added',
              recipients: [input.userId],
              params: { key: project.key, name: project.name, role: input.role },
              href: projectHref(project.key),
            },
            { tx },
          );
      });
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new HttpError(409, ErrorCodes.CONFLICT, 'This person is already a member', {
          issues: [{ path: 'userId', message: 'Already a member' }],
        });
      throw err;
    }
    return this.memberList(project);
  }

  async updateMember(
    ref: string,
    userId: string,
    input: z.output<typeof updateMemberSchema>,
    auth: AuthContext,
  ) {
    const { project } = await this.manageable(ref, auth);
    const [before] = await this.ctx.db.select().from(members).where(roleWhere(project.id, userId));
    if (!before) throw notFound('member');
    if (userId === project.ownerId && input.role && input.role !== 'manager')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The project owner is always a manager', {
        reason: 'owner',
      });
    const patch = {
      role: input.role ?? before.role,
      allocationPct: input.allocationPct ?? before.allocationPct,
    };
    const changes = this.ctx.audit.diff(before as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length)
      await this.ctx.transaction(async (tx) => {
        await tx.update(members).set(patch).where(eq(members.id, before.id));
        // People who can no longer work on tasks keep none assigned.
        if (patch.role === 'viewer' && before.role !== 'viewer')
          await this.unassignOpenTasks(tx, project.id, userId, actorOf(auth));
        await this.ctx.audit.record(
          {
            action: 'projects.member.updated',
            entityType: PROJECT_ENTITY,
            entityId: project.id,
            entityLabel: projectAuditLabel(project),
            changes,
            metadata: { userId },
          },
          { tx },
        );
        await this.touchProject(tx, project, ['members']);
      });
    return this.memberList(project);
  }

  /** Managers remove members; anyone but the owner may leave a project themselves. */
  async removeMember(ref: string, userId: string, auth: AuthContext) {
    const { project, access } = await this.load(ref, auth);
    const self = actorOf(auth) === userId;
    if (!access.canManage && !(self && access.role)) throw forbidden('Only the project managers can do this');
    if (userId === project.ownerId)
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        'The project owner cannot be removed; change the owner first',
        {
          reason: 'owner',
        },
      );
    await this.ctx.transaction(async (tx) => {
      const removed = await tx
        .delete(members)
        .where(roleWhere(project.id, userId))
        .returning({ id: members.id });
      if (!removed.length) throw notFound('member');
      const unassigned = await this.unassignOpenTasks(tx, project.id, userId, actorOf(auth));
      await this.ctx.audit.record(
        {
          action: 'projects.member.removed',
          entityType: PROJECT_ENTITY,
          entityId: project.id,
          entityLabel: projectAuditLabel(project),
          metadata: { userId, unassignedTasks: unassigned },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.member.removed',
        { projectId: project.id, key: project.key, name: project.name, userId },
        { tx },
      );
      await this.touchProject(tx, project, ['members']);
    });
  }

  /** Open tasks of someone who left the project (or can't work on it) go back to unassigned. */
  async unassignOpenTasks(tx: Db, projectId: string, userId: string, actorId: string | null) {
    const rows = await tx
      .update(tasks)
      .set({ assigneeId: null })
      .where(
        and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, userId), notInArray(tasks.status, CLOSED)),
      )
      .returning({ id: tasks.id });
    if (rows.length)
      await tx.insert(taskActivity).values(
        taskActivityRows(
          rows.map((r) => r.id),
          userId,
          actorId,
        ),
      );
    return rows.length;
  }

  /** A person left the company: unassign their open tasks and remove their memberships (not ownerships). */
  async offboard(userId: string) {
    await this.ctx.transaction(async (tx) => {
      const memberships = await tx
        .select({ project: projects })
        .from(members)
        .innerJoin(projects, eq(projects.id, members.projectId))
        .where(eq(members.userId, userId));
      for (const { project } of memberships) {
        const unassigned = await this.unassignOpenTasks(tx, project.id, userId, null);
        if (project.ownerId === userId) {
          if (unassigned)
            await this.ctx.audit.record(
              {
                action: 'projects.member.updated',
                entityType: PROJECT_ENTITY,
                entityId: project.id,
                entityLabel: projectAuditLabel(project),
                metadata: { userId, unassignedTasks: unassigned, reason: 'offboarded' },
              },
              { tx },
            );
          continue;
        }
        await tx.delete(members).where(roleWhere(project.id, userId));
        await this.ctx.audit.record(
          {
            action: 'projects.member.removed',
            entityType: PROJECT_ENTITY,
            entityId: project.id,
            entityLabel: projectAuditLabel(project),
            metadata: { userId, unassignedTasks: unassigned, reason: 'offboarded' },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'projects.member.removed',
          { projectId: project.id, key: project.key, name: project.name, userId },
          { tx },
        );
      }
    });
  }

  /* ───────────── milestones ───────────── */

  async milestones(ref: string, auth: AuthContext) {
    const { project } = await this.load(ref, auth);
    return this.milestoneList(project.id);
  }

  private async findMilestone(projectId: string, id: string) {
    const [m] = await this.ctx.db
      .select()
      .from(milestones)
      .where(and(eq(milestones.id, id), eq(milestones.projectId, projectId)));
    if (!m) throw notFound('milestone');
    return m;
  }

  async createMilestone(ref: string, input: z.output<typeof createMilestoneSchema>, auth: AuthContext) {
    const { project } = await this.manageable(ref, auth);
    await this.ctx.transaction(async (tx) => {
      const [{ top } = { top: null }] = await tx
        .select({ top: max(milestones.sort) })
        .from(milestones)
        .where(eq(milestones.projectId, project.id));
      const [m] = await tx
        .insert(milestones)
        .values({
          projectId: project.id,
          name: input.name,
          description: input.description?.trim() || null,
          dueDate: input.dueDate ?? null,
          sort: (top ?? -1) + 1,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'projects.milestone.created',
          entityType: PROJECT_ENTITY,
          entityId: project.id,
          entityLabel: projectAuditLabel(project),
          metadata: { milestoneId: m!.id, name: m!.name, dueDate: m!.dueDate },
        },
        { tx },
      );
      await this.touchProject(tx, project, ['milestones']);
    });
    return this.milestoneList(project.id);
  }

  async updateMilestone(
    ref: string,
    id: string,
    input: z.output<typeof updateMilestoneSchema>,
    auth: AuthContext,
  ) {
    const { project } = await this.manageable(ref, auth);
    const before = await this.findMilestone(project.id, id);
    const patch: Partial<typeof milestones.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.sort !== undefined) patch.sort = input.sort;
    if (input.status !== undefined && input.status !== before.status) {
      patch.status = input.status;
      patch.completedAt = input.status === 'done' ? new Date() : null;
    }
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (Object.keys(changes).length)
      await this.ctx.transaction(async (tx) => {
        await tx.update(milestones).set(patch).where(eq(milestones.id, before.id));
        const completed = patch.status === 'done';
        await this.ctx.audit.record(
          {
            action: completed ? 'projects.milestone.completed' : 'projects.milestone.updated',
            entityType: PROJECT_ENTITY,
            entityId: project.id,
            entityLabel: projectAuditLabel(project),
            changes,
            metadata: { milestoneId: before.id, name: patch.name ?? before.name },
          },
          { tx },
        );
        if (completed)
          await this.ctx.events.publish(
            'projects.milestone.completed',
            {
              projectId: project.id,
              key: project.key,
              name: project.name,
              milestoneId: before.id,
              milestone: patch.name ?? before.name,
            },
            { tx },
          );
        await this.touchProject(tx, project, ['milestones']);
      });
    return this.milestoneList(project.id);
  }

  async deleteMilestone(ref: string, id: string, auth: AuthContext) {
    const { project } = await this.manageable(ref, auth);
    const m = await this.findMilestone(project.id, id);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(milestones).where(eq(milestones.id, m.id));
      await this.ctx.audit.record(
        {
          action: 'projects.milestone.deleted',
          entityType: PROJECT_ENTITY,
          entityId: project.id,
          entityLabel: projectAuditLabel(project),
          metadata: { milestoneId: m.id, name: m.name },
        },
        { tx },
      );
      await this.touchProject(tx, project, ['milestones']);
    });
    return this.milestoneList(project.id);
  }

  /** New order of (some of) the project's milestones: `ids[0]` first. */
  async reorderMilestones(ref: string, ids: string[], auth: AuthContext) {
    const { project } = await this.manageable(ref, auth);
    const own = await this.ctx.db
      .select({ id: milestones.id, sort: milestones.sort })
      .from(milestones)
      .where(eq(milestones.projectId, project.id))
      .orderBy(asc(milestones.sort), asc(milestones.createdAt));
    const known = new Set(own.map((m) => m.id));
    const unique = [...new Set(ids)];
    if (unique.some((id) => !known.has(id))) throw invalid('ids', 'Unknown milestone for this project');
    // Listed ones first in the given order, the rest keep their relative order after them.
    const order = [...unique, ...own.map((m) => m.id).filter((id) => !unique.includes(id))];
    await this.ctx.transaction(async (tx) => {
      for (const [i, id] of order.entries())
        await tx.update(milestones).set({ sort: i }).where(eq(milestones.id, id));
      await this.ctx.audit.record(
        {
          action: 'projects.milestone.reordered',
          entityType: PROJECT_ENTITY,
          entityId: project.id,
          entityLabel: projectAuditLabel(project),
          metadata: { order },
        },
        { tx },
      );
      await this.touchProject(tx, project, ['milestones']);
    });
    return this.milestoneList(project.id);
  }
}

/** Timeline rows for tasks that lost their assignee because the person left the project. */
function taskActivityRows(taskIds: string[], fromUserId: string, actorId: string | null) {
  return taskIds.map((taskId) => ({
    taskId,
    kind: 'assignee' as const,
    field: 'assigneeId',
    fromValue: fromUserId,
    toValue: null,
    actorId,
  }));
}
