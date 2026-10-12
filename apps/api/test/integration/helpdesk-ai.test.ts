import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiUsage, groups, groupMembers, roleAssignments, roles, users } from '@isbp/db/schema';
import { createMockServer } from '@isbp/integration-mocks';
import { manifest as helpdeskManifest } from '@isbp/module-helpdesk-ai/manifest';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { solidPng } from '../../src/kernel/files/extract/sample';
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

/** Tickets raised from Ask IT with this title. */
const chatTickets = async (title: string) =>
  (
    await h.kernel.db.execute<{ n: number }>(
      sql`select count(*)::int as n from itsm.tickets where title = ${title} and channel = 'chat'`,
    )
  ).rows[0]!.n;

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

describe('assist panel by ticket type and state', () => {
  it('on a problem, lists open and resolved incidents like it, to link them to it', async () => {
    const problem = await h.call(s.admin!, 'POST', `${ITSM}/tickets`, {
      type: 'problem',
      title: 'VPN keeps disconnecting every few minutes',
      description: 'Home workers lose the VPN tunnel every few minutes.',
    });
    expect(problem.status).toBe(201);
    const assist = await h.call(s.admin!, 'GET', `${HAI}/tickets/${problem.body.id}/assist`);
    expect(assist.status).toBe(200);
    expect(assist.body.triage).toBeNull();
    const similar = assist.body.similar as LooseJson[];
    expect(similar.every((x) => x.type === 'incident' && x.similarity >= 0.25)).toBe(true);
    const open = similar.filter((x) => x.status);
    expect(open.length).toBeGreaterThan(0);
    expect(similar.some((x) => !x.status && x.resolutionCode === 'solved')).toBe(true);
    // Open ones come first.
    expect(similar.findIndex((x) => !x.status)).toBeGreaterThanOrEqual(open.length);

    // What the panel's "Link to this problem" does (through ITSM's slot action).
    const linked = await h.call(s.admin!, 'POST', `${ITSM}/tickets/${problem.body.reference}/links`, {
      target: open[0].reference,
      type: 'caused_by',
      direction: 'incoming',
    });
    expect(linked.status).toBe(200);
    expect(linked.body.links.map((l: LooseJson) => l.ticket.reference)).toContain(open[0].reference);
  });

  it('shows a change only its summary: no triage, similar tickets or articles', async () => {
    const change = await h.call(s.admin!, 'POST', `${ITSM}/tickets`, {
      type: 'change',
      title: 'Upgrade the VPN gateway',
      description: 'The VPN keeps disconnecting; upgrade the gateway firmware.',
    });
    expect(change.status).toBe(201);
    const assist = await h.call(s.admin!, 'GET', `${HAI}/tickets/${change.body.id}/assist`);
    expect(assist.body).toMatchObject({ triage: null, similar: [], articles: [] });
  });

  it('leaves out weak matches and never offers triage on a finished ticket', async () => {
    const raised = await h.call(s.alice!, 'POST', `${ITSM}/tickets`, {
      title: 'VPN keeps dropping every few minutes',
      description: 'The VPN tunnel drops at home.',
    });
    await eventually(
      () => insightOf(raised.body.id),
      (r) => !!r,
    );
    const before = await h.call(s.agent!, 'GET', `${HAI}/tickets/${raised.body.id}/assist`);
    expect(before.body.triage).not.toBeNull();
    for (const x of [...before.body.similar, ...before.body.articles])
      expect(x.similarity).toBeGreaterThanOrEqual(0.25);
    await h.call(s.agent!, 'POST', `${ITSM}/tickets/${raised.body.reference}/transition`, {
      status: 'resolved',
      resolutionCode: 'solved',
      resolutionNotes: 'Switched the VPN protocol to TCP.',
    });
    const after = await h.call(s.agent!, 'GET', `${HAI}/tickets/${raised.body.id}/assist`);
    expect(after.body.triage).toBeNull();
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
    // The articles are the citations (shown as cards), not repeated in the text.
    expect(text).toBe("Here's what I found in the knowledge base:");
    expect(citations[0].title).toBe('VPN keeps disconnecting');
    const proposal = events.find((e) => e.event === 'proposal')!.data;
    expect(proposal).toMatchObject({
      title: 'My VPN keeps disconnecting every few minutes',
      type: 'incident',
    });
    // A plain-text draft: what the user said, and the article in words.
    expect(proposal.description).not.toMatch(/\*\*|^- /m);
    expect(proposal.description).toContain(`“VPN keeps disconnecting” (${vpnArticle})`);

    const detail = await h.call(s.alice!, 'GET', `${HAI}/conversations/${conversation}`);
    expect(detail.body).toMatchObject({
      status: 'open',
      title: 'My VPN keeps disconnecting every few minutes',
      messageCount: 2,
    });
    expect(detail.body.messages.map((m: LooseJson) => m.role)).toEqual(['user', 'assistant']);
    expect(detail.body.messages[1].citations[0].reference).toBe(vpnArticle);
  });

  it('answers a follow-up question on a conversation that already has a title', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `${HAI}/conversations/${conversation}/messages`,
      payload: { content: 'It still drops after switching to TCP' },
      headers: { cookie: s.alice!.cookie, 'x-csrf-token': s.alice!.csrf },
    });
    expect(res.statusCode).toBe(200);
    expect(sse(res.body).at(-1)).toMatchObject({ event: 'done' });
    const detail = await h.call(s.alice!, 'GET', `${HAI}/conversations/${conversation}`);
    expect(detail.body).toMatchObject({
      status: 'open',
      title: 'My VPN keeps disconnecting every few minutes',
      messageCount: 4,
    });
    expect(detail.body.messages.map((m: LooseJson) => m.content)).toContain(
      'It still drops after switching to TCP',
    );
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
    expect(res.body.warning).toBeNull();
    // A retry returns the ticket that was raised: never a second ticket, never an error.
    const again = await h.call(s.alice!, 'POST', `${HAI}/conversations/${conversation}/escalate`, {
      title: 'Duplicate',
      description: '',
      urgency: 3,
      type: 'incident',
    });
    expect(again.status).toBe(200);
    expect(again.body.ticket.reference).toBe(res.body.ticket.reference);
    expect(await chatTickets('Duplicate')).toBe(0);
    const detail = await h.call(s.alice!, 'GET', `${HAI}/conversations/${conversation}`);
    expect(
      detail.body.messages.filter((m: LooseJson) => m.content.includes(res.body.ticket.reference)),
    ).toHaveLength(1);
    expect((await h.call(s.alice!, 'POST', `${HAI}/conversations/${conversation}/resolve`)).status).toBe(409);
  });

  describe('when something fails after the ticket was raised', () => {
    /** A conversation with one answer and its proposal, ready to escalate. */
    async function asked(content: string) {
      const { id } = (await h.call(s.alice!, 'POST', `${HAI}/conversations`, {})).body;
      await h.app.inject({
        method: 'POST',
        url: `${HAI}/conversations/${id}/messages`,
        payload: { content },
        headers: { cookie: s.alice!.cookie, 'x-csrf-token': s.alice!.csrf },
      });
      return id as string;
    }
    const proposal = (title: string) => ({
      title,
      description: 'Still broken.',
      urgency: 2,
      type: 'incident',
    });

    /** Makes writes to `table` fail when `when` holds (`times` times, or always), like a dropped connection would. */
    async function failing(table: string, when: string, times: number | 'always') {
      const qualified = table.includes('.') ? table : `helpdesk_ai.${table}`;
      await h.kernel.db.execute(sql.raw(`create sequence if not exists helpdesk_ai.test_fail_seq`));
      await h.kernel.db.execute(sql.raw(`alter sequence helpdesk_ai.test_fail_seq restart with 1`));
      await h.kernel.db.execute(
        sql.raw(`create or replace function helpdesk_ai.test_fail() returns trigger language plpgsql as $$
          begin
            if (${when}) and (${times === 'always' ? 'true' : `nextval('helpdesk_ai.test_fail_seq') <= ${times}`}) then
              raise exception 'injected failure';
            end if;
            return new;
          end $$`),
      );
      await h.kernel.db.execute(
        sql.raw(
          `create trigger test_fail before insert or update on ${qualified} for each row execute function helpdesk_ai.test_fail()`,
        ),
      );
      return () => h.kernel.db.execute(sql.raw(`drop trigger if exists test_fail on ${qualified}`));
    }

    it('raises exactly one ticket when the same conversation is escalated twice at once', async () => {
      const id = await asked('My headset microphone is muted in calls');
      const [a, b] = await Promise.all(
        [0, 1].map(() =>
          h.call(s.alice!, 'POST', `${HAI}/conversations/${id}/escalate`, proposal('Headset muted')),
        ),
      );
      const ok = [a!, b!].filter((r) => r.status === 200);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      for (const r of [a!, b!])
        if (r.status !== 200) expect([r.status, r.body.error.code]).toEqual([409, 'INVALID_STATE']);
      expect(new Set(ok.map((r) => r.body.ticket.reference)).size).toBe(1);
      expect(await chatTickets('Headset muted')).toBe(1);
      // A later retry returns that same ticket.
      const retry = await h.call(
        s.alice!,
        'POST',
        `${HAI}/conversations/${id}/escalate`,
        proposal('Headset muted'),
      );
      expect(retry.body.ticket.reference).toBe(ok[0]!.body.ticket.reference);
    });

    it('retries the step after createTicket and answers 200 with the ticket', async () => {
      const id = await asked('My laptop dock stopped charging');
      const restore = await failing('messages', 'true', 1);
      try {
        const res = await h.call(
          s.alice!,
          'POST',
          `${HAI}/conversations/${id}/escalate`,
          proposal('Dock not charging'),
        );
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          warning: null,
          conversation: { status: 'escalated', ticketRef: res.body.ticket.reference },
        });
        const detail = await h.call(s.alice!, 'GET', `${HAI}/conversations/${id}`);
        expect(detail.body.messages.at(-1).content).toContain(res.body.ticket.reference);
        expect(await chatTickets('Dock not charging')).toBe(1);
      } finally {
        await restore();
      }
    });

    it('still links the ticket (200 + warning) when the history entry keeps failing; a retry adds it', async () => {
      const id = await asked('The office printer prints blank pages');
      const restore = await failing('messages', 'true', 'always');
      let reference: string;
      try {
        const res = await h.call(
          s.alice!,
          'POST',
          `${HAI}/conversations/${id}/escalate`,
          proposal('Blank pages'),
        );
        expect(res.status).toBe(200);
        reference = res.body.ticket.reference;
        expect(res.body).toMatchObject({
          warning: 'not_recorded',
          conversation: { status: 'escalated', ticketRef: reference },
        });
      } finally {
        await restore();
      }
      const retry = await h.call(
        s.alice!,
        'POST',
        `${HAI}/conversations/${id}/escalate`,
        proposal('Blank pages'),
      );
      expect(retry.body).toMatchObject({ warning: null, ticket: { reference } });
      const detail = await h.call(s.alice!, 'GET', `${HAI}/conversations/${id}`);
      expect(detail.body.messages.at(-1).content).toContain(reference);
      expect(await chatTickets('Blank pages')).toBe(1);
    });

    it('finds the ticket an interrupted request raised but could not link, instead of raising another', async () => {
      const id = await asked('My second monitor flickers');
      // Linking fails every time: the request still answers 200, the conversation stays without its ticket.
      const restore = await failing('conversations', 'new.ticket_ref is not null', 'always');
      let reference: string;
      try {
        const res = await h.call(
          s.alice!,
          'POST',
          `${HAI}/conversations/${id}/escalate`,
          proposal('Monitor flickers'),
        );
        expect(res.status).toBe(200);
        expect(res.body.warning).toBe('not_recorded');
        reference = res.body.ticket.reference;
      } finally {
        await restore();
      }
      const stuck = await h.call(s.alice!, 'GET', `${HAI}/conversations/${id}`);
      expect(stuck.body).toMatchObject({ status: 'escalated', ticketRef: null });

      const retry = await h.call(
        s.alice!,
        'POST',
        `${HAI}/conversations/${id}/escalate`,
        proposal('Monitor flickers'),
      );
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({
        warning: null,
        ticket: { reference },
        conversation: { status: 'escalated', ticketRef: reference },
      });
      expect(await chatTickets('Monitor flickers')).toBe(1);
    });

    it('reopens the conversation when ITSM could not raise the ticket, so the user can try again', async () => {
      const id = await asked('Teams crashes on start');
      const restore = await failing('itsm.tickets', 'true', 'always');
      try {
        const failed = await h.call(
          s.alice!,
          'POST',
          `${HAI}/conversations/${id}/escalate`,
          proposal('Teams crashes'),
        );
        expect(failed.status).toBeGreaterThanOrEqual(500);
      } finally {
        await restore();
      }
      const detail = await h.call(s.alice!, 'GET', `${HAI}/conversations/${id}`);
      expect(detail.body).toMatchObject({ status: 'open', ticketRef: null });
      const retry = await h.call(
        s.alice!,
        'POST',
        `${HAI}/conversations/${id}/escalate`,
        proposal('Teams crashes'),
      );
      expect(retry.status).toBe(200);
      expect(await chatTickets('Teams crashes')).toBe(1);
    });
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

describe('screenshots in Ask IT', () => {
  let mocks: FastifyInstance;
  let llm: string;

  /** Uploads a file to a conversation through the core attachments API, as the composer does. */
  async function attach(who: Session, conversation: string, name: string, type: string, content: Buffer) {
    const boundary = '----ask-it-test';
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/records/helpdesk-ai.conversation/${conversation}/files`,
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
        ),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
      headers: {
        cookie: who.cookie,
        'x-csrf-token': who.csrf,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
    });
  }

  const ask = (who: Session, conversation: string, payload: LooseJson) =>
    h.app.inject({
      method: 'POST',
      url: `${HAI}/conversations/${conversation}/messages`,
      payload,
      headers: { cookie: who.cookie, 'x-csrf-token': who.csrf },
    });

  const start = async (who: Session) =>
    (await h.call(who, 'POST', `${HAI}/conversations`, {})).body.id as string;

  const vpnDialog = () =>
    solidPng(40, 20, [255, 255, 255], {
      text: 'My VPN keeps disconnecting every few minutes',
    });

  beforeAll(async () => {
    mocks = await createMockServer();
    await mocks.listen({ port: 0, host: '127.0.0.1' });
    llm = `http://127.0.0.1:${(mocks.server.address() as AddressInfo).port}/llm/v1`;
  });

  afterAll(async () => {
    await h.kernel.settings.update(
      core(),
      { 'ai.chat.provider': 'none', 'ai.vision.provider': 'none', 'ai.images.chat': false },
      null,
    );
    await mocks?.close();
  });

  it('are refused while no model may read images', async () => {
    expect((await h.call(s.alice!, 'GET', `${HAI}/status`)).body.images).toBe(false);
    const conversation = await start(s.alice!);
    const file = await attach(s.alice!, conversation, 'dialog.png', 'image/png', vpnDialog());
    expect(file.statusCode, file.body).toBe(201);
    const res = await ask(s.alice!, conversation, { content: 'What is this?', images: [file.json().id] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AI_IMAGES_NOT_ALLOWED');
  });

  it('are read by the image description model and answered from, even without a chat model', async () => {
    await h.kernel.settings.update(
      core(),
      { 'ai.vision.provider': 'openai-compatible', 'ai.vision.baseUrl': llm, 'ai.vision.model': 'scripted' },
      null,
    );
    expect((await h.call(s.alice!, 'GET', `${HAI}/status`)).body.images).toBe(true);
    const conversation = await start(s.alice!);
    const file = (await attach(s.alice!, conversation, 'vpn-error.png', 'image/png', vpnDialog())).json();
    // Only a screenshot, no words: what it says is the question.
    const res = await ask(s.alice!, conversation, { content: '', images: [file.id] });
    expect(res.statusCode, res.body).toBe(200);
    const events = sse(res.body);
    expect(events[0]).toEqual({ event: 'tool', data: { name: 'read_images' } });
    expect(events.find((e) => e.event === 'citations')?.data.items[0].reference).toBe(vpnArticle);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { mode: 'builtin' } });
    const proposal = events.find((e) => e.event === 'proposal')!.data;
    expect(proposal.title).toBe('My VPN keeps disconnecting every few minutes');
    expect(proposal.description).toContain('My VPN keeps disconnecting every few minutes');

    const detail = (await h.call(s.alice!, 'GET', `${HAI}/conversations/${conversation}`)).body;
    // Titled with the file name until the screenshot was read, then with what it says.
    expect(detail.title).toBe('My VPN keeps disconnecting every few minutes');
    expect(detail.messages[0]).toMatchObject({
      role: 'user',
      content: '',
      images: [{ id: file.id, name: 'vpn-error.png', href: `/api/v1/files/${file.id}` }],
    });
    // The description is kept with the question (read once).
    const [row] = (
      await h.kernel.db.execute<{ images: LooseJson[] }>(
        sql`select images from helpdesk_ai.messages where conversation_id = ${conversation} and role = 'user'`,
      )
    ).rows;
    expect(row!.images[0].description).toContain('every few minutes');
    const usage = await h.kernel.db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.moduleId, 'helpdesk-ai'), eq(aiUsage.kind, 'describe')));
    expect(usage.length).toBeGreaterThanOrEqual(1);
  });

  it('must be images on the same conversation', async () => {
    const mine = await start(s.alice!);
    const other = await start(s.alice!);
    const text = (await attach(s.alice!, mine, 'notes.txt', 'text/plain', Buffer.from('VPN notes'))).json();
    expect((await ask(s.alice!, mine, { content: 'See notes', images: [text.id] })).statusCode).toBe(400);
    const elsewhere = (await attach(s.alice!, other, 'shot.png', 'image/png', vpnDialog())).json();
    expect((await ask(s.alice!, mine, { content: 'See this', images: [elsewhere.id] })).statusCode).toBe(400);
    // Someone else's conversation takes no files from Alice.
    const bobs = await start(s.bob!);
    expect(
      (await attach(s.alice!, bobs, 'shot.png', 'image/png', vpnDialog())).statusCode,
    ).toBeGreaterThanOrEqual(403);
    expect((await ask(s.alice!, mine, { content: '', images: [] })).statusCode).toBe(400);
  });

  it('go to a chat model that may look at images', async () => {
    await h.kernel.settings.update(
      core(),
      {
        'ai.chat.provider': 'openai-compatible',
        'ai.chat.baseUrl': llm,
        'ai.chat.model': 'scripted',
        'ai.vision.provider': 'chat',
        'ai.images.chat': true,
      },
      null,
    );
    const conversation = await start(s.alice!);
    const file = (
      await attach(s.alice!, conversation, 'light.png', 'image/png', solidPng(8, 8, [220, 30, 30]))
    ).json();
    const res = await ask(s.alice!, conversation, {
      content: 'What colour is the light on my dock?',
      images: [file.id],
    });
    const events = sse(res.body);
    // The stand-in names the colour only when it sees the image itself.
    const text = events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data.text)
      .join('');
    expect(text).toBe('red');
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { mode: 'llm', model: 'scripted' } });
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

  it('gives service desk report readers the metrics and waiting suggestions, but not the conversations', async () => {
    // The agent holds itsm.reports.read (Service desk agent role), not helpdesk-ai.insights.read.
    const overview = await h.call(s.agent!, 'GET', `${HAI}/insights/overview?days=7`);
    expect(overview.status).toBe(200);
    expect((await h.call(s.agent!, 'GET', `${HAI}/conversations?scope=all`)).status).toBe(403);
    const pending = await h.call(s.agent!, 'GET', `${HAI}/insights/pending?days=7`);
    expect(pending.status).toBe(200);
    expect(pending.body.total).toBeGreaterThanOrEqual(1);
    for (const p of pending.body.items) {
      expect(p.reference).toMatch(/^(INC|SR)-\d{5}$/);
      expect(p.title).toEqual(expect.any(String));
    }
    // Suggestions already applied or on finished tickets aren't waiting.
    const refs = pending.body.items.map((p: LooseJson) => p.ticketId);
    const decided = await h.kernel.db.execute<{ ticket_id: string }>(
      sql`select ticket_id from helpdesk_ai.insights where kind = 'triage' and status <> 'suggested'`,
    );
    for (const r of decided.rows) expect(refs).not.toContain(r.ticket_id);
    expect((await h.call(s.alice!, 'GET', `${HAI}/insights/pending`)).status).toBe(403);
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
