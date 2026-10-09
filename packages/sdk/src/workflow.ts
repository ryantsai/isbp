import { z } from 'zod';
import {
  type Condition,
  conditionFacts,
  conditionSchema,
  evaluateCondition,
  type LocalizedText,
  localizedTextSchema,
} from './conditions';
import {
  type FieldDef,
  fieldDefSchema,
  FIELD_KEY_RE,
  type FieldValidationResult,
  validateFields,
} from './fields';

/*
 * Workflows are a structured tree of steps (sequence → approval | parallel | condition | notify), so
 * every graph the builder can produce is valid by construction. The interpreter below is a pure
 * function of (graph, state, facts): the API drives instances with it and the builder simulates
 * paths with the very same code.
 */

/* ───────────────────────────── approvers ───────────────────────────── */

/** What an approver fact holds: user ids (default) or group keys. */
export const FACT_APPROVER_KINDS = ['user', 'group'] as const;
export type FactApproverKind = (typeof FACT_APPROVER_KINDS)[number];

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
  /**
   * People named by a fact: a user id (or a list of them), e.g. `role.ownerId` or a form's "approver" field. With
   * `kind: 'group'` the fact holds a group key (or a list) whose members approve, e.g. `records.ci.ownerGroup`.
   * `each`: one approval per value (with the step's mode `all`, every group or person in the list must approve —
   * e.g. the owner group of each picked CI); without it, any of them answers for all.
   */
  | { type: 'fact'; fact: string; kind?: FactApproverKind; each?: boolean; fallback?: ApproverRule }
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
  /**
   * Fields the approver fills in with the decision (the "filled in by IT" part of a paper form: evaluation result,
   * handling notes, completion date). Validated like form answers, stored with the decision, shown on the request,
   * and facts `steps.<stepId>.<key>` for later steps' conditions and approver rules and for process actions.
   */
  fields?: FieldDef[];
  /** When the required `fields` must be filled in: to approve only (default), or to reject too. */
  fieldsRequiredOn?: StepFieldsRequiredOn;
}

/** At most this many fields per approval step. */
export const MAX_STEP_FIELDS = 20;
export const STEP_FIELDS_REQUIRED_ON = ['approve', 'both'] as const;
export type StepFieldsRequiredOn = (typeof STEP_FIELDS_REQUIRED_ON)[number];
/** Root of the facts that hold approvers' step field values: `steps.<stepId>.<key>`. */
export const STEP_FACTS_ROOT = 'steps';

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

/**
 * What a later approval step does with a person who already approved an earlier step of the same instance: `ask`
 * asks them again; `skip` counts that earlier approval, so they are not asked (the engine records it as approved,
 * with the reason). Rejections never count, and neither do approvals made by nobody (SLA auto-decisions).
 */
export const REPEAT_APPROVER_POLICIES = ['ask', 'skip'] as const;
export type RepeatApproverPolicy = (typeof REPEAT_APPROVER_POLICIES)[number];

export interface WorkflowGraph {
  steps: WorkflowStep[];
  /** Absent means `ask`. */
  repeatApprovers?: RepeatApproverPolicy;
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
    z.object({
      type: z.literal('fact'),
      fact: factPath,
      kind: z.enum(FACT_APPROVER_KINDS).optional(),
      each: z.boolean().optional(),
      fallback: approverRuleSchema.optional(),
    }),
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

/** An approval step's `fields`: the shared field model, at most {@link MAX_STEP_FIELDS}, with unique keys. */
export const stepFieldsSchema: z.ZodType<FieldDef[], FieldDef[]> = z
  .array(fieldDefSchema)
  .max(MAX_STEP_FIELDS)
  .superRefine((fields, ctx) => {
    const keys = new Set<string>();
    fields.forEach((f, i) => {
      if (keys.has(f.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: 'Duplicate field key' });
      keys.add(f.key);
    });
  });

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
      fields: stepFieldsSchema.optional(),
      fieldsRequiredOn: z.enum(STEP_FIELDS_REQUIRED_ON).optional(),
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
  repeatApprovers: z.enum(REPEAT_APPROVER_POLICIES).optional(),
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

/**
 * Approval steps that may have been decided when step `stepId` starts: the steps before it in its own sequence and in
 * every enclosing one, with everything nested in them — never the ones after it or in parallel branches beside it.
 * Their field values (`steps.<id>.<key>`) are what the step's conditions and approver rules can read.
 */
export function stepsBefore(graph: WorkflowGraph, stepId: string): ApprovalStep[] {
  const visit = (seq: readonly WorkflowStep[], before: readonly WorkflowStep[]): WorkflowStep[] | null => {
    for (const [i, step] of seq.entries()) {
      const earlier = [...before, ...seq.slice(0, i)];
      if (step.id === stepId) return earlier;
      for (const b of childBranches(step)) {
        const found = visit(b.steps, earlier);
        if (found) return found;
      }
    }
    return null;
  };
  return walkSteps(visit(graph.steps, []) ?? [])
    .map((s) => s.step)
    .filter((s): s is ApprovalStep => s.type === 'approval');
}

/** `steps.<stepId>.<key>` → `{ stepId, key }`; null for any other fact path. */
export function parseStepFact(path: string): { stepId: string; key: string } | null {
  const [root, stepId, key, ...rest] = path.split('.');
  return root === STEP_FACTS_ROOT && stepId && key && !rest.length ? { stepId, key } : null;
}

/**
 * The fields an approver fills in for this decision. Required fields count only when the step asks for them on this
 * decision (`fieldsRequiredOn`: approving only by default, or rejecting too); otherwise they are optional.
 */
export function stepDecisionFields(
  step: Pick<ApprovalStep, 'fields' | 'fieldsRequiredOn'>,
  decision: 'approve' | 'reject',
): FieldDef[] {
  const fields = step.fields ?? [];
  if (decision === 'approve' || step.fieldsRequiredOn === 'both') return fields;
  return fields.map((f) => (f.required ? { ...f, required: false } : f));
}

/**
 * Validates the values an approver gives with a decision — the same `validateFields` as form answers, in the browser
 * and the API (hidden conditional fields are dropped). People and records are checked further by the API.
 */
export function validateStepFields(
  step: Pick<ApprovalStep, 'fields' | 'fieldsRequiredOn'>,
  decision: 'approve' | 'reject',
  input: Record<string, unknown> | null | undefined,
): FieldValidationResult {
  return validateFields(stepDecisionFields(step, decision), input ?? {});
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
  | 'tooManySteps'
  /** A condition or approver rule reads `steps.<id>.<key>` of a step that isn't before it, or a field it lacks. */
  | 'stepFact'
  /** A step field shows depending on an unknown field or on itself, or has an invalid default. */
  | 'stepFields';

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
        if (step.fields?.length && !stepFieldsValid(step.fields))
          issues.push({ stepId: step.id, code: 'stepFields' });
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
    const stepFacts = factsReadBy(step)
      .map(parseStepFact)
      .filter((x) => x !== null);
    if (stepFacts.length) {
      const earlier = new Map(stepsBefore(graph, step.id).map((s) => [s.id, s]));
      if (stepFacts.some((f) => !earlier.get(f.stepId)?.fields?.some((x) => x.key === f.key)))
        issues.push({ stepId: step.id, code: 'stepFact' });
    }
  }
  return issues;
}

/** Fact paths a step reads when it starts: its `when`, its branches' conditions and its "from a fact" rules. */
export function factsReadBy(step: WorkflowStep): string[] {
  const out = [...conditionFacts(step.when)];
  const rule = (r: ApproverRule) => {
    if (r.type === 'fact') out.push(r.fact);
    if ('fallback' in r && r.fallback) rule(r.fallback);
  };
  if (step.type === 'condition') step.branches.forEach((b) => out.push(...conditionFacts(b.when)));
  if (step.type === 'approval') [...step.approvers, ...(step.sla?.escalateTo ?? [])].forEach(rule);
  if (step.type === 'notify') step.recipients.forEach(rule);
  return out;
}

/** Step fields as the form builder would save them: conditions on sibling fields only, valid defaults. */
function stepFieldsValid(fields: readonly FieldDef[]): boolean {
  const keys = new Set(fields.map((f) => f.key));
  return fields.every((f) => {
    const reads = conditionFacts(f.visibleWhen).map((k) => k.split('.')[0] ?? '');
    if (reads.some((k) => k === f.key || !keys.has(k))) return false;
    const dv = f.defaultValue;
    if (
      f.type === 'user' ||
      f.type === 'record' ||
      dv === undefined ||
      dv === null ||
      dv === '' ||
      (Array.isArray(dv) && !dv.length) ||
      !FIELD_KEY_RE.test(f.key)
    )
      return true;
    return validateFields([{ ...f, required: false, visibleWhen: undefined }], { [f.key]: dv }).ok;
  });
}

/* ───────────────────────────── interpreter ───────────────────────────── */

export type StepStatus = 'active' | 'approved' | 'rejected' | 'skipped';

export interface StepState {
  status: StepStatus;
  /** Chosen branch of a condition step. */
  branch?: string;
  /** Why a step was skipped or rejected without a decision; `already-approved`: its approvals were counted from earlier steps. */
  reason?: 'condition' | 'no-approver' | 'cancelled' | 'already-approved';
  /** `already-approved`: the earlier approval step whose approval counted. */
  from?: string;
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

/**
 * Earlier approvals that count again (`repeatApprovers: 'skip'`), applied to a step's slots. `repeat` maps a person to
 * the approval step they already approved. A slot one of whose people is in it is satisfied by that approval: those
 * people are `counted` (recorded as approved, not asked), and nobody else in the slot is asked. `outcome` is the
 * step's result from its slots (`decideStep`); when it is approved, nobody is asked at all, otherwise `asked` are the
 * people of the slots that are not satisfied yet.
 */
export function splitRepeatApprovers<A extends { userId: string }>(
  step: Pick<ApprovalStep, 'mode' | 'quorum'>,
  slots: readonly { slot: number; assignees: readonly A[] }[],
  repeat: ReadonlyMap<string, string>,
): {
  counted: { slot: number; assignee: A; fromStepId: string }[];
  asked: { slot: number; assignee: A }[];
  outcome: SlotOutcome;
} {
  const hits = (s: { assignees: readonly A[] }) => s.assignees.filter((a) => repeat.has(a.userId));
  const outcome: SlotOutcome = slots.length
    ? decideStep(
        step,
        slots.map((s) => (hits(s).length ? 'approved' : 'pending')),
      )
    : 'pending';
  const counted = slots.flatMap((s) =>
    hits(s).map((assignee) => ({ slot: s.slot, assignee, fromStepId: repeat.get(assignee.userId)! })),
  );
  const asked =
    outcome === 'approved'
      ? []
      : slots
          .filter((s) => !hits(s).length)
          .flatMap((s) => s.assignees.map((assignee) => ({ slot: s.slot, assignee })));
  return { counted, asked, outcome };
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
/**
 * What the simulator decides for a step: approve, reject, or that the step's approver is someone who already approved
 * the earlier approval step `alreadyApprovedAt`. The last one counts only with `repeatApprovers: 'skip'` and only for
 * an approval step before this one; otherwise the step is simply approved.
 */
export type SimulatedDecision = 'approved' | 'rejected' | { alreadyApprovedAt: string };

function decidedState(graph: WorkflowGraph, step: ApprovalStep, decision: SimulatedDecision): StepState {
  if (typeof decision === 'string') return { status: decision };
  const from =
    graph.repeatApprovers === 'skip'
      ? stepsBefore(graph, step.id).find((s) => s.id === decision.alreadyApprovedAt)
      : undefined;
  return from ? { status: 'approved', reason: 'already-approved', from: from.id } : { status: 'approved' };
}

export function simulateWorkflow(
  graph: WorkflowGraph,
  facts: unknown,
  decide: (step: ApprovalStep) => SimulatedDecision = () => 'approved',
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
    for (const step of r.activated) state.steps[step.id] = decidedState(graph, step, decide(step));
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
  /** i18n key of the fact's name, from `.meta({ label })` on the Zod schema (e.g. `cmdb.recordFacts.criticality`). */
  label?: string;
  /** i18n key prefix of its values (`<valueLabels>.<value>`), from `.meta({ valueLabels })` (e.g. `cmdb.criticality`). */
  valueLabels?: string;
  /** What the fact names, from `.meta({ ref })`: people (user ids) or groups (group keys) — for approver rules. */
  ref?: FactApproverKind;
}

/** Builder hints a facts schema may carry with `.meta({ label, valueLabels, ref })` (they reach the JSON Schema). */
export interface FactMeta {
  label?: string;
  valueLabels?: string;
  ref?: FactApproverKind;
}

interface JsonSchemaNode extends FactMeta {
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
    return factsFromJsonSchema(
      {
        ...variants[0],
        description: node.description ?? variants[0]!.description,
        label: node.label ?? variants[0]!.label,
        valueLabels: node.valueLabels ?? variants[0]!.valueLabels,
        ref: node.ref ?? variants[0]!.ref,
      },
      prefix,
      depth,
    );
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
  if (typeof node.label === 'string') fact.label = node.label;
  if (typeof node.valueLabels === 'string') fact.valueLabels = node.valueLabels;
  if (node.ref === 'user' || node.ref === 'group') fact.ref = node.ref;
  if (!fact.options && type === 'array' && node.items?.enum)
    fact.options = node.items.enum.filter((v) => v !== null).map(String);
  return [fact];
}
