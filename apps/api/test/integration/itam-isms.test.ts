/**
 * Asset management for ISMS-style processes (Phase 8, §15.8a): the approved-software list (allow / block list) and
 * the compliance of discovered installs against it, the `itam.approve-software`, `itam.assign-asset` and
 * `itam.return-asset` process actions, data retention and wipes ("Record data wipe", the wipe-due filter, facts and
 * reminders).
 */
import { approvalTasks, auditLogs, notifications, roleAssignments, roles, users } from '@isbp/db/schema';
import { addDays, addMonths, todayIn } from '@isbp/module-itam/model';
import { approvedSoftware, approvedSoftwareDepartments, assetEvents, assets } from '@isbp/module-itam/schema';
import { services } from '@isbp/module-itam/services';
import type { FormAction, FormElement } from '@isbp/sdk/server';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const s: Record<string, Session> = {};
const ids = {} as Record<'am' | 'viewer' | 'alice' | 'bob', string>;
const t = processActionHelpers(() => ({ h, admin }));
const API = '/api/v1/itam';
const today = todayIn('Asia/Taipei');
const itam = () => h.kernel.registry.context('itam');

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
  h.call(s[who]!, method, `${API}${path}`, body);

let seq = 0;
async function laptop(assigneeId: string | null, extra: Record<string, unknown> = {}) {
  const res = await call('am', 'POST', '/assets', {
    name: `ISMS-LT-${++seq}`,
    category: 'laptop',
    serialNumber: `ISMS-${seq}-${Date.now() % 100000}`,
    ...(assigneeId ? { assigneeId } : {}),
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as LooseJson;
}

const report = async (assetId: string, products: { product: string; version?: string }[]) => {
  const res = await call('am', 'POST', '/discovery/software', { assetId, products });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const approvalsOf = async (assetId: string) => {
  const res = await call('am', 'GET', `/assets/${assetId}/software`);
  expect(res.status).toBe(200);
  return Object.fromEntries(
    (res.body.installations as { product: string; approval: string }[]).map((i) => [i.product, i.approval]),
  );
};

const auditOf = (action: string, entityId: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)));

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  ids.am = await mkUser('am');
  ids.viewer = await mkUser('viewer');
  ids.alice = await mkUser('alice', h.ids.salesTpe);
  ids.bob = await mkUser('bob', h.ids.finance);
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('itam-asset-manager'), userId: ids.am },
    { roleId: await roleId('itam-viewer'), userId: ids.viewer },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['am', 'viewer', 'alice', 'bob', 'outsider']) s[u] = await h.login(u);
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('approved software and discovery compliance', () => {
  let aliceLaptop: LooseJson;
  let bobLaptop: LooseJson;

  it('flags nothing but blocked titles until the allow list is in use', async () => {
    aliceLaptop = await laptop(ids.alice);
    bobLaptop = await laptop(ids.bob);
    const installs = [
      { product: 'Google Chrome', version: '129.0.1' },
      { product: '7-Zip', version: '24.08' },
      { product: 'Microsoft Visio Plan 2', version: '16.0' },
      { product: 'Notepad++', version: '8.7' },
      { product: 'uTorrent', version: '3.6.0' },
    ];
    await report(aliceLaptop.id, installs);
    await report(bobLaptop.id, [...installs.slice(0, 4), { product: 'Notepad++ Portable', version: '80.1' }]);

    let summary = await call('am', 'GET', '/discovery/compliance/summary');
    expect(summary.body).toEqual({ allowListInUse: false, unapproved: 0, blocked: 0, devices: 0 });

    const blocked = await call('am', 'POST', '/approved-software', {
      title: 'uTorrent',
      licenseModel: 'free',
      status: 'blocked',
      notes: 'Peer-to-peer file sharing',
    });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(201);
    summary = await call('am', 'GET', '/discovery/compliance/summary');
    expect(summary.body).toMatchObject({ allowListInUse: false, unapproved: 0, blocked: 1, devices: 1 });
    expect((await approvalsOf(aliceLaptop.id))['uTorrent']).toBe('blocked');
    expect((await approvalsOf(aliceLaptop.id))['Google Chrome']).toBe('allowed');
  });

  it('allows titles company-wide or per department, by version, and flags the rest', async () => {
    const chrome = await call('am', 'POST', '/approved-software', {
      title: 'google chrome',
      publisher: 'Google',
      licenseModel: 'free',
    });
    expect(chrome.status).toBe(201);
    expect(chrome.body).toMatchObject({
      scope: 'company',
      status: 'allowed',
      version: null,
      state: 'active',
    });
    // The same title and version company-wide again: refused.
    const dup = await call('am', 'POST', '/approved-software', {
      title: 'Google Chrome',
      licenseModel: 'free',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    // A departmental entry needs its departments.
    const none = await call('am', 'POST', '/approved-software', {
      title: 'Microsoft Visio Plan 2',
      licenseModel: 'subscription',
      scope: 'departments',
    });
    expect(none.status).toBe(400);
    const visio = await call('am', 'POST', '/approved-software', {
      title: 'Microsoft Visio Plan 2',
      licenseModel: 'subscription',
      scope: 'departments',
      departmentIds: [h.ids.salesTpe],
    });
    expect(visio.status, JSON.stringify(visio.body)).toBe(201);
    expect(visio.body.departments).toEqual([expect.objectContaining({ id: h.ids.salesTpe })]);
    // Version 8 covers 8.7, never 80.1.
    const npp = await call('am', 'POST', '/approved-software', {
      title: 'Notepad++',
      version: '8',
      licenseModel: 'open_source',
    });
    expect(npp.status).toBe(201);
    await call('am', 'POST', '/approved-software', {
      title: 'Notepad++ Portable',
      version: '8',
      licenseModel: 'open_source',
    });

    const alice = await approvalsOf(aliceLaptop.id);
    expect(alice).toMatchObject({
      'Google Chrome': 'allowed',
      'Microsoft Visio Plan 2': 'allowed',
      'Notepad++': 'allowed',
      '7-Zip': 'unapproved',
      uTorrent: 'blocked',
    });
    const bob = await approvalsOf(bobLaptop.id);
    expect(bob).toMatchObject({
      'Microsoft Visio Plan 2': 'unapproved',
      'Notepad++ Portable': 'unapproved',
      '7-Zip': 'unapproved',
    });

    const list = await call('am', 'GET', '/discovery/compliance?approval=unapproved');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(4);
    expect(
      (list.body.items as LooseJson[]).find(
        (i) => i.asset.id === bobLaptop.id && i.product === 'Microsoft Visio Plan 2',
      )?.asset.department,
    ).toMatchObject({ id: h.ids.finance });
    const forFinance = await call('am', 'GET', `/discovery/compliance?department=${h.ids.finance}`);
    expect((forFinance.body.items as LooseJson[]).every((i) => i.asset.id === bobLaptop.id)).toBe(true);
    const blockedOnly = await call('am', 'GET', '/discovery/compliance?approval=blocked');
    expect(blockedOnly.body.items).toEqual([
      expect.objectContaining({ product: 'uTorrent', approval: 'blocked' }),
    ]);
    const summary = await call('am', 'GET', '/discovery/compliance/summary');
    expect(summary.body).toEqual({ allowListInUse: true, unapproved: 4, blocked: 1, devices: 2 });
    // The home dashboard's attention card counts them for asset managers.
    expect((await call('am', 'GET', '/attention')).body.unapprovedSoftware).toBe(5);
  });

  it('matches installs a title rule renamed, by the reported title or the licence of the entry', async () => {
    const license = await call('am', 'POST', '/licenses', {
      product: 'Microsoft 365 E3',
      licenseType: 'per_user',
      quantity: 10,
    });
    expect(license.status).toBe(201);
    await report(bobLaptop.id, [
      { product: 'Google Chrome' },
      { product: '7-Zip' },
      { product: 'Microsoft Visio Plan 2' },
      { product: 'Notepad++ Portable', version: '80.1' },
      { product: 'Microsoft Office 365 ProPlus' },
    ]);
    const rule = await call('am', 'POST', '/discovery/rules', {
      title: 'Microsoft Office 365 ProPlus',
      licenseId: license.body.id,
    });
    expect(rule.status).toBe(201);
    expect((await approvalsOf(bobLaptop.id))['Microsoft 365 E3']).toBe('unapproved');
    // An entry linked to the licence covers what counts as its product.
    const entry = await call('am', 'POST', '/approved-software', {
      title: 'Office',
      licenseModel: 'subscription',
      licenseId: license.body.id,
    });
    expect(entry.status).toBe(201);
    expect(entry.body.license).toMatchObject({ id: license.body.id, reference: license.body.reference });
    expect((await approvalsOf(bobLaptop.id))['Microsoft 365 E3']).toBe('allowed');
    // So does an entry with the title the tool reported.
    expect((await call('am', 'DELETE', `/approved-software/${entry.body.id}`)).status).toBe(204);
    await call('am', 'POST', '/approved-software', {
      title: 'Microsoft Office 365 ProPlus',
      licenseModel: 'subscription',
    });
    expect((await approvalsOf(bobLaptop.id))['Microsoft 365 E3']).toBe('allowed');
  });

  it('ends short-term approvals, reminds asset managers once, and audits every change', async () => {
    const zip = await call('am', 'POST', '/approved-software', {
      title: '7-Zip',
      licenseModel: 'open_source',
      validUntil: addDays(today, 5),
      requestReference: 'REQ-00042',
    });
    expect(zip.status).toBe(201);
    expect(zip.body.state).toBe('expiring');
    expect((await approvalsOf(bobLaptop.id))['7-Zip']).toBe('allowed');
    const sent = await services(itam()).approvedSoftware.expiryDigest(today);
    expect(sent).toBe(1);
    expect(await services(itam()).approvedSoftware.expiryDigest(today)).toBe(0);
    const notes = await t.eventually(
      () =>
        h.kernel.db
          .select()
          .from(notifications)
          .where(
            and(eq(notifications.userId, ids.am), eq(notifications.type, 'itam.approved-software.expiring')),
          ),
      (r) => r.length > 0,
    );
    expect(notes).toHaveLength(1);

    const ended = await call('am', 'PATCH', `/approved-software/${zip.body.id}`, {
      validUntil: addDays(today, -1),
    });
    expect(ended.status).toBe(200);
    expect(ended.body).toMatchObject({ state: 'expired', requestReference: 'REQ-00042' });
    expect((await approvalsOf(bobLaptop.id))['7-Zip']).toBe('unapproved');
    expect(await auditOf('itam.approved-software.updated', zip.body.id)).toHaveLength(1);
    const expiredList = await call('viewer', 'GET', '/approved-software?state=expired');
    expect(expiredList.body.items.map((e: LooseJson) => e.id)).toEqual([zip.body.id]);
  });

  it('lets software readers list and export, and only managers change the list', async () => {
    const list = await call('viewer', 'GET', '/approved-software?status=allowed&pageSize=50');
    expect(list.status).toBe(200);
    expect(list.body.items.map((e: LooseJson) => e.title)).toContain('google chrome');
    const byDept = await call('viewer', 'GET', `/approved-software?department=${h.ids.finance}`);
    expect(byDept.body.items.map((e: LooseJson) => e.title)).not.toContain('Microsoft Visio Plan 2');
    expect(
      (await call('viewer', 'POST', '/approved-software', { title: 'X', licenseModel: 'free' })).status,
    ).toBe(403);
    expect((await call('outsider', 'GET', '/approved-software')).status).toBe(403);
    expect((await call('alice', 'GET', '/discovery/compliance')).status).toBe(403);

    const csv = await h.app.inject({
      method: 'GET',
      url: `${API}/approved-software/export?status=allowed&locale=zh-TW`,
      headers: { cookie: s.viewer!.cookie },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="approved-software-/);
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.body.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(
      '項次,軟體名稱,版次,開發商,授權類型,序號／合約編號,適用範圍,狀態,有效期限,申請單,備註',
    );
    expect(lines.some((l) => l.includes('Microsoft Visio Plan 2') && l.includes('SALES-TPE'))).toBe(true);
    expect(lines.every((l) => !l.includes('uTorrent'))).toBe(true);
  });
});

describe('itam.approve-software', () => {
  const fields: FormElement[] = [
    { id: 'software', key: 'software', type: 'text', label: { en: 'Software' } } as FormElement,
    { id: 'version', key: 'version', type: 'text', label: { en: 'Version' } } as FormElement,
    {
      id: 'licence',
      key: 'licence',
      type: 'select',
      label: { en: 'Licence type' },
      options: [
        { value: 'free', label: { en: 'Free' } },
        { value: 'paid', label: { en: 'Paid' } },
      ],
    } as FormElement,
    { id: 'until', key: 'until', type: 'date', label: { en: 'Use until' } } as FormElement,
  ];
  const action: FormAction = {
    id: 'allow',
    on: 'approved',
    type: 'itam.approve-software',
    config: {
      title: '{{data.software}}',
      version: '{{data.version}}',
      publisher: 'Example Software',
      licenseModel: 'free',
      licenseModelField: 'field:licence',
      scope: 'department',
      validUntilFrom: 'field:until',
    },
  };

  it('adds the requested title for the requester’s department, then extends it for another one', async () => {
    await t.mkForm('software-install', { elements: fields, actions: [action] });
    const until = addDays(today, 60);
    const first = await t.submit(s.alice!, 'software-install', {
      software: 'DiagramTool',
      version: '3',
      licence: 'paid',
      until,
    });
    const [run] = await t.settledRuns(first.id);
    expect(run!.status, JSON.stringify(run!.error)).toBe('succeeded');
    expect(run!.result).toMatchObject({
      reference: 'DiagramTool 3',
      summary: 'itam.processActions.approveSoftware.addedUntil',
    });
    const [entry] = await h.kernel.db
      .select()
      .from(approvedSoftware)
      .where(eq(approvedSoftware.title, 'DiagramTool'));
    expect(entry).toMatchObject({
      version: '3',
      publisher: 'Example Software',
      licenseModel: 'paid',
      scope: 'departments',
      status: 'allowed',
      validUntil: until,
      requestReference: first.reference,
    });
    const depts = await h.kernel.db
      .select()
      .from(approvedSoftwareDepartments)
      .where(eq(approvedSoftwareDepartments.entryId, entry!.id));
    expect(depts.map((d) => d.departmentId)).toEqual([h.ids.salesTpe]);

    // A retry of the same run changes nothing.
    const audits = (await auditOf('itam.approved-software.created', entry!.id)).length;
    await h.kernel.db.execute(
      sql`update core.process_action_runs set status = 'queued' where id = ${run!.id}`,
    );
    await h.kernel.processActions.execute(run!.id);
    expect(
      await h.kernel.db.select().from(approvedSoftware).where(eq(approvedSoftware.title, 'DiagramTool')),
    ).toHaveLength(1);
    expect(await auditOf('itam.approved-software.created', entry!.id)).toHaveLength(audits);
    expect(await auditOf('itam.approved-software.updated', entry!.id)).toHaveLength(0);

    // Bob (Finance) asks for the same: the entry now covers Finance too.
    const second = await t.submit(s.bob!, 'software-install', {
      software: 'diagramtool',
      version: '3',
      licence: 'paid',
      until,
    });
    const [run2] = await t.settledRuns(second.id);
    expect(run2!.status, JSON.stringify(run2!.error)).toBe('succeeded');
    expect(run2!.result).toMatchObject({ summary: 'itam.processActions.approveSoftware.extendedUntil' });
    const after = await h.kernel.db
      .select()
      .from(approvedSoftwareDepartments)
      .where(eq(approvedSoftwareDepartments.entryId, entry!.id));
    expect(after.map((d) => d.departmentId).sort()).toEqual([h.ids.salesTpe, h.ids.finance].sort());

    // Permanent use (no end date) for Sales Taipei extends the entry it covers to permanent.
    const third = await t.submit(s.alice!, 'software-install', {
      software: 'DiagramTool',
      version: '3',
      licence: 'paid',
    });
    const [run3] = await t.settledRuns(third.id);
    expect(run3!.result).toMatchObject({ summary: 'itam.processActions.approveSoftware.extended' });
    const [permanent] = await h.kernel.db
      .select()
      .from(approvedSoftware)
      .where(eq(approvedSoftware.id, entry!.id));
    expect(permanent!.validUntil).toBeNull();
  });

  it('never stretches a short company-wide approval for one department', async () => {
    const companyUntil = addDays(today, 10);
    const company = await call('am', 'POST', '/approved-software', {
      title: 'ScreenTool',
      licenseModel: 'free',
      validUntil: companyUntil,
    });
    expect(company.status).toBe(201);
    const later = addDays(today, 90);
    const sub = await t.submit(s.alice!, 'software-install', {
      software: 'ScreenTool',
      licence: 'free',
      until: later,
    });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.result).toMatchObject({ summary: 'itam.processActions.approveSoftware.addedUntil' });
    const entries = await h.kernel.db
      .select()
      .from(approvedSoftware)
      .where(eq(approvedSoftware.title, 'ScreenTool'));
    expect(entries.map((e) => [e.scope, e.validUntil]).sort()).toEqual([
      ['company', companyUntil],
      ['departments', later],
    ]);
    // A request within the company-wide approval changes nothing.
    const within = await t.submit(s.bob!, 'software-install', {
      software: 'ScreenTool',
      licence: 'free',
      until: addDays(today, 5),
    });
    const [run2] = await t.settledRuns(within.id);
    expect(run2!.result).toMatchObject({ summary: 'itam.processActions.approveSoftware.unchanged' });
  });

  it('refuses a configuration without a software name and offers the form’s fields', async () => {
    const fieldsOf = await h.kernel.processActions.fields('itam.approve-software', {
      form: { elements: fields },
      locale: 'en',
    });
    const keys = fieldsOf.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['title', 'licenseModel', 'licenseModelField', 'scope']));
    const until = fieldsOf.find((f) => f.key === 'validUntilFrom');
    expect(until?.options?.map((o) => o.value)).toEqual(['none', 'field:until', 'step']);
  });
});

describe('device checkout and return', () => {
  /** A form-submission workflow with one approval step (by the asset manager) that has fields. */
  async function stepWorkflow(name: string, stepId: string, stepFields: unknown[]) {
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', { name, triggerKey: 'core.form-submission' });
    expect(wf.status).toBe(201);
    const saved = await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: stepId,
            type: 'approval',
            name: { en: 'IS' },
            approvers: [{ type: 'user', userId: ids.am }],
            mode: 'any',
            fields: stepFields,
          },
        ],
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    return wf.body.id as string;
  }

  async function approveWith(submission: LooseJson, data: Record<string, unknown>) {
    const instanceId = submission.workflow.id as string;
    const [task] = await t.eventually(
      () =>
        h.kernel.db
          .select()
          .from(approvalTasks)
          .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending'))),
      (r) => r.length > 0,
    );
    const res = await h.call(s.am!, 'POST', `/api/v1/approvals/${task!.id}/approve`, { data });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  let issued: LooseJson;

  it('assigns the device IS picks at the approval step to the requester, with the request on its history', async () => {
    issued = await laptop(null);
    const wf = await stepWorkflow('Device checkout', 'issue', [
      {
        key: 'device',
        type: 'record',
        label: { en: 'Device' },
        required: true,
        record: { types: ['itam.asset'] },
      },
    ]);
    await t.mkForm(
      'device-checkout',
      {
        elements: [
          {
            id: 'agree',
            key: 'agree',
            type: 'boolean',
            label: { en: 'I agree' },
            required: true,
          } as FormElement,
        ],
        actions: [
          {
            id: 'assign',
            on: 'approved',
            type: 'itam.assign-asset',
            config: { assetField: 'step', assetStepField: 'issue.device', assignTo: 'requester' },
          },
        ],
      },
      { workflowDefinitionId: wf },
    );
    const sub = await t.submit(s.alice!, 'device-checkout', { agree: true });
    await approveWith(sub, { device: `itam.asset:${issued.id}` });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status, JSON.stringify(run!.error)).toBe('succeeded');
    expect(run!.result).toMatchObject({
      reference: issued.tag,
      href: '/itam/mine',
      summary: 'itam.processActions.assignAsset.assigned',
      record: { type: 'itam.asset', id: issued.id },
    });
    const [a] = await h.kernel.db.select().from(assets).where(eq(assets.id, issued.id));
    expect(a).toMatchObject({ status: 'deployed', assignedTo: ids.alice });
    const history = await call('am', 'GET', `/assets/${issued.id}/events`);
    const assigned = (history.body.items as LooseJson[]).find((e) => e.kind === 'assigned');
    expect(assigned).toMatchObject({
      request: { reference: sub.reference, href: `/requests/${sub.reference}` },
      actor: { id: ids.am },
      user: { id: ids.alice },
    });
    // Idempotent on the run.
    const before = (await h.kernel.db.select().from(assetEvents).where(eq(assetEvents.assetId, issued.id)))
      .length;
    await h.kernel.db.execute(
      sql`update core.process_action_runs set status = 'queued' where id = ${run!.id}`,
    );
    await h.kernel.processActions.execute(run!.id);
    expect(
      (await h.kernel.db.select().from(assetEvents).where(eq(assetEvents.assetId, issued.id))).length,
    ).toBe(before);
  });

  it('takes the device back with the data retention date IS enters, and the wipe falls due months later', async () => {
    const wf = await stepWorkflow('Device return', 'receive', [
      { key: 'retainUntil', type: 'date', label: { en: 'Keep data until' }, required: true },
    ]);
    await t.mkForm(
      'device-return',
      {
        elements: [
          {
            id: 'device',
            key: 'device',
            type: 'record',
            label: { en: 'Device' },
            required: true,
            record: { types: ['itam.asset'] },
          } as FormElement,
          { id: 'appearance', key: 'appearance', type: 'text', label: { en: 'Appearance' } } as FormElement,
        ],
        actions: [
          {
            id: 'return',
            on: 'approved',
            type: 'itam.return-asset',
            config: {
              assetField: 'field:device',
              toStatus: 'in_stock',
              condition: 'Appearance: {{data.appearance}}',
              retentionFrom: 'step',
              retentionStepField: 'receive.retainUntil',
              wipeMonths: 2,
              scheduleWipe: true,
            },
          },
        ],
      },
      { workflowDefinitionId: wf },
    );
    // The requester picks their own device (they can see it as theirs).
    const sub = await t.submit(s.alice!, 'device-return', {
      device: `itam.asset:${issued.id}`,
      appearance: 'Good, no damage',
    });
    const retain = addDays(today, 10);
    await approveWith(sub, { retainUntil: retain });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status, JSON.stringify(run!.error)).toBe('succeeded');
    const due = addMonths(retain, 2);
    expect(run!.result).toMatchObject({
      reference: issued.tag,
      summary: 'itam.processActions.returnAsset.returnedWipe',
      summaryParams: { date: due },
    });
    const [a] = await h.kernel.db.select().from(assets).where(eq(assets.id, issued.id));
    expect(a).toMatchObject({ status: 'in_stock', assignedTo: null, dataRetainUntil: retain, wipeDue: due });
    const history = (await call('am', 'GET', `/assets/${issued.id}/events`)).body.items as LooseJson[];
    expect(history.find((e) => e.kind === 'returned')).toMatchObject({
      note: 'Appearance: Good, no damage',
      actor: { id: ids.am },
      request: { reference: sub.reference },
    });
    expect(history.find((e) => e.kind === 'wipe_scheduled')).toMatchObject({
      fromValue: retain,
      toValue: due,
    });

    // The record fact routes later approvals; the hardware list filters pending wipes.
    const facts = await h.kernel.records.facts([{ type: 'itam.asset', id: issued.id }]);
    expect(facts.get(`itam.asset:${issued.id}`) ?? facts.get(issued.id)).toMatchObject({ wipeDue: due });
    const pending = await call('am', 'GET', '/assets?wipe=pending');
    expect(pending.body.items.map((i: LooseJson) => i.id)).toEqual([issued.id]);
    expect((await call('am', 'GET', '/assets?wipe=due')).body.items).toEqual([]);

    // Retried: nothing new.
    const before = (await h.kernel.db.select().from(assetEvents).where(eq(assetEvents.assetId, issued.id)))
      .length;
    await h.kernel.db.execute(
      sql`update core.process_action_runs set status = 'queued' where id = ${run!.id}`,
    );
    await h.kernel.processActions.execute(run!.id);
    expect(
      (await h.kernel.db.select().from(assetEvents).where(eq(assetEvents.assetId, issued.id))).length,
    ).toBe(before);
  });

  it('reminds asset managers of wipes coming due and overdue, once per stage', async () => {
    const overdue = await laptop(ids.bob);
    const ret = await call('am', 'POST', `/assets/${overdue.id}/return`, {
      toStatus: 'in_stock',
      dataRetainUntil: addDays(today, -90),
    });
    expect(ret.status, JSON.stringify(ret.body)).toBe(200);
    expect(ret.body).toMatchObject({ wipeDue: addMonths(addDays(today, -90), 2), wipeState: 'overdue' });
    expect((await call('am', 'GET', '/assets?wipe=overdue')).body.items.map((i: LooseJson) => i.id)).toEqual([
      overdue.id,
    ]);
    expect((await call('am', 'GET', '/attention')).body.wipesDue).toBe(1);
    const svc = services(itam()).assets;
    expect(await svc.wipeDigest(today)).toEqual({ due: 0, overdue: 1 });
    expect(await svc.wipeDigest(today)).toEqual({ due: 0, overdue: 0 });
    // A monitor stores no data: no wipe.
    const monitor = await call('am', 'POST', '/assets', {
      name: 'MON-1',
      category: 'monitor',
      assigneeId: ids.bob,
    });
    const back = await call('am', 'POST', `/assets/${monitor.body.id}/return`, { toStatus: 'in_stock' });
    expect(back.body).toMatchObject({ wipeDue: null, wipeState: 'none', viewer: { canRecordWipe: false } });
    const notes = await t.eventually(
      () =>
        h.kernel.db
          .select()
          .from(notifications)
          .where(and(eq(notifications.userId, ids.am), eq(notifications.type, 'itam.wipe.due'))),
      (r) => r.length > 0,
    );
    expect(notes).toHaveLength(1);
  });

  it('records a data wipe (who, when, how), audited, and clears the pending wipe', async () => {
    expect(
      (await call('viewer', 'POST', `/assets/${issued.id}/wipe`, { method: 'secure_erase' })).status,
    ).toBe(403);
    const future = await call('am', 'POST', `/assets/${issued.id}/wipe`, {
      method: 'secure_erase',
      wipedAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(future.status).toBe(400);
    const wiped = await call('am', 'POST', `/assets/${issued.id}/wipe`, {
      method: 'secure_erase',
      wipedById: ids.am,
      note: 'Overwritten with the imaging tool',
    });
    expect(wiped.status, JSON.stringify(wiped.body)).toBe(200);
    expect(wiped.body).toMatchObject({
      wipeDue: null,
      wipeState: 'none',
      lastWipe: { by: { id: ids.am }, method: 'secure_erase' },
    });
    expect(await auditOf('itam.asset.data_wiped', issued.id)).toHaveLength(1);
    const history = (await call('am', 'GET', `/assets/${issued.id}/events`)).body.items as LooseJson[];
    expect(history[0]).toMatchObject({ kind: 'data_wiped', toValue: 'secure_erase', user: { id: ids.am } });
    expect(
      (await call('am', 'GET', '/assets?wipe=pending')).body.items.map((i: LooseJson) => i.id),
    ).not.toContain(issued.id);
  });
});
