import { defineManifest, type WorkflowGraph } from '@isbp/sdk';
import { z } from 'zod';
import {
  aiCreateTaskInput,
  aiFindTasksInput,
  aiMyTasksInput,
  aiProjectStatusInput,
  aiUpdateTaskStatusInput,
  PERMISSIONS,
  projectHealthSchema,
  projectPrioritySchema,
  projectStatusSchema,
  taskStatusSchema,
} from './contracts';

/**
 * Default threshold of the proposal workflow (hours of planned effort). The `proposalThresholdHours`
 * setting must match the literal in {@link proposalGraph}: the setting drives the UI hint, the workflow
 * decides. Admins who change one change the other (Administration → Workflows).
 */
export const PROPOSAL_THRESHOLD_HOURS = 400;

const projectRef = z.object({ projectId: z.uuid(), key: z.string(), name: z.string() });
const taskRef = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  reference: z.string(),
  title: z.string(),
});

/** Facts the proposal workflow decides on. */
export const proposalFacts = z.object({
  project: z.object({
    budgetHours: z.number().describe('Planned effort in hours (0 when not estimated)'),
    priority: projectPrioritySchema,
    departmentId: z.uuid().nullable(),
    memberCount: z.number().int(),
  }),
});

/**
 * Proposal approval: projects over the threshold need the owner's manager (or, when the owner has no
 * manager, the PMO); smaller ones are approved automatically.
 */
const proposalGraph: WorkflowGraph = {
  steps: [
    {
      id: 'size',
      type: 'condition',
      name: { en: 'Route by planned effort', 'zh-TW': '依預估工時分流', 'ja-JP': '予定工数で振り分け' },
      branches: [
        {
          id: 'large',
          name: {
            en: `More than ${PROPOSAL_THRESHOLD_HOURS} hours`,
            'zh-TW': `超過 ${PROPOSAL_THRESHOLD_HOURS} 小時`,
            'ja-JP': `${PROPOSAL_THRESHOLD_HOURS} 時間超`,
          },
          when: { fact: 'project.budgetHours', op: 'gt', value: PROPOSAL_THRESHOLD_HOURS },
          steps: [
            {
              id: 'manager',
              type: 'approval',
              name: { en: "Owner's manager", 'zh-TW': '負責人的主管', 'ja-JP': '責任者の上長' },
              approvers: [{ type: 'manager', fallback: { type: 'role', roleKey: 'projects-pmo' } }],
              mode: 'any',
              sla: { dueHours: 72, remindHours: 48, onBreach: 'notify' },
              instructions: {
                en: 'Check the scope, budget and timing before the project starts.',
                'zh-TW': '專案啟動前，請確認範圍、預算與時程。',
                'ja-JP': 'プロジェクト開始前に、範囲・予算・スケジュールを確認してください。',
              },
            },
          ],
        },
      ],
      otherwise: {
        id: 'small',
        name: {
          en: 'Within the threshold (approved automatically)',
          'zh-TW': '未超過門檻（自動核准）',
          'ja-JP': 'しきい値以内 (自動承認)',
        },
        steps: [],
      },
    },
  ],
};

/**
 * Project management for IT: projects, tasks, milestones, a Kanban board, a Gantt timeline with
 * dependencies and workload. Links to tickets, changes, CIs and releases go through `ctx.records`.
 */
export const manifest = defineManifest({
  id: 'projects',
  version: '0.1.0',
  name: 'projects.meta.name',
  description: 'projects.meta.description',
  icon: 'folder-kanban',
  dependsOn: [],
  navigation: [
    {
      id: 'portfolio',
      label: 'projects.nav.portfolio',
      href: '/projects',
      icon: 'folder-kanban',
      permission: PERMISSIONS.use,
      section: 'main',
      group: 'projects.nav.group',
      order: 52,
    },
    {
      id: 'my-tasks',
      label: 'projects.nav.myTasks',
      href: '/projects/my-tasks',
      icon: 'list-todo',
      permission: PERMISSIONS.use,
      section: 'main',
      group: 'projects.nav.group',
      order: 53,
    },
  ],
  permissions: [
    { key: PERMISSIONS.use, description: 'projects.permissions.use' },
    { key: PERMISSIONS.create, description: 'projects.permissions.create' },
    { key: PERMISSIONS.portfolio, description: 'projects.permissions.portfolioRead' },
    { key: PERMISSIONS.admin, description: 'projects.permissions.admin' },
    // Phase 5: written by the Integrations Hub's agent (it holds `*.*.sync`), never by a role template.
    { key: 'projects.projects.sync', description: 'projects.permissions.projectsSync' },
    { key: 'projects.tasks.sync', description: 'projects.permissions.tasksSync' },
  ],
  roles: [
    {
      key: 'projects-member',
      name: 'Project member',
      description: 'See internal projects and work on tasks of the projects you belong to',
      permissions: [PERMISSIONS.use],
      grantByDefault: true,
    },
    {
      key: 'projects-manager',
      name: 'Project manager',
      description: 'Create projects and manage the ones you lead',
      permissions: [PERMISSIONS.use, PERMISSIONS.create],
    },
    {
      key: 'projects-pmo',
      name: 'Project management office',
      description: 'See every project (including private ones), create projects and approve large proposals',
      permissions: [PERMISSIONS.use, PERMISSIONS.create, PERMISSIONS.portfolio],
    },
    {
      key: 'projects-admin',
      name: 'Projects administrator',
      description: 'Manage any project',
      permissions: ['projects.*'],
    },
  ],
  events: {
    emits: [
      { name: 'projects.project.created', schema: projectRef.extend({ ownerId: z.uuid().nullable() }) },
      { name: 'projects.project.updated', schema: projectRef.extend({ changes: z.array(z.string()) }) },
      {
        name: 'projects.project.status_changed',
        schema: projectRef.extend({ from: projectStatusSchema, to: projectStatusSchema }),
      },
      {
        name: 'projects.project.health_changed',
        schema: projectRef.extend({
          from: projectHealthSchema,
          to: projectHealthSchema,
          note: z.string().nullable(),
        }),
      },
      { name: 'projects.project.deleted', schema: projectRef },
      {
        name: 'projects.member.added',
        schema: projectRef.extend({ userId: z.uuid(), role: z.string() }),
      },
      { name: 'projects.member.removed', schema: projectRef.extend({ userId: z.uuid() }) },
      {
        name: 'projects.milestone.completed',
        schema: projectRef.extend({ milestoneId: z.uuid(), milestone: z.string() }),
      },
      { name: 'projects.task.created', schema: taskRef.extend({ assigneeId: z.uuid().nullable() }) },
      { name: 'projects.task.updated', schema: taskRef.extend({ changes: z.array(z.string()) }) },
      {
        name: 'projects.task.status_changed',
        schema: taskRef.extend({ from: taskStatusSchema, to: taskStatusSchema }),
      },
      {
        name: 'projects.task.assigned',
        schema: taskRef.extend({ assigneeId: z.uuid().nullable(), previousId: z.uuid().nullable() }),
      },
      { name: 'projects.task.commented', schema: taskRef.extend({ commentId: z.uuid() }) },
      { name: 'projects.task.deleted', schema: taskRef },
    ],
    consumes: ['core.user.offboarded'],
  },
  settings: [
    {
      key: 'hoursPerWeek',
      label: 'projects.settings.hoursPerWeek',
      description: 'projects.settings.hoursPerWeekHelp',
      type: 'number',
      default: 40,
    },
    {
      key: 'proposalThresholdHours',
      label: 'projects.settings.proposalThresholdHours',
      description: 'projects.settings.proposalThresholdHoursHelp',
      type: 'number',
      default: PROPOSAL_THRESHOLD_HOURS,
      advanced: true,
    },
  ],
  ai: {
    tools: [
      {
        name: 'projects.my_tasks',
        description:
          "List the caller's tasks across projects (open by default) with reference (e.g. NET-12), project, status, priority and due date. Use it for 'what am I working on' or 'what is due this week'.",
        input: aiMyTasksInput,
        permission: PERMISSIONS.use,
        readOnly: true,
      },
      {
        name: 'projects.find_tasks',
        description:
          'Search project tasks the caller can see by text, project (key such as NET or name), assignee ("me" or an email) and status (a status, "open" or "closed"). Returns compact summaries with references like ERP-7.',
        input: aiFindTasksInput,
        permission: PERMISSIONS.use,
        readOnly: true,
      },
      {
        name: 'projects.create_task',
        description:
          'Create a task in a project the caller is a member of (project key such as NET, or its exact name). Optionally assign it to a project member by email, set a due date (YYYY-MM-DD) and a priority.',
        input: aiCreateTaskInput,
        permission: PERMISSIONS.use,
      },
      {
        name: 'projects.update_task_status',
        description:
          'Move a task (reference such as NET-12) to another status: backlog, todo, in_progress, in_review, done or cancelled, with an optional comment. A task cannot start while one of its dependencies is not done.',
        input: aiUpdateTaskStatusInput,
        permission: PERMISSIONS.use,
      },
      {
        name: 'projects.project_status',
        description:
          "Status report of one project (key such as NET, or part of its name): status, health and the manager's note, progress, overdue and blocked tasks, and the next milestones. Good for questions like 'how is the network refresh going?'.",
        input: aiProjectStatusInput,
        permission: PERMISSIONS.use,
        readOnly: true,
      },
    ],
  },
  search: { entities: ['project', 'task'] },
  workflows: [
    {
      key: 'projects.proposal',
      name: 'projects.workflows.proposal.name',
      description: 'projects.workflows.proposal.description',
      subject: 'project',
      facts: proposalFacts,
      required: true,
      defaultGraph: proposalGraph,
    },
  ],
  notifications: [
    { type: 'projects.task.assigned', defaultChannels: ['inApp', 'email'] },
    { type: 'projects.task.commented', defaultChannels: ['inApp'] },
    { type: 'projects.task.due_soon', defaultChannels: ['inApp', 'email'] },
    { type: 'projects.project.health_changed', defaultChannels: ['inApp', 'email'] },
    { type: 'projects.member.added', defaultChannels: ['inApp'] },
    { type: 'projects.proposal.decided', defaultChannels: ['inApp', 'email'] },
  ],
  customFields: {
    entities: [
      { type: 'task', name: 'projects.entities.task' },
      { type: 'project', name: 'projects.entities.project' },
    ],
  },
  /**
   * Kept in step with other systems by the Integrations Hub (adapters in `server/sync.ts`): projects
   * (matched on name; created `proposed`, the proposal approval still decides) and their tasks, with
   * comments.
   */
  syncEntities: [
    {
      entity: 'project',
      name: 'projects.sync.entities.project',
      icon: 'folder-kanban',
      permission: 'projects.projects.sync',
      events: ['projects.project.created', 'projects.project.updated', 'projects.project.status_changed'],
    },
    {
      entity: 'task',
      name: 'projects.sync.entities.task',
      icon: 'list-todo',
      permission: 'projects.tasks.sync',
      events: [
        'projects.task.created',
        'projects.task.updated',
        'projects.task.status_changed',
        'projects.task.assigned',
      ],
      commentEvents: ['projects.task.commented'],
      container: 'projects.project',
    },
  ],
  records: {
    types: [
      {
        type: 'project',
        name: 'projects.entities.project',
        icon: 'folder-kanban',
        permission: PERMISSIONS.use,
      },
      { type: 'task', name: 'projects.entities.task', icon: 'list-todo', permission: PERMISSIONS.use },
    ],
  },
});
