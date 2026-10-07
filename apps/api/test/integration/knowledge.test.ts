import { approvalTasks, notifications, roles, users } from '@isbp/db/schema';
import type { AuthContext } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { toSessionUser } from '../../src/kernel/sessions';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
let agent: Session;
let editor: Session;
let reader: Session;
let approver: Session;
let ids: { agent: string; editor: string; approver: string };
let categoryId: string;

const API = '/api/v1/knowledge';

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(username: string, roleKey?: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  if (roleKey) {
    const [role] = await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey));
    const res = await h.call(admin, 'POST', '/api/v1/role-assignments', {
      roleId: role!.id,
      principalType: 'user',
      principalId: u!.id,
    });
    expect(res.status).toBe(201);
  }
  return u!.id;
}

async function authOf(userId: string): Promise<AuthContext> {
  const [u] = await h.kernel.db.select().from(users).where(eq(users.id, userId));
  return buildAuthContext(
    { type: 'user', id: u!.id, name: u!.displayName },
    toSessionUser(u!),
    null,
    await h.kernel.rbac.permissionsFor(u!.id),
  );
}

const tools = () => h.kernel.registry.context('knowledge').ai.tools;

/** Writes a draft as `as`, then publishes it (submit → publish by the editor unless `as` publishes). */
async function publishArticle(as: Session, body: Record<string, unknown>) {
  const created = await h.call(as, 'POST', `${API}/articles`, body);
  expect(created.status).toBe(201);
  const submitted = await h.call(as, 'POST', `${API}/articles/${created.body.reference}/submit`);
  expect(submitted.status).toBe(200);
  if (submitted.body.status === 'published') return submitted.body;
  const published = await h.call(editor, 'POST', `${API}/articles/${created.body.reference}/publish`);
  expect(published.status).toBe(200);
  return published.body;
}

const searchRefs = async (as: Session, q: string, extra = '') =>
  (await h.call(as, 'GET', `${API}/search?q=${encodeURIComponent(q)}${extra}`)).body.items.map(
    (i: { reference: string }) => i.reference,
  ) as string[];

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  ids = {
    agent: await mkUser('kb-agent', 'knowledge-agent'),
    editor: await mkUser('kb-editor', 'knowledge-editor'),
    approver: await mkUser('kb-approver'),
  };
  agent = await h.login('kb-agent');
  editor = await h.login('kb-editor');
  reader = await h.login('outsider');
  approver = await h.login('kb-approver');
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('seed', () => {
  it('creates categories, articles in every state and indexes them directly; idempotent', async () => {
    const mod = h.kernel.registry.get('knowledge')!;
    const ctx = h.kernel.registry.context('knowledge');
    await mod.seed!(ctx);
    const first = await h.call(editor, 'GET', `${API}/articles?pageSize=100`);
    expect(first.body.total).toBeGreaterThanOrEqual(25);
    const statuses = new Set(first.body.items.map((a: { status: string }) => a.status));
    expect([...statuses].sort()).toEqual(['draft', 'in_review', 'published', 'retired']);
    const locales = new Set(first.body.items.map((a: { locale: string }) => a.locale));
    expect([...locales].sort()).toEqual(['en', 'ja-JP', 'zh-TW']);

    // Indexed without the worker: semantic search finds the VPN troubleshooting article.
    const hits = (await h.call(reader, 'GET', `${API}/search?q=vpn%20keeps%20dropping&locale=en`)).body;
    expect(hits.mode).toBe('semantic');
    expect(hits.items.slice(0, 3).map((i: { title: string }) => i.title)).toContain(
      'VPN disconnects every few minutes',
    );
    // Agents-only articles never reach a plain reader.
    expect(hits.items.every((i: { audience: string }) => i.audience === 'everyone')).toBe(true);

    const due = await h.call(editor, 'GET', `${API}/articles?reviewDue=true`);
    expect(due.body.total).toBeGreaterThanOrEqual(2);

    await mod.seed!(ctx);
    const again = await h.call(editor, 'GET', `${API}/articles?pageSize=100`);
    expect(again.body.total).toBe(first.body.total);

    // Home lists: one article per translation group, in the caller's language when available.
    const popular = await h.call(
      reader,
      'GET',
      `${API}/articles?status=published&collapse=true&sort=-views&pageSize=100`,
    );
    const groups = new Set(popular.body.items.map((a: { id: string }) => a.id));
    expect(popular.body.total).toBe(groups.size);
    expect(popular.body.items.every((a: { locale: string }) => a.locale === 'en')).toBe(true);
    expect(popular.body.items[0].views).toBeGreaterThanOrEqual(popular.body.items[1].views);
    const all = await h.call(reader, 'GET', `${API}/articles?status=published&pageSize=100`);
    expect(all.body.total).toBeGreaterThan(popular.body.total);

    // Global search (⌘K) finds published articles by title or KB number.
    const global = await h.call(reader, 'GET', '/api/v1/platform/search?q=phishing');
    expect(
      global.body.hits.some((hit: { moduleId: string; href: string }) => hit.moduleId === 'knowledge'),
    ).toBe(true);

    const cats = await h.call(reader, 'GET', `${API}/categories`);
    expect(cats.body.items.length).toBe(7);
    expect(
      cats.body.items.find((c: { key: string }) => c.key === 'network-vpn').articleCount,
    ).toBeGreaterThan(1);
  });
});

describe('article lifecycle', () => {
  let ref: string;

  it('create → edit → submit → publish, then searchable (also across languages)', async () => {
    const cat = await h.call(editor, 'POST', `${API}/categories`, {
      key: 'remote-work',
      name: { en: 'Remote work', 'zh-TW': '遠端工作' },
      icon: 'house',
    });
    expect(cat.status).toBe(201);
    categoryId = cat.body.id;
    expect((await h.call(agent, 'POST', `${API}/categories`, { key: 'x1', name: { en: 'X' } })).status).toBe(
      403,
    );

    const created = await h.call(agent, 'POST', `${API}/articles`, {
      title: 'Home router: VPN tunnel disconnects',
      summary: 'Fix a tunnel that keeps dropping behind consumer routers.',
      body: 'Draft',
      categoryId,
      tags: ['VPN', 'Router'],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'draft',
      reference: expect.stringMatching(/^KB-\d{5}$/),
      tags: ['vpn', 'router'],
      canEdit: true,
      actions: ['submit'],
    });
    ref = created.body.reference;
    // Drafts are invisible to readers (404, existence not leaked) and other statuses need write.
    expect((await h.call(reader, 'GET', `${API}/articles/${ref}`)).status).toBe(404);
    expect((await h.call(reader, 'GET', `${API}/articles?status=draft`)).status).toBe(403);

    const edited = await h.call(agent, 'PATCH', `${API}/articles/${ref}`, {
      body: '## Fix\n\n1. If your VPN keeps dropping every few minutes, switch the client to TCP.\n2. Disable SIP ALG on the router.',
    });
    expect(edited.status).toBe(200);

    // The agent can't publish or retire.
    expect((await h.call(agent, 'POST', `${API}/articles/${ref}/publish`)).status).toBe(403);
    const submitted = await h.call(agent, 'POST', `${API}/articles/${ref}/submit`);
    expect(submitted.body).toMatchObject({
      status: 'in_review',
      awaitingApproval: false,
      actions: ['withdraw'],
    });
    // in_review → in_review is not a transition.
    expect((await h.call(agent, 'POST', `${API}/articles/${ref}/submit`)).body.error.code).toBe(
      'INVALID_TRANSITION',
    );

    const published = await h.call(editor, 'POST', `${API}/articles/${ref}/publish`);
    expect(published.body).toMatchObject({ status: 'published', publishedVersion: 1 });
    expect(published.body.reviewAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await h.call(editor, 'POST', `${API}/articles/${ref}/submit`)).body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { from: 'published', to: 'in_review', allowed: ['retired'] },
    });
    expect((await h.call(agent, 'PATCH', `${API}/articles/${ref}`, { title: 'Nope' })).status).toBe(403);

    // Indexed by the event handler after commit.
    const found = await eventually(
      () => searchRefs(reader, 'vpn keeps dropping', '&limit=10'),
      (r) => r.includes(ref),
    );
    expect(found).toContain(ref);

    // A zh-TW translation joins the translation group; one per language.
    const zh = await publishArticle(agent, {
      title: '家用路由器：VPN 通道一直斷線',
      summary: '在一般家用路由器後方，VPN 每隔幾分鐘就斷線時的處理方式。',
      body: '## 解決方式\n\n1. VPN 斷線時，請將用戶端切換為 TCP。\n2. 在路由器上停用 SIP ALG。',
      locale: 'zh-TW',
      categoryId,
      translationOf: created.body.id,
    });
    expect(zh.translationGroupId).toBe(created.body.translationGroupId);
    expect(zh.translations.map((t: { reference: string }) => t.reference)).toEqual([ref]);
    const dup = await h.call(agent, 'POST', `${API}/articles`, {
      title: 'Duplicate',
      locale: 'zh-TW',
      translationOf: created.body.id,
    });
    expect(dup.body.error.code).toBe('CONFLICT');

    // zh-TW query finds the group; with locale=zh-TW the zh-TW translation is returned (deduplicated).
    const zhHits = await eventually(
      () => searchRefs(reader, 'VPN 斷線', '&locale=zh-TW&limit=10'),
      (r) => r.includes(zh.reference),
    );
    expect(zhHits).toContain(zh.reference);
    expect(zhHits).not.toContain(ref);
    const enHits = await searchRefs(reader, 'VPN 斷線', '&locale=en&limit=10');
    expect(enHits).toContain(ref);
    expect(enHits).not.toContain(zh.reference);
  });

  it('counts views once per reader per day and keeps a version per publish', async () => {
    const first = await h.call(reader, 'GET', `${API}/articles/${ref}`);
    expect(first.status).toBe(200);
    expect(first.body.canEdit).toBe(false);
    await h.call(reader, 'GET', `${API}/articles/${ref}`);
    const after = await h.call(editor, 'GET', `${API}/articles/${ref}`);
    // The reader's first read counted (the second didn't); the editor's read counts once.
    expect(after.body.views).toBe(first.body.views + 1);

    // Editing a published article puts the next version live.
    const v2 = await h.call(editor, 'PATCH', `${API}/articles/${ref}`, {
      summary: 'Fix a VPN tunnel that keeps dropping behind consumer routers (updated).',
    });
    expect(v2.body.publishedVersion).toBe(2);
    const versions = await h.call(reader, 'GET', `${API}/articles/${ref}/versions`);
    expect(
      versions.body.items.map((v: { version: number; current: boolean }) => [v.version, v.current]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
    const old = await h.call(reader, 'GET', `${API}/articles/${ref}/versions/1`);
    expect(old.body.summary).toBe('Fix a tunnel that keeps dropping behind consumer routers.');
  });

  it('retire removes it from search; restore → draft; agents delete only drafts; categories in use', async () => {
    expect((await h.call(agent, 'POST', `${API}/articles/${ref}/retire`)).status).toBe(403);
    const retired = await h.call(editor, 'POST', `${API}/articles/${ref}/retire`);
    expect(retired.body.status).toBe('retired');
    const gone = await eventually(
      () => searchRefs(reader, 'Home router VPN tunnel disconnects', '&locale=en&limit=20'),
      (r) => !r.includes(ref),
    );
    expect(gone).not.toContain(ref);
    expect((await h.call(reader, 'GET', `${API}/articles/${ref}`)).status).toBe(404);

    const restored = await h.call(editor, 'POST', `${API}/articles/${ref}/restore`);
    expect(restored.body.status).toBe('draft');

    const inUse = await h.call(editor, 'DELETE', `${API}/categories/${categoryId}`);
    expect(inUse.body.error.code).toBe('IN_USE');

    const scratch = await h.call(agent, 'POST', `${API}/articles`, { title: 'Scratch' });
    expect((await h.call(agent, 'DELETE', `${API}/articles/${scratch.body.reference}`)).status).toBe(204);
    const live = await publishArticle(editor, { title: 'Editor article', body: 'Text' });
    expect((await h.call(agent, 'DELETE', `${API}/articles/${live.reference}`)).status).toBe(403);
    expect((await h.call(editor, 'DELETE', `${API}/articles/${live.reference}`)).status).toBe(204);

    const lists = await h.call(agent, 'GET', `${API}/articles?status=draft&owner=me`);
    expect(lists.body.items.map((a: { reference: string }) => a.reference)).toContain(ref);
  });
});

describe('audience enforcement', () => {
  let internal: LooseJson;

  beforeAll(async () => {
    internal = await publishArticle(editor, {
      title: 'Zephyr gateway failover runbook',
      summary: 'Internal steps for the zephyr gateway failover.',
      body: '## Failover\n\n1. Drain zephyr gateway A.\n2. Promote zephyr gateway B.',
      audience: 'agents',
    });
    expect(internal.status).toBe('published');
  });

  it('plain users can neither get nor search agents-only articles; agents can', async () => {
    expect((await h.call(reader, 'GET', `${API}/articles/${internal.reference}`)).status).toBe(404);
    const agentHits = await eventually(
      () => searchRefs(agent, 'zephyr gateway failover'),
      (r) => r.includes(internal.reference),
    );
    expect(agentHits).toContain(internal.reference);
    expect(await searchRefs(reader, 'zephyr gateway failover')).not.toContain(internal.reference);
    expect((await h.call(agent, 'GET', `${API}/articles/${internal.reference}`)).status).toBe(200);
    const list = await h.call(reader, 'GET', `${API}/articles?q=zephyr`);
    expect(list.body.total).toBe(0);
  });

  it('AI tools enforce audience and permissions', async () => {
    const readerAuth = await authOf(h.ids.outsider);
    const agentAuth = await authOf(ids.agent);
    await expect(
      tools().invoke('knowledge.get_article', { reference: internal.reference }, { auth: readerAuth }),
    ).rejects.toMatchObject({ statusCode: 404 });
    const got = await tools().invoke<LooseJson>(
      'knowledge.get_article',
      { reference: internal.reference },
      { auth: agentAuth },
    );
    expect(got).toMatchObject({
      id: internal.id,
      reference: internal.reference,
      audience: 'agents',
      href: `/knowledge/${internal.reference}`,
      body: expect.stringContaining('Promote zephyr gateway B'),
    });

    const forReader = await tools().invoke<LooseJson>(
      'knowledge.search_articles',
      { query: 'zephyr gateway failover' },
      { auth: readerAuth },
    );
    expect(forReader.items.map((i: { id: string }) => i.id)).not.toContain(internal.id);
    const forAgent = await tools().invoke<LooseJson>(
      'knowledge.search_articles',
      { query: 'zephyr gateway failover', limit: 3 },
      { auth: agentAuth },
    );
    expect(forAgent.items[0]).toEqual({
      id: internal.id,
      number: internal.number,
      reference: internal.reference,
      title: internal.title,
      summary: internal.summary,
      snippet: expect.any(String),
      href: internal.href,
      score: expect.any(Number),
      similarity: expect.any(Number),
    });

    const draft = await tools().invoke<LooseJson>(
      'knowledge.create_draft',
      {
        title: 'Printer offline after firmware update',
        body: '## Cause\n\nFirmware 2.1 resets the IP.\n\n## Resolution\n\nSet a DHCP reservation.',
        tags: ['Printer'],
        source: { type: 'itsm.ticket', id: '0190c1d2-0000-7000-8000-000000000042', reference: 'INC-00042' },
      },
      { auth: agentAuth },
    );
    expect(draft).toEqual({
      id: expect.any(String),
      number: expect.any(Number),
      reference: expect.stringMatching(/^KB-\d{5}$/),
      href: expect.stringMatching(/^\/knowledge\/KB-\d{5}$/),
    });
    const full = await h.call(agent, 'GET', `${API}/articles/${draft.reference}`);
    expect(full.body).toMatchObject({
      status: 'draft',
      audience: 'agents',
      owner: { id: ids.agent },
      tags: ['printer'],
      source: { type: 'itsm.ticket', reference: 'INC-00042' },
    });
    await expect(
      tools().invoke('knowledge.create_draft', { title: 'x', body: 'y' }, { auth: readerAuth }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('feedback', () => {
  it('one vote per reader, counts in sync, owner notified of negative feedback', async () => {
    const a = await publishArticle(agent, { title: 'Reset a frozen kiosk', body: 'Hold the power button.' });
    const no = await h.call(reader, 'POST', `${API}/articles/${a.reference}/feedback`, {
      helpful: false,
      comment: 'The kiosk has no power button.',
    });
    expect(no.body).toEqual({
      helpful: false,
      comment: 'The kiosk has no power button.',
      helpfulCount: 0,
      notHelpfulCount: 1,
    });
    const notes = await h.kernel.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ids.agent), eq(notifications.type, 'knowledge.article.feedback')));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('The kiosk has no power button.');

    const yes = await h.call(reader, 'POST', `${API}/articles/${a.reference}/feedback`, { helpful: true });
    expect(yes.body).toMatchObject({ helpfulCount: 1, notHelpfulCount: 0 });
    const same = await h.call(reader, 'POST', `${API}/articles/${a.reference}/feedback`, { helpful: true });
    expect(same.body).toMatchObject({ helpfulCount: 1, notHelpfulCount: 0 });
    const detail = await h.call(reader, 'GET', `${API}/articles/${a.reference}`);
    expect(detail.body.myFeedback).toEqual({ helpful: true, comment: null });
    expect(detail.body).toMatchObject({ helpfulCount: 1, notHelpfulCount: 0 });
  });

  it('reminds owners of articles past their review date (once per interval)', async () => {
    const a = await publishArticle(agent, {
      title: 'Overdue article',
      body: 'Old text',
      reviewAt: '2020-01-01',
    });
    const job = h.kernel.registry.get('knowledge')!.jobs!['review-reminders']!;
    const ctx = h.kernel.registry.context('knowledge');
    const run = {
      id: 'j',
      name: 'review-reminders',
      data: {},
      attempt: 1,
      log: async () => {},
      updateProgress: async () => {},
    };
    await job.handler(run, ctx);
    await job.handler(run, ctx);
    const notes = await h.kernel.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, ids.agent), eq(notifications.type, 'knowledge.article.review_due')),
      );
    expect(notes.filter((n) => n.title.includes('Overdue article'))).toHaveLength(1);
    expect(a.reviewDue).toBe(true);
  });
});

describe('workflow-bound publishing', () => {
  it('submitting starts the review; approval publishes, rejection returns to draft', async () => {
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'KB review',
      triggerKey: 'knowledge.publish',
    });
    expect(wf.status).toBe(201);
    await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: 'review',
            type: 'approval',
            name: { en: 'Editorial review' },
            approvers: [{ type: 'user', userId: ids.approver }],
            mode: 'any',
          },
        ],
      },
    });
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).body.isDefault).toBe(
      true,
    );

    const pendingTask = async (instanceId: string) =>
      (
        await h.kernel.db
          .select()
          .from(approvalTasks)
          .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')))
      )[0];

    // Even an editor's submission waits for the workflow now.
    const created = await h.call(editor, 'POST', `${API}/articles`, { title: 'Needs review', body: 'Text' });
    const submitted = await h.call(editor, 'POST', `${API}/articles/${created.body.reference}/submit`);
    expect(submitted.body).toMatchObject({ status: 'in_review', awaitingApproval: true });
    expect(
      (await h.call(editor, 'POST', `${API}/articles/${created.body.reference}/publish`)).body.error.code,
    ).toBe('INVALID_STATE');
    const task = await pendingTask(submitted.body.reviewInstanceId);
    expect((await h.call(approver, 'POST', `/api/v1/approvals/${task!.id}/approve`, {})).status).toBe(200);
    const live = await eventually(
      () => h.call(editor, 'GET', `${API}/articles/${created.body.reference}`),
      (r) => r.body.status === 'published',
    );
    expect(live.body).toMatchObject({ status: 'published', publishedVersion: 1, reviewInstanceId: null });
    const approved = await h.kernel.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ids.editor), eq(notifications.type, 'knowledge.article.approved')));
    expect(approved).toHaveLength(1);

    const second = await h.call(agent, 'POST', `${API}/articles`, {
      title: 'Will be sent back',
      body: 'Text',
    });
    const sent = await h.call(agent, 'POST', `${API}/articles/${second.body.reference}/submit`);
    const task2 = await pendingTask(sent.body.reviewInstanceId);
    await h.call(approver, 'POST', `/api/v1/approvals/${task2!.id}/reject`, { comment: 'Add screenshots.' });
    const back = await eventually(
      () => h.call(agent, 'GET', `${API}/articles/${second.body.reference}`),
      (r) => r.body.status === 'draft',
    );
    expect(back.body).toMatchObject({ status: 'draft', reviewInstanceId: null, actions: ['submit'] });
    const rejected = await eventually(
      () =>
        h.kernel.db
          .select()
          .from(notifications)
          .where(
            and(eq(notifications.userId, ids.agent), eq(notifications.type, 'knowledge.article.rejected')),
          ),
      (r) => r.length > 0,
    );
    expect(rejected[0]!.body).toContain('Add screenshots.');

    // Withdrawing cancels the running review.
    const third = await h.call(agent, 'POST', `${API}/articles`, { title: 'Withdrawn', body: 'Text' });
    await h.call(agent, 'POST', `${API}/articles/${third.body.reference}/submit`);
    const withdrawn = await h.call(agent, 'POST', `${API}/articles/${third.body.reference}/withdraw`);
    expect(withdrawn.body).toMatchObject({ status: 'draft', reviewInstanceId: null });

    // Unbinding the workflow makes publishing direct again.
    await h.call(admin, 'DELETE', `/api/v1/workflows/${wf.body.id}/default`);
    const direct = await publishArticle(editor, { title: 'Direct again', body: 'Text' });
    expect(direct.status).toBe('published');
  });
});
