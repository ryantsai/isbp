/**
 * Published chats (Phase 10, §16.6): Ask IS as a link and an embeddable widget. Administrators publish a chat for
 * anyone (public articles of chosen categories, no tickets) or for signed-in people (their own permissions, tickets);
 * the web proxy asks which websites may frame it; sessions, categories and tickets are enforced by the API.
 */
import { roleAssignments, roles, users } from '@isbp/db/schema';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const HAI = '/api/v1/helpdesk-ai';
const KB = '/api/v1/knowledge';
const SESSION = 'x-isbp-chat-session';

async function mkUser(username: string, roleKeys: string[] = []) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  for (const key of roleKeys) {
    const [role] = await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    await h.kernel.db.insert(roleAssignments).values({ roleId: role!.id, userId: u!.id });
  }
  return u!.id;
}

async function eventually<T>(
  fn: () => Promise<T>,
  accept: (v: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** A request without any platform session (a visitor on another website). */
const anon = (method: 'GET' | 'POST', url: string, opts: { session?: string; payload?: unknown } = {}) =>
  h.app.inject({
    method,
    url,
    ...(opts.payload !== undefined ? { payload: opts.payload as Record<string, unknown> } : {}),
    headers: opts.session ? { [SESSION]: opts.session } : {},
  });

function sse(body: string): { event: string; data: LooseJson }[] {
  return body
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return event && data ? { event, data: JSON.parse(data) } : null;
    })
    .filter((e): e is { event: string; data: LooseJson } => !!e);
}

async function article(title: string, body: string, categoryId: string, audience: 'everyone' | 'agents') {
  const res = await h.call(s.admin!, 'POST', `${KB}/articles`, {
    title,
    summary: title,
    body,
    categoryId,
    audience,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const ref = res.body.reference as string;
  const submitted = await h.call(s.admin!, 'POST', `${KB}/articles/${ref}/submit`);
  if (submitted.body.status !== 'published')
    expect((await h.call(s.admin!, 'POST', `${KB}/articles/${ref}/publish`)).status).toBe(200);
  return res.body.id as string;
}

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  await mkUser('alice');
  await mkUser('agent', ['itsm-agent', 'knowledge-agent']);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'alice', 'agent']) s[u] = await h.login(u);

  for (const [key, en] of [
    ['network', 'Network'],
    ['printing', 'Printing'],
  ] as const) {
    const res = await h.call(s.admin!, 'POST', `${KB}/categories`, { key, name: { en } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids[key] = res.body.id;
  }
  ids.vpn = await article(
    'VPN keeps disconnecting',
    '1. Quit the VPN client.\n2. Switch the VPN protocol to TCP.\n3. Reconnect.',
    ids.network!,
    'everyone',
  );
  ids.printer = await article(
    'Printer shows paper jam',
    '1. Open the printer tray.\n2. Remove the jammed paper.',
    ids.printing!,
    'everyone',
  );
  ids.internal = await article(
    'VPN gateway failover runbook',
    'Internal: fail the VPN gateway over to the standby site.',
    ids.network!,
    'agents',
  );
  await eventually(
    async () =>
      (
        await h.kernel.db.execute<{ n: number }>(
          sql`select count(distinct source_id)::int as n from core.ai_chunks where source_type = 'knowledge.article'`,
        )
      ).rows[0]!.n,
    (n) => n >= 3,
  );
}, 90_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('administration', () => {
  it('publishes chats, checks websites and categories, and keeps them from other people', async () => {
    const bad = await h.call(s.admin!, 'POST', `${HAI}/published-chats`, {
      name: 'Bad',
      access: 'anyone',
      allowedOrigins: ['https://intranet.example.com/path'],
    });
    expect(bad.status).toBe(400);
    const unknown = await h.call(s.admin!, 'POST', `${HAI}/published-chats`, {
      name: 'Unknown category',
      access: 'anyone',
      categoryIds: ['01a00000-0000-7000-8000-000000000000'],
    });
    expect(unknown.status).toBe(400);
    expect((await h.call(s.alice!, 'GET', `${HAI}/published-chats`)).status).toBe(403);

    const anyone = await h.call(s.admin!, 'POST', `${HAI}/published-chats`, {
      name: 'Public help',
      access: 'anyone',
      allowedOrigins: ['https://Intranet.Example.com', 'https://intranet.example.com'],
      categoryIds: [ids.network],
      title: 'Help for visitors',
    });
    expect(anyone.status, JSON.stringify(anyone.body)).toBe(201);
    expect(anyone.body).toMatchObject({
      enabled: true,
      access: 'anyone',
      allowedOrigins: ['https://intranet.example.com'],
      categoryIds: [ids.network],
      sessionMinutes: 240,
      conversations: 0,
    });
    expect(anyone.body.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    ids.anyone = anyone.body.id;
    ids.anyoneToken = anyone.body.token;

    const signedIn = await h.call(s.admin!, 'POST', `${HAI}/published-chats`, {
      name: 'Staff help',
      access: 'signed_in',
    });
    expect(signedIn.status).toBe(201);
    ids.staffToken = signedIn.body.token;

    const categories = await h.call(s.admin!, 'GET', `${HAI}/published-chats/categories`);
    expect(categories.body.items.map((c: LooseJson) => c.key)).toEqual(
      expect.arrayContaining(['network', 'printing']),
    );
    const audit = await h.kernel.db.execute<{ n: number }>(
      sql`select count(*)::int as n from core.audit_logs where action = 'helpdesk-ai.published_chat.created'`,
    );
    expect(audit.rows[0]!.n).toBe(2);
  });
});

describe('the public side', () => {
  it('shows the chat, its frame policy and the bubble script without signing in', async () => {
    const info = await anon('GET', `${HAI}/published/${ids.anyoneToken}`);
    expect(info.statusCode).toBe(200);
    expect(info.json()).toEqual({
      title: 'Help for visitors',
      welcome: '',
      access: 'anyone',
      mode: 'builtin',
      tickets: false,
    });
    expect((await anon('GET', `${HAI}/published/not-a-real-token-at-all`)).statusCode).toBe(404);

    const frame = await anon(
      'GET',
      `/api/v1/platform/frame-ancestors?path=${encodeURIComponent(`/p/helpdesk-ai/chat/${ids.anyoneToken}`)}`,
    );
    expect(frame.json()).toEqual({ origins: ['https://intranet.example.com'] });
    for (const path of ['/p/helpdesk-ai/chat/unknown-token-xyz', '/p/itsm/anything', '/admin']) {
      const none = await anon('GET', `/api/v1/platform/frame-ancestors?path=${encodeURIComponent(path)}`);
      expect(none.json()).toEqual({ origins: [] });
    }

    const script = await anon('GET', `${HAI}/published/embed.js`);
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(script.body).toContain('/p/helpdesk-ai/chat/');
  });

  it('answers a visitor from public articles of its categories only, with no tickets', async () => {
    const started = await anon('POST', `${HAI}/published/${ids.anyoneToken}/sessions`);
    expect(started.statusCode).toBe(201);
    const session = started.json().session as string;
    expect(started.json().user).toBeNull();

    // No session, or a made-up one: 401.
    expect(
      (await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations`, { payload: {} })).statusCode,
    ).toBe(401);
    const conv = await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations`, {
      session,
      payload: {},
    });
    expect(conv.statusCode).toBe(201);
    const id = conv.json().id as string;

    const vpn = await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations/${id}/messages`, {
      session,
      payload: { content: 'My VPN keeps disconnecting' },
    });
    const events = sse(vpn.body);
    const cited = events.find((e) => e.event === 'citations')!.data.items as LooseJson[];
    expect(cited.map((c) => c.id)).toEqual([ids.vpn]);
    expect(events.some((e) => e.event === 'proposal')).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { mode: 'builtin' } });

    // A printer question: the printing category isn't this chat's.
    const printer = await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations/${id}/messages`, {
      session,
      payload: { content: 'Printer shows paper jam' },
    });
    const printerCited = sse(printer.body).find((e) => e.event === 'citations')?.data.items ?? [];
    expect(printerCited.map((c: LooseJson) => c.id)).not.toContain(ids.printer);

    // Articles open in the chat: its own categories' public ones only.
    const read = await anon('GET', `${HAI}/published/${ids.anyoneToken}/articles/${ids.vpn}`, { session });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      title: 'VPN keeps disconnecting',
      body: expect.stringContaining('TCP'),
    });
    for (const other of [ids.printer, ids.internal])
      expect(
        (await anon('GET', `${HAI}/published/${ids.anyoneToken}/articles/${other}`, { session })).statusCode,
      ).toBe(404);

    const escalate = await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations/${id}/escalate`, {
      session,
      payload: { title: 'Help', description: 'Please help', urgency: 2, type: 'incident' },
    });
    expect(escalate.statusCode).toBe(403);
    const resolved = await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations/${id}/resolve`, {
      session,
    });
    expect(resolved.json()).toMatchObject({ status: 'resolved', user: null });

    // Another visitor's session sees none of it.
    const other = (await anon('POST', `${HAI}/published/${ids.anyoneToken}/sessions`)).json().session;
    expect(
      (await anon('GET', `${HAI}/published/${ids.anyoneToken}/conversations/${id}`, { session: other }))
        .statusCode,
    ).toBe(404);
    const [row] = (
      await h.kernel.db.execute<{ user_id: string | null; channel_id: string; visitor_id: string }>(
        sql`select user_id, channel_id, visitor_id from helpdesk_ai.conversations where id = ${id}`,
      )
    ).rows;
    expect(row).toMatchObject({ user_id: null, channel_id: ids.anyone });
    expect(row!.visitor_id).toMatch(/^v_/);
  });

  it('limits how fast one session asks', async () => {
    const session = (await anon('POST', `${HAI}/published/${ids.anyoneToken}/sessions`)).json().session;
    const id = (
      await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations`, { session, payload: {} })
    ).json().id;
    const codes: number[] = [];
    for (let i = 0; i < 11; i++)
      codes.push(
        (
          await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations/${id}/messages`, {
            session,
            payload: { content: `VPN question ${i}` },
          })
        ).statusCode,
      );
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('gives signed-in chats only to signed-in people, who can raise tickets', async () => {
    const visitor = await anon('POST', `${HAI}/published/${ids.staffToken}/sessions`);
    expect(visitor.statusCode).toBe(401);
    expect(visitor.json().error.details).toMatchObject({ reason: 'sign_in' });

    const me = await h.call(s.alice!, 'POST', `${HAI}/published/${ids.staffToken}/sessions/me`);
    expect(me.status, JSON.stringify(me.body)).toBe(201);
    expect(me.body.user).toEqual({ displayName: 'alice' });
    const session = me.body.session as string;

    const id = (
      await anon('POST', `${HAI}/published/${ids.staffToken}/conversations`, { session, payload: {} })
    ).json().id as string;
    const answer = await anon('POST', `${HAI}/published/${ids.staffToken}/conversations/${id}/messages`, {
      session,
      payload: { content: 'My VPN keeps disconnecting' },
    });
    expect(sse(answer.body).some((e) => e.event === 'proposal')).toBe(true);
    const raised = await anon('POST', `${HAI}/published/${ids.staffToken}/conversations/${id}/escalate`, {
      session,
      payload: { title: 'VPN keeps disconnecting', description: 'Tried TCP.', urgency: 2, type: 'incident' },
    });
    expect(raised.statusCode, raised.body).toBe(200);
    expect(raised.json().ticket.reference).toMatch(/^INC-/);

    // It is Alice's conversation in the platform too.
    const mine = await h.call(s.alice!, 'GET', `${HAI}/conversations`);
    expect(mine.body.items.map((c: LooseJson) => c.id)).toContain(id);
    // A session from one chat doesn't open another.
    expect(
      (await anon('POST', `${HAI}/published/${ids.anyoneToken}/conversations`, { session, payload: {} }))
        .statusCode,
    ).toBe(401);
  });

  it('stops old links and sessions when the link is regenerated or the chat is turned off', async () => {
    const session = (await anon('POST', `${HAI}/published/${ids.anyoneToken}/sessions`)).json().session;
    const regenerated = await h.call(s.admin!, 'POST', `${HAI}/published-chats/${ids.anyone}/regenerate`);
    expect(regenerated.status).toBe(200);
    const fresh = regenerated.body.token as string;
    expect(fresh).not.toBe(ids.anyoneToken);
    expect((await anon('GET', `${HAI}/published/${ids.anyoneToken}`)).statusCode).toBe(404);
    expect(
      (await anon('POST', `${HAI}/published/${fresh}/conversations`, { session, payload: {} })).statusCode,
    ).toBe(201);

    const off = await h.call(s.admin!, 'PATCH', `${HAI}/published-chats/${ids.anyone}`, { enabled: false });
    expect(off.body).toMatchObject({ enabled: false, name: 'Public help', categoryIds: [ids.network] });
    expect((await anon('GET', `${HAI}/published/${fresh}`)).statusCode).toBe(404);
    const frame = await anon(
      'GET',
      `/api/v1/platform/frame-ancestors?path=${encodeURIComponent(`/p/helpdesk-ai/chat/${fresh}`)}`,
    );
    expect(frame.json()).toEqual({ origins: [] });

    expect((await h.call(s.admin!, 'DELETE', `${HAI}/published-chats/${ids.anyone}`)).status).toBe(204);
    const left = await h.kernel.db.execute<{ n: number }>(
      sql`select count(*)::int as n from helpdesk_ai.conversations where visitor_id is not null`,
    );
    expect(left.rows[0]!.n).toBeGreaterThan(0);
  });
});
