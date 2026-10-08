/**
 * ITSM for ISMS-style processes (Phase 8, §15.8a): the requester's acceptance of a change in its post-implementation
 * review (recorded, notified, required before closing when the setting is on), and the optional resolution sign-off
 * (`itsm.resolution`): a bound workflow scoped by conditions holds the resolution until it is approved; a rejection
 * sends the ticket back to in progress with the reason.
 */
import {
  approvalTasks,
  auditLogs,
  notifications,
  roleAssignments,
  roles,
  users,
  workflowInstances,
} from '@isbp/db/schema';
import { ticketActivities, tickets } from '@isbp/module-itsm/schema';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const s: Record<string, Session> = {};
const ids = {} as Record<'alice' | 'bob' | 'agent' | 'cm' | 'mgr', string>;
let anomaly: string;
let other: string;
const API = '/api/v1/itsm';

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(username: string, departmentId: string | null = null) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: `${username[0]!.toUpperCase()}${username.slice(1)}`,
      passwordHash: await hashPassword(PASSWORD),
      departmentId,
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

const call = (who: string, method: string, path: string, body?: unknown) =>
  who === 'admin'
    ? h.call(admin, method, `${API}${path}`, body)
    : h.call(s[who]!, method, `${API}${path}`, body);

const notificationsOf = (userId: string, type: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

const auditOf = (action: string, entityId: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.occurredAt));

const setting = (values: Record<string, unknown>) =>
  h.kernel.settings.update(h.kernel.registry.get('itsm')!.manifest, values, null);

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  ids.alice = await mkUser('alice', h.ids.salesTpe);
  ids.bob = await mkUser('bob', h.ids.finance);
  ids.agent = await mkUser('agent');
  ids.cm = await mkUser('cm');
  ids.mgr = await mkUser('mgr');
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('itsm-agent'), userId: ids.agent },
    { roleId: await roleId('itsm-change-manager'), userId: ids.cm },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['alice', 'bob', 'agent', 'cm', 'mgr']) s[u] = await h.login(u);
  const cat = await call('admin', 'POST', '/categories', {
    key: 'equipment-anomaly',
    name: { en: 'Equipment anomaly' },
    ticketTypes: ['incident'],
  });
  expect(cat.status, JSON.stringify(cat.body)).toBe(201);
  anomaly = cat.body.id;
  other = (
    await call('admin', 'POST', '/categories', {
      key: 'desktop',
      name: { en: 'Desktop' },
      ticketTypes: ['incident'],
    })
  ).body.id;
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('requester acceptance of a change', () => {
  async function changeInReview(title: string) {
    const created = await call('admin', 'POST', '/tickets', {
      type: 'change',
      title,
      requesterId: ids.alice,
      assigneeId: ids.cm,
      change: { changeType: 'normal', risk: 'low', reason: 'Requested by the user' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // Authorization and implementation are covered elsewhere: start from an implemented change.
    await h.kernel.db.update(tickets).set({ status: 'implementing' }).where(eq(tickets.id, created.body.id));
    return created.body as LooseJson;
  }

  it('asks the requester in review, records a problem and the acceptance, and closes only once accepted', async () => {
    const change = await changeInReview('Replace the file server disk');
    const early = await call('alice', 'POST', `/tickets/${change.reference}/acceptance`, { accepted: true });
    expect(early.status).toBe(409);

    const review = await call('cm', 'POST', `/tickets/${change.reference}/transition`, { status: 'review' });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect(review.body.acceptance).toMatchObject({ state: 'pending', required: false });
    expect(
      (
        await eventually(
          () => notificationsOf(ids.alice, 'itsm.change.acceptance_requested'),
          (r) => r.length > 0,
        )
      ).length,
    ).toBe(1);

    // The requester sees the change (their own) and may answer; others may not.
    const mine = await call('alice', 'GET', `/tickets/${change.reference}`);
    expect(mine.body.viewer).toMatchObject({ role: 'requester', canAccept: true });
    expect(mine.body.change).toBeNull();
    expect(
      (await call('bob', 'POST', `/tickets/${change.reference}/acceptance`, { accepted: true })).status,
    ).toBe(404);
    expect(
      (await call('cm', 'POST', `/tickets/${change.reference}/acceptance`, { accepted: true })).status,
    ).toBe(403);
    expect(
      (await call('alice', 'POST', `/tickets/${change.reference}/acceptance`, { accepted: false })).status,
    ).toBe(400);

    await setting({ 'changes.requireAcceptance': true });
    const problem = await call('alice', 'POST', `/tickets/${change.reference}/acceptance`, {
      accepted: false,
      note: 'The share is still read-only for my team',
    });
    expect(problem.status, JSON.stringify(problem.body)).toBe(200);
    expect(problem.body.acceptance).toMatchObject({
      state: 'problem',
      note: 'The share is still read-only for my team',
      by: { id: ids.alice },
      required: true,
    });
    expect(await auditOf('itsm.change.problem_reported', change.id)).toHaveLength(1);
    expect(
      (
        await eventually(
          () => notificationsOf(ids.cm, 'itsm.change.problem_reported'),
          (r) => r.length > 0,
        )
      ).length,
    ).toBe(1);
    const refused = await call('cm', 'POST', `/tickets/${change.reference}/transition`, { status: 'closed' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: 'INVALID_STATE',
      details: { reason: 'acceptance_required', acceptance: 'problem' },
    });

    const accepted = await call('alice', 'POST', `/tickets/${change.reference}/acceptance`, {
      accepted: true,
    });
    expect(accepted.body.acceptance).toMatchObject({ state: 'accepted', note: null });
    const closed = await call('cm', 'POST', `/tickets/${change.reference}/transition`, { status: 'closed' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body).toMatchObject({ status: 'closed', acceptance: { state: 'accepted' } });
    const [status] = await auditOf('itsm.ticket.status_changed', change.id);
    expect(status!.metadata).toMatchObject({ accepted: true });
    const timeline = await h.kernel.db
      .select()
      .from(ticketActivities)
      .where(eq(ticketActivities.ticketId, change.id));
    expect(timeline.filter((a) => a.data.acceptance).map((a) => a.data.acceptance)).toEqual([
      'problem',
      'accepted',
    ]);
    expect(timeline.find((a) => a.kind === 'status' && a.data.to === 'closed')?.data).toMatchObject({
      accepted: true,
    });
  });

  it('without the setting, closing records that the change was not accepted', async () => {
    await setting({ 'changes.requireAcceptance': false });
    const change = await changeInReview('Move the printer queue');
    await call('cm', 'POST', `/tickets/${change.reference}/transition`, { status: 'review' });
    const closed = await call('cm', 'POST', `/tickets/${change.reference}/transition`, { status: 'closed' });
    expect(closed.status).toBe(200);
    expect(closed.body.acceptance).toMatchObject({ state: 'pending' });
    const [status] = await auditOf('itsm.ticket.status_changed', change.id);
    expect(status!.metadata).toMatchObject({ accepted: null });
  });
});

describe('resolution sign-off (itsm.resolution)', () => {
  const incident = async (title: string, categoryId: string) => {
    const res = await call('agent', 'POST', '/tickets', {
      type: 'incident',
      title,
      requesterId: ids.alice,
      categoryId,
      assigneeId: ids.agent,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as LooseJson;
  };
  const resolve = (ref: string) =>
    call('agent', 'POST', `/tickets/${ref}/transition`, {
      status: 'resolved',
      resolutionCode: 'solved',
      resolutionNotes: 'Replaced the failed power supply',
    });
  const pendingTask = (instanceId: string) =>
    eventually(
      () =>
        h.kernel.db
          .select()
          .from(approvalTasks)
          .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending'))),
      (r) => r.length > 0,
    );

  it('resolves at once while no workflow is bound', async () => {
    const t = await incident('Monitor flickers', anomaly);
    const res = await resolve(t.reference);
    expect(res.body).toMatchObject({ status: 'resolved', signOff: null });
  });

  it('holds a resolution in scope for the sign-off, then resolves it once approved', async () => {
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Anomaly sign-off',
      triggerKey: 'itsm.resolution',
    });
    expect(wf.status, JSON.stringify(wf.body)).toBe(201);
    const saved = await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: 'manager',
            type: 'approval',
            name: { en: 'Manager sign-off' },
            when: { fact: 'ticket.category', op: 'eq', value: 'equipment-anomaly' },
            approvers: [{ type: 'user', userId: ids.mgr }],
            mode: 'any',
          },
        ],
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);

    // Out of scope (another category): resolved at once.
    const desktop = await incident('Keyboard stuck', other);
    expect((await resolve(desktop.reference)).body).toMatchObject({ status: 'resolved', signOff: null });

    const t = await incident('UPS alarm in the server room', anomaly);
    const held = await resolve(t.reference);
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    expect(held.body).toMatchObject({
      status: 'pending_approval',
      awaitingSignOff: true,
      signOff: { to: 'resolved', instanceId: expect.any(String) },
      resolutionCode: 'solved',
      resolutionNotes: 'Replaced the failed power supply',
      viewer: { transitions: ['in_progress', 'cancelled'] },
    });
    const [instance] = await h.kernel.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, held.body.signOff.instanceId));
    expect(instance).toMatchObject({ triggerKey: 'itsm.resolution', requesterId: ids.agent });
    expect(instance!.facts).toMatchObject({
      ticket: { type: 'incident', category: 'equipment-anomaly', resolutionCode: 'solved', ciCount: 0 },
    });
    // The requester sees "Waiting for sign-off" in My requests, not yet a resolution notification.
    const list = await call('agent', 'GET', `/tickets?q=${encodeURIComponent('UPS alarm')}`);
    expect(list.body.items[0]).toMatchObject({ status: 'pending_approval', awaitingSignOff: true });
    // Resolved so far: the incident before the workflow and the one out of its scope.
    expect(
      (
        await eventually(
          () => notificationsOf(ids.alice, 'itsm.ticket.resolved'),
          (r) => r.length >= 2,
        )
      ).length,
    ).toBe(2);

    const [task] = await pendingTask(instance!.id);
    expect(
      (await h.call(s.mgr!, 'POST', `/api/v1/approvals/${task!.id}/approve`, { comment: 'OK' })).status,
    ).toBe(200);
    const done = await eventually(
      () => call('agent', 'GET', `/tickets/${t.reference}`),
      (r) => r.body.status === 'resolved',
    );
    expect(done.body).toMatchObject({
      status: 'resolved',
      signOff: null,
      resolutionCode: 'solved',
      resolutionNotes: 'Replaced the failed power supply',
    });
    expect(
      (
        await eventually(
          () => notificationsOf(ids.alice, 'itsm.ticket.resolved'),
          (r) => r.length > 2,
        )
      ).length,
    ).toBe(3);
  });

  it('a rejection sends the ticket back to work with the reason; withdrawing cancels the sign-off', async () => {
    const t = await incident('Switch port errors', anomaly);
    const held = await resolve(t.reference);
    const [task] = await pendingTask(held.body.signOff.instanceId);
    const rejected = await h.call(s.mgr!, 'POST', `/api/v1/approvals/${task!.id}/reject`, {
      comment: 'Attach the vendor report first.',
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const back = await eventually(
      () => call('agent', 'GET', `/tickets/${t.reference}`),
      (r) => r.body.status === 'in_progress',
    );
    expect(back.body).toMatchObject({ status: 'in_progress', signOff: null, resolutionCode: null });
    const notes = await eventually(
      () => notificationsOf(ids.agent, 'itsm.ticket.sign_off_rejected'),
      (r) => r.length > 0,
    );
    expect(notes[0]!.body).toContain('Attach the vendor report first.');

    const again = await resolve(t.reference);
    expect(again.body.status).toBe('pending_approval');
    const withdrawn = await call('agent', 'POST', `/tickets/${t.reference}/transition`, {
      status: 'in_progress',
    });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    expect(withdrawn.body).toMatchObject({ status: 'in_progress', signOff: null, resolutionCode: null });
    const [instance] = await h.kernel.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, again.body.signOff.instanceId));
    expect(instance!.status).toBe('cancelled');
    // Nothing else can happen while it waits: no closing straight from the sign-off.
    const held2 = await resolve(t.reference);
    const close = await call('agent', 'POST', `/tickets/${t.reference}/transition`, { status: 'closed' });
    expect(close.status).toBe(409);
    expect(close.body.error.details.allowed).toEqual(['in_progress', 'cancelled']);
    expect(held2.body.status).toBe('pending_approval');
  });
});
