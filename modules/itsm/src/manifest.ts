import { defineManifest, type WorkflowGraph } from '@isbp/sdk';
import { z } from 'zod';
import {
  aiAddCommentInput,
  aiCreateTicketInput,
  aiFindTicketsInput,
  aiMyTicketsInput,
  aiResolveTicketInput,
  aiTicketRef,
  aiTriageTicketInput,
  changeTypeSchema,
  resolutionCodeSchema,
  riskSchema,
  ticketStatusSchema,
  ticketTypeSchema,
} from './contracts';

const ticketRef = z.object({
  ticketId: z.uuid(),
  reference: z.string(),
  type: ticketTypeSchema,
  title: z.string(),
});

const fact = (key: string) => `itsm.recordFacts.${key}`;

/**
 * Approval facts of a ticket (`itsm.ticket`: incidents, service requests, problems) picked in a record field, for
 * workflows (`records.<field>.<fact>`) and record-field filters. People are user ids, groups are group keys.
 */
export const ticketFactsSchema = z.object({
  type: ticketTypeSchema.meta({ label: fact('type'), valueLabels: 'itsm.types' }),
  status: ticketStatusSchema.meta({ label: fact('status'), valueLabels: 'itsm.status' }),
  priority: z
    .number()
    .int()
    .min(1)
    .max(4)
    .meta({ label: fact('priority') }),
  impact: z
    .number()
    .int()
    .min(1)
    .max(3)
    .meta({ label: fact('impact') }),
  urgency: z
    .number()
    .int()
    .min(1)
    .max(3)
    .meta({ label: fact('urgency') }),
  major: z.boolean().meta({ label: fact('major') }),
  category: z
    .string()
    .nullable()
    .meta({ label: fact('category') }),
  groupKey: z
    .string()
    .nullable()
    .meta({ label: fact('groupKey'), ref: 'group' }),
  assigneeId: z
    .uuid()
    .nullable()
    .meta({ label: fact('assigneeId'), ref: 'user' }),
  requesterId: z
    .uuid()
    .nullable()
    .meta({ label: fact('requesterId'), ref: 'user' }),
  departmentCode: z
    .string()
    .nullable()
    .meta({ label: fact('departmentCode') }),
});
export type TicketFacts = z.infer<typeof ticketFactsSchema>;

/** Approval facts of a change (`itsm.change`): the ticket's, plus the change type, risk and window. */
export const changeRecordFactsSchema = ticketFactsSchema.extend({
  changeType: changeTypeSchema.meta({ label: fact('changeType'), valueLabels: 'itsm.changeType' }),
  risk: riskSchema.meta({ label: fact('risk'), valueLabels: 'itsm.risk' }),
  plannedStart: z.iso
    .datetime()
    .nullable()
    .meta({ label: fact('plannedStart') }),
  plannedEnd: z.iso
    .datetime()
    .nullable()
    .meta({ label: fact('plannedEnd') }),
});
export type ChangeRecordFacts = z.infer<typeof changeRecordFactsSchema>;

/**
 * Facts the CAB workflow decides on (`change.type`, `change.risk`, …). The ticket's custom fields come along as
 * `attributes.<key>` and `records.<key>.<fact>` (`customFieldEntity` on the trigger), hence `loose()`.
 */
export const changeFacts = z
  .object({
    change: z.object({
      type: changeTypeSchema,
      risk: riskSchema,
      impact: z.number().int().min(1).max(3).describe('1 high … 3 low'),
      ciCount: z.number().int(),
      /** Planned window in hours. */
      durationHours: z.number().nullable(),
      criticalCis: z.boolean().describe('Touches a CI with criticality "critical"'),
    }),
  })
  .loose();

/**
 * Facts the optional resolution sign-off (`itsm.resolution`) decides on: what kind of ticket is being resolved and
 * how. Admins scope the workflow with conditions on them (e.g. `ticket.category` = an "equipment anomaly" category).
 * The ticket's custom fields come along as `attributes.<key>` and `records.<key>.<fact>`, hence `loose()`.
 */
export const resolutionFacts = z
  .object({
    ticket: z.object({
      type: ticketTypeSchema,
      category: z.string().nullable().describe('Category key'),
      priority: z.number().int().min(1).max(4).describe('1 critical … 4 low'),
      impact: z.number().int().min(1).max(3).describe('1 high … 3 low'),
      urgency: z.number().int().min(1).max(3).describe('1 high … 3 low'),
      major: z.boolean().describe('A major incident'),
      groupKey: z.string().nullable().describe('Key of the assignment group'),
      resolutionCode: resolutionCodeSchema,
      ciCount: z.number().int(),
      ciCriticality: z
        .enum(['critical', 'high', 'medium', 'low'])
        .nullable()
        .describe('Highest criticality of the affected CIs'),
      criticalCis: z.boolean().describe('Touches a CI with criticality "critical"'),
    }),
  })
  .loose();

/**
 * Change authorization: standard changes are pre-approved; emergencies go to the emergency CAB (any
 * member, 4h SLA); normal changes need the change manager and, when risky or touching critical CIs, the
 * Change Advisory Board.
 */
const changeGraph: WorkflowGraph = {
  steps: [
    {
      id: 'route',
      type: 'condition',
      name: { en: 'Route by change type', 'zh-TW': '依變更類型分流', 'ja-JP': '変更の種類で振り分け' },
      branches: [
        {
          id: 'emergency',
          name: { en: 'Emergency change', 'zh-TW': '緊急變更', 'ja-JP': '緊急変更' },
          when: { fact: 'change.type', op: 'eq', value: 'emergency' },
          steps: [
            {
              id: 'ecab',
              type: 'approval',
              name: { en: 'Emergency CAB', 'zh-TW': '緊急變更諮詢委員會', 'ja-JP': '緊急 CAB' },
              approvers: [{ type: 'group', groupKey: 'cab' }],
              mode: 'any',
              sla: {
                dueHours: 4,
                remindHours: 2,
                onBreach: 'escalate',
                escalateTo: [{ type: 'role', roleKey: 'itsm-change-manager' }],
              },
            },
          ],
        },
        {
          id: 'normal',
          name: { en: 'Normal change', 'zh-TW': '一般變更', 'ja-JP': '通常変更' },
          when: { fact: 'change.type', op: 'eq', value: 'normal' },
          steps: [
            {
              id: 'change-manager',
              type: 'approval',
              name: { en: 'Change manager', 'zh-TW': '變更經理', 'ja-JP': '変更マネージャー' },
              approvers: [
                {
                  type: 'role',
                  roleKey: 'itsm-change-manager',
                  fallback: { type: 'group', groupKey: 'cab' },
                },
              ],
              mode: 'any',
              sla: { dueHours: 24, remindHours: 12, onBreach: 'notify' },
            },
            {
              id: 'cab',
              type: 'approval',
              name: {
                en: 'Change Advisory Board',
                'zh-TW': '變更諮詢委員會 (CAB)',
                'ja-JP': '変更諮問委員会 (CAB)',
              },
              when: {
                any: [
                  { fact: 'change.risk', op: 'eq', value: 'high' },
                  { fact: 'change.criticalCis', op: 'eq', value: true },
                ],
              },
              approvers: [{ type: 'group', groupKey: 'cab' }],
              mode: 'any',
              sla: { dueHours: 72, remindHours: 48, onBreach: 'notify' },
            },
          ],
        },
      ],
      otherwise: {
        id: 'standard',
        name: {
          en: 'Standard change (pre-approved)',
          'zh-TW': '標準變更（預先核准）',
          'ja-JP': '標準変更 (事前承認済み)',
        },
        steps: [],
      },
    },
  ],
};

/**
 * IT service management (ITIL): incidents, service requests, problems and changes with CAB approval,
 * SLA policies on business calendars and service-catalog fulfilment of Phase 1 forms.
 */
export const manifest = defineManifest({
  id: 'itsm',
  version: '0.1.0',
  name: 'itsm.meta.name',
  description: 'itsm.meta.description',
  icon: 'life-buoy',
  dependsOn: ['cmdb'],
  navigation: [
    {
      id: 'desk',
      label: 'itsm.nav.desk',
      href: '/itsm',
      icon: 'life-buoy',
      permission: 'itsm.tickets.work',
      section: 'main',
      group: 'itsm.nav.group',
      order: 20,
    },
    {
      id: 'problems',
      label: 'itsm.nav.problems',
      href: '/itsm/problems',
      icon: 'bug',
      permission: 'itsm.tickets.read',
      section: 'main',
      group: 'itsm.nav.group',
      order: 21,
    },
    {
      id: 'changes',
      label: 'itsm.nav.changes',
      href: '/itsm/changes',
      icon: 'calendar-clock',
      permission: 'itsm.changes.read',
      section: 'main',
      group: 'itsm.nav.group',
      order: 22,
    },
    {
      id: 'reports',
      label: 'itsm.nav.reports',
      href: '/itsm/reports',
      icon: 'chart-column',
      permission: 'itsm.reports.read',
      section: 'main',
      group: 'itsm.nav.group',
      order: 23,
    },
    {
      id: 'settings',
      label: 'itsm.nav.settings',
      href: '/itsm/settings',
      icon: 'sliders-horizontal',
      permission: 'itsm.config.manage',
      section: 'admin',
      order: 60,
    },
  ],
  permissions: [
    { key: 'itsm.tickets.create', description: 'itsm.permissions.ticketsCreate' },
    {
      key: 'itsm.tickets.read',
      description: 'itsm.permissions.ticketsRead',
      scopes: ['global', 'department'],
    },
    {
      key: 'itsm.tickets.work',
      description: 'itsm.permissions.ticketsWork',
      scopes: ['global', 'department'],
    },
    { key: 'itsm.tickets.triage', description: 'itsm.permissions.ticketsTriage' },
    { key: 'itsm.problems.manage', description: 'itsm.permissions.problemsManage' },
    { key: 'itsm.changes.read', description: 'itsm.permissions.changesRead' },
    { key: 'itsm.changes.manage', description: 'itsm.permissions.changesManage' },
    { key: 'itsm.reports.read', description: 'itsm.permissions.reportsRead' },
    { key: 'itsm.config.manage', description: 'itsm.permissions.configManage' },
    // Phase 5: written by the Integrations Hub's agent (it holds `*.*.sync`), never by a role template.
    { key: 'itsm.tickets.sync', description: 'itsm.permissions.ticketsSync' },
    { key: 'itsm.changes.sync', description: 'itsm.permissions.changesSync' },
  ],
  roles: [
    {
      key: 'itsm-requester',
      name: 'Service desk requester',
      description: 'Report issues and follow your own tickets (granted to everyone by default)',
      permissions: ['itsm.tickets.create'],
      grantByDefault: true,
    },
    {
      key: 'itsm-agent',
      name: 'Service desk agent',
      description: 'Work incidents and service requests; see problems, changes and reports',
      permissions: [
        'itsm.tickets.create',
        'itsm.tickets.read',
        'itsm.tickets.work',
        'itsm.tickets.triage',
        'itsm.changes.read',
        'itsm.reports.read',
      ],
    },
    {
      key: 'itsm-problem-manager',
      name: 'Problem manager',
      description: 'Investigate problems, record root causes and known errors',
      permissions: ['itsm.tickets.*', 'itsm.problems.manage', 'itsm.changes.read', 'itsm.reports.read'],
    },
    {
      key: 'itsm-change-viewer',
      name: 'Change viewer',
      description:
        'See changes and the change calendar, e.g. for release managers who link releases to their changes',
      permissions: ['itsm.changes.read'],
    },
    {
      key: 'itsm-change-manager',
      name: 'Change manager',
      description: 'Raise, assess and schedule changes; approves normal changes',
      permissions: ['itsm.tickets.create', 'itsm.tickets.read', 'itsm.changes.*', 'itsm.reports.read'],
    },
    {
      key: 'itsm-admin',
      name: 'Service desk administrator',
      description: 'Everything in ITSM, including categories, SLA policies, calendars and the catalog',
      permissions: ['itsm.*'],
    },
  ],
  events: {
    emits: [
      {
        name: 'itsm.ticket.created',
        description: 'A ticket was raised',
        schema: ticketRef.extend({ channel: z.string() }),
      },
      { name: 'itsm.ticket.updated', schema: ticketRef.extend({ changes: z.array(z.string()) }) },
      {
        name: 'itsm.ticket.assigned',
        schema: ticketRef.extend({ assigneeId: z.uuid().nullable(), groupId: z.uuid().nullable() }),
      },
      {
        name: 'itsm.ticket.status_changed',
        schema: ticketRef.extend({ from: ticketStatusSchema, to: ticketStatusSchema }),
      },
      { name: 'itsm.ticket.resolved', schema: ticketRef.extend({ resolutionCode: z.string().nullable() }) },
      { name: 'itsm.ticket.closed', schema: ticketRef },
      { name: 'itsm.ticket.reopened', schema: ticketRef },
      { name: 'itsm.ticket.commented', schema: ticketRef.extend({ public: z.boolean() }) },
      {
        name: 'itsm.ticket.triaged',
        schema: ticketRef.extend({ by: z.enum(['ai', 'agent']), fields: z.array(z.string()) }),
      },
      {
        name: 'itsm.sla.warning',
        schema: ticketRef.extend({ metric: z.enum(['response', 'resolution']), dueAt: z.string() }),
      },
      {
        name: 'itsm.sla.breached',
        schema: ticketRef.extend({ metric: z.enum(['response', 'resolution']), dueAt: z.string() }),
      },
      { name: 'itsm.change.submitted', schema: ticketRef.extend({ instanceId: z.uuid().nullable() }) },
      { name: 'itsm.change.approved', schema: ticketRef },
      { name: 'itsm.change.rejected', schema: ticketRef.extend({ comment: z.string().nullable() }) },
      {
        name: 'itsm.change.acceptance_recorded',
        description:
          "The change's requester accepted it, or reported a problem, in the post-implementation review",
        schema: ticketRef.extend({ accepted: z.boolean() }),
      },
      {
        name: 'itsm.ticket.sign_off_requested',
        description: 'Resolving the ticket started its resolution sign-off (itsm.resolution)',
        schema: ticketRef.extend({ instanceId: z.uuid(), to: ticketStatusSchema }),
      },
      { name: 'itsm.problem.known_error', schema: ticketRef },
    ],
    consumes: [
      'core.form-submission.created',
      'core.form-submission.completed',
      'core.user.offboarded',
      // Re-indexes resolved tickets for similar-ticket search (own events).
      'itsm.ticket.resolved',
      'itsm.ticket.closed',
    ],
  },
  settings: [
    {
      key: 'autoCloseDays',
      label: 'itsm.settings.autoCloseDays',
      description: 'itsm.settings.autoCloseDaysHelp',
      type: 'number',
      default: 5,
    },
    {
      key: 'defaultGroupKey',
      label: 'itsm.settings.defaultGroupKey',
      description: 'itsm.settings.defaultGroupKeyHelp',
      type: 'string',
      default: 'service-desk',
    },
    { key: 'csatEnabled', label: 'itsm.settings.csatEnabled', type: 'boolean', default: true },
    {
      key: 'changes.requireAcceptance',
      label: 'itsm.settings.requireAcceptance',
      description: 'itsm.settings.requireAcceptanceHelp',
      type: 'boolean',
      default: false,
    },
    {
      key: 'majorIncidentBroadcast',
      label: 'itsm.settings.majorIncidentBroadcast',
      description: 'itsm.settings.majorIncidentBroadcastHelp',
      type: 'boolean',
      default: true,
      advanced: true,
    },
  ],
  ai: {
    tools: [
      {
        name: 'itsm.find_tickets',
        description:
          'Search service desk tickets (incidents, requests, problems, changes) the caller can read, by text, status or type. Returns compact summaries with references like INC-00042.',
        input: aiFindTicketsInput,
        permission: 'itsm.tickets.read',
        readOnly: true,
      },
      {
        name: 'itsm.get_ticket',
        description:
          'Get one ticket by id or reference (e.g. INC-00042) with its description, classification, assignment, resolution and latest timeline entries.',
        input: aiTicketRef,
        permission: 'itsm.tickets.read',
        readOnly: true,
      },
      {
        name: 'itsm.my_tickets',
        description:
          "List the caller's own tickets (ones they reported or that were raised for them) with status, for answering 'what is happening with my request'.",
        input: aiMyTicketsInput,
        permission: 'itsm.tickets.create',
        readOnly: true,
      },
      {
        name: 'itsm.create_ticket',
        description:
          'Raise an incident (something is broken) or a service request (the caller needs something) on behalf of the caller. Use a short specific title and put details, steps tried and error messages in the description.',
        input: aiCreateTicketInput,
        permission: 'itsm.tickets.create',
      },
      {
        name: 'itsm.add_comment',
        description:
          'Add a comment to a ticket: public replies are visible to the requester; set public=false for an internal work note (agents only).',
        input: aiAddCommentInput,
        permission: 'itsm.tickets.create',
      },
      {
        name: 'itsm.get_triage_options',
        description:
          'List the ticket categories (with their default assignment group) and the assignment groups, to classify and route a ticket.',
        input: z.object({}),
        permission: 'itsm.tickets.triage',
        readOnly: true,
      },
      {
        name: 'itsm.triage_ticket',
        description:
          'Set the category, impact, urgency and assignment of a ticket. By default only fills fields that are still empty, so an agent’s choices are never overwritten; records the confidence and rationale in the timeline.',
        input: aiTriageTicketInput,
        permission: 'itsm.tickets.triage',
      },
      {
        name: 'itsm.resolve_ticket',
        description:
          'Resolve an incident or fulfil a service request with a resolution code and notes. The requester is notified, so this always requires human confirmation.',
        input: aiResolveTicketInput,
        permission: 'itsm.tickets.work',
        destructive: true,
      },
    ],
  },
  search: { entities: ['ticket'] },
  portal: {
    entries: [
      {
        id: 'report',
        label: 'itsm.portal.report',
        description: 'itsm.portal.reportDescription',
        icon: 'life-buoy',
        href: '/itsm/report',
        permission: 'itsm.tickets.create',
        order: 5,
      },
    ],
  },
  workflows: [
    {
      key: 'itsm.change',
      name: 'itsm.workflows.change.name',
      description: 'itsm.workflows.change.description',
      subject: 'change',
      facts: changeFacts,
      customFieldEntity: 'itsm.ticket',
      required: true,
      defaultGraph: changeGraph,
    },
    {
      // Optional: bind a workflow (with conditions) to have a manager sign off resolutions before they take effect.
      key: 'itsm.resolution',
      name: 'itsm.workflows.resolution.name',
      description: 'itsm.workflows.resolution.description',
      subject: 'ticket',
      facts: resolutionFacts,
      customFieldEntity: 'itsm.ticket',
    },
  ],
  notifications: [
    { type: 'itsm.ticket.created', defaultChannels: ['inApp'] },
    { type: 'itsm.ticket.assigned', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.ticket.commented', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.ticket.resolved', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.ticket.reopened', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.sla.warning', defaultChannels: ['inApp'] },
    { type: 'itsm.sla.breached', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.change.approved', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.change.rejected', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.change.acceptance_requested', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.change.accepted', defaultChannels: ['inApp'] },
    { type: 'itsm.change.problem_reported', defaultChannels: ['inApp', 'email'] },
    { type: 'itsm.ticket.sign_off_rejected', defaultChannels: ['inApp', 'email'] },
    /** Broadcast to subscribed Teams/Slack channels when a major incident is declared. */
    { type: 'itsm.major-incident.declared' },
  ],
  customFields: { entities: [{ type: 'ticket', name: 'itsm.entities.ticket' }] },
  /**
   * Kept in step with other systems by the Integrations Hub (adapters in `server/sync.ts`): incidents,
   * service requests and problems as `ticket`, changes as `change`. Status follows the state machines;
   * a change only passes `authorization` through its CAB approval in ISBP.
   */
  syncEntities: [
    {
      entity: 'ticket',
      name: 'itsm.sync.entities.ticket',
      icon: 'life-buoy',
      permission: 'itsm.tickets.sync',
      events: [
        'itsm.ticket.created',
        'itsm.ticket.updated',
        'itsm.ticket.assigned',
        'itsm.ticket.status_changed',
        'itsm.ticket.triaged',
      ],
      commentEvents: ['itsm.ticket.commented'],
    },
    {
      entity: 'change',
      name: 'itsm.sync.entities.change',
      icon: 'calendar-clock',
      permission: 'itsm.changes.sync',
      events: [
        'itsm.ticket.created',
        'itsm.ticket.updated',
        'itsm.ticket.assigned',
        'itsm.ticket.status_changed',
      ],
      commentEvents: ['itsm.ticket.commented'],
    },
  ],
  records: {
    types: [
      {
        type: 'ticket',
        name: 'itsm.entities.ticket',
        icon: 'life-buoy',
        permission: 'itsm.tickets.read',
        facts: ticketFactsSchema,
      },
      {
        type: 'change',
        name: 'itsm.entities.change',
        icon: 'calendar-clock',
        permission: 'itsm.changes.read',
        facts: changeRecordFactsSchema,
      },
    ],
  },
  /** What request forms can do here after they are sent or decided (handlers in `server/process-actions.ts`). */
  processActions: [
    {
      action: 'create-change',
      name: 'itsm.processActions.createChange.name',
      description: 'itsm.processActions.createChange.description',
      icon: 'calendar-clock',
      permission: 'itsm.changes.manage',
    },
    {
      action: 'create-ticket',
      name: 'itsm.processActions.createTicket.name',
      description: 'itsm.processActions.createTicket.description',
      icon: 'life-buoy',
      permission: 'itsm.config.manage',
    },
  ],
  customizations: [
    {
      kind: 'category',
      label: 'itsm.customizations.category',
      description:
        'A ticket category: key, name in each language, parent category, the ticket types it is offered for and the group new tickets are routed to. Live on apply; archiving deactivates it.',
      icon: 'folder-tree',
      readPermission: 'itsm.config.manage',
      applyPermission: 'itsm.config.manage',
      operations: ['create', 'update', 'archive'],
    },
    {
      kind: 'sla-policy',
      label: 'itsm.customizations.slaPolicy',
      description:
        'An SLA policy: response and resolution targets per priority for some ticket types, an optional condition on ticket facts, the business calendar they are measured on and the statuses that pause them. Applies to tickets raised afterwards; archiving deactivates it.',
      icon: 'timer',
      readPermission: 'itsm.config.manage',
      applyPermission: 'itsm.config.manage',
      operations: ['create', 'update', 'archive'],
    },
    {
      kind: 'catalog-item',
      label: 'itsm.customizations.catalogItem',
      description:
        'A service catalog item: how the service desk fulfils a published request form (identified by its form key) — the category, group and priority of the service request it opens, and whether it opens on submission or after approval. Live on apply.',
      icon: 'store',
      readPermission: 'itsm.config.manage',
      applyPermission: 'itsm.config.manage',
      operations: ['create', 'update', 'delete'],
    },
  ],
});
