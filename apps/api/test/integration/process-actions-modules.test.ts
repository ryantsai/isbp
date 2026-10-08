import {
  forms,
  formVersions,
  groupMembers,
  groups,
  recordLinks,
  users,
  workflowInstances,
} from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { changes, tickets } from '@isbp/module-itsm/schema';
import { runs } from '@isbp/module-scheduler/schema';
import { seedJob } from '@isbp/module-scheduler/server';
import type { AuthContext, FormAction, FormElement } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
let adminAuth: AuthContext;
let requester: Session;
const t = processActionHelpers(() => ({ h, admin }));
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function mkCi(name: string, criticality: string) {
  const res = await h.call(admin, 'POST', '/api/v1/cmdb/cis', { name, classKey: 'server', criticality });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

const ciField: FormElement = {
  id: 'cis',
  key: 'cis',
  type: 'record',
  label: { en: 'Servers' },
  record: { types: ['cmdb.ci'], multiple: true },
};

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  adminAuth = (await h.kernel.registry.context('core').rbac.authFor(h.ids.admin))!;
  await t.mkUser('lin');
  requester = await h.login('lin');
  // Someone other than the requester decides changes (requesters never approve their own).
  const [cab] = await h.kernel.db.insert(groups).values({ key: 'cab', name: 'CAB' }).returning();
  await h.kernel.db.insert(groupMembers).values({ groupId: cab!.id, userId: await t.mkUser('cab-member') });
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('itsm.create-change', () => {
  it('raises a change linked to the picked CIs and submits it to its CAB authorization', async () => {
    const db1 = await mkCi('pay-db-01', 'critical');
    const db2 = await mkCi('pay-db-02', 'high');
    const action: FormAction = {
      id: 'change',
      on: 'submitted',
      type: 'itsm.create-change',
      config: {
        title: 'Firewall change for {{answers.what}} ({{request.reference}})',
        description: 'Requested by {{requester.displayName}}',
        changeType: 'normal',
        risk: 'high',
        ciField: 'cis',
        plannedStartField: 'start',
        plannedEndField: 'end',
        submit: true,
      },
    };
    await t.mkForm('config-change', {
      elements: [t.field('what', 'text'), ciField, t.field('start', 'date'), t.field('end', 'date')],
      actions: [action],
    });
    // Submitting needs the planned window from the form.
    const missing = await h.call(
      admin,
      'PATCH',
      `/api/v1/forms/${(await h.kernel.db.select().from(forms).where(eq(forms.key, 'config-change')))[0]!.id}`,
      {
        draft: {
          elements: [t.field('what', 'text'), ciField],
          actions: [
            {
              ...action,
              config: { ...action.config, plannedStartField: undefined, plannedEndField: undefined },
            },
          ],
        },
      },
    );
    expect(missing.status).toBe(400);

    const sub = await t.submit(admin, 'config-change', {
      what: 'payments',
      cis: [`cmdb.ci:${db1}`, `cmdb.ci:${db2}`],
      start: day(10),
      end: day(11),
    });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status, run!.error ?? '').toBe('succeeded');
    expect(run!.result).toMatchObject({ summary: 'itsm.processActions.createChange.submitted' });
    expect(run!.result!.reference).toMatch(/^CHG-/);

    const [change] = await h.kernel.db
      .select({ t: tickets, c: changes })
      .from(tickets)
      .innerJoin(changes, eq(changes.ticketId, tickets.id))
      .where(eq(tickets.id, run!.result!.record!.id));
    expect(change!.t.title).toBe(`Firewall change for payments (${sub.reference})`);
    expect(change!.t.status).toBe('authorization');
    expect(change!.t.source).toMatchObject({
      type: 'process-action',
      id: run!.id,
      submissionId: sub.id,
      reference: sub.reference,
    });
    expect(change!.c.risk).toBe('high');
    // Never bypassed: the change's own required workflow is running.
    const [instance] = await h.kernel.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, change!.c.approvalInstanceId!));
    expect(instance).toMatchObject({ triggerKey: 'itsm.change', status: 'running' });
    expect((instance!.facts as { change: { criticalCis: boolean } }).change.criticalCis).toBe(true);

    const links = await h.kernel.db
      .select()
      .from(recordLinks)
      .where(sql`(${recordLinks.aId} = ${change!.t.id} or ${recordLinks.bId} = ${change!.t.id})`);
    // The two CIs, and the request itself (`core.request`: the action's result record is linked to it).
    expect(links).toHaveLength(3);
    expect(links.filter((l) => l.aType === 'core.request' || l.bType === 'core.request')).toHaveLength(1);

    // The request now points at the change.
    const detail = await h.call(admin, 'GET', `/api/v1/requests/${sub.reference}`);
    expect(detail.body.submission.fulfilment).toMatchObject({ reference: run!.result!.reference });

    // Running it again (a retry, a duplicate job) finds the same change.
    const before = (await h.kernel.db.select({ n: sql<number>`count(*)::int` }).from(tickets))[0]!.n;
    await h.kernel.db.execute(
      sql`update core.process_action_runs set status = 'queued' where id = ${run!.id}`,
    );
    await h.kernel.processActions.execute(run!.id);
    expect((await h.kernel.db.select({ n: sql<number>`count(*)::int` }).from(tickets))[0]!.n).toBe(before);
  });

  it('reads date answers as whole days in the requester’s time zone, and never raises a standard change', async () => {
    const tokyo = await t.mkUser('tokyo-requester');
    await h.kernel.db.update(users).set({ timezone: 'Asia/Tokyo' }).where(eq(users.id, tokyo));
    const session = await h.login('tokyo-requester');
    const kind = t.field('kind', 'select', {
      options: ['normal', 'emergency', 'standard'].map((v) => ({ value: v, label: { en: v } })),
    });
    const action: FormAction = {
      id: 'change',
      on: 'submitted',
      type: 'itsm.create-change',
      config: {
        title: 'Window test {{data.kind}}',
        changeType: 'normal',
        changeTypeField: 'kind',
        risk: 'low',
        plannedStartField: 'start',
        plannedEndField: 'end',
        submit: false,
      },
    };
    await t.mkForm('tz-change', {
      elements: [kind, t.field('start', 'date'), t.field('end', 'date')],
      actions: [action],
    });
    const changeOf = async (data: Record<string, unknown>) => {
      const sub = await t.submit(session, 'tz-change', data);
      const [run] = await t.settledRuns(sub.id);
      expect(run!.status, run!.error ?? '').toBe('succeeded');
      const [row] = await h.kernel.db
        .select({ c: changes })
        .from(changes)
        .where(eq(changes.ticketId, run!.result!.record!.id));
      return row!.c;
    };
    // One day in Tokyo: from its midnight to the next (00:00 +09:00 is 15:00 UTC the day before).
    const oneDay = await changeOf({ kind: 'emergency', start: day(20), end: day(20) });
    expect(oneDay.plannedStart!.toISOString()).toBe(new Date(`${day(20)}T00:00:00+09:00`).toISOString());
    expect(oneDay.plannedEnd!.toISOString()).toBe(new Date(`${day(21)}T00:00:00+09:00`).toISOString());
    expect(oneDay.changeType).toBe('emergency');
    // A requester can't ask for a pre-approved standard change: the configured type applies.
    expect((await changeOf({ kind: 'standard', start: day(20), end: day(22) })).changeType).toBe('normal');

    // The configuration offers normal and emergency only; a saved standard change type is refused.
    const fields = await h.kernel.processActions.fields('itsm.create-change', { form: null, locale: 'en' });
    expect(fields.find((f) => f.key === 'changeType')!.options!.map((o) => o.value)).toEqual([
      'normal',
      'emergency',
    ]);
    const [form] = await h.kernel.db.select().from(forms).where(eq(forms.key, 'tz-change'));
    const refused = await h.call(admin, 'PATCH', `/api/v1/forms/${form!.id}`, {
      draft: {
        elements: [kind, t.field('start', 'date'), t.field('end', 'date')],
        actions: [{ ...action, config: { ...action.config, changeType: 'standard' } }],
      },
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.issues[0]).toMatchObject({ path: 'draft.actions.0.config.changeType' });
  });

  it('starts a window that already began at the next quarter hour; one that passed is raised, not submitted', async () => {
    const utc = await t.mkUser('utc-requester');
    await h.kernel.db.update(users).set({ timezone: 'UTC' }).where(eq(users.id, utc));
    const session = await h.login('utc-requester');
    await t.mkForm('today-change', {
      elements: [t.field('start', 'date'), t.field('end', 'date')],
      actions: [
        {
          id: 'change',
          on: 'submitted',
          type: 'itsm.create-change',
          config: {
            title: 'Today',
            changeType: 'normal',
            risk: 'low',
            plannedStartField: 'start',
            plannedEndField: 'end',
            submit: true,
          },
        },
      ],
    });
    const raise = async (data: Record<string, unknown>) => {
      const sub = await t.submit(session, 'today-change', data);
      const [run] = await t.settledRuns(sub.id);
      expect(run!.status, run!.error ?? '').toBe('succeeded');
      const [row] = await h.kernel.db
        .select({ t: tickets, c: changes })
        .from(tickets)
        .innerJoin(changes, eq(changes.ticketId, tickets.id))
        .where(eq(tickets.id, run!.result!.record!.id));
      return { run: run!, ...row! };
    };
    const before = Date.now();
    const today = await raise({ start: day(0), end: day(1) });
    const start = today.c.plannedStart!.getTime();
    expect(start % (15 * 60_000)).toBe(0);
    expect(start).toBeGreaterThan(before);
    expect(start - before).toBeLessThanOrEqual(17 * 60_000);
    expect(today.c.plannedEnd!.toISOString()).toBe(new Date(`${day(2)}T00:00:00Z`).toISOString());
    expect(today.t.status).toBe('authorization');
    expect(today.run.result!.summary).toBe('itsm.processActions.createChange.submitted');

    const past = await raise({ start: day(-3), end: day(-2) });
    expect(past.t.status).not.toBe('authorization');
    expect(past.c.approvalInstanceId).toBeNull();
    expect(past.run.result!.summary).toBe('itsm.processActions.createChange.windowPassed');
  });

  it('raises a service request for the requester', async () => {
    await t.mkForm('need-help', {
      elements: [t.field('what', 'text')],
      actions: [
        {
          id: 'sr',
          on: 'approved',
          type: 'itsm.create-ticket',
          config: { type: 'service_request', priority: '2', title: 'Help with {{data.what}}' },
        },
      ],
    });
    const sub = await t.submit(requester, 'need-help', { what: 'VPN' });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status, run!.error ?? '').toBe('succeeded');
    const [ticket] = await h.kernel.db.select().from(tickets).where(eq(tickets.id, run!.result!.record!.id));
    expect(ticket).toMatchObject({
      type: 'service_request',
      priority: 2,
      title: 'Help with VPN',
      channel: 'form',
    });
  });
});

describe('cmdb.update-ci', () => {
  it('sets fields of the picked CIs', async () => {
    const ci = await mkCi('web-01', 'medium');
    await t.mkForm('maintenance', {
      elements: [ciField],
      actions: [
        {
          id: 'm',
          on: 'approved',
          type: 'cmdb.update-ci',
          config: { ciField: 'cis', status: 'maintenance' },
        },
      ],
    });
    const sub = await t.submit(admin, 'maintenance', { cis: [`cmdb.ci:${ci}`] });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status, run!.error ?? '').toBe('succeeded');
    const [row] = await h.kernel.db.select().from(cis).where(eq(cis.id, ci));
    expect(row!.status).toBe('maintenance');
  });
});

describe('core.webhook secrets', () => {
  it('seals the header value, never returns it, and keeps it on later saves and publishes', async () => {
    await h.kernel.settings.update(
      h.kernel.registry.get('core')!.manifest,
      { 'processActions.webhookHosts': 'hooks.example.com' },
      null,
    );
    const form = await t.mkForm('hooked', { elements: [t.field('what', 'text')] }, { publish: false });
    const hook = (config: Record<string, unknown>): FormAction => ({
      id: 'hook',
      on: 'approved',
      type: 'core.webhook',
      config,
    });
    const base = {
      url: 'https://hooks.example.com/in',
      headerName: 'X-Token',
      body: '{"ref":"{{request.reference}}"}',
    };
    const save = (config: Record<string, unknown>) =>
      h.call(admin, 'PATCH', `/api/v1/forms/${form.id}`, {
        draft: { elements: [t.field('what', 'text')], actions: [hook(config)] },
      });

    const value = 'value-to-keep-private';
    const saved = await save({ ...base, headerValue: value });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.draft.actions[0].config.headerValue).toEqual({ set: true });
    expect(JSON.stringify(saved.body)).not.toContain(value);
    const stored = async () =>
      (await h.kernel.db.select().from(forms).where(eq(forms.id, form.id)))[0]!.draft;
    const sealed = (await stored()).actions![0]!.config.headerValue as { sealed: string };
    expect(JSON.stringify(await stored())).not.toContain(value);
    expect(h.kernel.box.decrypt(sealed.sealed)).toBe(value);

    // `{ set: true }` keeps the stored value; publishing copies it to the version.
    expect((await save({ ...base, headerValue: { set: true } })).status).toBe(200);
    expect((await stored()).actions![0]!.config.headerValue).toEqual(sealed);
    expect((await h.call(admin, 'POST', `/api/v1/forms/${form.id}/publish`)).status).toBe(200);
    const [version] = await h.kernel.db.select().from(formVersions).where(eq(formVersions.formId, form.id));
    expect(version!.schema.actions![0]!.config.headerValue).toEqual(sealed);
    const detail = await h.call(admin, 'GET', `/api/v1/forms/${form.id}`);
    expect(JSON.stringify(detail.body)).not.toContain(sealed.sealed);
    expect(detail.body.published.actions[0].config.headerValue).toEqual({ set: true });

    // Only HTTPS, to allowed hosts.
    const http = await save({ ...base, url: 'http://hooks.example.com/in', headerValue: { set: true } });
    expect(http.body.error.details.issues[0]).toMatchObject({
      path: 'draft.actions.0.config.url',
      code: 'https',
    });
    const other = await save({
      ...base,
      url: 'https://elsewhere.example.org/in',
      headerValue: { set: true },
    });
    expect(other.body.error.details.issues[0]).toMatchObject({
      path: 'draft.actions.0.config.url',
      code: 'host',
    });

    // The customisation kind shows the same masked value, and applying it back changes nothing.
    const kind = h.kernel.customizations;
    const got = await kind.get('core.form', form.id, adminAuth);
    expect(JSON.stringify(got)).not.toContain(sealed.sealed);
    const check = await kind.validate(
      'core.form',
      { op: 'update', id: form.id, value: got!.value },
      adminAuth,
    );
    expect(check.issues).toEqual([]);
  });

  it('holds the assistant to the same checks as the form builder', async () => {
    const outsider = (await h.kernel.registry.context('core').rbac.authFor(h.ids.outsider))!;
    const kind = h.kernel.customizations;
    const value = {
      key: 'assistant-form',
      name: { en: 'From the assistant' },
      icon: 'file-text',
      schema: {
        elements: [t.field('what', 'text')],
        actions: [{ id: 'x', on: 'submitted', type: 'core.notify', config: {} }],
      },
      workflowId: null,
      audience: { type: 'everyone' },
      active: true,
    };
    const result = await kind.validate('core.form', { op: 'create', id: null, value }, adminAuth);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'schema.actions.0.config.title' })]),
    );
    void outsider;
  });
});

describe('scheduler.run-job', () => {
  it('runs the chosen job now and links the request to the run', async () => {
    const jobId = await seedJob(h.kernel.registry.context('scheduler'), {
      name: 'Refresh after approval',
      type: 'scheduler.http',
      config: { method: 'GET', url: 'https://refresh.example.invalid/now' },
      trigger: { kind: 'manual' },
    });
    await t.mkForm('refresh', {
      elements: [t.field('why', 'text')],
      actions: [{ id: 'run', on: 'approved', type: 'scheduler.run-job', config: { jobId } }],
    });
    const sub = await t.submit(requester, 'refresh', { why: 'new data' });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status, run!.error ?? '').toBe('succeeded');
    expect(run!.result).toMatchObject({ reference: 'Refresh after approval' });
    expect(run!.result!.href).toMatch(/^\/scheduler\/runs\//);
    const [made] = await h.kernel.db.select().from(runs).where(eq(runs.jobId, jobId));
    expect(made).toMatchObject({ trigger: 'manual' });
  });
});
