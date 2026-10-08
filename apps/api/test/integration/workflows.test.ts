import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  approvalTasks,
  groupMembers,
  groups,
  notificationDeliveries,
  notifications,
  roleAssignments,
  roles,
  users,
  workflowInstances,
} from '@isbp/db/schema';
import type { WorkflowGraph } from '@isbp/sdk';
import { and, desc, eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, PASSWORD, type Session } from './harness';
import { hashPassword } from '../../src/kernel/passwords';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const sent: { to: string; subject: string; text: string }[] = [];

async function eventually<T>(
  fn: () => Promise<T>,
  accept: (v: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(
  username: string,
  opts: {
    managerId?: string;
    departmentId?: string;
    status?: 'pending' | 'active' | 'suspended' | 'offboarded';
  } = {},
) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      managerId: opts.managerId ?? null,
      departmentId: opts.departmentId ?? null,
      ...(opts.status ? { status: opts.status } : {}),
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

async function pendingTask(instanceId: string, assigneeId?: string) {
  const rows = await h.kernel.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));
  return assigneeId ? rows.find((r) => r.assigneeId === assigneeId) : rows[0];
}

let ids: { lead: string; worker: string; owner: string; sec1: string; sec2: string };
let s: Record<string, Session>;

beforeAll(async () => {
  h = await createHarness();
  // Email through an in-memory transport (no SMTP server needed).
  h.kernel.notifications.useTransport(() => nodemailer.createTransport({ jsonTransport: true }) as never);
  const original = h.kernel.notifications.sendEmail.bind(h.kernel.notifications);
  h.kernel.notifications.sendEmail = async (to, message) => {
    sent.push({ to, subject: message.title, text: message.body ?? '' });
    return original(to, message);
  };
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  const lead = await mkUser('lead', { managerId: h.ids.admin });
  const worker = await mkUser('worker', { managerId: lead });
  const owner = await mkUser('owner');
  const sec1 = await mkUser('sec1');
  const sec2 = await mkUser('sec2');
  ids = { lead, worker, owner, sec1, sec2 };
  const [team] = await h.kernel.db
    .insert(groups)
    .values({ key: 'security-team', name: 'Security Team' })
    .returning();
  await h.kernel.db.insert(groupMembers).values([
    { groupId: team!.id, userId: sec1 },
    { groupId: team!.id, userId: sec2 },
  ]);
  s = {};
  for (const u of ['lead', 'worker', 'owner', 'sec1', 'sec2']) s[u] = await h.login(u);
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('access requests through the default workflow', () => {
  it('installs the manifest default workflow as published and default', async () => {
    const list = await h.call(admin, 'GET', '/api/v1/workflows?triggerKey=core.access-request');
    expect(list.status).toBe(200);
    const def = list.body.items[0];
    expect(def).toMatchObject({ isDefault: true, isSystem: true, publishedVersion: 1 });
  });

  it('manager → role owner, then grants time-bound access and notifies the requester', async () => {
    const editor = await roleId('announcements-editor');
    const settings = await h.call(admin, 'PUT', `/api/v1/roles/${editor}/request-settings`, {
      requestable: true,
      riskLevel: 'low',
      ownerId: ids.owner,
      maxDurationDays: 30,
      requestWorkflowId: null,
    });
    expect(settings.status).toBe(200);
    expect(settings.body.requestable).toBe(true);

    const tooLong = await h.call(s.worker!, 'POST', '/api/v1/access-requests', {
      roleId: editor,
      durationDays: 90,
      justification: 'I publish maintenance notices for my team.',
    });
    expect(tooLong.body.error.code).toBe('DURATION_TOO_LONG');

    const preview = await h.call(s.worker!, 'POST', '/api/v1/access-requests/preview', {
      roleId: editor,
      durationDays: 14,
    });
    expect(preview.body.steps.map((x: { id: string; outcome: string }) => [x.id, x.outcome])).toEqual([
      ['manager', 'ask'],
      ['security', 'skipped'],
      ['owner', 'ask'],
    ]);

    const created = await h.call(s.worker!, 'POST', '/api/v1/access-requests', {
      roleId: editor,
      durationDays: 14,
      justification: 'I publish maintenance notices for my team.',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'pending',
      reference: expect.stringMatching(/^REQ-\d{5}$/),
    });
    const instanceId = created.body.workflow.id as string;

    const dup = await h.call(s.worker!, 'POST', '/api/v1/access-requests', {
      roleId: editor,
      durationDays: 14,
      justification: 'Asking twice by mistake here.',
    });
    expect(dup.body.error.code).toBe('DUPLICATE_REQUEST');

    // The manager is asked (and notified); the requester cannot decide their own request.
    const managerTask = await pendingTask(instanceId, ids.lead);
    expect(managerTask).toBeDefined();
    const inbox = await h.call(s.lead!, 'GET', '/api/v1/me/approvals');
    expect(inbox.body.items[0].task.id).toBe(managerTask!.id);
    expect((await h.call(s.worker!, 'POST', `/api/v1/approvals/${managerTask!.id}/approve`, {})).status).toBe(
      403,
    );
    const notes = await h.kernel.db.select().from(notifications).where(eq(notifications.userId, ids.lead));
    expect(notes.some((n) => n.type === 'core.approval.assigned')).toBe(true);

    expect(
      (await h.call(s.lead!, 'POST', `/api/v1/approvals/${managerTask!.id}/approve`, { comment: 'OK' })).body,
    ).toEqual({
      outcome: 'running',
    });
    const ownerTask = await pendingTask(instanceId, ids.owner);
    expect(ownerTask).toBeDefined();
    expect(
      (await h.call(s.owner!, 'POST', `/api/v1/approvals/${ownerTask!.id}/approve`, {})).body.outcome,
    ).toBe('approved');

    const granted = await eventually(
      () => h.call(s.worker!, 'GET', `/api/v1/access-requests/${created.body.id}`),
      (r) => r.body.status === 'approved',
    );
    expect(granted.body.status).toBe('approved');
    const [assignment] = await h.kernel.db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, ids.worker), eq(roleAssignments.roleId, editor)));
    expect(assignment!.source).toBe('request');
    const days = (assignment!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const perms = await h.call(s.worker!, 'GET', '/api/v1/me/permissions');
    expect(JSON.stringify(perms.body)).toContain('announcements.posts');

    const timeline = await h.call(s.worker!, 'GET', `/api/v1/workflow-instances/${instanceId}`);
    expect(timeline.body.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['started', 'task_approved', 'step_skipped', 'completed']),
    );
  });

  it('requires a comment to reject and records the rejection', async () => {
    const auditor = await roleId('security-auditor');
    await h.call(admin, 'PUT', `/api/v1/roles/${auditor}/request-settings`, {
      requestable: true,
      riskLevel: 'high',
      ownerId: null,
      maxDurationDays: null,
      requestWorkflowId: null,
    });
    const created = await h.call(s.worker!, 'POST', '/api/v1/access-requests', {
      roleId: auditor,
      durationDays: null,
      justification: 'Read-only look at the audit trail.',
    });
    const task = await pendingTask(created.body.workflow.id, ids.lead);
    expect((await h.call(s.lead!, 'POST', `/api/v1/approvals/${task!.id}/reject`, {})).body.error.code).toBe(
      'COMMENT_REQUIRED',
    );
    await h.call(s.lead!, 'POST', `/api/v1/approvals/${task!.id}/reject`, {
      comment: 'Use the reporting role instead.',
    });
    const r = await eventually(
      () => h.call(s.worker!, 'GET', `/api/v1/access-requests/${created.body.id}`),
      (x) => x.body.status === 'rejected',
    );
    expect(r.body.workflow.outcomeComment).toBe('Use the reporting role instead.');
  });

  it('routes high-risk requests through the security group; any member decides the slot', async () => {
    // Make the security step ask the security team instead of platform admins.
    const def = (await h.call(admin, 'GET', '/api/v1/workflows?triggerKey=core.access-request')).body
      .items[0];
    const full = (await h.call(admin, 'GET', `/api/v1/workflows/${def.id}`)).body;
    const graph = full.draft as WorkflowGraph;
    const draft = {
      steps: graph.steps.map((x) =>
        x.id === 'security' && x.type === 'approval'
          ? { ...x, approvers: [{ type: 'group', groupKey: 'security-team' }] }
          : x,
      ),
    };
    expect((await h.call(admin, 'PATCH', `/api/v1/workflows/${def.id}`, { draft })).status).toBe(200);
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${def.id}/publish`)).body.publishedVersion).toBe(
      2,
    );

    const auditor = await roleId('security-auditor');
    const created = await h.call(s.owner!, 'POST', '/api/v1/access-requests', {
      roleId: auditor,
      durationDays: 7,
      justification: 'Quarterly access review support.',
    });
    // `owner` has no manager → the manager step is skipped (ifNoApprover: skip).
    const instanceId = created.body.workflow.id as string;
    const tasks = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.instanceId, instanceId));
    expect(new Set(tasks.map((t) => t.assigneeId))).toEqual(new Set([ids.sec1, ids.sec2]));
    const t1 = tasks.find((t) => t.assigneeId === ids.sec1)!;
    await h.call(s.sec1!, 'POST', `/api/v1/approvals/${t1.id}/approve`, {});
    const after = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.instanceId, instanceId));
    expect(after.find((t) => t.assigneeId === ids.sec2 && t.stepId === 'security')!.status).toBe('cancelled');
    // Owner step: the role has no owner → identity-admin fallback → platform admins (not the requester).
    const ownerTask = after.find((t) => t.stepId === 'owner' && t.status === 'pending');
    expect(ownerTask?.assigneeId).toBe(h.ids.admin);
  });

  it('lets an approver hand a task over, and applies out-of-office delegation', async () => {
    const editor = await roleId('announcements-editor');
    // `lead` is out of office: new tasks go to `sec2`.
    const now = Date.now();
    const ooo = await h.call(s.lead!, 'POST', '/api/v1/me/delegations', {
      delegateId: ids.sec2,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
      reason: 'Holiday',
    });
    expect(ooo.status).toBe(201);
    const other = await mkUser('other', { managerId: ids.lead });
    const otherSession = await h.login('other');
    const created = await h.call(otherSession, 'POST', '/api/v1/access-requests', {
      roleId: editor,
      durationDays: 7,
      justification: 'Need to publish one notice this week.',
    });
    const task = await pendingTask(created.body.workflow.id);
    expect(task).toMatchObject({ assigneeId: ids.sec2, delegatedFromId: ids.lead });
    // Hand it over to someone else; the requester is refused as a delegate.
    expect(
      (await h.call(s.sec2!, 'POST', `/api/v1/approvals/${task!.id}/delegate`, { userId: other })).body.error
        .code,
    ).toBe('INVALID_DELEGATE');
    expect(
      (
        await h.call(s.sec2!, 'POST', `/api/v1/approvals/${task!.id}/delegate`, {
          userId: ids.sec1,
          comment: 'Yours',
        })
      ).status,
    ).toBe(200);
    const moved = await pendingTask(created.body.workflow.id);
    expect(moved).toMatchObject({ assigneeId: ids.sec1, delegatedFromId: ids.sec2 });
    await h.call(s.lead!, 'DELETE', `/api/v1/me/delegations/${ooo.body.id}`);
  });

  it('gets access ready for a pre-boarded new joiner, effective once they are onboarded', async () => {
    const editor = await roleId('announcements-editor');
    const joiner = await mkUser('joiner', { managerId: ids.lead, status: 'pending' });

    // The manager finds the new joiner in the "someone else" picker; other people don't, nor does the plain lookup.
    type Found = { id: string; status: string };
    const lookup = (who: Session, extra = '') =>
      h.call(who, 'GET', `/api/v1/people/lookup?q=joiner${extra}`).then((r) => r.body.items as Found[]);
    expect(await lookup(s.lead!, '&includePreboarded=true')).toEqual([
      expect.objectContaining({ id: joiner, status: 'pending' }),
    ]);
    expect(await lookup(s.lead!)).toEqual([]);
    expect(await lookup(s.worker!, '&includePreboarded=true')).toEqual([]);
    expect((await lookup(admin, '&includePreboarded=true')).map((p) => p.id)).toEqual([joiner]);

    const created = await h.call(s.lead!, 'POST', '/api/v1/access-requests', {
      roleId: editor,
      beneficiaryId: joiner,
      durationDays: 14,
      justification: 'Publishes the sales notices from day one.',
    });
    expect(created.status).toBe(201);
    // The lead is the joiner's manager and the requester, so the manager step falls through to the role owner.
    const instanceId = created.body.workflow.id as string;
    for (let i = 0; i < 3; i++) {
      const task = await pendingTask(instanceId);
      if (!task) break;
      const who = task.assigneeId === ids.owner ? s.owner! : task.assigneeId === ids.lead ? s.lead! : admin;
      await h.call(who, 'POST', `/api/v1/approvals/${task.id}/approve`, {});
    }
    const granted = await eventually(
      () => h.call(s.lead!, 'GET', `/api/v1/access-requests/${created.body.id}`),
      (r) => r.body.status !== 'pending',
    );
    expect(granted.body).toMatchObject({ status: 'approved', failureReason: null });

    // Nothing works before day one (pre-boarded people can't sign in); onboarding makes the grant effective.
    expect((await h.call(admin, 'POST', `/api/v1/users/${joiner}/onboard`)).status).toBeLessThan(300);
    const perms = await h.call(await h.login('joiner'), 'GET', '/api/v1/me/permissions');
    expect(JSON.stringify(perms.body)).toContain('announcements.posts');
  });

  it('refuses suspended and offboarded people with an accurate code, and fails grants that became impossible', async () => {
    const editor = await roleId('announcements-editor');
    const body = (beneficiaryId: string) => ({
      roleId: editor,
      beneficiaryId,
      durationDays: 7,
      justification: 'Covering the notices this week.',
    });
    const away = await mkUser('away', { managerId: ids.lead, status: 'suspended' });
    const gone = await mkUser('gone', { managerId: ids.lead, status: 'offboarded' });
    expect((await h.call(s.lead!, 'POST', '/api/v1/access-requests', body(away))).body.error.code).toBe(
      'PRINCIPAL_SUSPENDED',
    );
    expect((await h.call(s.lead!, 'POST', '/api/v1/access-requests', body(gone))).body.error.code).toBe(
      'PRINCIPAL_OFFBOARDED',
    );

    // Suspended while the request waited for approval: approved, but nothing is granted.
    const mover = await mkUser('mover', { managerId: ids.lead });
    const created = await h.call(s.lead!, 'POST', '/api/v1/access-requests', body(mover));
    expect(created.status).toBe(201);
    await h.kernel.db.update(users).set({ status: 'suspended' }).where(eq(users.id, mover));
    const instanceId = created.body.workflow.id as string;
    for (let i = 0; i < 3; i++) {
      const task = await pendingTask(instanceId);
      if (!task) break;
      const who = task.assigneeId === ids.owner ? s.owner! : task.assigneeId === ids.lead ? s.lead! : admin;
      await h.call(who, 'POST', `/api/v1/approvals/${task.id}/approve`, {});
    }
    const failed = await eventually(
      () => h.call(s.lead!, 'GET', `/api/v1/access-requests/${created.body.id}`),
      (r) => r.body.status !== 'pending',
    );
    expect(failed.body).toMatchObject({ status: 'failed', failureReason: 'beneficiary_suspended' });
    const held = await h.kernel.db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, mover), eq(roleAssignments.roleId, editor)));
    expect(held).toEqual([]);
  });
});

describe('custom workflows: parallel, conditions, quorum and SLA timers', () => {
  let definitionId: string;
  const graphFor = (finance: string, securityExtra: string, escalateTo: string): WorkflowGraph => ({
    steps: [
      {
        id: 'cost',
        type: 'condition',
        name: { en: 'Cost' },
        branches: [
          {
            id: 'big',
            name: { en: 'Big' },
            when: { fact: 'data.amount', op: 'gt', value: 1000 },
            steps: [
              {
                id: 'both',
                type: 'parallel',
                name: { en: 'Both' },
                branches: [
                  {
                    id: 'b1',
                    name: { en: 'Finance' },
                    steps: [
                      {
                        id: 'fin',
                        type: 'approval',
                        name: { en: 'Finance' },
                        approvers: [{ type: 'user', userId: finance }],
                        mode: 'any',
                      },
                    ],
                  },
                  {
                    id: 'b2',
                    name: { en: 'Security' },
                    steps: [
                      {
                        id: 'sec',
                        type: 'approval',
                        name: { en: 'Security' },
                        approvers: [
                          { type: 'group', groupKey: 'security-team' },
                          { type: 'user', userId: securityExtra },
                        ],
                        mode: 'quorum',
                        quorum: 2,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        otherwise: { id: 'small', name: { en: 'Small' }, steps: [] },
      },
      {
        id: 'mgr',
        type: 'approval',
        name: { en: 'Manager' },
        approvers: [{ type: 'manager' }],
        mode: 'any',
        sla: { dueHours: 1, onBreach: 'escalate', escalateTo: [{ type: 'user', userId: escalateTo }] },
      },
    ],
  });
  const formKey = 'purchase';

  it('rejects publishing invalid graphs with per-step issues', async () => {
    const created = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Purchases',
      triggerKey: 'core.form-submission',
    });
    expect(created.status).toBe(201);
    definitionId = created.body.id;
    const empty = await h.call(admin, 'POST', `/api/v1/workflows/${definitionId}/publish`);
    expect(empty.body.error.code).toBe('WORKFLOW_INVALID');
    expect(empty.body.error.details.issues).toEqual([{ stepId: null, code: 'empty' }]);
  });

  it('publishes a real graph and wires it to a form', async () => {
    const patched = await h.call(admin, 'PATCH', `/api/v1/workflows/${definitionId}`, {
      draft: graphFor(ids.owner, h.ids.admin, ids.owner),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.issues).toEqual([]);
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${definitionId}/publish`)).body.isDefault).toBe(
      true,
    );

    const form = await h.call(admin, 'POST', '/api/v1/forms', {
      key: formKey,
      name: { en: 'Purchase' },
      icon: 'credit-card',
    });
    expect(form.status).toBe(201);
    const draft = {
      elements: [
        {
          id: 'a',
          key: 'amount',
          type: 'number',
          label: { en: 'Amount' },
          required: true,
          validation: { min: 0 },
        },
        {
          id: 'b',
          key: 'vendor',
          type: 'select',
          label: { en: 'Vendor' },
          options: [
            { value: 'x', label: { en: 'X' } },
            { value: 'other', label: { en: 'Other' } },
          ],
        },
        {
          id: 'c',
          key: 'vendorName',
          type: 'text',
          label: { en: 'Vendor name' },
          required: true,
          visibleWhen: { fact: 'vendor', op: 'eq', value: 'other' },
        },
      ],
    };
    const updated = await h.call(admin, 'PATCH', `/api/v1/forms/${form.body.id}`, {
      draft,
      workflowDefinitionId: definitionId,
    });
    expect(updated.status).toBe(200);
    expect((await h.call(admin, 'POST', `/api/v1/forms/${form.body.id}/publish`)).body.publishedVersion).toBe(
      1,
    );
    expect(
      (await h.call(s.worker!, 'GET', '/api/v1/forms/catalog')).body.items.map((f: { key: string }) => f.key),
    ).toContain(formKey);
  });

  it('validates submissions server-side and drops hidden fields', async () => {
    const bad = await h.call(s.worker!, 'POST', `/api/v1/forms/by-key/${formKey}/submissions`, {
      data: { amount: -5, vendor: 'other' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'data.amount', code: 'min' }),
        expect.objectContaining({ path: 'data.vendorName', code: 'required' }),
      ]),
    );
    const small = await h.call(s.worker!, 'POST', `/api/v1/forms/by-key/${formKey}/submissions`, {
      data: { amount: 50, vendor: 'x', vendorName: 'smuggled' },
    });
    expect(small.status).toBe(201);
    expect(small.body.data).toEqual({ amount: 50, vendor: 'x' });
    // Small amounts skip straight to the manager.
    const tasks = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.instanceId, small.body.workflow.id));
    expect(tasks.map((t) => [t.stepId, t.assigneeId])).toEqual([['mgr', ids.lead]]);
  });

  it('runs big purchases through parallel branches with a quorum, then the manager', async () => {
    const sub = await h.call(s.worker!, 'POST', `/api/v1/forms/by-key/${formKey}/submissions`, {
      data: { amount: 5000, vendor: 'x' },
    });
    const instanceId = sub.body.workflow.id as string;
    let tasks = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.instanceId, instanceId));
    expect(tasks.map((t) => t.stepId).sort()).toEqual(['fin', 'sec', 'sec', 'sec']);
    await h.call(
      s.owner!,
      'POST',
      `/api/v1/approvals/${tasks.find((t) => t.stepId === 'fin')!.id}/approve`,
      {},
    );
    await h.call(
      s.sec1!,
      'POST',
      `/api/v1/approvals/${tasks.find((t) => t.assigneeId === ids.sec1)!.id}/approve`,
      {},
    );
    // Quorum 2 of 2 slots: still waiting for the admin slot.
    tasks = await h.kernel.db.select().from(approvalTasks).where(eq(approvalTasks.instanceId, instanceId));
    expect(tasks.some((t) => t.stepId === 'mgr')).toBe(false);
    await h.call(
      admin,
      'POST',
      `/api/v1/approvals/${tasks.find((t) => t.assigneeId === h.ids.admin)!.id}/approve`,
      {},
    );
    const mgr = await pendingTask(instanceId, ids.lead);
    expect(mgr?.stepId).toBe('mgr');
    expect(mgr?.dueAt).not.toBeNull();

    // SLA: an hour later the manager hasn't answered → escalated to `owner`.
    const result = await h.kernel.workflows.tick(new Date(Date.now() + 2 * 3_600_000));
    expect(result.breached).toBeGreaterThanOrEqual(1);
    const escalated = await pendingTask(instanceId, ids.owner);
    expect(escalated?.isEscalation).toBe(true);
    await h.call(s.owner!, 'POST', `/api/v1/approvals/${escalated!.id}/approve`, {});
    const done = await eventually(
      () => h.call(s.worker!, 'GET', `/api/v1/form-submissions/${sub.body.id}`),
      (r) => r.body.status === 'approved',
    );
    expect(done.body.status).toBe('approved');
    const [inst] = await h.kernel.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));
    expect(inst!.state.steps).toMatchObject({
      cost: { status: 'approved', branch: 'big' },
      both: { status: 'approved' },
    });
  });

  it('withdrawing a request cancels its workflow', async () => {
    const sub = await h.call(s.worker!, 'POST', `/api/v1/forms/by-key/${formKey}/submissions`, {
      data: { amount: 10, vendor: 'x' },
    });
    const cancelled = await h.call(s.worker!, 'POST', `/api/v1/form-submissions/${sub.body.id}/cancel`, {
      reason: 'Changed my mind',
    });
    expect(cancelled.body.status).toBe('cancelled');
    const [inst] = await h.kernel.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, sub.body.workflow.id));
    expect(inst!.status).toBe('cancelled');
    expect(await pendingTask(sub.body.workflow.id)).toBeUndefined();
  });
});

describe('custom fields', () => {
  it('validates attributes on people and filters by them', async () => {
    const created = await h.call(admin, 'POST', '/api/v1/custom-fields', {
      entityType: 'core.user',
      field: {
        key: 'costCenter',
        type: 'text',
        label: { en: 'Cost center' },
        validation: { pattern: 'CC-\\d{4}' },
      },
    });
    expect(created.status).toBe(201);
    const unsafe = await h.call(admin, 'POST', '/api/v1/custom-fields', {
      entityType: 'core.user',
      field: { key: 'evil', type: 'text', label: { en: 'Evil' }, validation: { pattern: '(a+)+$' } },
    });
    expect(unsafe.status).toBe(400);
    const bad = await h.call(admin, 'PATCH', `/api/v1/users/${ids.worker}`, {
      attributes: { costCenter: 'nope' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues[0]).toMatchObject({
      path: 'attributes.costCenter',
      code: 'pattern',
    });
    const ok = await h.call(admin, 'PATCH', `/api/v1/users/${ids.worker}`, {
      attributes: { costCenter: 'CC-1234', bogus: 1 },
    });
    expect(ok.status).toBe(200);
    const [u] = await h.kernel.db.select({ a: users.attributes }).from(users).where(eq(users.id, ids.worker));
    expect(u!.a).toEqual({ costCenter: 'CC-1234' });
    const filtered = await h.call(admin, 'GET', '/api/v1/users?attr=costCenter:CC-1234');
    expect(filtered.body.items.map((x: { id: string }) => x.id)).toEqual([ids.worker]);
    // Definitions are readable by everyone (to render forms).
    expect(
      (await h.call(s.worker!, 'GET', '/api/v1/custom-fields?entityType=core.user')).body.items,
    ).toHaveLength(1);
    expect(
      (
        await h.call(s.worker!, 'POST', '/api/v1/custom-fields', {
          entityType: 'core.user',
          field: { key: 'x', type: 'text', label: { en: 'X' } },
        })
      ).status,
    ).toBe(403);
  });
});

describe('notifications', () => {
  it('respects preferences and delivers email and webhooks after commit', async () => {
    // Email on; a Slack-style webhook receiver on localhost (private targets are allowed outside production).
    expect(
      (
        await h.call(admin, 'PUT', '/api/v1/notifications/email', {
          enabled: true,
          host: 'smtp.test',
          port: 587,
          from: 'ISBP <noreply@test.example>',
        })
      ).body.available,
    ).toBe(true);
    const received: unknown[] = [];
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const channel = await h.call(admin, 'POST', '/api/v1/notification-channels', {
      name: 'Approvals',
      type: 'slack',
      url: `http://127.0.0.1:${port}/hook`,
      types: ['core.approval.*'],
    });
    expect(channel.status).toBe(201);
    expect(JSON.stringify(channel.body)).not.toContain('/hook');

    // `lead` turns in-app off for approval requests but keeps email.
    await h.call(s.lead!, 'PUT', '/api/v1/me/notification-preferences', {
      items: [{ type: 'core.approval.assigned', inApp: false, email: true }],
    });
    const editor = await roleId('announcements-editor');
    await mkUser('someone', { managerId: ids.lead });
    const created = await h.call(await h.login('someone'), 'POST', '/api/v1/access-requests', {
      roleId: editor,
      durationDays: 3,
      justification: 'Testing the notification flow.',
    });
    expect(created.status).toBe(201);
    const [row] = await h.kernel.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ids.lead), eq(notifications.type, 'core.approval.assigned')))
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    expect(row).toMatchObject({ inApp: false });
    const unread = await h.call(s.lead!, 'GET', '/api/v1/me/notifications?unread=true');
    expect(unread.body.items.some((n: { id: string }) => n.id === row!.id)).toBe(false);

    await eventually(
      async () => sent.length,
      (n) => n > 0,
    );
    expect(sent.some((m) => m.to === 'lead@test.example' && m.subject.includes('Approval needed'))).toBe(
      true,
    );
    await eventually(
      async () => received.length,
      (n) => n > 0,
    );
    expect(JSON.stringify(received[0])).toContain('Approval needed');
    // The receiver sees the POST before the worker records the delivery as sent.
    const sentChannels = await eventually(
      async () =>
        (
          await h.kernel.db
            .select()
            .from(notificationDeliveries)
            .where(eq(notificationDeliveries.status, 'sent'))
        ).map((d) => d.channel),
      (channels) => channels.includes('email') && channels.includes('slack'),
    );
    expect(sentChannels).toEqual(expect.arrayContaining(['email', 'slack']));
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('refuses insecure webhook targets in production', async () => {
    const { assertWebhookTarget } = await import('../../src/kernel/notifications/channels');
    await expect(assertWebhookTarget('http://example.com/x', false)).rejects.toThrow(/https/);
    await expect(assertWebhookTarget('https://127.0.0.1/x', false)).rejects.toThrow(/private/);
    await expect(assertWebhookTarget('https://169.254.169.254/latest', false)).rejects.toThrow(/private/);
    await expect(assertWebhookTarget('https://user:pw@example.com/x', false)).rejects.toThrow(/Credentials/);
  });

  it('marks notifications read and reports badges', async () => {
    const badges = await h.call(s.lead!, 'GET', '/api/v1/me/badges');
    expect(badges.body.approvals).toBeGreaterThan(0);
    await h.call(s.worker!, 'POST', '/api/v1/me/notifications/read', { all: true });
    expect((await h.call(s.worker!, 'GET', '/api/v1/me/badges')).body.notifications).toBe(0);
  });
});

describe('announcements: optional review workflow', () => {
  it('publishes immediately until a review workflow is bound, then waits for approval', async () => {
    const editor = await roleId('announcements-editor');
    await h.call(admin, 'POST', '/api/v1/role-assignments', {
      roleId: editor,
      principalType: 'user',
      principalId: ids.worker,
    });
    const writer = await h.login('worker');
    const direct = await h.call(writer, 'POST', '/api/v1/announcements/posts', {
      title: 'Direct',
      publish: true,
    });
    expect(direct.body.status).toBe('published');

    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Review',
      triggerKey: 'announcements.publish',
    });
    await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: 'r',
            type: 'approval',
            name: { en: 'Review' },
            approvers: [{ type: 'user', userId: ids.owner }],
            mode: 'any',
          },
        ],
      },
    });
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).body.isDefault).toBe(
      true,
    );

    const reviewed = await h.call(writer, 'POST', '/api/v1/announcements/posts', {
      title: 'Needs review',
      publish: true,
    });
    expect(reviewed.body.status).toBe('pending');
    const task = await pendingTask(reviewed.body.reviewInstanceId, ids.owner);
    await h.call(s.owner!, 'POST', `/api/v1/approvals/${task!.id}/approve`, {});
    const live = await eventually(
      () => h.call(writer, 'GET', `/api/v1/announcements/posts/${reviewed.body.id}`),
      (r) => r.body.status === 'published',
    );
    expect(live.body.status).toBe('published');
    // Turning approval off again (optional trigger).
    expect((await h.call(admin, 'DELETE', `/api/v1/workflows/${wf.body.id}/default`)).body.isDefault).toBe(
      false,
    );
    const again = await h.call(writer, 'POST', '/api/v1/announcements/posts', {
      title: 'Direct again',
      publish: true,
    });
    expect(again.body.status).toBe('published');
  });
});
