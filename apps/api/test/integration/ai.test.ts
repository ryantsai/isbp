import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiUsage, auditLogs } from '@isbp/db/schema';
import type { AuthContext } from '@isbp/sdk/server';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { createHarness, type Harness, type Session } from './harness';

let h: Harness;
let admin: Session;
let outsider: Session;

/* ───────────── a fake OpenAI-compatible provider ───────────── */

interface Seen {
  path: string;
  body: { messages: { role: string; content: string | null }[]; stream?: boolean; response_format?: unknown };
}
const seen: Seen[] = [];
let reply: (body: Seen['body']) => unknown = () => ({
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
});
let server: Server;
let baseUrl: string;

async function readBody(req: IncomingMessage) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw) as Seen['body'];
}

const core = () => h.kernel.registry.get('core')!.manifest;
const ctx = (id = 'core') => h.kernel.registry.context(id);

async function authOf(userId: string): Promise<AuthContext> {
  const permissions = await h.kernel.rbac.permissionsFor(userId);
  const user = {
    id: userId,
    email: `${userId}@test.example`,
    username: userId,
    displayName: 'Test user',
    locale: 'en' as const,
    timezone: 'UTC',
    departmentId: null,
    avatarUrl: null,
  };
  return buildAuthContext({ type: 'user', id: userId, name: user.displayName }, user, null, permissions);
}

async function configure(values: Record<string, unknown>) {
  await h.kernel.settings.update(core(), values, null);
}

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
  outsider = await h.login('outsider');
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({ path: req.url ?? '', body });
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const delta of ['Hello ', '[EMA', 'IL_1]', '!']) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
      }
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4 } })}\n\n`,
      );
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply(body)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  server?.close();
  await h?.close();
});

beforeEach(() => {
  seen.length = 0;
});

describe('AI status and administration', () => {
  it('tells every signed-in user which mode the gateway is in', async () => {
    const res = await h.call(outsider, 'GET', '/api/v1/ai/status');
    expect(res.status).toBe(200);
    expect(res.body.chat).toEqual({ available: false, provider: 'none', model: null });
    expect(res.body.embeddings.provider).toBe('builtin');
    expect(['pgvector', 'portable']).toContain(res.body.vectorStore);
  });

  it('stores provider keys encrypted and never returns them', async () => {
    expect((await h.call(outsider, 'GET', '/api/v1/ai/config')).status).toBe(403);
    const put = await h.call(admin, 'PUT', '/api/v1/ai/config', {
      chat: { provider: 'anthropic', apiKey: 'sk-ant-test-secret-value', model: '' },
      masking: { categories: ['email', 'secret'] },
    });
    expect(put.status).toBe(200);
    expect(put.body.chat).toMatchObject({
      provider: 'anthropic',
      hasApiKey: true,
      defaultModel: 'claude-opus-5-5',
    });
    expect(JSON.stringify(put.body)).not.toContain('sk-ant-test-secret-value');
    expect(put.body.masking.categories).toEqual(['email', 'secret']);
    const status = await h.call(outsider, 'GET', '/api/v1/ai/status');
    expect(status.body.chat).toEqual({ available: true, provider: 'anthropic', model: 'claude-opus-5-5' });

    const [audit] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'core.ai.config_updated'))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);
    expect(JSON.stringify(audit?.changes)).not.toContain('sk-ant-test-secret-value');

    // Remove the key and go back to no chat model.
    const off = await h.call(admin, 'PUT', '/api/v1/ai/config', {
      chat: { provider: 'none', apiKey: '' },
      masking: { categories: ['email', 'phone', 'ip', 'card', 'id', 'secret'] },
    });
    expect(off.body.chat.hasApiKey).toBe(false);
  });

  it('rejects invalid custom masking patterns', async () => {
    const res = await h.call(admin, 'PUT', '/api/v1/ai/config', { masking: { custom: '(unclosed' } });
    expect(res.status).toBe(400);
  });
});

describe('semantic index', () => {
  beforeAll(async () => {
    const index = ctx().ai.index;
    await index.upsert({
      type: 'core.test-doc',
      id: 'vpn',
      title: 'VPN disconnects every few minutes',
      text: '## Symptoms\nThe VPN connection drops when working from home.\n\n## Fix\n1. Update the VPN client.\n2. Switch to the TCP profile.',
      locale: 'en',
      href: '/docs/vpn',
      acl: { permission: 'core.users.read' },
      metadata: { area: 'network' },
    });
    await index.upsert({
      type: 'core.test-doc',
      id: 'printer',
      title: 'Clear a stuck print queue',
      text: 'Open the print queue, cancel all documents and restart the spooler.',
      acl: { permission: 'core.users.read' },
      metadata: { area: 'hardware' },
    });
    await index.upsert({
      type: 'core.test-doc',
      id: 'zh-vpn',
      title: 'VPN 斷線怎麼辦',
      text: '在家使用 VPN 時連線一直斷線，請更新用戶端並改用 TCP 設定檔。',
      locale: 'zh-TW',
      acl: { permission: 'core.users.read' },
    });
    await index.upsert({
      type: 'core.test-doc',
      id: 'private',
      title: 'Outsider personal note',
      text: 'Only the outsider may retrieve this note about the vpn.',
      acl: { permission: 'core.users.lifecycle', users: [h.ids.outsider] },
    });
  });

  it('finds the relevant document first (hybrid vector + keyword)', async () => {
    const hits = await ctx().ai.index.search('my vpn keeps dropping', {
      types: ['core.test-doc'],
      auth: await authOf(h.ids.admin),
    });
    expect(hits[0]?.id).toBe('vpn');
    expect(hits[0]?.similarity).toBeGreaterThan(0);
    expect(hits.find((x) => x.id === 'printer')?.score ?? 0).toBeLessThan(hits[0]!.score);
    expect(hits[0]?.snippet.toLowerCase()).toContain('vpn');
  });

  it('ranks a short exact match above a long document with many weak chunks', async () => {
    const index = ctx().ai.index;
    const filler = Array.from(
      { length: 12 },
      (_, i) =>
        `## Step ${i}\nOpen the gateway settings page and review section ${i} of the software catalogue carefully before continuing with the installation.`,
    ).join('\n\n');
    await index.upsert({
      type: 'core.rank-doc',
      id: 'long',
      title: 'Install approved software',
      text: filler,
      acl: { permission: 'core.users.read' },
    });
    await index.upsert({
      type: 'core.rank-doc',
      id: 'exact',
      title: 'Zephyr gateway failover',
      text: 'When the zephyr gateway fails over, sessions reconnect automatically within a minute.',
      acl: { permission: 'core.users.read' },
    });
    const hits = await index.search('zephyr gateway failover', {
      types: ['core.rank-doc'],
      auth: await authOf(h.ids.admin),
    });
    expect(hits[0]?.id).toBe('exact');
    expect(hits[0]!.score).toBeLessThanOrEqual(1);
  });

  it('works across languages and filters by metadata', async () => {
    const zh = await ctx().ai.index.search('VPN 斷線', {
      types: ['core.test-doc'],
      auth: await authOf(h.ids.admin),
    });
    expect(zh.slice(0, 2).map((x) => x.id)).toContain('zh-vpn');
    const hw = await ctx().ai.index.search('restart', {
      types: ['core.test-doc'],
      auth: await authOf(h.ids.admin),
      filter: { area: 'hardware' },
    });
    expect(hw.map((x) => x.id)).toEqual(['printer']);
  });

  it("never returns chunks the caller's permissions don't cover", async () => {
    const asOutsider = await ctx().ai.index.search('vpn', {
      types: ['core.test-doc'],
      auth: await authOf(h.ids.outsider),
    });
    expect(asOutsider.map((x) => x.id)).toEqual(['private']);
    const asAdmin = await ctx().ai.index.search('vpn note', {
      types: ['core.test-doc'],
      auth: await authOf(h.ids.admin),
      excludeIds: ['vpn'],
    });
    expect(asAdmin.map((x) => x.id)).not.toContain('vpn');
  });

  it('re-embeds only changed chunks and removes documents', async () => {
    await ctx().ai.index.remove('core.test-doc', 'printer');
    const res = await h.call(admin, 'GET', '/api/v1/ai/index');
    expect(res.status).toBe(200);
    expect(res.body.types.find((t: { type: string }) => t.type === 'core.test-doc').documents).toBe(3);
    expect(res.body.stale).toBe(0);
  });
});

describe('tool registry', () => {
  it('runs tools with the caller’s permissions and audits every call', async () => {
    const tools = ctx('announcements').ai.tools;
    await expect(
      tools.invoke('core.find_users', { query: 'admin' }, { auth: await authOf(h.ids.outsider) }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const found = await tools.invoke<{ username: string }[]>(
      'core.find_users',
      { query: 'admin' },
      { auth: await authOf(h.ids.admin) },
    );
    expect(JSON.stringify(found)).toContain('admin');
    const rows = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'core.ai.tool_invoked'))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(2);
    expect(rows.map((r) => r.outcome).sort()).toEqual(['denied', 'success']);
    // A module acting for a user is recorded as its AI on the user's behalf.
    expect(rows.find((r) => r.outcome === 'success')).toMatchObject({
      actorType: 'ai_agent',
      onBehalfOfId: h.ids.admin,
    });
  });

  it('refuses destructive tools without confirmation and validates input', async () => {
    const auth = await authOf(h.ids.admin);
    await expect(
      ctx().ai.tools.invoke('core.offboard_user', { userId: h.ids.outsider, reason: 'test' }, { auth }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(ctx().ai.tools.invoke('core.find_users', { query: '' }, { auth })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(ctx().ai.tools.invoke('nope.tool', {}, { auth })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lists only the tools a principal may call', async () => {
    const names = ctx()
      .ai.tools.list(await authOf(h.ids.outsider))
      .map((t) => t.name);
    expect(names).not.toContain('core.offboard_user');
  });
});

describe('chat through an OpenAI-compatible provider', () => {
  beforeAll(async () => {
    await configure({
      'ai.chat.provider': 'openai-compatible',
      'ai.chat.baseUrl': baseUrl,
      'ai.chat.model': 'fake-model',
      'ai.chat.inputPrice': 1,
      'ai.chat.outputPrice': 2,
      'ai.budget.monthlyUsd': 0,
    });
  });

  it('masks personal data before it leaves and restores it in the reply', async () => {
    reply = () => ({
      choices: [{ message: { content: 'I will email [EMAIL_1] now.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const res = await ctx('announcements').ai.chat({
      feature: 'test.mask',
      system: 'Be helpful.',
      messages: [{ role: 'user', content: 'Please contact jane.doe@example.com from 10.1.2.3' }],
    });
    const sent = JSON.stringify(seen[0]!.body);
    expect(seen[0]!.path).toBe('/v1/chat/completions');
    expect(sent).not.toContain('jane.doe@example.com');
    expect(sent).not.toContain('10.1.2.3');
    expect(sent).toContain('[EMAIL_1]');
    expect(res.text).toBe('I will email jane.doe@example.com now.');
    expect(res.usage).toMatchObject({ inputTokens: 100, outputTokens: 50 });
    expect(res.usage.costUsd).toBeCloseTo((100 * 1 + 50 * 2) / 1_000_000, 10);
    const [row] = await h.kernel.db.select().from(aiUsage).where(eq(aiUsage.feature, 'test.mask')).limit(1);
    expect(row).toMatchObject({
      moduleId: 'announcements',
      provider: 'openai-compatible',
      status: 'ok',
      masked: 2,
    });
  });

  it('returns parsed structured output', async () => {
    reply = () => ({
      choices: [
        {
          message: { content: '```json\n{"category":"network","confidence":0.9}\n```' },
          finish_reason: 'stop',
        },
      ],
    });
    const res = await ctx().ai.chat({
      feature: 'test.schema',
      messages: [{ role: 'user', content: 'Classify: VPN down' }],
      schema: z.object({ category: z.string(), confidence: z.number() }),
    });
    expect(res.output).toEqual({ category: 'network', confidence: 0.9 });
    expect(seen[0]!.body.response_format).toMatchObject({ type: 'json_schema' });
  });

  it('maps tool calls back to registry names', async () => {
    reply = () => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'core__find_users', arguments: '{"query":"ann"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const res = await ctx().ai.chat({
      feature: 'test.tools',
      messages: [{ role: 'user', content: 'who is ann?' }],
      tools: ['core.find_users'],
    });
    expect(res.stopReason).toBe('tool_use');
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'core.find_users', input: { query: 'ann' } }]);
  });

  it('streams text and unmasks placeholders split across deltas', async () => {
    let text = '';
    let done: unknown;
    for await (const evt of ctx().ai.stream({
      feature: 'test.stream',
      messages: [{ role: 'user', content: 'hi from ann@example.com' }],
    })) {
      if (evt.type === 'text') text += evt.delta;
      else done = evt.result;
    }
    expect(text).toBe('Hello ann@example.com!');
    expect(done).toMatchObject({
      text: 'Hello ann@example.com!',
      usage: { inputTokens: 12, outputTokens: 4 },
    });
  });

  it('refuses calls once the monthly budget is spent', async () => {
    await configure({ 'ai.budget.monthlyUsd': 0.0000001 });
    h.kernel.ai['budgetCache'] = undefined;
    await expect(
      ctx().ai.chat({ feature: 'test.budget', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
    await configure({ 'ai.budget.monthlyUsd': 0 });
    h.kernel.ai['budgetCache'] = undefined;
  });

  it('reports provider failures as AI_PROVIDER_ERROR and the test endpoint explains them', async () => {
    await configure({ 'ai.chat.baseUrl': 'http://127.0.0.1:1/v1' });
    await expect(
      ctx().ai.chat({ feature: 'test.down', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    const test = await h.call(admin, 'POST', '/api/v1/ai/test');
    expect(test.body.chat.ok).toBe(false);
    expect(test.body.embeddings.ok).toBe(true);
    await configure({ 'ai.chat.baseUrl': baseUrl });
  });

  it('summarises usage for administrators', async () => {
    const res = await h.call(admin, 'GET', '/api/v1/ai/usage?days=7');
    expect(res.status).toBe(200);
    expect(res.body.totals.calls).toBeGreaterThan(0);
    expect(res.body.daily).toHaveLength(7);
    expect(res.body.byFeature.map((f: { feature: string }) => f.feature)).toContain('test.mask');
    expect(res.body.totals.toolCalls).toBeGreaterThan(0);
  });
});

describe('request portal registry', () => {
  it('lists module records under "My requests" for the people they concern', async () => {
    await ctx('announcements').portal.track({
      kind: 'announcements.post',
      id: 'p-1',
      reference: 'ANN-1',
      title: { en: 'Example module request' },
      state: 'open',
      statusKey: 'announcements.status.pending',
      tone: 'info',
      href: '/announcements/p-1',
      people: [h.ids.outsider, null],
    });
    const mine = await h.call(outsider, 'GET', '/api/v1/me/requests?status=open');
    expect(mine.status).toBe(200);
    expect(mine.body.items).toContainEqual(
      expect.objectContaining({
        kind: 'module',
        reference: 'ANN-1',
        href: '/announcements/p-1',
        moduleId: 'announcements',
      }),
    );
    const others = await h.call(admin, 'GET', '/api/v1/me/requests');
    expect(others.body.items.map((i: { reference: string }) => i.reference)).not.toContain('ANN-1');

    await ctx('announcements').portal.track({
      kind: 'announcements.post',
      id: 'p-1',
      reference: 'ANN-1',
      title: 'Example module request',
      state: 'closed',
      statusKey: 'announcements.status.done',
      href: '/announcements/p-1',
      people: [h.ids.outsider],
    });
    const closed = await h.call(outsider, 'GET', '/api/v1/me/requests?status=closed');
    expect(closed.body.items.map((i: { reference: string }) => i.reference)).toContain('ANN-1');
    await ctx('announcements').portal.untrack('announcements.post', 'p-1');
    const gone = await h.call(outsider, 'GET', '/api/v1/me/requests');
    expect(gone.body.items.map((i: { reference: string }) => i.reference)).not.toContain('ANN-1');
  });

  it("refuses items outside the module's namespace", async () => {
    await expect(
      ctx('announcements').portal.track({
        kind: 'itsm.ticket',
        id: 'x',
        reference: 'X',
        title: 'x',
        state: 'open',
        statusKey: 'x',
        href: '/x',
        people: [],
      }),
    ).rejects.toThrow(/must start with/);
  });

  it("shows modules' portal entries to people allowed to use them", async () => {
    const res = await h.call(outsider, 'GET', '/api/v1/portal/entries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
