import { dateTime, isTimeZone } from '@isbp/contracts';
import { listQuerySchema, localizedTextSchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  CADENCES,
  MAX_REPORT_SECTIONS,
  MEMBER_ROLES,
  MILESTONE_STATUSES,
  PROJECT_HEALTHS,
  PROJECT_KEY_RE,
  PROJECT_PRIORITIES,
  PROJECT_DETAILS,
  PROJECT_STATUSES,
  REPORT_STATES,
  REPORT_TEMPLATE_KEY_RE,
  STATE_REASONS,
  STATUS_UPDATE_STATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  UPDATE_STANDINGS,
  VISIBILITIES,
} from './model';

export * from './model';

/* ───────────────────────────── primitives ───────────────────────────── */

/** A calendar date, `YYYY-MM-DD` (no time zone). */
export const dateOnly = z.iso.date();

export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const projectHealthSchema = z.enum(PROJECT_HEALTHS);
export const projectPrioritySchema = z.enum(PROJECT_PRIORITIES);
export const visibilitySchema = z.enum(VISIBILITIES);
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export const milestoneStatusSchema = z.enum(MILESTONE_STATUSES);
export const taskTypeSchema = z.enum(TASK_TYPES);
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled']);

export const projectKeySchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(PROJECT_KEY_RE, '2–10 letters or digits, starting with a letter'));

/** A task reference (`NET-12`) or its uuid. */
export const taskRefParam = z.string().trim().min(1).max(64);
const hoursSchema = z.number().min(0).max(100_000);
const labelSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^,<>]+$/, 'Labels cannot contain commas or angle brackets');
const markdown = z.string().max(50_000);

export const personSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type PersonRef = z.input<typeof personSchema>;

/** A change a sync with another system made: where it came from ("via Azure DevOps Bug 812"). */
export const viaSchema = z.object({ connection: z.string(), ref: z.string(), url: z.string().nullable() });
export type Via = z.input<typeof viaSchema>;

const taskCountsSchema = z.object(
  Object.fromEntries(TASK_STATUSES.map((s) => [s, z.number().int()])) as Record<
    (typeof TASK_STATUSES)[number],
    z.ZodNumber
  >,
);

/* ───────────────────────────── projects ───────────────────────────── */

export const milestoneRefSchema = z.object({ id: z.uuid(), name: z.string(), dueDate: dateOnly.nullable() });

export const projectSummarySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  status: projectStatusSchema,
  health: projectHealthSchema,
  healthNote: z.string().nullable(),
  priority: projectPrioritySchema,
  visibility: visibilitySchema,
  owner: personSchema.nullable(),
  department: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  startDate: dateOnly.nullable(),
  targetDate: dateOnly.nullable(),
  completedAt: dateTime.nullable(),
  budgetHours: z.number().int().nullable(),
  archivedAt: dateTime.nullable(),
  approvalStatus: approvalStatusSchema.nullable(),
  taskCounts: taskCountsSchema,
  /** Tasks that are not cancelled. */
  totalTasks: z.number().int(),
  doneTasks: z.number().int(),
  /** Done ÷ (all but cancelled), 0–100. */
  progress: z.number().int(),
  overdueCount: z.number().int(),
  nextMilestone: milestoneRefSchema.nullable(),
  memberCount: z.number().int(),
  /** The caller's role in the project, if a member. */
  myRole: memberRoleSchema.nullable(),
  updatedAt: dateTime,
});
export type ProjectSummary = z.input<typeof projectSummarySchema>;

export const memberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: memberRoleSchema,
  allocationPct: z.number().int(),
  /** Offboarded or suspended people stay listed but can't be assigned. */
  active: z.boolean(),
  isOwner: z.boolean(),
  /** Added by a sync that assigned them a task (the other system said they work on it). */
  via: viaSchema.nullable(),
});
export type Member = z.input<typeof memberSchema>;

export const milestoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  dueDate: dateOnly.nullable(),
  status: milestoneStatusSchema,
  completedAt: dateTime.nullable(),
  sort: z.number().int(),
  taskCount: z.number().int(),
  doneCount: z.number().int(),
});
export type Milestone = z.input<typeof milestoneSchema>;

export const projectUpdateSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['health', 'status']),
  from: z.string().nullable(),
  to: z.string(),
  note: z.string().nullable(),
  author: personSchema.nullable(),
  /** An agent or service (no ISBP account) by name. */
  authorName: z.string().nullable(),
  via: viaSchema.nullable(),
  createdAt: dateTime,
});
export type ProjectUpdate = z.input<typeof projectUpdateSchema>;

export const projectViewerSchema = z.object({
  role: memberRoleSchema.nullable(),
  /** Edit the project, its members and milestones, and any task. */
  canManage: z.boolean(),
  /** Create and edit tasks. */
  canEditTasks: z.boolean(),
  canComment: z.boolean(),
  /** Delete the project: admins, or managers while it has no tasks. */
  canDelete: z.boolean(),
  /** Statuses `POST /status` accepts now. */
  transitions: z.array(projectStatusSchema),
  /** "Start project" (submit the proposal) is available. */
  canStart: z.boolean(),
});

export const projectDetailSchema = projectSummarySchema.extend({
  description: z.string().nullable(),
  healthUpdatedAt: dateTime.nullable(),
  attributes: z.record(z.string(), z.unknown()),
  createdAt: dateTime,
  members: z.array(memberSchema),
  milestones: z.array(milestoneSchema),
  kpis: z.object({
    overdue: z.number().int(),
    doneThisWeek: z.number().int(),
    blocked: z.number().int(),
    open: z.number().int(),
  }),
  approval: z
    .object({
      instanceId: z.uuid().nullable(),
      status: approvalStatusSchema.nullable(),
      comment: z.string().nullable(),
      decidedAt: dateTime.nullable(),
    })
    .nullable(),
  updates: z.array(projectUpdateSchema),
  labels: z.array(z.string()),
  viewer: projectViewerSchema,
  settings: z.object({ hoursPerWeek: z.number(), proposalThresholdHours: z.number() }),
});
export type ProjectDetail = z.input<typeof projectDetailSchema>;

export const projectQuerySchema = listQuerySchema.extend({
  status: z.union([projectStatusSchema, z.literal('open')]).optional(),
  health: projectHealthSchema.optional(),
  /** Projects I own or am a member of. */
  mine: z.stringbool().optional(),
  owner: z.uuid().optional(),
  department: z.uuid().optional(),
  /** Archived projects instead of current ones. */
  archived: z.stringbool().optional(),
});

const projectFields = {
  name: z.string().trim().min(1).max(200),
  description: markdown.nullish(),
  ownerId: z.uuid().nullish(),
  departmentId: z.uuid().nullish(),
  priority: projectPrioritySchema.optional(),
  visibility: visibilitySchema.optional(),
  startDate: dateOnly.nullish(),
  targetDate: dateOnly.nullish(),
  budgetHours: z.number().int().min(0).max(1_000_000).nullish(),
  attributes: z.record(z.string(), z.unknown()).optional(),
};

export const createProjectSchema = z.object({ ...projectFields, key: projectKeySchema });
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    ...projectFields,
    /** Only while the project has no tasks (references would change). */
    key: projectKeySchema,
    archived: z.boolean(),
  })
  .partial();
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export const projectStatusChangeSchema = z.object({
  status: projectStatusSchema,
  comment: z.string().trim().max(2_000).nullish(),
  /** Complete although tasks are still open (needs a comment). */
  force: z.boolean().optional(),
});

export const projectHealthChangeSchema = z.object({
  health: projectHealthSchema,
  note: z.string().trim().min(1).max(2_000),
});

export const addMemberSchema = z.object({
  userId: z.uuid(),
  role: memberRoleSchema.default('member'),
  allocationPct: z.number().int().min(0).max(100).default(100),
});
export const updateMemberSchema = z
  .object({ role: memberRoleSchema, allocationPct: z.number().int().min(0).max(100) })
  .partial();

export const createMilestoneSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).nullish(),
  dueDate: dateOnly.nullish(),
});
export const updateMilestoneSchema = createMilestoneSchema
  .extend({ status: milestoneStatusSchema, sort: z.number().int().min(0).max(100_000) })
  .partial();
export const reorderMilestonesSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

/* ───────────────────────────── tasks ───────────────────────────── */

export const taskRefSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  type: taskTypeSchema,
});
export type TaskRef = z.input<typeof taskRefSchema>;

export const projectRefSchema = z.object({ id: z.uuid(), key: z.string(), name: z.string() });

export const taskCardSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  number: z.number().int(),
  title: z.string(),
  type: taskTypeSchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assignee: personSchema.nullable(),
  startDate: dateOnly.nullable(),
  dueDate: dateOnly.nullable(),
  labels: z.array(z.string()),
  milestoneId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  estimateHours: z.number().nullable(),
  remainingHours: z.number().nullable(),
  rank: z.string(),
  commentCount: z.number().int(),
  linkCount: z.number().int(),
  /** A dependency is not done yet. */
  blocked: z.boolean(),
});
export type TaskCard = z.input<typeof taskCardSchema>;

export const boardSchema = z.object({
  project: projectRefSchema,
  columns: z.array(
    z.object({
      status: taskStatusSchema,
      /** Matching tasks in the column (only the first `limit` are listed). */
      total: z.number().int(),
      tasks: z.array(taskCardSchema),
    }),
  ),
  limit: z.number().int(),
});
export type Board = z.input<typeof boardSchema>;

export const boardQuerySchema = z.object({
  /** `me`, `none` or a user id. */
  assignee: z.string().max(40).optional(),
  milestone: z.uuid().optional(),
  label: z.string().max(40).optional(),
  type: taskTypeSchema.optional(),
  q: z.string().trim().max(200).optional(),
  /** Also list the cancelled column. */
  cancelled: z.stringbool().optional(),
});

export const taskListItemSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  number: z.number().int(),
  title: z.string(),
  type: taskTypeSchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assignee: personSchema.nullable(),
  startDate: dateOnly.nullable(),
  dueDate: dateOnly.nullable(),
  labels: z.array(z.string()),
  project: projectRefSchema,
  milestone: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  estimateHours: z.number().nullable(),
  remainingHours: z.number().nullable(),
  updatedAt: dateTime,
});
export type TaskListItem = z.input<typeof taskListItemSchema>;

export const taskQuerySchema = listQuerySchema.extend({
  /** Project key. */
  project: z.string().max(10).optional(),
  /** `me`, `none` or a user id. */
  assignee: z.string().max(40).optional(),
  /** `open` (default for "My tasks"), `closed` or one status. */
  status: z.union([taskStatusSchema, z.enum(['open', 'closed'])]).optional(),
  due: z.enum(['overdue', 'week']).optional(),
  type: taskTypeSchema.optional(),
  priority: taskPrioritySchema.optional(),
  milestone: z.uuid().optional(),
  label: z.string().max(40).optional(),
});

export const taskViewerSchema = z.object({
  canEdit: z.boolean(),
  canComment: z.boolean(),
  canDelete: z.boolean(),
  /** The project's managers (and admins) may edit anything in it. */
  canManage: z.boolean(),
});

export const taskDetailSchema = taskListItemSchema.extend({
  description: z.string().nullable(),
  reporter: personSchema.nullable(),
  parent: taskRefSchema.nullable(),
  children: z.array(taskRefSchema),
  /** Dependencies: this task can't start until they're done. */
  blockedBy: z.array(taskRefSchema),
  /** Tasks that depend on this one. */
  blocking: z.array(taskRefSchema),
  attributes: z.record(z.string(), z.unknown()),
  completedAt: dateTime.nullable(),
  createdAt: dateTime,
  commentCount: z.number().int(),
  projectStatus: projectStatusSchema,
  viewer: taskViewerSchema,
});
export type TaskDetail = z.input<typeof taskDetailSchema>;

const taskFields = {
  title: z.string().trim().min(1).max(300),
  description: markdown.nullish(),
  type: taskTypeSchema.optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.uuid().nullish(),
  reporterId: z.uuid().nullish(),
  milestoneId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
  startDate: dateOnly.nullish(),
  dueDate: dateOnly.nullish(),
  estimateHours: hoursSchema.nullish(),
  remainingHours: hoursSchema.nullish(),
  labels: z.array(labelSchema).max(20).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
};

export const createTaskSchema = z.object({
  ...taskFields,
  /** Where the task lands in its board column (default: the top, like quick-add). */
  position: z.enum(['top', 'bottom']).optional(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z.object(taskFields).partial();
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

/** Board move: the new column and the neighbours to land between (references or ids). */
export const moveTaskSchema = z.object({
  status: taskStatusSchema,
  /** Land just before this task. */
  before: taskRefParam.nullish(),
  /** Land just after this task. */
  after: taskRefParam.nullish(),
});
export type MoveTaskInput = z.input<typeof moveTaskSchema>;

export const addDependencySchema = z.object({ dependsOn: taskRefParam });

export const commentSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  author: personSchema.nullable(),
  /** The author in another system, for comments a sync copied (no ISBP account). */
  authorName: z.string().nullable(),
  via: viaSchema.nullable(),
  createdAt: dateTime,
  editedAt: dateTime.nullable(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});
export type Comment = z.input<typeof commentSchema>;
export const commentInputSchema = z.object({ body: z.string().trim().min(1).max(20_000) });

export const activitySchema = z.object({
  id: z.uuid(),
  kind: z.enum(['created', 'status', 'assignee', 'field', 'comment', 'dependency']),
  field: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** Display text for people (`assignee`) and tasks (`dependency`), resolved at read time. */
  fromLabel: z.string().nullable(),
  toLabel: z.string().nullable(),
  actor: personSchema.nullable(),
  /** Agents, services and people of other systems (no ISBP account) by name. */
  actorName: z.string().nullable(),
  via: viaSchema.nullable(),
  createdAt: dateTime,
});
export type Activity = z.input<typeof activitySchema>;

/* ───────────────────────────── timeline ───────────────────────────── */

export const timelineTaskSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  title: z.string(),
  type: taskTypeSchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  startDate: dateOnly.nullable(),
  dueDate: dateOnly.nullable(),
  milestoneId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  assignee: personSchema.nullable(),
  /** Share of the work done, 0–1 (done tasks are 1). */
  progress: z.number(),
});
export type TimelineTask = z.input<typeof timelineTaskSchema>;

export const timelineSchema = z.object({
  project: projectRefSchema.extend({ startDate: dateOnly.nullable(), targetDate: dateOnly.nullable() }),
  tasks: z.array(timelineTaskSchema),
  unscheduled: z.array(timelineTaskSchema),
  dependencies: z.array(z.object({ taskId: z.uuid(), dependsOnId: z.uuid() })),
  milestones: z.array(milestoneSchema),
  canEdit: z.boolean(),
});
export type Timeline = z.input<typeof timelineSchema>;

export const timelineQuerySchema = boardQuerySchema.omit({ cancelled: true }).extend({
  /** Include done and cancelled tasks (default true: the plan shows finished work too). */
  closed: z.stringbool().optional(),
});

/* ───────────────────────────── workload ───────────────────────────── */

export const workloadQuerySchema = z.object({
  /** Any date of the first week (default: this week). */
  from: dateOnly.optional(),
  weeks: z.coerce.number().int().min(1).max(26).default(8),
});

export const workloadCellSchema = z.object({
  /** Monday of the ISO week. */
  week: dateOnly,
  planned: z.number(),
  capacity: z.number(),
  /** Planned ÷ capacity (null without capacity). */
  utilisation: z.number().nullable(),
  /** Hours beyond capacity (0 when within). */
  overBy: z.number(),
  tasks: z.array(
    z.object({
      id: z.uuid(),
      reference: z.string(),
      title: z.string(),
      status: taskStatusSchema,
      projectKey: z.string(),
      dueDate: dateOnly.nullable(),
      hours: z.number(),
    }),
  ),
});
export type WorkloadCell = z.input<typeof workloadCellSchema>;

export const workloadSchema = z.object({
  from: dateOnly,
  today: dateOnly,
  weeks: z.array(dateOnly),
  hoursPerWeek: z.number(),
  people: z.array(
    z.object({
      user: personSchema,
      /** Allocation summed over the projects in view. */
      allocationPct: z.number().int(),
      projects: z.array(z.object({ key: z.string(), allocationPct: z.number().int() })),
      cells: z.array(workloadCellSchema),
    }),
  ),
  unassigned: z.array(workloadCellSchema),
});
export type Workload = z.input<typeof workloadSchema>;

/* ───────────────────────────── me ───────────────────────────── */

export const myTasksSchema = z.object({
  today: dateOnly,
  total: z.number().int(),
  groups: z.object({
    overdue: z.array(taskListItemSchema),
    today: z.array(taskListItemSchema),
    thisWeek: z.array(taskListItemSchema),
    later: z.array(taskListItemSchema),
    noDate: z.array(taskListItemSchema),
  }),
});
export type MyTasks = z.input<typeof myTasksSchema>;

export const lookupQuerySchema = z.object({ q: z.string().trim().max(100).optional() });

/* ───────────────────────────── AI tools ───────────────────────────── */

export const aiMyTasksInput = z.object({ status: z.enum(['open', 'all']).default('open') });
export const aiFindTasksInput = z.object({
  query: z.string().trim().max(200).optional(),
  project: z.string().trim().max(200).optional().describe('Project key (NET) or name'),
  assignee: z.string().trim().max(320).optional().describe('"me" or an email address'),
  status: z.union([taskStatusSchema, z.enum(['open', 'closed'])]).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const aiCreateTaskInput = z.object({
  project: z.string().trim().min(1).max(200).describe('Project key (NET) or exact name'),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).optional(),
  assigneeEmail: z.email().optional(),
  dueDate: dateOnly.optional(),
  priority: taskPrioritySchema.optional(),
});
export const aiUpdateTaskStatusInput = z.object({
  task: taskRefParam.describe('Task reference such as NET-12'),
  status: taskStatusSchema,
  comment: z.string().trim().max(20_000).optional(),
});
export const aiProjectStatusInput = z.object({
  project: z.string().trim().min(1).max(200).describe('Project key (NET) or (part of) its name'),
});

/* ───────────────────────────── status reporting (Phase 11) ───────────────────────────── */

export const cadenceSchema = z.enum(CADENCES);
export const reportStateSchema = z.enum(REPORT_STATES);
export const updateStandingSchema = z.enum(UPDATE_STANDINGS);
export const statusUpdateStateSchema = z.enum(STATUS_UPDATE_STATES);
export const stateReasonSchema = z.object({ code: z.enum(STATE_REASONS), value: z.number().nullable() });
export type StateReasonDto = z.input<typeof stateReasonSchema>;
export const draftModeSchema = z.enum(['llm', 'builtin']);

/**
 * The organisation's status reporting schedule (one, set by the PMO; also the customisation kind
 * `projects.status-schedule`). Who reports: every active project's managers (`managers`) and the members of the
 * group `groupKey` who are a manager or member of the project.
 */
export const statusScheduleInputSchema = z
  .object({
    enabled: z.boolean().describe('Whether updates are expected and reminded at all'),
    cadence: cadenceSchema.describe('weekly (ISO weeks), biweekly (pairs of ISO weeks) or monthly'),
    dueWeekday: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe('ISO weekday the update is due, 1 = Monday … 5 = Friday; monthly: the last such weekday'),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((tz) => isTimeZone(tz), 'Unknown time zone')
      .describe('IANA time zone the periods and due times are in, e.g. Asia/Taipei'),
    managers: z.boolean().describe("Every active project's managers report"),
    groupKey: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .nullable()
      .describe('Key of the group whose members report on every active project they work on (or null)'),
    remindDaysBefore: z
      .number()
      .int()
      .min(0)
      .max(3)
      .describe('Remind reporters this many days before the due day (0 = on the morning of it)'),
  })
  .refine((v) => !v.enabled || v.managers || Boolean(v.groupKey), {
    message: 'Choose who reports: the project managers, a group, or both',
    path: ['groupKey'],
  });
export type StatusScheduleInput = z.input<typeof statusScheduleInputSchema>;

export const reportingPeriodSchema = z.object({
  key: z.string(),
  cadence: cadenceSchema,
  start: dateOnly,
  end: dateOnly,
  due: dateOnly,
  /** The end of the due day in the schedule's time zone. */
  dueAt: dateTime,
  /** The end of the period: a missing update is missed after this. */
  closesAt: dateTime,
});
export type ReportingPeriodDto = z.input<typeof reportingPeriodSchema>;

export const statusScheduleSchema = z.object({
  enabled: z.boolean(),
  cadence: cadenceSchema,
  dueWeekday: z.number().int(),
  timeZone: z.string(),
  managers: z.boolean(),
  groupKey: z.string().nullable(),
  /** The group, when it exists (null when the key names no group). */
  group: z.object({ id: z.uuid(), key: z.string(), name: z.string() }).nullable(),
  remindDaysBefore: z.number().int(),
  current: reportingPeriodSchema,
  next: reportingPeriodSchema,
  updatedAt: dateTime.nullable(),
  updatedBy: personSchema.nullable(),
  canManage: z.boolean(),
});
export type StatusSchedule = z.input<typeof statusScheduleSchema>;

/** What the plan said about the project when an update was sent (kept so past reports stay the same). */
export const projectSignalsSchema = z.object({
  targetDate: dateOnly.nullable(),
  openTasks: z.number().int(),
  overdueTasks: z.number().int(),
  blockedTasks: z.number().int(),
  overdueMilestones: z.number().int(),
  progress: z.number().int(),
  nextMilestone: z.object({ name: z.string(), dueDate: dateOnly.nullable() }).nullable(),
});
export type ProjectSignalsDto = z.input<typeof projectSignalsSchema>;

const updateText = (max: number) => z.string().trim().max(max);

/** Fields of a status update. Optional ones are `nullish` without defaults, so the PATCH schema can be partial. */
const statusUpdateFields = {
  status: projectHealthSchema.describe('on_track, at_risk or off_track'),
  progress: z.number().int().min(0).max(100).nullish().describe('Share of the work done, 0–100'),
  forecastDate: dateOnly.nullish().describe('When the project is now expected to finish (YYYY-MM-DD)'),
  summary: updateText(2_000).min(1).describe('Where the project stands, in a few sentences'),
  done: updateText(4_000).nullish().describe('What was done this period (Markdown)'),
  next: updateText(4_000).nullish().describe('What comes next (Markdown)'),
  blockers: updateText(4_000).nullish().describe('Blockers and risks (Markdown)'),
  asks: updateText(2_000).nullish().describe('Help or decisions needed, and from whom (Markdown)'),
  /** Set when the text started from "Draft for me" (shown with the update). */
  draftMode: draftModeSchema.nullish(),
};
export const statusUpdateInputSchema = z.object(statusUpdateFields);
export type StatusUpdateInput = z.input<typeof statusUpdateInputSchema>;
export const statusUpdatePatchSchema = z.object(statusUpdateFields).partial();
export type StatusUpdatePatch = z.input<typeof statusUpdatePatchSchema>;

export const statusUpdateSchema = z.object({
  id: z.uuid(),
  project: projectRefSchema,
  author: personSchema.nullable(),
  /** The author manages the project (their update sets its health). */
  byManager: z.boolean(),
  period: z.object({ key: z.string(), start: dateOnly, end: dateOnly }),
  dueAt: dateTime,
  closesAt: dateTime,
  state: statusUpdateStateSchema,
  standing: updateStandingSchema,
  /** Owed by the reporting schedule (false: posted without being asked). */
  expected: z.boolean(),
  status: projectHealthSchema.nullable(),
  progress: z.number().int().nullable(),
  forecastDate: dateOnly.nullable(),
  summary: z.string().nullable(),
  done: z.string().nullable(),
  next: z.string().nullable(),
  blockers: z.string().nullable(),
  asks: z.string().nullable(),
  signals: projectSignalsSchema.nullable(),
  draftMode: draftModeSchema.nullable(),
  submittedAt: dateTime.nullable(),
  editedAt: dateTime.nullable(),
  /** The caller wrote it and its period is still open. */
  canEdit: z.boolean(),
});
export type StatusUpdate = z.input<typeof statusUpdateSchema>;

export const statusUpdateHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/** A project's Updates tab: the open period's expected and sent updates, the caller's own, and the history. */
export const projectStatusUpdatesSchema = z.object({
  period: reportingPeriodSchema,
  scheduleEnabled: z.boolean(),
  /** This period's updates, expected (pending) and sent. */
  current: z.array(statusUpdateSchema),
  /** The caller's update for this period (pending when it is owed and not yet sent). */
  mine: statusUpdateSchema.nullable(),
  /** The caller may post (or send their owed) update for this period. */
  canPost: z.boolean(),
  history: z.object({
    items: z.array(statusUpdateSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
});
export type ProjectStatusUpdates = z.input<typeof projectStatusUpdatesSchema>;

/** Compliance: who sent their update for a period (PMO and portfolio readers). */
export const complianceQuerySchema = listQuerySchema.extend({
  period: z.string().trim().max(10).optional(),
  standing: updateStandingSchema.optional(),
  /** Project key. */
  project: z.string().trim().max(10).optional(),
});
export const complianceSchema = z.object({
  period: reportingPeriodSchema,
  previousKey: z.string(),
  /** Null for the open period. */
  nextKey: z.string().nullable(),
  counts: z.object({
    expected: z.number().int(),
    submitted: z.number().int(),
    late: z.number().int(),
    due: z.number().int(),
    overdue: z.number().int(),
    missed: z.number().int(),
  }),
  items: z.array(statusUpdateSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type Compliance = z.input<typeof complianceSchema>;

const draftTask = z.object({
  reference: z.string(),
  title: z.string(),
  dueDate: dateOnly.nullable(),
  assignee: z.string().nullable(),
});

/** "Draft for me": a proposed update from the period's facts (nothing is stored). */
export const statusDraftSchema = z.object({
  mode: draftModeSchema,
  model: z.string().nullable(),
  /** The model was asked but failed; the builtin draft is shown instead. */
  fallback: z.boolean(),
  period: reportingPeriodSchema,
  draft: z.object({
    status: projectHealthSchema,
    progress: z.number().int().nullable(),
    forecastDate: dateOnly.nullable(),
    summary: z.string(),
    done: z.string().nullable(),
    next: z.string().nullable(),
    blockers: z.string().nullable(),
    asks: z.string().nullable(),
  }),
  sources: z.object({
    done: z.array(draftTask),
    started: z.array(draftTask),
    overdue: z.array(draftTask),
    blocked: z.array(draftTask),
    milestones: z.array(z.object({ name: z.string(), dueDate: dateOnly.nullable(), done: z.boolean() })),
    meetings: z.array(
      z.object({ reference: z.string(), title: z.string(), href: z.string(), startsAt: dateTime }),
    ),
  }),
});
export type StatusDraft = z.input<typeof statusDraftSchema>;

/* ── report templates ── */

const sectionId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Lowercase letters, digits and dashes')
  .describe('Unique within the template, e.g. "delayed"');
const sectionTitle = localizedTextSchema
  .nullish()
  .describe('Heading in en, zh-TW and ja-JP; null = the default');

export const reportSectionSchema = z.discriminatedUnion('type', [
  z.object({
    id: sectionId,
    type: z.literal('summary').describe('A short narrative of the period (written by the AI, or builtin)'),
    title: sectionTitle,
    instructions: z
      .string()
      .trim()
      .max(1_000)
      .nullish()
      .describe('Extra instructions for the AI writing the summary, e.g. "focus on customer impact"'),
  }),
  z.object({
    id: sectionId,
    type: z.literal('counts').describe('How many projects are in each state'),
    title: sectionTitle,
  }),
  z.object({
    id: sectionId,
    type: z.literal('projects').describe('Projects in the given states'),
    title: sectionTitle,
    states: z.array(reportStateSchema).min(1).max(REPORT_STATES.length),
    detail: z
      .enum(PROJECT_DETAILS)
      .describe('table: one row each; brief: one line each; full: the merged update of each project'),
  }),
  z.object({
    id: sectionId,
    type: z.literal('blockers').describe('Blockers and risks, grouped'),
    title: sectionTitle,
  }),
  z.object({
    id: sectionId,
    type: z.literal('asks').describe('Help or decisions needed'),
    title: sectionTitle,
  }),
  z.object({
    id: sectionId,
    type: z.literal('milestones').describe('Milestones due in the next days, and overdue ones'),
    title: sectionTitle,
    days: z.number().int().min(7).max(90),
  }),
  z.object({
    id: sectionId,
    type: z.literal('missing').describe('Updates not received'),
    title: sectionTitle,
  }),
  z.object({
    id: sectionId,
    type: z.literal('decisions').describe("Decisions of the projects' meetings in the period"),
    title: sectionTitle,
  }),
]);
export type ReportSection = z.input<typeof reportSectionSchema>;

/** A report template as the admin page and the customisation kind `projects.report-template` write it. */
export const reportTemplateInputSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(REPORT_TEMPLATE_KEY_RE, 'Lowercase letters, digits and dashes, starting with a letter')
    .describe('Unique slug, e.g. "board-monthly"; cannot change once created'),
  name: localizedTextSchema.describe('Name in en, zh-TW and ja-JP'),
  description: localizedTextSchema.nullish().describe('One line on who the report is for'),
  sections: z
    .array(reportSectionSchema)
    .min(1)
    .max(MAX_REPORT_SECTIONS)
    .refine((list) => new Set(list.map((s) => s.id)).size === list.length, 'Section ids must be unique')
    .describe('The report, top to bottom'),
  sortOrder: z.number().int().min(0).max(10_000).nullish().describe('Order in the template picker'),
});
export type ReportTemplateInput = z.input<typeof reportTemplateInputSchema>;

export const reportTemplateSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  sections: z.array(reportSectionSchema),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  updatedAt: dateTime,
});
export type ReportTemplate = z.input<typeof reportTemplateSchema>;

export const reportTemplateQuerySchema = z.object({ archived: z.stringbool().optional() });

/* ── the status report ── */

export const REPORT_SCOPES = ['all', 'mine', 'department'] as const;
export const reportScopeSchema = z.enum(REPORT_SCOPES);

export const statusReportQuerySchema = z.object({
  /** A period key of the schedule's cadence (default: the open period). */
  period: z.string().trim().max(10).optional(),
  /** Template id or key (default: the first one). */
  template: z.string().trim().max(64).optional(),
  scope: reportScopeSchema.optional(),
  department: z.uuid().optional(),
});
export type StatusReportQuery = z.input<typeof statusReportQuerySchema>;

export const reportUpdateSchema = z.object({
  id: z.uuid(),
  author: personSchema.nullable(),
  byManager: z.boolean(),
  status: projectHealthSchema,
  progress: z.number().int().nullable(),
  forecastDate: dateOnly.nullable(),
  summary: z.string(),
  done: z.string().nullable(),
  next: z.string().nullable(),
  blockers: z.string().nullable(),
  asks: z.string().nullable(),
  submittedAt: dateTime,
  late: z.boolean(),
});

export const reportProjectSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  href: z.string(),
  status: projectStatusSchema,
  manager: personSchema.nullable(),
  department: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  state: reportStateSchema,
  reasons: z.array(stateReasonSchema),
  /** The updates say better than the plan does. */
  mismatch: z.boolean(),
  reported: projectHealthSchema.nullable(),
  targetDate: dateOnly.nullable(),
  forecastDate: dateOnly.nullable(),
  progress: z.number().int().nullable(),
  signals: projectSignalsSchema.nullable(),
  updates: z.array(reportUpdateSchema),
  /** Reporters whose update for the period never came (or hasn't yet). */
  missing: z.array(personSchema),
});
export type ReportProject = z.input<typeof reportProjectSchema>;

export const narrativeItemSchema = z.object({ text: z.string(), projects: z.array(z.string()) });

/** The text a template asks for, written by the AI (or builtin) from exactly what the reader sees. */
export const narrativeSchema = z.object({
  /** `pending`: the AI is writing it (poll); `none`: the template needs none. */
  state: z.enum(['ready', 'pending', 'failed', 'none']),
  mode: draftModeSchema.nullable(),
  model: z.string().nullable(),
  generatedAt: dateTime.nullable(),
  summary: z.string().nullable(),
  projects: z.record(
    z.string(),
    z.object({
      brief: z.string().nullable(),
      done: z.string().nullable(),
      next: z.string().nullable(),
      blockers: z.string().nullable(),
    }),
  ),
  blockers: z.array(narrativeItemSchema),
  asks: z.array(narrativeItemSchema),
});
export type Narrative = z.input<typeof narrativeSchema>;

export const reportMilestoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  dueDate: dateOnly.nullable(),
  overdue: z.boolean(),
  project: projectRefSchema,
});

export const reportDecisionSchema = z.object({
  text: z.string(),
  projects: z.array(z.string()),
  meeting: z.object({ reference: z.string(), title: z.string(), href: z.string(), startsAt: dateTime }),
});

export const statusReportSchema = z.object({
  period: reportingPeriodSchema,
  /** The open period (signals are live) rather than a past one (signals from the updates). */
  current: z.boolean(),
  previousKey: z.string(),
  nextKey: z.string().nullable(),
  today: dateOnly,
  scope: z.object({
    kind: reportScopeSchema,
    department: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  }),
  template: reportTemplateSchema,
  templates: z.array(z.object({ id: z.uuid(), key: z.string(), name: localizedTextSchema })),
  counts: z.object({
    total: z.number().int(),
    delayed: z.number().int(),
    at_risk: z.number().int(),
    on_track: z.number().int(),
    no_update: z.number().int(),
    completed: z.number().int(),
    mismatches: z.number().int(),
    expected: z.number().int(),
    submitted: z.number().int(),
    missing: z.number().int(),
  }),
  projects: z.array(reportProjectSchema),
  /** More projects matched than a report holds; the rest are left out. */
  truncated: z.boolean(),
  milestones: z.array(reportMilestoneSchema).nullable(),
  /** Null when the template has no decisions section or meetings are not available. */
  decisions: z.array(reportDecisionSchema).nullable(),
  narrative: narrativeSchema,
  generatedAt: dateTime,
});
export type StatusReport = z.input<typeof statusReportSchema>;

/** Scheduled Jobs task `projects.status-report`: tell people the report is ready. */
export const statusReportTaskConfigSchema = z
  .object({
    template: z
      .string()
      .trim()
      .regex(REPORT_TEMPLATE_KEY_RE)
      .describe('Key of the report template, e.g. "executive"'),
    scope: z.enum(['all', 'department']).default('all'),
    departmentId: z.uuid().nullish().describe('With scope "department": the department'),
    period: z
      .enum(['current', 'previous'])
      .default('previous')
      .describe('The period the run falls in, or the one before it (a Monday run reporting last week)'),
    groupKeys: z.array(z.string().trim().min(1).max(100)).max(20).default([]).describe('Groups to tell'),
    userIds: z.array(z.uuid()).max(100).default([]).describe('People to tell'),
  })
  .refine((c) => c.groupKeys.length > 0 || c.userIds.length > 0, {
    message: 'Choose at least one group or person',
    path: ['groupKeys'],
  })
  .refine((c) => c.scope !== 'department' || Boolean(c.departmentId), {
    message: 'Choose the department',
    path: ['departmentId'],
  });
export type StatusReportTaskConfig = z.input<typeof statusReportTaskConfigSchema>;

/* ── AI tools (status) ── */

export const aiStatusReportInput = z.object({
  period: z
    .enum(['current', 'previous'])
    .default('current')
    .describe('The open reporting period, or the one before it'),
  scope: z.enum(['all', 'mine']).default('all').describe('All projects the caller can see, or only theirs'),
});
export const aiPostStatusUpdateInput = statusUpdateInputSchema.omit({ draftMode: true }).extend({
  project: z.string().trim().min(1).max(200).describe('Project key (NET) or (part of) its name'),
});
