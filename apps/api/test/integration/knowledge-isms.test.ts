/**
 * Knowledge for ISMS-style processes (Phase 8, §15.8a): a classification label on articles (configurable in the
 * module settings, filterable, in lists, search results and record facts) and attachments on articles through the
 * core files panel — editors change them, readers download them as far as they may read the article.
 */
import { roleAssignments, roles, users } from '@isbp/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
const s: Record<string, Session> = {};
const API = '/api/v1/knowledge';

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
    const [r] = await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey));
    await h.kernel.db.insert(roleAssignments).values({ roleId: r!.id, userId: u!.id });
  }
  return u!.id;
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  h.call(s[who]!, method, path.startsWith('/api/') ? path : `${API}${path}`, body);

async function upload(who: string, articleId: string, name: string, content: string) {
  const boundary = '----kb-test';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return h.app.inject({
    method: 'POST',
    url: `/api/v1/records/knowledge.article/${articleId}/files`,
    payload,
    headers: {
      cookie: s[who]!.cookie,
      'x-csrf-token': s[who]!.csrf,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  });
}

async function publish(id: string) {
  const submitted = await call('editor', 'POST', `/articles/${id}/submit`);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  if (submitted.body.status !== 'published')
    expect((await call('editor', 'POST', `/articles/${id}/publish`)).status).toBe(200);
}

beforeAll(async () => {
  h = await createHarness();
  await mkUser('kb-editor', 'knowledge-editor');
  await mkUser('kb-agent', 'knowledge-agent');
  await mkUser('reader');
  await h.kernel.rbac.bump();
  s.editor = await h.login('kb-editor');
  s.agent = await h.login('kb-agent');
  s.reader = await h.login('reader');
  s.outsider = await h.login('outsider');
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('classification', () => {
  let diagram: LooseJson;

  it('offers the four default labels and refuses others', async () => {
    const levels = await call('reader', 'GET', '/classifications');
    expect(levels.status).toBe(200);
    expect(levels.body.items).toEqual([
      { key: 'strictly-confidential', builtIn: true, rank: 0 },
      { key: 'customer-confidential', builtIn: true, rank: 1 },
      { key: 'confidential', builtIn: true, rank: 2 },
      { key: 'internal-use-only', builtIn: true, rank: 3 },
    ]);
    const bad = await call('editor', 'POST', '/articles', {
      title: 'Network diagram (head office)',
      body: 'See the attached diagram.',
      classification: 'top-secret',
    });
    expect(bad.status).toBe(400);
    diagram = (
      await call('editor', 'POST', '/articles', {
        title: 'Network diagram (head office)',
        body: 'See the attached diagram.',
        audience: 'agents',
        classification: 'confidential',
      })
    ).body;
    expect(diagram).toMatchObject({ classification: 'confidential', attachments: 0 });
  });

  it('is shown in lists and search results, filterable and part of the record facts', async () => {
    const plain = await call('editor', 'POST', '/articles', {
      title: 'Printer toner replacement',
      body: 'Open the front cover.',
    });
    await publish(diagram.id);
    await publish(plain.body.id);
    const confidential = await call('editor', 'GET', '/articles?classification=confidential');
    expect(confidential.body.items.map((a: LooseJson) => a.id)).toEqual([diagram.id]);
    expect(confidential.body.items[0].classification).toBe('confidential');
    const none = await call('editor', 'GET', '/articles?classification=none');
    expect(none.body.items.map((a: LooseJson) => a.id)).toEqual([plain.body.id]);
    const found = await call('agent', 'GET', '/search?q=network%20diagram');
    expect(found.body.items[0]).toMatchObject({ id: diagram.id, classification: 'confidential' });

    const facts = await h.kernel.records.facts([{ type: 'knowledge.article', id: diagram.id }]);
    expect(facts.get(`knowledge.article:${diagram.id}`) ?? facts.get(diagram.id)).toMatchObject({
      classification: 'confidential',
      audience: 'agents',
    });

    // Editing it changes the label (audited like any field) or clears it.
    const changed = await call('editor', 'PATCH', `/articles/${diagram.id}`, {
      classification: 'strictly-confidential',
    });
    expect(changed.body.classification).toBe('strictly-confidential');
    const cleared = await call('editor', 'PATCH', `/articles/${plain.body.id}`, { classification: null });
    expect(cleared.body.classification).toBeNull();
  });

  it('follows the labels configured in the module settings, custom ones included', async () => {
    const knowledge = h.kernel.registry.get('knowledge')!;
    await h.kernel.settings.update(
      knowledge.manifest,
      { 'classification.levels': 'Top Secret\nconfidential\n\ninternal-use-only\nconfidential' },
      null,
    );
    const levels = await call('reader', 'GET', '/classifications');
    expect(levels.body.items).toEqual([
      { key: 'Top Secret', builtIn: false, rank: 0 },
      { key: 'confidential', builtIn: true, rank: 1 },
      { key: 'internal-use-only', builtIn: true, rank: 2 },
    ]);
    const custom = await call('editor', 'POST', '/articles', {
      title: 'Rack layout (server room)',
      body: 'Rack A holds the core switches.',
      classification: 'Top Secret',
    });
    expect(custom.status, JSON.stringify(custom.body)).toBe(201);
    expect(
      (
        await call('editor', 'POST', '/articles', {
          title: 'Customer data',
          classification: 'customer-confidential',
        })
      ).status,
    ).toBe(400);
    await h.kernel.settings.update(knowledge.manifest, { 'classification.levels': null }, null);
  });
});

describe('attachments on articles', () => {
  it('editors attach files; readers download them as far as they may read the article', async () => {
    const self = (
      await call('editor', 'POST', '/articles', {
        title: 'Rack layout and cabling',
        body: 'The layout is attached.',
        classification: 'internal-use-only',
      })
    ).body;
    const internal = (
      await call('editor', 'POST', '/articles', {
        title: 'Firewall cluster diagram',
        body: 'Attached.',
        audience: 'agents',
        classification: 'confidential',
      })
    ).body;
    const draftUpload = await upload('editor', self.id, 'rack-layout.txt', 'Rack A: core switches');
    expect(draftUpload.statusCode, draftUpload.body).toBe(201);
    expect((await upload('editor', internal.id, 'firewall.txt', 'FW-01 / FW-02')).statusCode).toBe(201);

    // A draft is invisible to readers, and so are its files.
    const fileId = JSON.parse(draftUpload.body).id as string;
    expect((await call('reader', 'GET', `/api/v1/files/${fileId}`)).status).toBe(404);
    await publish(self.id);
    await publish(internal.id);

    const article = await call('reader', 'GET', `/articles/${self.id}`);
    expect(article.body).toMatchObject({
      attachments: 1,
      canEdit: false,
      classification: 'internal-use-only',
    });
    const files = await call('reader', 'GET', `/api/v1/records/knowledge.article/${self.id}/files`);
    expect(files.status).toBe(200);
    expect(files.body.record.editable).toBe(false);
    expect(files.body.files.map((f: LooseJson) => f.name)).toEqual(['rack-layout.txt']);
    const download = await h.app.inject({
      method: 'GET',
      url: `/api/v1/files/${fileId}`,
      headers: { cookie: s.reader!.cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment/);
    expect(download.body).toBe('Rack A: core switches');
    // Readers can't add or remove files.
    expect((await upload('reader', self.id, 'mine.txt', 'x')).statusCode).toBe(403);
    expect((await call('reader', 'DELETE', `/api/v1/files/${fileId}`)).status).toBe(403);

    // Internal articles' files: knowledge agents may read them, readers may not; only editors change them.
    expect(
      (await call('reader', 'GET', `/api/v1/records/knowledge.article/${internal.id}/files`)).status,
    ).toBe(404);
    const agentFiles = await call('agent', 'GET', `/api/v1/records/knowledge.article/${internal.id}/files`);
    expect(agentFiles.status).toBe(200);
    expect(agentFiles.body.record.editable).toBe(false);
    expect((await upload('agent', internal.id, 'agent.txt', 'x')).statusCode).toBe(403);
    const editorFiles = await call('editor', 'GET', `/api/v1/records/knowledge.article/${internal.id}/files`);
    expect(editorFiles.body.record.editable).toBe(true);
    // Everyone reads published self-service articles (granted by default), so everyone downloads their files.
    expect((await call('outsider', 'GET', `/api/v1/records/knowledge.article/${self.id}/files`)).status).toBe(
      200,
    );
    expect(
      (await call('outsider', 'GET', `/api/v1/records/knowledge.article/${internal.id}/files`)).status,
    ).toBe(404);
  });
});
