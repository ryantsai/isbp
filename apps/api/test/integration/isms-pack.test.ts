/**
 * The ISMS process pack (`isms/isms-processes`, a built-in change-set package): installed by an administrator as one
 * draft change set whose every item passes its kind's checks in the dry run, applied, then used end to end through
 * the API — firewall rules, account requests with and without a security review, the server room inspection that
 * raises an incident whose resolution waits for an ISMS approver, device checkout and return, a short-term software
 * installation, a shared account, a security incident report and the monthly inspection job — and finally rolled
 * back. (A package can't be installed again after a rollback: archived forms, categories and custom fields keep
 * their keys, so the flows run before the rollback.)
 */
import { periodKey } from '@isbp/contracts';
import {
  approvalTasks,
  customFields,
  formAssignments,
  forms,
  groupMembers,
  groups,
  notifications,
  processActionRuns,
  roleAssignments,
  roles,
  scheduledReminders,
  users,
  workflowDefinitions,
} from '@isbp/db/schema';
import { addMonths } from '@isbp/module-itam/model';
import { approvedSoftware, approvedSoftwareDepartments, assets } from '@isbp/module-itam/schema';
import { accountMembers, sharedAccounts } from '@isbp/module-isms/schema';
import { categories, tickets } from '@isbp/module-itsm/schema';
import { jobs } from '@isbp/module-scheduler/schema';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
let changeSetId: string;

const A = '/api/v1/assistant';
const DAY = 86_400_000;
/** A day relative to today (UTC, as form rules see `today`). */
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

const eventually = async <T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 20_000) => {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
};

async function mkUser(username: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      ...extra,
    })
    .returning();
  return u!.id;
}

const submit = (who: string, key: string, data: Record<string, unknown>) =>
  h.call(s[who]!, 'POST', `/api/v1/forms/by-key/${key}/submissions`, { data });

async function submitted(who: string, key: string, data: Record<string, unknown>) {
  const res = await submit(who, key, data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as LooseJson;
}

/** The pending task of `who` on an instance (waits for the step to start). */
async function taskOf(instanceId: string, who: string) {
  const rows = await eventually(
    () =>
      h.kernel.db
        .select()
        .from(approvalTasks)
        .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending'))),
    (r) => r.some((t) => t.assigneeId === ids[who]),
  );
  const task = rows.find((t) => t.assigneeId === ids[who]);
  expect(task, `${who} has no pending task (pending: ${rows.map((r) => r.stepId).join(', ')})`).toBeDefined();
  return task!;
}

const pendingSteps = async (instanceId: string) =>
  (
    await h.kernel.db
      .select({ stepId: approvalTasks.stepId })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')))
  ).map((r) => r.stepId);

const decide = (
  who: string,
  taskId: string,
  verdict: 'approve' | 'reject',
  body: Record<string, unknown> = {},
) => h.call(s[who]!, 'POST', `/api/v1/approvals/${taskId}/${verdict}`, body);

async function approve(instanceId: string, who: string, data?: Record<string, unknown>) {
  const task = await taskOf(instanceId, who);
  const res = await decide(who, task.id, 'approve', { comment: 'OK', ...(data ? { data } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as LooseJson;
}

const runsOf = (submissionId: string) =>
  h.kernel.db
    .select()
    .from(processActionRuns)
    .where(eq(processActionRuns.submissionId, submissionId))
    .orderBy(processActionRuns.createdAt);

/** The process action runs of a request once they have all finished, by action id. */
async function settled(submissionId: string, count: number) {
  const runs = await eventually(
    () => runsOf(submissionId),
    (r) => r.length >= count && r.every((x) => ['succeeded', 'failed', 'skipped'].includes(x.status)),
  );
  return Object.fromEntries(runs.map((r) => [r.actionId, r]));
}

const remindersOf = (submissionId: string) =>
  h.kernel.db
    .select()
    .from(scheduledReminders)
    .where(
      sql`${scheduledReminders.source} @> ${JSON.stringify({ type: 'form-submission', id: submissionId })}::jsonb`,
    );

const ticketFor = async (submissionId: string) =>
  (
    await h.kernel.db
      .select()
      .from(tickets)
      .where(sql`${tickets.source}->>'submissionId' = ${submissionId}`)
  )[0];

const groupId = async (key: string) =>
  (await h.kernel.db.select({ id: groups.id }).from(groups).where(eq(groups.key, key)))[0]?.id;
const categoryId = async (key: string) =>
  (await h.kernel.db.select({ id: categories.id }).from(categories).where(eq(categories.key, key)))[0]?.id;

const issuesOf = (res: { body: LooseJson }) =>
  ((res.body.error?.details?.issues ?? []) as { path: string; code: string }[]).map((i) => [i.path, i.code]);

beforeAll(async () => {
  h = await createHarness();
  h.kernel.processActions.retryDelayMs = 100;
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  ids.boss = await mkUser('boss', { departmentId: h.ids.sales });
  ids.mei = await mkUser('mei', { departmentId: h.ids.sales, managerId: ids.boss });
  for (const u of ['ciso', 'itops', 'neteng', 'dcops', 'secrev']) ids[u] = await mkUser(u);
  // IT picks devices from Assets at the checkout step: it reads the hardware register.
  const [am] = await h.kernel.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, 'itam-asset-manager'));
  await h.kernel.db.insert(roleAssignments).values({ roleId: am!.id, userId: ids.itops! });
  await h.kernel.rbac.bump();
  for (const u of ['boss', 'mei', 'ciso', 'itops', 'neteng', 'dcops', 'secrev']) s[u] = await h.login(u);
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

/* ───────────── install and apply ───────────── */

describe('installing the ISMS process pack', () => {
  it('is listed for administrators with everything it needs', async () => {
    const list = await h.call(admin, 'GET', `${A}/packages`);
    expect(list.status).toBe(200);
    const pack = (list.body.items as LooseJson[]).find(
      (p) => p.moduleId === 'isms' && p.key === 'isms-processes',
    );
    expect(pack).toMatchObject({
      name: 'isms.packages.processes.name',
      canPropose: true,
      canApply: true,
      kinds: [
        'core.custom-field',
        'core.form',
        'core.group',
        'core.workflow',
        'itsm.category',
        'scheduler.job',
      ],
      requirements: {
        missingModules: [],
        unknownKinds: [],
        unreadableKinds: [],
        missingApplyPermissions: [],
      },
    });
  });

  it('becomes a draft change set whose every item passes its dry run', async () => {
    const res = await h.call(admin, 'POST', `${A}/packages/isms/isms-processes/install`, {});
    expect(res.status, JSON.stringify(res.body).slice(0, 3000)).toBe(201);
    const set = res.body as LooseJson;
    changeSetId = set.id;
    const failed = (set.items as LooseJson[])
      .filter((i) => !i.check?.ok)
      .map((i) => ({ label: i.label, issues: i.check?.issues, error: i.check?.error }));
    expect(failed).toEqual([]);
    expect(set).toMatchObject({ title: 'ISMS process pack', status: 'draft', ready: true });
    const count = (kind: string) => (set.items as LooseJson[]).filter((i) => i.kind === kind).length;
    expect({
      groups: count('core.group'),
      categories: count('itsm.category'),
      fields: count('core.custom-field'),
      workflows: count('core.workflow'),
      forms: count('core.form'),
      jobs: count('scheduler.job'),
    }).toEqual({ groups: 5, categories: 3, fields: 1, workflows: 21, forms: 21, jobs: 8 });
    // Only the dry run ran.
    expect(await groupId('isms-authority')).toBeUndefined();
  });

  it('is prepared in the installer’s language: names, jobs and reminders, every item passing its dry run', async () => {
    const platformAdmin = (
      await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'platform-admin'))
    )[0]!.id;
    for (const locale of ['zh-TW', 'ja-JP'] as const) {
      const username = `pack-admin-${locale.toLowerCase()}`;
      const userId = await mkUser(username, { locale });
      await h.kernel.db.insert(roleAssignments).values({ roleId: platformAdmin, userId });
      await h.kernel.rbac.bump();
      const installer = await h.login(username);
      const res = await h.call(installer, 'POST', `${A}/packages/isms/isms-processes/install`, {});
      expect(res.status, JSON.stringify(res.body).slice(0, 3000)).toBe(201);
      const set = res.body as LooseJson;
      const failed = (set.items as LooseJson[])
        .filter((i) => !i.check?.ok)
        .map((i) => ({ label: i.label, issues: i.check?.issues, error: i.check?.error }));
      expect(failed, locale).toEqual([]);
      expect(set.ready).toBe(true);
      const byRef = Object.fromEntries((set.items as LooseJson[]).map((i) => [i.ref, i]));
      if (locale === 'zh-TW') {
        expect(set.title).toBe('ISMS 流程範本套件');
        expect(byRef['group-authority']).toMatchObject({
          label: '權責主管',
          value: { key: 'isms-authority', name: '權責主管' },
        });
        expect(byRef['job-server-room-inspection']!.value).toMatchObject({
          name: 'ISMS：每月機房巡檢',
          config: { formKey: 'isms-server-room-inspection', title: '機房巡檢 {{period}}' },
        });
        expect(byRef['workflow-account-request']!.label).toBe('帳號權限申請簽核');
        const actions = byRef['form-account-retention']!.value.schema.actions as LooseJson[];
        expect(actions.find((a) => a.id === 'remind-day')!.config).toMatchObject({
          groups: ['isms-it'],
          title: '今日請刪除帳號：{{request.reference}}',
        });
      } else {
        expect(set.title).toBe('ISMS プロセス パック');
        expect(byRef['group-authority']!.value.name).toBe('ISMS 承認者');
      }
      // Only drafts: nothing exists until a set is applied.
      expect(await groupId('isms-authority')).toBeUndefined();
      expect((await h.call(installer, 'POST', `${A}/change-sets/${set.id}/discard`)).status).toBe(200);
    }
  });

  it('applies: groups, categories, sign-off, custom field, published forms and enabled jobs', async () => {
    const res = await h.call(admin, 'POST', `${A}/change-sets/${changeSetId}/apply`, {});
    expect(res.status, JSON.stringify(res.body).slice(0, 2000)).toBe(200);
    expect(res.body.status).toBe('applied');

    const made = await h.kernel.db
      .select({ key: groups.key, name: groups.name })
      .from(groups)
      .where(like(groups.key, 'isms-%'));
    expect(made.map((g) => g.key).sort()).toEqual([
      'isms-authority',
      'isms-it',
      'isms-network',
      'isms-security-review',
      'isms-server-room',
    ]);
    const live = await h.kernel.db
      .select({ key: forms.key, published: forms.publishedVersion, workflowId: forms.workflowDefinitionId })
      .from(forms)
      .where(like(forms.key, 'isms-%'));
    expect(live).toHaveLength(21);
    expect(live.every((f) => f.published === 1)).toBe(true);
    // Every form but the incident report has its approval.
    expect(live.filter((f) => !f.workflowId).map((f) => f.key)).toEqual(['isms-security-report']);
    const [signOff] = await h.kernel.db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.triggerKey, 'itsm.resolution'));
    expect(signOff).toMatchObject({
      name: 'isms.packages.processes.workflows.resolutionSignOff',
      isDefault: true,
    });
    expect(signOff!.publishedVersion).toBe(1);
    const anomaly = (
      await h.kernel.db.select().from(categories).where(eq(categories.key, 'isms-resource-anomaly'))
    )[0];
    expect(anomaly).toMatchObject({ active: true, defaultGroupId: await groupId('isms-server-room') });
    const [field] = await h.kernel.db
      .select()
      .from(customFields)
      .where(
        and(eq(customFields.entityType, 'itsm.ticket'), eq(customFields.key, 'defaultPasswordsChanged')),
      );
    expect(field).toBeDefined();
    const scheduled = await h.kernel.db
      .select({ name: jobs.name, enabled: jobs.enabled, cron: jobs.cron, timezone: jobs.timezone })
      .from(jobs)
      .where(like(jobs.name, 'ISMS: %'));
    expect(scheduled).toHaveLength(8);
    expect(scheduled.every((j) => j.enabled && j.timezone === 'Asia/Taipei')).toBe(true);

    // Members are each site's people: added after applying.
    const members: Record<string, string[]> = {
      'isms-authority': ['ciso'],
      'isms-it': ['itops'],
      'isms-network': ['neteng'],
      'isms-server-room': ['dcops'],
      'isms-security-review': ['secrev'],
    };
    for (const [key, who] of Object.entries(members)) {
      const added = await h.call(admin, 'POST', `/api/v1/groups/${await groupId(key)}/members`, {
        userIds: who.map((u) => ids[u]),
      });
      expect(added.status, JSON.stringify(added.body)).toBeLessThan(300);
    }
  });
});

/* ───────────── the processes ───────────── */

describe('firewall rule change', () => {
  const rules = [{ source: '10.0.0.0/24', destination: '192.0.2.10', port: '443/tcp', decision: 'allow' }];

  it('refuses rules valid for more than a year', async () => {
    const res = await submit('mei', 'isms-firewall-rule', {
      reasonType: 'project',
      request: 'add',
      reason: 'Partner API',
      validFrom: day(0),
      validUntil: day(400),
      rules,
    });
    expect(res.status).toBe(400);
    expect(issuesOf(res)).toContainEqual(['data.validUntil', 'rule']);
    const empty = await submit('mei', 'isms-firewall-rule', {
      reasonType: 'project',
      request: 'add',
      reason: 'Partner API',
      validFrom: day(0),
      validUntil: day(30),
      rules: [],
    });
    expect(issuesOf(empty)).toContainEqual(['data.rules', 'required']);
  });

  it('goes through the manager, the network evaluation, the ISMS approver and the configuration', async () => {
    const sub = await submitted('mei', 'isms-firewall-rule', {
      reasonType: 'project',
      request: 'add',
      reason: 'Partner API',
      validFrom: day(0),
      validUntil: day(60),
      rules,
    });
    await approve(sub.workflow.id, 'boss');
    await approve(sub.workflow.id, 'neteng', { evaluation: 'Narrow enough' });
    await approve(sub.workflow.id, 'ciso');
    // Configuring needs the date it was done.
    const task = await taskOf(sub.workflow.id, 'neteng');
    expect(task.stepId).toBe('configure');
    const missing = await decide('neteng', task.id, 'approve', { comment: 'Done' });
    expect(missing.status).toBe(400);
    expect(issuesOf(missing)).toContainEqual(['data.configuredOn', 'required']);
    const done = await decide('neteng', task.id, 'approve', {
      comment: 'Done',
      data: { configuredOn: day(0) },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.outcome).toBe('approved');

    const runs = await settled(sub.id, 1);
    expect(runs['remind-expiry']!.status).toBe('succeeded');
    const [reminder] = await remindersOf(sub.id);
    expect(reminder!.dueAt.toISOString()).toBe(`${day(46)}T09:00:00.000Z`);
    expect(reminder!.recipients).toEqual({ userIds: [ids.mei], groupKeys: ['isms-network'], roleKeys: [] });
  });
});

describe('account and access request', () => {
  const base = { subject: '', reason: 'new_hire' };

  it('needs at least one account, and a reason for administrator privileges', async () => {
    const none = await submit('mei', 'isms-account-request', { ...base, subject: ids.mei });
    expect(none.status).toBe(400);
    expect(issuesOf(none)).toContainEqual(['data.newAccounts', 'rule']);
    const admin = await submit('mei', 'isms-account-request', {
      ...base,
      subject: ids.mei,
      newAccounts: [{ system: 'server', target: 'app-01', privilege: 'admin' }],
    });
    expect(issuesOf(admin)).toContainEqual(['data.privilegedReason', 'rule']);
  });

  it('skips the security review without administrator privileges', async () => {
    const sub = await submitted('mei', 'isms-account-request', {
      ...base,
      subject: ids.mei,
      newAccounts: [{ system: 'vpn', target: 'Remote access', account: 'mei', privilege: 'user' }],
    });
    await approve(sub.workflow.id, 'boss');
    await approve(sub.workflow.id, 'ciso');
    await taskOf(sub.workflow.id, 'itops');
    expect(await pendingSteps(sub.workflow.id)).toEqual(['it']);
    const done = await approve(sub.workflow.id, 'itops', { result: 'done' });
    expect(done.outcome).toBe('approved');
    const runs = await settled(sub.id, 1);
    expect(runs['tell-server-room']!.status).toBe('skipped');
  });

  it('adds the security review for administrator privileges, and tells the server room about access', async () => {
    const sub = await submitted('mei', 'isms-account-request', {
      ...base,
      subject: ids.mei,
      newAccounts: [
        { system: 'server', target: 'app-01', account: 'mei-adm', privilege: 'admin' },
        { system: 'server_room', target: 'Main server room', privilege: 'user' },
      ],
      privilegedReason: 'Runs the deployments',
    });
    await approve(sub.workflow.id, 'boss');
    await approve(sub.workflow.id, 'ciso');
    await taskOf(sub.workflow.id, 'secrev');
    expect(await pendingSteps(sub.workflow.id)).toEqual(['security']);
    await approve(sub.workflow.id, 'secrev');
    const itTask = await taskOf(sub.workflow.id, 'itops');
    const notDone = await decide('itops', itTask.id, 'approve', {
      comment: 'x',
      data: { result: 'not_done' },
    });
    expect(issuesOf(notDone)).toContainEqual(['data.notDoneReason', 'required']);
    expect((await approve(sub.workflow.id, 'itops', { result: 'done' })).outcome).toBe('approved');

    const runs = await settled(sub.id, 1);
    expect(runs['tell-server-room']!.status).toBe('succeeded');
    const told = await eventually(
      () =>
        h.kernel.db
          .select({ title: notifications.title })
          .from(notifications)
          .where(
            and(eq(notifications.userId, ids.dcops!), eq(notifications.type, 'core.process-action.message')),
          ),
      (r) => r.length > 0,
    );
    expect(told[0]!.title).toBe(`Server room access to set up: ${sub.reference}`);
  });
});

describe('server room inspection', () => {
  const normal = { monitoring: 'normal', racks: 'normal', tidiness: 'normal', spares: 'normal' };

  it('is offered to the server room administrators only', async () => {
    // Outside the audience (and without an assignment) the form doesn't exist for them.
    expect(
      (await submit('mei', 'isms-server-room-inspection', { inspectedOn: day(0), ...normal })).status,
    ).toBe(404);
  });

  it('raises an incident for an abnormal check, whose resolution waits for an ISMS approver', async () => {
    const noNote = await submit('dcops', 'isms-server-room-inspection', {
      inspectedOn: day(0),
      ...normal,
      racks: 'abnormal',
    });
    expect(issuesOf(noNote)).toContainEqual(['data.racksNote', 'rule']);
    const sub = await submitted('dcops', 'isms-server-room-inspection', {
      inspectedOn: day(0),
      ...normal,
      racks: 'abnormal',
      racksNote: 'Rack B3 unlocked',
    });
    const runs = await settled(sub.id, 1);
    expect(runs['raise-anomaly']!.status, JSON.stringify(runs['raise-anomaly'])).toBe('succeeded');
    const ticket = (await ticketFor(sub.id))!;
    expect(ticket).toMatchObject({
      type: 'incident',
      categoryId: await categoryId('isms-resource-anomaly'),
      assignmentGroupId: await groupId('isms-server-room'),
      title: `Server room inspection found an issue: ${sub.reference}`,
    });
    expect(ticket.description).toContain('Rack B3 unlocked');

    const reference = (runs['raise-anomaly']!.result as LooseJson).reference as string;
    const held = await h.call(admin, 'POST', `/api/v1/itsm/tickets/${reference}/transition`, {
      status: 'resolved',
      resolutionCode: 'solved',
      resolutionNotes: 'Locked the rack and checked its contents',
    });
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    expect(held.body).toMatchObject({ status: 'pending_approval', awaitingSignOff: true });
    await approve(held.body.signOff.instanceId, 'ciso');
    const resolved = await eventually(
      () => h.call(admin, 'GET', `/api/v1/itsm/tickets/${reference}`),
      (r) => r.body.status === 'resolved',
    );
    expect(resolved.body.status).toBe('resolved');
  });

  it('raises nothing when every check is normal', async () => {
    const sub = await submitted('dcops', 'isms-server-room-inspection', { inspectedOn: day(0), ...normal });
    const runs = await settled(sub.id, 1);
    expect(runs['raise-anomaly']!.status).toBe('skipped');
  });
});

describe('devices', () => {
  let laptop: LooseJson;

  it('hands out the device IT picks, once the security baseline is ticked', async () => {
    const created = await h.call(admin, 'POST', '/api/v1/itam/assets', {
      name: 'PACK-LT-01',
      category: 'laptop',
      serialNumber: `PACK-${Date.now() % 100000}`,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    laptop = created.body;

    const unsigned = await submit('mei', 'isms-device-checkout', {
      deviceType: 'laptop',
      purpose: 'Field work',
      agree: false,
    });
    expect(issuesOf(unsigned)).toContainEqual(['data.agree', 'required']);
    const sub = await submitted('mei', 'isms-device-checkout', {
      deviceType: 'laptop',
      offsite: true,
      purpose: 'Field work',
      agree: true,
    });
    await approve(sub.workflow.id, 'boss');
    const task = await taskOf(sub.workflow.id, 'itops');
    const checks = {
      mdmEnrolled: true,
      diskEncryption: true,
      antivirus: true,
      monitoringAgent: true,
      vpnConfigured: true,
      osUpdated: true,
    };
    const unticked = await decide('itops', task.id, 'approve', {
      comment: 'Issued',
      data: { asset: `itam.asset:${laptop.id}`, ...checks, vpnConfigured: false, issuedOn: day(0) },
    });
    expect(issuesOf(unticked)).toContainEqual(['data.vpnConfigured', 'required']);
    const res = await decide('itops', task.id, 'approve', {
      comment: 'Issued',
      data: { asset: `itam.asset:${laptop.id}`, ...checks, issuedOn: day(0) },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe('approved');

    const runs = await settled(sub.id, 1);
    expect(runs.assign!.status, JSON.stringify(runs.assign)).toBe('succeeded');
    const [row] = await h.kernel.db.select().from(assets).where(eq(assets.id, laptop.id));
    expect(row).toMatchObject({ status: 'deployed', assignedTo: ids.mei });
  });

  it('adds short-term software to the approved list until its end date, with a reminder', async () => {
    const sub = await submitted('mei', 'isms-software-install', {
      device: `itam.asset:${laptop.id}`,
      softwareName: 'Pack Diagram Tool',
      version: '3.2',
      publisher: 'Example Software',
      licenceType: 'free',
      purpose: 'Draw the network diagram',
      usage: 'short_term',
      until: day(30),
    });
    await approve(sub.workflow.id, 'boss');
    await approve(sub.workflow.id, 'secrev', {
      noMalware: true,
      compatible: true,
      licenceCompliant: true,
      cloudService: 'not_needed',
    });
    const runs = await settled(sub.id, 3);
    expect([runs.approve!.status, runs['remind-end']!.status, runs['buy-licence']!.status]).toEqual([
      'succeeded',
      'succeeded',
      'skipped',
    ]);
    const [entry] = await h.kernel.db
      .select()
      .from(approvedSoftware)
      .where(eq(approvedSoftware.title, 'Pack Diagram Tool'));
    expect(entry).toMatchObject({
      status: 'allowed',
      scope: 'departments',
      validUntil: day(30),
      version: '3.2',
    });
    const scope = await h.kernel.db
      .select({ departmentId: approvedSoftwareDepartments.departmentId })
      .from(approvedSoftwareDepartments)
      .where(eq(approvedSoftwareDepartments.entryId, entry!.id));
    expect(scope).toEqual([{ departmentId: h.ids.sales }]);
    const [reminder] = await remindersOf(sub.id);
    expect(reminder!.dueAt.toISOString()).toBe(`${day(23)}T09:00:00.000Z`);
    expect(reminder!.recipients).toMatchObject({ userIds: [ids.mei], groupKeys: ['isms-it'] });
  });

  it('takes the device back with the retention date IT sets, and its wipe due after it', async () => {
    const sub = await submitted('mei', 'isms-device-return', {
      asset: `itam.asset:${laptop.id}`,
      returnedOn: day(0),
      returnTime: '14:30',
      note: 'Leaving the project',
    });
    await approve(sub.workflow.id, 'itops', {
      receivedOn: day(0),
      dataCheck: 'normal',
      appearance: 'good',
      retainUntil: day(30),
      storedAt: 'Cabinet 2',
      factoryReset: false,
    });
    expect((await approve(sub.workflow.id, 'ciso')).outcome).toBe('approved');
    const runs = await settled(sub.id, 2);
    expect(runs['return-stock']!.status, JSON.stringify(runs['return-stock'])).toBe('succeeded');
    expect(runs['return-repair']!.status).toBe('skipped');
    const [row] = await h.kernel.db.select().from(assets).where(eq(assets.id, laptop.id));
    expect(row).toMatchObject({
      status: 'in_stock',
      assignedTo: null,
      dataRetainUntil: day(30),
      wipeDue: addMonths(day(30), 2),
    });
  });
});

describe('shared account, incident report and recurring checklist', () => {
  it('registers the approved shared account with its custodian and members', async () => {
    const sub = await submitted('mei', 'isms-shared-account', {
      purpose: 'project',
      purposeDetail: 'Data centre migration',
      target: 'File server',
      accountName: 'svc-pack-migration',
      custodian: ids.mei,
      members: [{ person: ids.itops, title: 'Engineer' }],
      reason: 'The migration tool runs as one account',
      consentEncrypted: true,
      consentChange: true,
      consentLog: true,
    });
    await approve(sub.workflow.id, 'boss');
    await approve(sub.workflow.id, 'ciso');
    const runs = await settled(sub.id, 1);
    expect(runs.register!.status, JSON.stringify(runs.register)).toBe('succeeded');
    const [account] = await h.kernel.db
      .select()
      .from(sharedAccounts)
      .where(eq(sharedAccounts.accountName, 'svc-pack-migration'));
    expect(account).toMatchObject({
      custodianId: ids.mei,
      targetSystem: 'File server',
      project: 'Data centre migration',
      requestReference: sub.reference,
    });
    const members = await h.kernel.db
      .select({ userId: accountMembers.userId })
      .from(accountMembers)
      .where(eq(accountMembers.accountId, account!.id));
    expect(members).toEqual([{ userId: ids.itops }]);
  });

  it('raises a high-priority incident for the security reviewers from a security report', async () => {
    const sub = await submitted('mei', 'isms-security-report', {
      type: 'suspicious_message',
      occurredOn: day(0),
      occurredAt: '09:30',
      description: 'A message asked for my password',
    });
    expect(sub.workflow).toBeFalsy();
    const runs = await settled(sub.id, 1);
    expect(runs['raise-incident']!.status, JSON.stringify(runs['raise-incident'])).toBe('succeeded');
    expect(await ticketFor(sub.id)).toMatchObject({
      type: 'incident',
      priority: 2,
      requesterId: ids.mei,
      categoryId: await categoryId('isms-security-report'),
      assignmentGroupId: await groupId('isms-security-review'),
    });
  });

  it('opens one server room inspection per month for the server room administrators', async () => {
    const [job] = await h.kernel.db
      .select()
      .from(jobs)
      .where(eq(jobs.name, 'ISMS: monthly server room inspection'));
    const [form] = await h.kernel.db
      .select({ id: forms.id })
      .from(forms)
      .where(eq(forms.key, 'isms-server-room-inspection'));
    const runJob = async () => {
      const run = await h.call(admin, 'POST', `/api/v1/scheduler/jobs/${job!.id}/run`);
      expect(run.status, JSON.stringify(run.body)).toBe(201);
      return eventually(
        async () => (await h.call(admin, 'GET', `/api/v1/scheduler/runs/${run.body.id}`)).body as LooseJson,
        (r) => ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(r.status),
      );
    };
    const first = await runJob();
    expect(first.status, JSON.stringify(first)).toBe('succeeded');
    await runJob();
    const key = periodKey(new Date(first.scheduledFor), 'month', 'Asia/Taipei');
    const rows = await h.kernel.db.select().from(formAssignments).where(eq(formAssignments.formId, form!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: `Server room inspection ${key}`,
      periodKey: key,
      assigneeGroupId: await groupId('isms-server-room'),
      status: 'open',
    });
    const todo = await h.call(s.dcops!, 'GET', '/api/v1/me/form-assignments?status=open');
    expect((todo.body.items as LooseJson[]).map((i) => i.title)).toContain(`Server room inspection ${key}`);
  });
});

describe('the other forms', () => {
  it('take a valid request from the people they are for', async () => {
    s.admin = admin;
    const ci = async (name: string, classKey: string) => {
      const res = await h.call(admin, 'POST', '/api/v1/cmdb/cis', { name, classKey });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return `cmdb.ci:${res.body.id as string}`;
    };
    const firewall = await ci('pack-fw-01', 'network-device');
    const server = await ci('pack-app-01', 'server');

    // Record fields only take what the picker offers: a firewall rule names a network device, not a server.
    const rule = (device: string) => ({
      reasonType: 'internal_test',
      request: 'add',
      reason: 'Load test',
      validFrom: day(0),
      validUntil: day(10),
      rules: [{ device, source: '10.0.0.5', destination: '10.0.1.5', port: '8443/tcp', decision: 'allow' }],
    });
    expect(issuesOf(await submit('admin', 'isms-firewall-rule', rule(server)))).toContainEqual([
      'data.rules.0.device',
      'record',
    ]);
    await submitted('admin', 'isms-firewall-rule', rule(firewall));

    const samples: [string, string, Record<string, unknown>][] = [
      [
        'mei',
        'isms-account-retention',
        {
          subject: ids.mei,
          reason: 'leaving',
          effectiveOn: day(5),
          accounts: [{ system: 'domain_email', target: 'Directory', account: 'mei' }],
          keepReason: 'investigation',
          deleteOn: day(90),
        },
      ],
      [
        'neteng',
        'isms-network-device-check',
        {
          checkedOn: day(0),
          devices: [
            {
              category: 'firewall',
              device: 'pack-fw-01',
              ruleCheck: 'unchanged',
              securityCheck: 'normal',
              accessPolicy: 'normal',
              configBackup: 'done',
            },
          ],
        },
      ],
      [
        'mei',
        'isms-external-network',
        {
          visitorName: 'Visitor',
          company: 'Example Co.',
          sponsor: ids.mei,
          purpose: 'Workshop',
          connection: 'guest',
          devices: [{ type: 'Laptop', identifier: '00:00:5e:00:53:01' }],
          from: day(1),
          until: day(3),
        },
      ],
      [
        'dcops',
        'isms-system-backup-inspection',
        {
          inspectedOn: day(0),
          backups: [{ device: 'File server', result: 'success', lastSuccessOn: day(0) }],
          osUpdates: 'up_to_date',
          timeSync: 'normal',
          antivirus: 'normal',
        },
      ],
      [
        'itops',
        'isms-backup-plan',
        {
          effectiveFrom: day(0),
          items: [
            {
              item: 'File shares',
              device: 'file_server',
              method: 'incremental',
              mode: 'automatic',
              operator: ids.itops,
              location: 'dr',
              frequency: 'daily',
            },
          ],
        },
      ],
      [
        'itops',
        'isms-restore-test',
        {
          testedOn: day(0),
          tests: [
            {
              device: 'File server',
              backupDate: day(-1),
              restoredTo: 'Test VM',
              result: 'success',
              minutes: 25,
            },
          ],
        },
      ],
      [
        'dcops',
        'isms-maintenance',
        {
          items: [
            {
              device: 'UPS',
              hardwareSpace: 'ok',
              services: 'ok',
              security: 'ok',
              vendor: 'Vendor',
              date: day(0),
            },
          ],
        },
      ],
      [
        'admin',
        'isms-patch-exception',
        {
          system: server,
          patch: 'OS cumulative update',
          reason: 'The vendor has not certified it',
          compensatingControls: 'Isolated network segment',
          until: day(45),
        },
      ],
      ['neteng', 'isms-device-password', { devices: [{ device: 'pack-fw-01', changedOn: day(0) }] }],
      [
        'mei',
        'isms-asset-change',
        {
          systemName: 'File server',
          description: 'Add a disk shelf',
          hardwareNeed: 'new',
          softwareNeed: 'none',
          impact: 'None expected',
          downtimeMinutes: 0,
          plannedStart: day(7),
          plannedEnd: day(7),
          docsToUpdate: ['rack_layout', 'asset_register'],
        },
      ],
      [
        'neteng',
        'isms-threat-intel',
        {
          reviewedOn: day(0),
          source: 'vendor_advisory',
          content: 'Firewall management interface vulnerability',
          scope: 'Internet-facing firewalls',
          handler: ids.neteng,
          plannedAction: 'Upgrade the firmware',
          dueOn: day(14),
        },
      ],
      [
        'mei',
        'isms-media-exception',
        {
          type: 'unencrypted_offsite',
          mediaDescription: 'Camera memory card',
          data: 'Site photos',
          classification: 'internal-use-only',
          encryption: 'cannot_encrypt',
          encryptionReason: 'The camera can’t read encrypted cards',
          destination: 'Customer site',
          from: day(1),
          until: day(2),
        },
      ],
      [
        'mei',
        'isms-im-exception',
        {
          software: 'Example Chat',
          project: 'Partner rollout',
          users: [{ person: ids.mei }],
          from: day(0),
          until: day(60),
          reason: 'The partner only uses this app',
        },
      ],
    ];
    for (const [who, key, data] of samples) {
      const res = await submit(who, key, data);
      expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(201);
    }
    // A rollback plan is required for a change with downtime.
    const noPlan = await submit('mei', 'isms-asset-change', {
      ...samples.find(([, key]) => key === 'isms-asset-change')![2],
      downtimeMinutes: 30,
    });
    expect(issuesOf(noPlan)).toContainEqual(['data.rollbackPlan', 'rule']);
  });
});

/* ───────────── a second install and the rollback ───────────── */

describe('after it is applied', () => {
  it('a second install fails its dry run on the keys already taken', async () => {
    const again = await h.call(admin, 'POST', `${A}/packages/isms/isms-processes/install`, {});
    expect(again.status).toBe(201);
    expect(again.body.ready).toBe(false);
    const codes = new Set(
      (again.body.items as LooseJson[]).flatMap((i) =>
        ((i.check?.issues ?? []) as { code: string }[]).map((x) => x.code),
      ),
    );
    expect(codes.has('duplicate_key')).toBe(true);
    expect((await h.call(admin, 'POST', `${A}/change-sets/${again.body.id}/discard`)).status).toBe(200);
  });

  it('rolls back in one step: groups and jobs deleted, forms, workflows, categories and the field archived', async () => {
    const res = await h.call(admin, 'POST', `${A}/change-sets/${changeSetId}/rollback`, { confirm: true });
    expect(res.status, JSON.stringify(res.body).slice(0, 2000)).toBe(200);
    expect(res.body.status).toBe('rolled_back');
    expect(await h.kernel.db.select().from(groups).where(like(groups.key, 'isms-%'))).toEqual([]);
    expect(await h.kernel.db.select().from(jobs).where(like(jobs.name, 'ISMS: %'))).toEqual([]);
    const left = await h.kernel.db
      .select({ archivedAt: forms.archivedAt })
      .from(forms)
      .where(like(forms.key, 'isms-%'));
    expect(left.every((f) => f.archivedAt !== null)).toBe(true);
    const cats = await h.kernel.db
      .select({ active: categories.active })
      .from(categories)
      .where(inArray(categories.key, ['isms-resource-anomaly', 'isms-threat-intel', 'isms-security-report']));
    expect(cats.map((c) => c.active)).toEqual([false, false, false]);
    const [signOff] = await h.kernel.db
      .select({ archivedAt: workflowDefinitions.archivedAt })
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.triggerKey, 'itsm.resolution'));
    expect(signOff!.archivedAt).not.toBeNull();
    // Requests already made keep their history; group memberships went with the groups.
    expect(await h.kernel.db.select().from(groupMembers).where(eq(groupMembers.userId, ids.ciso!))).toEqual(
      [],
    );
  });
});
