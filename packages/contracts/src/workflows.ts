import {
  listQuerySchema,
  localizedTextSchema,
  STEP_FIELDS_REQUIRED_ON,
  stepFieldsSchema,
  workflowGraphSchema,
} from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id, keySchema } from './common';

/** A person as shown next to approvals, requests and timelines. */
export const personRefSchema = z.object({
  id,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type PersonRef = z.input<typeof personRefSchema>;

export const factDefSchema = z.object({
  path: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'id', 'list']),
  options: z.array(z.string()).optional(),
  description: z.string().optional(),
  /** i18n key of the fact's name (module catalogs), when the schema names one. */
  label: z.string().optional(),
  /** i18n key prefix of its values: `<valueLabels>.<value>`. */
  valueLabels: z.string().optional(),
  /** People (user ids) or groups (group keys): approver rules "a person / a group from a fact" pick these. */
  ref: z.enum(['user', 'group']).optional(),
});
export type FactDefInfo = z.input<typeof factDefSchema>;

export const workflowTriggerSchema = z.object({
  key: z.string(),
  moduleId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  subject: z.string(),
  required: z.boolean(),
  facts: z.array(factDefSchema),
  /**
   * The entity whose custom fields the module passes as facts (`attributes.<key>`, `records.<key>.<fact>`), e.g.
   * `itsm.ticket` — builders list them from its custom fields.
   */
  customFieldEntity: z.string().nullable(),
  defaultDefinition: z.object({ id, name: z.string() }).nullable(),
});
export type WorkflowTrigger = z.input<typeof workflowTriggerSchema>;

export const workflowIssueSchema = z.object({ stepId: z.string().nullable(), code: z.string() });

/** Names of the groups (by key), roles (by key) and people (by id) a graph refers to. */
export const workflowNamesSchema = z.object({
  groups: z.record(z.string(), z.string()),
  roles: z.record(z.string(), z.string()),
  users: z.record(z.string(), z.string()),
});
export type WorkflowNames = z.input<typeof workflowNamesSchema>;

export const workflowDefinitionSummarySchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  triggerKey: z.string(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  publishedVersion: z.number().int().nullable(),
  archived: z.boolean(),
  hasUnpublishedChanges: z.boolean(),
  stepCount: z.number().int(),
  running: z.number().int(),
  updatedAt: dateTime,
  updatedBy: personRefSchema.nullable(),
});
export type WorkflowDefinitionSummary = z.input<typeof workflowDefinitionSummarySchema>;

export const workflowDefinitionSchema = workflowDefinitionSummarySchema.extend({
  draft: workflowGraphSchema,
  published: workflowGraphSchema.nullable(),
  versions: z.array(
    z.object({ version: z.number().int(), publishedAt: dateTime, publishedBy: personRefSchema.nullable() }),
  ),
  issues: z.array(workflowIssueSchema),
  names: workflowNamesSchema,
  usedBy: z.object({
    forms: z.array(z.object({ id, key: z.string(), name: localizedTextSchema })),
    roles: z.array(z.object({ id, key: z.string(), name: z.string() })),
  }),
});
export type WorkflowDefinition = z.input<typeof workflowDefinitionSchema>;

export const workflowListQuerySchema = z.object({
  triggerKey: z.string().max(150).optional(),
  q: z.string().trim().max(200).optional(),
  includeArchived: z.stringbool().default(false),
});

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  triggerKey: z.string().max(150),
  key: keySchema.optional(),
  /** Start from a copy of another definition's draft. */
  copyFromId: id.optional(),
});
export type CreateWorkflowInput = z.input<typeof createWorkflowSchema>;

export const updateWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  draft: workflowGraphSchema.optional(),
});
export type UpdateWorkflowInput = z.input<typeof updateWorkflowSchema>;

/* ───────────── instances ───────────── */

export const instanceStatusSchema = z.enum(['running', 'approved', 'rejected', 'cancelled']);
export type InstanceStatus = z.infer<typeof instanceStatusSchema>;
export const taskStatusSchema = z.enum(['pending', 'approved', 'rejected', 'delegated', 'cancelled']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const approvalTaskSchema = z.object({
  id,
  stepId: z.string(),
  slot: z.number().int(),
  status: taskStatusSchema,
  assignee: personRefSchema,
  delegatedFrom: personRefSchema.nullable(),
  isEscalation: z.boolean(),
  comment: z.string().nullable(),
  /** Values of the step's `fields` the approver filled in with the decision (by field key). */
  data: z.record(z.string(), z.unknown()).nullable(),
  decidedAt: dateTime.nullable(),
  decidedBy: personRefSchema.nullable(),
  dueAt: dateTime.nullable(),
  createdAt: dateTime,
});
export type ApprovalTask = z.input<typeof approvalTaskSchema>;

export const workflowEventSchema = z.object({
  seq: z.number().int(),
  type: z.string(),
  stepId: z.string().nullable(),
  taskId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: dateTime,
});
export type WorkflowEvent = z.input<typeof workflowEventSchema>;

export const stepStateSchema = z.object({
  status: z.enum(['active', 'approved', 'rejected', 'skipped']),
  branch: z.string().optional(),
  reason: z.string().optional(),
});

export const workflowInstanceSummarySchema = z.object({
  id,
  triggerKey: z.string(),
  definition: z.object({ id, key: z.string(), name: z.string() }),
  version: z.number().int(),
  subject: z.object({
    type: z.string(),
    id: z.string(),
    label: localizedTextSchema,
    href: z.string().nullable(),
  }),
  requester: personRefSchema.nullable(),
  subjectUser: personRefSchema.nullable(),
  status: instanceStatusSchema,
  startedAt: dateTime,
  completedAt: dateTime.nullable(),
  outcomeComment: z.string().nullable(),
  /** People who can act right now. */
  pendingWith: z.array(personRefSchema),
  /** Approval steps waiting for a decision. */
  currentSteps: z.array(z.object({ id: z.string(), name: localizedTextSchema })),
});
export type WorkflowInstanceSummary = z.input<typeof workflowInstanceSummarySchema>;

export const workflowInstanceSchema = workflowInstanceSummarySchema.extend({
  graph: workflowGraphSchema,
  names: workflowNamesSchema,
  state: z.object({ steps: z.record(z.string(), stepStateSchema) }),
  facts: z.record(z.string(), z.unknown()),
  tasks: z.array(approvalTaskSchema),
  events: z.array(workflowEventSchema),
  canCancel: z.boolean(),
  /** The viewer's own pending task, if any. */
  myTaskId: z.uuid().nullable(),
});
export type WorkflowInstance = z.input<typeof workflowInstanceSchema>;

export const instanceQuerySchema = listQuerySchema.extend({
  status: instanceStatusSchema.optional(),
  triggerKey: z.string().max(150).optional(),
  definitionId: id.optional(),
});

export const cancelSchema = z.object({ reason: z.string().trim().max(500).nullish() });

/* ───────────── approvals inbox ───────────── */

export const approvalItemSchema = z.object({
  task: approvalTaskSchema,
  instance: workflowInstanceSummarySchema,
  step: z.object({
    id: z.string(),
    name: localizedTextSchema,
    instructions: localizedTextSchema.nullable(),
    mode: z.enum(['any', 'all', 'quorum']),
    allowDelegation: z.boolean(),
    /** Fields the approver fills in with the decision (`ApprovalStep.fields`). */
    fields: stepFieldsSchema,
    /** When required fields must be filled in: to approve only, or to reject too. */
    fieldsRequiredOn: z.enum(STEP_FIELDS_REQUIRED_ON),
  }),
  trigger: z.object({ key: z.string(), name: z.string(), moduleId: z.string() }),
});
export type ApprovalItem = z.input<typeof approvalItemSchema>;

export const approvalQuerySchema = listQuerySchema.extend({
  status: z.enum(['pending', 'done']).default('pending'),
});

export const decisionSchema = z.object({
  comment: z.string().trim().max(2000).nullish(),
  /** Values of the step's `fields`, by field key (validated like form answers). */
  data: z.record(z.string().max(64), z.unknown()).nullish(),
});
export type DecisionInput = z.input<typeof decisionSchema>;
export const delegateTaskSchema = z.object({ userId: id, comment: z.string().trim().max(2000).nullish() });

export const delegationSchema = z.object({
  id,
  delegate: personRefSchema,
  startsAt: dateTime,
  endsAt: dateTime,
  reason: z.string().nullable(),
  active: z.boolean(),
});
export type Delegation = z.input<typeof delegationSchema>;

export const createDelegationSchema = z
  .object({
    delegateId: id,
    startsAt: dateTime,
    endsAt: dateTime,
    reason: z.string().trim().max(300).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.endsAt.getTime() <= v.startsAt.getTime())
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be after the start' });
    if (v.endsAt.getTime() <= Date.now())
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be in the future' });
  });
export type CreateDelegationInput = z.input<typeof createDelegationSchema>;
