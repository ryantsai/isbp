import { z } from 'zod';
import {
  type Condition,
  conditionSchema,
  evaluateCondition,
  type LocalizedText,
  localizedTextSchema,
} from './conditions';

/*
 * Workflows are a structured tree of steps (sequence → approval | parallel | condition | notify), so
 * every graph the builder can produce is valid by construction. The interpreter below is a pure
 * function of (graph, state, facts): the API drives instances with it and the builder simulates
 * paths with the very same code.
 */

/* ───────────────────────────── approvers ───────────────────────────── */

export const APPROVER_TYPES = [
  'user',
  'group',
  'role',
  'manager',
  'department-head',
  'fact',
  'requester',
] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];

/**
 * Who should act. Each rule of an approval step is one **slot**; a group or role slot is satisfied by
 * any one of its members. `fallback` applies when the rule resolves to nobody (after the requester
 * is excluded), e.g. "the role owner, or the IAM team when the role has no owner".
 */
export type ApproverRule =
  | { type: 'user'; userId: string; fallback?: ApproverRule }
  | { type: 'group'; groupKey: string; fallback?: ApproverRule }
  | { type: 'role'; roleKey: string; fallback?: ApproverRule }
  /** The subject person's manager; `level: 2` = the manager's manager. */
  | { type: 'manager'; level?: number; fallback?: ApproverRule }
  /** Manager of the subject person's department. */
  | { type: 'department-head'; fallback?: ApproverRule }
  /** A user id taken from the facts, e.g. `role.ownerId` or a form's "approver" field. */
  | { type: 'fact'; fact: string; fallback?: ApproverRule }
  /** Only for notify steps. */
  | { type: 'requester' };

export interface SlaPolicy {
  /** Hours until the task is overdue. */
  dueHours: number;
  /** Hours until a reminder is sent (must be below `dueHours`). */
  remindHours?: number;
  /** What happens when the task is overdue. */
  onBreach: 'notify' | 'escalate' | 'approve' | 'reject';
  /** Approvers added to the open slots on `escalate`. */
  escalateTo?: ApproverRule[];
}

/* ───────────────────────────── steps ───────────────────────────── */

interface BaseStep {
  id: string;
  name: LocalizedText;
  /** The step is skipped unless this holds. */
  when?: Condition;
}

export interface ApprovalStep extends BaseStep {
  type: 'approval';
  approvers: ApproverRule[];
  /** `any`: first answer decides · `all`: every slot must approve · `quorum`: N slots approve. */
  mode: 'any' | 'all' | 'quorum';
  quorum?: number;
  /** Approvers may hand their task to someone else (default true). */
  allowDelegation?: boolean;
  /** The requester may approve their own request (default false — segregation of duties). */
  allowSelfApproval?: boolean;
  /** When no approver resolves at all (default `reject`). */
  ifNoApprover?: 'reject' | 'skip';
  sla?: SlaPolicy;
  /** Shown to approvers. */
  instructions?: LocalizedText;
}

export interface Branch {
  id: string;
  name: LocalizedText;
  steps: WorkflowStep[];
}

export interface ConditionBranch extends Branch {
  when: Condition;
}

/** Branches run at the same time; the step completes when every branch is approved. */
export interface ParallelStep extends BaseStep {
  type: 'parallel';
  branches: Branch[];
}

/** The first branch whose condition holds runs, otherwise the default branch. */
export interface ConditionStep extends BaseStep {
  type: 'condition';
  branches: ConditionBranch[];
  otherwise: Branch;
}

/** FYI notification — no decision. */
export interface NotifyStep extends BaseStep {
  type: 'notify';
  recipients: ApproverRule[];
  message?: LocalizedText;
}

export type WorkflowStep = ApprovalStep | ParallelStep | ConditionStep | NotifyStep;
export type StepType = WorkflowStep['type'];

export interface WorkflowGraph {
  steps: WorkflowStep[];
}

/* ───────────────────────────── schemas ───────────────────────────── */

const stepId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const factPath = z.string().regex(/^[a-zA-Z_][\w-]*(\.[a-zA-Z_][\w-]*){0,5}$/);

export const approverRuleSchema: z.ZodType<ApproverRule, ApproverRule> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), userId: z.uuid(), fallback: approverRuleSchema.optional() }),
    z.object({
      type: z.literal('group'),
      groupKey: z.string().min(1).max(64),
      fallback: approverRuleSchema.optional(),
    }),
    z.object({
      type: z.literal('role'),
      roleKey: z.string().min(1).max(100),
      fallback: approverRuleSchema.optional(),
    }),
    z.object({
      type: z.literal('manager'),
      level: z.number().int().min(1).max(5).optional(),
      fallback: approverRuleSchema.optional(),
    }),
    z.object({ type: z.literal('department-head'), fallback: approverRuleSchema.optional() }),
    z.object({ type: z.literal('fact'), fact: factPath, fallback: approverRuleSchema.optional() }),
    z.object({ type: z.literal('requester') }),
  ]),
);

const slaSchema = z.object({
  dueHours: z
    .number()
    .min(0.25)
    .max(24 * 90),
  remindHours: z
    .number()
    .min(0.25)
    .max(24 * 90)
    .optional(),
  onBreach: z.enum(['notify', 'escalate', 'approve', 'reject']),
  escalateTo: z.array(approverRuleSchema).max(10).optional(),
});

const base = { id: stepId, name: localizedTextSchema, when: conditionSchema.optional() };

export const workflowStepSchema: z.ZodType<WorkflowStep, WorkflowStep> = z.lazy(() => {
  const branch = z.object({
    id: stepId,
    name: localizedTextSchema,
    steps: z.array(workflowStepSchema).max(50),
  });
  return z.discriminatedUnion('type', [
    z.object({
      ...base,
      type: z.literal('approval'),
      approvers: z.array(approverRuleSchema).max(20),
      mode: z.enum(['any', 'all', 'quorum']),
      quorum: z.number().int().min(1).max(20).optional(),
      allowDelegation: z.boolean().optional(),
      allowSelfApproval: z.boolean().optional(),
      ifNoApprover: z.enum(['reject', 'skip']).optional(),
      sla: slaSchema.optional(),
      instructions: localizedTextSchema.optional(),
    }),
    z.object({ ...base, type: z.literal('parallel'), branches: z.array(branch).max(10) }),
    z.object({
      ...base,
      type: z.literal('condition'),
      branches: z.array(branch.extend({ when: conditionSchema })).max(10),
      otherwise: branch,
    }),
    z.object({
      ...base,
      type: z.literal('notify'),
      recipients: z.array(approverRuleSchema).max(20),
      message: localizedTextSchema.optional(),
    }),
  ]);
});

export const workflowGraphSchema: z.ZodType<WorkflowGraph, WorkflowGraph> = z.object({
  steps: z.array(workflowStepSchema).max(50),
});

/* ───────────────────────────── traversal ───────────────────────────── */

/** Child sequences of a step (branches of parallel/condition steps). */
export function childBranches(step: WorkflowStep): Branch[] {
  if (step.type === 'parallel') return step.branches;
  if (step.type === 'condition') return [...step.branches, step.otherwise];
  return [];
}

/** Every step in the graph, depth first, with its nesting depth. */
export function walkSteps(
  steps: readonly WorkflowStep[],
  depth = 0,
): { step: WorkflowStep; depth: number }[] {
  return steps.flatMap((step) => [
    { step, depth },
    ...childBranches(step).flatMap((b) => walkSteps(b.steps, depth + 1)),
  ]);
}

export function findStep(graph: WorkflowGraph, id: string): WorkflowStep | undefined {
  return walkSteps(graph.steps).find((s) => s.step.id === id)?.step;
}

/** Short random id for new steps and branches. */
export function newStepId(prefix = 's'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replaceAll('-', '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

/* ───────────────────────────── validation ───────────────────────────── */

export type WorkflowIssueCode =
  | 'empty'
  | 'noApprovers'
  | 'quorumInvalid'
  | 'requesterApprover'
  | 'escalationTargets'
  | 'remindAfterDue'
  | 'noBranches'
  | 'noRecipients'
  | 'duplicateId'
  | 'tooDeep'
  | 'tooManySteps';

export interface WorkflowIssue {
  stepId: string | null;
  code: WorkflowIssueCode;
}

export const MAX_WORKFLOW_DEPTH = 5;
export const MAX_WORKFLOW_STEPS = 100;

/** Semantic checks beyond the schema. A graph must have no issues before it can be published. */
export function validateWorkflowGraph(graph: WorkflowGraph): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const all = walkSteps(graph.steps);
  if (!graph.steps.length) issues.push({ stepId: null, code: 'empty' });
  if (all.length > MAX_WORKFLOW_STEPS) issues.push({ stepId: null, code: 'tooManySteps' });
  const ids = new Set<string>();
  const seen = (id: string) => {
    if (ids.has(id)) issues.push({ stepId: id, code: 'duplicateId' });
    ids.add(id);
  };
  for (const { step, depth } of all) {
    seen(step.id);
    childBranches(step).forEach((b) => seen(b.id));
    if (depth >= MAX_WORKFLOW_DEPTH) issues.push({ stepId: step.id, code: 'tooDeep' });
    switch (step.type) {
      case 'approval': {
        if (!step.approvers.length) issues.push({ stepId: step.id, code: 'noApprovers' });
        if (step.approvers.some((r) => r.type === 'requester'))
          issues.push({ stepId: step.id, code: 'requesterApprover' });
        if (step.mode === 'quorum' && (!step.quorum || step.quorum > step.approvers.length))
          issues.push({ stepId: step.id, code: 'quorumInvalid' });
        if (step.sla?.onBreach === 'escalate' && !step.sla.escalateTo?.length)
          issues.push({ stepId: step.id, code: 'escalationTargets' });
        if (step.sla?.escalateTo?.some((r) => r.type === 'requester'))
          issues.push({ stepId: step.id, code: 'requesterApprover' });
        if (step.sla?.remindHours !== undefined && step.sla.remindHours >= step.sla.dueHours)
          issues.push({ stepId: step.id, code: 'remindAfterDue' });
        break;
      }
      case 'parallel':
        if (step.branches.length < 2) issues.push({ stepId: step.id, code: 'noBranches' });
        break;
      case 'condition':
        if (!step.branches.length) issues.push({ stepId: step.id, code: 'noBranches' });
        break;
      case 'notify':
        if (!step.recipients.length) issues.push({ stepId: step.id, code: 'noRecipients' });
        break;
    }
  }
  return issues;
}

/* ───────────────────────────── interpreter ───────────────────────────── */

export type StepStatus = 'active' | 'approved' | 'rejected' | 'skipped';

export interface StepState {
  status: StepStatus;
  /** Chosen branch of a condition step. */
  branch?: string;
  /** Why a step was skipped or rejected without a decision. */
  reason?: 'condition' | 'no-approver' | 'cancelled';
}

export interface WorkflowState {
  steps: Record<string, StepState>;
}

export type WorkflowOutcome = 'running' | 'approved' | 'rejected';

export interface AdvanceResult {
  state: WorkflowState;
  outcome: WorkflowOutcome;
  /** Approval steps that just became active — the engine creates their tasks. */
  activated: ApprovalStep[];
  /** Notify steps reached in this pass. */
  notifications: NotifyStep[];
  /** Steps skipped by their `when` condition in this pass. */
  skipped: WorkflowStep[];
  /** Branch choices made in this pass. */
  branches: { stepId: string; branchId: string }[];
}

export const emptyWorkflowState = (): WorkflowState => ({ steps: {} });

type Run = 'approved' | 'rejected' | 'waiting';

/**
 * Moves an instance forward as far as it can go without a human decision. Deterministic and
 * side-effect free: call it after starting an instance and after every step decision.
 */
export function advanceWorkflow(graph: WorkflowGraph, prev: WorkflowState, facts: unknown): AdvanceResult {
  const state: WorkflowState = { steps: { ...prev.steps } };
  const result: Omit<AdvanceResult, 'state' | 'outcome'> = {
    activated: [],
    notifications: [],
    skipped: [],
    branches: [],
  };

  const sequence = (steps: readonly WorkflowStep[]): Run => {
    for (const step of steps) {
      const r = run(step);
      if (r !== 'approved') return r;
    }
    return 'approved';
  };

  const run = (step: WorkflowStep): Run => {
    let st = state.steps[step.id];
    if (st?.status === 'approved' || st?.status === 'skipped') return 'approved';
    if (st?.status === 'rejected') return 'rejected';
    if (!st) {
      if (step.when && !evaluateCondition(step.when, facts)) {
        state.steps[step.id] = { status: 'skipped', reason: 'condition' };
        result.skipped.push(step);
        return 'approved';
      }
      if (step.type === 'approval') {
        state.steps[step.id] = { status: 'active' };
        result.activated.push(step);
        return 'waiting';
      }
      if (step.type === 'notify') {
        state.steps[step.id] = { status: 'approved' };
        result.notifications.push(step);
        return 'approved';
      }
      if (step.type === 'condition') {
        const chosen = step.branches.find((b) => evaluateCondition(b.when, facts)) ?? step.otherwise;
        st = { status: 'active', branch: chosen.id };
        result.branches.push({ stepId: step.id, branchId: chosen.id });
      } else {
        st = { status: 'active' };
      }
      state.steps[step.id] = st;
    }
    if (step.type === 'approval') return 'waiting';
    if (step.type === 'notify') return 'approved';

    let r: Run;
    if (step.type === 'parallel') {
      // Every branch runs (no short-circuit) so each one activates its first step.
      const runs = step.branches.map((b) => sequence(b.steps));
      r = runs.includes('rejected')
        ? 'rejected'
        : runs.every((x) => x === 'approved')
          ? 'approved'
          : 'waiting';
    } else {
      const branch = step.branches.find((b) => b.id === st!.branch) ?? step.otherwise;
      r = sequence(branch.steps);
    }
    if (r !== 'waiting') state.steps[step.id] = { ...state.steps[step.id]!, status: r };
    return r;
  };

  const r = sequence(graph.steps);
  return { state, outcome: r === 'waiting' ? 'running' : r, ...result };
}

export type SlotOutcome = 'pending' | 'approved' | 'rejected';

/** Outcome of an approval step from its slots' outcomes. */
export function decideStep(
  step: Pick<ApprovalStep, 'mode' | 'quorum'>,
  slots: readonly SlotOutcome[],
): SlotOutcome {
  const n = slots.length;
  if (!n) return 'approved';
  const approved = slots.filter((s) => s === 'approved').length;
  const rejected = slots.filter((s) => s === 'rejected').length;
  if (step.mode === 'any') return approved ? 'approved' : rejected ? 'rejected' : 'pending';
  if (step.mode === 'all') return rejected ? 'rejected' : approved === n ? 'approved' : 'pending';
  const q = Math.min(Math.max(1, step.quorum ?? 1), n);
  if (approved >= q) return 'approved';
  if (rejected > n - q) return 'rejected';
  return 'pending';
}

export interface SimulationResult {
  outcome: Exclude<WorkflowOutcome, 'running'>;
  state: WorkflowState;
  /** Step ids in the order they were reached. */
  order: string[];
}

/**
 * Runs a graph to completion with every approval decided by `decide` (default: approve). Used by the
 * builder's "test this workflow" panel and by tests.
 */
export function simulateWorkflow(
  graph: WorkflowGraph,
  facts: unknown,
  decide: (step: ApprovalStep) => 'approved' | 'rejected' = () => 'approved',
): SimulationResult {
  let state = emptyWorkflowState();
  const order: string[] = [];
  for (let i = 0; i < MAX_WORKFLOW_STEPS * 2; i++) {
    const r = advanceWorkflow(graph, state, facts);
    state = r.state;
    for (const s of [...r.skipped, ...r.notifications, ...r.activated])
      if (!order.includes(s.id)) order.push(s.id);
    for (const b of r.branches) if (!order.includes(b.stepId)) order.push(b.stepId);
    if (r.outcome !== 'running') return { outcome: r.outcome, state, order };
    for (const step of r.activated) state.steps[step.id] = { status: decide(step) };
  }
  return { outcome: 'rejected', state, order };
}

/* ───────────────────────────── facts ───────────────────────────── */

export type FactType = 'string' | 'number' | 'boolean' | 'date' | 'id' | 'list';

export interface FactDef {
  path: string;
  type: FactType;
  options?: string[];
  description?: string;
}

interface JsonSchemaNode {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  anyOf?: JsonSchemaNode[];
  items?: JsonSchemaNode;
}

/** Flattens a trigger's facts JSON Schema into pickable paths for condition builders. */
export function factsFromJsonSchema(schema: unknown, prefix = '', depth = 0): FactDef[] {
  const node = schema as JsonSchemaNode | undefined;
  if (!node || depth > 4) return [];
  const variants = node.anyOf?.filter((v) => v.type !== 'null');
  if (variants?.length === 1)
    return factsFromJsonSchema({ ...variants[0], description: node.description }, prefix, depth);
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== 'null') : node.type;
  if (type === 'object' && node.properties) {
    return Object.entries(node.properties).flatMap(([key, child]) =>
      factsFromJsonSchema(child, prefix ? `${prefix}.${key}` : key, depth + 1),
    );
  }
  if (!prefix) return [];
  const fact: FactDef = { path: prefix, type: 'string' };
  if (node.enum) fact.options = node.enum.filter((v) => v !== null).map(String);
  if (type === 'number' || type === 'integer') fact.type = 'number';
  else if (type === 'boolean') fact.type = 'boolean';
  else if (type === 'array') fact.type = 'list';
  else if (node.format === 'date-time' || node.format === 'date') fact.type = 'date';
  else if (node.format === 'uuid') fact.type = 'id';
  if (node.description) fact.description = node.description;
  return [fact];
}
