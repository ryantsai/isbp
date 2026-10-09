import type { requestPathSchema } from '@isbp/contracts';
import { findStep, type LocalizedText, walkSteps } from '@isbp/sdk';
import type { AuthContext, ModuleContext } from '@isbp/sdk/server';
import type { z } from 'zod';
import { getKernel } from '../kernel-ref';
import { peopleById, type PersonRef, ref } from './people';
import { InstanceViews } from './workflows';

/** The response as the server builds it (dates as `Date`, encoded by the schema). */
export type RequestPathOut = z.output<typeof requestPathSchema>;
type StepOut = RequestPathOut['steps'][number];

/** A request that needs no approval. */
export const NO_APPROVAL_PATH: RequestPathOut = { status: null, steps: [], nextStepId: null };

const at = (v: Date | string | null | undefined) => (v ? new Date(v) : null);
const times = (dates: (Date | string | null | undefined)[]) =>
  dates.map(at).filter((d): d is Date => d !== null);
const earliest = (dates: (Date | string | null | undefined)[]) =>
  times(dates).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
const latest = (dates: (Date | string | null | undefined)[]) =>
  times(dates).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
/** The comment of the most recent decision that has one. */
const latestComment = (decided: { decidedAt: Date | string | null; comment: string | null }[]) =>
  decided
    .filter((t) => t.comment?.trim())
    .sort((a, b) => (at(b.decidedAt)?.getTime() ?? 0) - (at(a.decidedAt)?.getTime() ?? 0))[0]?.comment ??
  null;

/**
 * The approval path of a request as its requester sees it (`GET /requests/:reference/path`): each approval step is
 * done (who decided, when), rejected, waiting (who is asked, since when, the earliest deadline), not reached yet (who
 * would be asked now, from a dry run of the workflow on the instance's facts) or not needed. Steps that neither ran nor
 * come up in the dry run are left out, so a requester never sees rule text or branches that can't happen.
 */
export async function requestPath(
  ctx: ModuleContext,
  instanceId: string,
  auth: AuthContext,
): Promise<RequestPathOut> {
  const inst = await new InstanceViews(ctx).detail(instanceId, auth);
  const running = inst.status === 'running';
  // Steps not reached yet: approvers resolved now, assuming the approvals before them pass.
  const ahead = new Map<
    string,
    {
      outcome: 'ask' | 'skipped' | 'no-approver' | 'reject' | 'already-approved';
      people: string[];
      counted: { id: string; approvedAt: LocalizedText }[];
    }
  >();
  if (running) {
    try {
      const preview = await getKernel().workflows.preview(inst.triggerKey, {
        requesterId: inst.requester?.id ?? null,
        subjectUserId: inst.subjectUser?.id ?? inst.requester?.id ?? null,
        facts: inst.facts,
        definitionId: inst.definition.id,
      });
      for (const s of preview?.steps ?? [])
        if (s.type === 'approval')
          ahead.set(s.id, { outcome: s.outcome, people: s.people, counted: s.counted ?? [] });
    } catch {
      // The workflow changed under the request: the steps still show, without names for the ones ahead.
    }
  }
  const people = await peopleById(
    ctx.db,
    [...ahead.values()].flatMap((a) => [...a.people, ...a.counted.map((c) => c.id)]),
  );

  const steps: StepOut[] = [];
  const approvedBefore = (counted: { id: string; approvedAt: LocalizedText }[]) =>
    counted.flatMap((c) => {
      const person = ref(people, c.id);
      return person ? [{ person, approvedAt: c.approvedAt }] : [];
    });
  for (const { step } of walkSteps(inst.graph.steps)) {
    if (step.type !== 'approval') continue;
    const state = inst.state.steps[step.id];
    const tasks = inst.tasks.filter((t) => t.stepId === step.id && t.status !== 'delegated');
    const decided = tasks.filter((t) => (t.status === 'approved' || t.status === 'rejected') && t.decidedAt);
    const open = tasks.filter((t) => t.status === 'pending');
    const base = {
      id: step.id,
      name: step.name,
      people: [] as PersonRef[],
      decidedAt: null as Date | null,
      since: null as Date | null,
      dueAt: null as Date | null,
      reason: null as StepOut['reason'],
      comment: null as string | null,
    };

    if (state?.status === 'approved' || state?.status === 'rejected') {
      const deciders = decided.map((t) => t.decidedBy ?? t.assignee);
      // Approvals counted from earlier steps (`task_already_approved`), with the step each was given at.
      const alreadyApproved = inst.events
        .filter((e) => e.type === 'task_already_approved' && e.stepId === step.id)
        .flatMap((e) => {
          const person = inst.tasks.find((t) => t.id === e.taskId)?.decidedBy;
          const from = findStep(inst.graph, String(e.data?.fromStepId ?? ''));
          return person && from ? [{ person, approvedAt: from.name }] : [];
        });
      const allCounted =
        state.status === 'approved' &&
        alreadyApproved.length > 0 &&
        alreadyApproved.length === decided.length;
      steps.push({
        ...base,
        state: state.status === 'approved' ? 'done' : 'rejected',
        people: deciders.length ? deciders : tasks.map((t) => t.assignee),
        decidedAt: latest(decided.map((t) => t.decidedAt)),
        comment: latestComment(decided),
        ...(alreadyApproved.length ? { alreadyApproved } : {}),
        ...(allCounted ? { reason: 'already-approved' as const } : {}),
      });
    } else if (state?.status === 'active' && running) {
      steps.push({
        ...base,
        state: 'current',
        people: open.map((t) => t.assignee),
        since: earliest(open.map((t) => t.createdAt)),
        dueAt: earliest(open.map((t) => t.dueAt)),
      });
    } else if (
      state?.status === 'skipped' ||
      (state?.status === 'active' && !running) ||
      (!state && !running)
    ) {
      // Not needed for this request: its condition didn't hold, or the request ended before the step.
      steps.push({ ...base, state: 'skipped', reason: state?.reason === 'condition' ? 'condition' : null });
    } else if (!state && running) {
      const next = ahead.get(step.id);
      if (!next) continue;
      const counted = approvedBefore(next.counted);
      if (next.outcome === 'skipped') {
        steps.push({ ...base, state: 'skipped', reason: 'condition' });
      } else if (next.outcome === 'already-approved') {
        steps.push({ ...base, state: 'done', reason: 'already-approved', alreadyApproved: counted });
      } else {
        steps.push({
          ...base,
          state: 'upcoming',
          people: next.people.map((id) => ref(people, id)).filter((p): p is PersonRef => Boolean(p)),
          reason: next.outcome === 'ask' ? null : 'no-approver',
          ...(counted.length ? { alreadyApproved: counted } : {}),
        });
      }
    }
  }
  const nextStepId =
    steps.find((s) => s.state === 'current')?.id ?? steps.find((s) => s.state === 'upcoming')?.id ?? null;
  return { status: inst.status, steps, nextStepId };
}
