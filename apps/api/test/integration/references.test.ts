import type { FormAction } from '@isbp/sdk/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

/**
 * Deletes are refused (`IN_USE`, listing what uses it) while open work or live settings still name a group or a
 * record: they would otherwise fail later, after the person who deleted it moved on (decision 93).
 */

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const t = processActionHelpers(() => ({ h, admin }));

const mkGroup = async (key: string, members: string[] = []) => {
  const g = await h.call(admin, 'POST', '/api/v1/groups', { key, name: `Group ${key}` });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  if (members.length)
    expect(
      (await h.call(admin, 'POST', `/api/v1/groups/${g.body.id}/members`, { userIds: members })).status,
    ).toBe(200);
  return g.body as LooseJson;
};

const notifyGroup = (groupId: string): FormAction => ({
  id: 'tell',
  on: 'approved',
  type: 'core.notify',
  config: { groups: [groupId], title: 'Approved', message: 'A request was approved' },
});

const refusal = (res: { status: number; body: LooseJson }) => {
  expect(res.status, JSON.stringify(res.body)).toBe(409);
  expect(res.body.error.code).toBe('IN_USE');
  return res.body.error.details.references as LooseJson[];
};

const deleted = (res: { status: number; body: LooseJson }) =>
  expect([200, 204], JSON.stringify(res.body)).toContain(res.status);

/** A decided request leaves "pending" when the outcome is delivered (outbox): retry the delete until then. */
const deletedOnceSettled = async (url: string) =>
  deleted(
    await t.eventually(
      () => h.call(admin, 'DELETE', url),
      (r) => r.status !== 409,
    ),
  );

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  for (const u of ['mei', 'approver']) {
    ids[u] = await t.mkUser(u);
    s[u] = await h.login(u);
  }
  ids.workflow = await t.approvalWorkflow('Approver decides', ids.approver!);
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('deleting a group', () => {
  it('is refused while a published form acts on it, and allowed once the form is archived', async () => {
    const group = await mkGroup('ref-setting');
    const form = await t.mkForm('ref-notify', {
      elements: [t.field('what', 'text')],
      actions: [notifyGroup(group.id)],
    });
    const refs = refusal(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`));
    expect(refs).toEqual([
      { kind: 'setting', label: { en: 'ref-notify' }, href: `/admin/forms/${form.id}`, module: 'core' },
    ]);
    expect((await h.call(admin, 'POST', `/api/v1/forms/${form.id}/archive`)).status).toBe(200);
    deleted(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`));
  });

  it('is refused while a request in approval would act on it, until the request is decided', async () => {
    const group = await mkGroup('ref-request');
    const form = await t.mkForm(
      'ref-pending',
      { elements: [t.field('what', 'text')], actions: [notifyGroup(group.id)] },
      { workflowDefinitionId: ids.workflow },
    );
    const sub = await t.submit(s.mei!, 'ref-pending', { what: 'a monitor' });
    expect(sub.status).toBe('pending');
    // The live setting is gone; the request still runs the version it was sent with.
    expect((await h.call(admin, 'POST', `/api/v1/forms/${form.id}/archive`)).status).toBe(200);
    const refs = refusal(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`));
    expect(refs).toEqual([
      {
        kind: 'request',
        label: { en: `${sub.reference} · ref-pending` },
        href: `/requests/${sub.reference}`,
        module: 'core',
      },
    ]);
    // Rejected: the "approved" action never runs, so nothing needs the group any more.
    await t.decide(sub.workflow.id, s.approver!, 'reject');
    await deletedOnceSettled(`/api/v1/groups/${group.id}`);
  });

  it('is refused while an approval names it by key, and while its approval process is published', async () => {
    const group = await mkGroup('ref-approvers', [ids.approver!]);
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Group decides',
      triggerKey: 'core.form-submission',
    });
    await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: 'ok',
            type: 'approval',
            name: { en: 'Approve' },
            approvers: [{ type: 'group', groupKey: 'ref-approvers' }],
            mode: 'any',
          },
        ],
      },
    });
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    const form = await t.mkForm(
      'ref-group-approval',
      { elements: [t.field('what', 'text')] },
      { workflowDefinitionId: wf.body.id },
    );
    const sub = await t.submit(s.mei!, 'ref-group-approval', { what: 'a desk' });

    const refs = refusal(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`));
    expect(refs.map((r) => r.kind)).toEqual(['approval', 'setting']);
    expect(refs[1]).toMatchObject({ label: 'Group decides', href: `/admin/workflows/${wf.body.id}` });

    await t.decide(sub.workflow.id, s.approver!, 'approve');
    expect(refusal(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`)).map((r) => r.kind)).toEqual([
      'setting',
    ]);
    expect((await h.call(admin, 'POST', `/api/v1/forms/${form.id}/archive`)).status).toBe(200);
    const archived = await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/archive`);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    deleted(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`));
  });

  it('is refused while an open to-do is assigned to it', async () => {
    const group = await mkGroup('ref-todo', [ids.mei!]);
    const form = await t.mkForm('ref-checklist', { elements: [t.field('ok', 'boolean')] });
    const todo = await h.call(admin, 'POST', `/api/v1/forms/${form.id}/assignments`, {
      assignee: { type: 'group', groupKey: 'ref-todo' },
      title: 'Server room check',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(todo.status, JSON.stringify(todo.body)).toBe(201);
    expect(refusal(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`))).toEqual([
      {
        kind: 'todo',
        label: 'Server room check',
        href: `/admin/forms/${form.id}?tab=assignments`,
        module: 'core',
      },
    ]);
    expect((await h.call(admin, 'POST', `/api/v1/form-assignments/${todo.body.id}/cancel`, {})).status).toBe(
      200,
    );
    deleted(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`));
  });

  it("is refused while service desk tickets are open in the group's queue", async () => {
    const group = await mkGroup('ref-queue');
    const ticket = await h.call(admin, 'POST', '/api/v1/itsm/tickets', {
      title: 'VPN drops',
      assignmentGroupId: group.id,
    });
    expect(ticket.status, JSON.stringify(ticket.body)).toBe(201);
    const ref = ticket.body.reference as string;
    expect(refusal(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`))).toEqual([
      { kind: 'work', label: `${ref} · VPN drops`, href: `/itsm/tickets/${ref}`, module: 'itsm' },
    ]);
  });

  it('is allowed when nothing uses it', async () => {
    const group = await mkGroup('ref-unused', [ids.mei!]);
    deleted(await h.call(admin, 'DELETE', `/api/v1/groups/${group.id}`));
  });
});

describe('deleting a record', () => {
  it('refuses a configuration item a request in approval names, and allows it once the request is decided', async () => {
    const ci = await h.call(admin, 'POST', '/api/v1/cmdb/cis', { name: 'ref-db-01', classKey: 'server' });
    expect(ci.status, JSON.stringify(ci.body)).toBe(201);
    await t.mkForm(
      'ref-config-change',
      {
        elements: [t.field('ci', 'record', { record: { types: ['cmdb.ci'] } }), t.field('what', 'text')],
      },
      { workflowDefinitionId: ids.workflow },
    );
    // The requester must be able to see the CI they name.
    const sub = await t.submit(admin, 'ref-config-change', {
      ci: `cmdb.ci:${ci.body.id}`,
      what: 'more memory',
    });
    const refs = refusal(await h.call(admin, 'DELETE', `/api/v1/cmdb/cis/${ci.body.id}`));
    expect(refs).toEqual([
      {
        kind: 'request',
        label: { en: `${sub.reference} · ref-config-change` },
        href: `/requests/${sub.reference}`,
        module: 'core',
      },
    ]);
    await t.decide(sub.workflow.id, s.approver!, 'reject');
    await deletedOnceSettled(`/api/v1/cmdb/cis/${ci.body.id}`);
  });
});
