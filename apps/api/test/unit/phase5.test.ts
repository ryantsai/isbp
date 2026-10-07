import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type AuthContext,
  type ConnectorHandler,
  defineManifest,
  defineServerModule,
  type DomainEvent,
  HttpError,
  type ModuleContext,
  type SyncAdapter,
  type SyncFieldDef,
} from '@isbp/sdk/server';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConnectorRegistry, fieldIssue, SyncRegistry } from '../../src/kernel/integrations';
import { ModuleRegistry } from '../../src/kernel/modules';
import { OutboundHttp } from '../../src/kernel/outbound';

const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
    return 'resolved';
  } catch (err) {
    return err instanceof HttpError ? err.code : String(err);
  }
};

function auth(patterns: string[]): AuthContext {
  return {
    principal: { type: 'ai_agent', id: null, name: 'Test agent' },
    user: null,
    sessionId: null,
    permissions: null as never,
    can: () => true,
    require: () => undefined,
    reach: (permission: string) => ({
      global: patterns.some(
        (p) => p === '*' || p === permission || (p === '*.*.sync' && permission.endsWith('.sync')),
      ),
      departmentIds: [],
      records: [],
    }),
  } as unknown as AuthContext;
}

const FIELDS: SyncFieldDef[] = [
  { key: 'title', label: 'demo.title', type: 'string', required: true, maxLength: 10 },
  {
    key: 'status',
    label: 'demo.status',
    type: 'choice',
    choices: [
      { value: 'open', label: 'o' },
      { value: 'done', label: 'd' },
    ],
  },
  {
    key: 'kind',
    label: 'demo.kind',
    type: 'choice',
    createOnly: true,
    choices: [{ value: 'a', label: 'a' }],
  },
  { key: 'ref', label: 'demo.ref', type: 'string', readOnly: true },
];

const writes: unknown[] = [];
const adapter: SyncAdapter = {
  fields: async () => FIELDS,
  read: async (id) => ({
    id,
    title: 'One',
    href: `/demo/${id}`,
    updatedAt: new Date(0).toISOString(),
    values: {},
  }),
  readMany: async () => [],
  list: async () => ({ items: [], next: null }),
  findBy: async (field, value) =>
    field === 'title' && value === 'One'
      ? { id: 'r1', title: 'One', href: '/demo/r1', updatedAt: new Date(0).toISOString(), values: {} }
      : null,
  matchKeys: ['title'],
  write: async (input) => {
    writes.push(input);
    return { id: input.id ?? 'new-id' };
  },
  idFromEvent: (e) => (e.payload as { id?: string }).id ?? null,
};

const demoManifest = defineManifest({
  id: 'demo',
  version: '1.0.0',
  name: 'demo.name',
  permissions: [{ key: 'demo.items.sync', name: 'demo.p', description: 'demo.pd' }],
  events: { emits: [{ name: 'demo.item.updated' }, { name: 'demo.item.commented' }] },
  syncEntities: [
    {
      entity: 'item',
      name: 'demo.items',
      permission: 'demo.items.sync',
      events: ['demo.item.updated'],
    },
  ],
});
const demo = defineServerModule(demoManifest, { sync: { item: adapter } });

const remoteManifest = defineManifest({
  id: 'remote',
  version: '1.0.0',
  name: 'remote.name',
  connectors: [
    {
      type: 'api',
      name: 'remote.connector',
      config: z.object({ baseUrl: z.url() }),
      secrets: z.object({ token: z.string().min(1) }),
      objects: [
        { type: 'thing', name: 'remote.thing', capabilities: { update: true } },
        { type: 'readonly', name: 'remote.readonly', capabilities: {} },
      ],
    },
  ],
});
const handler: ConnectorHandler<{ baseUrl: string }, { token: string }> = {
  hosts: (c) => [new URL(c.baseUrl).hostname],
  test: async (conn) => {
    const res = await conn.http.request(`${conn.config.baseUrl}/ping`, {
      headers: { authorization: `Bearer ${conn.secrets.token}` },
    });
    return { ok: res.status === 200, account: res.body.toString() };
  },
  fields: async () => [],
  changes: async () => ({ items: [], cursor: null, hasMore: false }),
  get: async () => null,
  update: async (_c, _t, id) => ({
    id,
    ref: `#${id}`,
    title: 't',
    url: null,
    version: '2',
    updatedAt: '',
    values: {},
  }),
};
const remote = defineServerModule(remoteManifest, { connectors: { api: handler } });

function registryOf() {
  const registry = new ModuleRegistry([demo, remote], null as never, pino({ level: 'silent' }));
  const ctx = {} as ModuleContext;
  registry.setContexts(
    new Map([
      ['demo', ctx],
      ['remote', ctx],
    ]),
  );
  return registry;
}

describe('sync entities and connectors in manifests', () => {
  it('refuses sync events the module does not emit, and adapters without declarations', () => {
    expect(() =>
      defineManifest({
        id: 'bad',
        version: '1.0.0',
        name: 'bad.name',
        syncEntities: [{ entity: 'x', name: 'bad.x', permission: 'bad.x.sync', events: ['bad.x.updated'] }],
      }),
    ).toThrow(/not in events.emits/);
    expect(() => defineServerModule(demoManifest, {})).toThrow(/has no adapter/);
    expect(() => defineServerModule(remoteManifest, {})).toThrow(/has no handler/);
    expect(() => defineServerModule(demoManifest, { sync: { item: adapter, other: adapter } })).toThrow(
      /not declared/,
    );
  });
});

describe('ctx.sync', () => {
  const registry = registryOf();
  const sync = new SyncRegistry(registry);
  const svc = sync.service();
  const agent = auth(['*.*.sync']);
  const tx = null as never;
  const source = { connectionId: 'c', connectionName: 'C', connector: 'remote.api', remoteRef: '#1' };

  it('lists entities with their permission, filtered by what the caller holds', () => {
    expect(svc.entities().map((e) => e.entity)).toEqual(['demo.item']);
    expect(svc.entities(agent)[0]).toMatchObject({ permission: 'demo.items.sync', matchKeys: ['title'] });
    expect(svc.entities(auth([]))).toEqual([]);
  });

  it('routes change events to the entity with the adapter-resolved id', () => {
    expect(sync.isSyncEvent('demo.item.updated')).toBe(true);
    expect(sync.isSyncEvent('demo.item.created')).toBe(false);
    const event = {
      id: 'e',
      name: 'demo.item.updated',
      moduleId: 'demo',
      payload: { id: 'r9' },
    } as DomainEvent;
    expect(sync.changesFor(event)).toEqual([{ entity: 'demo.item', id: 'r9', kind: 'record', event }]);
    expect(registry.subscribersOf('demo.item.updated')).toEqual([]);
    const consumer = defineServerModule(defineManifest({ id: 'hub', version: '1.0.0', name: 'hub.name' }), {
      onSyncChange: async () => undefined,
    });
    const withHub = new ModuleRegistry([demo, remote, consumer], null as never, pino({ level: 'silent' }));
    expect(withHub.subscribersOf('demo.item.updated').map((m) => m.manifest.id)).toEqual(['hub']);
    expect(withHub.subscribersOf('demo.item.created')).toEqual([]);
  });

  it('checks the permission and validates values before the adapter writes', async () => {
    writes.length = 0;
    expect(
      await code(svc.write('demo.item', { values: { title: 'x' } }, { auth: auth([]), tx, source })),
    ).toBe('FORBIDDEN');
    expect(
      await code(svc.write('demo.item', { values: { status: 'open' } }, { auth: agent, tx, source })),
    ).toBe('VALIDATION_FAILED'); // title required on create
    for (const values of [{ nope: 1 }, { ref: 'X' }, { status: 'gone' }, { title: 'much too long' }]) {
      expect(await code(svc.write('demo.item', { id: 'r1', values }, { auth: agent, tx, source }))).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(
      await code(svc.write('demo.item', { id: 'r1', values: { kind: 'a' } }, { auth: agent, tx, source })),
    ).toBe('VALIDATION_FAILED'); // create-only
    expect(writes).toEqual([]);
    // The record comes back as the module stored it (read in the same transaction).
    expect(
      await svc.write('demo.item', { values: { title: 'New', kind: 'a' } }, { auth: agent, tx, source }),
    ).toMatchObject({ id: 'new-id', record: { id: 'new-id', title: 'One' } });
    expect(
      await svc.write('demo.item', { id: 'r1', values: { status: null } }, { auth: agent, tx, source }),
    ).toMatchObject({ id: 'r1', record: { id: 'r1' } });
    expect(writes).toHaveLength(2);
  });

  it('matches only on declared keys and non-empty values', async () => {
    expect((await svc.findBy('demo.item', 'title', 'One'))?.id).toBe('r1');
    expect(await svc.findBy('demo.item', 'status', 'One')).toBeNull();
    expect(await svc.findBy('demo.item', 'title', '')).toBeNull();
    expect(await code(svc.read('nope.item', 'x'))).toBe('NOT_FOUND');
    expect(await code(svc.comments.list('demo.item', 'x'))).toBe('NOT_SUPPORTED');
  });

  it('describes field value problems', () => {
    expect(fieldIssue({ key: 'd', label: 'd', type: 'date' }, '2026-10-07')).toBeNull();
    expect(fieldIssue({ key: 'd', label: 'd', type: 'date' }, '2026-10-07T00:00:00Z')).toMatch(/YYYY/);
    expect(fieldIssue({ key: 't', label: 't', type: 'tags' }, ['a', 1])).toMatch(/strings/);
    expect(fieldIssue({ key: 'u', label: 'u', type: 'user' }, 'bob')).toMatch(/id/);
    expect(fieldIssue({ key: 'n', label: 'n', type: 'number' }, Number.NaN)).toMatch(/number/);
    expect(fieldIssue({ key: 'j', label: 'j', type: 'json' }, { any: true })).toBeNull();
  });
});

describe('ctx.connectors', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => res.end(req.headers.authorization ?? 'anonymous'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const fakeRedis = null as never;
  const connectors = () =>
    new ConnectorRegistry(registryOf(), new OutboundHttp(false).client(), fakeRedis).service();

  it('lists connector types with JSON Schemas and secret keys, never values', () => {
    const [info] = connectors().list();
    expect(info).toMatchObject({ type: 'remote.api', secretKeys: ['token'] });
    expect(info!.objects.find((o) => o.type === 'thing')!.capabilities).toMatchObject({
      update: true,
      create: false,
    });
  });

  it('validates settings and secrets with the connector schemas', async () => {
    const svc = connectors();
    expect(await code(() => svc.validate('remote.api', { baseUrl: 'nope' }, {}))).toBe('VALIDATION_FAILED');
    expect(svc.validate('remote.api', { baseUrl: base }, { token: 't' })).toEqual({
      config: { baseUrl: base },
      secrets: { token: 't' },
    });
    expect(await code(() => svc.validate('remote.missing', {}, {}))).toBe('NOT_FOUND');
  });

  it('lets a connection reach its own (private) host and nothing else', async () => {
    const conn = connectors().open('remote.api', {
      id: 'c1',
      config: { baseUrl: base },
      secrets: { token: 'tok' },
    });
    expect(conn.hosts()).toEqual(['localhost']);
    // Private addresses are allowed for the connection's own host even with the global guard on.
    expect(await conn.test()).toEqual({ ok: true, account: 'Bearer tok' });
    const other = connectors().open('remote.api', {
      id: 'c2',
      config: { baseUrl: 'https://example.com' },
      secrets: { token: 'tok' },
    });
    // The handler asks for example.com, but its http client only allows example.com: fine. A handler that
    // follows a data-driven URL elsewhere is refused.
    const evil: ConnectorHandler = {
      ...(handler as unknown as ConnectorHandler),
      test: async (c) => {
        await c.http.request(`${base}/steal`);
        return { ok: true };
      },
    };
    (remote.connectors as Record<string, ConnectorHandler>).api = evil;
    try {
      const reopened = connectors().open('remote.api', {
        id: 'c3',
        config: { baseUrl: 'https://example.com' },
        secrets: { token: 'tok' },
      });
      expect(await code(reopened.test())).toBe('TARGET_BLOCKED');
    } finally {
      (remote.connectors as Record<string, ConnectorHandler>).api = handler as unknown as ConnectorHandler;
    }
    expect(other.hosts()).toEqual(['example.com']);
  });

  it('refuses plain HTTP to non-loopback hosts unless the connection explicitly allows it', async () => {
    const plain = (allowInsecureHttp?: boolean) =>
      connectors().open('remote.api', {
        id: 'c4',
        config: { baseUrl: 'http://sdp.contoso.example:8080' },
        secrets: { token: 't' },
        allowInsecureHttp,
      });
    expect(await code(plain().test())).toBe('INSECURE_HTTP');
    expect(await code(plain(false).test())).toBe('INSECURE_HTTP');
    // Allowed: the scheme check passes and the call goes on to DNS/connect (which fails here).
    expect(await code(plain(true).test())).not.toBe('INSECURE_HTTP');
    // Loopback stays allowed over HTTP (the development stand-ins).
    const local = connectors().open('remote.api', {
      id: 'c5',
      config: { baseUrl: base },
      secrets: { token: 't' },
    });
    expect((await local.test()).ok).toBe(true);
  });

  it('refuses operations an object type does not support', async () => {
    const conn = connectors().open('remote.api', {
      id: 'c1',
      config: { baseUrl: base },
      secrets: { token: 't' },
    });
    expect(await code(conn.create('thing', {}, {}))).toBe('NOT_SUPPORTED');
    expect(await code(conn.update('readonly', '1', {}, {}))).toBe('NOT_SUPPORTED');
    expect((await conn.update('thing', '7', {}, {})).ref).toBe('#7');
    expect(await code(conn.comments.list('thing', '1'))).toBe('NOT_SUPPORTED');
    expect(await code(conn.get('missing-type', '1'))).toBe('NOT_FOUND');
    expect(await code(conn.webhook({ headers: {}, body: {} }))).toBe('NOT_SUPPORTED');
  });
});
