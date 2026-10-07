import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiUsage, groups, groupMembers, roleAssignments, roles, users } from '@isbp/db/schema';
import { manifest as helpdeskManifest } from '@isbp/module-helpdesk-ai/manifest';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/*
 * Helpdesk AI end to end: builtin triage from the semantic index (and auto-triage through ITSM's tool),
 * the virtual agent in builtin mode (SSE, citations, proposal, escalation), LLM mode against a fake
 * OpenAI-compatible server (reply draft, streamed chat, usage, masking) and permissions.
 */

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'agent' | 'alice' | 'bob' | 'vpn' | 'email' | 'network' | 'desk', string>;
let vpnArticle: string;

const ITSM = '/api/v1/itsm';
const HAI = '/api/v1/helpdesk-ai';
const core = () => h.kernel.registry.get('core')!.manifest;

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

async function mkUser(username: string, roleKeys: string[] = [], locale = 'en') {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username[0]!.toUpperCase() + username.slice(1),
      passwordHash: await hashPassword(PASSWORD),
      locale,
    })
    .returning();
  for (const key of roleKeys) {
    const [role] = await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    await h.kernel.db.insert(roleAssignments).values({ roleId: role!.id, userId: u!.id });
  }
  return u!.id;
}

/** Parses a `text/event-stream` body into `{ event, data }` pairs. */
function sse(body: unknown): { event: string; data: LooseJson }[] {
  return String(body)
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return event && data ? { event, data: JSON.parse(data) } : null;
    })
    .filter((e): e is { event: string; data: LooseJson } => !!e);
}

const insightOf = async (ticketId: string) =>
  (
    await h.kernel.db.execute<{ status: string; data: LooseJson; confidence: number; mode: string }>(
      sql`select status, data, confidence, mode from helpdesk_ai.insights where ticket_id = ${ticketId} and kind = 'triage'`,
    )
  ).rows[0];

async function resolvedTicket(title: string, description: string, categoryId: string, groupId: string) {
  const created = await h.call(s.agent!, 'POST', `${ITSM}/tickets`, {
    title,
    description,
    categoryId,
    assignmentGroupId: groupId,
    impact: 3,
    urgency: 2,
  });
  expect(created.status).toBe(201);
  const resolved = await h.call(s.agent!, 'POST', `${ITSM}/tickets/${created.body.reference}/transition`, {
    status: 'resolved',
    resolutionCode: 'solved',
    resolutionNotes: `Fixed: ${title}`,
  });
  expect(resolved.status).toBe(200);
  return created.body as LooseJson;
}

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  const db = h.kernel.db;

  ids.agent = await mkUser('agent', ['itsm-agent', 'helpdesk-ai-agent', 'knowledge-agent']);
  ids.alice = await mkUser('alice', [], 'en');
  ids.bob = await mkUser('bob', [], 'ja-JP');
  const [desk] = await db.insert(groups).values({ key: 'service-desk', name: 'Service Desk' }).returning();
  const [net] = await db.insert(groups).values({ key: 'network-team', name: 'Network Team' }).returning();
  ids.desk = desk!.id;
  ids.network = net!.id;
  await db.insert(groupMembers).values([
    { groupId: ids.desk, userId: ids.agent },
    { groupId: ids.network, userId: ids.agent },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'agent', 'alice', 'bob', 'outsider']) s[u] = await h.login(u);

  const vpn = await h.call(s.admin!, 'POST', `${ITSM}/categories`, {
    key: 'network-vpn',
    name: { en: 'VPN' },
    ticketTypes: ['incident', 'service_request'],
    defaultGroupId: ids.network,
  });
  const email = await h.call(s.admin!, 'POST', `${ITSM}/categories`, {
    key: 'email',
    name: { en: 'Email' },
    ticketTypes: ['incident', 'service_request'],
    defaultGroupId: ids.desk,
  });
  expect([vpn.status, email.status]).toEqual([201, 201]);
  ids.vpn = vpn.body.id;
  ids.email = email.body.id;

  // A published, self-service knowledge article (the worker indexes it after publishing).
  const article = await h.call(s.admin!, 'POST', '/api/v1/knowledge/articles', {
    title: 'VPN keeps disconnecting',
    summary: 'Fix a GlobalProtect VPN that drops every few minutes.',
    body: '## Steps\n\n1. Quit the GlobalProtect VPN client.\n2. Switch the VPN protocol to TCP.\n3. Reconnect and sign in again.',
    tags: ['vpn'],
  });
  expect(article.status).toBe(201);
  vpnArticle = article.body.reference;
  const submitted = await h.call(s.admin!, 'POST', `/api/v1/knowledge/articles/${vpnArticle}/submit`);
  if (submitted.body.status !== 'published')
    expect((await h.call(s.admin!, 'POST', `/api/v1/knowledge/articles/${vpnArticle}/publish`)).status).toBe(
      200,
    );

  // Resolved precedent tickets, indexed by ITSM for similar-ticket search.
  await resolvedTicket(
    'VPN disconnects every few minutes',
    'GlobalProtect VPN drops the tunnel every few minutes at home.',
    ids.vpn,
    ids.network,
  );
  await resolvedTicket(
    'VPN tunnel keeps dropping',
    'The VPN connection keeps disconnecting every few minutes.',
    ids.vpn,
    ids.network,
  );
  await resolvedTicket(
    'VPN disconnects on home Wi-Fi',
    'VPN disconnects every few minutes on my home Wi-Fi.',
    ids.vpn,
    ids.network,
  );
  await resolvedTicket(
    'Outlook asks for my password',
    'Outlook keeps prompting for the mailbox password.',
    ids.email,
    ids.desk,
  );
  const indexed = await eventually(
    async () =>
      (
        await h.kernel.db.execute<{ n: number }>(
          sql`select count(distinct source_id)::int as n from core.ai_chunks where source_type in ('itsm.ticket', 'knowledge.article')`,
        )
      ).rows[0]!.n,
    (n) => n >= 5,
  );
  expect(indexed).toBeGreaterThanOrEqual(5);
}, 60_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('builtin triage', () => {
  it('suggests the category of the most similar resolved tickets when a ticket is raised', async () => {
    const raised = await h.call(s.alice!, 'POST', `${ITSM}/tickets`, {
      title: 'My VPN keeps disconnecting every few minutes',
      description: 'The GlobalProtect VPN drops every few minutes when I work from home.',
    });
    expect(raised.status).toBe(201);
    const insight = await eventually(
      () => insightOf(raised.body.id),
      (r) => !!r,
    );
    expect(insight).toMatchObject({ status: 'suggested', mode: 'builtin' });
    expect(insight!.data.suggestion).toMatchObject({ categoryId: ids.vpn, assignmentGroupId: ids.network });
    expect(insight!.confidence).toBeGreaterThan(0);
    expect(insight!.data.rationale).toMatch(/INC-\d{5}/);

    // The agent's panel shows it, with similar tickets and the article; the requester's ticket is unchanged.
    const assist = await h.call(s.agent!, 'GET', `${HAI}/tickets/${raised.body.id}/assist`);
    expect(assist.status).toBe(200);
    expect(assist.body.ai).toMatchObject({ mode: 'builtin', model: null });
    expect(assist.body.triage.data.suggestion.categoryPath).toContain('VPN');
    expect(assist.body.similar.length).toBeGreaterThan(0);
    expect(assist.body.similar[0].reference).toMatch(/^INC-\d{5}$/);
    expect(assist.body.similar[0].title).not.toMatch(/^INC-/);
    expect(assist.body.articles.map((a: LooseJson) => a.reference)).toContain(vpnArticle);
    const ticket = await h.call(s.agent!, 'GET', `${ITSM}/tickets/${raised.body.reference}`);
    expect(ticket.body.category).toBeNull();

    // Feedback after the agent applied it themselves.
    const fb = await h.call(s.agent!, 'POST', `${HAI}/insights/${assist.body.triage.id}/feedback`, {
      action: 'partially_applied',
      fields: ['category'],
    });
    expect(fb.status).toBe(200);
    expect(fb.body).toMatchObject({ status: 'partially_applied', feedback: { fields: ['category'] } });
  });

  it('auto-triage fills the empty fields as the agent identity and credits Helpdesk AI', async () => {
    await h.kernel.settings.update(helpdeskManifest, { autoTriage: true, autoTriageThreshold: 0.05 }, null);
    try {
      const raised = await h.call(s.alice!, 'POST', `${ITSM}/tickets`, {
        title: 'VPN disconnects every few minutes again',
        description: 'My VPN keeps dropping every few minutes from home.',
      });
      expect(raised.status).toBe(201);
      const ticket = await eventually(
        () => h.call(s.agent!, 'GET', `${ITSM}/tickets/${raised.body.reference}`),
        (r) => r.body.category?.id === ids.vpn,
      );
      expect(ticket.body.category.id).toBe(ids.vpn);
      expect((await insightOf(raised.body.id))!.status).toBe('auto_applied');
      const timeline = await h.call(s.agent!, 'GET', `${ITSM}/tickets/${raised.body.reference}/activities`);
      const triage = timeline.body.items.find((a: LooseJson) => a.kind === 'triage');
      expect(triage).toBeTruthy();
      expect(triage.author).toMatchObject({ displayName: 'Helpdesk AI', ai: true });
    } finally {
      await h.kernel.settings.update(helpdeskManifest, { autoTriage: false }, null);
    }
  });

  it('re-runs on demand as the agent, and never triages twice on event redelivery', async () => {
    const raised = await h.call(s.alice!, 'POST', `${ITSM}/tickets`, {
      title: 'Outlook keeps asking for my password',
      description: 'Since this morning Outlook prompts for the password.',
    });
    await eventually(
      () => insightOf(raised.body.id),
      (r) => !!r,
    );
    const rerun = await h.call(s.agent!, 'POST', `${HAI}/tickets/${raised.body.id}/triage`);
    expect(rerun.status).toBe(200);
    expect(rerun.body.data.suggestion.categoryId).toBe(ids.email);
    const rows = await h.kernel.db.execute<{ n: number }>(
      sql`select count(*)::int as n from helpdesk_ai.insights where ticket_id = ${raised.body.id}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });
});

describe('agent features in builtin mode', () => {
  let ticket: LooseJson;

  beforeAll(async () => {
    ticket = (
      await h.call(s.bob!, 'POST', `${ITSM}/tickets`, {
        title: 'VPN が数分おきに切断されます',
        description: 'VPN keeps disconnecting every few minutes at home.',
      })
    ).body;
  });

  it("drafts a templated reply in the requester's language quoting the article's steps", async () => {
    const res = await h.call(s.agent!, 'POST', `${HAI}/tickets/${ticket.id}/reply-draft`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'builtin', locale: 'ja-JP', fallback: false });
    expect(res.body.text).toContain('Bob 様');
    expect(res.body.text).toContain('1. Quit the GlobalProtect VPN client.');
    expect(res.body.citations[0].reference).toBe(vpnArticle);
  });

  it('summarises extractively and caches until the ticket changes', async () => {
    const first = await h.call(s.agent!, 'POST', `${HAI}/tickets/${ticket.id}/summary`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ mode: 'builtin', cached: false, text: null });
    expect(first.body.sections.state.status).toBe('new');
    expect((await h.call(s.agent!, 'POST', `${HAI}/tickets/${ticket.id}/summary`)).body.cached).toBe(true);
    await h.call(s.agent!, 'POST', `${ITSM}/tickets/${ticket.reference}/comments`, {
      body: 'Looking into it.',
    });
    expect((await h.call(s.agent!, 'POST', `${HAI}/tickets/${ticket.id}/summary`)).body.cached).toBe(false);
  });

  it('drafts a KB article from a resolved ticket as the user, once', async () => {
    const early = await h.call(s.agent!, 'POST', `${HAI}/tickets/${ticket.id}/kb-draft`);
    expect(early.body.error.code).toBe('INVALID_STATE');
    await h.call(s.agent!, 'POST', `${ITSM}/tickets/${ticket.reference}/transition`, {
      status: 'resolved',
      resolutionCode: 'solved',
      resolutionNotes: 'Switched the VPN protocol to TCP. The drops stopped.',
    });
    const draft = await h.call(s.agent!, 'POST', `${HAI}/tickets/${ticket.id}/kb-draft`);
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({
      existing: false,
      mode: 'builtin',
      reference: expect.stringMatching(/^KB-\d{5}$/),
    });
    const article = await h.call(s.agent!, 'GET', `/api/v1/knowledge/articles/${draft.body.reference}`);
    expect(article.body).toMatchObject({ status: 'draft', source: { type: 'itsm.ticket', id: ticket.id } });
    expect(article.body.body).toContain('Switched the VPN protocol to TCP.');
    const again = await h.call(s.agent!, 'POST', `${HAI}/tickets/${ticket.id}/kb-draft`);
    expect(again.body).toMatchObject({ existing: true, reference: draft.body.reference });
  });
});

describe('virtual agent (builtin mode)', () => {
  let conversation: string;

  it('streams an answer with article citations and a ticket proposal', async () => {
    const created = await h.call(s.alice!, 'POST', `${HAI}/conversations`, {});
    expect(created.status).toBe(201);
    conversation = created.body.id;
    const res = await h.app.inject({
      method: 'POST',
      url: `${HAI}/conversations/${conversation}/messages`,
      payload: { content: 'My VPN keeps disconnecting every few minutes' },
      headers: { cookie: s.alice!.cookie, 'x-csrf-token': s.alice!.csrf },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = sse(res.body);
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining(['delta', 'citations', 'proposal', 'done']),
    );
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { mode: 'builtin' } });
    const citations = events.find((e) => e.event === 'citations')!.data.items;
    expect(citations[0]).toMatchObject({ n: 1, reference: vpnArticle });
    const text = events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data.text)
      .join('');
    expect(text).toContain('VPN keeps disconnecting');
    const proposal = events.find((e) => e.event === 'proposal')!.data;
    expect(proposal).toMatchObject({
      title: 'My VPN keeps disconnecting every few minutes',
      type: 'incident',
    });

    const detail = await h.call(s.alice!, 'GET', `${HAI}/conversations/${conversation}`);
    expect(detail.body).toMatchObject({
      status: 'open',
      title: 'My VPN keeps disconnecting every few minutes',
      messageCount: 2,
    });
    expect(detail.body.messages.map((m: LooseJson) => m.role)).toEqual(['user', 'assistant']);
    expect(detail.body.messages[1].citations[0].reference).toBe(vpnArticle);
  });

  it('escalating raises a ticket owned by the user (channel chat) and links it', async () => {
    const res = await h.call(s.alice!, 'POST', `${HAI}/conversations/${conversation}/escalate`, {
      title: 'VPN disconnects every few minutes',
      description: 'Tried the article; still dropping.',
      urgency: 2,
      type: 'incident',
    });
    expect(res.status).toBe(200);
    expect(res.body.ticket.reference).toMatch(/^INC-\d{5}$/);
    expect(res.body.conversation).toMatchObject({
      status: 'escalated',
      ticketRef: res.body.ticket.reference,
    });
    const ticket = await h.call(s.alice!, 'GET', `${ITSM}/tickets/${res.body.ticket.reference}`);
    expect(ticket.body).toMatchObject({
      channel: 'chat',
      requester: { id: ids.alice },
      title: 'VPN disconnects every few minutes',
    });
    const again = await h.call(s.alice!, 'POST', `${HAI}/conversations/${conversation}/escalate`, {
      title: 'Duplicate',
      description: '',
      urgency: 3,
      type: 'incident',
    });
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect((await h.call(s.alice!, 'POST', `${HAI}/conversations/${conversation}/resolve`)).status).toBe(409);
  });

  it('"that solved it" closes a conversation as deflected', async () => {
    const { id } = (await h.call(s.bob!, 'POST', `${HAI}/conversations`, {})).body;
    await h.app.inject({
      method: 'POST',
      url: `${HAI}/conversations/${id}/messages`,
      payload: { content: 'VPN に接続できません' },
      headers: { cookie: s.bob!.cookie, 'x-csrf-token': s.bob!.csrf },
    });
    const res = await h.call(s.bob!, 'POST', `${HAI}/conversations/${id}/resolve`);
    expect(res.body).toMatchObject({ status: 'resolved', deflected: true, locale: 'ja-JP' });
    const detail = await h.call(s.bob!, 'GET', `${HAI}/conversations/${id}`);
    expect(detail.body.messages[1].content).toContain('ナレッジ ベース');
  });
});

describe('LLM mode (fake OpenAI-compatible provider)', () => {
  let server: Server;
  const seen: { body: LooseJson; raw: string }[] = [];
  const REPLY = 'Please switch the VPN protocol to TCP and reconnect [1].';

  beforeAll(async () => {
    server = createServer(async (req: IncomingMessage, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as LooseJson;
      seen.push({ body, raw });
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const delta of ['Switch the VPN ', 'protocol to TCP ', '[1].'])
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 9 } })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: body.response_format ? '{}' : REPLY }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 30 },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await h.kernel.settings.update(
      core(),
      {
        'ai.chat.provider': 'openai-compatible',
        'ai.chat.baseUrl': `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        'ai.chat.model': 'fake',
      },
      null,
    );
  });

  afterAll(async () => {
    await h.kernel.settings.update(core(), { 'ai.chat.provider': 'none' }, null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('drafts the reply with the model, records usage and never sends the requester e-mail', async () => {
    const ticket = (
      await h.call(s.alice!, 'POST', `${ITSM}/tickets`, {
        title: 'VPN drops every few minutes',
        description: 'Please contact me at jane.doe@corp.example — the VPN keeps disconnecting.',
      })
    ).body;
    const before = seen.length;
    const res = await h.call(s.agent!, 'POST', `${HAI}/tickets/${ticket.id}/reply-draft`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: REPLY, mode: 'llm', model: 'fake', fallback: false });
    expect(res.body.citations.map((c: LooseJson) => c.reference)).toEqual([vpnArticle]);
    expect(res.body.insertText).toContain(`[1] [${vpnArticle}`);
    const sent = seen.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) expect(call.raw).not.toContain('jane.doe@corp.example');
    expect(sent.some((c) => c.raw.includes('[EMAIL_1]'))).toBe(true);
    const usage = await eventually(
      () =>
        h.kernel.db
          .select()
          .from(aiUsage)
          .where(and(eq(aiUsage.moduleId, 'helpdesk-ai'), eq(aiUsage.feature, 'helpdesk-ai.reply'))),
      (rows) => rows.length > 0,
    );
    expect(usage[0]).toMatchObject({
      kind: 'chat',
      model: 'fake',
      inputTokens: 120,
      outputTokens: 30,
      status: 'ok',
    });
  });

  it('falls back to the builtin vote when the model returns no valid triage', async () => {
    const raised = await h.call(s.alice!, 'POST', `${ITSM}/tickets`, {
      title: 'VPN keeps disconnecting at home',
      description: 'Drops every few minutes.',
    });
    const insight = await eventually(
      () => insightOf(raised.body.id),
      (r) => !!r,
    );
    expect(insight).toMatchObject({ mode: 'builtin' });
    expect(insight!.data).toMatchObject({ fallback: true, suggestion: { categoryId: ids.vpn } });
  });

  it('streams a grounded chat answer from the model with citations', async () => {
    const { id } = (await h.call(s.alice!, 'POST', `${HAI}/conversations`, {})).body;
    const res = await h.app.inject({
      method: 'POST',
      url: `${HAI}/conversations/${id}/messages`,
      payload: { content: 'My VPN keeps disconnecting' },
      headers: { cookie: s.alice!.cookie, 'x-csrf-token': s.alice!.csrf },
    });
    const events = sse(res.body);
    const text = events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data.text)
      .join('');
    expect(text).toBe('Switch the VPN protocol to TCP [1].');
    expect(events.find((e) => e.event === 'citations')!.data.items[0].reference).toBe(vpnArticle);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { mode: 'llm', model: 'fake' } });
    const request = seen.at(-1)!.body;
    expect(request.stream).toBe(true);
    expect(request.tools.map((t: LooseJson) => t.function.name)).toEqual(
      expect.arrayContaining(['knowledge__search_articles', 'itsm__create_ticket']),
    );
    expect(request.messages[0].content).toContain('Only help with IT');
  });
});

describe('permissions', () => {
  it('keeps the assist endpoints from plain users and conversations private', async () => {
    const ticket = (
      await h.call(s.alice!, 'POST', `${ITSM}/tickets`, { title: 'Printer jam', description: 'Paper stuck.' })
    ).body;
    for (const [method, path] of [
      ['GET', 'assist'],
      ['POST', 'reply-draft'],
      ['POST', 'summary'],
      ['POST', 'triage'],
      ['POST', 'kb-draft'],
    ] as const)
      expect((await h.call(s.alice!, method, `${HAI}/tickets/${ticket.id}/${path}`)).status).toBe(403);

    const { id } = (await h.call(s.alice!, 'POST', `${HAI}/conversations`, {})).body;
    expect((await h.call(s.bob!, 'GET', `${HAI}/conversations/${id}`)).status).toBe(404);
    expect((await h.call(s.bob!, 'POST', `${HAI}/conversations/${id}/resolve`)).status).toBe(404);
    const post = await h.app.inject({
      method: 'POST',
      url: `${HAI}/conversations/${id}/messages`,
      payload: { content: 'hi' },
      headers: { cookie: s.bob!.cookie, 'x-csrf-token': s.bob!.csrf },
    });
    expect(post.statusCode).toBe(404);
    expect((await h.call(s.alice!, 'GET', `${HAI}/conversations?scope=all`)).status).toBe(403);
    expect((await h.call(s.alice!, 'GET', `${HAI}/insights/overview`)).status).toBe(403);
  });

  it('gives insights readers the metrics and every conversation for review', async () => {
    const overview = await h.call(s.admin!, 'GET', `${HAI}/insights/overview?days=7`);
    expect(overview.status).toBe(200);
    expect(overview.body.daily).toHaveLength(7);
    expect(overview.body.conversations.escalated).toBeGreaterThanOrEqual(1);
    expect(overview.body.conversations.deflected).toBeGreaterThanOrEqual(1);
    expect(overview.body.triage.suggestions).toBeGreaterThanOrEqual(3);
    expect(overview.body.kbDrafts).toBe(1);
    expect(overview.body.usage.byFeature.map((f: LooseJson) => f.feature)).toContain('helpdesk-ai.reply');
    const all = await h.call(s.admin!, 'GET', `${HAI}/conversations?scope=all&pageSize=50`);
    expect(all.body.items.map((c: LooseJson) => c.user.displayName)).toEqual(
      expect.arrayContaining(['Alice', 'Bob']),
    );
    const mine = await h.call(s.bob!, 'GET', `${HAI}/conversations`);
    expect(mine.body.items.every((c: LooseJson) => c.user.id === ids.bob)).toBe(true);
  });
});
