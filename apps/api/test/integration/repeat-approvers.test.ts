/**
 * `repeatApprovers: 'skip'`: someone whose approval of an earlier step of the same request counts is not asked again at a
 * later step. That approval is recorded as approved (nobody is notified), the timeline and the audit log say why, and a
 * step whose approvers all counted completes without anybody being asked. Without the setting, or with `ask`, they are
 * asked again as before. Rejections never count, a delegate's approval counts for the person who decided it, and an
 * escalation to someone who already approved settles the slot. The dry run ("who will approve it") shows the same.
 */
import {
  approvalTasks,
  auditLogs,
  groupMembers,
  groups,
  notifications,
  workflowEvents,
  workflowInstances,
} from '@isbp/db/schema';
import type { ApprovalStep, ApproverRule, WorkflowGraph, WorkflowStep } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const t = processActionHelpers(() => ({ h, admin }));
const MODULES = process.env.ISBP_TEST_MODULES;

const en = (text: string) => ({ en: text });
const userRule = (userId: string): ApproverRule => ({ type: 'user', userId });
const teamRule: ApproverRule = { type: 'group', groupKey: 'repeat-team' };

/** An approval step, named after its id ("first" → "First approval"). */
const approval = (
  id: string,
  approvers: ApproverRule[],
  extra: Partial<ApprovalStep> = {},
): WorkflowStep => ({
  id,
  type: 'approval',
  name: en(`${id[0]!.toUpperCase()}${id.slice(1)} approval`),
  approvers,
  mode: 'any',
  ...extra,
});

/** Step one is decided by Pat, step two by the team (Pat and Quinn) unless the test says otherwise. */
const graphOf = (
  second: WorkflowStep,
  policy?: 'ask' | 'skip',
  first: WorkflowStep = approval('first', [userRule(ids.pat!)]),
): WorkflowGraph => ({
  steps: [first, second],
  ...(policy ? { repeatApprovers: policy } : {}),
});

async function publish(name: string, graph: WorkflowGraph) {
  const wf = await h.call(admin, 'POST', '/api/v1/workflows', { name, triggerKey: 'core.form-submission' });
  expect(wf.status).toBe(201);
  const patched = await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, { draft: graph });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  expect(patched.body.issues).toEqual([]);
  expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
  return wf.body.id as string;
}

/** A request form attached to a workflow, submitted by the requester. */
async function requestWith(key: string, graph: WorkflowGraph) {
  const wf = await publish(`Workflow ${key}`, graph);
  await t.mkForm(key, { elements: [t.field('asset', 'text')] }, { workflowDefinitionId: wf });
  return t.submit(s.requester!, key, { asset: 'Laptop' });
}

const open = (instanceId: string) =>
  h.kernel.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));

async function pendingTask(instanceId: string, who: string) {
  const list = await t.eventually(
    () => open(instanceId),
    (rows) => rows.some((r) => r.assigneeId === who),
  );
  const task = list.find((r) => r.assigneeId === who);
  expect(task, `no pending task for ${who}`).toBeDefined();
  return task!;
}

const decide = (who: string, taskId: string, verdict: 'approve' | 'reject', body: Record<string, unknown>) =>
  h.call(s[who]!, 'POST', `/api/v1/approvals/${taskId}/${verdict}`, body);

const instance = async (id: string) =>
  (await h.kernel.db.select().from(workflowInstances).where(eq(workflowInstances.id, id)))[0]!;

const tasksOf = (instanceId: string, stepId: string) =>
  h.kernel.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.stepId, stepId)));

beforeAll(async () => {
  // Core only: workflows, forms and approvals are all core.
  process.env.ISBP_TEST_MODULES = MODULES ?? '';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  for (const u of ['requester', 'pat', 'quinn', 'rae', 'dana']) {
    ids[u] = await t.mkUser(u);
    s[u] = await h.login(u);
  }
  const [team] = await h.kernel.db
    .insert(groups)
    .values({ key: 'repeat-team', name: 'Repeat team' })
    .returning();
  await h.kernel.db.insert(groupMembers).values([
    { groupId: team!.id, userId: ids.pat! },
    { groupId: team!.id, userId: ids.quinn! },
  ]);
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('a person’s earlier approval counts at a later step', () => {
  it('approves the step at once: nobody is asked, the timeline and audit log say why', async () => {
    const sub = await requestWith('skip-basic', graphOf(approval('second', [teamRule]), 'skip'));
    const instanceId = sub.workflow.id as string;
    const task = await pendingTask(instanceId, ids.pat!);

    const res = await decide('pat', task.id, 'approve', {});
    expect(res.body.outcome).toBe('approved');

    const inst = await instance(instanceId);
    expect(inst.status).toBe('approved');
    expect(inst.state.steps.second).toEqual({
      status: 'approved',
      reason: 'already-approved',
      from: 'first',
    });
    // One task for the second step: Pat's, approved, decided by Pat. Quinn is not asked.
    const second = await tasksOf(instanceId, 'second');
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ assigneeId: ids.pat, status: 'approved', decidedById: ids.pat });
    expect(await open(instanceId)).toHaveLength(0);
    // No notification was sent about the second step.
    const notes = await h.kernel.db.select().from(notifications).where(eq(notifications.userId, ids.pat!));
    expect(notes.filter((n) => (n.data as LooseJson | null)?.stepId === 'second')).toEqual([]);

    const events = await h.kernel.db
      .select()
      .from(workflowEvents)
      .where(
        and(eq(workflowEvents.instanceId, instanceId), eq(workflowEvents.type, 'task_already_approved')),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stepId: 'second', actorId: ids.pat, data: { fromStepId: 'first' } });
    const audit = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.approval.already_approved'), eq(auditLogs.entityId, instanceId)));
    expect(audit).toHaveLength(1);
  });

  it('asks them again when the workflow does not skip (by default, and with ask)', async () => {
    for (const [key, policy] of [
      ['ask-default', undefined],
      ['ask-explicit', 'ask'],
    ] as const) {
      const sub = await requestWith(key, graphOf(approval('second', [teamRule]), policy));
      const instanceId = sub.workflow.id as string;
      await decide('pat', (await pendingTask(instanceId, ids.pat!)).id, 'approve', {});
      expect((await instance(instanceId)).status).toBe('running');
      // Both members of the team are asked for the second step, Pat included.
      expect(await pendingTask(instanceId, ids.pat!)).toBeDefined();
      expect(await pendingTask(instanceId, ids.quinn!)).toBeDefined();
    }
  });

  it('with every approver required, the slots that did not count still decide', async () => {
    const second = approval('second', [teamRule, userRule(ids.quinn!)], { mode: 'all' });
    const sub = await requestWith('skip-all', graphOf(second, 'skip'));
    const instanceId = sub.workflow.id as string;
    await decide('pat', (await pendingTask(instanceId, ids.pat!)).id, 'approve', {});

    // The team slot counted (Pat), so only Quinn's own slot is still open.
    expect((await instance(instanceId)).status).toBe('running');
    expect((await open(instanceId)).map((r) => [r.stepId, r.assigneeId])).toEqual([['second', ids.quinn]]);
    await decide('quinn', (await pendingTask(instanceId, ids.quinn!)).id, 'approve', {});
    expect((await instance(instanceId)).status).toBe('approved');
  });

  it('a rejection never counts', async () => {
    const first = approval('first', [userRule(ids.pat!), userRule(ids.rae!)], { mode: 'quorum', quorum: 1 });
    const sub = await requestWith('skip-rejected', graphOf(approval('second', [teamRule]), 'skip', first));
    const instanceId = sub.workflow.id as string;
    const patTask = await pendingTask(instanceId, ids.pat!);
    const raeTask = await pendingTask(instanceId, ids.rae!);

    expect((await decide('pat', patTask.id, 'reject', { comment: 'Not this time' })).status).toBe(200);
    expect((await instance(instanceId)).status).toBe('running');
    await decide('rae', raeTask.id, 'approve', {});

    // Pat rejected the first step, so at the second step Pat is asked like anyone else.
    expect(await pendingTask(instanceId, ids.pat!)).toBeDefined();
    expect(await pendingTask(instanceId, ids.quinn!)).toBeDefined();
  });

  it('a delegate’s approval counts for the person who decided, not for the person who handed over', async () => {
    const first = approval('first', [userRule(ids.pat!)]);
    const second = approval('second', [userRule(ids.pat!), userRule(ids.dana!)], { mode: 'all' });
    const sub = await requestWith('skip-delegate', graphOf(second, 'skip', first));
    const instanceId = sub.workflow.id as string;
    const patTask = await pendingTask(instanceId, ids.pat!);

    const handed = await h.call(s.pat!, 'POST', `/api/v1/approvals/${patTask.id}/delegate`, {
      userId: ids.dana,
    });
    expect(handed.status).toBeLessThan(300);
    await decide('dana', (await pendingTask(instanceId, ids.dana!)).id, 'approve', {});

    // Dana decided the first step, so Dana is counted at the second; Pat never decided it and is asked.
    expect((await instance(instanceId)).status).toBe('running');
    expect((await open(instanceId)).map((r) => [r.stepId, r.assigneeId])).toEqual([['second', ids.pat]]);
    await decide('pat', (await pendingTask(instanceId, ids.pat!)).id, 'approve', {});
    expect((await instance(instanceId)).status).toBe('approved');
  });

  it('handing a task to someone who already approved an earlier step counts it at once', async () => {
    const first = approval('first', [userRule(ids.dana!)]);
    const sub = await requestWith(
      'skip-handover',
      graphOf(approval('second', [userRule(ids.pat!)]), 'skip', first),
    );
    const instanceId = sub.workflow.id as string;
    await decide('dana', (await pendingTask(instanceId, ids.dana!)).id, 'approve', {});
    const patTask = await pendingTask(instanceId, ids.pat!);

    const handed = await h.call(s.pat!, 'POST', `/api/v1/approvals/${patTask.id}/delegate`, {
      userId: ids.dana,
    });
    expect(handed.status).toBeLessThan(300);
    expect((await instance(instanceId)).status).toBe('approved');
    const rows = await tasksOf(instanceId, 'second');
    expect(rows.find((r) => r.assigneeId === ids.dana)).toMatchObject({
      status: 'approved',
      decidedById: ids.dana,
    });
    expect(rows.find((r) => r.assigneeId === ids.pat)).toMatchObject({ status: 'delegated' });
    expect(await open(instanceId)).toHaveLength(0);
  });

  it('an escalation to someone who already approved an earlier step settles the slot', async () => {
    const first = approval('first', [userRule(ids.quinn!)]);
    const second: WorkflowStep = {
      id: 'second',
      type: 'approval',
      name: en('Second approval'),
      approvers: [userRule(ids.pat!)],
      mode: 'any',
      sla: { dueHours: 1, onBreach: 'escalate', escalateTo: [userRule(ids.quinn!)] },
    };
    const sub = await requestWith('skip-escalate', graphOf(second, 'skip', first));
    const instanceId = sub.workflow.id as string;
    await decide('quinn', (await pendingTask(instanceId, ids.quinn!)).id, 'approve', {});
    const patTask = await pendingTask(instanceId, ids.pat!);
    expect((await instance(instanceId)).status).toBe('running');

    // Two hours later the deadline has passed: the step escalates to Quinn, whose earlier approval counts.
    await h.kernel.workflows.tick(new Date(Date.now() + 2 * 3_600_000));
    expect((await instance(instanceId)).status).toBe('approved');
    const [overdue] = await h.kernel.db.select().from(approvalTasks).where(eq(approvalTasks.id, patTask.id));
    expect(overdue).toMatchObject({ status: 'cancelled' });
    expect(overdue!.breachedAt).not.toBeNull();
    const escalated = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.assigneeId, ids.quinn!)));
    expect(escalated.filter((x) => x.stepId === 'second')).toEqual([
      expect.objectContaining({ status: 'approved', isEscalation: true, decidedById: ids.quinn }),
    ]);
  });
});

describe('the dry run shows the approval as already given', () => {
  it('"who will approve it" lists the step as already approved, or the person as counted', async () => {
    const all = approval('second', [teamRule, userRule(ids.quinn!)], { mode: 'all' });
    const anyWf = await publish('Preview any', graphOf(approval('second', [teamRule]), 'skip'));
    await t.mkForm('skip-preview', { elements: [t.field('asset', 'text')] }, { workflowDefinitionId: anyWf });
    const allWf = await publish('Preview all', graphOf(all, 'skip'));
    await t.mkForm(
      'skip-preview-all',
      { elements: [t.field('asset', 'text')] },
      { workflowDefinitionId: allWf },
    );
    const one = await h.call(s.requester!, 'POST', '/api/v1/forms/by-key/skip-preview/preview', {
      data: { asset: 'Laptop' },
    });
    expect(one.status).toBe(200);
    expect(one.body.steps.find((x: LooseJson) => x.id === 'first')).toMatchObject({
      outcome: 'ask',
      people: [{ id: ids.pat }],
    });
    expect(one.body.steps.find((x: LooseJson) => x.id === 'second')).toMatchObject({
      outcome: 'already-approved',
      people: [],
      counted: [{ person: { id: ids.pat }, approvedAt: { en: 'First approval' } }],
    });

    const every = await h.call(s.requester!, 'POST', '/api/v1/forms/by-key/skip-preview-all/preview', {
      data: { asset: 'Laptop' },
    });
    expect(every.body.steps.find((x: LooseJson) => x.id === 'second')).toMatchObject({
      outcome: 'ask',
      people: [{ id: ids.quinn }],
      counted: [{ person: { id: ids.pat }, approvedAt: { en: 'First approval' } }],
    });
  });
});
