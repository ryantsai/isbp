import {
  approvalTasks,
  departments,
  users,
  workflowDefinitions,
  workflowEvents,
  workflowInstances,
  workflowVersions,
} from '@isbp/db/schema';
import {
  advanceWorkflow,
  type ApprovalStep,
  type AuthContext,
  type Db,
  decideStep,
  emptyWorkflowState,
  ErrorCodes,
  findStep,
  getFact,
  HttpError,
  httpErrors,
  type LocalizedText,
  type ModuleContext,
  type NotifyStep,
  type SlotOutcome,
  type StartWorkflowInput,
  splitRepeatApprovers,
  type WorkflowCompletion,
  type WorkflowGraph,
  type WorkflowService,
  type WorkflowStartResult,
  type WorkflowState,
  type WorkflowStep,
  type WorkflowTriggerDef,
  localize,
  STEP_FACTS_ROOT,
  validateStepFields,
  withToday,
} from '@isbp/sdk/server';
import { and, asc, eq, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  type CustomFieldRegistry,
  fieldValidationError,
  verifyRecordFields,
  verifyUserFields,
} from '../fields';
import type { ModuleRegistry } from '../modules';
import type { NotificationCenter } from '../notifications/service';
import { ApproverResolver, type Assignee, type ResolveContext } from './resolve';

export const WORKFLOW_COMPLETED = 'core.workflow.completed';

/** Step field values by step id, as stored in an instance's facts (`steps.<stepId>.<key>`). */
export type StepValues = Record<string, Record<string, unknown>>;

/** The step field values of an instance's facts (`facts.steps`), or `{}`. */
export function stepValuesOf(facts: unknown): StepValues {
  const steps = (facts as Record<string, unknown> | null | undefined)?.[STEP_FACTS_ROOT];
  return steps && typeof steps === 'object' && !Array.isArray(steps) ? (steps as StepValues) : {};
}

/** What approvers filled in on a workflow instance, by step id (empty without an instance). */
export async function instanceStepValues(db: Db, instanceId: string | null | undefined): Promise<StepValues> {
  if (!instanceId) return {};
  const [row] = await db
    .select({ facts: workflowInstances.facts })
    .from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId));
  return stepValuesOf(row?.facts);
}

type InstanceRow = typeof workflowInstances.$inferSelect;
type TaskRow = typeof approvalTasks.$inferSelect;
type Outcome = 'running' | 'approved' | 'rejected';

interface Actor {
  id: string | null;
  name: string;
}

const HOUR = 3_600_000;
const SYSTEM: Actor = { id: null, name: 'system' };

function actorOf(auth: AuthContext | null | undefined): Actor {
  return auth?.user ? { id: auth.user.id, name: auth.user.displayName } : SYSTEM;
}

interface EngineDeps {
  db: Db;
  registry: ModuleRegistry;
  notifications: NotificationCenter;
  logger: FastifyBaseLogger;
  /** Core module context (audit + events), bound after contexts are created. */
  core: () => ModuleContext;
  /** Checks of `record` step fields (readable by the approver, matching `where`), wired to the record registry. */
  fields?: Pick<CustomFieldRegistry, 'readableRecords' | 'recordFacts'>;
}

/**
 * Drives workflow instances with the pure interpreter from the SDK. Every mutation runs in one
 * transaction with the instance row locked (`FOR UPDATE`), so concurrent approvers on parallel steps
 * and the SLA timer can never interleave.
 */
/** `each` fact approvers: one slot per value, numbered from here (plain slots are rule indexes). */
const EACH_SLOT_BASE = 1000;
const MAX_EACH_VALUES = 20;
const EACH_FACT = '__each';

/** The distinct, non-empty values of a fact (a list or a single value), at most `MAX_EACH_VALUES`. */
function factValues(v: unknown): unknown[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
  return [...new Set(list.filter((x) => x !== undefined && x !== null && x !== ''))].slice(
    0,
    MAX_EACH_VALUES,
  );
}

/** Where an approver decides a task: the approvals page with that decision open. */
export const approvalHref = (taskId: string) => `/approvals?task=${taskId}`;

export class WorkflowEngine {
  readonly resolver: ApproverResolver;
  private readonly graphs = new Map<string, WorkflowGraph>();

  constructor(private readonly deps: EngineDeps) {
    this.resolver = new ApproverResolver(deps.db);
  }

  private get db() {
    return this.deps.db;
  }

  /* ───────────── lookups ───────────── */

  trigger(key: string): { moduleId: string; def: WorkflowTriggerDef } | undefined {
    for (const m of this.deps.registry.modules) {
      const def = m.manifest.workflows?.find((w) => w.key === key);
      if (def) return { moduleId: m.manifest.id, def };
    }
    return undefined;
  }

  triggers(): { moduleId: string; def: WorkflowTriggerDef }[] {
    return this.deps.registry.modules.flatMap((m) =>
      (m.manifest.workflows ?? []).map((def) => ({ moduleId: m.manifest.id, def })),
    );
  }

  /** Published graphs are immutable, so they are cached forever per (definition, version). */
  async graph(definitionId: string, version: number, tx: Db = this.db): Promise<WorkflowGraph> {
    const key = `${definitionId}:${version}`;
    const hit = this.graphs.get(key);
    if (hit) return hit;
    const [row] = await tx
      .select({ graph: workflowVersions.graph })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.definitionId, definitionId), eq(workflowVersions.version, version)));
    if (!row) throw new Error(`Workflow version ${key} is missing`);
    this.graphs.set(key, row.graph);
    return row.graph;
  }

  forModule(moduleId: string): WorkflowService {
    return {
      start: (key, input, opts) => this.start(moduleId, key, input, opts?.tx),
      preview: async (key, input) => {
        if (!key.startsWith(`${moduleId}.`))
          throw new Error(`Module "${moduleId}" cannot preview another module's trigger`);
        const p = await this.preview(key, input);
        if (!p) return null;
        const ids = [...new Set(p.steps.flatMap((s) => s.people))];
        const names = new Map<string, string>();
        for (const id of ids) names.set(id, await this.userName(this.db, id));
        return {
          definition: p.definition,
          steps: p.steps.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            // A step whose approvers all approved an earlier step asks nobody: modules see it as skipped.
            outcome: s.outcome === 'already-approved' ? 'skipped' : s.outcome,
            people: s.people.map((id) => ({ id, displayName: names.get(id) ?? id })),
          })),
        };
      },
      cancel: async (instanceId, reason, opts) => {
        const run = async (tx: Db) => {
          const [inst] = await tx
            .select({ moduleId: workflowInstances.moduleId })
            .from(workflowInstances)
            .where(eq(workflowInstances.id, instanceId));
          if (!inst) throw httpErrors.notFound('Workflow instance not found');
          if (inst.moduleId !== moduleId)
            throw new Error(`Module "${moduleId}" cannot cancel another module's workflow`);
          await this.cancelIn(tx, instanceId, reason ?? null, SYSTEM);
        };
        return opts?.tx ? run(opts.tx) : this.db.transaction(run);
      },
      isApprover: async (instanceId, userId) => {
        const [row] = await this.db
          .select({ id: approvalTasks.id })
          .from(approvalTasks)
          .innerJoin(workflowInstances, eq(workflowInstances.id, approvalTasks.instanceId))
          .where(
            and(
              eq(approvalTasks.instanceId, instanceId),
              eq(workflowInstances.moduleId, moduleId),
              sql`(${approvalTasks.assigneeId} = ${userId} or ${approvalTasks.decidedById} = ${userId})`,
            ),
          )
          .limit(1);
        return Boolean(row);
      },
    };
  }

  private async personFacts(tx: Db, userId: string | null) {
    if (!userId) return null;
    const [u] = await tx
      .select({
        id: users.id,
        email: users.email,
        jobTitle: users.jobTitle,
        managerId: users.managerId,
        departmentId: users.departmentId,
        departmentCode: departments.code,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(users.id, userId));
    return u ?? null;
  }

  private async event(
    tx: Db,
    instanceId: string,
    e: {
      type: string;
      stepId?: string | null;
      taskId?: string | null;
      actor?: Actor;
      data?: Record<string, unknown>;
    },
  ) {
    await tx.insert(workflowEvents).values({
      instanceId,
      type: e.type,
      stepId: e.stepId ?? null,
      taskId: e.taskId ?? null,
      actorId: e.actor?.id ?? null,
      actorName: e.actor?.name ?? null,
      data: e.data ?? null,
    });
  }

  private async userName(tx: Db, id: string | null): Promise<string> {
    if (!id) return '';
    const [u] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, id));
    return u?.name ?? '';
  }

  /* ───────────── start ───────────── */

  async start(
    moduleId: string,
    triggerKey: string,
    input: StartWorkflowInput,
    tx?: Db,
  ): Promise<WorkflowStartResult | null> {
    if (!triggerKey.startsWith(`${moduleId}.`))
      throw new Error(`Module "${moduleId}" cannot start foreign workflow trigger "${triggerKey}"`);
    const trigger = this.trigger(triggerKey);
    if (!trigger) throw new Error(`Workflow trigger "${triggerKey}" is not declared in a manifest`);

    const run = async (tx: Db): Promise<WorkflowStartResult | null> => {
      const definition = await this.definitionFor(tx, triggerKey, input.definitionId ?? null);
      if (!definition) {
        if (trigger.def.required)
          throw new HttpError(
            409,
            ErrorCodes.WORKFLOW_NOT_CONFIGURED,
            `No published workflow handles "${triggerKey}"`,
          );
        return null;
      }
      const version = definition.publishedVersion!;
      const graph = await this.graph(definition.id, version, tx);
      const subjectUserId = input.subjectUserId ?? input.requesterId;
      const facts = {
        ...(input.facts ?? {}),
        requester: await this.personFacts(tx, input.requesterId),
        subjectUser: await this.personFacts(tx, subjectUserId),
      };
      const [inst] = await tx
        .insert(workflowInstances)
        .values({
          definitionId: definition.id,
          version,
          triggerKey,
          moduleId,
          subjectType: input.subject.type,
          subjectId: input.subject.id,
          subjectLabel:
            typeof input.subject.label === 'string'
              ? { en: input.subject.label.slice(0, 300) }
              : input.subject.label,
          subjectHref: input.subject.href ?? null,
          requesterId: input.requesterId,
          subjectUserId,
          facts,
          state: emptyWorkflowState(),
        })
        .returning();
      const requesterName = await this.userName(tx, input.requesterId);
      await this.event(tx, inst!.id, {
        type: 'started',
        actor: input.requesterId ? { id: input.requesterId, name: requesterName } : SYSTEM,
        data: { definition: definition.name, version },
      });
      await this.deps.core().audit.record(
        {
          action: 'core.workflow.started',
          entityType: 'workflow_instance',
          entityId: inst!.id,
          entityLabel: localize(inst!.subjectLabel, 'en'),
          metadata: {
            triggerKey,
            definition: definition.key,
            version,
            subjectType: inst!.subjectType,
            subjectId: inst!.subjectId,
          },
        },
        { tx },
      );
      const status = await this.progress(tx, inst!, graph, inst!.state, null);
      return { instanceId: inst!.id, status };
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  private async definitionFor(tx: Db, triggerKey: string, definitionId: string | null) {
    const [d] = await tx
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.triggerKey, triggerKey),
          isNull(workflowDefinitions.archivedAt),
          definitionId ? eq(workflowDefinitions.id, definitionId) : eq(workflowDefinitions.isDefault, true),
        ),
      );
    if (definitionId && (!d || d.publishedVersion === null)) {
      // An explicitly attached workflow that can't run must never silently skip approval.
      throw new HttpError(409, ErrorCodes.WORKFLOW_NOT_CONFIGURED, 'The attached workflow is not published');
    }
    return d && d.publishedVersion !== null ? d : null;
  }

  /**
   * Dry run for "who will approve this?": walks the workflow assuming every approval passes and
   * resolves the people each step would ask (nothing is written).
   */
  async preview(
    triggerKey: string,
    input: Omit<StartWorkflowInput, 'subject'>,
    /** A graph being built (not saved): walk it instead of the published version. */
    opts: { graph?: WorkflowGraph } = {},
  ): Promise<{
    definition: { id: string; name: string };
    steps: {
      id: string;
      name: WorkflowStep['name'];
      type: 'approval' | 'notify';
      outcome: 'ask' | 'skipped' | 'no-approver' | 'reject' | 'already-approved';
      people: string[];
      /** Who already approved an earlier step (`repeatApprovers: 'skip'`): not asked again, with that step's name. */
      counted?: { id: string; approvedAt: LocalizedText }[];
    }[];
  } | null> {
    const trigger = this.trigger(triggerKey);
    if (!trigger) throw new Error(`Workflow trigger "${triggerKey}" is not declared in a manifest`);
    const definition = opts.graph
      ? { id: input.definitionId ?? '', name: '', publishedVersion: null }
      : await this.definitionFor(this.db, triggerKey, input.definitionId ?? null);
    if (!definition) {
      if (trigger.def.required)
        throw new HttpError(
          409,
          ErrorCodes.WORKFLOW_NOT_CONFIGURED,
          `No published workflow handles "${triggerKey}"`,
        );
      return null;
    }
    const graph = opts.graph ?? (await this.graph(definition.id, definition.publishedVersion!));
    const subjectUserId = input.subjectUserId ?? input.requesterId;
    const facts = {
      ...(input.facts ?? {}),
      requester: await this.personFacts(this.db, input.requesterId),
      subjectUser: await this.personFacts(this.db, subjectUserId),
    };
    const fake = { requesterId: input.requesterId, subjectUserId, facts } as unknown as InstanceRow;
    const steps: NonNullable<Awaited<ReturnType<WorkflowEngine['preview']>>>['steps'] = [];
    /** `skip` in a dry run: the person → the approval step they approved (see below). */
    const earlier = new Map<string, string>();
    const names = new Map<string, LocalizedText>();
    let state = emptyWorkflowState();
    for (let pass = 0; pass < 100; pass++) {
      // `today` is read when conditions are evaluated ("the planned start is within a week").
      const r = advanceWorkflow(graph, state, withToday(facts));
      state = r.state;
      for (const s of r.skipped)
        if (s.type === 'approval' || s.type === 'notify')
          steps.push({ id: s.id, name: s.name, type: s.type, outcome: 'skipped', people: [] });
      for (const n of r.notifications) {
        const ids = new Set<string>();
        for (const rule of n.recipients)
          for (const id of await this.resolver.resolve(rule, this.resolveContext(fake), new Set()))
            ids.add(id);
        steps.push({ id: n.id, name: n.name, type: 'notify', outcome: 'ask', people: [...ids] });
      }
      if (r.outcome !== 'running') break;
      for (const step of r.activated) {
        const slots = await this.resolveSlots(this.db, fake, step);
        names.set(step.id, step.name);
        const split = splitRepeatApprovers(
          step,
          slots,
          graph.repeatApprovers === 'skip' ? earlier : new Map<string, string>(),
        );
        const people = [...new Set(split.asked.map((a) => a.assignee.userId))];
        const counted = split.counted.map((c) => ({
          id: c.assignee.userId,
          approvedAt: names.get(c.fromStepId) ?? { en: '' },
        }));
        const none = step.ifNoApprover === 'skip' ? 'no-approver' : 'reject';
        const outcome = split.outcome === 'approved' ? 'already-approved' : people.length ? 'ask' : none;
        steps.push({
          id: step.id,
          name: step.name,
          type: 'approval',
          outcome,
          people,
          ...(counted.length ? { counted } : {}),
        });
        const approved = outcome === 'already-approved' || people.length || step.ifNoApprover === 'skip';
        state = { steps: { ...state.steps, [step.id]: { status: approved ? 'approved' : 'rejected' } } };
        // A dry run can't tell who decides a step with several people, so only a step with one person in it counts as
        // that person's approval for the steps after it.
        const everyone = [...new Set(slots.flatMap((s) => s.assignees.map((a) => a.userId)))];
        if (graph.repeatApprovers === 'skip' && everyone.length === 1 && !earlier.has(everyone[0]!))
          earlier.set(everyone[0]!, step.id);
      }
    }
    return { definition: { id: definition.id, name: definition.name }, steps };
  }

  /* ───────────── progress ───────────── */

  /** Advances until the instance waits for people or completes; persists state. */
  private async progress(
    tx: Db,
    inst: InstanceRow,
    graph: WorkflowGraph,
    initial: WorkflowState,
    comment: string | null,
  ): Promise<Outcome> {
    let state = initial;
    for (let pass = 0; pass < 100; pass++) {
      // `today` is the day each step is reached, not the day the request was sent.
      const r = advanceWorkflow(graph, state, withToday(inst.facts));
      state = r.state;
      for (const s of r.skipped)
        await this.event(tx, inst.id, { type: 'step_skipped', stepId: s.id, data: { reason: 'condition' } });
      for (const b of r.branches)
        await this.event(tx, inst.id, {
          type: 'branch_chosen',
          stepId: b.stepId,
          data: { branchId: b.branchId },
        });
      for (const n of r.notifications) await this.notifyStep(tx, inst, n);
      if (r.outcome !== 'running') {
        await this.complete(tx, inst, r.outcome, state, comment);
        return r.outcome;
      }
      let changed = false;
      for (const step of r.activated) {
        const slots = await this.resolveSlots(tx, inst, step);
        if (!slots.length) {
          const skip = step.ifNoApprover === 'skip';
          state = {
            steps: {
              ...state.steps,
              [step.id]: { status: skip ? 'skipped' : 'rejected', reason: 'no-approver' },
            },
          };
          await this.event(tx, inst.id, {
            type: skip ? 'step_skipped' : 'step_rejected',
            stepId: step.id,
            data: { reason: 'no-approver' },
          });
          changed = true;
          continue;
        }
        // With `skip`, people who already approved an earlier step of this instance are not asked again.
        const repeat =
          graph.repeatApprovers === 'skip' ? await this.earlierApprovals(tx, inst.id, step.id) : undefined;
        const placed = await this.createTasks(tx, inst, step, slots, { repeat });
        if (placed.outcome === 'approved') {
          // Everyone the step needs approved an earlier step: it completes without anybody being asked.
          const from = placed.counted[0] ? repeat?.get(placed.counted[0].assigneeId) : undefined;
          state = {
            steps: {
              ...state.steps,
              [step.id]: { status: 'approved', reason: 'already-approved', ...(from ? { from } : {}) },
            },
          };
          await this.event(tx, inst.id, { type: 'step_approved', stepId: step.id });
          changed = true;
        }
      }
      if (!changed) {
        await tx.update(workflowInstances).set({ state }).where(eq(workflowInstances.id, inst.id));
        return 'running';
      }
    }
    throw new Error(`Workflow instance ${inst.id} did not settle`);
  }

  private excluded(inst: InstanceRow, step: Pick<ApprovalStep, 'allowSelfApproval'>): Set<string> {
    if (step.allowSelfApproval) return new Set();
    return new Set([inst.requesterId, inst.subjectUserId].filter((x): x is string => Boolean(x)));
  }

  private resolveContext(inst: InstanceRow): ResolveContext {
    return { requesterId: inst.requesterId, subjectUserId: inst.subjectUserId, facts: inst.facts };
  }

  private async resolveSlots(tx: Db, inst: InstanceRow, step: ApprovalStep) {
    const excluded = this.excluded(inst, step);
    const ctx = this.resolveContext(inst);
    const slots: { slot: number; assignees: Assignee[] }[] = [];
    for (const [slot, rule] of step.approvers.entries()) {
      // `each`: one slot per value of the fact (e.g. per picked CI's owner group), numbered apart from plain slots.
      const parts =
        rule.type === 'fact' && rule.each
          ? factValues(getFact(ctx.facts, rule.fact)).map((value, i) => ({
              slot: EACH_SLOT_BASE + slot * MAX_EACH_VALUES + i,
              rule: { ...rule, fact: EACH_FACT, each: false },
              ctx: { ...ctx, facts: { ...(ctx.facts as object), [EACH_FACT]: value } },
            }))
          : [{ slot, rule, ctx }];
      for (const part of parts) {
        const ids = await this.resolver.resolve(part.rule, part.ctx, excluded, tx);
        if (!ids.length) continue;
        slots.push({ slot: part.slot, assignees: await this.resolver.applyDelegations(tx, ids, excluded) });
      }
    }
    return slots;
  }

  /**
   * The people whose approval of an earlier step of the instance counts again (`repeatApprovers: 'skip'`), each mapped to
   * the first step they approved. A delegate's approval counts for the person who decided it. Rejections, approvals no
   * one made (SLA auto-decisions) and the step itself never count.
   */
  private async earlierApprovals(tx: Db, instanceId: string, stepId: string): Promise<Map<string, string>> {
    const rows = await tx
      .select({ userId: approvalTasks.decidedById, stepId: approvalTasks.stepId })
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.instanceId, instanceId),
          eq(approvalTasks.status, 'approved'),
          isNotNull(approvalTasks.decidedById),
          ne(approvalTasks.stepId, stepId),
        ),
      )
      .orderBy(asc(approvalTasks.decidedAt), asc(approvalTasks.createdAt));
    const out = new Map<string, string>();
    for (const r of rows) if (r.userId && !out.has(r.userId)) out.set(r.userId, r.stepId);
    return out;
  }

  /**
   * Opens the tasks of a step's slots and returns the outcome they settle (`decideStep`). With `repeat` (see
   * `earlierApprovals`), a person whose approval counts gets an approved task: nobody is notified for it, and the rest of
   * their slot is not asked (`splitRepeatApprovers`).
   */
  private async createTasks(
    tx: Db,
    inst: InstanceRow,
    step: ApprovalStep,
    slots: { slot: number; assignees: Assignee[] }[],
    opts: { escalation?: boolean; repeat?: ReadonlyMap<string, string> } = {},
  ): Promise<{ asked: TaskRow[]; counted: TaskRow[]; outcome: SlotOutcome }> {
    const now = Date.now();
    const dueAt = !opts.escalation && step.sla ? new Date(now + step.sla.dueHours * HOUR) : null;
    const remindAt =
      !opts.escalation && step.sla?.remindHours ? new Date(now + step.sla.remindHours * HOUR) : null;
    const repeat = opts.repeat ?? new Map<string, string>();
    const split = splitRepeatApprovers(step, slots, repeat);
    const rows = [
      ...split.counted.map(({ slot, assignee }) => ({
        instanceId: inst.id,
        stepId: step.id,
        slot,
        assigneeId: assignee.userId,
        delegatedFromId: assignee.delegatedFromId,
        isEscalation: Boolean(opts.escalation),
        status: 'approved' as const,
        decidedAt: new Date(now),
        decidedById: assignee.userId,
      })),
      ...split.asked.map(({ slot, assignee }) => ({
        instanceId: inst.id,
        stepId: step.id,
        slot,
        assigneeId: assignee.userId,
        delegatedFromId: assignee.delegatedFromId,
        isEscalation: Boolean(opts.escalation),
        dueAt,
        remindAt,
      })),
    ];
    if (!rows.length) return { asked: [], counted: [], outcome: split.outcome };
    const inserted = await tx.insert(approvalTasks).values(rows).returning();
    const asked = inserted.filter((t) => t.status === 'pending');
    const counted = inserted.filter((t) => t.status === 'approved');
    if (!opts.escalation)
      await this.event(tx, inst.id, {
        type: 'step_started',
        stepId: step.id,
        data: { assignees: asked.length, dueAt: dueAt?.toISOString() ?? null },
      });
    for (const task of counted) {
      const fromStepId = repeat.get(task.assigneeId) ?? null;
      await this.event(tx, inst.id, {
        type: 'task_already_approved',
        taskId: task.id,
        stepId: step.id,
        actor: { id: task.assigneeId, name: await this.userName(tx, task.assigneeId) },
        data: { fromStepId },
      });
      await this.deps.core().audit.record(
        {
          action: 'core.approval.already_approved',
          entityType: 'workflow_instance',
          entityId: inst.id,
          entityLabel: localize(inst.subjectLabel, 'en'),
          metadata: {
            taskId: task.id,
            stepId: step.id,
            fromStepId,
            assigneeId: task.assigneeId,
            triggerKey: inst.triggerKey,
          },
        },
        { tx },
      );
    }
    // One notification per task, so each opens that decision (`/approvals?task=`) and is read once it is decided.
    if (asked.length) {
      const requester = await this.userName(tx, inst.requesterId);
      for (const task of asked)
        await this.deps.core().notifications.notify(
          {
            type: opts.escalation ? 'core.approval.escalated' : 'core.approval.assigned',
            recipients: [task.assigneeId],
            params: { requester, subject: inst.subjectLabel, step: step.name, dueAt },
            href: approvalHref(task.id),
            data: { instanceId: inst.id, stepId: step.id, taskId: task.id },
          },
          { tx },
        );
    }
    return { asked, counted, outcome: split.outcome };
  }

  private async notifyStep(tx: Db, inst: InstanceRow, step: NotifyStep) {
    const ids = new Set<string>();
    for (const rule of step.recipients)
      for (const id of await this.resolver.resolve(rule, this.resolveContext(inst), new Set(), tx))
        ids.add(id);
    await this.deps.core().notifications.notify(
      {
        type: 'core.workflow.fyi',
        recipients: [...ids],
        params: { subject: inst.subjectLabel, step: step.name, message: step.message ?? null },
        href: inst.subjectHref ?? '/requests',
        data: { instanceId: inst.id, stepId: step.id },
      },
      { tx },
    );
    await this.event(tx, inst.id, { type: 'notified', stepId: step.id, data: { recipients: ids.size } });
  }

  /**
   * Approval notifications of tasks that are no longer waiting (decided by someone, delegated, cancelled) are marked
   * read, so the bell agrees with My work.
   */
  private async settleNotifications(tx: Db, instanceId: string) {
    await tx.execute(sql`
      update core.notifications n set read_at = now()
       where n.read_at is null
         and n.user_id in (select t.assignee_id from core.approval_tasks t where t.instance_id = ${instanceId})
         and n.type like 'core.approval.%'
         and n.data->>'instanceId' = ${instanceId}
         and n.data ? 'taskId'
         and not exists (
           select 1 from core.approval_tasks t
            where t.id::text = n.data->>'taskId' and t.status = 'pending')`);
  }

  private async complete(
    tx: Db,
    inst: InstanceRow,
    outcome: 'approved' | 'rejected' | 'cancelled',
    state: WorkflowState,
    comment: string | null,
  ) {
    await tx
      .update(approvalTasks)
      .set({ status: 'cancelled' })
      .where(and(eq(approvalTasks.instanceId, inst.id), eq(approvalTasks.status, 'pending')));
    await this.settleNotifications(tx, inst.id);
    await tx
      .update(workflowInstances)
      .set({ status: outcome, state, completedAt: new Date(), outcomeComment: comment })
      .where(eq(workflowInstances.id, inst.id));
    await this.event(tx, inst.id, { type: 'completed', data: { outcome } });
    // The person whose decision completed it (none for cancellations and SLA auto-decisions).
    const [last] =
      outcome === 'cancelled'
        ? []
        : await tx
            .select({ id: users.id, name: users.displayName })
            .from(approvalTasks)
            .leftJoin(users, eq(users.id, approvalTasks.decidedById))
            .where(and(eq(approvalTasks.instanceId, inst.id), isNotNull(approvalTasks.decidedAt)))
            .orderBy(sql`${approvalTasks.decidedAt} desc`)
            .limit(1);
    const decider = last?.id && last.name ? { id: last.id, name: last.name } : null;
    const core = this.deps.core();
    await core.audit.record(
      {
        action: 'core.workflow.completed',
        entityType: 'workflow_instance',
        entityId: inst.id,
        entityLabel: localize(inst.subjectLabel, 'en'),
        metadata: {
          triggerKey: inst.triggerKey,
          outcome,
          subjectType: inst.subjectType,
          subjectId: inst.subjectId,
        },
      },
      { tx },
    );
    await core.events.publish<WorkflowCompletion>(
      WORKFLOW_COMPLETED,
      {
        instanceId: inst.id,
        triggerKey: inst.triggerKey,
        subjectType: inst.subjectType,
        subjectId: inst.subjectId,
        outcome,
        requesterId: inst.requesterId,
        comment,
        decidedBy: decider,
      },
      { tx },
    );
  }

  /* ───────────── decisions ───────────── */

  private async lock(tx: Db, taskId: string) {
    const [ref] = await tx
      .select({ instanceId: approvalTasks.instanceId })
      .from(approvalTasks)
      .where(eq(approvalTasks.id, taskId));
    if (!ref) throw httpErrors.notFound('Approval task not found');
    const [inst] = await tx
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, ref.instanceId))
      .for('update');
    const [task] = await tx.select().from(approvalTasks).where(eq(approvalTasks.id, taskId));
    const graph = await this.graph(inst!.definitionId, inst!.version, tx);
    const step = findStep(graph, task!.stepId);
    if (!step || step.type !== 'approval') throw new Error(`Step ${task!.stepId} is not an approval step`);
    return { inst: inst!, task: task!, graph, step };
  }

  private assertPending(inst: InstanceRow, task: TaskRow) {
    if (task.status !== 'pending' || inst.status !== 'running')
      throw new HttpError(409, ErrorCodes.TASK_NOT_PENDING, 'This approval is no longer pending');
  }

  /**
   * Validates what the approver filled in for the step's `fields` (as form answers are: the shared validator, then
   * people that must exist and records the approver may read that match `where`). Returns the cleaned values, or
   * throws 400 `VALIDATION_FAILED` with issues under `data.<key>`.
   */
  private async stepFieldValues(
    tx: Db,
    step: ApprovalStep,
    decision: 'approve' | 'reject',
    input: Record<string, unknown> | null | undefined,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    if (!step.fields?.length) return {};
    const result = validateStepFields(step, decision, input);
    const checks = this.deps.fields;
    const errors = {
      ...result.errors,
      ...(result.ok
        ? {
            ...(await verifyUserFields(tx, step.fields, result.values)),
            ...(checks
              ? await verifyRecordFields(
                  { readable: checks.readableRecords, facts: checks.recordFacts },
                  step.fields,
                  result.values,
                  auth,
                )
              : {}),
          }
        : {}),
    };
    if (Object.keys(errors).length) throw fieldValidationError(errors, 'data');
    return result.values;
  }

  async decide(
    taskId: string,
    decision: 'approve' | 'reject',
    comment: string | null,
    auth: AuthContext,
    data?: Record<string, unknown> | null,
  ) {
    const note = comment?.trim() || null;
    if (decision === 'reject' && !note)
      throw new HttpError(400, ErrorCodes.COMMENT_REQUIRED, 'Tell the requester why you reject it');
    return this.db.transaction(async (tx) => {
      const { inst: locked, task, graph, step } = await this.lock(tx, taskId);
      if (task.assigneeId !== auth.user?.id)
        throw httpErrors.forbidden('This approval is assigned to someone else');
      this.assertPending(locked, task);
      const values = await this.stepFieldValues(tx, step, decision, data, auth);
      const filled = Object.keys(values).length > 0;
      const status = decision === 'approve' ? 'approved' : 'rejected';
      await tx
        .update(approvalTasks)
        .set({
          status,
          comment: note,
          data: filled ? values : null,
          decidedAt: new Date(),
          decidedById: auth.user.id,
        })
        .where(eq(approvalTasks.id, task.id));
      // Later steps, conditions and process actions read the values as facts `steps.<stepId>.<key>` (with several
      // approvers on a step, the latest decision's value of each field).
      let inst = locked;
      if (filled) {
        const steps = stepValuesOf(locked.facts);
        const facts = {
          ...locked.facts,
          [STEP_FACTS_ROOT]: { ...steps, [step.id]: { ...steps[step.id], ...values } },
        };
        await tx.update(workflowInstances).set({ facts }).where(eq(workflowInstances.id, locked.id));
        inst = { ...locked, facts };
      }
      const actor = actorOf(auth);
      await this.event(tx, inst.id, {
        type: `task_${status}`,
        taskId: task.id,
        stepId: step.id,
        actor,
        data: { comment: note, delegatedFromId: task.delegatedFromId, ...(filled ? { fields: values } : {}) },
      });
      await this.deps.core().audit.record(
        {
          action: `core.approval.${status}`,
          entityType: 'workflow_instance',
          entityId: inst.id,
          entityLabel: localize(inst.subjectLabel, 'en'),
          metadata: {
            taskId: task.id,
            stepId: step.id,
            triggerKey: inst.triggerKey,
            comment: note,
            ...(filled ? { fields: values } : {}),
          },
        },
        { tx },
      );
      const outcome = await this.afterSlotDecision(tx, inst, graph, step, task.slot, note);
      await this.settleNotifications(tx, inst.id);
      return outcome;
    });
  }

  private async afterSlotDecision(
    tx: Db,
    inst: InstanceRow,
    graph: WorkflowGraph,
    step: ApprovalStep,
    slot: number,
    comment: string | null,
  ): Promise<Outcome> {
    // The first decision in a slot closes the slot's other tasks (e.g. other group members).
    await tx
      .update(approvalTasks)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(approvalTasks.instanceId, inst.id),
          eq(approvalTasks.stepId, step.id),
          eq(approvalTasks.slot, slot),
          eq(approvalTasks.status, 'pending'),
        ),
      );
    const tasks = await tx
      .select({ slot: approvalTasks.slot, status: approvalTasks.status })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.instanceId, inst.id), eq(approvalTasks.stepId, step.id)));
    const slots = new Map<number, SlotOutcome>();
    for (const t of tasks) {
      if (t.status === 'approved' || t.status === 'rejected') slots.set(t.slot, t.status);
      else if (!slots.has(t.slot)) slots.set(t.slot, 'pending');
    }
    const outcome = decideStep(step, [...slots.values()]);
    if (outcome === 'pending') return 'running';
    await tx
      .update(approvalTasks)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(approvalTasks.instanceId, inst.id),
          eq(approvalTasks.stepId, step.id),
          eq(approvalTasks.status, 'pending'),
        ),
      );
    await this.event(tx, inst.id, { type: `step_${outcome}`, stepId: step.id });
    const state: WorkflowState = { steps: { ...inst.state.steps, [step.id]: { status: outcome } } };
    return this.progress(tx, inst, graph, state, outcome === 'rejected' ? comment : null);
  }

  async delegate(
    taskId: string,
    toUserId: string,
    comment: string | null,
    auth: AuthContext,
    opts: { asAdmin?: boolean } = {},
  ) {
    return this.db.transaction(async (tx) => {
      const { inst, task, step, graph } = await this.lock(tx, taskId);
      const mine = task.assigneeId === auth.user?.id;
      if (!mine && !opts.asAdmin) throw httpErrors.forbidden('This approval is assigned to someone else');
      this.assertPending(inst, task);
      if (step.allowDelegation === false && !opts.asAdmin)
        throw new HttpError(409, ErrorCodes.DELEGATION_NOT_ALLOWED, 'This step does not allow delegation');
      const excluded = this.excluded(inst, step);
      const [target] = await tx
        .select({ id: users.id, name: users.displayName, status: users.status })
        .from(users)
        .where(eq(users.id, toUserId));
      const [already] = await tx
        .select({ id: approvalTasks.id })
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.instanceId, inst.id),
            eq(approvalTasks.stepId, step.id),
            eq(approvalTasks.slot, task.slot),
            eq(approvalTasks.assigneeId, toUserId),
            eq(approvalTasks.status, 'pending'),
          ),
        );
      if (
        !target ||
        target.status !== 'active' ||
        excluded.has(toUserId) ||
        toUserId === task.assigneeId ||
        already
      )
        throw new HttpError(409, ErrorCodes.INVALID_DELEGATE, 'This person cannot take over the approval');
      const note = comment?.trim() || null;
      await tx
        .update(approvalTasks)
        .set({
          status: 'delegated',
          comment: note,
          decidedAt: new Date(),
          decidedById: auth.user?.id ?? null,
        })
        .where(eq(approvalTasks.id, task.id));
      await this.settleNotifications(tx, inst.id);
      // With `skip`, a delegate who already approved an earlier step of the instance is not asked again: it counts.
      const repeat =
        graph.repeatApprovers === 'skip'
          ? await this.earlierApprovals(tx, inst.id, step.id)
          : new Map<string, string>();
      const counted = repeat.has(toUserId);
      const [created] = await tx
        .insert(approvalTasks)
        .values({
          instanceId: inst.id,
          stepId: step.id,
          slot: task.slot,
          assigneeId: toUserId,
          delegatedFromId: task.assigneeId,
          isEscalation: task.isEscalation,
          dueAt: counted ? null : task.dueAt,
          remindAt: counted || task.remindedAt ? null : task.remindAt,
          ...(counted ? { status: 'approved' as const, decidedAt: new Date(), decidedById: toUserId } : {}),
        })
        .returning();
      const actor = actorOf(auth);
      await this.event(tx, inst.id, {
        type: 'task_delegated',
        taskId: task.id,
        stepId: step.id,
        actor,
        data: { toId: target.id, toName: target.name, comment: note, byAdmin: !mine },
      });
      await this.deps.core().audit.record(
        {
          action: 'core.approval.delegated',
          entityType: 'workflow_instance',
          entityId: inst.id,
          entityLabel: localize(inst.subjectLabel, 'en'),
          metadata: {
            taskId: task.id,
            newTaskId: created!.id,
            from: task.assigneeId,
            to: target.id,
            comment: note,
          },
        },
        { tx },
      );
      if (counted) {
        // Their approval of an earlier step counts, so they are not asked and nothing is sent to them.
        const fromStepId = repeat.get(toUserId) ?? null;
        await this.event(tx, inst.id, {
          type: 'task_already_approved',
          taskId: created!.id,
          stepId: step.id,
          actor: { id: target.id, name: target.name },
          data: { fromStepId },
        });
        await this.deps.core().audit.record(
          {
            action: 'core.approval.already_approved',
            entityType: 'workflow_instance',
            entityId: inst.id,
            entityLabel: localize(inst.subjectLabel, 'en'),
            metadata: {
              taskId: created!.id,
              stepId: step.id,
              fromStepId,
              assigneeId: target.id,
              triggerKey: inst.triggerKey,
            },
          },
          { tx },
        );
        await this.afterSlotDecision(tx, inst, graph, step, task.slot, null);
        return created!;
      }
      await this.deps.core().notifications.notify(
        {
          type: 'core.approval.delegated',
          recipients: [target.id],
          params: { actor: actor.name, subject: inst.subjectLabel, step: step.name, comment: note },
          href: approvalHref(created!.id),
          data: { instanceId: inst.id, taskId: created!.id },
        },
        { tx },
      );
      return created!;
    });
  }

  /* ───────────── cancel ───────────── */

  async cancel(instanceId: string, reason: string | null, auth: AuthContext | null) {
    return this.db.transaction((tx) => this.cancelIn(tx, instanceId, reason, actorOf(auth)));
  }

  private async cancelIn(tx: Db, instanceId: string, reason: string | null, actor: Actor) {
    const [inst] = await tx
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId))
      .for('update');
    if (!inst) throw httpErrors.notFound('Workflow instance not found');
    if (inst.status !== 'running')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Only running workflows can be cancelled');
    await this.event(tx, inst.id, { type: 'cancelled', actor, data: { reason } });
    await this.complete(tx, inst, 'cancelled', inst.state, reason);
  }

  /* ───────────── SLA timers ───────────── */

  /** Sends due reminders and applies breach policies. Runs every minute in the worker; idempotent. */
  async tick(now = new Date()): Promise<{ reminded: number; breached: number }> {
    let reminded = 0;
    const due = await this.db
      .select({ id: approvalTasks.id })
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.status, 'pending'),
          isNotNull(approvalTasks.remindAt),
          lte(approvalTasks.remindAt, now),
          isNull(approvalTasks.remindedAt),
        ),
      )
      .limit(200);
    for (const { id } of due) {
      await this.db.transaction(async (tx) => {
        const { inst, task, step } = await this.lock(tx, id);
        if (task.status !== 'pending' || task.remindedAt || inst.status !== 'running') return;
        await tx.update(approvalTasks).set({ remindedAt: now }).where(eq(approvalTasks.id, id));
        await this.event(tx, inst.id, {
          type: 'task_reminded',
          taskId: id,
          stepId: step.id,
          data: { assigneeId: task.assigneeId },
        });
        await this.deps.core().notifications.notify(
          {
            type: 'core.approval.reminder',
            recipients: [task.assigneeId],
            params: { subject: inst.subjectLabel, step: step.name, dueAt: task.dueAt },
            href: approvalHref(id),
            data: { instanceId: inst.id, taskId: id },
          },
          { tx },
        );
        reminded++;
      });
    }

    let breached = 0;
    const slots = await this.db
      .selectDistinct({
        instanceId: approvalTasks.instanceId,
        stepId: approvalTasks.stepId,
        slot: approvalTasks.slot,
      })
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.status, 'pending'),
          isNotNull(approvalTasks.dueAt),
          lte(approvalTasks.dueAt, now),
          isNull(approvalTasks.breachedAt),
        ),
      )
      .limit(100);
    for (const s of slots) {
      try {
        if (await this.breach(s.instanceId, s.stepId, s.slot, now)) breached++;
      } catch (err) {
        this.deps.logger.error({ err, instanceId: s.instanceId }, 'failed to apply SLA breach policy');
      }
    }
    return { reminded, breached };
  }

  private async breach(instanceId: string, stepId: string, slot: number, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [inst] = await tx
        .select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, instanceId))
        .for('update');
      if (!inst || inst.status !== 'running') return false;
      const graph = await this.graph(inst.definitionId, inst.version, tx);
      const step = findStep(graph, stepId);
      if (!step || step.type !== 'approval' || !step.sla) return false;
      const overdue = await tx
        .update(approvalTasks)
        .set({ breachedAt: now })
        .where(
          and(
            eq(approvalTasks.instanceId, instanceId),
            eq(approvalTasks.stepId, stepId),
            eq(approvalTasks.slot, slot),
            eq(approvalTasks.status, 'pending'),
            isNull(approvalTasks.breachedAt),
          ),
        )
        .returning();
      if (!overdue.length) return false;
      const policy = step.sla;
      const assignees = overdue.map((t) => t.assigneeId);

      if (policy.onBreach === 'approve' || policy.onBreach === 'reject') {
        const status = policy.onBreach === 'approve' ? 'approved' : 'rejected';
        const first = overdue[0]!;
        await tx
          .update(approvalTasks)
          .set({ status, decidedAt: now, decidedById: null, comment: null })
          .where(eq(approvalTasks.id, first.id));
        await this.event(tx, inst.id, {
          type: 'task_auto_decided',
          taskId: first.id,
          stepId,
          actor: SYSTEM,
          data: { outcome: status },
        });
        await this.deps.core().audit.record(
          {
            action: 'core.approval.auto_decided',
            entityType: 'workflow_instance',
            entityId: inst.id,
            entityLabel: localize(inst.subjectLabel, 'en'),
            metadata: { taskId: first.id, stepId, outcome: status, reason: 'sla' },
          },
          { tx },
        );
        await this.afterSlotDecision(tx, inst, graph, step, slot, null);
        await this.settleNotifications(tx, inst.id);
        return true;
      }

      if (policy.onBreach === 'escalate' && policy.escalateTo?.length) {
        const excluded = this.excluded(inst, step);
        const pendingInSlot = await tx
          .select({ id: approvalTasks.assigneeId })
          .from(approvalTasks)
          .where(
            and(
              eq(approvalTasks.instanceId, inst.id),
              eq(approvalTasks.stepId, stepId),
              eq(approvalTasks.slot, slot),
              eq(approvalTasks.status, 'pending'),
            ),
          );
        const skip = new Set([...excluded, ...pendingInSlot.map((p) => p.id)]);
        const ids = new Set<string>();
        for (const rule of policy.escalateTo)
          for (const id of await this.resolver.resolve(rule, this.resolveContext(inst), skip, tx))
            ids.add(id);
        if (ids.size) {
          const repeat =
            graph.repeatApprovers === 'skip' ? await this.earlierApprovals(tx, inst.id, stepId) : undefined;
          const placed = await this.createTasks(
            tx,
            inst,
            step,
            [{ slot, assignees: [...ids].map((userId) => ({ userId, delegatedFromId: null })) }],
            { escalation: true, repeat },
          );
          await this.event(tx, inst.id, {
            type: 'task_escalated',
            stepId,
            actor: SYSTEM,
            data: { added: placed.asked.length, from: assignees },
          });
          await this.deps.core().audit.record(
            {
              action: 'core.approval.escalated',
              entityType: 'workflow_instance',
              entityId: inst.id,
              entityLabel: localize(inst.subjectLabel, 'en'),
              metadata: { stepId, slot, added: [...ids] },
            },
            { tx },
          );
          // Someone it escalated to already approved an earlier step: that approval settles the slot.
          if (placed.counted.length) await this.afterSlotDecision(tx, inst, graph, step, slot, null);
          return true;
        }
      }

      await this.event(tx, inst.id, { type: 'task_overdue', stepId, actor: SYSTEM, data: { assignees } });
      for (const task of overdue)
        await this.deps.core().notifications.notify(
          {
            type: 'core.approval.overdue',
            recipients: [task.assigneeId],
            params: { subject: inst.subjectLabel, step: step.name },
            href: approvalHref(task.id),
            data: { instanceId: inst.id, taskId: task.id },
          },
          { tx },
        );
      return true;
    });
  }

  /** Pending approvals per user (navigation badge). */
  async pendingCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(approvalTasks)
      .innerJoin(workflowInstances, eq(workflowInstances.id, approvalTasks.instanceId))
      .where(
        and(
          eq(approvalTasks.assigneeId, userId),
          eq(approvalTasks.status, 'pending'),
          eq(workflowInstances.status, 'running'),
        ),
      );
    return row?.n ?? 0;
  }

  /** Whether the user was ever asked to act on the instance (visibility checks). */
  async involves(instanceId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: approvalTasks.id })
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.instanceId, instanceId),
          sql`(${approvalTasks.assigneeId} = ${userId} or ${approvalTasks.delegatedFromId} = ${userId})`,
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}
