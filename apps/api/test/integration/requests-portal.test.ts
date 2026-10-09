/**
 * The requester's side of a request. "My requests" finds a request by its reference (REQ-01042, whole or in part, in any
 * case), and the approval path a requester sees (`/requests/:reference/path`) says who decided, who is asked now and who
 * comes next: no rule text, and only to the people who can see the request.
 */
import { approvalTasks } from '@isbp/db/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

let h: Harness;
let admin: Session;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const t = processActionHelpers(() => ({ h, admin }));
const MODULES = process.env.ISBP_TEST_MODULES;

async function role(key: string, permissions: string[], usernames: string[]) {
  const created = await h.call(admin, 'POST', '/api/v1/roles', { key, name: key, permissions });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  for (const u of usernames) {
    const assigned = await h.call(admin, 'POST', '/api/v1/role-assignments', {
      roleId: created.body.id,
      principalType: 'user',
      principalId: ids[u],
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
  }
}

const path = (who: string, reference: string) =>
  h.call(s[who]!, 'GET', `/api/v1/requests/${encodeURIComponent(reference)}/path`);

const oneTask = (instanceId: string) =>
  h.kernel.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));

beforeAll(async () => {
  // Core only: the requests and the approval path are core features.
  process.env.ISBP_TEST_MODULES = MODULES ?? '';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  admin = await h.login('admin');
  for (const u of ['requester', 'manager', 'finance', 'stranger']) ids[u] = await t.mkUser(u);
  for (const u of Object.keys(ids)) s[u] = await h.login(u);
  await role('rp-forms-reader', ['core.forms.read'], ['requester', 'stranger', 'manager', 'finance']);

  // Two approval steps in order: the manager, then finance.
  const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
    name: 'Requests portal: two steps',
    triggerKey: 'core.form-submission',
  });
  expect(wf.status, JSON.stringify(wf.body)).toBe(201);
  await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
    draft: {
      steps: [
        {
          id: 'manager',
          type: 'approval',
          name: { en: 'Manager approval' },
          approvers: [{ type: 'user', userId: ids.manager }],
          mode: 'any',
        },
        {
          id: 'finance',
          type: 'approval',
          name: { en: 'Finance approval' },
          approvers: [{ type: 'user', userId: ids.finance }],
          mode: 'any',
        },
      ],
    },
  });
  expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
  await t.mkForm('rp-laptop', { elements: [t.field('what', 'text')] }, { workflowDefinitionId: wf.body.id });
  await t.mkForm('rp-plain', { elements: [t.field('what', 'text')] });
});

afterAll(async () => {
  await h?.close();
});

describe('My requests finds a request by its reference', () => {
  it('matches the whole REQ- number, in any case, and a part of it', async () => {
    const sent = await t.submit(s.requester!, 'rp-laptop', { what: 'A laptop for search' });
    const reference: string = sent.reference;
    expect(reference).toMatch(/^REQ-\d{5}$/);

    for (const q of [reference, reference.toLowerCase(), reference.slice(0, 7)]) {
      const res = await h.call(s.requester!, 'GET', `/api/v1/me/requests?q=${encodeURIComponent(q)}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const refs = (res.body.items as { reference: string }[]).map((r) => r.reference);
      expect(refs, `q=${q}`).toContain(reference);
    }

    const other = await h.call(
      s.requester!,
      'GET',
      `/api/v1/me/requests?q=${encodeURIComponent('REQ-99999')}`,
    );
    expect((other.body.items as { reference: string }[]).map((r) => r.reference)).not.toContain(reference);
  });

  it('keeps matching by the form name', async () => {
    const res = await h.call(s.requester!, 'GET', '/api/v1/me/requests?q=rp-laptop');
    expect(res.status).toBe(200);
    expect((res.body.items as { kind: string }[]).some((r) => r.kind === 'form')).toBe(true);
  });
});

describe('the approval path a requester sees', () => {
  let sent: LooseJson;

  it('shows the first step as waiting, the next as resolved, with no rule text', async () => {
    sent = await t.submit(s.requester!, 'rp-laptop', { what: 'A laptop for the path' });
    const res = await path('requester', sent.reference);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.nextStepId).toBe('manager');
    const [manager, finance] = res.body.steps as LooseJson[];
    expect(manager.id).toBe('manager');
    expect(manager.state).toBe('current');
    expect(manager.people.map((p: LooseJson) => p.id)).toEqual([ids.manager]);
    expect(manager.since).toEqual(expect.any(String));
    expect(finance.id).toBe('finance');
    expect(finance.state).toBe('upcoming');
    expect(finance.people.map((p: LooseJson) => p.id)).toEqual([ids.finance]);
    // Nothing in the answer describes rules, branches or fields.
    expect(JSON.stringify(res.body)).not.toMatch(/approvers|rule|fact|graph/i);
  });

  it('moves on when the manager approves, and ends approved after finance', async () => {
    const [task] = await oneTask(sent.workflow.id);
    expect(task!.assigneeId).toBe(ids.manager);
    const instanceId = sent.workflow.id as string;
    // The manager decides, then finance does.
    const managerSession = s.manager!;
    const first = await h.call(managerSession, 'POST', `/api/v1/approvals/${task!.id}/approve`, {});
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const mid = await path('requester', sent.reference);
    expect(mid.body.nextStepId).toBe('finance');
    expect(mid.body.steps[0]).toMatchObject({ id: 'manager', state: 'done' });
    expect(mid.body.steps[0].people.map((p: LooseJson) => p.id)).toEqual([ids.manager]);
    expect(mid.body.steps[0].decidedAt).toEqual(expect.any(String));
    expect(mid.body.steps[1]).toMatchObject({ id: 'finance', state: 'current' });

    const [financeTask] = await oneTask(instanceId);
    const second = await h.call(s.finance!, 'POST', `/api/v1/approvals/${financeTask!.id}/approve`, {});
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const end = await path('requester', sent.reference);
    expect(end.body.status).toBe('approved');
    expect(end.body.nextStepId).toBeNull();
    expect(end.body.steps.map((x: LooseJson) => x.state)).toEqual(['done', 'done']);
  });

  it('is not shown to people who cannot see the request', async () => {
    const res = await path('stranger', sent.reference);
    expect(res.status).toBe(404);
  });

  it('is empty for a request that needs no approval', async () => {
    const plain = await t.submit(s.requester!, 'rp-plain', { what: 'A pen' });
    const res = await path('requester', plain.reference);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ status: null, steps: [], nextStepId: null });
  });
});

describe('notification settings show the types that apply to the person', () => {
  it('marks as relevant only what is mandatory, set by the person, or delivered to them', async () => {
    const res = await h.call(s.stranger!, 'GET', '/api/v1/me/notification-preferences');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.items as { type: string; relevant: boolean; mandatory: boolean }[];
    expect(items.filter((i) => i.mandatory).every((i) => i.relevant)).toBe(true);
    const idle = items.find((i) => !i.relevant && !i.mandatory);
    expect(idle, 'a type that does not apply yet').toBeDefined();

    // Setting a preference makes the type relevant: the person has chosen it.
    const set = await h.call(s.stranger!, 'PUT', '/api/v1/me/notification-preferences', {
      items: [{ type: idle!.type, inApp: true, email: false }],
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const after = (set.body.items as { type: string; relevant: boolean }[]).find(
      (i) => i.type === idle!.type,
    );
    expect(after?.relevant).toBe(true);
  });
});

describe('a step whose approver is still to be answered', () => {
  it('says which answer it depends on, rather than that nobody can approve', async () => {
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Requests portal: owner approval',
      triggerKey: 'core.form-submission',
    });
    expect(wf.status, JSON.stringify(wf.body)).toBe(201);
    await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: 'owner-review',
            type: 'approval',
            name: { en: 'Owner approval' },
            approvers: [{ type: 'fact', fact: 'data.owner' }],
            mode: 'any',
          },
        ],
      },
    });
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    await t.mkForm(
      'rp-owned',
      { elements: [t.field('owner', 'user')] },
      { workflowDefinitionId: wf.body.id },
    );

    const empty = await h.call(s.requester!, 'POST', '/api/v1/forms/by-key/rp-owned/preview', { data: {} });
    expect(empty.status, JSON.stringify(empty.body)).toBe(200);
    const [waiting] = empty.body.steps as LooseJson[];
    expect(waiting!.id).toBe('owner-review');
    expect(waiting!.dependsOn).toEqual(['owner']);
    expect(waiting!.people).toEqual([]);

    const answered = await h.call(s.requester!, 'POST', '/api/v1/forms/by-key/rp-owned/preview', {
      data: { owner: ids.manager },
    });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    const [resolved] = answered.body.steps as LooseJson[];
    expect(resolved!.dependsOn).toEqual(['owner']);
    expect(resolved!.people.map((p: LooseJson) => p.id)).toEqual([ids.manager]);
  });
});
