import {
  auditLogs,
  forms,
  groupMembers,
  groups,
  moduleSettings,
  notificationChannels,
  roleAssignments,
  roles,
  users,
  workflowDefinitions,
} from '@isbp/db/schema';
import type { AuthContext, CustomizationChange, Db, WorkflowGraph } from '@isbp/sdk/server';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customizations } from '../../src/core/customizations';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, PASSWORD } from './harness';

let h: Harness;
let admin: AuthContext;
let hr: AuthContext;
let outsider: AuthContext;
let roleManager: AuthContext;

const cz = () => h.kernel.customizations;
const authOf = async (userId: string) => (await h.kernel.registry.context('core').rbac.authFor(userId))!;

/** Applies one change in its own committed transaction. */
function apply(
  kind: string,
  change: CustomizationChange & { baseVersion?: string | null },
  auth: AuthContext,
  source?: { type: string; id: string; reference?: string },
) {
  return h.kernel.db.transaction((tx) => cz().apply(kind, change, { auth, tx: tx as unknown as Db, source }));
}

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back, returning what it produced. */
async function rolledBack<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await h.kernel.db
    .transaction(async (tx) => {
      out = await fn(tx as unknown as Db);
      throw new Rollback();
    })
    .catch((err) => {
      if (!(err instanceof Rollback)) throw err;
    });
  return out!;
}

/** Row counts of everything a change set can touch, to prove a rollback left nothing behind. */
async function footprint() {
  const tables = [
    'audit_logs',
    'outbox_events',
    'workflow_definitions',
    'workflow_versions',
    'forms',
    'form_versions',
    'custom_fields',
    'roles',
    'role_permissions',
  ];
  const counts: Record<string, number> = {};
  for (const t of tables)
    counts[t] = (
      await h.kernel.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from core.${t}`))
    ).rows[0]!.n;
  const settings = await h.kernel.db.select().from(moduleSettings).orderBy(moduleSettings.key);
  const channels = await h.kernel.db.select().from(notificationChannels);
  const rolePerms = await h.kernel.db.execute(
    sql`select role_id, permission from core.role_permissions order by 1, 2`,
  );
  return {
    counts,
    settings: JSON.stringify(settings.map((s) => [s.moduleId, s.key, s.value])),
    channels: JSON.stringify(channels.map((c) => [c.id, c.name, c.types, c.enabled, c.locale])),
    rolePermissions: JSON.stringify(rolePerms.rows),
    roleNames: JSON.stringify(
      (await h.kernel.db.select({ id: roles.id, name: roles.name }).from(roles)).sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    ),
  };
}

const name = (en: string) => ({ en, 'zh-TW': en, 'ja-JP': en });

const laptopGraph = (groupKey = 'it-asset-management'): WorkflowGraph => ({
  steps: [
    {
      id: 'department-head',
      type: 'approval',
      name: name('Department head'),
      approvers: [{ type: 'department-head' }],
      mode: 'any',
    },
    {
      id: 'it-assets',
      type: 'approval',
      name: name('IT assets'),
      when: { fact: 'data.amount', op: 'gt', value: 60000 },
      approvers: [{ type: 'group', groupKey }],
      mode: 'any',
    },
  ],
});

const laptopWorkflow = (overrides: Record<string, unknown> = {}) => ({
  name: 'Laptop approval',
  description: 'Department head, then IT assets above 60 000',
  triggerKey: 'core.form-submission',
  graph: laptopGraph(),
  isDefault: false,
  ...overrides,
});

const laptopForm = (workflowId: string | null, overrides: Record<string, unknown> = {}) => ({
  key: 'laptop-request',
  name: name('Laptop request'),
  description: null,
  icon: 'laptop',
  category: 'Hardware',
  schema: {
    elements: [
      { id: 'amount', key: 'amount', type: 'number', label: name('Amount'), required: true },
      { id: 'reason', key: 'reason', type: 'textarea', label: name('Reason') },
    ],
  },
  workflowId,
  audience: { type: 'everyone' },
  active: true,
  ...overrides,
});

const issueCodes = async (kind: string, change: CustomizationChange, auth = admin) =>
  (await cz().validate(kind, change, auth)).issues.map((i) => i.code);

beforeAll(async () => {
  h = await createHarness();
  const [assets] = await h.kernel.db
    .insert(groups)
    .values({ key: 'it-asset-management', name: 'IT asset management' })
    .returning();
  await h.kernel.db.insert(groupMembers).values({ groupId: assets!.id, userId: h.ids.admin });
  // A role manager who holds nothing else globally (for the escalation guard).
  const [rm] = await h.kernel.db
    .insert(roles)
    .values({
      applicationId: (
        await h.kernel.db.execute<{ id: string }>(sql`select id from core.applications where key = 'isbp'`)
      ).rows[0]!.id,
      key: 'test-role-manager',
      name: 'Test role manager',
    })
    .returning();
  await h.kernel.db.execute(
    sql`insert into core.role_permissions (role_id, permission) values (${rm!.id}, 'core.roles.*')`,
  );
  const [manager] = await h.kernel.db
    .insert(users)
    .values({
      email: 'rolemgr@test.example',
      username: 'rolemgr',
      displayName: 'rolemgr',
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  await h.kernel.db.insert(roleAssignments).values({ roleId: rm!.id, userId: manager!.id });
  await h.kernel.rbac.bump();
  admin = await authOf(h.ids.admin);
  hr = await authOf(h.ids.hr);
  roleManager = await authOf(manager!.id);
  outsider = await authOf(h.ids.outsider);
});

afterAll(async () => {
  await h?.close();
});

describe('kinds', () => {
  it('lists the six core kinds to an administrator and only readable ones to others', () => {
    const kinds = cz()
      .kinds(admin)
      .filter((k) => k.moduleId === 'core');
    expect(kinds.map((k) => k.kind).sort()).toEqual([
      'core.custom-field',
      'core.form',
      'core.module-settings',
      'core.notification-channel',
      'core.role',
      'core.workflow',
    ]);
    expect(kinds.every((k) => k.canApply)).toBe(true);
    expect(kinds.find((k) => k.kind === 'core.workflow')!.templates.map((t) => t.id)).toEqual([
      'approval-chain',
    ]);
    // hr is a department-scoped identity administrator: custom fields and roles only, without applying roles.
    const forHr = cz()
      .kinds(hr)
      .filter((k) => k.moduleId === 'core');
    expect(forHr.map((k) => k.kind).sort()).toEqual(['core.custom-field', 'core.role']);
    expect(forHr.find((k) => k.kind === 'core.role')!.canApply).toBe(false);
  });

  it('describes every kind with a JSON schema and a guide', async () => {
    for (const kind of cz()
      .kinds(admin)
      .filter((k) => k.moduleId === 'core')) {
      const d = await cz().describe(kind.kind, admin);
      expect(d.schema.type, kind.kind).toBe('object');
      expect(d.guide.instructions.length, kind.kind).toBeGreaterThan(100);
    }
    const wf = await cz().describe('core.workflow', admin);
    const reference = wf.guide.reference as {
      triggers: { key: string; facts: { path: string; label: string }[] }[];
      groups: { key: string }[];
    };
    const formTrigger = reference.triggers.find((t) => t.key === 'core.form-submission')!;
    expect(formTrigger.facts.map((f) => f.path)).toContain('form.category');
    expect(formTrigger.facts.find((f) => f.path === 'form.category')!.label).toBe('Form category');
    expect(reference.groups.map((g) => g.key)).toContain('it-asset-management');
    // Every worked example is a valid value.
    for (const kind of [
      'core.workflow',
      'core.form',
      'core.custom-field',
      'core.role',
      'core.notification-channel',
    ]) {
      const { guide } = await cz().describe(kind, admin);
      for (const ex of guide.examples ?? [])
        expect(
          customizations[kind.split('.')[1]!]!.schema.safeParse(ex.value).success,
          `${kind}: ${ex.description}`,
        ).toBe(true);
    }
  });

  it('refuses readers without the read permission and appliers without the apply permission', async () => {
    await expect(cz().list('core.workflow', {}, hr)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      apply(
        'core.role',
        { op: 'create', id: null, value: { key: 'x-role', name: 'X', permissions: [] } },
        hr,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});

describe('core.workflow', () => {
  let id: string;

  it('checks triggers, groups, facts and defaults', async () => {
    expect(
      await issueCodes('core.workflow', {
        op: 'create',
        id: null,
        value: laptopWorkflow({ triggerKey: 'nope.trigger' }),
      }),
    ).toContain('unknown_trigger');
    const unknownGroup = await cz().validate(
      'core.workflow',
      { op: 'create', id: null, value: laptopWorkflow({ graph: laptopGraph('no-such-group') }) },
      admin,
    );
    expect(unknownGroup.issues).toEqual([
      expect.objectContaining({ code: 'unknown_group', path: 'graph.steps.1' }),
    ]);
    const badFact = laptopWorkflow({
      graph: { steps: [{ ...laptopGraph().steps[1]!, when: { fact: 'amount', op: 'gt', value: 1 } }] },
    });
    expect(await issueCodes('core.workflow', { op: 'create', id: null, value: badFact })).toEqual([
      'unknown_fact',
    ]);
    expect(
      await issueCodes('core.workflow', {
        op: 'create',
        id: null,
        value: laptopWorkflow({ graph: { steps: [] } }),
      }),
    ).toEqual(['empty']);
    // The access-request default is the only one of a required trigger.
    const [def] = await h.kernel.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.triggerKey, 'core.access-request'),
          eq(workflowDefinitions.isDefault, true),
        ),
      );
    const current = (await cz().get('core.workflow', def!.id, admin))!;
    expect(
      await issueCodes('core.workflow', {
        op: 'update',
        id: def!.id,
        value: { ...(current.value as object), isDefault: false },
      }),
    ).toEqual(['default_required']);
  });

  it('creates, publishes and audits with the change set as the source', async () => {
    const result = await apply('core.workflow', { op: 'create', id: null, value: laptopWorkflow() }, admin, {
      type: 'change-set',
      id: '00000000-0000-0000-0000-000000000001',
      reference: 'CS-1',
    });
    id = result.id;
    expect(result.before).toBeNull();
    expect(result.after!.value).toEqual(laptopWorkflow());
    const [d] = await h.kernel.db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    // The first published form-submission workflow became the default automatically; the value says no.
    expect(d).toMatchObject({ publishedVersion: 1, isDefault: false });
    const audit = await h.kernel.db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(audit.map((a) => a.action).sort()).toEqual(
      expect.arrayContaining(['core.workflow-definition.created', 'core.workflow-definition.published']),
    );
    expect(
      audit.every((a) => (a.metadata as { source?: { reference?: string } }).source?.reference === 'CS-1'),
    ).toBe(true);
    expect(audit.every((a) => a.actorId === h.ids.admin)).toBe(true);
  });

  it('round-trips: applying get().value changes nothing and keeps the version', async () => {
    const before = (await cz().get('core.workflow', id, admin))!;
    const auditBefore = (await h.kernel.db.select({ n: count() }).from(auditLogs))[0]!.n;
    const result = await apply(
      'core.workflow',
      { op: 'update', id, value: before.value, baseVersion: before.version },
      admin,
    );
    expect(result.after!.version).toBe(before.version);
    const [d] = await h.kernel.db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    expect(d!.publishedVersion).toBe(1);
    expect((await h.kernel.db.select({ n: count() }).from(auditLogs))[0]!.n).toBe(auditBefore);
  });

  it('publishes a new version only when the graph changes, and refuses stale proposals', async () => {
    const before = (await cz().get('core.workflow', id, admin))!;
    const renamed = await apply(
      'core.workflow',
      {
        op: 'update',
        id,
        value: laptopWorkflow({ name: 'Laptop approval v2' }),
        baseVersion: before.version,
      },
      admin,
    );
    expect(renamed.after!.version).not.toBe(before.version);
    let [d] = await h.kernel.db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    expect(d).toMatchObject({ name: 'Laptop approval v2', publishedVersion: 1 });

    const graph = laptopGraph();
    (graph.steps[0] as { sla?: unknown }).sla = { dueHours: 48, remindHours: 24, onBreach: 'notify' };
    await apply(
      'core.workflow',
      { op: 'update', id, value: laptopWorkflow({ name: 'Laptop approval v2', graph }) },
      admin,
    );
    [d] = await h.kernel.db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    expect(d!.publishedVersion).toBe(2);

    // The proposal was made against the first version.
    await expect(
      apply(
        'core.workflow',
        { op: 'update', id, value: laptopWorkflow(), baseVersion: before.version },
        admin,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CHANGE_SET_STALE' });
  });

  it('keeps the trigger fixed, archives and restores', async () => {
    expect(
      await issueCodes('core.workflow', {
        op: 'update',
        id,
        value: laptopWorkflow({
          triggerKey: 'core.access-request',
          graph: { steps: [laptopGraph().steps[0]!] },
        }),
      }),
    ).toContain('immutable');
    const archived = await apply('core.workflow', { op: 'archive', id, value: null }, admin);
    expect(archived.after!.archived).toBe(true);
    expect(await cz().list('core.workflow', { q: 'Laptop approval v2' }, admin)).toEqual([]);
    expect(
      await cz().list('core.workflow', { q: 'Laptop approval v2', includeArchived: true }, admin),
    ).toHaveLength(1);
    const restored = await apply('core.workflow', { op: 'restore', id, value: null }, admin);
    expect(restored.after!.archived).toBe(false);
  });

  it('builds a valid workflow from the approval-chain template', async () => {
    const fields = await cz().templateFields('core.workflow', 'approval-chain', admin);
    expect(fields.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'trigger',
        'name',
        'firstApprover',
        'firstGroup',
        'secondGroup',
        'conditionAmount',
      ]),
    );
    expect(fields.find((f) => f.key === 'trigger')!.label).toMatchObject({ 'zh-TW': expect.any(String) });
    await expect(
      cz().buildTemplate('core.workflow', 'approval-chain', { trigger: 'core.form-submission' }, admin),
    ).rejects.toMatchObject({ statusCode: 422 });
    const built = await cz().buildTemplate(
      'core.workflow',
      'approval-chain',
      {
        trigger: 'core.form-submission',
        name: 'Monitor requests',
        firstApprover: 'department-head',
        secondStep: true,
        secondGroup: 'it-asset-management',
        onlyAbove: true,
        conditionFact: 'data.amount',
        conditionAmount: 10000,
      },
      admin,
    );
    expect(built.op).toBe('create');
    const graph = (built.value as { graph: WorkflowGraph }).graph;
    expect(graph.steps.map((s) => s.id)).toEqual(['department-head', 'second-approval']);
    expect(graph.steps[1]!.when).toEqual({ fact: 'data.amount', op: 'gt', value: 10000 });
    expect(graph.steps[0]!.name['zh-TW']).toBe('部門主管簽核');
    const validation = await cz().validate(
      'core.workflow',
      { op: 'create', id: null, value: built.value },
      admin,
    );
    expect(validation.issues).toEqual([]);
  });
});

describe('core.form', () => {
  let formId: string;
  let workflowId: string;

  it('creates a workflow and a form attached to it in one transaction', async () => {
    const ids = await h.kernel.db.transaction(async (tx) => {
      const opts = { auth: admin, tx: tx as unknown as Db };
      const wf = await cz().apply(
        'core.workflow',
        { op: 'create', id: null, value: laptopWorkflow({ name: 'Laptop form approval' }) },
        opts,
      );
      const form = await cz().apply('core.form', { op: 'create', id: null, value: laptopForm(wf.id) }, opts);
      expect(form.after!.value).toEqual(laptopForm(wf.id));
      return { wf: wf.id, form: form.id };
    });
    formId = ids.form;
    workflowId = ids.wf;
    const [f] = await h.kernel.db.select().from(forms).where(eq(forms.id, formId));
    expect(f).toMatchObject({ publishedVersion: 1, workflowDefinitionId: workflowId, active: true });
  });

  it('checks keys, workflows, groups and fields', async () => {
    expect(await issueCodes('core.form', { op: 'create', id: null, value: laptopForm(null) })).toEqual([
      'duplicate_key',
    ]);
    expect(
      await issueCodes('core.form', {
        op: 'update',
        id: formId,
        value: laptopForm(workflowId, { key: 'other-key' }),
      }),
    ).toEqual(['immutable']);
    const [accessDefault] = await h.kernel.db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.triggerKey, 'core.access-request'));
    expect(
      await issueCodes('core.form', {
        op: 'create',
        id: null,
        value: laptopForm(accessDefault!.id, {
          key: 'other-form',
          audience: { type: 'groups', groupKeys: ['nope'] },
          schema: { elements: [] },
        }),
      }),
    ).toEqual(['no_fields', 'workflow_trigger', 'unknown_group']);
  });

  it('publishes only when the questions change and round-trips', async () => {
    const before = (await cz().get('core.form', formId, admin))!;
    const same = await apply('core.form', { op: 'update', id: formId, value: before.value }, admin);
    expect(same.after!.version).toBe(before.version);
    await apply(
      'core.form',
      { op: 'update', id: formId, value: laptopForm(workflowId, { active: false, category: 'IT' }) },
      admin,
    );
    let [f] = await h.kernel.db.select().from(forms).where(eq(forms.id, formId));
    expect(f).toMatchObject({ publishedVersion: 1, active: false, category: 'IT' });
    const schema = laptopForm(null).schema;
    schema.elements.push({ id: 'note', key: 'note', type: 'text', label: name('Note'), required: false });
    await apply('core.form', { op: 'update', id: formId, value: laptopForm(workflowId, { schema }) }, admin);
    [f] = await h.kernel.db.select().from(forms).where(eq(forms.id, formId));
    expect(f!.publishedVersion).toBe(2);
  });

  it('archives and restores; a workflow in use cannot be archived', async () => {
    await expect(
      apply('core.workflow', { op: 'archive', id: workflowId, value: null }, admin),
    ).rejects.toMatchObject({
      code: 'IN_USE',
    });
    expect(
      (await apply('core.form', { op: 'archive', id: formId, value: null }, admin)).after!.archived,
    ).toBe(true);
    expect(
      (await apply('core.form', { op: 'restore', id: formId, value: null }, admin)).after!.archived,
    ).toBe(false);
  });

  it('builds a valid form from the request-form template', async () => {
    const fields = await cz().templateFields('core.form', 'request-form', admin);
    expect(fields.map((f) => f.key)).toContain('q3Options');
    const built = await cz().buildTemplate(
      'core.form',
      'request-form',
      {
        name: 'Monitor request',
        category: 'Hardware',
        workflow: workflowId,
        q1Label: 'Screen size',
        q1Type: 'select',
        q1Options: '24 inch\n27 inch\n27 inch',
        q1Required: true,
        q2Label: 'Needed by',
        q2Type: 'date',
      },
      admin,
    );
    const value = built.value as ReturnType<typeof laptopForm>;
    expect(value.key).toBe('monitor-request');
    expect(value.workflowId).toBe(workflowId);
    expect(value.schema.elements.map((e) => [e.key, e.type])).toEqual([
      ['screenSize', 'select'],
      ['neededBy', 'date'],
    ]);
    expect(await issueCodes('core.form', { op: 'create', id: null, value })).toEqual([]);
  });
});

describe('core.custom-field', () => {
  let id: string;
  const costCentre = {
    entityType: 'core.user',
    field: { key: 'costCentre', type: 'text', label: name('Cost centre') },
  };

  it('creates, updates, archives and restores', async () => {
    const created = await apply('core.custom-field', { op: 'create', id: null, value: costCentre }, admin);
    id = created.id;
    expect(created.after!.value).toEqual(costCentre);
    const updated = await apply(
      'core.custom-field',
      {
        op: 'update',
        id,
        value: { ...costCentre, field: { ...costCentre.field, required: true } },
        baseVersion: created.after!.version,
      },
      admin,
    );
    expect(updated.after!.value).toMatchObject({ field: { required: true } });
    const roundTrip = await apply(
      'core.custom-field',
      { op: 'update', id, value: updated.after!.value },
      admin,
    );
    expect(roundTrip.after!.version).toBe(updated.after!.version);
    expect(
      (await apply('core.custom-field', { op: 'archive', id, value: null }, admin)).after!.archived,
    ).toBe(true);
    expect(
      (await apply('core.custom-field', { op: 'restore', id, value: null }, admin)).after!.archived,
    ).toBe(false);
  });

  it('keeps entity, key and type fixed and keys unique', async () => {
    expect(await issueCodes('core.custom-field', { op: 'create', id: null, value: costCentre })).toEqual([
      'duplicate_key',
    ]);
    expect(
      await issueCodes('core.custom-field', {
        op: 'update',
        id,
        value: { entityType: 'core.group', field: { key: 'other', type: 'number', label: name('X') } },
      }),
    ).toEqual(['immutable', 'immutable', 'immutable']);
    expect(
      await issueCodes('core.custom-field', {
        op: 'create',
        id: null,
        value: { ...costCentre, entityType: 'core.nope' },
      }),
    ).toContain('unknown_entity');
  });

  it('builds a valid field from the template', async () => {
    const built = await cz().buildTemplate(
      'core.custom-field',
      'field',
      { entityType: 'core.user', label: 'Cost centre', type: 'select', options: 'Headquarters\nFactory' },
      admin,
    );
    // The key is taken by the field above.
    expect(built.value).toMatchObject({
      entityType: 'core.user',
      field: {
        key: 'costCentre2',
        type: 'select',
        options: [{ value: 'headquarters' }, { value: 'factory' }],
      },
    });
    expect(await issueCodes('core.custom-field', { op: 'create', id: null, value: built.value })).toEqual([]);
  });
});

describe('core.role', () => {
  let id: string;
  const role = {
    key: 'desk-lead',
    name: 'Desk lead',
    description: null,
    permissions: ['core.users.read', 'core.groups.read'],
  };

  it('creates, updates and deletes platform roles', async () => {
    const created = await apply('core.role', { op: 'create', id: null, value: role }, admin);
    id = created.id;
    expect(created.after!.value).toEqual({ ...role, permissions: ['core.groups.read', 'core.users.read'] });
    const same = await apply('core.role', { op: 'update', id, value: created.after!.value }, admin);
    expect(same.after!.version).toBe(created.after!.version);
    const updated = await apply(
      'core.role',
      {
        op: 'update',
        id,
        value: { ...role, permissions: ['core.users.read'] },
        baseVersion: created.after!.version,
      },
      admin,
    );
    expect(updated.after!.value).toMatchObject({ permissions: ['core.users.read'] });
    const deleted = await apply('core.role', { op: 'delete', id, value: null }, admin);
    expect(deleted.after).toBeNull();
  });

  it('checks keys and permissions; system roles stay read-only', async () => {
    const [admins] = await h.kernel.db.select().from(roles).where(eq(roles.key, 'platform-admin'));
    expect(
      await issueCodes('core.role', {
        op: 'create',
        id: null,
        value: { ...role, key: 'platform-admin', permissions: ['nope.things.read'] },
      }),
    ).toEqual(['duplicate_key', 'unknown_permission']);
    const current = (await cz().get('core.role', admins!.id, admin))!;
    expect(
      await issueCodes('core.role', {
        op: 'update',
        id: admins!.id,
        value: { ...(current.value as object), key: 'other-key' },
      }),
    ).toEqual(['immutable']);
    await expect(
      apply(
        'core.role',
        { op: 'update', id: admins!.id, value: { ...(current.value as object), name: 'Renamed' } },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'SYSTEM_ROLE_READONLY' });
  });

  it('keeps the privilege-escalation guard, also in dry runs', async () => {
    // The role manager holds core.roles.* only.
    await expect(
      apply('core.role', { op: 'create', id: null, value: { ...role, key: 'escalate' } }, roleManager),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PRIVILEGE_ESCALATION' });
    const ok = await apply(
      'core.role',
      { op: 'create', id: null, value: { ...role, key: 'role-readers', permissions: ['core.roles.read'] } },
      roleManager,
    );
    expect(ok.after).not.toBeNull();
    // hr cannot apply roles at all; a dry run assumes core.roles.manage but still checks what hr holds.
    await expect(
      rolledBack((tx) =>
        cz().apply(
          'core.role',
          { op: 'create', id: null, value: { ...role, key: 'dry' } },
          { auth: hr, tx, dryRun: true },
        ),
      ),
    ).rejects.toMatchObject({ code: 'PRIVILEGE_ESCALATION' });
  });
});

describe('core.notification-channel', () => {
  let id: string;
  const url = 'https://hooks.example.com/services/T000/B000/very-secret-token';

  beforeAll(async () => {
    const [c] = await h.kernel.db
      .insert(notificationChannels)
      .values({
        name: 'Service desk',
        type: 'teams',
        locale: 'en',
        types: ['core.approval.*'],
        host: 'hooks.example.com',
        secrets: h.kernel.box.encryptJson({ url, signingSecret: 'whsec_test' }),
      })
      .returning();
    id = c!.id;
  });

  it('never exposes or accepts the address and secrets', async () => {
    const obj = (await cz().get('core.notification-channel', id, admin))!;
    expect(obj.value).toEqual({
      name: 'Service desk',
      locale: 'en',
      types: ['core.approval.*'],
      enabled: true,
    });
    const all = JSON.stringify([obj, await cz().list('core.notification-channel', {}, admin)]);
    expect(all).not.toContain('very-secret-token');
    expect(all).not.toContain('whsec');
    const { schema } = await cz().describe('core.notification-channel', admin);
    expect(Object.keys(schema.properties as object).sort()).toEqual(['enabled', 'locale', 'name', 'types']);
    const withUrl = await cz().validate(
      'core.notification-channel',
      { op: 'update', id, value: { ...(obj.value as object), url: 'https://evil.example.com' } },
      admin,
    );
    expect(withUrl.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(
      await issueCodes('core.notification-channel', { op: 'create', id: null, value: obj.value }),
    ).toContain('operation');
  });

  it('updates what the channel receives and keeps its address', async () => {
    expect(
      await issueCodes('core.notification-channel', {
        op: 'update',
        id,
        value: { name: 'Desk', locale: 'ja-JP', types: ['nope.*'], enabled: true },
      }),
    ).toEqual(['unknown_type']);
    const result = await apply(
      'core.notification-channel',
      {
        op: 'update',
        id,
        value: {
          name: 'Desk',
          locale: 'ja-JP',
          types: ['core.approval.*', 'core.access-request.*'],
          enabled: false,
        },
      },
      admin,
    );
    expect(result.after!.value).toMatchObject({ locale: 'ja-JP', enabled: false });
    const [c] = await h.kernel.db.select().from(notificationChannels).where(eq(notificationChannels.id, id));
    expect(h.kernel.box.decryptJson(c!.secrets)).toEqual({ url, signingSecret: 'whsec_test' });
  });
});

describe('core.module-settings', () => {
  it('never exposes secrets or the AI provider settings', async () => {
    const core = (await cz().get('core.module-settings', 'core', admin))!;
    const keys = Object.keys((core.value as { values: Record<string, unknown> }).values);
    expect(keys).toContain('branding.productName');
    expect(keys).toContain('notifications.email.host');
    expect(keys).not.toContain('notifications.email.password');
    expect(keys.filter((k) => k.startsWith('ai.'))).toEqual([]);
    const { guide } = await cz().describe('core.module-settings', admin);
    const text = JSON.stringify(guide.reference);
    expect(text).not.toContain('notifications.email.password');
    expect(text).not.toContain('ai.chat');
    expect((await cz().list('core.module-settings', {}, admin)).map((m) => m.id)).toContain('core');
  });

  it('refuses secret, AI, unknown and mistyped settings', async () => {
    const issues = await cz().validate(
      'core.module-settings',
      {
        op: 'update',
        id: 'core',
        value: {
          values: {
            'ai.chat.provider': 'anthropic',
            'notifications.email.password': 'x',
            'nope.setting': 1,
            'notifications.retentionDays': 'many',
          },
        },
      },
      admin,
    );
    expect(issues.issues.map((i) => [i.path, i.code])).toEqual([
      ['values.ai.chat.provider', 'not_editable'],
      ['values.notifications.email.password', 'not_editable'],
      ['values.nope.setting', 'unknown_setting'],
      ['values.notifications.retentionDays', 'invalid_type'],
    ]);
  });

  it('updates settings live and round-trips', async () => {
    const before = (await cz().get('core.module-settings', 'core', admin))!;
    const result = await apply(
      'core.module-settings',
      {
        op: 'update',
        id: 'core',
        value: { values: { 'branding.productName': 'Contoso IT' } },
        baseVersion: before.version,
      },
      admin,
    );
    expect(result.after!.value).toMatchObject({ values: { 'branding.productName': 'Contoso IT' } });
    expect(await h.kernel.registry.context('core').settings.get('branding.productName')).toBe('Contoso IT');
    const again = await apply(
      'core.module-settings',
      { op: 'update', id: 'core', value: result.after!.value },
      admin,
    );
    expect(again.after!.version).toBe(result.after!.version);
  });
});

describe('dry runs', () => {
  it('leave nothing behind: no rows, versions, audit entries, outbox events or settings', async () => {
    const [channel] = await h.kernel.db.select().from(notificationChannels);
    const [someRole] = await h.kernel.db.select().from(roles).where(eq(roles.key, 'role-readers'));
    const before = await footprint();
    const settingBefore = await h.kernel.registry.context('core').settings.get('branding.productName');
    const results = await rolledBack(async (tx) => {
      const opts = {
        auth: hr,
        tx,
        dryRun: true,
        source: { type: 'change-set', id: 'dry', reference: 'CS-9' },
      };
      const wf = await cz().apply(
        'core.workflow',
        { op: 'create', id: null, value: laptopWorkflow({ name: 'Dry workflow' }) },
        opts,
      );
      const form = await cz().apply(
        'core.form',
        { op: 'create', id: null, value: laptopForm(wf.id, { key: 'dry-form' }) },
        opts,
      );
      const field = await cz().apply(
        'core.custom-field',
        {
          op: 'create',
          id: null,
          value: { entityType: 'core.group', field: { key: 'dry', type: 'text', label: name('Dry') } },
        },
        opts,
      );
      const role = await cz().apply(
        'core.role',
        {
          op: 'update',
          id: someRole!.id,
          value: { key: 'role-readers', name: 'Dry name', description: null, permissions: [] },
        },
        { ...opts, auth: admin },
      );
      const channelResult = await cz().apply(
        'core.notification-channel',
        { op: 'update', id: channel!.id, value: { name: 'Dry', locale: 'en', types: ['*'], enabled: true } },
        { ...opts, auth: admin },
      );
      const settings = await cz().apply(
        'core.module-settings',
        { op: 'update', id: 'core', value: { values: { 'branding.productName': 'Dry run' } } },
        { ...opts, auth: admin },
      );
      // Inside the transaction everything is visible, including the dry-run audit entries.
      const audit = await tx
        .select()
        .from(auditLogs)
        .where(sql`${auditLogs.metadata}->'source'->>'reference' = 'CS-9'`);
      return { wf, form, field, role, channelResult, settings, audit };
    });
    expect(results.wf.after!.value).toMatchObject({ name: 'Dry workflow' });
    expect(results.form.after!.value).toMatchObject({ key: 'dry-form', workflowId: results.wf.id });
    expect(results.settings.after!.value).toMatchObject({ values: { 'branding.productName': 'Dry run' } });
    expect(results.audit.length).toBeGreaterThan(5);
    expect(await footprint()).toEqual(before);
    expect(await cz().get('core.workflow', results.wf.id, admin)).toBeNull();
    expect(await cz().get('core.form', results.form.id, admin)).toBeNull();
    expect(await cz().get('core.custom-field', results.field.id, admin)).toBeNull();
    expect(await h.kernel.registry.context('core').settings.get('branding.productName')).toBe(settingBefore);
  });

  it('are the only way a proposer without the apply permission gets that far', async () => {
    expect(hr.can('core.workflows.manage')).toBe(false);
    await expect(
      apply('core.workflow', { op: 'create', id: null, value: laptopWorkflow({ name: 'Not allowed' }) }, hr),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('read-only AI tools', () => {
  const tools = () => h.kernel.registry.context('core').ai.tools;

  it('finds groups, roles and departments', async () => {
    const found = await tools().invoke<{ key: string; memberCount: number }[]>(
      'core.find_groups',
      { query: 'asset' },
      { auth: admin },
    );
    expect(found).toEqual([expect.objectContaining({ key: 'it-asset-management', memberCount: 1 })]);
    const rolesFound = await tools().invoke<{
      roles: { key: string; permissions: string[] }[];
      permissions?: unknown[];
    }>('core.find_roles', { query: 'configuration', includePermissionCatalog: true }, { auth: admin });
    expect(rolesFound.roles).toEqual([
      expect.objectContaining({
        key: 'configuration-viewer',
        permissions: expect.arrayContaining(['core.forms.read']),
      }),
    ]);
    expect(rolesFound.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'core.mcp.use', description: expect.stringContaining('MCP') }),
      ]),
    );
    const departments = await tools().invoke<{ code: string; path: string }[]>(
      'core.find_departments',
      { query: 'sales-tpe' },
      { auth: outsider },
    );
    expect(departments).toEqual([expect.objectContaining({ code: 'SALES-TPE', path: 'SALES / SALES-TPE' })]);
    await expect(tools().invoke('core.find_groups', {}, { auth: outsider })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(
      tools()
        .list(admin)
        .filter((t) => t.name.startsWith('core.find_'))
        .every((t) => t.readOnly),
    ).toBe(true);
  });
});
