/**
 * Knowledge authoring as people meet it: a new article is in the author's language, the editor's main button knows
 * whether submitting publishes, goes to an editor or to an approval, the management tabs have counts, and a double
 * click (two requests at once) on Submit, Publish or Retire changes the article once — one 200 and one 409, one
 * version, one audit entry, one event.
 */
import { auditLogs, outboxEvents, roles, users } from '@isbp/db/schema';
import { articleVersions } from '@isbp/module-knowledge/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { toSessionUser } from '../../src/kernel/sessions';
import { createHarness, type Harness, PASSWORD, type Session } from './harness';

let h: Harness;
let admin: Session;
let agent: Session;
let editor: Session;
const ids = {} as Record<'agent' | 'editor' | 'approver', string>;

const API = '/api/v1/knowledge';

async function mkUser(username: string, locale: string, roleKey?: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      locale,
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

const auditOf = (action: string, entityId: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)));
const eventsOf = async (name: string, articleId: string) =>
  (await h.kernel.db.select().from(outboxEvents).where(eq(outboxEvents.name, name))).filter(
    (e) => (e.payload as { articleId?: string }).articleId === articleId,
  );
const versionsOf = (articleId: string) =>
  h.kernel.db.select().from(articleVersions).where(eq(articleVersions.articleId, articleId));
/** Both requests at once; the statuses sorted so a test can expect `[200, 409]`. */
const twice = async (as: Session, path: string) => {
  const results = await Promise.all([h.call(as, 'POST', path), h.call(as, 'POST', path)]);
  return { results, statuses: results.map((r) => r.status).sort() };
};

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
  ids.agent = await mkUser('kbux-agent', 'zh-TW', 'knowledge-agent');
  ids.editor = await mkUser('kbux-editor', 'ja-JP', 'knowledge-editor');
  ids.approver = await mkUser('kbux-approver', 'en');
  agent = await h.login('kbux-agent');
  editor = await h.login('kbux-editor');
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('language of a new article', () => {
  it("is the author's, also for the AI tool; a translation takes the first language its group lacks", async () => {
    const zh = await h.call(agent, 'POST', `${API}/articles`, { title: '印表機無法列印', body: '步驟' });
    expect(zh.status).toBe(201);
    expect(zh.body.locale).toBe('zh-TW');
    // Said explicitly, it wins.
    const en = await h.call(agent, 'POST', `${API}/articles`, {
      title: 'Printer',
      body: 'Steps',
      locale: 'en',
    });
    expect(en.body.locale).toBe('en');

    // A translation of the English article written by the zh-TW author: zh-TW (free in the group).
    const tr = await h.call(agent, 'POST', `${API}/articles`, {
      title: '印表機',
      body: '步驟',
      translationOf: en.body.id,
    });
    expect(tr.body.locale).toBe('zh-TW');
    // A second translation by the same author: their language is taken, so the first one missing (ja-JP).
    const tr2 = await h.call(agent, 'POST', `${API}/articles`, {
      title: 'プリンター',
      body: '手順',
      translationOf: en.body.id,
    });
    expect(tr2.body.locale).toBe('ja-JP');

    // ITSM's "Write known-error article" goes through the AI tool without a language: the caller's.
    const [u] = await h.kernel.db.select().from(users).where(eq(users.id, ids.editor));
    const auth = buildAuthContext(
      { type: 'user', id: u!.id, name: u!.displayName },
      toSessionUser(u!),
      null,
      await h.kernel.rbac.permissionsFor(u!.id),
    );
    const draft = (await h.kernel.registry.context('knowledge').ai.tools.invoke(
      'knowledge.create_draft',
      {
        title: '既知のエラー: VPN',
        body: '## 回避策\n\n1. TCP に切り替えます。',
        source: { type: 'itsm.ticket', id: 'prb-1', reference: 'PRB-00001' },
      },
      { auth },
    )) as { reference: string; href: string };
    const opened = await h.call(editor, 'GET', `${API}/articles/${draft.reference}`);
    expect(opened.body).toMatchObject({
      status: 'draft',
      locale: 'ja-JP',
      audience: 'agents',
      canEdit: true,
      actions: ['submit'],
      // The editor's button: this editor's submission goes live.
      submitOutcome: 'publish',
      source: { type: 'itsm.ticket', reference: 'PRB-00001' },
    });
    expect(draft.href).toBe(`/knowledge/${draft.reference}`);
    const live = await h.call(editor, 'POST', `${API}/articles/${draft.reference}/submit`);
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('published');
  });
});

describe('what "submit" does', () => {
  it('publish for editors, review for authors, approval while a review workflow is bound', async () => {
    const outcome = async (as: Session, query = 'audience=everyone') =>
      (await h.call(as, 'GET', `${API}/articles/submit-outcome?${query}`)).body.outcome;
    expect(await outcome(editor)).toBe('publish');
    expect(await outcome(agent)).toBe('review');
    const draft = await h.call(agent, 'POST', `${API}/articles`, { title: 'Agent draft', body: 'Text' });
    expect(draft.body.submitOutcome).toBe('review');
    // Readers can't ask (it is an authoring question).
    expect((await h.call(await h.login('outsider'), 'GET', `${API}/articles/submit-outcome`)).status).toBe(
      403,
    );

    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'KB review',
      triggerKey: 'knowledge.publish',
    });
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
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    try {
      expect(await outcome(editor)).toBe('approval');
      expect(await outcome(agent, 'audience=agents&locale=zh-TW')).toBe('approval');
      const mine = await h.call(editor, 'POST', `${API}/articles`, { title: 'Editor draft', body: 'Text' });
      expect(mine.body.submitOutcome).toBe('approval');
      const sent = await h.call(editor, 'POST', `${API}/articles/${mine.body.reference}/submit`);
      expect(sent.body).toMatchObject({ status: 'in_review', awaitingApproval: true, submitOutcome: null });
    } finally {
      await h.call(admin, 'DELETE', `/api/v1/workflows/${wf.body.id}/default`);
    }
    expect(await outcome(editor)).toBe('publish');
  });
});

describe('management tab counts', () => {
  it('count per tab with the list filters; authors see their own drafts and due reviews', async () => {
    const before = (await h.call(editor, 'GET', `${API}/articles/counts`)).body;
    expect(Object.keys(before).sort()).toEqual(['due', 'mine', 'published', 'retired', 'review']);
    await h.call(editor, 'POST', `${API}/articles`, { title: 'Counted draft', body: 'Text', locale: 'en' });
    const after = (await h.call(editor, 'GET', `${API}/articles/counts`)).body;
    expect(after.mine).toBe(before.mine + 1);
    const list = await h.call(editor, 'GET', `${API}/articles?status=published&pageSize=1`);
    expect(after.published).toBe(list.body.total);

    // Filters narrow every count like the table.
    const zh = (await h.call(editor, 'GET', `${API}/articles/counts?locale=zh-TW`)).body;
    const zhList = await h.call(editor, 'GET', `${API}/articles?status=published&locale=zh-TW&pageSize=1`);
    expect(zh.published).toBe(zhList.body.total);
    expect((await h.call(editor, 'GET', `${API}/articles/counts?category=no-such-category`)).body).toEqual({
      mine: 0,
      review: 0,
      published: 0,
      retired: 0,
      due: 0,
    });
    // The agent's "My drafts" are theirs only.
    const agentCounts = (await h.call(agent, 'GET', `${API}/articles/counts`)).body;
    const agentDrafts = await h.call(agent, 'GET', `${API}/articles?status=draft&owner=me&pageSize=1`);
    expect(agentCounts.mine).toBe(agentDrafts.body.total);
    expect((await h.call(await h.login('outsider'), 'GET', `${API}/articles/counts`)).status).toBe(403);
  });
});

describe('deleting an article', () => {
  it('drops its record links (e.g. the problem it was the known-error article of)', async () => {
    const records = h.kernel.registry.context('knowledge').records;
    const a = await h.call(agent, 'POST', `${API}/articles`, { title: 'Linked draft', body: 'Text' });
    const b = await h.call(agent, 'POST', `${API}/articles`, { title: 'Other draft', body: 'Text' });
    const ref = { type: 'knowledge.article', id: a.body.id };
    await records.link(ref, { type: 'knowledge.article', id: b.body.id });
    expect(await records.linked(ref)).toHaveLength(1);
    expect((await h.call(agent, 'DELETE', `${API}/articles/${a.body.id}`)).status).toBe(204);
    expect(await records.linked({ type: 'knowledge.article', id: b.body.id })).toHaveLength(0);
    // Twice at once: one deletion, the other finds nothing (404).
    const { statuses } = await (async () => {
      const results = await Promise.all([
        h.call(agent, 'DELETE', `${API}/articles/${b.body.id}`),
        h.call(agent, 'DELETE', `${API}/articles/${b.body.id}`),
      ]);
      return { statuses: results.map((r) => r.status).sort() };
    })();
    expect(statuses).toEqual([204, 404]);
    expect(await auditOf('knowledge.article.deleted', b.body.id)).toHaveLength(1);
  });
});

describe('two requests at once', () => {
  it('double submit by an editor publishes once', async () => {
    const a = await h.call(editor, 'POST', `${API}/articles`, { title: 'Double submit', body: 'Text' });
    const { results, statuses } = await twice(editor, `${API}/articles/${a.body.id}/submit`);
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('INVALID_TRANSITION');
    expect(await versionsOf(a.body.id)).toHaveLength(1);
    expect(await auditOf('knowledge.article.submitted', a.body.id)).toHaveLength(1);
    expect(await auditOf('knowledge.article.published', a.body.id)).toHaveLength(1);
    expect(await eventsOf('knowledge.article.published', a.body.id)).toHaveLength(1);
    expect(await eventsOf('knowledge.article.submitted', a.body.id)).toHaveLength(1);
  });

  it('double publish of a submitted article makes one version', async () => {
    const a = await h.call(agent, 'POST', `${API}/articles`, { title: 'Double publish', body: 'Text' });
    expect((await h.call(agent, 'POST', `${API}/articles/${a.body.id}/submit`)).body.status).toBe(
      'in_review',
    );
    const { statuses } = await twice(editor, `${API}/articles/${a.body.id}/publish`);
    expect(statuses).toEqual([200, 409]);
    expect(await versionsOf(a.body.id)).toHaveLength(1);
    expect(await auditOf('knowledge.article.published', a.body.id)).toHaveLength(1);
    expect(await eventsOf('knowledge.article.published', a.body.id)).toHaveLength(1);

    // Retire twice: one retirement.
    const retired = await twice(editor, `${API}/articles/${a.body.id}/retire`);
    expect(retired.statuses).toEqual([200, 409]);
    expect(await auditOf('knowledge.article.retired', a.body.id)).toHaveLength(1);
    expect(await eventsOf('knowledge.article.retired', a.body.id)).toHaveLength(1);

    // Restore twice: one draft again.
    const restored = await twice(editor, `${API}/articles/${a.body.id}/restore`);
    expect(restored.statuses).toEqual([200, 409]);
    expect(await auditOf('knowledge.article.restored', a.body.id)).toHaveLength(1);
  });

  it('withdraw and publish at once: one wins, the article is consistent', async () => {
    const a = await h.call(agent, 'POST', `${API}/articles`, { title: 'Withdraw or publish', body: 'Text' });
    await h.call(agent, 'POST', `${API}/articles/${a.body.id}/submit`);
    const [w, p] = await Promise.all([
      h.call(agent, 'POST', `${API}/articles/${a.body.id}/withdraw`),
      h.call(editor, 'POST', `${API}/articles/${a.body.id}/publish`),
    ]);
    expect([w.status, p.status].sort()).toEqual([200, 409]);
    const now = (await h.call(editor, 'GET', `${API}/articles/${a.body.id}`)).body;
    expect(now.status).toBe(p.status === 200 ? 'published' : 'draft');
    expect(await versionsOf(a.body.id)).toHaveLength(p.status === 200 ? 1 : 0);
  });
});
