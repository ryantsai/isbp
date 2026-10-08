import { auditLogs, groups, users } from '@isbp/db/schema';
import {
  type ChangeSetPackage,
  type CustomizationHandler,
  defineManifest,
  defineServerModule,
  type Locale,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';

/*
 * Change-set packages: a change set exported as a file and imported as a new draft (references and all), imports
 * refused as a whole (modules or kinds this platform lacks, unknown references, missing targets, kinds the person
 * can't read), and built-in packages a module ships: listed with what they need, installed as a draft that dry-runs,
 * applies and rolls back like any change set. A test module provides two kinds and two packages; the packages also
 * create a core group, so the `core.group` kind takes part.
 */

const A = '/api/v1/assistant';
let h: Harness;
let admin: Session;
let author: Session;
let limited: Session;

/* ───────────── a test module with two kinds and two packages ───────────── */

type WidgetRow = { id: string; name: string; color: string; archived: boolean };

const widgetValue = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.enum(['red', 'green', 'blue']).default('red'),
});
const gadgetValue = z.object({ name: z.string().trim().min(1).max(100), widgetId: z.uuid() });

async function widgetById(ctx: ModuleContext, id: string) {
  const { rows } = await ctx.db.execute<WidgetRow>(
    sql`select id, name, color, archived from itest_pack.widgets where id::text = ${id}`,
  );
  return rows[0] ?? null;
}

const widgetKind: CustomizationHandler<z.infer<typeof widgetValue>> = {
  schema: widgetValue,
  guide: async () => ({ instructions: 'Widgets have a unique name and a colour.' }),
  list: async () => [],
  get: async (id, ctx) => {
    const r = await widgetById(ctx, id);
    return r
      ? { id: r.id, label: r.name, archived: r.archived, value: { name: r.name, color: r.color as 'red' } }
      : null;
  },
  check: async (change, ctx) => {
    if (!change.value) return [];
    const { rows } = await ctx.db.execute<{ id: string }>(
      sql`select id from itest_pack.widgets where lower(name) = lower(${change.value.name})`,
    );
    return rows.some((r) => r.id !== change.id)
      ? [{ path: 'name', message: 'Another widget has this name', code: 'duplicate' }]
      : [];
  },
  apply: async (change, ctx) => {
    if (change.op === 'create') {
      const { rows } = await ctx.db.execute<{ id: string }>(
        sql`insert into itest_pack.widgets (name, color) values (${change.value!.name}, ${change.value!.color}) returning id`,
      );
      return { id: rows[0]!.id };
    }
    if (change.op === 'update')
      await ctx.db.execute(
        sql`update itest_pack.widgets set name = ${change.value!.name}, color = ${change.value!.color} where id = ${change.id}`,
      );
    else
      await ctx.db.execute(
        sql`update itest_pack.widgets set archived = ${change.op === 'archive'} where id = ${change.id}`,
      );
    return { id: change.id! };
  },
};

const gadgetKind: CustomizationHandler<z.infer<typeof gadgetValue>> = {
  schema: gadgetValue,
  guide: async () => ({ instructions: 'A gadget belongs to a widget.' }),
  list: async () => [],
  get: async (id, ctx) => {
    const { rows } = await ctx.db.execute<{ id: string; name: string; widget_id: string }>(
      sql`select id, name, widget_id from itest_pack.gadgets where id::text = ${id}`,
    );
    const r = rows[0];
    return r ? { id: r.id, label: r.name, value: { name: r.name, widgetId: r.widget_id } } : null;
  },
  check: async (change, ctx) =>
    change.value && !(await widgetById(ctx, change.value.widgetId))
      ? [{ path: 'widgetId', message: 'No such widget', code: 'unknown_widget' }]
      : [],
  apply: async (change, ctx) => {
    if (change.op === 'create') {
      const { rows } = await ctx.db.execute<{ id: string }>(
        sql`insert into itest_pack.gadgets (name, widget_id) values (${change.value!.name}, ${change.value!.widgetId}) returning id`,
      );
      return { id: rows[0]!.id };
    }
    if (change.op === 'update')
      await ctx.db.execute(
        sql`update itest_pack.gadgets set name = ${change.value!.name}, widget_id = ${change.value!.widgetId} where id = ${change.id}`,
      );
    else await ctx.db.execute(sql`delete from itest_pack.gadgets where id = ${change.id}`);
    return { id: change.id! };
  },
};

/**
 * A group the widgets' reviewers belong to (named in the installer's language: a group's name is plain text), a widget
 * and its gadget (which refers to the widget).
 */
const starter = ({ locale }: { locale: Locale }): ChangeSetPackage => ({
  format: 'isbp.change-set-package',
  version: 1,
  key: 'itest-starter',
  title: { en: 'Starter kit', 'zh-TW': '入門套件', 'ja-JP': 'スターター キット' },
  summary: { en: 'A reviewers group, a widget and its gadget' },
  items: [
    {
      ref: 'reviewers',
      kind: 'core.group',
      op: 'create',
      value: {
        key: 'pack-reviewers',
        name: locale === 'zh-TW' ? '套件審核人員' : 'Pack reviewers',
        description: 'Review what the kit made',
      },
    },
    {
      ref: 'widget',
      kind: 'itest-pack.widget',
      op: 'create',
      value: { name: 'Starter widget', color: 'green' },
    },
    {
      ref: 'gadget',
      kind: 'itest-pack.gadget',
      op: 'create',
      label: 'The starter gadget',
      value: { name: 'Starter gadget', widgetId: '$ref:widget' },
    },
  ],
});

const needsMore: ChangeSetPackage = {
  format: 'isbp.change-set-package',
  version: 1,
  title: { en: 'Needs more' },
  requires: { modules: ['no-such-module'] },
  items: [{ kind: 'itest-pack.widget', op: 'create', value: { name: 'Never', color: 'red' } }],
};

const packModule = defineServerModule(
  defineManifest({
    id: 'itest-pack',
    version: '1.0.0',
    name: 'Test packages',
    permissions: [
      { key: 'itest-pack.config.read', description: 'Read' },
      { key: 'itest-pack.config.manage', description: 'Manage' },
    ],
    customizations: [
      {
        kind: 'widget',
        label: 'itest-pack.kinds.widget',
        description: 'A widget with a unique name and a colour',
        readPermission: 'itest-pack.config.read',
        applyPermission: 'itest-pack.config.manage',
        operations: ['create', 'update', 'archive'],
      },
      {
        kind: 'gadget',
        label: 'itest-pack.kinds.gadget',
        description: 'A gadget that belongs to a widget',
        readPermission: 'itest-pack.config.read',
        applyPermission: 'itest-pack.config.manage',
        operations: ['create', 'update', 'delete'],
      },
    ],
    customizationPackages: [
      {
        key: 'starter',
        name: 'itest-pack.packages.starter.name',
        description: 'itest-pack.packages.starter.description',
        icon: 'package',
      },
      {
        key: 'needs-more',
        name: 'itest-pack.packages.needsMore.name',
        description: 'itest-pack.packages.needsMore.description',
      },
    ],
  }),
  {
    migrations: [
      {
        tag: '0000_init',
        hash: 'itest-pack-0',
        sql: `create schema "itest_pack";
--> statement-breakpoint
create table itest_pack.widgets (id uuid primary key default gen_random_uuid(), name text not null unique, color text not null, archived boolean not null default false);
--> statement-breakpoint
create table itest_pack.gadgets (id uuid primary key default gen_random_uuid(), name text not null, widget_id uuid not null references itest_pack.widgets(id));`,
      },
    ],
    customizations: { widget: widgetKind, gadget: gadgetKind },
    customizationPackages: { starter, 'needs-more': async () => needsMore },
  },
);

const widgets = async () =>
  (
    await h.kernel.db.execute<WidgetRow>(
      sql`select id, name, color, archived from itest_pack.widgets order by name`,
    )
  ).rows;
const gadgets = async () =>
  (
    await h.kernel.db.execute<{ id: string; name: string; widget_id: string }>(
      sql`select id, name, widget_id from itest_pack.gadgets order by name`,
    )
  ).rows;
const changeSetCount = async () =>
  (await h.kernel.db.execute<{ n: number }>(sql`select count(*)::int as n from assistant.change_sets`))
    .rows[0]!.n;

async function grant(userId: string, key: string, permissions: string[]) {
  const role = await h.call(admin, 'POST', '/api/v1/roles', { key, name: key, permissions });
  expect(role.status).toBe(201);
  const assigned = await h.call(admin, 'POST', '/api/v1/role-assignments', {
    roleId: role.body.id,
    principalType: 'user',
    principalId: userId,
    scopeType: 'global',
  });
  expect(assigned.status).toBe(201);
}

/** The raw response (headers too). */
const raw = (session: Session, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  h.app.inject({
    method,
    url,
    payload: payload as object | undefined,
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
  });

const pkg = (items: LooseJson[], extra: Record<string, unknown> = {}) => ({
  format: 'isbp.change-set-package',
  version: 1,
  title: { en: 'Test package' },
  items,
  ...extra,
});

beforeAll(async () => {
  h = await createHarness({ extraModules: [packModule] });
  admin = await h.login('admin');
  // hr reads the test kinds (and groups, as a department-scoped identity administrator), applies nothing globally.
  await grant(h.ids.hr, 'pack-author', ['assistant.agent.use', 'itest-pack.config.read']);
  await h.kernel.db.update(users).set({ locale: 'zh-TW' }).where(eq(users.id, h.ids.hr));
  author = await h.login('hr');
  // outsider reads the test kinds but not groups.
  await grant(h.ids.outsider, 'pack-limited', ['assistant.agent.use', 'itest-pack.config.read']);
  limited = await h.login('outsider');
});

afterAll(async () => {
  await h?.close();
});

/* ───────────── export and import ───────────── */

describe('export and import', () => {
  it('exports a change set as a package and imports it as a new draft, references and all', async () => {
    await h.kernel.db.execute(sql`insert into itest_pack.widgets (name, color) values ('Existing', 'red')`);
    const [existing] = await widgets();
    const created = await h.call(admin, 'POST', `${A}/change-sets`, {
      title: 'Round trip',
      summary: 'Export me',
    });
    const original = created.body.id as string;
    for (const item of [
      { ref: 'blue', kind: 'itest-pack.widget', op: 'create', value: { name: 'Blue', color: 'blue' } },
      {
        ref: 'gizmo',
        kind: 'itest-pack.gadget',
        op: 'create',
        value: { name: 'Gizmo', widgetId: '$ref:blue' },
      },
      {
        kind: 'itest-pack.widget',
        op: 'update',
        targetId: existing!.id,
        value: { name: 'Existing', color: 'blue' },
        note: 'Recolour',
      },
    ])
      expect((await h.call(admin, 'POST', `${A}/change-sets/${original}/items`, item)).status).toBe(200);

    const exported = await raw(admin, 'GET', `${A}/change-sets/${original}/export`);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toBe(
      `attachment; filename="${created.body.reference}.json"`,
    );
    const file = exported.json() as LooseJson;
    const text = (s: string) => ({ en: s, 'zh-TW': s, 'ja-JP': s });
    expect(file).toEqual({
      format: 'isbp.change-set-package',
      version: 1,
      title: text('Round trip'),
      summary: text('Export me'),
      items: [
        {
          ref: 'blue',
          kind: 'itest-pack.widget',
          op: 'create',
          label: 'Blue',
          value: { name: 'Blue', color: 'blue' },
        },
        {
          ref: 'gizmo',
          kind: 'itest-pack.gadget',
          op: 'create',
          label: 'Gizmo',
          value: { name: 'Gizmo', widgetId: '$ref:blue' },
        },
        {
          kind: 'itest-pack.widget',
          op: 'update',
          targetId: existing!.id,
          label: 'Existing',
          value: { name: 'Existing', color: 'blue' },
          note: 'Recolour',
        },
      ],
    });

    const imported = await h.call(admin, 'POST', `${A}/change-sets/import`, file);
    expect(imported.status).toBe(201);
    const copy = imported.body;
    expect(copy.id).not.toBe(original);
    expect(copy).toMatchObject({ title: 'Round trip', summary: 'Export me', status: 'draft', ready: true });
    expect(copy.items.map((i: LooseJson) => [i.ref, i.kind, i.op, i.targetId, i.label, i.check.ok])).toEqual([
      ['blue', 'itest-pack.widget', 'create', null, 'Blue', true],
      ['gizmo', 'itest-pack.gadget', 'create', null, 'Gizmo', true],
      [null, 'itest-pack.widget', 'update', existing!.id, 'Existing', true],
    ]);
    expect(copy.items[1].value).toEqual({ name: 'Gizmo', widgetId: '$ref:blue' });
    expect(copy.items[2]).toMatchObject({ note: 'Recolour', stale: false, baseVersion: expect.any(String) });
    // Only the dry run ran: nothing exists yet.
    expect((await widgets()).map((w) => [w.name, w.color])).toEqual([['Existing', 'red']]);

    const [audit] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'assistant.change-set.created'), eq(auditLogs.entityId, copy.id)));
    expect(audit!.metadata).toMatchObject({ from: { type: 'file' }, items: 3 });

    const applied = await h.call(admin, 'POST', `${A}/change-sets/${copy.id}/apply`, {});
    expect(applied.status).toBe(200);
    const after = await widgets();
    expect(after.map((w) => [w.name, w.color])).toEqual([
      ['Blue', 'blue'],
      ['Existing', 'blue'],
    ]);
    expect((await gadgets()).map((g) => [g.name, g.widget_id])).toEqual([['Gizmo', after[0]!.id]]);
    // The original is untouched (still a draft, and now stale for the widget it updates).
    const first = (await h.call(admin, 'GET', `${A}/change-sets/${original}`)).body;
    expect(first.status).toBe('draft');
    expect(first.items[2].stale).toBe(true);
    await h.call(admin, 'POST', `${A}/change-sets/${original}/discard`);
  });

  it('refuses packages for modules or kinds this platform lacks, and creates nothing', async () => {
    const before = await changeSetCount();
    const unknownKind = await h.call(
      admin,
      'POST',
      `${A}/change-sets/import`,
      pkg([
        { kind: 'itest-pack.widget', op: 'create', value: { name: 'X' } },
        { kind: 'itest-pack.nope', op: 'create', value: {} },
      ]),
    );
    expect(unknownKind.status).toBe(400);
    expect(unknownKind.body.error).toMatchObject({
      code: 'PACKAGE_UNSUPPORTED',
      details: { missingModules: [], unknownKinds: ['itest-pack.nope'] },
    });
    const missing = await h.call(
      admin,
      'POST',
      `${A}/change-sets/import`,
      pkg([{ kind: 'nomod.thing', op: 'create', value: {} }], { requires: { modules: ['also-missing'] } }),
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error.details).toEqual({
      missingModules: ['also-missing', 'nomod'],
      unknownKinds: [],
    });

    // Kinds the person can't read: they couldn't propose them one by one either.
    const unreadable = await h.call(
      limited,
      'POST',
      `${A}/change-sets/import`,
      pkg([{ kind: 'core.group', op: 'create', value: { key: 'nope', name: 'Nope' } }]),
    );
    expect(unreadable.status).toBe(403);
    expect(unreadable.body.error.details).toMatchObject({ permissions: ['core.groups.read'] });
    expect(await changeSetCount()).toBe(before);
  });

  it('checks every item like a proposal and lists the problems, creating nothing', async () => {
    const before = await changeSetCount();
    const bad = await h.call(
      admin,
      'POST',
      `${A}/change-sets/import`,
      pkg([
        { ref: 'g', kind: 'itest-pack.gadget', op: 'create', value: { name: 'Early', widgetId: '$ref:w' } },
        { ref: 'w', kind: 'itest-pack.widget', op: 'create', value: { name: 'Late' } },
        { ref: 'w', kind: 'itest-pack.widget', op: 'create', value: { name: 'Again' } },
        { kind: 'itest-pack.widget', op: 'update', value: { name: 'No target' } },
        {
          kind: 'itest-pack.widget',
          op: 'update',
          targetId: '0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d01',
          value: { name: 'Gone' },
        },
        { kind: 'itest-pack.gadget', op: 'archive', targetId: '$ref:g' },
      ]),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.details.issues.map((i: LooseJson) => [i.path, i.code])).toEqual([
      ['items.0.value', 'unknown_ref'],
      ['items.2.ref', 'duplicate_ref'],
      ['items.3.targetId', 'required'],
      ['items.4.targetId', 'not_found'],
      ['items.5.op', 'operation'],
    ]);

    // The format itself: version, unknown fields, the number of items.
    for (const body of [
      { ...pkg([{ kind: 'itest-pack.widget', op: 'create', value: { name: 'A' } }]), version: 2 },
      { ...pkg([{ kind: 'itest-pack.widget', op: 'create', value: { name: 'A' } }]), extra: true },
      pkg([{ kind: 'itest-pack.widget', op: 'create', values: { name: 'Typo' } }]),
      pkg([]),
      pkg(
        Array.from({ length: 301 }, (_, i) => ({
          kind: 'itest-pack.widget',
          op: 'create',
          value: { name: `W${i}` },
        })),
      ),
      { ...pkg([{ kind: 'itest-pack.widget', op: 'create', value: { name: 'A' } }]), title: {} },
    ]) {
      const res = await h.call(admin, 'POST', `${A}/change-sets/import`, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(await changeSetCount()).toBe(before);
  });

  it('takes packages over the 1 MB default (up to 4 MB) and exports only change sets with changes', async () => {
    const big = pkg([
      // The kind's schema drops what it doesn't know: the dry run passes.
      {
        kind: 'itest-pack.widget',
        op: 'create',
        value: { name: 'Big', color: 'red', blob: 'x'.repeat(1_500_000) },
      },
    ]);
    const res = await h.call(admin, 'POST', `${A}/change-sets/import`, big);
    expect(res.status).toBe(201);
    expect(res.body.ready).toBe(true);
    await h.call(admin, 'POST', `${A}/change-sets/${res.body.id}/discard`);

    const tooBig = await h.call(admin, 'POST', `${A}/change-sets/import`, {
      ...big,
      summary: { en: 'y'.repeat(10) },
      items: [{ ...big.items[0], value: { name: 'Bigger', blob: 'x'.repeat(4_300_000) } }],
    });
    expect(tooBig.status).toBe(413);

    const empty = await h.call(admin, 'POST', `${A}/change-sets`, {});
    expect((await h.call(admin, 'GET', `${A}/change-sets/${empty.body.id}/export`)).status).toBe(422);
    // Only people who see a change set may export it.
    expect((await h.call(limited, 'GET', `${A}/change-sets/${empty.body.id}/export`)).status).toBe(404);
  });
});

/* ───────────── built-in packages ───────────── */

describe('built-in packages', () => {
  const find = (body: LooseJson, key: string) =>
    (body.items as LooseJson[]).find((p) => p.moduleId === 'itest-pack' && p.key === key);

  it('lists the packages of enabled modules, with what each needs and whether the viewer may install it', async () => {
    const forAdmin = (await h.call(admin, 'GET', `${A}/packages`)).body;
    expect(find(forAdmin, 'starter')).toEqual({
      key: 'starter',
      moduleId: 'itest-pack',
      name: 'itest-pack.packages.starter.name',
      description: 'itest-pack.packages.starter.description',
      icon: 'package',
      itemCount: 3,
      kinds: ['core.group', 'itest-pack.gadget', 'itest-pack.widget'],
      requirements: {
        missingModules: [],
        unknownKinds: [],
        unreadableKinds: [],
        unsupported: [],
        missingApplyPermissions: [],
      },
      canPropose: true,
      canApply: true,
    });
    expect(find(forAdmin, 'needs-more')).toMatchObject({
      canPropose: false,
      canApply: false,
      requirements: { missingModules: ['no-such-module'] },
    });

    const forAuthor = (await h.call(author, 'GET', `${A}/packages`)).body;
    expect(find(forAuthor, 'starter')).toMatchObject({
      canPropose: true,
      canApply: false,
      requirements: { missingApplyPermissions: ['core.groups.manage', 'itest-pack.config.manage'] },
    });
    const forLimited = (await h.call(limited, 'GET', `${A}/packages`)).body;
    expect(find(forLimited, 'starter')).toMatchObject({
      canPropose: false,
      requirements: { unreadableKinds: [{ kind: 'core.group', permission: 'core.groups.read' }] },
    });
    expect((await h.call(null, 'GET', `${A}/packages`)).status).toBe(401);
  });

  it('lets people who can’t apply prepare it (in their language), and refuses what they can’t propose', async () => {
    const prepared = await h.call(author, 'POST', `${A}/packages/itest-pack/starter/install`, {});
    expect(prepared.status).toBe(201);
    expect(prepared.body).toMatchObject({ title: '入門套件', ready: true });
    expect(prepared.body.items[0]).toMatchObject({ label: '套件審核人員', value: { name: '套件審核人員' } });
    expect(prepared.body.permissions).toMatchObject({
      canApply: false,
      canSubmit: true,
      missing: expect.arrayContaining(['itest-pack.config.manage']),
    });
    await h.call(author, 'POST', `${A}/change-sets/${prepared.body.id}/discard`);

    const before = await changeSetCount();
    const forbidden = await h.call(limited, 'POST', `${A}/packages/itest-pack/starter/install`, {});
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.details).toMatchObject({ permissions: ['core.groups.read'] });
    const unsupported = await h.call(admin, 'POST', `${A}/packages/itest-pack/needs-more/install`, {});
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error).toMatchObject({
      code: 'PACKAGE_UNSUPPORTED',
      details: { missingModules: ['no-such-module'] },
    });
    expect((await h.call(admin, 'POST', `${A}/packages/itest-pack/nope/install`, {})).status).toBe(404);
    expect(await changeSetCount()).toBe(before);
  });

  it('installs a package as a draft change set that dry-runs, applies and rolls back', async () => {
    const installed = await h.call(admin, 'POST', `${A}/packages/itest-pack/starter/install`, {});
    expect(installed.status).toBe(201);
    const set = installed.body;
    expect(set).toMatchObject({
      title: 'Starter kit',
      summary: 'A reviewers group, a widget and its gadget',
      status: 'draft',
      ready: true,
      kinds: ['core.group', 'itest-pack.widget', 'itest-pack.gadget'],
    });
    expect(set.items.map((i: LooseJson) => [i.ref, i.label])).toEqual([
      ['reviewers', 'Pack reviewers'],
      ['widget', 'Starter widget'],
      ['gadget', 'The starter gadget'],
    ]);
    expect(await h.kernel.db.select().from(groups).where(eq(groups.key, 'pack-reviewers'))).toEqual([]);
    const [audit] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'assistant.change-set.created'), eq(auditLogs.entityId, set.id)));
    expect(audit!.metadata).toMatchObject({
      from: { type: 'package', moduleId: 'itest-pack', key: 'starter', packageKey: 'itest-starter' },
    });

    const applied = await h.call(admin, 'POST', `${A}/change-sets/${set.id}/apply`, {});
    expect(applied.status).toBe(200);
    const [group] = await h.kernel.db.select().from(groups).where(eq(groups.key, 'pack-reviewers'));
    expect(group).toMatchObject({ name: 'Pack reviewers', description: 'Review what the kit made' });
    const widget = (await widgets()).find((w) => w.name === 'Starter widget')!;
    expect(widget).toMatchObject({ color: 'green', archived: false });
    expect((await gadgets()).find((g) => g.name === 'Starter gadget')!.widget_id).toBe(widget.id);

    const rolled = await h.call(admin, 'POST', `${A}/change-sets/${set.id}/rollback`, { confirm: true });
    expect(rolled.status).toBe(200);
    expect(rolled.body.status).toBe('rolled_back');
    // The group and the gadget are deleted (their kinds delete); the widget is archived (its kind can't).
    expect(await h.kernel.db.select().from(groups).where(eq(groups.key, 'pack-reviewers'))).toEqual([]);
    expect((await gadgets()).some((g) => g.name === 'Starter gadget')).toBe(false);
    expect((await widgets()).find((w) => w.name === 'Starter widget')!.archived).toBe(true);
  });

  it('hides the packages of disabled modules', async () => {
    const off = await h.call(admin, 'POST', '/api/v1/modules/itest-pack/toggle', { enabled: false });
    expect(off.status).toBe(200);
    try {
      const list = (await h.call(admin, 'GET', `${A}/packages`)).body;
      expect(find(list, 'starter')).toBeUndefined();
      expect((await h.call(admin, 'POST', `${A}/packages/itest-pack/starter/install`, {})).status).toBe(404);
    } finally {
      await h.call(admin, 'POST', '/api/v1/modules/itest-pack/toggle', { enabled: true });
    }
  });
});
