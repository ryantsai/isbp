/**
 * Approval workflows as the people in them see them: the instance page (`GET /workflow-instances/:id`, which tells
 * the viewer their own pending task), the inbox (`GET /me/approvals`) and the decisions.
 */
import type { Json } from './client';
import { type FlowContext, FlowError } from './flow';

export type Verdict = 'approve' | 'reject';
export type Outcome = 'running' | 'approved' | 'rejected';

export interface Decision {
  stepId: string | null;
  persona: string;
  verdict: Verdict;
  outcome: Outcome;
}

export interface DecideOptions {
  /** Required to reject. */
  comment?: string;
  /** Values of the step's `fields` (generated from the step's field definitions when omitted). */
  data?: Record<string, unknown>;
  /** Find the task in the persona's inbox with this search (`q` matches the subject label) instead of the instance. */
  viaInbox?: string;
  /** Send the decision twice at once (a double click): exactly one may go through, the other is refused. */
  twice?: boolean;
}

export interface ApproveAllOptions {
  /** Personas to decide as first when they are among the people asked. */
  prefer?: readonly string[];
  /** Personas never to decide as (e.g. the requester). */
  avoid?: readonly string[];
  /** At most this many decisions (default 12). */
  max?: number;
  comment?: string;
}

export interface Approvals {
  /** The instance as `persona` sees it (default `admin`, a workflow reader). */
  instance(instanceId: string, persona?: string): Promise<Json>;
  /** Waits until `persona` has a pending task on the instance; returns its id and step. */
  taskOf(instanceId: string, persona: string, timeoutMs?: number): Promise<{ id: string; stepId: string }>;
  /** Decides `persona`'s pending task; returns the instance's outcome after the decision. */
  decide(instanceId: string, persona: string, verdict: Verdict, opts?: DecideOptions): Promise<Outcome>;
  /** Approves as whichever personas the instance is waiting for, until it is no longer running. */
  approveAll(
    instanceId: string,
    opts?: ApproveAllOptions,
  ): Promise<{ status: string; decisions: Decision[] }>;
}

interface StepNode {
  id: string;
  type: string;
  fields?: Json[];
  branches?: { steps: StepNode[] }[];
  otherwise?: { steps: StepNode[] } | null;
}

function findStep(steps: StepNode[] | undefined, id: string): StepNode | null {
  for (const s of steps ?? []) {
    if (s.id === id) return s;
    for (const b of s.branches ?? []) {
      const found = findStep(b.steps, id);
      if (found) return found;
    }
    const other = findStep(s.otherwise?.steps, id);
    if (other) return other;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createApprovals(ctx: FlowContext): Approvals {
  const instance = async (instanceId: string, persona = 'admin') =>
    ctx.expect.ok(
      await ctx.as(persona).get(`/workflow-instances/${instanceId}`),
      'read the workflow instance',
    ).body;

  const taskOf: Approvals['taskOf'] = async (instanceId, persona, timeoutMs = 15_000) => {
    const seen = await ctx.eventually(
      () => ctx.as(persona).get(`/workflow-instances/${instanceId}`),
      (r) => r.status === 200 && (Boolean(r.body.myTaskId) || r.body.status !== 'running'),
      { timeoutMs, label: `a task for ${persona}` },
    );
    if (!seen.body.myTaskId)
      throw new FlowError(`${persona} has no pending task: the workflow is ${seen.body.status}`, {
        response: seen,
      });
    const task = (seen.body.tasks as Json[]).find((t) => t.id === seen.body.myTaskId);
    return { id: seen.body.myTaskId as string, stepId: (task?.stepId as string) ?? '?' };
  };

  /** Values for the step's required fields (approval steps may ask the approver for some). */
  const stepData = async (
    instanceId: string,
    stepId: string,
  ): Promise<Record<string, unknown> | undefined> => {
    const inst = await instance(instanceId);
    const step = findStep(inst.graph?.steps, stepId);
    if (!step?.fields?.length) return undefined;
    return ctx.forms.answers({ elements: step.fields }, {}, { requiredOnly: true });
  };

  const decide: Approvals['decide'] = async (instanceId, persona, verdict, opts = {}) => {
    const client = ctx.as(persona);
    let taskId: string;
    let stepId: string;
    if (opts.viaInbox) {
      const inbox = ctx.expect.ok(
        await client.get('/me/approvals', { query: { q: opts.viaInbox, pageSize: 50 } }),
        `${persona} opens their approvals`,
      );
      const item = ctx.expect.find(
        inbox.body.items as Json[],
        (i: Json) => i.instance?.id === instanceId,
        `${persona}'s inbox shows the task (search "${opts.viaInbox}")`,
      );
      taskId = item.task.id;
      stepId = item.step?.id ?? item.task.stepId;
    } else {
      ({ id: taskId, stepId } = await taskOf(instanceId, persona));
    }
    const data = opts.data ?? (await stepData(instanceId, stepId));
    const body = {
      comment: opts.comment ?? (verdict === 'reject' ? ctx.rand.sentence(3, 8) : undefined),
      ...(data ? { data } : {}),
    };
    if (opts.twice) {
      const both = await Promise.all([1, 2].map(() => client.post(`/approvals/${taskId}/${verdict}`, body)));
      return ctx.expect.oneOk(both, `${persona} ${verdict}s twice at once (step ${stepId})`).body
        .outcome as Outcome;
    }
    const res = await client.post(`/approvals/${taskId}/${verdict}`, body);
    ctx.expect.ok(res, `${persona} ${verdict}s (step ${stepId})`);
    return res.body.outcome as Outcome;
  };

  const approveAll: Approvals['approveAll'] = async (instanceId, opts = {}) => {
    const decisions: Decision[] = [];
    const max = opts.max ?? 12;
    for (let i = 0; i <= max; i++) {
      let inst = await instance(instanceId);
      // A step can take a moment to ask its approvers (e.g. after a timer): wait a little before giving up.
      for (
        let wait = 0;
        inst.status === 'running' && !(inst.pendingWith as Json[]).length && wait < 20;
        wait++
      ) {
        await sleep(250);
        inst = await instance(instanceId);
      }
      if (inst.status !== 'running') return { status: inst.status as string, decisions };
      if (i === max) break;
      const asked = (inst.pendingWith as { id: string; name: string }[])
        .map((p) => ctx.personaOf(p.id))
        .filter((n): n is string => Boolean(n) && !(opts.avoid ?? []).includes(n!));
      if (!asked.length)
        throw new FlowError('the workflow waits for people none of the personas is', {
          details: { pendingWith: inst.pendingWith, currentSteps: inst.currentSteps },
        });
      const persona =
        (opts.prefer ?? []).find((p) => asked.includes(p)) ??
        ctx.rand.pick(asked.filter((p) => p !== 'admin').length ? asked.filter((p) => p !== 'admin') : asked);
      const { stepId } = await taskOf(instanceId, persona);
      const outcome = await decide(instanceId, persona, 'approve', { comment: opts.comment });
      decisions.push({ stepId, persona, verdict: 'approve', outcome });
    }
    throw new FlowError(`the workflow was still running after ${max} approvals`, { details: { decisions } });
  };

  return { instance, taskOf, decide, approveAll };
}
