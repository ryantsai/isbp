/**
 * Phase 8 process plumbing (§15.8a), G1: table fields, conditional actions, reminders (`core.remind` and the
 * `deliver-reminders` job) and application roles in `core.grant-role`.
 */
import {
  applications,
  groupMembers,
  groups,
  notifications,
  processActionRuns,
  roleAssignments,
  roles,
  scheduledReminders,
  users,
} from '@isbp/db/schema';
import type { FormAction, ProcessActionRequest } from '@isbp/sdk/server';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { remindAction } from '../../src/core/process-actions';
import { SKIPPED_BY_CONDITION } from '../../src/kernel/process-actions';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const t = processActionHelpers(() => ({ h, admin }));

const DAY = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Firewall rule lines: port (required), owner (a person), until (a date). */
const rulesField = t.field('rules', 'rows', {
  label: { en: 'Rules' },
  required: true,
  rows: {
    max: 3,
    fields: [
      {
        key: 'port',
        type: 'number',
        label: { en: 'Port' },
        required: true,
        validation: { min: 1, max: 65535 },
      },
      { key: 'owner', type: 'user', label: { en: 'Owner' } },
      { key: 'until', type: 'date', label: { en: 'Until' } },
    ],
  },
});

const notify = (id: string, title: string, extra: Partial<FormAction> = {}): FormAction => ({
  id,
  on: 'submitted',
  type: 'core.notify',
  config: { toRequester: true, title, message: '{{answers.rules}}' },
  ...extra,
});

const messagesOf = (userId: string, type = 'core.process-action.message') =>
  h.kernel.db
    .select({ title: notifications.title, body: notifications.body, href: notifications.href })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

const remindersOf = (submissionId: string) =>
  h.kernel.db
    .select()
    .from(scheduledReminders)
    .where(
      sql`${scheduledReminders.source} @> ${JSON.stringify({ type: 'form-submission', id: submissionId })}::jsonb`,
    );

beforeAll(async () => {
  h = await createHarness();
  h.kernel.processActions.retryDelayMs = 100;
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  for (const u of ['mei', 'owner', 'approver', 'oncall', 'assigner']) {
    ids[u] = await t.mkUser(u);
    s[u] = await h.login(u);
  }
  // A group whose members get reminders, resolved when the reminder goes out.
  const [g] = await h.kernel.db
    .insert(groups)
    .values({ key: 'firewall-team', name: 'Firewall team' })
    .returning({ id: groups.id });
  await h.kernel.db.insert(groupMembers).values({ groupId: g!.id, userId: ids.oncall! });
  // May assign roles (and manage forms), but not manage applications.
  const role = await h.call(admin, 'POST', '/api/v1/roles', {
    key: 'role-assigner',
    name: 'Role assigner',
    permissions: ['core.roles.assign', 'core.forms.manage', 'core.forms.read'],
  });
  await h.call(admin, 'POST', '/api/v1/role-assignments', {
    roleId: role.body.id,
    principalType: 'user',
    principalId: ids.assigner,
  });
  s.assigner = await h.login('assigner');
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('table fields (rows)', () => {
  let form: LooseJson;

  beforeAll(async () => {
    form = await t.mkForm('firewall-rules', {
      elements: [rulesField],
      actions: [notify('tell', 'Rules received')],
    });
  });

  it('is saved and published like any field, with its columns', async () => {
    const published = await h.call(admin, 'GET', `/api/v1/forms/${form.id}`);
    const field = published.body.published.elements.find((e: { key: string }) => e.key === 'rules');
    expect(field.rows.fields.map((c: { key: string }) => c.key)).toEqual(['port', 'owner', 'until']);
    const bad = await h.call(admin, 'PATCH', `/api/v1/forms/${form.id}`, {
      draft: { elements: [{ ...rulesField, rows: { fields: [] } }] },
    });
    expect(bad.status).toBe(400);
  });

  it('refuses invalid cells with row-indexed issue paths', async () => {
    const res = await h.call(s.mei!, 'POST', '/api/v1/forms/by-key/firewall-rules/submissions', {
      data: { rules: [{ port: 443 }, { port: 70000 }, { until: '2026-01-01' }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'data.rules.1.port', code: 'max', params: { max: 65535 } }),
        expect.objectContaining({ path: 'data.rules.2.port', code: 'required' }),
      ]),
    );
  });

  it('checks the number of rows and that people picked in cells exist', async () => {
    const tooMany = await h.call(s.mei!, 'POST', '/api/v1/forms/by-key/firewall-rules/submissions', {
      data: { rules: [{ port: 1 }, { port: 2 }, { port: 3 }, { port: 4 }] },
    });
    expect(tooMany.body.error.details.issues).toEqual([
      expect.objectContaining({ path: 'data.rules', code: 'maxRows', params: { max: 3 } }),
    ]);
    const empty = await h.call(s.mei!, 'POST', '/api/v1/forms/by-key/firewall-rules/submissions', {
      data: { rules: [{}] },
    });
    expect(empty.body.error.details.issues).toEqual([
      expect.objectContaining({ path: 'data.rules', code: 'required' }),
    ]);
    const ghost = await h.call(s.mei!, 'POST', '/api/v1/forms/by-key/firewall-rules/submissions', {
      data: { rules: [{ port: 22, owner: '0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d10' }] },
    });
    expect(ghost.status).toBe(400);
    expect(ghost.body.error.details.issues).toEqual([
      expect.objectContaining({ path: 'data.rules.0.owner', code: 'user' }),
    ]);
  });

  it('stores the cleaned rows, names the people in them and renders them in templates', async () => {
    const sub = await t.submit(s.mei!, 'firewall-rules', {
      rules: [{ port: '443', owner: ids.owner, ignored: 'x' }, {}, { port: 22, until: '2026-12-31' }],
    });
    expect(sub.data.rules).toEqual([
      { port: 443, owner: ids.owner },
      { port: 22, until: '2026-12-31' },
    ]);
    expect(sub.people[ids.owner!]).toBe('owner');
    await t.settledRuns(sub.id);
    const [message] = await messagesOf(ids.mei!);
    // `answers.<table>`: one line per row, "Column: value" with names for people.
    expect(message?.body).toBe('Port: 443 · Owner: owner\nPort: 22 · Until: 2026-12-31');
  });
});

describe('conditional actions (FormAction.when)', () => {
  const access = t.field('access', 'select', {
    options: [
      { value: 'vpn', label: { en: 'VPN' } },
      { value: 'none', label: { en: 'None' } },
    ],
  });

  it('runs an action only when its condition holds, and records the others as skipped', async () => {
    await t.mkForm('conditional', {
      elements: [access, rulesField],
      actions: [
        notify('vpn', 'VPN requested', { when: { fact: 'data.access', op: 'eq', value: 'vpn' } }),
        notify('ssh', 'SSH opened', { when: { fact: 'data.rules.port', op: 'eq', value: 22 } }),
        notify('always', 'Always'),
        notify('mine', 'Mine', { when: { fact: 'requester.id', op: 'eq', value: ids.mei! } }),
      ],
    });
    const sub = await t.submit(s.mei!, 'conditional', { access: 'none', rules: [{ port: 22 }] });
    const runs = await t.settledRuns(sub.id);
    const byAction = Object.fromEntries(runs.map((r) => [r.actionId, r]));
    expect(byAction.vpn).toMatchObject({ status: 'skipped', errorCode: SKIPPED_BY_CONDITION, attempts: 0 });
    expect(byAction.ssh?.status).toBe('succeeded');
    expect(byAction.always?.status).toBe('succeeded');
    expect(byAction.mine?.status).toBe('succeeded');
    const titles = (await messagesOf(ids.mei!)).map((m) => m.title);
    expect(titles).toEqual(expect.arrayContaining(['SSH opened', 'Always', 'Mine']));
    expect(titles).not.toContain('VPN requested');

    // The request shows why, to everyone, and the skip can't be "retried" past its condition.
    const page = await h.call(admin, 'GET', `/api/v1/form-submissions/${sub.id}`);
    const vpn = page.body.actions.find((a: { actionId: string }) => a.actionId === 'vpn');
    expect(vpn).toMatchObject({ status: 'skipped', reason: 'condition', canRetry: false, error: null });
    expect(page.body.actions.find((a: { actionId: string }) => a.actionId === 'ssh').reason).toBeNull();
    const retry = await h.call(admin, 'POST', `/api/v1/form-submissions/${sub.id}/actions/${vpn.id}/retry`);
    expect(retry.status).toBe(409);
    expect(retry.body.error.details.reason).toBe('condition');
  });

  it('decides approval actions when the approval completes', async () => {
    const workflowId = await t.approvalWorkflow('Conditional approval', ids.approver!);
    await t.mkForm(
      'conditional-approval',
      {
        elements: [access],
        actions: [
          notify('granted', 'VPN granted', {
            on: 'approved',
            when: { fact: 'data.access', op: 'eq', value: 'vpn' },
          }),
          notify('other', 'Something else', {
            on: 'approved',
            when: { fact: 'data.access', op: 'neq', value: 'vpn' },
          }),
        ],
      },
      { workflowDefinitionId: workflowId },
    );
    const sub = await t.submit(s.mei!, 'conditional-approval', { access: 'vpn' });
    expect(await t.runs(sub.id)).toEqual([]);
    await t.decide(sub.workflow.id, s.approver!, 'approve');
    const runs = await t.settledRuns(sub.id);
    expect(Object.fromEntries(runs.map((r) => [r.actionId, r.status]))).toEqual({
      granted: 'succeeded',
      other: 'skipped',
    });
  });

  it('refuses a malformed condition when the form is saved', async () => {
    const form = await t.mkForm('bad-condition', { elements: [access] }, { publish: false });
    const res = await h.call(admin, 'PATCH', `/api/v1/forms/${form.id}`, {
      draft: {
        elements: [access],
        actions: [notify('x', 'X', { when: { fact: 'data.access', op: 'like' } as never })],
      },
    });
    expect(res.status).toBe(400);
  });
});

describe('reminders (core.remind)', () => {
  const until = t.field('until', 'date');
  const remind = (extra: Record<string, unknown> = {}, on: FormAction['on'] = 'submitted'): FormAction => ({
    id: 'remind',
    on,
    type: 'core.remind',
    config: {
      dateFrom: 'field:until',
      offsetDays: -30,
      onlyFuture: true,
      toRequester: true,
      groups: ['firewall-team'],
      title: 'Rule {{request.reference}} expires on {{data.until}}',
      message: 'Renew or remove it.',
      ...extra,
    },
  });

  it('offers the form’s date fields, a step field and the outcome as the date', async () => {
    const list = await h.call(admin, 'POST', '/api/v1/forms/process-actions', {
      draft: { elements: [until, t.field('who', 'user')] },
    });
    const item = list.body.items.find((i: { type: string }) => i.type === 'core.remind');
    expect(item.allowed).toBe(true);
    const dateFrom = item.fields.find((f: { key: string }) => f.key === 'dateFrom');
    expect(dateFrom.options.map((o: { value: string }) => o.value)).toEqual([
      'field:until',
      'step',
      'outcome',
    ]);
    const groupsField = item.fields.find((f: { key: string }) => f.key === 'groups');
    expect(groupsField.options.map((o: { value: string }) => o.value)).toContain('firewall-team');
  });

  it('needs someone to remind', async () => {
    const form = await t.mkForm('remind-nobody', { elements: [until] }, { publish: false });
    const res = await h.call(admin, 'PATCH', `/api/v1/forms/${form.id}`, {
      draft: { elements: [until], actions: [remind({ toRequester: false, groups: [] })] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues).toEqual([
      expect.objectContaining({ path: 'draft.actions.0.config.toRequester', code: 'recipients' }),
    ]);
  });

  it('schedules a reminder on a date from an answer, and the job sends it when due', async () => {
    await t.mkForm('expiring-rule', { elements: [until], actions: [remind()] });
    const sub = await t.submit(s.mei!, 'expiring-rule', { until: isoDay(60) });
    const [run] = await t.settledRuns(sub.id);
    expect(run?.status, run?.error ?? '').toBe('succeeded');
    const [reminder] = await remindersOf(sub.id);
    // 30 days before the date, at 09:00 in the requester's time zone (UTC here).
    const due = new Date(`${isoDay(30)}T09:00:00.000Z`);
    expect(reminder).toMatchObject({
      moduleId: 'core',
      type: 'core.reminder.due',
      status: 'pending',
      recipients: { userIds: [ids.mei], groupKeys: ['firewall-team'], roleKeys: [] },
      href: `/requests/${sub.reference}`,
    });
    expect(reminder!.dueAt.toISOString()).toBe(due.toISOString());
    expect(run!.result).toMatchObject({
      summary: 'core.processActions.remind.scheduled',
      summaryParams: { date: due.toISOString() },
    });

    // On the request: listed with the action that set it.
    const page = await h.call(s.mei!, 'GET', `/api/v1/form-submissions/${sub.id}`);
    expect(page.body.reminders).toEqual([
      expect.objectContaining({
        id: reminder!.id,
        actionId: 'remind',
        status: 'pending',
        title: `Rule ${sub.reference} expires on ${isoDay(60)}`,
        sentAt: null,
      }),
    ]);

    // Not due yet: nothing goes out.
    expect((await h.kernel.reminders.deliverDue(new Date(due.getTime() - 60_000))).sent).toBe(0);
    // Due: the requester and the group's members (resolved now) get it, once.
    expect(await h.kernel.reminders.deliverDue(new Date(due.getTime() + 60_000))).toEqual({
      sent: 1,
      failed: 0,
    });
    expect(await h.kernel.reminders.deliverDue(new Date(due.getTime() + 120_000))).toEqual({
      sent: 0,
      failed: 0,
    });
    for (const who of ['mei', 'oncall']) {
      const got = await messagesOf(ids[who]!, 'core.reminder.due');
      expect(got).toEqual([
        {
          title: `Rule ${sub.reference} expires on ${isoDay(60)}`,
          body: 'Renew or remove it.',
          href: `/requests/${sub.reference}`,
        },
      ]);
    }
    const [sent] = await remindersOf(sub.id);
    expect(sent).toMatchObject({ status: 'sent' });
    expect(sent!.sentAt).toBeInstanceOf(Date);
  });

  it('is idempotent on the run: running it again finds the reminder it made', async () => {
    const sub = await t.submit(s.mei!, 'expiring-rule', { until: isoDay(90) });
    const [run] = await t.settledRuns(sub.id);
    const request = {
      id: sub.id,
      reference: sub.reference,
      href: `/requests/${sub.reference}`,
      form: { key: 'expiring-rule', name: { en: 'expiring-rule' } },
      outcome: 'submitted',
      data: { until: isoDay(90) },
      records: {},
      steps: {},
      requester: { id: ids.mei!, displayName: 'mei', email: 'mei@test.example', departmentId: null },
      decidedBy: null,
    } as ProcessActionRequest;
    const again = await remindAction.run(
      {
        config: remind().config,
        request,
        runId: run!.id,
        attempt: 2,
        auth: h.kernel.processActions.authFor('core', 'expiring-rule'),
      },
      h.kernel.registry.context('core'),
    );
    expect(again.summaryParams).toEqual(run!.result!.summaryParams);
    expect(await remindersOf(sub.id)).toHaveLength(1);
  });

  it('sets nothing for a date that has passed (only future), or a missing date', async () => {
    await t.mkForm('optional-date', { elements: [until], actions: [remind()] });
    const past = await t.submit(s.mei!, 'optional-date', { until: isoDay(10) });
    const [pastRun] = await t.settledRuns(past.id);
    expect(pastRun!.result).toMatchObject({ summary: 'core.processActions.remind.passed' });
    const none = await t.submit(s.mei!, 'optional-date', {});
    const [noneRun] = await t.settledRuns(none.id);
    expect(noneRun!.result).toMatchObject({ summary: 'core.processActions.remind.noDate' });
    expect(await remindersOf(past.id)).toEqual([]);
    expect(await remindersOf(none.id)).toEqual([]);
  });

  it('can count days after the outcome, and is cancelled with the request', async () => {
    const workflowId = await t.approvalWorkflow('Reminder approval', ids.approver!);
    await t.mkForm(
      'withdrawn-reminder',
      { elements: [until], actions: [remind({ dateFrom: 'outcome', offsetDays: 7, groups: [] })] },
      { workflowDefinitionId: workflowId },
    );
    const sub = await t.submit(s.mei!, 'withdrawn-reminder', { until: isoDay(5) });
    await t.settledRuns(sub.id);
    const [pending] = await remindersOf(sub.id);
    expect(pending?.status).toBe('pending');
    expect(Math.abs(pending!.dueAt.getTime() - (Date.now() + 7 * DAY))).toBeLessThan(5 * 60_000);
    const cancelled = await h.call(s.mei!, 'POST', `/api/v1/form-submissions/${sub.id}/cancel`, {});
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.reminders).toEqual([expect.objectContaining({ status: 'cancelled' })]);
    expect((await h.kernel.reminders.deliverDue(new Date(Date.now() + 30 * DAY))).sent).toBe(0);
  });
});

describe('application roles in core.grant-role', () => {
  const ids2: Record<string, string> = {};

  beforeAll(async () => {
    const app = await h.call(admin, 'POST', '/api/v1/applications', { key: 'vpn', name: 'VPN' });
    expect(app.status, JSON.stringify(app.body)).toBe(201);
    ids2.app = app.body.id;
    for (const [key, name] of [
      ['remote-access', 'Remote access'],
      ['vpn-admin', 'VPN administrator'],
    ] as const) {
      const role = await h.call(admin, 'POST', `/api/v1/applications/${ids2.app}/roles`, { key, name });
      expect(role.status, JSON.stringify(role.body)).toBe(201);
      ids2[key] = role.body.id;
    }
    // Remote access can be requested by anyone; the administrator role can't.
    await h.kernel.db.update(roles).set({ requestable: true }).where(eq(roles.id, ids2['remote-access']!));
  });

  const grant = (roleId: string): FormAction => ({
    id: 'grant',
    on: 'approved',
    type: 'core.grant-role',
    config: { roleId, person: 'requester', durationDays: 30, reason: '{{request.reference}}' },
  });

  it('offers application roles: requestable ones, or ones the editor could assign', async () => {
    const options = async (session: Session) => {
      const list = await h.call(session, 'POST', '/api/v1/forms/process-actions', {
        draft: { elements: [] },
      });
      const item = list.body.items.find((i: { type: string }) => i.type === 'core.grant-role');
      return item.fields.find((f: { key: string }) => f.key === 'roleId').options as {
        value: string;
        label: { en: string };
      }[];
    };
    const forAdmin = await options(admin);
    expect(forAdmin).toEqual(
      expect.arrayContaining([
        { value: ids2['remote-access'], label: { en: 'VPN · Remote access' } },
        { value: ids2['vpn-admin'], label: { en: 'VPN · VPN administrator' } },
      ]),
    );
    const forAssigner = (await options(s.assigner!)).map((o) => o.value);
    expect(forAssigner).toContain(ids2['remote-access']);
    expect(forAssigner).not.toContain(ids2['vpn-admin']);

    // Saving checks it again: the assigner can't manage the VPN application, so not its admin role.
    const form = await t.mkForm('vpn-admin-form', { elements: [] }, { publish: false });
    const refused = await h.call(s.assigner!, 'PATCH', `/api/v1/forms/${form.id}`, {
      draft: { elements: [t.field('why', 'text')], actions: [grant(ids2['vpn-admin']!)] },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({
      code: 'PRIVILEGE_ESCALATION',
      details: { permission: 'core.applications.manage', application: 'vpn' },
    });
  });

  it('grants the application role with its expiry and links to the application', async () => {
    await t.mkForm('vpn-access', {
      elements: [t.field('why', 'text')],
      actions: [grant(ids2['remote-access']!)],
    });
    const sub = await t.submit(s.mei!, 'vpn-access', { why: 'Working from home' });
    const [run] = await t.settledRuns(sub.id);
    expect(run?.status, run?.error ?? '').toBe('succeeded');
    expect(run!.result).toMatchObject({
      reference: 'VPN · Remote access',
      href: `/admin/applications/${ids2.app}`,
      summary: 'core.processActions.grantRole.granted',
    });
    const [assignment] = await h.kernel.db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.roleId, ids2['remote-access']!), eq(roleAssignments.userId, ids.mei!)));
    expect(assignment).toMatchObject({ source: 'request', scopeType: 'global', reason: sub.reference });
    expect(Math.abs(assignment!.expiresAt!.getTime() - (Date.now() + 30 * DAY))).toBeLessThan(5 * 60_000);
    // The holder appears under the application (Role Query and the application's page read the same rows).
    const [app] = await h.kernel.db.select().from(applications).where(eq(applications.id, ids2.app!));
    expect(app?.key).toBe('vpn');
    const [person] = await h.kernel.db.select({ id: users.id }).from(users).where(eq(users.id, ids.mei!));
    expect(person).toBeDefined();
    // A second request extends the same grant (one assignment per person and role).
    const again = await t.submit(s.mei!, 'vpn-access', { why: 'Still' });
    const [run2] = await t.settledRuns(again.id);
    expect(run2!.result).toMatchObject({ summary: 'core.processActions.grantRole.extended' });
    const all = await h.kernel.db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.roleId, ids2['remote-access']!), eq(roleAssignments.userId, ids.mei!)));
    expect(all).toHaveLength(1);
  });
});

describe('the run row of a skipped action', () => {
  it('is never handed to the worker', async () => {
    const skipped = await h.kernel.db
      .select()
      .from(processActionRuns)
      .where(eq(processActionRuns.errorCode, SKIPPED_BY_CONDITION));
    expect(skipped.length).toBeGreaterThan(0);
    for (const r of skipped) expect(r).toMatchObject({ status: 'skipped', attempts: 0, startedAt: null });
  });
});

describe('the core.form kind (the assistant)', () => {
  const name = (en: string) => ({ en, 'zh-TW': en, 'ja-JP': en });
  const value = (actions: FormAction[], elements: unknown[] = [rulesField]) => ({
    key: 'kind-table-form',
    name: name('Kind table form'),
    description: null,
    icon: 'file-text',
    category: 'Network',
    schema: { elements, actions },
    workflowId: null,
    audience: { type: 'everyone' },
    active: true,
  });
  const codes = async (v: ReturnType<typeof value>) => {
    const auth = (await h.kernel.registry.context('core').rbac.authFor(h.ids.admin))!;
    return (
      await h.kernel.customizations.validate('core.form', { op: 'create', id: null, value: v }, auth)
    ).issues.map((i) => i.code);
  };

  it('accepts tables and conditional actions reading answers, table columns, steps, the requester and today', async () => {
    expect(
      await codes(
        value([
          notify('ssh', 'SSH', {
            when: {
              all: [
                { fact: 'data.rules.port', op: 'eq', value: 22 },
                { fact: 'steps.review.result', op: 'eq', value: 'ok' },
                { fact: 'requester.departmentCode', op: 'eq', value: 'IS' },
                { fact: 'data.rules.until', op: 'gte', valueFact: 'today', valueOffsetDays: 30 },
              ],
            },
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it('flags a condition on something the form does not have', async () => {
    expect(await codes(value([notify('x', 'X', { when: { fact: 'data.nope', op: 'notEmpty' } })]))).toEqual([
      'unknown_field',
    ]);
    expect(
      await codes(value([notify('x', 'X', { when: { fact: 'rules.port', op: 'eq', value: 1 } })])),
    ).toEqual(['unknown_field']);
  });
});
