import { createdAt, departments, id, updatedAt, users } from '@isbp/db/schema';
import { sql } from 'drizzle-orm';
import type { LocalizedText } from '@isbp/sdk';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { ReportSection } from '../contracts';
import type {
  Cadence,
  MemberRole,
  MilestoneStatus,
  ProjectHealth,
  ProjectPriority,
  ProjectSignals,
  ProjectStatus,
  StatusUpdateState,
  TaskPriority,
  TaskStatus,
  TaskType,
  Visibility,
} from '../model';

/**
 * All tables of this module live in the `projects` Postgres schema. Every syncable table has a uuid v7
 * id and `updated_at`, so a future Azure DevOps sync (team projects ↔ projects, work items ↔ tasks) can
 * map records both ways. Exported as `@isbp/module-projects/schema` for modules that depend on Projects.
 */
export const projectsSchema = pgSchema('projects');

/** Board ranks compare in byte order whatever the database collation is. */
const rankText = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });

/** Where a change a sync made came from ("via Azure DevOps Bug 812"). */
export interface SyncVia {
  connectionId: string;
  connection: string;
  connector: string;
  ref: string;
  url: string | null;
}

/** Calendar dates (`YYYY-MM-DD`): no time zone can shift them. */
const day = (name: string) => date(name, { mode: 'string' });
const hours = (name: string) => numeric(name, { precision: 8, scale: 2, mode: 'number' });

export const projects = projectsSchema.table(
  'projects',
  {
    id: id(),
    key: varchar('key', { length: 10 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).$type<ProjectStatus>().notNull().default('proposed'),
    health: varchar('health', { length: 20 }).$type<ProjectHealth>().notNull().default('on_track'),
    healthNote: text('health_note'),
    healthUpdatedAt: timestamp('health_updated_at', { withTimezone: true }),
    priority: varchar('priority', { length: 10 }).$type<ProjectPriority>().notNull().default('medium'),
    /** The project manager. */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    /** `internal`: everyone with `projects.use` can view; `private`: members only. */
    visibility: varchar('visibility', { length: 10 }).$type<Visibility>().notNull().default('internal'),
    startDate: day('start_date'),
    targetDate: day('target_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Planned effort in hours (the proposal workflow decides on it). */
    budgetHours: integer('budget_hours'),
    /** Next task number; incremented with `UPDATE … RETURNING` inside the task-create transaction. */
    nextTaskNumber: integer('next_task_number').notNull().default(1),
    approvalInstanceId: uuid('approval_instance_id'),
    approvalStatus: varchar('approval_status', { length: 20 }).$type<
      'pending' | 'approved' | 'rejected' | 'cancelled'
    >(),
    approvalComment: text('approval_comment'),
    approvalDecidedAt: timestamp('approval_decided_at', { withTimezone: true }),
    /** Custom fields (`projects.project`). */
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_key_uq').on(t.key),
    index('projects_status_idx').on(t.status),
    index('projects_owner_idx').on(t.ownerId),
    index('projects_department_idx').on(t.departmentId),
    index('projects_updated_idx').on(t.updatedAt),
    index('projects_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
    index('projects_attributes_gin').using('gin', t.attributes.op('jsonb_path_ops')),
    check('projects_key_ck', sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check('projects_budget_ck', sql`${t.budgetHours} is null or ${t.budgetHours} >= 0`),
  ],
);

export const members = projectsSchema.table(
  'members',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 10 }).$type<MemberRole>().notNull().default('member'),
    /** Share of the person's week planned for this project (0–100). */
    allocationPct: smallint('allocation_pct').notNull().default(100),
    /** Added by a sync assigning them a task ("Added via Azure DevOps Bug 812"). */
    via: jsonb('via').$type<SyncVia>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('members_project_user_uq').on(t.projectId, t.userId),
    index('members_user_idx').on(t.userId),
    check('members_allocation_ck', sql`${t.allocationPct} between 0 and 100`),
  ],
);

export const milestones = projectsSchema.table(
  'milestones',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    dueDate: day('due_date'),
    status: varchar('status', { length: 10 }).$type<MilestoneStatus>().notNull().default('open'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('milestones_project_idx').on(t.projectId, t.sort)],
);

export const tasks = projectsSchema.table(
  'tasks',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Per project: the reference is `<key>-<number>` (`NET-12`). */
    number: integer('number').notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    description: text('description'),
    type: varchar('type', { length: 10 }).$type<TaskType>().notNull().default('task'),
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).$type<TaskStatus>().notNull().default('todo'),
    priority: varchar('priority', { length: 10 }).$type<TaskPriority>().notNull().default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    startDate: day('start_date'),
    dueDate: day('due_date'),
    estimateHours: hours('estimate_hours'),
    remainingHours: hours('remaining_hours'),
    /** Order within a board column (fractional index, byte order). */
    rank: rankText('rank').notNull(),
    labels: text('labels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** The due date the "due tomorrow" reminder was last sent for (once per task per due date). */
    remindedDueDate: day('reminded_due_date'),
    /** Custom fields (`projects.task`). */
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tasks_project_number_uq').on(t.projectId, t.number),
    index('tasks_board_idx').on(t.projectId, t.status, t.rank),
    index('tasks_assignee_idx').on(t.assigneeId, t.status),
    index('tasks_due_idx').on(t.dueDate),
    index('tasks_parent_idx').on(t.parentId),
    index('tasks_milestone_idx').on(t.milestoneId),
    index('tasks_updated_idx').on(t.updatedAt),
    // A project's tasks in update order (the sync adapter pages by `updated_at`, then id).
    index('tasks_project_updated_idx').on(t.projectId, t.updatedAt, t.id),
    index('tasks_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
    index('tasks_labels_gin').using('gin', t.labels),
    index('tasks_attributes_gin').using('gin', t.attributes.op('jsonb_path_ops')),
    check(
      'tasks_dates_ck',
      sql`${t.dueDate} is null or ${t.startDate} is null or ${t.dueDate} >= ${t.startDate}`,
    ),
    check(
      'tasks_hours_ck',
      sql`(${t.estimateHours} is null or ${t.estimateHours} >= 0) and (${t.remainingHours} is null or ${t.remainingHours} >= 0)`,
    ),
  ],
);

/** Finish-to-start: `task_id` can't start before `depends_on_id` is done. Same project, never a loop. */
export const taskDependencies = projectsSchema.table(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnId: uuid('depends_on_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'task_dependencies_pk', columns: [t.taskId, t.dependsOnId] }),
    index('task_dependencies_depends_on_idx').on(t.dependsOnId),
    check('task_dependencies_not_self', sql`${t.taskId} <> ${t.dependsOnId}`),
  ],
);

export const taskComments = projectsSchema.table(
  'task_comments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** A comment synced from another system: its author there (no ISBP account behind it). */
    authorName: varchar('author_name', { length: 200 }),
    authorEmail: varchar('author_email', { length: 320 }),
    via: jsonb('via').$type<SyncVia>(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [index('task_comments_task_idx').on(t.taskId, t.createdAt)],
);

export type ActivityKind = 'created' | 'status' | 'assignee' | 'field' | 'comment' | 'dependency';

/** A task's timeline: what changed, from what to what, by whom. */
export const taskActivity = projectsSchema.table(
  'task_activity',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).$type<ActivityKind>().notNull(),
    field: varchar('field', { length: 40 }),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Agents, services and people from other systems (no ISBP account) by name. */
    actorName: varchar('actor_name', { length: 200 }),
    via: jsonb('via').$type<SyncVia>(),
    createdAt: createdAt(),
  },
  (t) => [index('task_activity_task_idx').on(t.taskId, t.createdAt)],
);

/** Health and status history shown on the project page (health with its note, status changes). */
export const projectUpdates = projectsSchema.table(
  'project_updates',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 10 }).$type<'health' | 'status'>().notNull(),
    fromValue: varchar('from_value', { length: 20 }),
    toValue: varchar('to_value', { length: 20 }).notNull(),
    note: text('note'),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Agents and services (no ISBP account) by name. */
    authorName: varchar('author_name', { length: 200 }),
    via: jsonb('via').$type<SyncVia>(),
    createdAt: createdAt(),
  },
  (t) => [index('project_updates_project_idx').on(t.projectId, t.createdAt)],
);

/* ───────────────────────────── status reporting (Phase 11) ───────────────────────────── */

/**
 * The organisation's status reporting schedule: one row (`id = 'default'`), set by the PMO. Names its reporter group
 * by key, like other settings, so deleting the group is refused while it is used (`references`).
 */
export const statusSchedule = projectsSchema.table(
  'status_schedule',
  {
    id: varchar('id', { length: 20 }).primaryKey().default('default'),
    enabled: boolean('enabled').notNull().default(false),
    cadence: varchar('cadence', { length: 10 }).$type<Cadence>().notNull().default('weekly'),
    /** ISO weekday the update is due (1 = Monday … 5 = Friday). */
    dueWeekday: smallint('due_weekday').notNull().default(5),
    timeZone: varchar('time_zone', { length: 64 }).notNull().default('Asia/Taipei'),
    managers: boolean('managers').notNull().default(true),
    groupKey: varchar('group_key', { length: 100 }),
    remindDaysBefore: smallint('remind_days_before').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('status_schedule_singleton_ck', sql`${t.id} = 'default'`),
    check('status_schedule_weekday_ck', sql`${t.dueWeekday} between 1 and 5`),
    check('status_schedule_remind_ck', sql`${t.remindDaysBefore} between 0 and 3`),
  ],
);

/**
 * Status updates: one per project, person and period. The schedule's job creates `pending` rows for the updates
 * people owe (no content yet); posting fills them (or creates an unasked-for one). Sent updates keep a snapshot of
 * the project's signals so past reports don't change.
 */
export const statusUpdates = projectsSchema.table(
  'status_updates',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    periodKey: varchar('period_key', { length: 10 }).notNull(),
    cadence: varchar('cadence', { length: 10 }).$type<Cadence>().notNull(),
    periodStart: day('period_start').notNull(),
    periodEnd: day('period_end').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    /** The end of the period (in the schedule's time zone): a pending update is missed after it. */
    closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
    state: varchar('state', { length: 10 }).$type<StatusUpdateState>().notNull().default('pending'),
    /** Owed by the schedule (false: posted without being asked). */
    expected: boolean('expected').notNull().default(true),
    status: varchar('status', { length: 20 }).$type<ProjectHealth>(),
    progress: smallint('progress'),
    forecastDate: day('forecast_date'),
    summary: text('summary'),
    done: text('done'),
    next: text('next'),
    blockers: text('blockers'),
    asks: text('asks'),
    signals: jsonb('signals').$type<ProjectSignals>(),
    draftMode: varchar('draft_mode', { length: 10 }).$type<'llm' | 'builtin'>(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /** Reminders sent for a pending update: 1 = "due soon", 2 = "overdue" (each claimed once). */
    reminderStage: smallint('reminder_stage').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('status_updates_project_author_period_uq').on(t.projectId, t.authorId, t.periodKey),
    // My work and reminders: a person's pending updates by due time.
    index('status_updates_author_idx').on(t.authorId, t.state, t.dueAt),
    // Compliance and reports: a period's updates.
    index('status_updates_period_idx').on(t.periodKey, t.state),
    // A project's history, newest first.
    index('status_updates_project_idx').on(t.projectId, t.submittedAt),
    check('status_updates_progress_ck', sql`${t.progress} is null or ${t.progress} between 0 and 100`),
    check(
      'status_updates_submitted_ck',
      sql`${t.state} <> 'submitted' or (${t.status} is not null and ${t.summary} is not null and ${t.submittedAt} is not null)`,
    ),
  ],
);

/** Status report templates: ordered section building blocks (configuration; kind `projects.report-template`). */
export const reportTemplates = projectsSchema.table(
  'report_templates',
  {
    id: id(),
    key: varchar('key', { length: 40 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<LocalizedText>(),
    sections: jsonb('sections').$type<ReportSection[]>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('report_templates_key_uq').on(t.key)],
);

/**
 * Narrative text of status reports, keyed by a hash of exactly what it was written from (template, language,
 * period, the projects in view with their states and updates): readers who see the same projects share it, and
 * nothing here holds a project its reader couldn't see. `input` is what the job writes from; it is cleared after.
 */
export const reportNarratives = projectsSchema.table(
  'report_narratives',
  {
    hash: varchar('hash', { length: 64 }).primaryKey(),
    locale: varchar('locale', { length: 10 }).notNull(),
    periodKey: varchar('period_key', { length: 10 }).notNull(),
    templateId: uuid('template_id').references(() => reportTemplates.id, { onDelete: 'cascade' }),
    state: varchar('state', { length: 10 }).$type<'pending' | 'ready' | 'failed'>().notNull(),
    mode: varchar('mode', { length: 10 }).$type<'llm' | 'builtin'>(),
    model: varchar('model', { length: 200 }),
    input: jsonb('input'),
    content: jsonb('content'),
    error: text('error'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('report_narratives_created_idx').on(t.createdAt)],
);

export type ProjectRow = typeof projects.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type MilestoneRow = typeof milestones.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type CommentRow = typeof taskComments.$inferSelect;
export type StatusScheduleRow = typeof statusSchedule.$inferSelect;
export type StatusUpdateRow = typeof statusUpdates.$inferSelect;
export type ReportTemplateRow = typeof reportTemplates.$inferSelect;
