import { formatRequestNumber } from '@isbp/contracts';
import {
  approvalTasks,
  formSubmissions,
  forms,
  groupMembers,
  groups,
  processActionRuns,
  recordLinks,
  roleAssignments,
  roles,
  users,
  workflowDefinitions,
  workflowInstances,
} from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { changes, tickets } from '@isbp/module-itsm/schema';
import { type FormSchema, validateForm } from '@isbp/sdk/server';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONFIG_CHANGE_FORM_KEY,
  CONFIG_CHANGE_WORKFLOW_NAME,
  configChangeSchema,
} from '../../src/core/customizations/examples';
import { hashPassword } from '../../src/kernel/passwords';
import { DEMO_CHANGE_REQUESTS, seedPhase8Links } from '../../src/seed-phase8';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/*
 * The Phase 8 demo: the "Configuration change request" process, built through a change set (workflow + form) and
 * exercised with two requests — one waiting for the requester's manager, one approved whose action raised a change
 * submitted to CAB authorization. Idempotent, valid for the admin pages, routed on the picked CIs' facts.
 */

let h: Harness;
let desk: Session;
const ids: Record<string, string> = {};
const ci: Record<string, string> = {};
const API = '/api/v1';

async function mkUser(username: string, managerId: string | null = null) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      managerId,
    })
    .returning();
  return u!.id;
}

const counts = async () => {
  const one = async (q: ReturnType<typeof sql>) => (await h.kernel.db.execute<{ n: number }>(q)).rows[0]!.n;
  return {
    forms: await one(sql`select count(*)::int as n from core.forms`),
    workflows: await one(sql`select count(*)::int as n from core.workflow_definitions`),
    submissions: await one(sql`select count(*)::int as n from core.form_submissions`),
    changeSets: await one(sql`select count(*)::int as n from assistant.change_sets`),
    tickets: await one(sql`select count(*)::int as n from itsm.tickets`),
  };
};

beforeAll(async () => {
  h = await createHarness();
  const db = h.kernel.db;
  ids.helpdesk = await mkUser('helpdesk', h.ids.admin);
  ids.dba = await mkUser('dba1');
  ids.cab = await mkUser('cab1');
  ids.itadm = await mkUser('itadm');
  const rows = await db
    .insert(groups)
    .values(['it-admins', 'dba-team', 'cab', 'service-desk'].map((key) => ({ key, name: key })))
    .returning();
  const gid = (key: string) => rows.find((g) => g.key === key)!.id;
  await db.insert(groupMembers).values([
    { groupId: gid('it-admins'), userId: h.ids.admin },
    { groupId: gid('it-admins'), userId: ids.itadm },
    { groupId: gid('dba-team'), userId: ids.dba },
    { groupId: gid('cab'), userId: ids.cab },
    { groupId: gid('service-desk'), userId: ids.helpdesk },
  ]);
  const [viewer] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'cmdb-viewer'));
  await db.insert(roleAssignments).values({ roleId: viewer!.id, userId: ids.helpdesk });
  const created = await db
    .insert(cis)
    .values([
      {
        name: 'erp-db-01',
        classKey: 'database',
        environment: 'production',
        criticality: 'critical',
        supportGroupId: gid('dba-team'),
      },
      {
        name: 'fs-01',
        classKey: 'server',
        environment: 'production',
        criticality: 'medium',
        supportGroupId: gid('it-admins'),
      },
      { name: 'old-intranet-01', classKey: 'server', criticality: 'low', status: 'retired' },
    ])
    .returning();
  for (const c of created) ci[c.name] = c.id;
  await h.kernel.rbac.bump();
  await seedPhase8Links(h.kernel);
  desk = await h.login('helpdesk');
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('configuration change process (demo seed)', () => {
  it('is built as one applied change set: a published workflow and the form bound to it', async () => {
    const [form] = await h.kernel.db.select().from(forms).where(eq(forms.key, CONFIG_CHANGE_FORM_KEY));
    const [wf] = await h.kernel.db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.name, CONFIG_CHANGE_WORKFLOW_NAME));
    expect(wf).toMatchObject({ triggerKey: 'core.form-submission', publishedVersion: 1 });
    expect(form).toMatchObject({
      publishedVersion: 1,
      active: true,
      workflowDefinitionId: wf!.id,
      // The IT groups that can read the CMDB (those that exist here), not everyone.
      audience: { type: 'groups', groupKeys: ['it-admins', 'service-desk', 'dba-team'] },
      category: 'changes',
    });
    expect(form!.name).toEqual({
      en: 'Configuration change request',
      'zh-TW': '組態變更申請',
      'ja-JP': '構成変更の申請',
    });
    const { rows: sets } = await h.kernel.db.execute<{ status: string }>(
      sql`select status from assistant.change_sets where title = 'Configuration change requests'`,
    );
    expect(sets).toEqual([{ status: 'applied' }]);
    // People outside those groups don't get a form whose CIs they couldn't pick.
    const outsider = await h.login('outsider');
    expect((await h.call(outsider, 'GET', `${API}/forms/by-key/${CONFIG_CHANGE_FORM_KEY}`)).status).toBe(404);
    expect((await h.call(desk, 'GET', `${API}/forms/by-key/${CONFIG_CHANGE_FORM_KEY}`)).status).toBe(200);

    // The applied change set gives the form's own link, and get() round-trips through the kind's checks.
    const admin = (await h.kernel.registry.context('core').rbac.authFor(h.ids.admin))!;
    const obj = (await h.kernel.customizations.get('core.form', form!.id, admin))!;
    expect(obj.links).toEqual([
      {
        href: `/requests/forms/${CONFIG_CHANGE_FORM_KEY}`,
        label: { en: 'Open the form', 'zh-TW': '開啟表單', 'ja-JP': 'フォームを開く' },
      },
    ]);
    const check = await h.kernel.customizations.validate(
      'core.form',
      { op: 'update', id: form!.id, value: obj.value },
      admin,
    );
    expect(check.issues).toEqual([]);
    const wfObj = (await h.kernel.customizations.get('core.workflow', wf!.id, admin))!;
    expect(
      (
        await h.kernel.customizations.validate(
          'core.workflow',
          { op: 'update', id: wf!.id, value: wfObj.value },
          admin,
        )
      ).issues,
    ).toEqual([]);
  });

  it('is idempotent', async () => {
    const before = await counts();
    await seedPhase8Links(h.kernel);
    expect(await counts()).toEqual(before);
    expect(before).toMatchObject({ forms: 1, submissions: 2, changeSets: 1, tickets: 1 });
  });

  it('validates answers with the form’s rules, in the browser and the API alike', async () => {
    const valid = {
      cis: [`cmdb.ci:${ci['fs-01']}`],
      title: 'Restart the print spooler',
      changeType: 'normal',
      risk: 'low',
      plannedStart: '2027-03-02',
      plannedEnd: '2027-03-02',
    };
    const schema = configChangeSchema as FormSchema;
    expect(validateForm(schema, valid).ok).toBe(true);
    const backwards = validateForm(schema, { ...valid, plannedEnd: '2027-03-01' });
    expect(backwards.errors.plannedEnd).toMatchObject({
      code: 'rule',
      message: { en: 'The end date can’t be before the start date' },
    });
    const risky = validateForm(schema, { ...valid, risk: 'high' });
    expect(risky.errors.backoutPlan).toMatchObject({
      code: 'rule',
      message: { en: 'A high-risk change needs a rollback plan' },
    });
    expect(validateForm(schema, { ...valid, risk: 'high', backoutPlan: 'Restart it again.' }).ok).toBe(true);

    const submit = (data: Record<string, unknown>) =>
      h.call(desk, 'POST', `${API}/forms/by-key/${CONFIG_CHANGE_FORM_KEY}/submissions`, { data });
    const refused = await submit({ ...valid, plannedEnd: '2027-03-01' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.issues).toEqual([
      expect.objectContaining({
        path: 'data.plannedEnd',
        code: 'rule',
        text: expect.objectContaining({ 'zh-TW': '結束日期不能早於開始日期' }),
      }),
    ]);
    // A retired CI is outside the field's `where`, even when handed in directly.
    const retired = await submit({ ...valid, cis: [`cmdb.ci:${ci['old-intranet-01']}`] });
    expect(retired.status).toBe(400);
    expect(retired.body.error.details.issues[0]).toMatchObject({ path: 'data.cis', code: 'record' });
  });

  it('routes on the picked CIs: their support groups, and the CAB for a critical CI or a high risk', async () => {
    const preview = async (data: Record<string, unknown>) => {
      const res = await h.call(desk, 'POST', `${API}/forms/by-key/${CONFIG_CHANGE_FORM_KEY}/preview`, {
        data,
      });
      expect(res.status).toBe(200);
      return Object.fromEntries(
        (res.body.steps as LooseJson[]).map((st) => [
          st.id,
          { outcome: st.outcome, people: (st.people as { id: string }[]).map((p) => p.id).sort() },
        ]),
      );
    };
    const answers = (name: string, risk: string) => ({
      cis: [`cmdb.ci:${ci[name]}`],
      title: 'A change',
      changeType: 'normal',
      risk,
      plannedStart: '2027-03-02',
      plannedEnd: '2027-03-03',
    });
    const critical = await preview(answers('erp-db-01', 'low'));
    expect(critical.manager).toEqual({ outcome: 'ask', people: [h.ids.admin] });
    expect(critical['ci-owners']).toEqual({ outcome: 'ask', people: [ids.dba] });
    expect(critical.cab).toEqual({ outcome: 'ask', people: [ids.cab] });

    const routine = await preview(answers('fs-01', 'low'));
    expect(routine['ci-owners']).toEqual({ outcome: 'ask', people: [h.ids.admin, ids.itadm].sort() });
    expect(routine.cab?.outcome ?? 'skipped').not.toBe('ask');

    const risky = await preview({ ...answers('fs-01', 'high'), backoutPlan: 'Undo it.' });
    expect(risky.cab).toEqual({ outcome: 'ask', people: [ids.cab] });

    // Several CIs: every picked CI's group can approve.
    const both = await preview({
      ...answers('fs-01', 'low'),
      cis: [`cmdb.ci:${ci['fs-01']}`, `cmdb.ci:${ci['erp-db-01']}`],
    });
    expect(both['ci-owners']!.people).toEqual([h.ids.admin, ids.itadm, ids.dba].sort());
    expect(both.cab).toEqual({ outcome: 'ask', people: [ids.cab] });
  });

  it('leaves one request waiting for the requester’s manager in the admin’s approvals', async () => {
    const [sub] = await h.kernel.db
      .select()
      .from(formSubmissions)
      .where(sql`${formSubmissions.data}->>'title' = ${DEMO_CHANGE_REQUESTS.waiting}`);
    expect(sub).toMatchObject({ status: 'pending', submittedBy: ids.helpdesk });
    const tasks = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(
        and(eq(approvalTasks.instanceId, sub!.workflowInstanceId!), eq(approvalTasks.status, 'pending')),
      );
    expect(tasks.map((t) => [t.stepId, t.assigneeId])).toEqual([['manager', h.ids.admin]]);
    const [inst] = await h.kernel.db
      .select({ facts: workflowInstances.facts })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, sub!.workflowInstanceId!));
    expect(inst!.facts).toMatchObject({
      records: { cis: { criticality: ['critical'], ownerGroup: ['dba-team'] } },
    });
    const admin = await h.login('admin');
    const inbox = await h.call(admin, 'GET', `${API}/me/approvals?status=pending`);
    expect(JSON.stringify(inbox.body)).toContain(sub!.id);
  });

  it('approved the other one, whose action raised a change linked to the CI and submitted it to CAB', async () => {
    const [sub] = await h.kernel.db
      .select()
      .from(formSubmissions)
      .where(sql`${formSubmissions.data}->>'title' = ${DEMO_CHANGE_REQUESTS.approved}`);
    expect(sub!.status).toBe('approved');
    const runs = await h.kernel.db
      .select()
      .from(processActionRuns)
      .where(eq(processActionRuns.submissionId, sub!.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      type: 'itsm.create-change',
      status: 'succeeded',
      decidedBy: h.ids.admin,
    });
    const href = runs[0]!.result!.href!;
    expect(href).toMatch(/^\/itsm\/tickets\/CHG-\d{5}$/);
    expect(sub!.fulfilment).toMatchObject({ href, state: 'done' });

    const [change] = await h.kernel.db
      .select({ t: tickets, c: changes })
      .from(tickets)
      .innerJoin(changes, eq(changes.ticketId, tickets.id))
      .where(sql`${tickets.source}->>'id' = ${runs[0]!.id}`);
    expect(change!.t).toMatchObject({
      type: 'change',
      status: 'authorization',
      requesterId: ids.helpdesk,
    });
    expect(change!.t.title).toMatch(new RegExp(`^REQ-\\d{5} ${DEMO_CHANGE_REQUESTS.approved}$`));
    expect(change!.c).toMatchObject({ changeType: 'normal', risk: 'low' });
    // A real window, in the future.
    expect(change!.c.plannedEnd!.getTime()).toBeGreaterThan(change!.c.plannedStart!.getTime());
    expect(change!.c.plannedStart!.getTime()).toBeGreaterThan(Date.now());
    expect(change!.c.approvalInstanceId).toBeTruthy();
    expect(change!.c.backoutPlan).toBe('Set the quota back to 500 GB.');
    const links = await h.kernel.db
      .select()
      .from(recordLinks)
      .where(
        sql`(${recordLinks.aId} = ${ci['fs-01']} or ${recordLinks.bId} = ${ci['fs-01']}) and (${recordLinks.aId} = ${change!.t.id} or ${recordLinks.bId} = ${change!.t.id})`,
      );
    expect(links).toHaveLength(1);

    // The requester's page shows what happened next, with the link to the change.
    const reference = formatRequestNumber(sub!.number);
    const page = await h.call(desk, 'GET', `${API}/requests/${reference}`);
    expect(page.status).toBe(200);
    expect(JSON.stringify(page.body)).toContain(href);
  });
});
