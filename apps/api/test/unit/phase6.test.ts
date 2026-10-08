import {
  type AuthContext,
  type CustomizationHandler,
  defineManifest,
  defineServerModule,
  HttpError,
  type ModuleContext,
  PermissionSet,
} from '@isbp/sdk/server';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeHeaderValue, McpServer, SUPPORTED_VERSIONS } from '../../src/kernel/ai/mcp';
import { ToolRegistry } from '../../src/kernel/ai/tools';
import { bindToTransaction, CustomizationRegistry, versionOf } from '../../src/kernel/customizations';
import { ModuleRegistry } from '../../src/kernel/modules';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return err instanceof HttpError ? err.code : String(err);
  }
};

function auth(grants: string[]): AuthContext {
  const permissions = new PermissionSet(grants.map((p) => ({ p, s: 'g' as const })));
  return {
    principal: { type: 'user', id: 'u1', name: 'Tester' },
    user: null,
    sessionId: null,
    permissions,
    can: (p: string) => permissions.can(p),
    require: (p: string) => {
      if (!permissions.can(p)) throw new HttpError(403, 'FORBIDDEN', 'no');
    },
    reach: (p: string) => permissions.reach(p),
  } as AuthContext;
}

/* ───────────── a module with one kind, in memory ───────────── */

const store = new Map<string, { name: string; size: number; archived: boolean }>([
  ['a', { name: 'Alpha', size: 1, archived: false }],
]);
const seen: { op: string; auth: AuthContext }[] = [];

const thing: CustomizationHandler<{ name: string; size: number }> = {
  schema: z.object({ name: z.string().min(1).describe('Name'), size: z.number().int().default(1) }),
  guide: async () => ({ instructions: 'Things.', examples: [{ description: 'One', value: { name: 'x' } }] }),
  list: async (opts) =>
    [...store.entries()]
      .filter(([, v]) => opts.includeArchived || !v.archived)
      .map(([id, v]) => ({ id, label: v.name, archived: v.archived })),
  get: async (id) => {
    const v = store.get(id);
    return v ? { id, label: v.name, archived: v.archived, value: { name: v.name, size: v.size } } : null;
  },
  check: async (change) =>
    change.value?.name === 'taken' ? [{ path: 'name', message: 'Taken', code: 'duplicate' }] : [],
  apply: async (change, _ctx, a) => {
    seen.push({ op: change.op, auth: a });
    const id = change.id ?? `n${store.size}`;
    if (change.op === 'create' || change.op === 'update')
      store.set(id, { ...change.value!, archived: store.get(id)?.archived ?? false });
    else store.get(id)!.archived = change.op === 'archive';
    return { id };
  },
};

const manifest = defineManifest({
  id: 'demo',
  version: '1.0.0',
  name: 'demo.name',
  permissions: [
    { key: 'demo.things.read', description: 'r' },
    { key: 'demo.things.manage', description: 'm' },
  ],
  customizations: [
    {
      kind: 'thing',
      label: 'demo.kinds.thing',
      description: 'A thing with a size',
      readPermission: 'demo.things.read',
      applyPermission: 'demo.things.manage',
      operations: ['create', 'update', 'archive'],
    },
  ],
  ai: {
    tools: [
      {
        name: 'demo.find_things',
        description: 'Find things by name',
        input: z.object({ q: z.string() }),
        permission: 'demo.things.read',
        readOnly: true,
      },
      {
        name: 'demo.delete_all',
        description: 'Delete every thing at once',
        input: z.object({}),
        permission: 'demo.things.read',
        destructive: true,
      },
    ],
  },
});
const demo = defineServerModule(manifest, {
  customizations: { thing },
  ai: { 'demo.find_things': async () => ({ items: [] }), 'demo.delete_all': async () => ({}) },
});

function registry() {
  const r = new ModuleRegistry([demo], null as never, pino({ level: 'silent' }));
  const ctx = {
    db: {} as never,
    audit: { record: async () => undefined, diff: () => ({}) },
    transaction: async () => undefined,
  } as unknown as ModuleContext;
  r.setContexts(new Map([['demo', ctx]]));
  return r;
}

describe('customisation kinds in manifests', () => {
  it('needs a way back for creates, unique kinds and a handler per kind', () => {
    const base = { id: 'bad', version: '1.0.0', name: 'bad.name' };
    const kind = {
      kind: 'x',
      label: 'bad.x',
      description: 'Something configurable',
      readPermission: 'bad.x.read',
      applyPermission: 'bad.x.manage',
    };
    expect(() =>
      defineManifest({ ...base, customizations: [{ ...kind, operations: ['create', 'update'] }] }),
    ).toThrow(/archive or delete/);
    expect(() => defineManifest({ ...base, customizations: [kind, kind] })).toThrow(/duplicate kind/);
    const ok = defineManifest({ ...base, customizations: [kind] });
    expect(() => defineServerModule(ok, {})).toThrow(/has no handler/);
    expect(() => defineServerModule(ok, { customizations: { x: thing, y: thing } })).toThrow(/not declared/);
  });
});

describe('ctx.customizations', () => {
  const svc = new CustomizationRegistry(registry()).service();
  const reader = auth(['demo.things.read']);
  const admin = auth(['demo.things.*']);
  const tx = {} as never;

  it('lists the kinds a caller may read, with whether they may apply', () => {
    expect(svc.kinds(auth([]))).toEqual([]);
    expect(svc.kinds(reader)[0]).toMatchObject({
      kind: 'demo.thing',
      canApply: false,
      operations: ['create', 'update', 'archive'],
    });
    expect(svc.kinds(admin)[0]!.canApply).toBe(true);
  });

  it('describes a kind with its input JSON Schema and guide', async () => {
    const d = await svc.describe('demo.thing', reader);
    expect(d.schema).toMatchObject({ type: 'object', properties: { name: { description: 'Name' } } });
    expect(d.schema.required).toEqual(['name']);
    expect(d.guide.examples).toHaveLength(1);
    expect(await code(svc.describe('demo.thing', auth([])))).toBe('FORBIDDEN');
    expect(await code(svc.describe('demo.nope', reader))).toBe('NOT_FOUND');
  });

  it('versions objects by value, whatever the key order', async () => {
    expect(versionOf({ a: 1, b: [1, { c: 2, d: 3 }] }, false)).toBe(
      versionOf({ b: [1, { d: 3, c: 2 }], a: 1 }, false),
    );
    expect(versionOf({ a: 1 }, false)).not.toBe(versionOf({ a: 1 }, true));
    expect(versionOf({ a: 1, b: undefined }, false)).toBe(versionOf({ a: 1 }, false));
    const a = await svc.get('demo.thing', 'a', reader);
    expect(a!.version).toBe(versionOf({ name: 'Alpha', size: 1 }, false));
  });

  it('validates the schema, the operation and the module’s own checks', async () => {
    expect(
      (await svc.validate('demo.thing', { op: 'create', id: null, value: { name: '' } }, reader)).issues[0],
    ).toMatchObject({
      path: 'name',
    });
    expect(
      (await svc.validate('demo.thing', { op: 'delete', id: 'a', value: null }, reader)).issues[0]!.code,
    ).toBe('operation');
    expect(
      (await svc.validate('demo.thing', { op: 'update', id: 'zz', value: { name: 'x' } }, reader)).issues[0]!
        .code,
    ).toBe('not_found');
    expect(
      (await svc.validate('demo.thing', { op: 'create', id: null, value: { name: 'taken' } }, reader))
        .issues[0]!.code,
    ).toBe('duplicate');
    const ok = await svc.validate('demo.thing', { op: 'create', id: null, value: { name: 'Beta' } }, reader);
    expect(ok).toMatchObject({ issues: [], value: { name: 'Beta', size: 1 } });
  });

  it('applies with the apply permission, refuses stale versions, and dry-runs as the proposer', async () => {
    expect(
      await code(
        svc.apply('demo.thing', { op: 'create', id: null, value: { name: 'Beta' } }, { auth: reader, tx }),
      ),
    ).toBe('FORBIDDEN');
    const before = await svc.get('demo.thing', 'a', admin);
    expect(
      await code(
        svc.apply(
          'demo.thing',
          { op: 'update', id: 'a', value: { name: 'Alpha', size: 2 }, baseVersion: 'old' },
          { auth: admin, tx },
        ),
      ),
    ).toBe('CHANGE_SET_STALE');
    const applied = await svc.apply(
      'demo.thing',
      { op: 'update', id: 'a', value: { name: 'Alpha', size: 2 }, baseVersion: before!.version },
      { auth: admin, tx },
    );
    expect(applied.before!.value).toEqual({ name: 'Alpha', size: 1 });
    expect(applied.after!.value).toEqual({ name: 'Alpha', size: 2 });

    // A dry run assumes the apply permission on top of the proposer's own.
    const dry = await svc.apply(
      'demo.thing',
      { op: 'archive', id: 'a', value: null },
      { auth: reader, tx, dryRun: true },
    );
    expect(dry.after!.archived).toBe(true);
    const last = seen.at(-1)!;
    expect(last.auth.can('demo.things.manage')).toBe(true);
    expect(last.auth.can('demo.things.read')).toBe(true);
    expect(last.auth.can('core.users.read')).toBe(false);
    expect(
      await code(svc.apply('demo.thing', { op: 'restore', id: 'a', value: null }, { auth: admin, tx })),
    ).toBe('resolved');
  });

  it('binds audit entries to the transaction, the applying person and the change set', async () => {
    const recorded: unknown[] = [];
    const ctx = {
      db: 'db',
      audit: {
        record: async (entry: unknown, opts: unknown) => void recorded.push([entry, opts]),
        diff: () => ({}),
      },
    } as unknown as ModuleContext;
    const bound = bindToTransaction(ctx, 'tx' as never, {
      principal: { type: 'user', id: 'u1', name: 'Ann' },
      source: { type: 'change-set', id: 'cs', reference: 'CS-00001' },
    });
    expect(bound.db).toBe('tx');
    await bound.audit.record({ action: 'demo.thing.updated', metadata: { a: 1 } });
    expect(recorded[0]).toEqual([
      {
        action: 'demo.thing.updated',
        metadata: { a: 1, source: { type: 'change-set', id: 'cs', reference: 'CS-00001' } },
      },
      { tx: 'tx', principal: { type: 'user', id: 'u1', name: 'Ann' } },
    ]);
  });
});

describe('MCP server', () => {
  const r = registry();
  const tools = new ToolRegistry(r, async () => undefined);
  const mcp = new McpServer({
    tools,
    customizations: new CustomizationRegistry(r).service(),
    version: '1.0.0',
    publicUrl: 'https://isbp.example.test',
  });
  const client = auth(['demo.things.read']);

  it('decodes base64-sentinel header values', () => {
    expect(decodeHeaderValue('=?base64?SGVsbG8sIOS4lueVjA==?=')).toBe('Hello, 世界');
    expect(decodeHeaderValue('plain')).toBe('plain');
  });

  it('offers non-destructive tools with wire names and annotations', async () => {
    const res = await mcp.handle({
      headers: { 'mcp-protocol-version': '2025-11-25' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      auth: client,
    });
    const listed = (res.body as { result: { tools: { name: string; annotations: object }[] } }).result.tools;
    expect(listed.map((t) => t.name)).toEqual(['demo__find_things']);
    expect(listed[0]!.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('gives the platform’s own agent the same surface, destructive tools behind a confirmation', async () => {
    const outside = mcp
      .session(client)
      .listTools()
      .map((t) => t.name);
    const inside = mcp.session(client, { includeDestructive: true, via: 'assistant' });
    expect(inside.listTools().map((t) => t.name)).toEqual(['demo__delete_all', 'demo__find_things']);
    expect(outside).toEqual(['demo__find_things']);
    expect(inside.listTools()[0]!.annotations.destructiveHint).toBe(true);
    const waiting = await inside.callTool('demo.delete_all', {});
    expect(waiting).toMatchObject({ isError: true, confirmationRequired: true });
    // Confirmed, it goes to the registry (which runs and audits it: covered by the integration tests).
    const ran = await inside.callTool('demo__delete_all', {}, { confirmed: true });
    expect(ran.confirmationRequired).toBeUndefined();
    // Over HTTP, destructive tools stay out of reach even by name.
    const http = await mcp.handle({
      headers: { 'mcp-protocol-version': '2025-11-25' },
      body: {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'demo__delete_all', arguments: {} },
      },
      auth: client,
    });
    expect((http.body as { error: { code: number } }).error.code).toBe(-32602);
  });

  it('answers notifications with 202, bad envelopes with 400 and names its versions', async () => {
    expect(
      (
        await mcp.handle({
          headers: {},
          body: { jsonrpc: '2.0', method: 'notifications/initialized' },
          auth: client,
        })
      ).status,
    ).toBe(202);
    expect((await mcp.handle({ headers: {}, body: { hello: 1 }, auth: client })).status).toBe(400);
    expect(SUPPORTED_VERSIONS[0]).toBe('2026-07-28');
    const batch = await mcp.handle({
      headers: {},
      body: [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ],
      auth: client,
    });
    expect(batch.body).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });
});
