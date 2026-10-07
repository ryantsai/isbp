/**
 * Sync adapters (Phase 5): `projects.project` and `projects.task` (inside a project), so the Integrations
 * Hub can keep them in step with another system (Azure DevOps team projects and work items) without this
 * module knowing it. Writes go through `ProjectService` / `TaskService` as the hub's agent: membership
 * rules for assignees, dependencies that block `in_progress`, the project status flow, history, audit,
 * events and notifications are the UI's. A project becomes `active` only through its proposal approval.
 */
import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  type DomainEvent,
  ErrorCodes,
  HttpError,
  type ModuleContext,
  type SyncAdapter,
  type SyncComment,
  type SyncFieldDef,
  type SyncRecord,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, type SQL, sql } from 'drizzle-orm';
import { createProjectSchema, createTaskSchema, updateProjectSchema, updateTaskSchema } from '../contracts';
import {
  formatTaskRef,
  PERMISSIONS,
  PROJECT_KEY_RE,
  PROJECT_STATUSES,
  type ProjectStatus,
  projectTransitions,
  suggestProjectKey,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '../model';
import { members, milestones, type ProjectRow, projects, taskComments, type TaskRow, tasks } from './schema';
import { services } from './services';
import { projectHref, taskHref } from './shared';
import {
  approvalRequired,
  assertActiveUsers,
  cursorAt,
  exactLike,
  inSyncWrite,
  invalidValues,
  isUuid,
  literal,
  noTransition,
  pageLimit,
  pageOf,
  pageOrder,
  pageWhere,
  parseInput,
  syncErrors,
  statusPath,
  writerAuth,
} from './sync-support';

type Values = Record<string, unknown>;

/** What `projects.projects.sync` / `projects.tasks.sync` stand for (the kernel checked them). */
const WRITER = [PERMISSIONS.admin];

const KEYS: Record<string, string> = {
  assigneeId: 'assignee',
  parentId: 'parent',
  milestoneId: 'milestone',
  key: 'ref',
};

const label = (key: string) => `projects.sync.fields.${key}`;

const archived = () =>
  new HttpError(409, ErrorCodes.INVALID_STATE, 'The project is archived', { reason: 'archived' });

/* ───────────────────────────── projects.project ───────────────────────────── */

function projectRecord(p: ProjectRow): SyncRecord {
  return {
    id: p.id,
    ref: p.key,
    title: p.name,
    href: projectHref(p.key),
    updatedAt: p.updatedAt.toISOString(),
    containerId: null,
    values: {
      name: p.name,
      description: p.description,
      startDate: p.startDate,
      targetDate: p.targetDate,
      status: p.status,
      ref: p.key,
    },
  };
}

async function projectOf(db: Db, id: unknown): Promise<ProjectRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row ?? null;
}

/** A free project key from the name (`Network refresh` → `NR`, then `NR2`, `NR3`…). */
async function freeKey(db: Db, name: string): Promise<string> {
  const suggested = suggestProjectKey(name);
  const base = PROJECT_KEY_RE.test(suggested) ? suggested : 'PRJ';
  const prefix = base.slice(0, 6);
  const taken = new Set(
    (
      await db
        .select({ key: projects.key })
        .from(projects)
        .where(sql`${projects.key} like ${`${prefix}%`}`)
    ).map((r) => r.key),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base.slice(0, 10 - String(n).length)}${n}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * Status changes along the project flow (`ProjectService.changeStatus`, one step at a time). `proposed →
 * active` is the proposal approval's decision, never a sync's.
 */
async function moveProject(ctx: ModuleContext, auth: AuthContext, p: ProjectRow, to: ProjectStatus) {
  if (to === p.status) return p;
  const path = statusPath<ProjectStatus>((s) => projectTransitions(s), p.status, to);
  if (!path) {
    if (p.status === 'proposed')
      throw approvalRequired(p.status, to, 'A project starts through its proposal approval in ISBP');
    throw noTransition(p.status, to, projectTransitions(p.status), 'A project');
  }
  let current = p;
  for (const step of path) current = await services(ctx).projects.changeStatus(p.id, { status: step }, auth);
  return current;
}

function projectFields(v: Values): Values {
  const out: Values = {};
  for (const k of ['name', 'description', 'startDate', 'targetDate'] as const) if (k in v) out[k] = v[k];
  return out;
}

export const projectAdapter: SyncAdapter = {
  matchKeys: ['name'],

  async fields(): Promise<SyncFieldDef[]> {
    return [
      { key: 'name', label: label('name'), type: 'string', required: true, maxLength: 200 },
      { key: 'description', label: label('description'), type: 'markdown', maxLength: 50_000 },
      { key: 'startDate', label: label('startDate'), type: 'date' },
      { key: 'targetDate', label: label('targetDate'), type: 'date' },
      {
        key: 'status',
        label: label('status'),
        type: 'choice',
        choices: PROJECT_STATUSES.map((s) => ({ value: s, label: `projects.projectStatus.${s}` })),
      },
      { key: 'ref', label: label('ref'), type: 'string', readOnly: true },
    ];
  },

  async read(id, ctx) {
    const p = await projectOf(ctx.db, id);
    return p ? projectRecord(p) : null;
  },

  async readMany(ids, ctx) {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    return (await ctx.db.select().from(projects).where(inArray(projects.id, valid))).map(projectRecord);
  },

  async list(opts, ctx) {
    const limit = pageLimit(opts.limit);
    const rows = await ctx.db
      .select({ p: projects, cursorAt: cursorAt(projects.updatedAt) })
      .from(projects)
      .where(pageWhere(projects.updatedAt, projects.id, opts))
      .orderBy(...pageOrder(projects.updatedAt, projects.id))
      .limit(limit + 1);
    const page = pageOf(
      rows.map((r) => ({ ...r, id: r.p.id })),
      limit,
    );
    return { items: page.rows.map((r) => projectRecord(r.p)), next: page.next };
  },

  /** Case-insensitive exact name; null when several projects share it. */
  async findBy(field, value, _opts, ctx) {
    if (field !== 'name' || typeof value !== 'string' || !value.trim()) return null;
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(ilike(projects.name, exactLike(value.trim())))
      .limit(2);
    return rows.length === 1 ? projectRecord(rows[0]!) : null;
  },

  write(input, opts, ctx) {
    return inSyncWrite(ctx, opts, async (bound) => {
      const v: Values = { ...input.values };
      const auth = writerAuth(opts.auth, WRITER);
      const s = services(bound).projects;
      const status = v.status as ProjectStatus | undefined;
      return syncErrors(KEYS, async () => {
        if (!input.id) {
          // A created project starts `proposed`, without a manager yet; its proposal approval applies.
          const created = await s.create(
            parseInput(
              createProjectSchema,
              { ...projectFields(v), key: await freeKey(bound.db, String(v.name ?? '')) },
              KEYS,
            ),
            auth,
          );
          if (status) await moveProject(bound, auth, created, status);
          return { id: created.id };
        }
        const before = await projectOf(bound.db, input.id);
        if (!before) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Project not found');
        const fields = projectFields(v);
        if (Object.keys(fields).length)
          await s.update(before.id, parseInput(updateProjectSchema, fields, KEYS), auth);
        if (status) await moveProject(bound, auth, (await projectOf(bound.db, before.id))!, status);
        return { id: before.id };
      });
    });
  },

  idFromEvent(event: DomainEvent) {
    const id = (event.payload as { projectId?: unknown }).projectId;
    return isUuid(id) ? id : null;
  },
};

/* ───────────────────────────── projects.task ───────────────────────────── */

const taskColumns = { t: tasks, key: projects.key };

function taskRecord(r: { t: TaskRow; key: string }): SyncRecord {
  const { t } = r;
  const reference = formatTaskRef(r.key, t.number);
  return {
    id: t.id,
    ref: reference,
    title: t.title,
    href: taskHref(reference),
    updatedAt: t.updatedAt.toISOString(),
    containerId: t.projectId,
    values: {
      type: t.type,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assignee: t.assigneeId,
      parent: t.parentId,
      milestone: t.milestoneId,
      startDate: t.startDate,
      dueDate: t.dueDate,
      estimateHours: t.estimateHours,
      remainingHours: t.remainingHours,
      labels: t.labels,
      ref: reference,
    },
  };
}

const selectTasks = (db: Db, where: SQL | undefined) =>
  db.select(taskColumns).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(where);

async function taskOf(db: Db, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({ t: tasks, p: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, id));
  return row ?? null;
}

/** Sync values in the shape of the module's task schemas. */
function taskFields(v: Values): Values {
  const required = (['type', 'status', 'priority'] as const).filter((k) => v[k] === null);
  if (required.length) throw invalidValues(required.map((path) => ({ path, message: 'required' })));
  const out: Values = {};
  const map: Record<string, string> = {
    assignee: 'assigneeId',
    parent: 'parentId',
    milestone: 'milestoneId',
  };
  for (const k of [
    'type',
    'title',
    'description',
    'status',
    'priority',
    'assignee',
    'parent',
    'milestone',
    'startDate',
    'dueDate',
    'estimateHours',
    'remainingHours',
    'labels',
  ]) {
    if (!(k in v)) continue;
    const value = v[k];
    out[map[k] ?? k] = k === 'labels' ? (value ?? []) : k === 'title' ? (value ?? '') : value;
  }
  return out;
}

/**
 * The other system says this (active) person works on the task: someone not on the project yet joins it as a
 * `member` with 0 % allocation (audited, with the source), so the assignment holds the membership rule.
 * Viewers stay viewers (the module refuses them as assignees); people in the UI are added by a manager.
 */
async function ensureMember(ctx: ModuleContext, auth: AuthContext, projectId: string, userId: unknown) {
  if (typeof userId !== 'string') return;
  const [m] = await ctx.db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.projectId, projectId), eq(members.userId, userId)));
  if (!m)
    await services(ctx).projects.addMember(projectId, { userId, role: 'member', allocationPct: 0 }, auth);
}

export const taskAdapter: SyncAdapter = {
  matchKeys: ['title'],

  async fields(ctx, opts): Promise<SyncFieldDef[]> {
    // Milestones belong to a project: offered (and checked by the kernel) for the profile's project.
    const project = await projectOf(ctx.db, opts?.containerId);
    const milestoneRows = project
      ? await ctx.db
          .select({ id: milestones.id, name: milestones.name })
          .from(milestones)
          .where(eq(milestones.projectId, project.id))
          .orderBy(asc(milestones.sort), asc(milestones.createdAt))
      : null;
    return [
      {
        key: 'type',
        label: label('type'),
        type: 'choice',
        choices: TASK_TYPES.map((t) => ({ value: t, label: `projects.taskType.${t}` })),
      },
      { key: 'title', label: label('title'), type: 'string', required: true, maxLength: 300 },
      { key: 'description', label: label('description'), type: 'markdown', maxLength: 50_000 },
      {
        key: 'status',
        label: label('status'),
        type: 'choice',
        choices: TASK_STATUSES.map((s) => ({ value: s, label: `projects.taskStatus.${s}` })),
      },
      {
        key: 'priority',
        label: label('priority'),
        type: 'choice',
        choices: TASK_PRIORITIES.map((p) => ({ value: p, label: `projects.priority.${p}` })),
      },
      { key: 'assignee', label: label('assignee'), type: 'user' },
      { key: 'parent', label: label('parent'), type: 'parent' },
      {
        key: 'milestone',
        label: label('milestone'),
        type: 'choice',
        ...(milestoneRows
          ? { choices: milestoneRows.map((m) => ({ value: m.id, label: literal(m.name) })) }
          : {}),
      },
      { key: 'startDate', label: label('startDate'), type: 'date' },
      { key: 'dueDate', label: label('dueDate'), type: 'date' },
      { key: 'estimateHours', label: label('estimateHours'), type: 'number' },
      { key: 'remainingHours', label: label('remainingHours'), type: 'number' },
      { key: 'labels', label: label('labels'), type: 'tags' },
      { key: 'ref', label: label('ref'), type: 'string', readOnly: true },
    ];
  },

  async read(id, ctx) {
    if (!isUuid(id)) return null;
    const [row] = await selectTasks(ctx.db, eq(tasks.id, id));
    return row ? taskRecord(row) : null;
  },

  async readMany(ids, ctx) {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    return (await selectTasks(ctx.db, inArray(tasks.id, valid))).map(taskRecord);
  },

  async list(opts, ctx) {
    const limit = pageLimit(opts.limit);
    if (opts.containerId && !isUuid(opts.containerId)) return { items: [], next: null };
    const rows = await ctx.db
      .select({ ...taskColumns, cursorAt: cursorAt(tasks.updatedAt) })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          opts.containerId ? eq(tasks.projectId, opts.containerId) : undefined,
          pageWhere(tasks.updatedAt, tasks.id, opts),
        ),
      )
      .orderBy(...pageOrder(tasks.updatedAt, tasks.id))
      .limit(limit + 1);
    const page = pageOf(
      rows.map((r) => ({ ...r, id: r.t.id })),
      limit,
    );
    return { items: page.rows.map(taskRecord), next: page.next };
  },

  /** Case-insensitive exact title within the project (`containerId` required); null if none or several. */
  async findBy(field, value, opts, ctx) {
    if (field !== 'title' || typeof value !== 'string' || !value.trim() || !isUuid(opts.containerId))
      return null;
    const rows = await selectTasks(
      ctx.db,
      and(eq(tasks.projectId, opts.containerId), ilike(tasks.title, exactLike(value.trim()))),
    ).limit(2);
    return rows.length === 1 ? taskRecord(rows[0]!) : null;
  },

  write(input, opts, ctx) {
    return inSyncWrite(ctx, opts, async (bound) => {
      const v: Values = { ...input.values };
      const auth = writerAuth(opts.auth, WRITER);
      const s = services(bound).tasks;
      await assertActiveUsers(bound.db, [['assignee', v.assignee]]);
      return syncErrors(KEYS, async () => {
        if (!input.id) {
          const project = await projectOf(bound.db, input.containerId);
          if (!project) throw invalidValues([{ path: 'containerId', message: 'unknown project' }]);
          if (project.archivedAt) throw archived();
          await ensureMember(bound, auth, project.id, v.assignee);
          const { task } = await s.create(
            project.id,
            parseInput(createTaskSchema, taskFields(v), KEYS),
            auth,
          );
          return { id: task.id };
        }
        const found = await taskOf(bound.db, input.id);
        if (!found) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Task not found');
        if (input.containerId && input.containerId !== found.t.projectId)
          throw new HttpError(409, ErrorCodes.INVALID_STATE, 'A task stays in its project', {
            reason: 'other_project',
          });
        if (found.p.archivedAt) throw archived();
        if (v.assignee !== found.t.assigneeId) await ensureMember(bound, auth, found.p.id, v.assignee);
        const patch = parseInput(updateTaskSchema, taskFields(v), KEYS);
        if (Object.keys(patch).length) await s.update(found.t.id, patch, auth);
        return { id: found.t.id };
      });
    });
  },

  idFromEvent(event: DomainEvent) {
    const id = (event.payload as { taskId?: unknown }).taskId;
    return isUuid(id) ? id : null;
  },

  comments: {
    async list(id, ctx) {
      const found = await taskOf(ctx.db, id);
      if (!found) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Task not found');
      const rows = await ctx.db
        .select({ c: taskComments, name: users.displayName, email: users.email })
        .from(taskComments)
        .leftJoin(users, eq(users.id, taskComments.authorId))
        .where(eq(taskComments.taskId, found.t.id))
        .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
        .limit(1_000);
      return rows.map(({ c, name, email }): SyncComment => ({
        id: c.id,
        body: c.body,
        authorName: name ?? c.authorName ?? '—',
        authorEmail: email ?? c.authorEmail,
        createdAt: c.createdAt.toISOString(),
        internal: false,
      }));
    },
    add(id, comment, opts, ctx) {
      return inSyncWrite(ctx, opts, async (bound) => {
        const found = await taskOf(bound.db, id);
        if (!found) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Task not found');
        if (found.p.archivedAt) throw archived();
        // Every project member reads task comments: an internal note from elsewhere has no place here.
        if (comment.internal)
          throw invalidValues([{ path: 'internal', message: 'tasks have no internal notes' }]);
        const at = comment.createdAt ? new Date(comment.createdAt) : undefined;
        const c = await services(bound).tasks.addComment(
          found.t.id,
          comment.body.trim().slice(0, 20_000),
          writerAuth(opts.auth, WRITER),
          {
            author: { name: comment.authorName.slice(0, 200) || '—', email: comment.authorEmail ?? null },
            at: at && !Number.isNaN(at.getTime()) ? at : undefined,
          },
        );
        return { id: c.id };
      });
    },
  },
};

export const sync = { project: projectAdapter, task: taskAdapter };
