import { dateTime } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  MEMBER_ROLES,
  MILESTONE_STATUSES,
  PROJECT_HEALTHS,
  PROJECT_KEY_RE,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
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
