import { auditLogs, notifications, roleAssignments, roles } from '@isbp/db/schema';
import type { FormAction } from '@isbp/sdk/server';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const t = processActionHelpers(() => ({ h, admin }));

const notifyAction = (id: string, on: FormAction['on'], title: string): FormAction => ({
  id,
  on,
  type: 'core.notify',
  config: { toRequester: true, title, message: 'You asked for {{data.what}}' },
});

const titlesOf = async (userId: string) =>
  (
    await h.kernel.db
      .select({ title: notifications.title })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, 'core.process-action.message')))
      .orderBy(desc(notifications.createdAt))
  ).map((n) => n.title);

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  for (const u of ['mei', 'approver', 'editor']) {
    ids[u] = await t.mkUser(u);
    s[u] = await h.login(u);
  }
  // A forms administrator who can't assign roles.
  const role = await h.call(admin, 'POST', '/api/v1/roles', {
    key: 'forms-only',
    name: 'Forms only',
    permissions: ['core.forms.manage'],
  });
  await h.call(admin, 'POST', '/api/v1/role-assignments', {
    roleId: role.body.id,
    principalType: 'user',
    principalId: ids.editor,
  });
  s.editor = await h.login('editor');
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('catalog and saving', () => {
  it('lists every action with its fields for the form, and whether the caller may add it', async () => {
    const form = await t.mkForm(
      'catalog-form',
      { elements: [t.field('who', 'user'), t.field('what', 'text')] },
      { publish: false },
    );
    const list = await h.call(admin, 'GET', `/api/v1/forms/process-actions?formId=${form.id}`);
    expect(list.status).toBe(200);
    const byType = (body: { items: { type: string }[] }, type: string) =>
      body.items.find((i) => i.type === type) as unknown as {
        allowed: boolean;
        fields: { key: string; options?: { value: string }[] }[];
        secrets: string[];
      };
    expect(list.body.items.map((i: { type: string }) => i.type)).toEqual(
      expect.arrayContaining([
        'core.grant-role',
        'core.notify',
        'core.webhook',
        'itsm.create-change',
        'itsm.create-ticket',
        'scheduler.run-job',
        'cmdb.update-ci',
      ]),
    );
    const person = byType(list.body, 'core.grant-role').fields.find((f) => f.key === 'person')!;
    expect(person.options!.map((o) => o.value)).toEqual(['requester', 'field:who']);
    expect(byType(list.body, 'core.webhook').secrets).toEqual(['headerValue']);

    // The builder sends its unsaved draft: choices follow the fields it has now.
    const draft = await h.call(admin, 'POST', '/api/v1/forms/process-actions', {
      draft: { elements: [t.field('manager', 'user')] },
    });
    const person2 = byType(draft.body, 'core.grant-role').fields.find((f) => f.key === 'person')!;
    expect(person2.options!.map((o) => o.value)).toEqual(['requester', 'field:manager']);

    const limited = await h.call(s.editor!, 'GET', `/api/v1/forms/process-actions?formId=${form.id}`);
    expect(byType(limited.body, 'core.notify').allowed).toBe(true);
    expect(byType(limited.body, 'core.grant-role').allowed).toBe(false);
    expect((await h.call(s.mei!, 'GET', '/api/v1/forms/process-actions')).status).toBe(403);
  });

  it('refuses unknown types, invalid configs and actions the editor may not add', async () => {
    const form = await t.mkForm('checked-form', { elements: [t.field('what', 'text')] }, { publish: false });
    const save = (session: Session, actions: FormAction[]) =>
      h.call(session, 'PATCH', `/api/v1/forms/${form.id}`, {
        draft: { elements: [t.field('what', 'text')], actions },
      });

    const unknown = await save(admin, [{ id: 'a', on: 'submitted', type: 'core.nothing', config: {} }]);
    expect(unknown.body.error.code).toBe('PROCESS_ACTION_UNAVAILABLE');

    const invalid = await save(admin, [{ id: 'a', on: 'submitted', type: 'core.notify', config: {} }]);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'draft.actions.0.config.title', code: 'required' }),
      ]),
    );

    const [role] = await h.kernel.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'announcements-editor'));
    const grantRole: FormAction = {
      id: 'grant',
      on: 'approved',
      type: 'core.grant-role',
      config: { roleId: role!.id, person: 'requester', durationDays: 30 },
    };
    const refused = await save(s.editor!, [grantRole]);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('PROCESS_ACTION_FORBIDDEN');
    expect(refused.body.error.details).toMatchObject({
      action: 'core.grant-role',
      permission: 'core.roles.assign',
    });

    const saved = await save(admin, [grantRole, notifyAction('tell', 'submitted', 'Received')]);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    // The editor can change the rest of the form and keep an action they couldn't add…
    const kept = await save(s.editor!, [
      saved.body.draft.actions[0],
      notifyAction('tell', 'submitted', 'Thanks'),
    ]);
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    // …but not change that action.
    const changed = await save(s.editor!, [
      { ...grantRole, config: { ...grantRole.config, durationDays: 90 } },
      notifyAction('tell', 'submitted', 'Thanks'),
    ]);
    expect(changed.body.error.code).toBe('PROCESS_ACTION_FORBIDDEN');
  });
});

describe('running actions', () => {
  it('runs "submitted" and "approved" actions at once when the form has no approval', async () => {
    await t.mkForm('no-approval', {
      elements: [t.field('what', 'text')],
      actions: [
        notifyAction('sent', 'submitted', 'Sent: {{request.reference}}'),
        notifyAction('done', 'approved', 'Done for {{requester.displayName}}'),
        notifyAction('no', 'rejected', 'Never'),
      ],
    });
    const sub = await t.submit(s.mei!, 'no-approval', { what: 'a monitor' });
    const list = await t.settledRuns(sub.id);
    expect(list.map((r) => [r.actionId, r.outcome, r.status]).sort()).toEqual([
      ['done', 'approved', 'succeeded'],
      ['sent', 'submitted', 'succeeded'],
    ]);
    expect(await titlesOf(ids.mei!)).toEqual(
      expect.arrayContaining([`Sent: ${sub.reference}`, 'Done for mei']),
    );
    // The requester sees what happened, but not the configuration or errors.
    const detail = await h.call(s.mei!, 'GET', `/api/v1/requests/${sub.reference}`);
    expect(detail.body.submission.schema.actions).toBeUndefined();
    expect(
      detail.body.submission.actions.map((a: { status: string; error: unknown; canRetry: boolean }) => [
        a.status,
        a.error,
        a.canRetry,
      ]),
    ).toEqual([
      ['succeeded', null, false],
      ['succeeded', null, false],
    ]);
  });

  it('runs a request’s actions one after another, in the form’s order', async () => {
    const actions = ['one', 'two', 'three', 'four'].map((id) => notifyAction(id, 'submitted', `Step ${id}`));
    // Listed out of alphabetical order, to show the form's order (not ids or names) decides.
    await t.mkForm('in-order', {
      elements: [t.field('what', 'text')],
      actions: [actions[2]!, actions[0]!, actions[3]!, actions[1]!],
    });
    const sub = await t.submit(s.mei!, 'in-order', { what: 'x' });
    const list = await t.settledRuns(sub.id);
    const byId = new Map(list.map((r) => [r.actionId, r]));
    const order = ['three', 'one', 'four', 'two'].map((id) => byId.get(id)!);
    expect(order.every((r) => r.status === 'succeeded')).toBe(true);
    for (let i = 1; i < order.length; i++)
      expect(order[i]!.startedAt!.getTime()).toBeGreaterThanOrEqual(order[i - 1]!.finishedAt!.getTime());
  });

  it('runs "approved" or "rejected" actions when the workflow decides, with the decider in templates', async () => {
    const workflowId = await t.approvalWorkflow('Decide', ids.approver!);
    await t.mkForm(
      'with-approval',
      {
        elements: [t.field('what', 'text')],
        actions: [
          notifyAction('yes', 'approved', 'Approved by {{decidedBy.displayName}}'),
          notifyAction('no', 'rejected', 'Declined by {{decidedBy.displayName}}'),
        ],
      },
      { workflowDefinitionId: workflowId },
    );
    const first = await t.submit(s.mei!, 'with-approval', { what: 'a phone' });
    const second = await t.submit(s.mei!, 'with-approval', { what: 'a tablet' });
    expect(await t.runs(first.id)).toEqual([]);
    await t.decide(first.workflow.id, s.approver!, 'approve');
    await t.decide(second.workflow.id, s.approver!, 'reject');
    const a = await t.settledRuns(first.id);
    const b = await t.settledRuns(second.id);
    expect(a.map((r) => [r.actionId, r.status, r.decidedBy])).toEqual([['yes', 'succeeded', ids.approver]]);
    expect(b.map((r) => [r.actionId, r.status])).toEqual([['no', 'succeeded']]);
    expect(await titlesOf(ids.mei!)).toEqual(
      expect.arrayContaining(['Approved by approver', 'Declined by approver']),
    );
  });

  it('runs the actions of the version a request was made with', async () => {
    const workflowId = await t.approvalWorkflow('Versions', ids.approver!);
    const form = await t.mkForm(
      'versioned',
      { elements: [t.field('what', 'text')], actions: [notifyAction('tell', 'approved', 'Version one')] },
      { workflowDefinitionId: workflowId },
    );
    const sub = await t.submit(s.mei!, 'versioned', { what: 'x' });
    await h.call(admin, 'PATCH', `/api/v1/forms/${form.id}`, {
      draft: {
        elements: [t.field('what', 'text')],
        actions: [notifyAction('tell', 'approved', 'Version two')],
      },
    });
    expect((await h.call(admin, 'POST', `/api/v1/forms/${form.id}/publish`)).body.publishedVersion).toBe(2);
    await t.decide(sub.workflow.id, s.approver!, 'approve');
    const [run] = await t.settledRuns(sub.id);
    expect(run!.formVersion).toBe(1);
    const titles = await titlesOf(ids.mei!);
    expect(titles).toContain('Version one');
    expect(titles).not.toContain('Version two');
  });

  it('grants a role for a number of days, audited with the request', async () => {
    const [role] = await h.kernel.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'announcements-editor'));
    await t.mkForm('editor-access', {
      elements: [t.field('why', 'text')],
      actions: [
        {
          id: 'grant',
          on: 'approved',
          type: 'core.grant-role',
          config: { roleId: role!.id, person: 'requester', durationDays: 7 },
        },
      ],
    });
    const sub = await t.submit(s.mei!, 'editor-access', { why: 'news' });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status, run!.error ?? '').toBe('succeeded');
    const [assignment] = await h.kernel.db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.roleId, role!.id), eq(roleAssignments.userId, ids.mei!)));
    const days = (assignment!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(assignment!.source).toBe('request');
    const [entry] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.role-assignment.granted'), eq(auditLogs.entityId, ids.mei!)))
      .orderBy(desc(auditLogs.seq))
      .limit(1);
    expect(entry!.actorName).toBe('form:editor-access');
    expect((entry!.metadata as { processAction?: { request: string } }).processAction?.request).toBe(
      sub.reference,
    );
  });
});
