import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { auditLogs, users } from '@isbp/db/schema';
import { ChangeSetService } from '@isbp/module-assistant/server';
import {
  type CustomizationHandler,
  defineManifest,
  defineServerModule,
  ErrorCodes,
  HttpError,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/*
 * Phase 6: change sets (proposals, dry runs, references, apply, staleness, review applied as the approver,
 * rollback), the assistant's chat loop with a scripted model, and the MCP server. A test module provides two
 * customisation kinds backed by its own tables, so these tests don't depend on any real surface.
 */

const A = '/api/v1/assistant';
let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
let author: Session;
let outsider: Session;

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/* ───────────── a test module with two kinds ───────────── */

type WidgetRow = {
  id: string;
  name: string;
  color: string;
  archived: boolean;
};

const widgetValue = z.object({
  name: z.string().trim().min(1).max(100).describe('Unique name'),
  color: z.enum(['red', 'green', 'blue']).default('red').describe('Colour'),
});
const gadgetValue = z.object({
  name: z.string().trim().min(1).max(100),
  widgetId: z.uuid().describe('The widget it belongs to'),
});

async function widgetById(ctx: ModuleContext, id: string) {
  const { rows } = await ctx.db.execute<WidgetRow>(
    sql`select id, name, color, archived from itest_config.widgets where id::text = ${id}`,
  );
  return rows[0] ?? null;
}

const widgetKind: CustomizationHandler<z.infer<typeof widgetValue>> = {
  schema: widgetValue,
  guide: async () => ({ instructions: 'Widgets have a unique name and a colour.' }),
  list: async (opts, ctx) => {
    const { rows } = await ctx.db.execute<WidgetRow>(
      sql`select id, name, color, archived from itest_config.widgets
          where (${opts.includeArchived} or not archived) order by name limit ${opts.limit}`,
    );
    return rows.map((r) => ({ id: r.id, label: r.name, archived: r.archived }));
  },
  get: async (id, ctx) => {
    const r = await widgetById(ctx, id);
    return r
      ? { id: r.id, label: r.name, archived: r.archived, value: { name: r.name, color: r.color as 'red' } }
      : null;
  },
  check: async (change, ctx) => {
    if (!change.value) return [];
    const { rows } = await ctx.db.execute<{ id: string }>(
      sql`select id from itest_config.widgets where lower(name) = lower(${change.value.name})`,
    );
    return rows.some((r) => r.id !== change.id)
      ? [{ path: 'name', message: 'Another widget has this name', code: 'duplicate' }]
      : [];
  },
  apply: async (change, ctx) => {
    if (change.op === 'create') {
      const { rows } = await ctx.db.execute<{ id: string }>(
        sql`insert into itest_config.widgets (name, color) values (${change.value!.name}, ${change.value!.color}) returning id`,
      );
      await ctx.audit.record({ action: 'itest-config.widget.created', entityId: rows[0]!.id });
      return { id: rows[0]!.id };
    }
    if (change.op === 'update')
      await ctx.db.execute(
        sql`update itest_config.widgets set name = ${change.value!.name}, color = ${change.value!.color} where id = ${change.id}`,
      );
    else
      await ctx.db.execute(
        sql`update itest_config.widgets set archived = ${change.op === 'archive'} where id = ${change.id}`,
      );
    return { id: change.id! };
  },
  templates: [
    {
      id: 'colour',
      label: 'itest-config.templates.colour',
      description: 'itest-config.templates.colourHelp',
      fields: async () => [
        { key: 'name', type: 'text', label: { en: 'Name' }, required: true },
        {
          key: 'color',
          type: 'select',
          label: { en: 'Colour' },
          required: true,
          options: ['red', 'green', 'blue'].map((v) => ({ value: v, label: { en: v } })),
        },
      ],
      build: async (answers) => ({
        op: 'create',
        value: { name: String(answers.name), color: answers.color as 'red' },
      }),
    },
  ],
};

const gadgetKind: CustomizationHandler<z.infer<typeof gadgetValue>> = {
  schema: gadgetValue,
  guide: async () => ({ instructions: 'A gadget belongs to a widget.' }),
  list: async () => [],
  get: async (id, ctx) => {
    const { rows } = await ctx.db.execute<{ id: string; name: string; widget_id: string }>(
      sql`select id, name, widget_id from itest_config.gadgets where id::text = ${id}`,
    );
    const r = rows[0];
    return r ? { id: r.id, label: r.name, value: { name: r.name, widgetId: r.widget_id } } : null;
  },
  check: async (change, ctx) =>
    change.value && !(await widgetById(ctx, change.value.widgetId))
      ? [{ path: 'widgetId', message: 'No such widget', code: 'unknown_widget' }]
      : [],
  apply: async (change, ctx, auth) => {
    // A rule of the module's own: "special" gadgets need an extra permission.
    if (change.value?.name.startsWith('special') && !auth.can('itest-config.gadgets.special'))
      throw new HttpError(403, ErrorCodes.FORBIDDEN, 'Special gadgets need more', {
        permission: 'itest-config.gadgets.special',
      });
    if (change.op === 'create') {
      const { rows } = await ctx.db.execute<{ id: string }>(
        sql`insert into itest_config.gadgets (name, widget_id) values (${change.value!.name}, ${change.value!.widgetId}) returning id`,
      );
      return { id: rows[0]!.id };
    }
    if (change.op === 'update')
      await ctx.db.execute(
        sql`update itest_config.gadgets set name = ${change.value!.name}, widget_id = ${change.value!.widgetId} where id = ${change.id}`,
      );
    else await ctx.db.execute(sql`delete from itest_config.gadgets where id = ${change.id}`);
    return { id: change.id! };
  },
};

const configModule = defineServerModule(
  defineManifest({
    id: 'itest-config',
    version: '1.0.0',
    name: 'Test configuration',
    permissions: [
      { key: 'itest-config.config.read', description: 'Read' },
      { key: 'itest-config.config.manage', description: 'Manage' },
      { key: 'itest-config.gadgets.special', description: 'Special gadgets' },
    ],
    customizations: [
      {
        kind: 'widget',
        label: 'itest-config.kinds.widget',
        description: 'A widget with a unique name and a colour',
        readPermission: 'itest-config.config.read',
        applyPermission: 'itest-config.config.manage',
        operations: ['create', 'update', 'archive'],
      },
      {
        kind: 'gadget',
        label: 'itest-config.kinds.gadget',
        description: 'A gadget that belongs to a widget',
        readPermission: 'itest-config.config.read',
        applyPermission: 'itest-config.config.manage',
        operations: ['create', 'update', 'delete'],
      },
    ],
  }),
  {
    migrations: [
      {
        tag: '0000_init',
        hash: 'itest-config-0',
        sql: `create schema "itest_config";
--> statement-breakpoint
create table itest_config.widgets (id uuid primary key default gen_random_uuid(), name text not null unique, color text not null, archived boolean not null default false);
--> statement-breakpoint
create table itest_config.gadgets (id uuid primary key default gen_random_uuid(), name text not null, widget_id uuid not null references itest_config.widgets(id));`,
      },
    ],
    customizations: { widget: widgetKind, gadget: gadgetKind },
  },
);

const widgets = async () =>
  (
    await h.kernel.db.execute<WidgetRow>(
      sql`select id, name, color, archived from itest_config.widgets order by name`,
    )
  ).rows;
const gadgets = async () =>
  (
    await h.kernel.db.execute<{ id: string; name: string; widget_id: string }>(
      sql`select id, name, widget_id from itest_config.gadgets order by name`,
    )
  ).rows;

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

beforeAll(async () => {
  h = await createHarness({ extraModules: [configModule] });
  admin = await h.login('admin');
  await grant(h.ids.hr, 'config-author', ['assistant.agent.use', 'itest-config.config.read']);
  author = await h.login('hr');
  outsider = await h.login('outsider');
  stopWorker = await startWorker(h.kernel);
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

/* ───────────── kernel ───────────── */

describe('customisation kinds (kernel)', () => {
  it('lists the kinds a caller may read, with whether they may apply them', async () => {
    const authorKinds = (await h.call(author, 'GET', `${A}/status`)).body.kinds as LooseJson[];
    const widget = authorKinds.find((k) => k.kind === 'itest-config.widget');
    expect(widget).toMatchObject({ canApply: false, operations: ['create', 'update', 'archive'] });
    expect(widget.templates).toEqual([
      {
        id: 'colour',
        label: 'itest-config.templates.colour',
        description: 'itest-config.templates.colourHelp',
      },
    ]);
    const adminKinds = (await h.call(admin, 'GET', `${A}/status`)).body.kinds as LooseJson[];
    expect(adminKinds.find((k) => k.kind === 'itest-config.widget').canApply).toBe(true);
    expect((await h.call(outsider, 'GET', `${A}/status`)).status).toBe(403);
  });

  it('counts the everyday tools of people who can’t customise anything, so they can still chat', async () => {
    const [helper] = await h.kernel.db
      .insert(users)
      .values({
        email: 'helper@test.example',
        username: 'helper',
        displayName: 'Helper',
        passwordHash: await hashPassword(PASSWORD),
      })
      .returning();
    await grant(helper!.id, 'assistant-everyday', ['assistant.agent.use', 'core.departments.read']);
    const status = (await h.call(await h.login('helper'), 'GET', `${A}/status`)).body;
    expect(status.kinds).toEqual([]);
    // core.find_departments at least; the assistant's own (configuration) tools are not counted.
    expect(status.tools).toBeGreaterThanOrEqual(1);
    const authorStatus = (await h.call(author, 'GET', `${A}/status`)).body;
    expect(authorStatus.tools).toBeGreaterThanOrEqual(1);
  });
});

/* ───────────── change sets ───────────── */

describe('change sets', () => {
  let setId: string;

  it('collects proposals, resolves references and dry-runs without leaving a trace', async () => {
    const created = await h.call(author, 'POST', `${A}/change-sets`, { title: 'Blue widget with a gadget' });
    expect(created.status).toBe(201);
    setId = created.body.id;
    expect(created.body.reference).toMatch(/^CS-\d{5}$/);

    const w = await h.call(author, 'POST', `${A}/change-sets/${setId}/items`, {
      ref: 'blue',
      kind: 'itest-config.widget',
      op: 'create',
      value: { name: 'Blue', color: 'blue' },
    });
    expect(w.status).toBe(200);
    const g = await h.call(author, 'POST', `${A}/change-sets/${setId}/items`, {
      ref: 'gadget',
      kind: 'itest-config.gadget',
      op: 'create',
      value: { name: 'Gizmo', widgetId: '$ref:blue' },
    });
    expect(g.status).toBe(200);
    expect(g.body.items.map((i: LooseJson) => [i.ref, i.label, i.check.ok])).toEqual([
      ['blue', 'Blue', true],
      ['gadget', 'Gizmo', true],
    ]);
    expect(g.body).toMatchObject({ ready: true, status: 'draft', destructive: false });
    // The dry run rolled back: nothing exists yet.
    expect(await widgets()).toEqual([]);
    expect(await gadgets()).toEqual([]);
    // The author can't apply; they can request a review.
    expect(g.body.permissions).toMatchObject({
      canApply: false,
      canSubmit: true,
      missing: ['itest-config.config.manage'],
    });
  });

  it('refuses references to unknown or later items and reports failing checks per item', async () => {
    const bad = await h.call(author, 'POST', `${A}/change-sets/${setId}/items`, {
      kind: 'itest-config.gadget',
      op: 'create',
      value: { name: 'Orphan', widgetId: '$ref:nope' },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.issues[0].code).toBe('unknown_ref');

    const dup = await h.call(author, 'POST', `${A}/change-sets/${setId}/items`, {
      ref: 'dup',
      kind: 'itest-config.widget',
      op: 'create',
      value: { name: 'blue', color: 'red' },
    });
    // "blue" collides with the "Blue" created earlier in the same (rolled-back) transaction.
    const item = dup.body.items.find((i: LooseJson) => i.ref === 'dup');
    expect(item.check).toMatchObject({ ok: false, needsApprover: false, code: 'VALIDATION_FAILED' });
    expect(item.check.issues[0]).toMatchObject({ path: 'name', code: 'duplicate' });
    expect(dup.body.ready).toBe(false);
    const removed = await h.call(author, 'DELETE', `${A}/change-sets/${setId}/items/${item.id}`);
    expect(removed.body.items).toHaveLength(2);
  });

  it('is visible to its author and to readers of every change set, not to others', async () => {
    expect((await h.call(outsider, 'GET', `${A}/change-sets/${setId}`)).status).toBe(403);
    expect((await h.call(admin, 'GET', `${A}/change-sets/${setId}`)).status).toBe(200);
    const mine = await h.call(author, 'GET', `${A}/change-sets`);
    expect(mine.body.items.map((i: LooseJson) => i.id)).toContain(setId);
    expect((await h.call(author, 'GET', `${A}/change-sets?scope=all`)).status).toBe(403);
  });

  it('goes to review; the approval applies it as the approver, with the change set in every audit entry', async () => {
    const submitted = await h.call(author, 'POST', `${A}/change-sets/${setId}/submit`, { note: 'Please' });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('in_review');
    expect(submitted.body.permissions).toMatchObject({ canEdit: false, canWithdraw: true });

    const inbox = await eventually(
      () => h.call(admin, 'GET', '/api/v1/me/approvals?status=pending'),
      (r) => r.body.items?.some((t: LooseJson) => t.instance.subject.id === setId),
    );
    const task = inbox.body.items.find((t: LooseJson) => t.instance.subject.id === setId);
    expect(task.instance.subject.href).toBe(`/assistant/change-sets/${setId}`);
    // The approver may open the change set while reviewing it.
    expect((await h.call(admin, 'GET', `${A}/change-sets/${setId}`)).body.permissions.canApply).toBe(true);
    expect((await h.call(admin, 'POST', `/api/v1/approvals/${task.task.id}/approve`, {})).status).toBe(200);

    const applied = await eventually(
      () => h.call(author, 'GET', `${A}/change-sets/${setId}`),
      (r) => r.body.status === 'applied',
    );
    expect(applied.body.status).toBe('applied');
    expect(applied.body.appliedBy.name).toBe('admin');
    const [blue] = await widgets();
    expect(blue).toMatchObject({ name: 'Blue', color: 'blue' });
    expect((await gadgets())[0]).toMatchObject({ name: 'Gizmo', widget_id: blue!.id });
    expect(applied.body.items[0]).toMatchObject({ appliedId: blue!.id, before: null });
    expect(applied.body.items[0].after.value).toEqual({ name: 'Blue', color: 'blue' });

    const [entry] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'itest-config.widget.created'));
    expect(entry!.metadata).toMatchObject({ source: { type: 'change-set', id: setId } });
    expect(entry!.actorName).toBe('admin');
  });

  it('refuses to apply over a newer version, until refreshed', async () => {
    const [blue] = await widgets();
    const s = await h.call(admin, 'POST', `${A}/change-sets`, {});
    const id = s.body.id;
    await h.call(admin, 'POST', `${A}/change-sets/${id}/items`, {
      kind: 'itest-config.widget',
      op: 'update',
      targetId: blue!.id,
      value: { name: 'Blue', color: 'green' },
    });
    await h.kernel.db.execute(sql`update itest_config.widgets set color = 'red' where id = ${blue!.id}`);
    const detail = await h.call(admin, 'GET', `${A}/change-sets/${id}`);
    expect(detail.body.items[0]).toMatchObject({ stale: true });
    expect(detail.body.items[0].current.value).toEqual({ name: 'Blue', color: 'red' });

    const stale = await h.call(admin, 'POST', `${A}/change-sets/${id}/apply`, { confirm: false });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CHANGE_SET_STALE');
    expect((await widgets())[0]!.color).toBe('red');
    expect((await h.call(admin, 'GET', `${A}/change-sets/${id}`)).body.lastError.code).toBe(
      'CHANGE_SET_STALE',
    );

    const refreshed = await h.call(admin, 'POST', `${A}/change-sets/${id}/refresh`);
    expect(refreshed.body.items[0].stale).toBe(false);
    const ok = await h.call(admin, 'POST', `${A}/change-sets/${id}/apply`, { confirm: false });
    expect(ok.status).toBe(200);
    expect(ok.body.items[0].before.value).toEqual({ name: 'Blue', color: 'red' });
    expect((await widgets())[0]!.color).toBe('green');

    // Rolling back puts the colour back — unless the widget changed again since.
    await h.kernel.db.execute(sql`update itest_config.widgets set name = 'Blue!' where id = ${blue!.id}`);
    const blocked = await h.call(admin, 'POST', `${A}/change-sets/${id}/rollback`, { confirm: true });
    expect(blocked.body.error.code).toBe('CHANGE_SET_STALE');
    await h.kernel.db.execute(sql`update itest_config.widgets set name = 'Blue' where id = ${blue!.id}`);
    expect((await h.call(admin, 'POST', `${A}/change-sets/${id}/rollback`, { confirm: false })).status).toBe(
      409,
    );
    const rolled = await h.call(admin, 'POST', `${A}/change-sets/${id}/rollback`, { confirm: true });
    expect(rolled.status).toBe(200);
    expect(rolled.body.status).toBe('rolled_back');
    expect((await widgets())[0]!.color).toBe('red');
  });

  it('rolls a create back with delete or archive, and needs confirmation for destructive items', async () => {
    const s = (await h.call(admin, 'POST', `${A}/change-sets`, { title: 'Two more' })).body.id;
    await h.call(admin, 'POST', `${A}/change-sets/${s}/items`, {
      ref: 'w',
      kind: 'itest-config.widget',
      op: 'create',
      value: { name: 'Red', color: 'red' },
    });
    await h.call(admin, 'POST', `${A}/change-sets/${s}/items`, {
      kind: 'itest-config.gadget',
      op: 'create',
      value: { name: 'Doohickey', widgetId: '$ref:w' },
    });
    expect((await h.call(admin, 'POST', `${A}/change-sets/${s}/apply`, {})).status).toBe(200);
    expect((await gadgets()).map((g) => g.name)).toEqual(['Doohickey', 'Gizmo']);
    const rolled = await h.call(admin, 'POST', `${A}/change-sets/${s}/rollback`, { confirm: true });
    expect(rolled.status).toBe(200);
    // The gadget is deleted (the kind deletes); the widget is archived (it can't).
    expect((await gadgets()).map((g) => g.name)).toEqual(['Gizmo']);
    expect((await widgets()).find((w) => w.name === 'Red')!.archived).toBe(true);

    const [blue] = await widgets();
    const d = (await h.call(admin, 'POST', `${A}/change-sets`, {})).body.id;
    await h.call(admin, 'POST', `${A}/change-sets/${d}/items`, {
      kind: 'itest-config.widget',
      op: 'archive',
      targetId: blue!.id,
    });
    const unconfirmed = await h.call(admin, 'POST', `${A}/change-sets/${d}/apply`, {});
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error.code).toBe('CONFIRMATION_REQUIRED');
    expect((await h.call(admin, 'POST', `${A}/change-sets/${d}/apply`, { confirm: true })).status).toBe(200);
    expect((await widgets()).find((w) => w.id === blue!.id)!.archived).toBe(true);
    // Archive → restore on rollback.
    expect((await h.call(admin, 'POST', `${A}/change-sets/${d}/rollback`, { confirm: true })).status).toBe(
      200,
    );
    expect((await widgets()).find((w) => w.id === blue!.id)!.archived).toBe(false);
  });

  it('marks items only someone with more permissions can apply, and returns rejected reviews to draft', async () => {
    const [blue] = await widgets();
    const s = await h.call(author, 'POST', `${A}/change-sets`, {});
    const proposed = await h.call(author, 'POST', `${A}/change-sets/${s.body.id}/items`, {
      kind: 'itest-config.gadget',
      op: 'create',
      value: { name: 'special gadget', widgetId: blue!.id },
    });
    expect(proposed.body.items[0].check).toMatchObject({
      ok: false,
      needsApprover: true,
      permission: 'itest-config.gadgets.special',
    });
    expect((await h.call(author, 'POST', `${A}/change-sets/${s.body.id}/submit`, {})).status).toBe(200);
    const inbox = await eventually(
      () => h.call(admin, 'GET', '/api/v1/me/approvals?status=pending'),
      (r) => r.body.items?.some((t: LooseJson) => t.instance.subject.id === s.body.id),
    );
    const task = inbox.body.items.find((t: LooseJson) => t.instance.subject.id === s.body.id);
    await h.call(admin, 'POST', `/api/v1/approvals/${task.task.id}/reject`, { comment: 'Not this quarter' });
    const back = await eventually(
      () => h.call(author, 'GET', `${A}/change-sets/${s.body.id}`),
      (r) => r.body.status === 'draft' && !!r.body.lastError,
    );
    expect(back.body.lastError).toMatchObject({ message: 'Not this quarter' });
    expect(await gadgets()).toHaveLength(1);
    const discarded = await h.call(author, 'POST', `${A}/change-sets/${s.body.id}/discard`);
    expect(discarded.body.status).toBe('discarded');
  });

  it('builds a change from a guided template', async () => {
    const fields = await h.call(author, 'GET', `${A}/templates/itest-config.widget/colour`);
    expect(fields.body.fields.map((f: LooseJson) => f.key)).toEqual(['name', 'color']);
    const invalid = await h.call(author, 'POST', `${A}/templates/build`, {
      kind: 'itest-config.widget',
      templateId: 'colour',
      answers: { name: 'Teal', color: 'teal' },
    });
    expect(invalid.status).toBe(422);
    const built = await h.call(author, 'POST', `${A}/templates/build`, {
      kind: 'itest-config.widget',
      templateId: 'colour',
      answers: { name: 'Teal', color: 'green' },
    });
    expect(built.status).toBe(200);
    expect(built.body.items[0]).toMatchObject({ op: 'create', value: { name: 'Teal', color: 'green' } });
    expect(built.body.title).toBe('Teal');
  });

  it('keeps and checks the changes written before a template’s later change is refused', async () => {
    // A template is written change by change and checked once; a change refused part-way (an update with no target)
    // leaves the earlier ones in the set, checked as they were when each was added.
    const sets = new ChangeSetService(h.kernel.registry.context('assistant'));
    const auth = (await h.kernel.registry.context('core').rbac.authFor(h.ids.admin))!;
    await expect(
      sets.proposeTemplate(
        null,
        {
          label: 'Two changes, the second refused',
          items: [
            {
              kind: 'itest-config.widget',
              op: 'create',
              id: null,
              label: 'Staged widget',
              value: { name: 'Staged', color: 'green' },
              ref: 'staged',
            },
            {
              kind: 'itest-config.widget',
              op: 'update',
              id: null,
              label: 'Refused widget',
              value: { name: 'Refused', color: 'red' },
              ref: null,
            },
          ],
        },
        auth,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
    const mine = await h.call(admin, 'GET', `${A}/change-sets`);
    const set = (mine.body.items as LooseJson[]).find((s) => s.title === 'Staged widget');
    expect(set).toBeDefined();
    const detail = (await h.call(admin, 'GET', `${A}/change-sets/${set!.id}`)).body;
    expect(detail.items.map((i: LooseJson) => [i.label, i.check?.ok])).toEqual([['Staged widget', true]]);
    expect(detail.checkedAt).not.toBeNull();
    expect(detail.ready).toBe(true);
  });
});

/* ───────────── the assistant (scripted model) ───────────── */

function sse(body: string) {
  return body
    .split('\n\n')
    .filter((b) => b.includes('data:'))
    .map((b) => {
      const event = /event: (.+)/.exec(b)?.[1] ?? 'message';
      return { event, data: JSON.parse(/data: (.+)/.exec(b)![1]!) as LooseJson };
    });
}

describe('assistant conversations', () => {
  let server: Server;
  const requests: LooseJson[] = [];
  const core = () => h.kernel.registry.get('core')!.manifest;

  /** Streams one OpenAI-style answer: tool calls, or text. */
  function answer(res: ServerResponse, reply: { text?: string; calls?: { name: string; args: unknown }[] }) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (reply.text)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.text } }] })}\n\n`);
    (reply.calls ?? []).forEach((c, index) =>
      res.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index,
                    id: `call_${requests.length}_${index}`,
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  },
                ],
              },
            },
          ],
        })}\n\n`,
      ),
    );
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reply.calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`,
    );
    res.end('data: [DONE]\n\n');
  }

  beforeAll(async () => {
    server = createServer(async (req: IncomingMessage, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as LooseJson;
      requests.push(body);
      const toolResults = (body.messages as LooseJson[]).filter((m) => m.role === 'tool');
      const last = String(
        (body.messages as LooseJson[]).filter((m) => m.role === 'user').at(-1)?.content ?? '',
      );
      if (last.includes('purple')) return answer(res, { text: 'I can only use red, green or blue.' });
      const applyIt = last.includes('apply it');
      if (toolResults.length === 0)
        return answer(res, {
          calls: [{ name: 'assistant__describe_kind', args: { kind: 'itest-config.widget' } }],
        });
      if (toolResults.length === 1)
        return answer(res, {
          calls: [
            {
              name: 'assistant__propose_change',
              // The model's own changeSetId is ignored: the conversation's is used.
              args: {
                changeSetId: '00000000-0000-4000-8000-000000000000',
                ref: 'w',
                kind: 'itest-config.widget',
                op: 'create',
                value: { name: applyIt ? 'Applied widget' : 'Chat widget', color: 'blue' },
              },
            },
          ],
        });
      if (applyIt && toolResults.length === 2)
        return answer(res, { calls: [{ name: 'assistant__apply_change_set', args: {} }] });
      return answer(res, { text: 'I prepared the change set. Review it and apply it, or request a review.' });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await h.kernel.settings.update(core(), { 'ai.chat.provider': 'none' }, null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('answers in builtin mode without a chat model', async () => {
    const { id } = (await h.call(author, 'POST', `${A}/conversations`)).body;
    const res = await h.app.inject({
      method: 'POST',
      url: `${A}/conversations/${id}/messages`,
      payload: { content: 'Add a blue widget' },
      headers: { cookie: author.cookie, 'x-csrf-token': author.csrf },
    });
    const events = sse(res.body);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { mode: 'builtin' } });
    expect(events[0]!.data.text).toContain('guided templates');
  });

  it('runs the tool loop as the person and builds the conversation’s change set', async () => {
    await h.kernel.settings.update(
      core(),
      {
        'ai.chat.provider': 'openai-compatible',
        'ai.chat.baseUrl': `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        'ai.chat.model': 'fake',
      },
      null,
    );
    const { id } = (await h.call(author, 'POST', `${A}/conversations`)).body;
    const res = await h.app.inject({
      method: 'POST',
      url: `${A}/conversations/${id}/messages`,
      payload: {
        content: 'Add a blue widget called Chat widget',
        page: { path: '/admin/workflows', title: 'Approval workflows' },
      },
      headers: { cookie: author.cookie, 'x-csrf-token': author.csrf },
    });
    const events = sse(res.body);
    expect(events.filter((e) => e.event === 'tool').map((e) => [e.data.name, e.data.status])).toEqual([
      ['assistant.describe_kind', 'running'],
      ['assistant.describe_kind', 'done'],
      ['assistant.propose_change', 'running'],
      ['assistant.propose_change', 'done'],
    ]);
    const changeSet = events.find((e) => e.event === 'change_set')!.data;
    expect(changeSet).toMatchObject({ itemCount: 1, ready: true, status: 'draft' });
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { mode: 'llm', model: 'fake' } });

    // The model saw the page, the kinds and the rules; read-only tools of other modules were offered.
    const first = requests.at(-3)!;
    const system = String(first.messages[0].content);
    expect(system).toContain('/admin/workflows');
    expect(system).toContain('itest-config.widget');
    expect(system).toContain('run only if they confirm');
    const offered = (first.tools as LooseJson[]).map((t) => t.function.name);
    expect(offered).toContain('assistant__propose_change');
    // The platform's own MCP surface, destructive tools included (they wait for the person's confirmation).
    expect(offered).toContain('assistant__apply_change_set');
    expect(offered).toContain('core__find_users');

    const conv = await h.call(author, 'GET', `${A}/conversations/${id}`);
    expect(conv.body.changeSetId).toBe(changeSet.id);
    expect(conv.body.messages.map((m: LooseJson) => m.role)).toEqual(['user', 'assistant']);
    expect(conv.body.messages[1].tools.map((t: LooseJson) => t.name)).toEqual([
      'assistant.describe_kind',
      'assistant.propose_change',
    ]);
    const set = await h.call(author, 'GET', `${A}/change-sets/${changeSet.id}`);
    expect(set.body.conversationId).toBe(id);
    expect(set.body.items[0].value).toEqual({ name: 'Chat widget', color: 'blue' });
    // Proposals stay drafts.
    expect((await widgets()).some((w) => w.name === 'Chat widget')).toBe(false);
  });

  it('applies the change set itself once the person confirms, through the same MCP tools', async () => {
    const { id } = (await h.call(admin, 'POST', `${A}/conversations`)).body;
    const ask = (content: string) =>
      h.app.inject({
        method: 'POST',
        url: `${A}/conversations/${id}/messages`,
        payload: { content },
        headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      });
    const events = sse((await ask('Add a blue widget called Applied widget and apply it')).body);
    const confirm = events.find((e) => e.event === 'confirm')!.data;
    expect(confirm).toMatchObject({ name: 'assistant.apply_change_set', status: 'pending' });
    expect(confirm.label).toMatch(/^Apply CS-\d{5} \(1 change\)$/);
    // Nothing ran yet.
    expect((await widgets()).some((w) => w.name === 'Applied widget')).toBe(false);

    const confirmed = await h.call(
      admin,
      'POST',
      `${A}/conversations/${id}/confirmations/${confirm.toolCallId}`,
      { approve: true },
    );
    expect(confirmed.status).toBe(200);
    expect((await widgets()).some((w) => w.name === 'Applied widget')).toBe(true);
    const thread = confirmed.body.messages as LooseJson[];
    expect(thread.at(-2)).toMatchObject({ role: 'user', content: `Confirmed: ${confirm.label}` });
    expect(thread.at(-1)).toMatchObject({ role: 'assistant', content: `Done: ${confirm.label}.` });
    expect(thread.flatMap((m) => m.confirmations)[0]).toMatchObject({
      status: 'confirmed',
      result: { ok: true },
    });
    expect(confirmed.body.changeSet.status).toBe('applied');
    // A decision is final.
    expect(
      (
        await h.call(admin, 'POST', `${A}/conversations/${id}/confirmations/${confirm.toolCallId}`, {
          approve: true,
        })
      ).status,
    ).toBe(409);
    const audit = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'core.ai.tool_invoked'),
          eq(auditLogs.entityId, 'assistant.apply_change_set'),
        ),
      );
    expect(audit[0]!.metadata).toMatchObject({ via: 'assistant', confirmed: true });
  });

  it('expires a confirmation the person moved past, and runs nothing when declined', async () => {
    const { id } = (await h.call(admin, 'POST', `${A}/conversations`)).body;
    const ask = (content: string) =>
      h.app.inject({
        method: 'POST',
        url: `${A}/conversations/${id}/messages`,
        payload: { content },
        headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      });
    const first = sse((await ask('Add a blue widget called Applied widget 2 and apply it')).body);
    const pending = first.find((e) => e.event === 'confirm')!.data;
    await ask('I want purple instead');
    const expired = await h.call(
      admin,
      'POST',
      `${A}/conversations/${id}/confirmations/${pending.toolCallId}`,
      {
        approve: true,
      },
    );
    expect(expired.status).toBe(409);
    expect(expired.body.error.details.status).toBe('expired');

    const { id: other } = (await h.call(admin, 'POST', `${A}/conversations`)).body;
    const again = sse(
      (
        await h.app.inject({
          method: 'POST',
          url: `${A}/conversations/${other}/messages`,
          payload: { content: 'Add a blue widget called Applied widget and apply it' },
          headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
        })
      ).body,
    ).find((e) => e.event === 'confirm')!.data;
    const declined = await h.call(
      admin,
      'POST',
      `${A}/conversations/${other}/confirmations/${again.toolCallId}`,
      {
        approve: false,
      },
    );
    expect(declined.body.messages.at(-1).content).toBe(`OK, I won’t do that: ${again.label}.`);
    expect(declined.body.changeSet.status).toBe('draft');
  });
});

/* ───────────── MCP ───────────── */

describe('MCP server', () => {
  let key: string;
  const mcp = (body: unknown, headers: Record<string, string> = {}, bearer: string | null = key) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      payload: body as object,
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...headers,
      },
    });
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  const modern = (method: string, params: Record<string, unknown> = {}, extra: Record<string, string> = {}) =>
    mcp(
      { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...extra },
    );

  beforeAll(async () => {
    const created = await h.call(admin, 'POST', '/api/v1/api-clients', {
      name: 'Claude Code',
      permissions: ['core.mcp.use', 'assistant.agent.use', 'itest-config.config.read', 'core.users.read'],
    });
    expect(created.status).toBe(201);
    key = created.body.secret;
  });

  it('serves 2026-07-28 statelessly: discovery, header validation and versions', async () => {
    const discover = await modern('server/discover');
    expect(discover.statusCode).toBe(200);
    const result = discover.json().result;
    expect(result).toMatchObject({ resultType: 'complete', capabilities: { tools: {}, resources: {} } });
    expect(result.supportedVersions).toEqual(['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26']);
    expect(result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('isbp');

    const missing = await mcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } },
      { 'mcp-protocol-version': '2026-07-28' },
    );
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe(-32020);

    const old = await mcp(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '1999-01-01' } },
      },
      { 'mcp-protocol-version': '1999-01-01', 'mcp-method': 'tools/list' },
    );
    expect(old.statusCode).toBe(400);
    expect(old.json().error).toMatchObject({ code: -32022, data: { requested: '1999-01-01' } });

    const unknown = await modern('prompts/list');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe(-32601);

    const name = await modern(
      'tools/call',
      { name: 'assistant__list_kinds', arguments: {} },
      { 'mcp-name': 'other' },
    );
    expect(name.json().error.code).toBe(-32020);
  });

  it('lists non-destructive tools the client may use and calls them with its grants', async () => {
    const list = (await modern('tools/list')).json().result;
    const names = list.tools.map((t: LooseJson) => t.name);
    expect(names).toContain('assistant__propose_change');
    expect(names).toContain('core__find_users');
    expect(names).not.toContain('core__offboard_user');
    expect(names).not.toContain('assistant__apply_change_set');
    expect(names).toContain('assistant__request_review');
    expect(names).toEqual([...names].sort());
    expect(list.tools.find((t: LooseJson) => t.name === 'assistant__list_kinds').annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });

    const proposed = await modern(
      'tools/call',
      {
        name: 'assistant__propose_change',
        arguments: { kind: 'itest-config.widget', op: 'create', value: { name: 'From MCP', color: 'green' } },
      },
      { 'mcp-name': 'assistant__propose_change' },
    );
    const out = proposed.json().result;
    expect(out.isError).toBe(false);
    expect(out.structuredContent.changeSet).toMatchObject({ status: 'draft', itemCount: 1 });
    expect(out.structuredContent.items[0].check).toMatchObject({ ok: true });
    // The change set belongs to the API client; a person applies it.
    const set = await h.call(admin, 'GET', `${A}/change-sets/${out.structuredContent.changeSet.id}`);
    expect(set.body.createdBy).toMatchObject({ type: 'service', name: 'Claude Code' });

    const invalid = await modern(
      'tools/call',
      { name: 'assistant__propose_change', arguments: { kind: 'itest-config.widget', op: 'fly' } },
      { 'mcp-name': 'assistant__propose_change' },
    );
    expect(invalid.json().result).toMatchObject({ isError: true });
    expect(JSON.parse(invalid.json().result.content[0].text).error).toBe('VALIDATION_FAILED');

    const audits = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'core.ai.tool_invoked'), eq(auditLogs.entityId, 'assistant.propose_change')),
      );
    const viaMcp = audits.filter((a) => a.metadata?.via === 'mcp');
    expect(viaMcp.length).toBeGreaterThan(0);
    expect(viaMcp[0]).toMatchObject({ actorType: 'service', actorName: 'client:Claude Code' });
  });

  it('reads customisation resources', async () => {
    const res = await modern(
      'resources/read',
      { uri: 'isbp://customizations/itest-config.widget' },
      { 'mcp-name': 'isbp://customizations/itest-config.widget' },
    );
    const content = JSON.parse(res.json().result.contents[0].text);
    expect(content.kind.kind).toBe('itest-config.widget');
    expect(content.schema.properties.color.enum).toEqual(['red', 'green', 'blue']);
    const missing = await modern('resources/read', { uri: 'isbp://nope' }, { 'mcp-name': 'isbp://nope' });
    expect(missing.json().error.code).toBe(-32602);
  });

  it('still speaks the initialize-based revisions, without sessions', async () => {
    const init = await mcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'old', version: '1' } },
    });
    expect(init.statusCode).toBe(200);
    expect(init.json().result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'isbp' } });
    expect(init.headers['mcp-session-id']).toBeUndefined();
    expect(
      (
        await mcp(
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { 'mcp-protocol-version': '2025-06-18' },
        )
      ).statusCode,
    ).toBe(202);
    const tools = await mcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'mcp-protocol-version': '2025-06-18' },
    );
    expect(tools.json().result.tools.length).toBeGreaterThan(3);
    expect(tools.json().result.resultType).toBeUndefined();
    const ping = await mcp(
      { jsonrpc: '2.0', id: 3, method: 'ping' },
      { 'mcp-protocol-version': '2025-06-18' },
    );
    expect(ping.json().result).toEqual({});
    const newest = await mcp({
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
      params: { protocolVersion: '2030-01-01', capabilities: {}, clientInfo: { name: 'new', version: '1' } },
    });
    expect(newest.json().result.protocolVersion).toBe('2025-11-25');
  });

  it('is for API clients only, from no foreign origin, over POST', async () => {
    const asUser = await h.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
    });
    expect(asUser.statusCode).toBe(403);
    expect((await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, null)).statusCode).toBe(401);
    expect(
      (await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).statusCode,
    ).toBe(403);
    const get = await h.app.inject({
      method: 'GET',
      url: '/api/v1/mcp',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(get.statusCode).toBe(405);

    const noGrant = await h.call(admin, 'POST', '/api/v1/api-clients', {
      name: 'No MCP',
      permissions: ['assistant.agent.use'],
    });
    expect((await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, noGrant.body.secret)).statusCode).toBe(
      403,
    );
  });
});

/* ───────────── real kinds: a workflow and the form that uses it ───────────── */

describe('change sets over core kinds', () => {
  const t3 = (en: string) => ({ en, 'zh-TW': en, 'ja-JP': en });

  it('creates a workflow and a form referring to it in one transaction, and rolls both back', async () => {
    const s = (await h.call(admin, 'POST', `${A}/change-sets`, { title: 'Monitor requests' })).body.id;
    const wf = await h.call(admin, 'POST', `${A}/change-sets/${s}/items`, {
      ref: 'approval',
      kind: 'core.workflow',
      op: 'create',
      value: {
        name: 'Monitor request approval',
        description: null,
        triggerKey: 'core.form-submission',
        isDefault: false,
        graph: {
          steps: [
            {
              id: 'manager',
              type: 'approval',
              name: t3('Manager'),
              approvers: [{ type: 'manager' }],
              mode: 'any',
              ifNoApprover: 'skip',
            },
          ],
        },
      },
    });
    expect(wf.body.items[0].check).toMatchObject({ ok: true });
    const form = await h.call(admin, 'POST', `${A}/change-sets/${s}/items`, {
      kind: 'core.form',
      op: 'create',
      value: {
        key: 'monitor-request',
        name: t3('Monitor request'),
        schema: {
          elements: [{ id: 'size', key: 'size', type: 'number', label: t3('Size (inches)'), required: true }],
        },
        workflowId: '$ref:approval',
        audience: { type: 'everyone' },
        active: true,
      },
    });
    expect(form.body.items.map((i: LooseJson) => i.check.ok)).toEqual([true, true]);
    // Nothing exists until it is applied.
    expect((await h.call(admin, 'GET', '/api/v1/forms?q=monitor')).body.items).toHaveLength(0);

    const applied = await h.call(admin, 'POST', `${A}/change-sets/${s}/apply`, {});
    expect(applied.status).toBe(200);
    const [wfItem, formItem] = applied.body.items;
    const created = await h.call(admin, 'GET', `/api/v1/forms/${formItem.appliedId}`);
    expect(created.body).toMatchObject({ key: 'monitor-request', workflow: { id: wfItem.appliedId } });
    expect(created.body.published).toBeTruthy();

    const rolled = await h.call(admin, 'POST', `${A}/change-sets/${s}/rollback`, { confirm: true });
    expect(rolled.status).toBe(200);
    expect((await h.call(admin, 'GET', `/api/v1/forms/${formItem.appliedId}`)).body.archived).toBe(true);
    expect((await h.call(admin, 'GET', `/api/v1/workflows/${wfItem.appliedId}`)).body.archived).toBe(true);
  });
});
