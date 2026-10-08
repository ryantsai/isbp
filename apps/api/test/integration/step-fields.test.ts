/**
 * Phase 8 approval step fields (`ApprovalStep.fields`): what the approver fills in with a decision. Validated like form
 * answers (issues under `data.<key>`), required to approve (or to reject too with `fieldsRequiredOn: 'both'`),
 * stored with the decision (task, audit, timeline), returned in the request's `decisions`, and facts
 * `steps.<stepId>.<key>` for later steps' conditions and process action templates.
 */
import { approvalTasks, auditLogs, notifications, workflowEvents, workflowInstances } from '@isbp/db/schema';
import type { FieldDef, FormAction, WorkflowGraph } from '@isbp/sdk/server';
import { and, asc, eq } from 'drizzle-orm';
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

/** The "filled in by IT" part of a disposal form: result, wipe date, notes and a related request. */
const reviewFields: FieldDef[] = [
  {
    key: 'result',
    type: 'select',
    label: en('Evaluation result'),
    required: true,
    options: [
      { value: 'ok', label: en('OK to dispose') },
      { value: 'cab', label: en('Needs the CAB') },
    ],
  },
  { key: 'wipedOn', type: 'date', label: en('Wiped on'), required: true },
  { key: 'notes', type: 'textarea', label: en('Handling notes') },
  { key: 'related', type: 'record', label: en('Related request'), record: { types: ['core.request'] } },
];

/** Review (with fields) → a condition on `steps.review.result` → the CAB only when the reviewer asks for it. */
const disposalGraph = (): WorkflowGraph => ({
  steps: [
    {
      id: 'review',
      type: 'approval',
      name: en('IT review'),
      approvers: [{ type: 'user', userId: ids.reviewer! }],
      mode: 'any',
      fields: reviewFields,
    },
    {
      id: 'route',
      type: 'condition',
      name: en('Route'),
      branches: [
        {
          id: 'to-cab',
          name: en('To the CAB'),
          when: { fact: 'steps.review.result', op: 'eq', value: 'cab' },
          steps: [
            {
              id: 'cab',
              type: 'approval',
              name: en('CAB'),
              approvers: [{ type: 'user', userId: ids.cab! }],
              mode: 'any',
            },
          ],
        },
      ],
      otherwise: { id: 'direct', name: en('Direct'), steps: [] },
    },
  ],
});

/** One review whose required field is needed to reject too. */
const strictGraph = (): WorkflowGraph => ({
  steps: [
    {
      id: 'strict',
      type: 'approval',
      name: en('Strict review'),
      approvers: [{ type: 'user', userId: ids.reviewer! }],
      mode: 'any',
      fields: [reviewFields[0]!, reviewFields[2]!],
      fieldsRequiredOn: 'both',
    },
  ],
});

const notifyResult: FormAction = {
  id: 'tell',
  on: 'approved',
  type: 'core.notify',
  config: {
    toRequester: true,
    title: 'Disposal {{request.reference}}: {{steps.review.result}}',
    message: 'Wiped on {{steps.review.wipedOn}}. {{steps.review.notes}}',
  },
};

async function publishWorkflow(name: string, graph: WorkflowGraph) {
  const wf = await h.call(admin, 'POST', '/api/v1/workflows', { name, triggerKey: 'core.form-submission' });
  expect(wf.status).toBe(201);
  const patched = await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, { draft: graph });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  expect(patched.body.issues).toEqual([]);
  expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
  return wf.body.id as string;
}

const pending = (instanceId: string) =>
  h.kernel.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));

async function pendingTask(instanceId: string, assigneeId: string) {
  const list = await t.eventually(
    () => pending(instanceId),
    (rows) => rows.some((r) => r.assigneeId === assigneeId),
  );
  const task = list.find((r) => r.assigneeId === assigneeId);
  expect(task, `no pending task for ${assigneeId}`).toBeDefined();
  return task!;
}

const decide = (who: string, taskId: string, verdict: 'approve' | 'reject', body: Record<string, unknown>) =>
  h.call(s[who]!, 'POST', `/api/v1/approvals/${taskId}/${verdict}`, body);

const issues = (res: { body: LooseJson }) =>
  (res.body.error.details.issues as { path: string; code: string }[]).map((i) => [i.path, i.code]).sort();

const instance = async (id: string) =>
  (await h.kernel.db.select().from(workflowInstances).where(eq(workflowInstances.id, id)))[0]!;

const settled = (id: string) =>
  t.eventually(
    () => instance(id),
    (i) => i.status !== 'running',
  );

const detail = async (who: string, reference: string) => {
  const res = await h.call(s[who]!, 'GET', `/api/v1/requests/${reference}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.submission as LooseJson;
};

beforeAll(async () => {
  // Core only: step fields, `core.request` and `core.notify` are all core.
  process.env.ISBP_TEST_MODULES = MODULES ?? '';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  for (const u of ['requester', 'reviewer', 'cab', 'other']) {
    ids[u] = await t.mkUser(u);
    s[u] = await h.login(u);
  }
  const disposal = await publishWorkflow('Disposal review', disposalGraph());
  const strict = await publishWorkflow('Strict review', strictGraph());
  await t.mkForm(
    'disposal',
    { elements: [t.field('asset', 'text', { required: true })], actions: [notifyResult] },
    { workflowDefinitionId: disposal },
  );
  await t.mkForm('strict', { elements: [t.field('asset', 'text')] }, { workflowDefinitionId: strict });
  // No approval: a request the reviewer is not involved in.
  await t.mkForm('plain', { elements: [t.field('what', 'text')] });
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('step fields in the workflow and the inbox', () => {
  it('returns the fields with the task in the approver’s inbox', async () => {
    const sub = await t.submit(s.requester!, 'disposal', { asset: 'Laptop TPE-0001' });
    await pendingTask(sub.workflow.id, ids.reviewer!);
    const inbox = await h.call(s.reviewer!, 'GET', '/api/v1/me/approvals');
    expect(inbox.status).toBe(200);
    const item = inbox.body.items.find(
      (i: LooseJson) => i.instance.subject.href === `/requests/${sub.reference}`,
    );
    expect(item.step.fieldsRequiredOn).toBe('approve');
    expect(item.step.fields.map((f: FieldDef) => f.key)).toEqual(['result', 'wipedOn', 'notes', 'related']);
  });

  it('flags a condition on a step field that is not before it, or that the step lacks', async () => {
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Bad step facts',
      triggerKey: 'core.form-submission',
    });
    const graph = disposalGraph();
    // Reads a field the review doesn't have.
    const route = graph.steps[1]!;
    if (route.type === 'condition') route.branches[0]!.when = { fact: 'steps.review.nope', op: 'notEmpty' };
    const patched = await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, { draft: graph });
    expect(patched.body.issues).toEqual([{ stepId: 'route', code: 'stepFact' }]);
    // Reads the review's field before the review.
    const before = await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: { steps: [...disposalGraph().steps].reverse() },
    });
    expect(before.body.issues).toContainEqual({ stepId: 'route', code: 'stepFact' });
    const publish = await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`);
    expect(publish.status).toBe(409);
    expect(publish.body.error.code).toBe('WORKFLOW_INVALID');
  });
});

describe('deciding with step fields', () => {
  it('refuses to approve without the required fields, with issues under data.<key>', async () => {
    const sub = await t.submit(s.requester!, 'disposal', { asset: 'Laptop TPE-0002' });
    const task = await pendingTask(sub.workflow.id, ids.reviewer!);

    const missing = await decide('reviewer', task.id, 'approve', { comment: 'Looks fine' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');
    expect(issues(missing)).toEqual([
      ['data.result', 'required'],
      ['data.wipedOn', 'required'],
    ]);

    const invalid = await decide('reviewer', task.id, 'approve', {
      data: { result: 'maybe', wipedOn: '2026-02-30' },
    });
    expect(invalid.status).toBe(400);
    expect(issues(invalid)).toEqual([
      ['data.result', 'option'],
      ['data.wipedOn', 'date'],
    ]);

    // Nothing was decided or recorded.
    const [still] = await h.kernel.db.select().from(approvalTasks).where(eq(approvalTasks.id, task.id));
    expect(still).toMatchObject({ status: 'pending', data: null });
    expect((await instance(sub.workflow.id)).facts).not.toHaveProperty('steps');
  });

  it('rejects without the fields when they are only required to approve, but still checks what is given', async () => {
    const sub = await t.submit(s.requester!, 'disposal', { asset: 'Laptop TPE-0003' });
    const task = await pendingTask(sub.workflow.id, ids.reviewer!);
    const bad = await decide('reviewer', task.id, 'reject', {
      comment: 'Still in use',
      data: { wipedOn: 'yesterday' },
    });
    expect(bad.status).toBe(400);
    expect(issues(bad)).toEqual([['data.wipedOn', 'date']]);

    const res = await decide('reviewer', task.id, 'reject', { comment: 'Still in use' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe('rejected');
    const [row] = await h.kernel.db.select().from(approvalTasks).where(eq(approvalTasks.id, task.id));
    expect(row).toMatchObject({ status: 'rejected', comment: 'Still in use', data: null });
    const submission = await detail('requester', sub.reference);
    expect(submission.decisions).toEqual([
      expect.objectContaining({ stepId: 'review', status: 'rejected', comment: 'Still in use', data: {} }),
    ]);
  });

  it('needs the required fields to reject too when the step says "both"', async () => {
    const sub = await t.submit(s.requester!, 'strict', { asset: 'Server TPE-SRV-9' });
    const task = await pendingTask(sub.workflow.id, ids.reviewer!);
    const missing = await decide('reviewer', task.id, 'reject', { comment: 'Not ours' });
    expect(missing.status).toBe(400);
    expect(issues(missing)).toEqual([['data.result', 'required']]);

    const res = await decide('reviewer', task.id, 'reject', {
      comment: 'Not ours',
      data: { result: 'cab', notes: 'Send it to the CAB instead' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe('rejected');
    const submission = await detail('requester', sub.reference);
    expect(submission.decisions).toEqual([
      expect.objectContaining({
        stepId: 'strict',
        status: 'rejected',
        data: { result: 'cab', notes: 'Send it to the CAB instead' },
      }),
    ]);
  });
});

describe('what the approver filled in', () => {
  let direct: LooseJson;

  it('is stored with the decision, in the audit trail, the timeline and the facts', async () => {
    direct = await t.submit(s.requester!, 'disposal', { asset: 'Laptop TPE-0004' });
    const task = await pendingTask(direct.workflow.id, ids.reviewer!);
    const res = await decide('reviewer', task.id, 'approve', {
      comment: 'Wiped and checked',
      data: {
        result: 'ok',
        wipedOn: '2026-10-01',
        notes: '  Disk shredded  ',
        related: `core.request:${direct.id}`,
        unknown: 'dropped',
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // "ok": the condition takes the empty default branch, so the review was the last decision.
    expect(res.body.outcome).toBe('approved');

    const values = {
      result: 'ok',
      wipedOn: '2026-10-01',
      notes: 'Disk shredded',
      related: `core.request:${direct.id}`,
    };
    const [row] = await h.kernel.db.select().from(approvalTasks).where(eq(approvalTasks.id, task.id));
    expect(row).toMatchObject({ status: 'approved', data: values });
    expect((await instance(direct.workflow.id)).facts).toMatchObject({ steps: { review: values } });

    const [audit] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.approval.approved'), eq(auditLogs.entityId, direct.workflow.id)));
    expect(audit!.metadata).toMatchObject({ stepId: 'review', comment: 'Wiped and checked', fields: values });
    const events = await h.kernel.db
      .select()
      .from(workflowEvents)
      .where(
        and(eq(workflowEvents.instanceId, direct.workflow.id), eq(workflowEvents.type, 'task_approved')),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ fields: values });
    // The CAB was never asked.
    expect(
      (
        await h.kernel.db.select().from(approvalTasks).where(eq(approvalTasks.instanceId, direct.workflow.id))
      ).map((x) => x.stepId),
    ).toEqual(['review']);
  });

  it('is returned in the request’s decisions, with the step’s fields', async () => {
    await t.eventually(
      () => detail('requester', direct.reference),
      (sub) => sub.status === 'approved',
    );
    const submission = await detail('requester', direct.reference);
    expect(submission.status).toBe('approved');
    expect(submission.decisions).toHaveLength(1);
    const [decision] = submission.decisions;
    expect(decision).toMatchObject({
      stepId: 'review',
      step: { en: 'IT review' },
      status: 'approved',
      comment: 'Wiped and checked',
      decidedBy: { id: ids.reviewer },
      data: {
        result: 'ok',
        wipedOn: '2026-10-01',
        notes: 'Disk shredded',
        related: `core.request:${direct.id}`,
      },
    });
    expect(decision.fields.map((f: FieldDef) => f.key)).toEqual(['result', 'wipedOn', 'notes', 'related']);
    // The workflow detail shows the values on the task too.
    const wf = await h.call(s.requester!, 'GET', `/api/v1/workflow-instances/${direct.workflow.id}`);
    expect(wf.status).toBe(200);
    expect(wf.body.tasks[0].data).toMatchObject({ result: 'ok' });
  });

  it('routes a later condition step on steps.<id>.<key>', async () => {
    const sub = await t.submit(s.requester!, 'disposal', { asset: 'Storage TPE-NAS-2' });
    const review = await pendingTask(sub.workflow.id, ids.reviewer!);
    const res = await decide('reviewer', review.id, 'approve', {
      data: { result: 'cab', wipedOn: '2026-10-02', notes: 'Holds finance archives' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe('running');
    const cab = await pendingTask(sub.workflow.id, ids.cab!);
    expect(cab.stepId).toBe('cab');
    expect((await decide('cab', cab.id, 'approve', {})).status).toBe(200);
    expect((await settled(sub.workflow.id)).status).toBe('approved');

    const submission = await t.eventually(
      () => detail('requester', sub.reference),
      (x) => x.status === 'approved',
    );
    expect(
      submission.decisions.map((d: LooseJson) => [d.stepId, d.status, Object.keys(d.data).length]),
    ).toEqual([
      ['review', 'approved', 3],
      ['cab', 'approved', 0],
    ]);
    const events = await h.kernel.db
      .select({ type: workflowEvents.type, stepId: workflowEvents.stepId })
      .from(workflowEvents)
      .where(eq(workflowEvents.instanceId, sub.workflow.id))
      .orderBy(asc(workflowEvents.seq));
    expect(events.filter((e) => e.stepId === 'cab').map((e) => e.type)).toContain('task_approved');
  });

  it('renders {{steps.<id>.<key>}} in a process action template', async () => {
    const titles = async () =>
      h.kernel.db
        .select({ title: notifications.title, body: notifications.body })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, ids.requester!),
            eq(notifications.type, 'core.process-action.message'),
          ),
        );
    const sent = await t.eventually(titles, (list) => list.length >= 2);
    expect(sent).toEqual(
      expect.arrayContaining([
        {
          title: `Disposal ${direct.reference}: ok`,
          body: expect.stringContaining('Wiped on 2026-10-01. Disk shredded'),
        },
        expect.objectContaining({ title: expect.stringMatching(/^Disposal REQ-\d+: cab$/) }),
      ]),
    );
    const [run] = await t.settledRuns(direct.id);
    expect(run!.status, run!.error ?? '').toBe('succeeded');
  });

  it('refuses a record the approver can’t read, and accepts one they can', async () => {
    // Someone else's request, without an approval: the reviewer can't see it.
    const theirs = await t.submit(s.other!, 'plain', { what: 'A keyboard' });
    const sub = await t.submit(s.requester!, 'disposal', { asset: 'Laptop TPE-0005' });
    const task = await pendingTask(sub.workflow.id, ids.reviewer!);
    const data = { result: 'ok', wipedOn: '2026-10-03' };

    const refused = await decide('reviewer', task.id, 'approve', {
      data: { ...data, related: `core.request:${theirs.id}` },
    });
    expect(refused.status).toBe(400);
    expect(issues(refused)).toEqual([['data.related', 'record']]);
    const malformed = await decide('reviewer', task.id, 'approve', {
      data: { ...data, related: `core.nothing:${theirs.id}` },
    });
    expect(malformed.status).toBe(400);
    expect(issues(malformed)).toEqual([['data.related', 'record']]);

    // The request being decided is one the reviewer may read (they were asked to approve it).
    const ok = await decide('reviewer', task.id, 'approve', {
      data: { ...data, related: `core.request:${sub.id}` },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('only lets the assignee decide', async () => {
    const sub = await t.submit(s.requester!, 'disposal', { asset: 'Laptop TPE-0006' });
    const task = await pendingTask(sub.workflow.id, ids.reviewer!);
    const res = await decide('other', task.id, 'approve', { data: { result: 'ok', wipedOn: '2026-10-04' } });
    expect(res.status).toBe(403);
    const [row] = await h.kernel.db.select().from(approvalTasks).where(eq(approvalTasks.id, task.id));
    expect(row).toMatchObject({ status: 'pending', data: null });
  });
});
