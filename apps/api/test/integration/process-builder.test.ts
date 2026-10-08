import {
  approvalTasks,
  groupMembers,
  groups,
  roleAssignments,
  roles,
  users,
  workflowInstances,
} from '@isbp/db/schema';
import { ciRelationships, cis } from '@isbp/module-cmdb/schema';
import type { AuthContext, FormSchema, WorkflowGraph } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { toSessionUser } from '../../src/kernel/sessions';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, PASSWORD, type Session } from './harness';

/*
 * Phase 8 (process builder): record fields (checked against the person's read access and the field's `where`),
 * record facts in workflows (`records.<field>.<fact>`), group-fact approvers, form rules and the approval preview.
 */

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const ci: Record<string, string> = {};
const ref = (name: string) => `cmdb.ci:${ci[name]}`;
const FORM = 'config-change';
let formId: string;

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(username: string, managerId?: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      managerId: managerId ?? null,
    })
    .returning();
  return u!.id;
}

async function authFor(userId: string): Promise<AuthContext> {
  const [u] = await h.kernel.db.select().from(users).where(eq(users.id, userId));
  return buildAuthContext(
    { type: 'user', id: u!.id, name: u!.displayName },
    toSessionUser(u!),
    null,
    await h.kernel.rbac.permissionsFor(u!.id),
  );
}

const schema: FormSchema = {
  elements: [
    {
      id: 'a',
      key: 'ci',
      type: 'record',
      label: { en: 'Configuration item' },
      required: true,
      record: { types: ['cmdb.ci'], where: { fact: 'environment', op: 'eq', value: 'production' } },
    },
    {
      id: 'b',
      key: 'related',
      type: 'record',
      label: { en: 'Related CIs' },
      record: { types: ['cmdb.ci'], multiple: true },
    },
    { id: 'c', key: 'start', type: 'date', label: { en: 'Start' }, required: true },
    { id: 'd', key: 'end', type: 'date', label: { en: 'End' }, required: true },
    {
      id: 'e',
      key: 'risk',
      type: 'select',
      label: { en: 'Risk' },
      required: true,
      options: [
        { value: 'low', label: { en: 'Low' } },
        { value: 'high', label: { en: 'High' } },
      ],
    },
    { id: 'f', key: 'rollback', type: 'textarea', label: { en: 'Rollback plan' } },
  ],
  rules: [
    {
      id: 'order',
      require: { fact: 'end', op: 'gte', valueFact: 'start' },
      message: {
        en: 'The end must be after the start',
        'zh-TW': '結束必須晚於開始',
        'ja-JP': '終了は開始より後',
      },
      fields: ['end'],
    },
    {
      id: 'rollback',
      when: { fact: 'risk', op: 'eq', value: 'high' },
      require: { fact: 'rollback', op: 'notEmpty' },
      message: { en: 'High-risk changes need a rollback plan' },
      fields: ['rollback'],
    },
    {
      id: 'freeze',
      require: { not: { fact: 'start', op: 'eq', value: '2026-12-25' } },
      message: { en: 'No changes on the 25th' },
    },
  ],
};

/** Manager → the CI's support group (a group from a fact) → the CAB when the CI is critical. */
const graph: WorkflowGraph = {
  steps: [
    { id: 'mgr', type: 'approval', name: { en: 'Manager' }, approvers: [{ type: 'manager' }], mode: 'any' },
    {
      id: 'owners',
      type: 'approval',
      name: { en: 'CI owner group' },
      approvers: [{ type: 'fact', fact: 'records.ci.ownerGroup', kind: 'group' }],
      mode: 'any',
    },
    {
      id: 'cab',
      type: 'approval',
      name: { en: 'CAB' },
      when: { fact: 'records.ci.criticality', op: 'eq', value: 'critical' },
      approvers: [{ type: 'group', groupKey: 'test-cab' }],
      mode: 'any',
    },
  ],
};

const valid = (extra: Record<string, unknown> = {}) => ({
  ci: ref('erpApp'),
  start: '2026-11-02',
  end: '2026-11-03',
  risk: 'low',
  ...extra,
});

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');

  ids.mgr = await mkUser('pb-mgr');
  ids.req = await mkUser('pb-req', ids.mgr);
  ids.noread = await mkUser('pb-noread', ids.mgr);
  ids.sup1 = await mkUser('pb-sup1');
  ids.sup2 = await mkUser('pb-sup2');
  ids.cab1 = await mkUser('pb-cab1');
  const [support] = await h.kernel.db
    .insert(groups)
    .values({ key: 'erp-support', name: 'ERP support' })
    .returning();
  const [cab] = await h.kernel.db.insert(groups).values({ key: 'test-cab', name: 'CAB' }).returning();
  await h.kernel.db.insert(groupMembers).values([
    { groupId: support!.id, userId: ids.sup1 },
    { groupId: support!.id, userId: ids.sup2 },
    { groupId: cab!.id, userId: ids.cab1 },
  ]);
  const [viewer] = await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'cmdb-viewer'));
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: viewer!.id, userId: ids.req },
    { roleId: viewer!.id, userId: ids.mgr },
  ]);
  await h.kernel.rbac.bump();

  const rows = await h.kernel.db
    .insert(cis)
    .values([
      {
        name: 'PB Finance ERP',
        classKey: 'business-service',
        environment: 'production',
        criticality: 'critical',
        supportGroupId: support!.id,
      },
      {
        name: 'pb-erp-app-01',
        classKey: 'application',
        environment: 'production',
        criticality: 'high',
        supportGroupId: support!.id,
        ownerId: ids.sup1,
        tags: ['erp'],
      },
      { name: 'pb-dev-box-01', classKey: 'server', environment: 'development', criticality: 'low' },
    ])
    .returning();
  ci.svc = rows[0]!.id;
  ci.erpApp = rows[1]!.id;
  ci.devBox = rows[2]!.id;
  // The ERP service depends on the application: the application supports the service.
  await h.kernel.db
    .insert(ciRelationships)
    .values({ sourceId: ci.svc!, targetId: ci.erpApp!, type: 'depends_on' });

  for (const u of ['pb-req', 'pb-noread', 'pb-mgr', 'pb-sup1']) s[u] = await h.login(u);

  const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
    name: 'Configuration change',
    triggerKey: 'core.form-submission',
  });
  expect(wf.status).toBe(201);
  const patched = await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, { draft: graph });
  expect(patched.body.issues).toEqual([]);
  expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);

  const form = await h.call(admin, 'POST', '/api/v1/forms', {
    key: FORM,
    name: { en: 'Configuration change' },
    icon: 'git-branch',
  });
  formId = form.body.id;
  const saved = await h.call(admin, 'PATCH', `/api/v1/forms/${formId}`, {
    draft: schema,
    workflowDefinitionId: wf.body.id,
  });
  expect(saved.status).toBe(200);
  expect(saved.body.draft.rules).toHaveLength(3);
  expect((await h.call(admin, 'POST', `/api/v1/forms/${formId}/publish`)).status).toBe(200);
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('record types and facts', () => {
  it('lists the types the caller may pick, with facts for builders', async () => {
    const res = await h.call(s['pb-req']!, 'GET', '/api/v1/records/types');
    const type = res.body.items.find((t: { type: string }) => t.type === 'cmdb.ci');
    expect(type.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'criticality',
          options: ['critical', 'high', 'medium', 'low'],
          label: 'cmdb.recordFacts.criticality',
          valueLabels: 'cmdb.criticality',
        }),
        expect.objectContaining({ path: 'ownerGroup', ref: 'group' }),
        expect.objectContaining({ path: 'ownerId', type: 'id', ref: 'user' }),
        expect.objectContaining({ path: 'businessServices', type: 'list' }),
      ]),
    );
    const none = await h.call(s['pb-noread']!, 'GET', '/api/v1/records/types');
    expect(none.body.items.map((t: { type: string }) => t.type)).not.toContain('cmdb.ci');
    const all = await h.call(s['pb-noread']!, 'GET', '/api/v1/records/types?all=true');
    expect(all.body.items.map((t: { type: string }) => t.type)).toContain('cmdb.ci');
  });

  it('resolves CI facts without permission filtering (owner group key, business services)', async () => {
    const facts = await h.kernel.records.facts([{ type: 'cmdb.ci', id: ci.erpApp! }]);
    const svc = await h.call(admin, 'GET', `/api/v1/records/cmdb.ci/${ci.svc}`);
    expect(facts.get(ref('erpApp'))).toMatchObject({
      class: 'application',
      environment: 'production',
      criticality: 'high',
      ownerId: ids.sup1,
      ownerGroup: 'erp-support',
      tags: ['erp'],
      businessServices: [svc.body.reference],
    });
  });

  it('filters the picker search by a field’s `where`, and resolves values with a hidden count', async () => {
    const where = encodeURIComponent(JSON.stringify({ fact: 'environment', op: 'eq', value: 'production' }));
    const found = await h.call(
      s['pb-req']!,
      'GET',
      `/api/v1/records/search?q=pb-&types=cmdb.ci&where=${where}`,
    );
    expect(found.status).toBe(200);
    const names = found.body.items.map((r: { title: string }) => r.title);
    expect(names).toContain('pb-erp-app-01');
    expect(names).not.toContain('pb-dev-box-01');
    const bad = await h.call(s['pb-req']!, 'GET', '/api/v1/records/search?where=%7Bnope');
    expect(bad.status).toBe(400);

    const refs = [ref('erpApp'), ref('devBox')].join(',');
    const mine = await h.call(s['pb-req']!, 'GET', `/api/v1/records/resolve?refs=${refs}`);
    expect(mine.body).toMatchObject({ hidden: 0 });
    expect(mine.body.items).toHaveLength(2);
    const theirs = await h.call(s['pb-noread']!, 'GET', `/api/v1/records/resolve?refs=${refs}`);
    expect(theirs.body).toEqual({ items: [], hidden: 2 });
  });
});

describe('record fields on a form', () => {
  const submit = (who: string, data: Record<string, unknown>) =>
    h.call(s[who]!, 'POST', `/api/v1/forms/by-key/${FORM}/submissions`, { data });
  const issue = (res: { body: { error: { details: { issues: { path: string }[] } } } }, path: string) =>
    res.body.error.details.issues.find((i) => i.path === path);

  it('refuses records the person can’t read', async () => {
    const res = await submit('pb-noread', valid());
    expect(res.status).toBe(400);
    expect(issue(res, 'data.ci')).toMatchObject({ code: 'record' });
  });

  it('refuses records outside the field’s `where`, unknown records and other types', async () => {
    expect(issue(await submit('pb-req', valid({ ci: ref('devBox') })), 'data.ci')).toMatchObject({
      code: 'record',
    });
    const ghost = 'cmdb.ci:0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d10';
    expect(issue(await submit('pb-req', valid({ ci: ghost })), 'data.ci')).toMatchObject({ code: 'record' });
    expect(
      issue(await submit('pb-req', valid({ related: [ref('svc'), ghost] })), 'data.related'),
    ).toMatchObject({ code: 'record' });
    expect(issue(await submit('pb-req', valid({ ci: `itsm.ticket:${ci.erpApp}` })), 'data.ci')).toMatchObject(
      { code: 'record' },
    );
  });

  it('returns rule errors with their messages, on fields or on _form', async () => {
    const order = await submit('pb-req', valid({ start: '2026-11-05', end: '2026-11-01', risk: 'high' }));
    expect(order.status).toBe(400);
    expect(issue(order, 'data.end')).toMatchObject({
      code: 'rule',
      text: {
        en: 'The end must be after the start',
        'zh-TW': '結束必須晚於開始',
        'ja-JP': '終了は開始より後',
      },
    });
    expect(issue(order, 'data.rollback')).toMatchObject({
      code: 'rule',
      text: { en: 'High-risk changes need a rollback plan' },
    });
    const freeze = await submit('pb-req', valid({ start: '2026-12-25', end: '2026-12-26' }));
    expect(freeze.body.error.details.issues).toEqual([
      expect.objectContaining({ path: 'data._form', code: 'rule', text: { en: 'No changes on the 25th' } }),
    ]);
  });

  it('previews who would approve, using the picked record’s facts', async () => {
    const preview = (who: string, data: Record<string, unknown>) =>
      h.call(s[who]!, 'POST', `/api/v1/forms/by-key/${FORM}/preview`, { data });
    const steps = (res: { body: { steps: { id: string; outcome: string; people: { id: string }[] }[] } }) =>
      Object.fromEntries(
        res.body.steps.map((st) => [
          st.id,
          { outcome: st.outcome, people: st.people.map((p) => p.id).sort() },
        ]),
      );

    const high = await preview('pb-req', valid());
    expect(high.status).toBe(200);
    expect(steps(high)).toEqual({
      mgr: { outcome: 'ask', people: [ids.mgr] },
      owners: { outcome: 'ask', people: [ids.sup1, ids.sup2].sort() },
      cab: { outcome: 'skipped', people: [] },
    });
    const critical = await preview('pb-req', valid({ ci: ref('svc') }));
    expect(steps(critical).cab).toEqual({ outcome: 'ask', people: [ids.cab1] });
    // Partial answers are fine; records the person can't read are left out (the group step finds nobody).
    const partial = await preview('pb-noread', { ci: ref('svc') });
    expect(partial.status).toBe(200);
    expect(steps(partial).owners).toEqual({ outcome: 'reject', people: [] });
  });

  it('routes the submission on records.<field>.<fact> and asks the owner group', async () => {
    const res = await submit('pb-req', valid({ ci: ref('svc'), related: [ref('erpApp'), ref('devBox')] }));
    expect(res.status).toBe(201);
    const instanceId = res.body.workflow.id as string;
    const [inst] = await h.kernel.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));
    expect(inst!.facts).toMatchObject({
      data: { ci: ref('svc') },
      records: {
        ci: { criticality: 'critical', ownerGroup: 'erp-support' },
        related: { criticality: ['high', 'low'], environment: ['production', 'development'] },
      },
    });
    const pending = async () =>
      h.kernel.db
        .select()
        .from(approvalTasks)
        .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));
    const [mgr] = await pending();
    expect(mgr).toMatchObject({ stepId: 'mgr', assigneeId: ids.mgr });
    expect((await h.call(s['pb-mgr']!, 'POST', `/api/v1/approvals/${mgr!.id}/approve`, {})).status).toBe(200);
    const owners = await eventually(pending, (t) => t.some((x) => x.stepId === 'owners'));
    expect(owners.map((t) => t.assigneeId).sort()).toEqual([ids.sup1, ids.sup2].sort());
    await h.call(s['pb-sup1']!, 'POST', `/api/v1/approvals/${owners[0]!.id}/approve`, {});
    const cab = await eventually(pending, (t) => t.some((x) => x.stepId === 'cab'));
    expect(cab.map((t) => t.assigneeId)).toEqual([ids.cab1]);
  });

  it('stores the picked records as refs in the answers', async () => {
    const res = await submit('pb-req', valid({ related: [ref('devBox'), ref('devBox')] }));
    const sub = await h.call(s['pb-req']!, 'GET', `/api/v1/form-submissions/${res.body.id}`);
    expect(sub.body.data).toMatchObject({ ci: ref('erpApp'), related: [ref('devBox')] });
  });
});

describe('record fields in form definitions and custom fields', () => {
  it('refuses unknown record types and types the editor may not use', async () => {
    const bad = await h.call(admin, 'PATCH', `/api/v1/forms/${formId}`, {
      draft: {
        elements: [
          {
            id: 'x',
            key: 'thing',
            type: 'record',
            label: { en: 'Thing' },
            record: { types: ['nope.thing'] },
          },
        ],
      },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues[0].path).toBe('draft.elements.0.record.types');
    const unknown = await h.call(admin, 'POST', '/api/v1/custom-fields', {
      entityType: 'core.department',
      field: { key: 'thing', type: 'record', label: { en: 'Thing' }, record: { types: ['nope.thing'] } },
    });
    expect(unknown.status).toBe(400);

    // A workflow designer who can't browse the CMDB can't offer CIs, but may keep the field that already does.
    const designer = await mkUser('pb-designer');
    const [role] = await h.kernel.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'workflow-admin'));
    await h.kernel.db.insert(roleAssignments).values({ roleId: role!.id, userId: designer });
    await h.kernel.rbac.bump();
    const session = await h.login('pb-designer');
    const offered = await h.call(session, 'PATCH', `/api/v1/forms/${formId}`, {
      draft: {
        ...schema,
        elements: [
          ...schema.elements,
          { id: 'g', key: 'more', type: 'record', label: { en: 'More' }, record: { types: ['cmdb.ci'] } },
        ],
      },
    });
    expect(offered.status).toBe(400);
    expect(offered.body.error.details.issues[0].path).toBe('draft.elements.6.record.types');
    const kept = await h.call(session, 'PATCH', `/api/v1/forms/${formId}`, { draft: schema });
    expect(kept.status).toBe(200);
  });

  it('accepts bounded patterns such as an IPv4 address and still lists the fields', async () => {
    const ip = await h.call(admin, 'POST', '/api/v1/custom-fields', {
      entityType: 'core.department',
      field: {
        key: 'gatewayIp',
        type: 'text',
        label: { en: 'Gateway IP' },
        validation: { pattern: '^(\\d{1,3}\\.){3}\\d{1,3}$' },
      },
    });
    expect(ip.status).toBe(201);
    const listed = await h.call(admin, 'GET', '/api/v1/custom-fields?entityType=core.department');
    expect(listed.status).toBe(200);
    const unsafe = await h.call(admin, 'POST', '/api/v1/custom-fields', {
      entityType: 'core.department',
      field: { key: 'bad', type: 'text', label: { en: 'Bad' }, validation: { pattern: '(\\d+\\.)+' } },
    });
    expect(unsafe.status).toBe(400);
  });

  it('validates record custom fields against the caller (or existence without one)', async () => {
    const created = await h.call(admin, 'POST', '/api/v1/custom-fields', {
      entityType: 'core.department',
      field: { key: 'mainCi', type: 'record', label: { en: 'Main CI' }, record: { types: ['cmdb.ci'] } },
    });
    expect(created.status).toBe(201);
    const fields = h.kernel.fields;
    fields.invalidate('core.department');
    const ok = await fields.validate(
      'core.department',
      { mainCi: ref('erpApp') },
      {},
      await authFor(ids.req!),
    );
    expect(ok).toEqual({ mainCi: ref('erpApp') });
    await expect(
      fields.validate('core.department', { mainCi: ref('erpApp') }, {}, await authFor(ids.noread!)),
    ).rejects.toMatchObject({ statusCode: 400 });
    // System work (no person): the record only has to exist.
    expect(await fields.validate('core.department', { mainCi: ref('devBox') }, {}, null)).toEqual({
      mainCi: ref('devBox'),
    });
    await expect(
      fields.validate(
        'core.department',
        { mainCi: 'cmdb.ci:0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d10' },
        {},
        null,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    // A record already stored stays valid for an editor who can't read it.
    expect(
      await fields.validate(
        'core.department',
        { mainCi: ref('erpApp') },
        { mainCi: ref('erpApp') },
        await authFor(ids.noread!),
      ),
    ).toEqual({ mainCi: ref('erpApp') });

    // Over HTTP the person of the request is used: the scoped HR admin can't read CIs.
    const hr = await h.login('hr');
    const refused = await h.call(hr, 'PATCH', `/api/v1/departments/${h.ids.sales}`, {
      attributes: { mainCi: ref('erpApp') },
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.issues).toEqual([
      expect.objectContaining({ path: 'attributes.mainCi', code: 'record' }),
    ]);
    const accepted = await h.call(admin, 'PATCH', `/api/v1/departments/${h.ids.sales}`, {
      attributes: { mainCi: ref('erpApp') },
    });
    expect(accepted.status).toBe(200);
  });
});

describe('a group from a fact, each value asked separately', () => {
  it('asks the owner group of every picked CI, and needs each of them with "all"', async () => {
    // A second support group with its own CI.
    const [net] = await h.kernel.db
      .insert(groups)
      .values({ key: 'net-support', name: 'Network support' })
      .returning();
    ids.net1 = await mkUser('pb-net1');
    await h.kernel.db.insert(groupMembers).values({ groupId: net!.id, userId: ids.net1 });
    const [sw] = await h.kernel.db
      .insert(cis)
      .values({
        name: 'pb-core-sw',
        classKey: 'network-device',
        environment: 'production',
        supportGroupId: net!.id,
      })
      .returning();
    s['pb-net1'] = await h.login('pb-net1');

    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Each owner group',
      triggerKey: 'core.form-submission',
    });
    const each: WorkflowGraph = {
      steps: [
        {
          id: 'owners',
          type: 'approval',
          name: { en: 'Each CI owner group' },
          approvers: [{ type: 'fact', fact: 'records.related.ownerGroup', kind: 'group', each: true }],
          mode: 'all',
        },
      ],
    };
    expect(
      (await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, { draft: each })).body.issues,
    ).toEqual([]);
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    const form = await h.call(admin, 'POST', '/api/v1/forms', { key: 'pb-each', name: { en: 'Each' } });
    await h.call(admin, 'PATCH', `/api/v1/forms/${form.body.id}`, {
      draft: { elements: [schema.elements[1]!] },
      workflowDefinitionId: wf.body.id,
    });
    expect((await h.call(admin, 'POST', `/api/v1/forms/${form.body.id}/publish`)).status).toBe(200);

    const res = await h.call(s['pb-req']!, 'POST', '/api/v1/forms/by-key/pb-each/submissions', {
      data: { related: [ref('erpApp'), `cmdb.ci:${sw!.id}`] },
    });
    expect(res.status).toBe(201);
    const instanceId = res.body.workflow.id as string;
    const tasks = async () =>
      h.kernel.db.select().from(approvalTasks).where(eq(approvalTasks.instanceId, instanceId));
    const first = await eventually(tasks, (t) => t.length >= 3);
    // One slot per group: ERP support (two members) and network support (one).
    expect(new Set(first.map((t) => t.slot)).size).toBe(2);
    expect(first.map((t) => t.assigneeId).sort()).toEqual([ids.sup1, ids.sup2, ids.net1].sort());

    const erpTask = first.find((t) => t.assigneeId === ids.sup1)!;
    expect((await h.call(s['pb-sup1']!, 'POST', `/api/v1/approvals/${erpTask.id}/approve`, {})).status).toBe(
      200,
    );
    const [mid] = await h.kernel.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));
    expect(mid!.status).toBe('running');

    const netTask = first.find((t) => t.assigneeId === ids.net1)!;
    expect((await h.call(s['pb-net1']!, 'POST', `/api/v1/approvals/${netTask.id}/approve`, {})).status).toBe(
      200,
    );
    const done = await eventually(
      async () =>
        (await h.kernel.db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId)))[0]!,
      (i) => i.status !== 'running',
    );
    expect(done.status).toBe('approved');
  });
});
