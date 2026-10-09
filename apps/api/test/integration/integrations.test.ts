/**
 * Integrations Hub against an inline fake connector (an in-memory remote system with versions, a change
 * feed, optimistic concurrency, comments, webhooks, rate limiting and auth failures) and an inline fake data
 * module (a sync entity backed by an in-memory store), so the hub is tested on its own.
 *
 *   DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_hub_test REDIS_URL=redis://localhost:6379/11 \
 *   ISBP_TEST_MODULES=integrations npx vitest run --project integration test/integration/integrations.test.ts
 */
import { randomUUID } from 'node:crypto';
import { auditLogs, notifications, roleAssignments, roles, users } from '@isbp/db/schema';
import { hubAuth, services } from '@isbp/module-integrations/server';
import { conflicts, connections, links, pendingPushes, runs } from '@isbp/module-integrations/schema';
import {
  type ConnectorContext,
  defineManifest,
  defineServerModule,
  ErrorCodes,
  HttpError,
  type ModuleContext,
  type RemoteComment,
  type RemoteRecord,
  type SyncComment,
  type SyncRecord,
} from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

const API = '/api/v1/integrations';
const MODULES = process.env.ISBP_TEST_MODULES;

/* ───────────────────────────── the fake data module ───────────────────────────── */

interface Item {
  id: string;
  ref: string;
  title: string;
  description: string | null;
  status: string;
  owner: string | null;
  tags: string[];
  parent: string | null;
  due: string | null;
  updatedAt: string;
  comments: SyncComment[];
}

const store = new Map<string, Item>();
let itemSeq = 0;
/** Runs once right after the next read of that item: "someone edits it while the sync works on it". */
let onRead: { id: string; fn: () => void } | null = null;

const recordOf = (i: Item): SyncRecord => ({
  id: i.id,
  ref: i.ref,
  title: i.title,
  href: `/itest/${i.id}`,
  updatedAt: i.updatedAt,
  values: {
    title: i.title,
    description: i.description,
    status: i.status,
    owner: i.owner,
    tags: i.tags,
    parent: i.parent,
    due: i.due,
    ref: i.ref,
  },
});

const itemEvent = z.object({ itemId: z.uuid() });

const dataModule = defineServerModule(
  defineManifest({
    id: 'itest-data',
    version: '1.0.0',
    name: 'Test data',
    permissions: [
      { key: 'itest-data.items.read', description: 'Read items' },
      { key: 'itest-data.items.sync', description: 'Sync items' },
    ],
    roles: [
      {
        key: 'itest-hub-operator',
        name: 'Hub operator without entity sync',
        permissions: ['integrations.connections.read', 'integrations.connections.manage'],
      },
      { key: 'itest-reader', name: 'Item reader', permissions: ['itest-data.items.read'] },
    ],
    events: {
      emits: [
        { name: 'itest-data.item.created', schema: itemEvent },
        { name: 'itest-data.item.updated', schema: itemEvent },
        { name: 'itest-data.comment.added', schema: itemEvent },
      ],
    },
    records: { types: [{ type: 'item', name: 'Items', permission: 'itest-data.items.read' }] },
    syncEntities: [
      {
        entity: 'item',
        name: 'Items',
        permission: 'itest-data.items.sync',
        events: ['itest-data.item.created', 'itest-data.item.updated'],
        commentEvents: ['itest-data.comment.added'],
      },
    ],
  }),
  {
    records: {
      item: {
        resolve: async (ids, _ctx, auth) =>
          auth.can('itest-data.items.read')
            ? ids
                .map((id) => store.get(id))
                .filter((i): i is Item => Boolean(i))
                .map((i) => ({
                  id: i.id,
                  reference: i.ref,
                  title: i.title,
                  href: `/itest/${i.id}`,
                  editable: false,
                }))
            : [],
        search: async () => [],
      },
    },
    sync: {
      item: {
        fields: async () => [
          { key: 'title', label: { en: 'Title' }, type: 'string', required: true, maxLength: 200 },
          { key: 'description', label: { en: 'Description' }, type: 'markdown' },
          {
            key: 'status',
            label: { en: 'Status' },
            type: 'choice',
            choices: ['open', 'in_progress', 'done', 'archived'].map((value) => ({ value, label: value })),
          },
          { key: 'owner', label: { en: 'Owner' }, type: 'user' },
          { key: 'tags', label: { en: 'Tags' }, type: 'tags' },
          { key: 'parent', label: { en: 'Parent' }, type: 'parent' },
          { key: 'due', label: { en: 'Due' }, type: 'date' },
          { key: 'ref', label: { en: 'Reference' }, type: 'string', readOnly: true },
        ],
        read: async (id) => {
          const i = store.get(id);
          const record = i ? recordOf(i) : null;
          if (onRead?.id === id) {
            const { fn } = onRead;
            onRead = null;
            fn();
          }
          return record;
        },
        readMany: async (ids) => ids.flatMap((id) => (store.get(id) ? [recordOf(store.get(id)!)] : [])),
        list: async ({ after, limit }) => {
          const all = [...store.values()].sort((a, b) => a.ref.localeCompare(b.ref));
          const start = after ? all.findIndex((i) => i.id === after) + 1 : 0;
          const page = all.slice(start, start + limit);
          return { items: page.map(recordOf), next: start + limit < all.length ? page.at(-1)!.id : null };
        },
        matchKeys: ['title'],
        findBy: async (field, value) => {
          const found = [...store.values()].filter(
            (i) => field === 'title' && i.title.toLowerCase() === String(value).toLowerCase(),
          );
          return found.length === 1 ? recordOf(found[0]!) : null;
        },
        write: async (input, opts, ctx) => {
          if (input.values.status === 'archived')
            throw new HttpError(409, ErrorCodes.INVALID_TRANSITION, 'Archiving needs an approval');
          let item: Item;
          if (input.id) {
            item = store.get(input.id)!;
            Object.assign(item, input.values);
          } else {
            itemSeq++;
            item = {
              id: randomUUID(),
              ref: `ITM-${String(itemSeq).padStart(3, '0')}`,
              title: '',
              description: null,
              status: 'open',
              owner: null,
              tags: [],
              parent: null,
              due: null,
              updatedAt: '',
              comments: [],
              ...(input.values as Partial<Item>),
            };
            store.set(item.id, item);
          }
          item.updatedAt = new Date().toISOString();
          await ctx.events.publish(
            input.id ? 'itest-data.item.updated' : 'itest-data.item.created',
            { itemId: item.id },
            { tx: opts.tx },
          );
          return { id: item.id };
        },
        idFromEvent: (event) => (event.payload as { itemId?: string }).itemId ?? null,
        comments: {
          list: async (id) => store.get(id)?.comments ?? [],
          add: async (id, comment, opts, ctx) => {
            const c: SyncComment = {
              id: randomUUID(),
              body: comment.body,
              authorName: comment.authorName,
              authorEmail: comment.authorEmail ?? null,
              createdAt: comment.createdAt ?? new Date().toISOString(),
              internal: comment.internal ?? false,
            };
            store.get(id)!.comments.push(c);
            await ctx.events.publish('itest-data.comment.added', { itemId: id }, { tx: opts.tx });
            return { id: c.id };
          },
        },
      },
    },
  },
);

/* ───────────────────────────── the fake remote system ───────────────────────────── */

interface Ticket {
  id: string;
  number: number;
  version: number;
  seq: number;
  updatedAt: string;
  deleted?: boolean;
  parentId: string | null;
  values: Record<string, unknown>;
  comments: RemoteComment[];
}

const remote = {
  tickets: new Map<string, Ticket>(),
  seq: 0,
  number: 1000,
  updates: 0,
  creates: 0,
  rateLimitNext: 0,
  changesCalls: 0,
  /** Runs once after the next update is written and before its answer: "someone edits it meanwhile". */
  onUpdate: null as ((t: Ticket) => void) | null,
};

function touch(t: Ticket) {
  t.version++;
  t.seq = ++remote.seq;
  t.updatedAt = new Date(Date.now() + 1).toISOString();
}

function remoteCreate(values: Record<string, unknown>, parentId: string | null = null): Ticket {
  const t: Ticket = {
    id: `T${++remote.number}`,
    number: remote.number,
    version: 0,
    seq: 0,
    updatedAt: '',
    parentId,
    values: {
      subject: '',
      body: '',
      state: 'New',
      assignee: null,
      labels: '',
      due: null,
      isbpRef: null,
      ...values,
    },
    comments: [],
  };
  touch(t);
  remote.tickets.set(t.id, t);
  return t;
}

/** "Someone edits the ticket in the remote system." */
function remoteEdit(id: string, values: Record<string, unknown>) {
  const t = remote.tickets.get(id)!;
  Object.assign(t.values, values);
  touch(t);
  return t;
}

const asRecord = (t: Ticket): RemoteRecord => ({
  id: t.id,
  ref: `#${t.number}`,
  title: String(t.values.subject),
  url: `https://fake.example.test/tickets/${t.number}`,
  version: String(t.version),
  updatedAt: t.updatedAt,
  parentId: t.parentId,
  deleted: t.deleted ?? false,
  values: { ...t.values, parent: t.parentId },
});

type Conn = ConnectorContext<{ baseUrl: string; project: string }, { token: string }>;

function checkAuth(conn: Conn) {
  if (conn.secrets.token === 'expired')
    throw new HttpError(502, ErrorCodes.REMOTE_AUTH_FAILED, 'Token expired');
}

const remoteModule = defineServerModule(
  defineManifest({
    id: 'itest-remote',
    version: '1.0.0',
    name: 'Test remote',
    connectors: [
      {
        type: 'fake',
        name: 'Fake system',
        icon: 'plug',
        config: z.object({ baseUrl: z.string().url(), project: z.string().default('demo') }),
        secrets: z.object({ token: z.string().min(1), extra: z.string().optional() }),
        objects: [
          {
            type: 'ticket',
            name: 'Tickets',
            entities: ['itest-data.item'],
            capabilities: { create: true, update: true, comments: true, webhooks: true, hierarchy: true },
          },
        ],
      },
    ],
  }),
  {
    connectors: {
      fake: {
        hosts: (config: { baseUrl: string }) => [new URL(config.baseUrl).hostname],
        test: async (conn: Conn) => {
          // A plain-HTTP server goes through the platform's HTTP client (the scheme check lives there).
          if (conn.config.baseUrl.startsWith('http://')) {
            const res = await conn.http.request(`${conn.config.baseUrl}/ping`, { timeoutMs: 3_000 });
            return { ok: res.status < 400, account: 'http' };
          }
          return conn.secrets.token === 'good'
            ? { ok: true, account: `svc@${conn.config.project}` }
            : { ok: false, message: 'The token was refused' };
        },
        fields: async () => [
          { key: 'subject', label: 'Subject', type: 'string', required: true },
          { key: 'body', label: 'Body', type: 'html' },
          {
            key: 'state',
            label: 'State',
            type: 'choice',
            choices: ['New', 'Active', 'Closed', 'Frozen'].map((value) => ({ value, label: value })),
          },
          { key: 'assignee', label: 'Assignee', type: 'user' },
          { key: 'labels', label: 'Labels', type: 'string' },
          { key: 'parent', label: 'Parent', type: 'parent' },
          { key: 'due', label: 'Due', type: 'datetime' },
          { key: 'isbpRef', label: 'ISBP reference', type: 'string' },
        ],
        changes: async (conn: Conn, _type: string, opts: { cursor: string | null; limit: number }) => {
          checkAuth(conn);
          remote.changesCalls++;
          if (remote.rateLimitNext > 0) {
            remote.rateLimitNext--;
            throw new HttpError(429, ErrorCodes.REMOTE_RATE_LIMITED, 'Slow down', { retryAfterSeconds: 1 });
          }
          const after = Number(opts.cursor ?? 0);
          const all = [...remote.tickets.values()].filter((t) => t.seq > after).sort((a, b) => a.seq - b.seq);
          const page = all.slice(0, opts.limit);
          return {
            items: page.map(asRecord),
            cursor: page.length ? String(page.at(-1)!.seq) : opts.cursor,
            hasMore: all.length > page.length,
          };
        },
        get: async (conn: Conn, _type: string, id: string) => {
          checkAuth(conn);
          const t = remote.tickets.get(id);
          return t && !t.deleted ? asRecord(t) : null;
        },
        create: async (
          conn: Conn,
          _type: string,
          values: Record<string, unknown>,
          opts: { parentId?: string | null },
        ) => {
          checkAuth(conn);
          remote.creates++;
          const { parent: _parent, ...rest } = values;
          return asRecord(remoteCreate(rest, opts.parentId ?? null));
        },
        update: async (
          conn: Conn,
          _type: string,
          id: string,
          values: Record<string, unknown>,
          opts: { expectedVersion?: string | null },
        ) => {
          checkAuth(conn);
          const t = remote.tickets.get(id);
          if (!t) throw new HttpError(422, ErrorCodes.REMOTE_REJECTED, 'No such ticket');
          if (opts.expectedVersion && opts.expectedVersion !== String(t.version))
            throw new HttpError(409, ErrorCodes.REMOTE_CONFLICT, 'Changed meanwhile');
          remote.updates++;
          const { parent, ...rest } = values;
          if (parent !== undefined) t.parentId = (parent as string | null) ?? null;
          // The remote system wraps plain bodies in a paragraph (a lossy round trip the snapshot absorbs).
          if (typeof rest.body === 'string' && rest.body && !rest.body.startsWith('<'))
            rest.body = `<p>${rest.body}</p>`;
          Object.assign(t.values, rest);
          touch(t);
          const meanwhile = remote.onUpdate;
          remote.onUpdate = null;
          meanwhile?.(t);
          return asRecord(t);
        },
        comments: {
          list: async (_conn: Conn, _type: string, id: string) => remote.tickets.get(id)?.comments ?? [],
          add: async (
            _conn: Conn,
            _type: string,
            id: string,
            c: { body: string; format: 'html' | 'text' | 'markdown'; internal?: boolean },
          ) => {
            const rc: RemoteComment = {
              id: `C${randomUUID().slice(0, 8)}`,
              body: c.body,
              format: c.format,
              author: { email: 'svc@fake.example.test', name: 'Service account' },
              createdAt: new Date().toISOString(),
              internal: c.internal,
            };
            remote.tickets.get(id)!.comments.push(rc);
            return rc;
          },
        },
        webhook: async (_conn: Conn, req: { body: unknown }) =>
          ((req.body as { ids?: string[] })?.ids ?? []).map((id) => ({ objectType: 'ticket', id })),
        defaultMapping: () => [
          { local: 'title', remote: 'subject', direction: 'both' },
          { local: 'description', remote: 'body', direction: 'both' },
          {
            local: 'status',
            remote: 'state',
            direction: 'both',
            values: [
              { remote: 'New', local: 'open' },
              { remote: 'Active', local: 'in_progress' },
              { remote: 'Closed', local: 'done' },
            ],
          },
          { local: 'owner', remote: 'assignee', direction: 'both' },
          { local: 'tags', remote: 'labels', direction: 'both' },
          { local: 'parent', remote: 'parent', direction: 'both' },
          { local: 'due', remote: 'due', direction: 'both' },
          { local: 'ref', remote: 'isbpRef', direction: 'push' },
          { local: 'nope', remote: 'subject', direction: 'both' },
        ],
      },
    },
  },
);

/* ───────────────────────────── harness ───────────────────────────── */

let h: Harness;
let ctx: ModuleContext;
let dataCtx: ModuleContext;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'dana' | 'operator' | 'hubAdmin' | 'reader', string>;
let connectionId: string;
let webhookSecret: string;
let profileId: string;

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(username: string, email = `${username}@test.example`, role?: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({ email, username, displayName: username, passwordHash: await hashPassword(PASSWORD) })
    .returning();
  if (role) {
    const [r] = await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, role));
    await h.kernel.db.insert(roleAssignments).values({ roleId: r!.id, userId: u!.id });
  }
  return u!.id;
}

/** "Someone edits the item in ISBP" (publishes the module's event, like a real edit). */
async function localEdit(id: string, values: Partial<Item>, opts: { event?: boolean } = {}) {
  const item = store.get(id)!;
  Object.assign(item, values);
  item.updatedAt = new Date().toISOString();
  if (opts.event !== false)
    await dataCtx.transaction((tx) =>
      dataCtx.events.publish('itest-data.item.updated', { itemId: id }, { tx }),
    );
}

const byTitle = (title: string) => [...store.values()].find((i) => i.title === title);
const linkOf = async (remoteId: string) =>
  (await h.kernel.db.select().from(links).where(eq(links.remoteId, remoteId)))[0];
const runPull = () => services(ctx).engine.runNow(profileId);
const getRun = async (id: string) => (await h.call(s.admin!, 'GET', `${API}/runs/${id}`)).body as LooseJson;
const waitRun = (id: string) =>
  eventually(
    () => getRun(id),
    (r) => ['succeeded', 'partial', 'failed'].includes(r.status),
    30_000,
  );
/** Waits until queued pushes are done (and the push runs they started finished). */
async function settlePushes() {
  await eventually(
    async () => {
      const pending = await h.kernel.db.select().from(pendingPushes);
      const active = await h.kernel.db
        .select()
        .from(runs)
        .where(and(eq(runs.kind, 'push')));
      return pending.length + active.filter((r) => ['queued', 'running'].includes(r.status)).length;
    },
    (n) => n === 0,
    20_000,
  );
  await new Promise((r) => setTimeout(r, 400));
  await eventually(
    async () => (await h.kernel.db.select().from(pendingPushes)).length,
    (n) => n === 0,
    10_000,
  );
}

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? 'integrations';
  try {
    h = await createHarness({ extraModules: [dataModule, remoteModule] });
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  ctx = h.kernel.registry.context('integrations');
  dataCtx = h.kernel.registry.context('itest-data');
  ids.dana = await mkUser('dana', 'Dana.Lee@corp.example');
  ids.operator = await mkUser('operator', undefined, 'itest-hub-operator');
  ids.hubAdmin = await mkUser('hubadmin', undefined, 'integrations-admin');
  ids.reader = await mkUser('reader', undefined, 'itest-reader');
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'outsider', 'operator', 'hubadmin', 'reader']) s[u] = await h.login(u);
  stopWorker = await startWorker(h.kernel);
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

/* ───────────────────────────── tests ───────────────────────────── */

describe('connections', () => {
  it('lists the connector types and the sync entities', async () => {
    const res = await h.call(s.admin!, 'GET', `${API}/connectors`);
    expect(res.status).toBe(200);
    expect(res.body.connectors.map((c: LooseJson) => c.type)).toContain('itest-remote.fake');
    const fake = res.body.connectors.find((c: LooseJson) => c.type === 'itest-remote.fake');
    expect(fake.secretKeys).toEqual(['token', 'extra']);
    expect(res.body.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'itest-data.item',
          comments: true,
          recordType: true,
          canConfigure: true,
        }),
      ]),
    );
    expect((await h.call(s.outsider!, 'GET', `${API}/connectors`)).status).toBe(403);
  });

  it('creates a connection: secrets sealed and never returned, the webhook secret shown once', async () => {
    const bad = await h.call(s.admin!, 'POST', `${API}/connections`, {
      name: 'Fake',
      type: 'itest-remote.fake',
      config: { baseUrl: 'ftp://fake.example.test' },
      secrets: { token: 'good' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues[0].path).toBe('config.baseUrl');
    const missing = await h.call(s.admin!, 'POST', `${API}/connections`, {
      name: 'Fake',
      type: 'itest-remote.fake',
      config: { baseUrl: 'https://fake.example.test' },
    });
    expect(missing.status).toBe(400);

    const res = await h.call(s.admin!, 'POST', `${API}/connections`, {
      name: 'Fake system',
      type: 'itest-remote.fake',
      config: { baseUrl: 'https://fake.example.test' },
      secrets: { token: 'good', extra: '' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    connectionId = res.body.id;
    webhookSecret = res.body.webhookSecret;
    expect(webhookSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.storedSecrets).toEqual(['token']);
    expect(res.body.config).toEqual({ baseUrl: 'https://fake.example.test', project: 'demo' });
    expect(JSON.stringify(res.body)).not.toContain('good');

    const [row] = await h.kernel.db.select().from(connections).where(eq(connections.id, connectionId));
    expect(row!.secretsSealed).toBeTruthy();
    expect(row!.secretsSealed).not.toContain('good');
    expect(row!.webhookSecretHash).toHaveLength(64);
    expect(row!.webhookSecretHash).not.toBe(webhookSecret);

    const got = await h.call(s.admin!, 'GET', `${API}/connections/${connectionId}`);
    expect(got.body.webhookSecret).toBeUndefined();
    expect(got.body.webhook).toMatchObject({ path: `${API}/hooks/${connectionId}`, secretSet: true });
    expect(JSON.stringify(got.body)).not.toContain('good');

    const dup = await h.call(s.admin!, 'POST', `${API}/connections`, {
      name: 'FAKE SYSTEM',
      type: 'itest-remote.fake',
      config: { baseUrl: 'https://fake.example.test' },
      secrets: { token: 'x' },
    });
    expect(dup.status).toBe(409);

    const audits = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'integrations.connection.created'), eq(auditLogs.entityId, connectionId)),
      );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain('good');
  });

  it('tests saved and unsaved settings, and records the health', async () => {
    const ok = await h.call(s.admin!, 'POST', `${API}/connections/${connectionId}/test`);
    expect(ok.body).toMatchObject({ ok: true, account: 'svc@demo' });
    const got = await h.call(s.admin!, 'GET', `${API}/connections/${connectionId}`);
    expect(got.body).toMatchObject({ health: 'ok', account: 'svc@demo' });

    const wrong = await h.call(s.admin!, 'POST', `${API}/connections/test`, {
      id: connectionId,
      type: 'itest-remote.fake',
      config: { baseUrl: 'https://fake.example.test' },
      secrets: { token: 'wrong' },
    });
    expect(wrong.body).toMatchObject({ ok: false, message: 'The token was refused' });
    // Empty secrets reuse the stored ones.
    const reuse = await h.call(s.admin!, 'POST', `${API}/connections/test`, {
      id: connectionId,
      type: 'itest-remote.fake',
      config: { baseUrl: 'https://fake.example.test', project: 'other' },
      secrets: { token: '' },
    });
    expect(reuse.body).toMatchObject({ ok: true, account: 'svc@other' });
    expect((await h.call(s.reader!, 'POST', `${API}/connections/${connectionId}/test`)).status).toBe(403);
  });

  it('updates settings: typed secrets replace stored ones, empty ones keep them', async () => {
    const res = await h.call(s.admin!, 'PATCH', `${API}/connections/${connectionId}`, {
      name: 'Fake helpdesk',
      secrets: { token: '', extra: 'more' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.name).toBe('Fake helpdesk');
    expect(res.body.storedSecrets).toEqual(['extra', 'token']);
    const removed = await h.call(s.admin!, 'PATCH', `${API}/connections/${connectionId}`, {
      removeSecrets: ['extra'],
    });
    expect(removed.body.storedSecrets).toEqual(['token']);
    const stillOk = await h.call(s.admin!, 'POST', `${API}/connections/${connectionId}/test`);
    expect(stillOk.body.ok).toBe(true);
  });

  it('refuses plain HTTP unless the connection allows insecure HTTP (an audited security decision)', async () => {
    const created = await h.call(s.admin!, 'POST', `${API}/connections`, {
      name: 'On-premises helpdesk',
      type: 'itest-remote.fake',
      config: { baseUrl: 'http://sdp.contoso.example:8080' },
      secrets: { token: 'good' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.allowInsecureHttp).toBe(false);
    const id = created.body.id as string;
    const off = await h.call(s.admin!, 'POST', `${API}/connections/${id}/test`);
    expect(off.body).toMatchObject({ ok: false, code: 'INSECURE_HTTP' });
    expect((await h.call(s.admin!, 'GET', `${API}/connections/${id}`)).body.health).toBe('failing');

    // Drafts follow the switch too.
    const draftOff = await h.call(s.admin!, 'POST', `${API}/connections/test`, {
      type: 'itest-remote.fake',
      config: { baseUrl: 'http://sdp.contoso.example:8080' },
      secrets: { token: 'good' },
    });
    expect(draftOff.body.code).toBe('INSECURE_HTTP');
    const draftOn = await h.call(s.admin!, 'POST', `${API}/connections/test`, {
      type: 'itest-remote.fake',
      config: { baseUrl: 'http://sdp.contoso.example:8080' },
      secrets: { token: 'good' },
      allowInsecureHttp: true,
    });
    expect(draftOn.body.ok).toBe(false);
    expect(draftOn.body.code).not.toBe('INSECURE_HTTP');

    expect(
      (await h.call(s.reader!, 'PATCH', `${API}/connections/${id}`, { allowInsecureHttp: true })).status,
    ).toBe(403);
    const on = await h.call(s.admin!, 'PATCH', `${API}/connections/${id}`, { allowInsecureHttp: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ allowInsecureHttp: true, health: 'unknown' });
    const tested = await h.call(s.admin!, 'POST', `${API}/connections/${id}/test`);
    // Past the scheme check: what fails now is the network (the host doesn't exist).
    expect(tested.body.ok).toBe(false);
    expect(tested.body.code).not.toBe('INSECURE_HTTP');
    expect(['UPSTREAM_FAILED', 'TARGET_BLOCKED']).toContain(tested.body.code);

    await h.call(s.admin!, 'PATCH', `${API}/connections/${id}`, { allowInsecureHttp: false });
    const audits = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'integrations.connection.insecure_http_changed'),
          eq(auditLogs.entityId, id),
        ),
      );
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.category === 'security')).toBe(true);
    expect(audits.map((a) => (a.changes as Record<string, unknown>).allowInsecureHttp)).toEqual(
      expect.arrayContaining([
        [false, true],
        [true, false],
      ]),
    );

    // Allowed from the start: audited on create.
    const insecure = await h.call(s.admin!, 'POST', `${API}/connections`, {
      name: 'Lab helpdesk',
      type: 'itest-remote.fake',
      config: { baseUrl: 'http://lab.contoso.example' },
      secrets: { token: 'good' },
      allowInsecureHttp: true,
    });
    expect(insecure.body.allowInsecureHttp).toBe(true);
    const onCreate = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'integrations.connection.insecure_http_changed'),
          eq(auditLogs.entityId, insecure.body.id),
        ),
      );
    expect(onCreate).toHaveLength(1);
    for (const c of [id, insecure.body.id])
      expect((await h.call(s.admin!, 'DELETE', `${API}/connections/${c}`)).status).toBe(204);
  });

  it('rotates the webhook secret (shown once)', async () => {
    const res = await h.call(s.admin!, 'POST', `${API}/connections/${connectionId}/webhook-secret`);
    expect(res.status).toBe(200);
    expect(res.body.webhookSecret).not.toBe(webhookSecret);
    webhookSecret = res.body.webhookSecret;
  });

  it('reads the remote catalogue', async () => {
    const fields = await h.call(
      s.admin!,
      'GET',
      `${API}/connections/${connectionId}/fields?objectType=ticket`,
    );
    expect(fields.body.items.map((f: LooseJson) => f.key)).toContain('subject');
    const local = await h.call(s.admin!, 'GET', `${API}/entities/itest-data.item/fields`);
    expect(local.body.items.map((f: LooseJson) => f.key)).toContain('owner');
  });
});

describe('profiles', () => {
  const draft = () => ({
    connectionId,
    name: 'Tickets ↔ items',
    objectType: 'ticket',
    entity: 'itest-data.item',
    direction: 'both',
    createLocal: true,
    createRemote: true,
    conflictPolicy: 'manual',
    comments: true,
    intervalMinutes: 0,
    matchRule: { local: 'title', remote: 'subject' },
    pushFilter: [{ field: 'status', op: 'neq', value: 'done' }],
  });

  it('suggests the default mapping without fields a catalogue lacks', async () => {
    const res = await h.call(
      s.admin!,
      'GET',
      `${API}/profiles/default-mapping?connectionId=${connectionId}&objectType=ticket&entity=itest-data.item`,
    );
    expect(res.status).toBe(200);
    expect(res.body.dropped).toBe(1);
    expect(res.body.mappings).toHaveLength(8);
  });

  it('refuses a profile that writes an entity the caller can’t sync (no escalation through the hub)', async () => {
    const mappings = (
      await h.call(
        s.admin!,
        'GET',
        `${API}/profiles/default-mapping?connectionId=${connectionId}&objectType=ticket&entity=itest-data.item`,
      )
    ).body.mappings;
    const denied = await h.call(s.operator!, 'POST', `${API}/profiles`, { ...draft(), mappings });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    expect((await h.call(s.reader!, 'POST', `${API}/profiles`, { ...draft(), mappings })).status).toBe(403);
  });

  it('validates mappings against both catalogues', async () => {
    const res = await h.call(s.admin!, 'POST', `${API}/profiles`, {
      ...draft(),
      mappings: [
        { local: 'title', remote: 'subject' },
        { local: 'nope', remote: 'body' },
        { local: 'status', remote: 'state', values: [{ remote: 'Gone', local: 'open' }] },
        { local: 'due', remote: 'assignee' },
      ],
    });
    expect(res.status).toBe(400);
    const codes = res.body.error.details.issues.map((i: LooseJson) => `${i.path}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'mappings.1.local:unknown_local',
        'mappings.2.values.0.remote:unknown_remote_choice',
        'mappings.3.remote:incompatible',
      ]),
    );
  });

  it('creates a profile with the integrations admin role', async () => {
    const mappings = (
      await h.call(
        s.admin!,
        'GET',
        `${API}/profiles/default-mapping?connectionId=${connectionId}&objectType=ticket&entity=itest-data.item`,
      )
    ).body.mappings;
    const res = await h.call(s.hubadmin!, 'POST', `${API}/profiles`, { ...draft(), mappings });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    profileId = res.body.id;
    expect(res.body).toMatchObject({ direction: 'both', canEdit: true, cursor: null });
    const audit = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'integrations.profile.created'), eq(auditLogs.entityId, profileId)));
    expect(audit).toHaveLength(1);
    // The operator can't change it either.
    expect((await h.call(s.operator!, 'PATCH', `${API}/profiles/${profileId}`, { name: 'x' })).status).toBe(
      403,
    );
  });
});

describe('sync', () => {
  let parentT: string;
  let childT: string;
  let soloT: string;

  it('previews the first changes without writing or moving the cursor', async () => {
    childT = remoteCreate({ subject: 'Child task', body: '<p>Do <b>this</b></p>', state: 'Active' }).id;
    parentT = remoteCreate({
      subject: 'Parent epic',
      body: '<h2>Goal</h2><script>alert(1)</script><p>Ship it</p>',
      state: 'New',
      assignee: { email: 'dana.lee@CORP.example', name: 'Dana' },
      labels: 'alpha; beta',
      due: '2026-11-03T15:00:00Z',
    }).id;
    // The child's parent is set after: in the feed the child comes first.
    remote.tickets.get(childT)!.parentId = parentT;
    soloT = remoteCreate({
      subject: 'Unknown owner',
      assignee: { email: 'nobody@corp.example', name: 'Nobody' },
    }).id;

    const res = await h.call(s.admin!, 'POST', `${API}/profiles/${profileId}/preview`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.source).toBe('remote');
    expect(res.body.items).toHaveLength(3);
    const parent = res.body.items.find((i: LooseJson) => i.remoteId === parentT);
    expect(parent.actions).toEqual(['create']);
    expect(parent.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'status', after: 'open' }),
        expect.objectContaining({ field: 'tags', after: ['alpha', 'beta'] }),
      ]),
    );
    expect(store.size).toBe(0);
    const p = await h.call(s.admin!, 'GET', `${API}/profiles/${profileId}`);
    expect(p.body.cursor).toBeNull();
  });

  it('pulls: creates records with converted values, parents first, and logs the run', async () => {
    const run = await runPull();
    expect(run.status).toBe('succeeded'); // one assignee doesn't exist in ISBP: a warning, not an error
    const parent = byTitle('Parent epic')!;
    const child = byTitle('Child task')!;
    expect(parent).toMatchObject({
      status: 'open',
      owner: ids.dana,
      tags: ['alpha', 'beta'],
      due: '2026-11-03',
    });
    expect(parent.description).toContain('## Goal');
    expect(parent.description).toContain('Ship it');
    expect(parent.description).not.toContain('alert');
    expect(child).toMatchObject({ status: 'in_progress', parent: parent.id, description: 'Do **this**' });
    const solo = byTitle('Unknown owner')!;
    expect(solo.owner).toBeNull();

    const detail = await getRun(run.id);
    expect(detail.counts).toMatchObject({ read: 3, created: 3, errors: 0 });
    expect(
      detail.log.some((l: LooseJson) => l.level === 'warn' && /nobody@corp\.example/.test(l.message)),
    ).toBe(true);
    expect(
      detail.log.some((l: LooseJson) => l.ref?.remote === `#${remote.tickets.get(parentT)!.number}`),
    ).toBe(true);
    const p = await h.call(s.admin!, 'GET', `${API}/profiles/${profileId}`);
    expect(p.body.cursor).toBe(String(remote.seq));
  });

  it('pushes ISBP-only values of new records (the reference) once, without echoing pulled values', async () => {
    await settlePushes();
    for (const t of [parentT, childT, soloT])
      expect(remote.tickets.get(t)!.values.isbpRef).toBe(store.get((await linkOf(t))!.localId!)!.ref);
    const before = remote.updates;
    await runPull(); // reads our own pushes back: nothing to do
    await settlePushes();
    expect(remote.updates).toBe(before);
  });

  it('pulls remote updates; the local event that follows pushes nothing (echo suppression)', async () => {
    await settlePushes();
    const before = remote.updates;
    remoteEdit(parentT, { subject: 'Parent epic v2', state: 'Closed' });
    const run = await runPull();
    expect(run.counts).toMatchObject({ updated: 1, pushed: 0 });
    expect(byTitle('Parent epic v2')!.status).toBe('done');
    await settlePushes();
    expect(remote.updates).toBe(before);
  });

  it('pushes local changes from their events (markdown as HTML)', async () => {
    await settlePushes();
    const child = byTitle('Child task')!;
    const before = remote.updates;
    await localEdit(child.id, { description: 'Updated **in ISBP**', tags: ['x'] });
    await eventually(
      async () => remote.tickets.get(childT)!.values.body,
      (b) => typeof b === 'string' && b.includes('<strong>in ISBP</strong>'),
    );
    expect(remote.tickets.get(childT)!.values.labels).toBe('x');
    expect(remote.updates).toBe(before + 1);
    // Reading the update back changes nothing.
    await settlePushes();
    const run = await runPull();
    expect(run.counts.updated + run.counts.pushed).toBe(0);
    expect(remote.updates).toBe(before + 1);
  });

  it('applies a remote edit that lands while our push is answered: the answer does not hide it', async () => {
    await settlePushes();
    const raced = remoteCreate({ subject: 'Raced title', body: '<p>Before</p>' }).id;
    await runPull(); // the new ticket becomes a local item
    await settlePushes(); // its ISBP reference is pushed back first, so the next remote write is ours
    const item = byTitle('Raced title')!;
    const before = remote.updates;
    // Someone renames it in the remote system right after our write: the write's answer already carries the new title.
    remote.onUpdate = (t) => remoteEdit(t.id, { subject: 'Renamed while we pushed' });
    await localEdit(item.id, { description: 'Edited in ISBP' });
    expect(
      await eventually(
        async () => store.get(item.id)!.title,
        (title) => title === 'Renamed while we pushed',
      ),
    ).toBe('Renamed while we pushed');
    expect(remote.onUpdate).toBeNull();
    await settlePushes();
    expect(remote.updates).toBe(before + 1); // our push, and nothing pushed back for the title
    expect((await linkOf(raced))!.remoteVersion).toBe(String(remote.tickets.get(raced)!.version));
    const run = await runPull(); // the record is up to date on both sides
    expect(run.counts).toMatchObject({ updated: 0, pushed: 0 });
    expect(remote.updates).toBe(before + 1);
  });

  it('merges independent edits on both sides field by field', async () => {
    await settlePushes();
    const child = byTitle('Child task')!;
    remoteEdit(childT, { state: 'Closed' });
    await localEdit(child.id, { due: '2026-12-01' }, { event: false }); // a change we haven't pushed yet
    const run = await runPull();
    expect(run.counts).toMatchObject({ updated: 1, pushed: 1, conflicts: 0 });
    expect(store.get(child.id)!.status).toBe('done');
    expect(remote.tickets.get(childT)!.values.due).toBe('2026-12-01T00:00:00.000Z');
  });

  it('leaves fields a remote record does not report alone (unknown, not empty)', async () => {
    await settlePushes();
    const child = byTitle('Child task')!;
    const t = remote.tickets.get(childT)!;
    const due = t.values.due;
    delete t.values.due; // e.g. a field the system only returns from another endpoint
    remoteEdit(childT, { subject: 'Child task' });
    const before = remote.updates;
    await runPull();
    expect(store.get(child.id)!.due).toBe('2026-12-01'); // not cleared
    expect('due' in remote.tickets.get(childT)!.values).toBe(false); // not filled in either
    expect(remote.updates).toBe(before);
    t.values.due = due;
  });

  it('records a manual conflict when both sides change the same field, and resolves it', async () => {
    await settlePushes();
    const solo = byTitle('Unknown owner')!;
    remoteEdit(soloT, { subject: 'Remote title' });
    await localEdit(solo.id, { title: 'Local title', tags: ['keep'] }, { event: false });
    const run = await runPull();
    expect(run.counts.conflicts).toBe(1);
    expect(remote.tickets.get(soloT)!.values.labels).toBe('keep'); // the other field still merged
    const link = await linkOf(soloT);
    expect(link!.state).toBe('conflict');

    const list = await h.call(s.admin!, 'GET', `${API}/conflicts?status=open`);
    expect(list.body.total).toBe(1);
    const conflictId = list.body.items[0].id;
    expect(list.body.items[0]).toMatchObject({
      fields: ['title'],
      local: { title: 'Local title', hidden: false },
    });
    const detail = await h.call(s.admin!, 'GET', `${API}/conflicts/${conflictId}`);
    expect(detail.body.details[0]).toMatchObject({
      field: 'title',
      base: 'Unknown owner',
      local: 'Local title',
      remote: 'Remote title',
    });
    expect(detail.body.canResolve).toBe(true);
    const notified = await eventually(
      () =>
        h.kernel.db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, h.ids.admin),
              eq(notifications.type, 'integrations.conflict.created'),
            ),
          ),
      (r) => r.length > 0,
    );
    expect(notified.length).toBeGreaterThan(0);

    // A record the caller can't see keeps its values hidden.
    const hidden = await h.call(s.hubadmin!, 'GET', `${API}/conflicts/${conflictId}`);
    expect(hidden.body.local.hidden).toBe(true);
    expect(hidden.body.details[0].local).toBeNull();

    const missing = await h.call(s.admin!, 'POST', `${API}/conflicts/${conflictId}/resolve`, { choices: {} });
    expect(missing.status).toBe(400);
    const res = await h.call(s.admin!, 'POST', `${API}/conflicts/${conflictId}/resolve`, {
      choices: { title: 'remote' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(store.get(solo.id)!.title).toBe('Remote title');
    expect((await linkOf(soloT))!.state).toBe('ok');
    const again = await h.call(s.admin!, 'POST', `${API}/conflicts/${conflictId}/resolve`, {
      choices: { title: 'local' },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT_RESOLVED');
    await settlePushes();
  });

  it('raises the conflict instead of overwriting an edit made in ISBP while the sync writes', async () => {
    await settlePushes();
    const solo = byTitle('Remote title')!;
    remoteEdit(soloT, { subject: 'Remote again' });
    onRead = {
      id: solo.id,
      fn: () => {
        // Committed after the hub read the record and before it writes the remote title.
        solo.title = 'Local again';
        solo.updatedAt = new Date(Date.parse(solo.updatedAt) + 1000).toISOString();
      },
    };
    const run = await runPull();
    expect(onRead).toBeNull();
    expect(run.counts.conflicts).toBe(1);
    expect(store.get(solo.id)!.title).toBe('Local again'); // not lost
    expect((await linkOf(soloT))!.state).toBe('conflict');
    const list = await h.call(s.admin!, 'GET', `${API}/conflicts?status=open`);
    const open = list.body.items.find((c: LooseJson) => c.local?.title === 'Local again');
    const detail = await h.call(s.admin!, 'GET', `${API}/conflicts/${open.id}`);
    expect(detail.body.details[0]).toMatchObject({
      field: 'title',
      local: 'Local again',
      remote: 'Remote again',
    });
    const res = await h.call(s.admin!, 'POST', `${API}/conflicts/${open.id}/resolve`, {
      choices: { title: 'local' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(remote.tickets.get(soloT)!.values.subject).toBe('Local again');
    await settlePushes();
  });

  it('refuses a sync write when the record changed since it was read', async () => {
    const solo = byTitle('Local again')!;
    const before = solo.updatedAt;
    const stale = await h.kernel.db.transaction((tx) =>
      ctx.sync
        .write(
          'itest-data.item',
          { id: solo.id, values: { title: 'Stale write' }, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' },
          {
            auth: hubAuth(),
            tx: tx as never,
            source: { connectionId: randomUUID(), connectionName: 'x', connector: 'x', remoteRef: 'x' },
          },
        )
        .then(
          () => null,
          (err: unknown) => err,
        ),
    );
    expect(stale).toBeInstanceOf(HttpError);
    expect((stale as HttpError).code).toBe('CONFLICT');
    expect((stale as HttpError).details).toEqual({ reason: 'changed' });
    expect(store.get(solo.id)!.title).toBe('Local again');
    expect(store.get(solo.id)!.updatedAt).toBe(before);
  });

  it('keeps an item error on the link, finishes the rest, and retries it next time', async () => {
    await settlePushes();
    const frozen = remoteCreate({ subject: 'Frozen one', state: 'Frozen' }).id;
    // Frozen maps to nothing: the status is skipped; a value the module refuses becomes an item error.
    const run = await services(ctx).profiles.update(
      profileId,
      {
        mappings: (await services(ctx).profiles.row(profileId)).mappings.map((m) =>
          m.local === 'status'
            ? { ...m, values: [...(m.values ?? []), { remote: 'Frozen', local: 'archived' }] }
            : m,
        ),
      },
      hubAuth(),
    );
    expect(run.mappings.length).toBe(8);
    const r = await runPull();
    expect(r.status).toBe('partial');
    expect(r.counts.errors).toBe(1);
    const link = await linkOf(frozen);
    expect(link).toMatchObject({ state: 'error', localId: null });
    expect(link!.lastError).toMatchObject({ code: 'INVALID_TRANSITION' });
    const errored = await h.call(s.admin!, 'GET', `${API}/links?state=error&connectionId=${connectionId}`);
    expect(errored.body.items.map((l: LooseJson) => l.remoteId)).toContain(frozen);
    remoteEdit(frozen, { state: 'New' });
    const retry = await runPull();
    expect(retry.counts.errors).toBe(0);
    expect((await linkOf(frozen))!.state).toBe('ok');
    expect(byTitle('Frozen one')!.status).toBe('open');
  });

  it('creates remote records for new local ones that pass the push filter', async () => {
    await settlePushes();
    const before = remote.creates;
    const id = (
      await dataCtx.transaction((tx) =>
        dataCtx.sync.write(
          'itest-data.item',
          { values: { title: 'Made in ISBP', status: 'open', description: 'Hello' } },
          {
            auth: hubAuthFor(),
            tx,
            source: { connectionId: 'local', connectionName: 'test', connector: 'none', remoteRef: '-' },
          },
        ),
      )
    ).id;
    await eventually(
      () => linkOfLocal(id),
      (l) => Boolean(l),
    );
    expect(remote.creates).toBe(before + 1);
    const created = [...remote.tickets.values()].find((t) => t.values.subject === 'Made in ISBP')!;
    expect(created.values.body).toBe('<p>Hello</p>');
    expect(created.values.isbpRef).toBe(store.get(id)!.ref);
    // A done one doesn't pass the filter.
    await dataCtx.transaction((tx) =>
      dataCtx.sync.write(
        'itest-data.item',
        { values: { title: 'Done already', status: 'done' } },
        {
          auth: hubAuthFor(),
          tx,
          source: { connectionId: 'local', connectionName: 'test', connector: 'none', remoteRef: '-' },
        },
      ),
    );
    await settlePushes();
    expect(remote.creates).toBe(before + 1);
  });

  it('syncs comments both ways, each once', async () => {
    await settlePushes();
    const parent = byTitle('Parent epic v2')!;
    remote.tickets.get(parentT)!.comments.push({
      id: 'C-remote-1',
      body: '<p>From <em>remote</em></p>',
      format: 'html',
      author: { email: 'agent@fake.example.test', name: 'Remote agent' },
      createdAt: new Date().toISOString(),
    });
    touch(remote.tickets.get(parentT)!);
    await runPull();
    expect(parent.comments.map((c) => c.body)).toEqual(['From *remote*']);
    expect(parent.comments[0]!.authorName).toBe('Remote agent');

    // A local comment goes out once (and the pulled one is not sent back).
    const c: SyncComment = {
      id: randomUUID(),
      body: 'From **ISBP**',
      authorName: 'Dana',
      createdAt: new Date().toISOString(),
    };
    parent.comments.push(c);
    await dataCtx.transaction((tx) =>
      dataCtx.events.publish('itest-data.comment.added', { itemId: parent.id }, { tx }),
    );
    await eventually(
      async () => remote.tickets.get(parentT)!.comments.length,
      (n) => n === 2,
    );
    await settlePushes();
    touch(remote.tickets.get(parentT)!);
    await runPull();
    await settlePushes();
    expect(remote.tickets.get(parentT)!.comments).toHaveLength(2);
    expect(remote.tickets.get(parentT)!.comments[1]!.body).toContain('<strong>ISBP</strong>');
    expect(parent.comments).toHaveLength(2);
  });

  it('marks links orphaned when either side is deleted, and deletes nothing', async () => {
    await settlePushes();
    const t = remoteCreate({ subject: 'Short-lived' });
    await runPull();
    const local = byTitle('Short-lived')!;
    t.deleted = true;
    touch(t);
    await runPull();
    expect((await linkOf(t.id))!.state).toBe('orphaned');
    expect(store.has(local.id)).toBe(true);

    const solo = store.get((await linkOf(soloT))!.localId!)!;
    store.delete(solo.id);
    remoteEdit(soloT, { body: '<p>still here</p>' });
    await runPull();
    expect((await linkOf(soloT))!.state).toBe('orphaned');
    expect(remote.tickets.get(soloT)!.deleted).toBeFalsy();
  });
});

describe('webhooks', () => {
  it('refuses a missing or wrong secret', async () => {
    const none = await h.app.inject({
      method: 'POST',
      url: `${API}/hooks/${connectionId}`,
      payload: { ids: [] },
    });
    expect(none.statusCode).toBe(401);
    expect(none.json().error.code).toBe('WEBHOOK_INVALID');
    const wrong = await h.app.inject({
      method: 'POST',
      url: `${API}/hooks/${connectionId}`,
      headers: { 'x-isbp-webhook-secret': 'nope' },
      payload: { ids: [] },
    });
    expect(wrong.statusCode).toBe(401);
    const unknown = await h.app.inject({
      method: 'POST',
      url: `${API}/hooks/${randomUUID()}`,
      headers: { 'x-isbp-webhook-secret': webhookSecret },
      payload: { ids: [] },
    });
    expect(unknown.statusCode).toBe(401);
  });

  it('re-reads the records a webhook names (the body is not trusted for data)', async () => {
    await settlePushes();
    const t = remoteCreate({ subject: 'Via webhook' });
    const res = await h.app.inject({
      method: 'POST',
      url: `${API}/hooks/${connectionId}`,
      headers: { 'x-isbp-webhook-secret': webhookSecret },
      payload: { ids: [t.id], subject: 'Injected title' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 1 });
    await eventually(
      async () => byTitle('Via webhook'),
      (i) => Boolean(i),
    );
    expect(byTitle('Injected title')).toBeUndefined();
    const run = (await h.kernel.db.select().from(runs).where(eq(runs.kind, 'webhook')))[0]!;
    expect(run.trigger).toBe('webhook');

    // HTTP Basic (password = the secret) works too.
    remoteEdit(t.id, { subject: 'Via webhook, again' });
    const basic = await h.app.inject({
      method: 'POST',
      url: `${API}/hooks/${connectionId}`,
      headers: { authorization: `Basic ${Buffer.from(`hook:${webhookSecret}`).toString('base64')}` },
      payload: { ids: [t.id] },
    });
    expect(basic.statusCode).toBe(202);
    await eventually(
      async () => byTitle('Via webhook, again'),
      (i) => Boolean(i),
    );
  });
});

describe('runs and failures', () => {
  it('pauses on rate limiting and continues after retryAfterSeconds', async () => {
    await settlePushes();
    const t = remoteCreate({ subject: 'After the pause' });
    remote.rateLimitNext = 1;
    const res = await h.call(s.admin!, 'POST', `${API}/profiles/${profileId}/run`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const waiting = await eventually(
      () => getRun(res.body.id),
      (r) => r.status === 'waiting' || r.status === 'succeeded',
    );
    expect(['waiting', 'succeeded']).toContain(waiting.status);
    const done = await waitRun(res.body.id);
    expect(done.status).toBe('succeeded');
    expect(done.log.some((l: LooseJson) => /rate limiting/.test(l.message))).toBe(true);
    expect(byTitle('After the pause')).toBeTruthy();
    expect((await linkOf(t.id))!.state).toBe('ok');
  });

  it('refuses a second run while one is queued (SYNC_RUNNING)', async () => {
    remote.rateLimitNext = 1;
    const first = await h.call(s.admin!, 'POST', `${API}/profiles/${profileId}/run`);
    const second = await h.call(s.admin!, 'POST', `${API}/profiles/${profileId}/run`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SYNC_RUNNING');
    await waitRun(first.body.id);
  });

  it('lists runs with counts and filters', async () => {
    const res = await h.call(s.admin!, 'GET', `${API}/runs?profileId=${profileId}&kind=pull`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(3);
    expect(res.body.items[0]).toMatchObject({ kind: 'pull', profile: { id: profileId } });
  });

  it('shows the record panel to whoever can read the record', async () => {
    const parent = byTitle('Parent epic v2')!;
    const res = await h.call(
      s.reader!,
      'GET',
      `${API}/links/by-record?entity=itest-data.item&id=${parent.id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        state: 'ok',
        remoteRef: `#${remote.tickets.get(byRemoteTitle('Parent epic v2'))!.number}`,
        canSync: false,
      }),
    ]);
    expect(res.body.items[0].remoteUrl).toMatch(/^https:\/\/fake\.example\.test\//);
    const outsider = await h.call(
      s.outsider!,
      'GET',
      `${API}/links/by-record?entity=itest-data.item&id=${parent.id}`,
    );
    expect(outsider.status).toBe(404);
    const resync = await h.call(s.admin!, 'POST', `${API}/links/${res.body.items[0].id}/resync`);
    expect(resync.status).toBe(202);
    const run = await waitRun(resync.body.runId);
    expect(run).toMatchObject({ kind: 'resync', status: 'succeeded' });
  });

  it('fails a run on an authentication failure, flags the connection and tells admins', async () => {
    await settlePushes();
    await h.call(s.admin!, 'PATCH', `${API}/connections/${connectionId}`, { secrets: { token: 'expired' } });
    const run = await runPull();
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('REMOTE_AUTH_FAILED');
    const c = await h.call(s.admin!, 'GET', `${API}/connections/${connectionId}`);
    expect(c.body).toMatchObject({ health: 'failing', healthMessage: 'Token expired' });
    const notified = await h.kernel.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, h.ids.admin), eq(notifications.type, 'integrations.connection.failing')),
      );
    expect(notified).toHaveLength(1);
    await h.call(s.admin!, 'PATCH', `${API}/connections/${connectionId}`, { secrets: { token: 'good' } });
    const ok = await runPull();
    expect(ok.status).toBe('succeeded');
    expect((await h.call(s.admin!, 'GET', `${API}/connections/${connectionId}`)).body.health).toBe('ok');
  });

  it('unlinks without deleting anything, and deletes the connection', async () => {
    const list = await h.call(s.admin!, 'GET', `${API}/links?connectionId=${connectionId}&pageSize=100`);
    const link = list.body.items.find((l: LooseJson) => l.state === 'orphaned');
    const before = store.size;
    expect((await h.call(s.admin!, 'DELETE', `${API}/links/${link.id}`)).status).toBe(204);
    expect(store.size).toBe(before);
    await settlePushes();
    expect((await h.call(s.admin!, 'DELETE', `${API}/connections/${connectionId}`)).status).toBe(204);
    expect(await h.kernel.db.select().from(links)).toHaveLength(0);
    expect(await h.kernel.db.select().from(conflicts)).toHaveLength(0);
  });
});

/* ───────────────────────────── helpers ───────────────────────────── */

function byRemoteTitle(subject: string): string {
  return [...remote.tickets.values()].find((t) => t.values.subject === subject)!.id;
}

async function linkOfLocal(localId: string) {
  return (await h.kernel.db.select().from(links).where(eq(links.localId, localId)))[0];
}

/** The hub's agent identity (`*.*.sync`), as a sync write needs. */
function hubAuthFor() {
  return ctx.ai.agent();
}
