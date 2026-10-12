/**
 * Searchable attachments (Phase 10, §16.3): files attached to a knowledge article are read (PDF text layer, Word,
 * Excel, plain text; scans through a document-extraction service) and found with the article, by exactly the people
 * who may read it, with the file and page; deleting the file or unpublishing the article takes them out of search.
 * Images and the pictures in slides are described by the image description model (§16.4) once one is chosen.
 */
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiUsage, fileTexts, roleAssignments, roles, users } from '@isbp/db/schema';
import { createMockServer } from '@isbp/integration-mocks';
import type { AuthContext } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf, solidPng } from '../../src/kernel/files/extract/sample';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { makeDocx, makeXlsx, para } from '../fixtures/office';
import { createHarness, type Harness, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
let mocks: FastifyInstance;
let mocksUrl: string;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
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
  ids[username] = u!.id;
  return u!.id;
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  h.call(s[who]!, method, path.startsWith('/api/') ? path : `${API}${path}`, body);

async function upload(articleId: string, name: string, type: string, content: Buffer) {
  const boundary = '----attachments-test';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/v1/records/knowledge.article/${articleId}/files`,
    payload,
    headers: {
      cookie: s.editor!.cookie,
      'x-csrf-token': s.editor!.csrf,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function article(title: string, audience: 'everyone' | 'agents') {
  const res = await call('editor', 'POST', '/articles', {
    title,
    summary: 'Procedure in the attached file.',
    body: 'See the attachment for the details.',
    audience,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function publish(id: string) {
  const submitted = await call('editor', 'POST', `/articles/${id}/submit`);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  if (submitted.body.status !== 'published')
    expect((await call('editor', 'POST', `/articles/${id}/publish`)).status).toBe(200);
}

async function authOf(username: string): Promise<AuthContext> {
  const id = ids[username] ?? h.ids[username as 'admin'];
  return buildAuthContext(
    { type: 'user', id, name: username },
    null,
    null,
    await h.kernel.rbac.permissionsFor(id),
  );
}

const search = async (who: string, q: string) =>
  h.kernel.registry
    .context('core')
    .ai.index.search(q, { types: ['knowledge.article'], auth: await authOf(who), limit: 5 });

async function eventually<T>(
  fn: () => Promise<T>,
  accept: (v: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const statusOf = async (fileId: string) =>
  (await h.kernel.db.select().from(fileTexts).where(eq(fileTexts.fileId, fileId)))[0]?.status ?? null;

beforeAll(async () => {
  h = await createHarness();
  await mkUser('kb-editor', 'knowledge-editor');
  await mkUser('kb-agent', 'knowledge-agent');
  await mkUser('reader');
  await h.kernel.rbac.bump();
  s.editor = await h.login('kb-editor');
  s.reader = await h.login('reader');
  s.admin = await h.login('admin');
  stopWorker = await startWorker(h.kernel);
  mocks = await createMockServer();
  await mocks.listen({ port: 0, host: '127.0.0.1' });
  mocksUrl = `http://127.0.0.1:${(mocks.server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await mocks?.close();
  await h?.close();
});

describe('attachments of published articles', () => {
  it('are read and found with the article, with the file and page', async () => {
    const id = await article('Gateway procedures', 'everyone');
    const pdf = await upload(
      id,
      'runbook.pdf',
      'application/pdf',
      makePdf([
        [
          'Overview',
          'This runbook covers the edge gateways of the Taipei office and their maintenance window.',
        ],
        ['Rotation', 'Rotate the zebrafish gateway token every ninety days and record it in the vault.'],
      ]),
    );
    await publish(id);
    ids.article = id;
    ids.pdf = pdf;

    const hits = await eventually(
      () => search('reader', 'zebrafish token rotation'),
      (x) => x[0]?.file?.id === pdf,
    );
    expect(hits[0]).toMatchObject({
      type: 'knowledge.article',
      id,
      title: 'Gateway procedures',
      file: { id: pdf, name: 'runbook.pdf', page: 2 },
    });
    expect(hits[0]!.snippet).toContain('zebrafish');
    expect(await statusOf(pdf)).toBe('done');
  });

  it('reads Word and Excel files attached after publishing', async () => {
    await upload(
      ids.article!,
      'escalation.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      makeDocx(
        para('Escalation', 'Heading1') + para('Call the quokka duty phone after two failed attempts.'),
      ),
    );
    await upload(
      ids.article!,
      'contacts.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      makeXlsx([
        {
          name: 'Vendors',
          rows: [
            ['Vendor', 'Hotline'],
            ['Pangolin Networks', '0800-123-456'],
          ],
        },
      ]),
    );
    const word = await eventually(
      () => search('reader', 'quokka duty phone'),
      (x) => x[0]?.file?.name === 'escalation.docx',
    );
    expect(word[0]).toMatchObject({ id: ids.article, file: { name: 'escalation.docx' } });
    // The knowledge base's own search says where the match was.
    const kb = await call('reader', 'GET', '/search?q=quokka%20duty%20phone');
    expect(kb.status).toBe(200);
    expect(kb.body.items[0]).toMatchObject({ id: ids.article, attachment: { name: 'escalation.docx' } });
    const sheet = await eventually(
      () => search('reader', 'Pangolin Networks hotline'),
      (x) => x[0]?.file?.name === 'contacts.xlsx',
    );
    expect(sheet[0]?.snippet).toContain('Pangolin');
  });

  it('are found only by people who may read the article', async () => {
    const internal = await article('Agent-only escalation notes', 'agents');
    await upload(
      internal,
      'notes.txt',
      'text/plain',
      Buffer.from('When the narwhal codeword is used, page the on-call network engineer at once.'),
    );
    await publish(internal);
    const agent = await eventually(
      () => search('kb-agent', 'narwhal codeword'),
      (x) => x[0]?.id === internal,
    );
    expect(agent[0]?.file?.name).toBe('notes.txt');
    expect((await search('reader', 'narwhal codeword')).map((x) => x.id)).not.toContain(internal);
  });

  it('leave search when the file is deleted', async () => {
    const res = await h.call(s.editor!, 'DELETE', `/api/v1/files/${ids.pdf}`);
    expect([200, 204]).toContain(res.status);
    const hits = await eventually(
      () => search('reader', 'zebrafish token rotation'),
      (x) => !x.some((hit) => hit.file?.id === ids.pdf),
    );
    expect(hits.some((hit) => hit.file?.id === ids.pdf)).toBe(false);
  });
});

describe('scans and the document-extraction service', () => {
  it('keeps a scan waiting for OCR, reads it once a service is configured, and reports it', async () => {
    const id = await article('Scanned vendor contract', 'everyone');
    // A PDF without a text layer, like a scan.
    const scan = await upload(id, 'contract-scan.pdf', 'application/pdf', makePdf([[''], ['']]));
    await publish(id);
    expect(
      await eventually(
        () => statusOf(scan),
        (v) => v === 'empty',
      ),
    ).toBe('empty');
    const before = await h.call(s.admin!, 'GET', '/api/v1/ai/index');
    expect(before.body.attachments.needsOcr).toBeGreaterThanOrEqual(1);

    // The Docling stand-in "recognises" every page; configuring it queues the scans.
    const put = await h.call(s.admin!, 'PUT', '/api/v1/ai/config', {
      documents: { provider: 'docling', baseUrl: `${mocksUrl}/docling`, apiKey: 'docling-key' },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.documents).toMatchObject({ provider: 'docling', hasApiKey: true, mode: 'fallback' });
    const test = await h.call(s.admin!, 'POST', '/api/v1/ai/test');
    expect(test.body.documents).toMatchObject({ ok: true });

    expect(
      await eventually(
        () => statusOf(scan),
        (v) => v === 'done',
        30_000,
      ),
    ).toBe('done');
    const hits = await search('reader', 'recognised by the Docling stand-in contract-scan');
    expect(hits[0]).toMatchObject({ id, file: { name: 'contract-scan.pdf' } });
    const [text] = await h.kernel.db.select().from(fileTexts).where(eq(fileTexts.fileId, scan));
    expect(text).toMatchObject({ producer: 'docling', status: 'done' });
    expect(text!.pages).toHaveLength(2);
  });

  it('reports a service that is down in the connection test', async () => {
    const down = createHttpServer((_req, res) => {
      res.writeHead(503);
      res.end('busy');
    });
    await new Promise<void>((r) => down.listen(0, '127.0.0.1', r));
    try {
      await h.call(s.admin!, 'PUT', '/api/v1/ai/config', {
        documents: { baseUrl: `http://127.0.0.1:${(down.address() as AddressInfo).port}` },
      });
      const test = await h.call(s.admin!, 'POST', '/api/v1/ai/test');
      expect(test.body.documents).toMatchObject({ ok: false, error: expect.stringContaining('status_503') });
    } finally {
      down.close();
      await h.call(s.admin!, 'PUT', '/api/v1/ai/config', { documents: { provider: 'none', baseUrl: '' } });
    }
  });
});

/** A two-slide deck whose second slide holds a picture with words in it (the stand-in model "reads" them). */
function deckWithPicture(words: string) {
  const P = 'xmlns:p="p" xmlns:a="a" xmlns:r="r"';
  const slide = (text: string) =>
    `<p:sld ${P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return Buffer.from(
    zipSync({
      'ppt/presentation.xml': strToU8(
        `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
      ),
      'ppt/_rels/presentation.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
      ),
      'ppt/slides/slide1.xml': strToU8(slide('Label printer training')),
      'ppt/slides/slide2.xml': strToU8(slide('Before you print')),
      'ppt/slides/_rels/slide2.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>',
      ),
      'ppt/media/image1.png': new Uint8Array(
        solidPng(32, 32, [30, 160, 60], { text: words, minBytes: 10_000 }),
      ),
    }),
  );
}

describe('images and the image description model', () => {
  afterAll(async () => {
    await h.call(s.admin!, 'PUT', '/api/v1/ai/config', {
      chat: { provider: 'none' },
      vision: { provider: 'none', baseUrl: '', model: '' },
      images: { chat: false },
    });
  });

  it('keeps a screenshot waiting, then describes it and the pictures in slides once a model is chosen', async () => {
    const id = await article('Label printer troubleshooting', 'everyone');
    const shot = await upload(
      id,
      'printer-error.png',
      'image/png',
      solidPng(32, 32, [255, 255, 255], { text: 'Zebra printer error 4021: ribbon out' }),
    );
    const deck = await upload(
      id,
      'printer-training.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      deckWithPicture('Calibrate the gecko sensor after loading labels'),
    );
    await publish(id);
    expect(
      await eventually(
        () => statusOf(shot),
        (v) => v === 'empty',
      ),
    ).toBe('empty');
    expect(
      await eventually(
        () => statusOf(deck),
        (v) => v === 'done',
      ),
    ).toBe('done');
    expect(await search('reader', 'gecko sensor')).not.toContainEqual(
      expect.objectContaining({ file: expect.objectContaining({ name: 'printer-training.pptx' }) }),
    );

    const put = await h.call(s.admin!, 'PUT', '/api/v1/ai/config', {
      vision: { provider: 'openai-compatible', baseUrl: `${mocksUrl}/llm/v1`, model: 'scripted' },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.vision).toMatchObject({
      provider: 'openai-compatible',
      model: 'scripted',
      apiStyle: 'chat-completions',
    });
    const status = await h.call(s.admin!, 'GET', '/api/v1/ai/status');
    expect(status.body.images).toEqual({ chat: false, describe: true });
    // The test sends a red square and asks for its colour.
    const test = await h.call(s.admin!, 'POST', '/api/v1/ai/test');
    expect(test.body.vision).toMatchObject({ ok: true });

    // The screenshot waited for a model; the deck was read without one and is read again for its picture.
    expect(
      await eventually(
        () => statusOf(shot),
        (v) => v === 'done',
        30_000,
      ),
    ).toBe('done');
    const shotHits = await search('reader', 'ribbon out error 4021');
    expect(shotHits[0]).toMatchObject({ id, file: { name: 'printer-error.png' } });
    const deckText = await eventually(
      async () => (await h.kernel.db.select().from(fileTexts).where(eq(fileTexts.fileId, deck)))[0],
      (t) => !!t?.producer?.includes('vision'),
      30_000,
    );
    expect(deckText).toMatchObject({ status: 'done', producer: 'builtin:pptx+vision' });
    expect(deckText!.pages[1]).toContain('Figure (image1.png): Calibrate the gecko sensor');
    const deckHits = await search('reader', 'gecko sensor');
    expect(deckHits[0]).toMatchObject({ id, file: { name: 'printer-training.pptx', page: 2 } });

    const usage = await h.kernel.db.select().from(aiUsage).where(eq(aiUsage.feature, 'core.files.describe'));
    expect(usage.filter((u) => u.kind === 'describe' && u.status === 'ok').length).toBeGreaterThanOrEqual(2);
    expect(usage[0]).toMatchObject({ moduleId: 'core', provider: 'openai-compatible', model: 'scripted' });
  });

  it('keeps images away from the chat model until an administrator allows them', async () => {
    await h.call(s.admin!, 'PUT', '/api/v1/ai/config', {
      chat: { provider: 'openai-compatible', baseUrl: `${mocksUrl}/llm/v1`, model: 'scripted' },
    });
    const ai = h.kernel.registry.context('core').ai;
    const ask = () =>
      ai.chat({
        feature: 'core.ai.test',
        messages: [
          {
            role: 'user',
            content: 'What colour is this?',
            images: [{ mediaType: 'image/png', data: solidPng(4, 4, [220, 30, 30]).toString('base64') }],
          },
        ],
      });
    await expect(ask()).rejects.toMatchObject({ statusCode: 409, code: 'AI_IMAGES_NOT_ALLOWED' });
    await h.call(s.admin!, 'PUT', '/api/v1/ai/config', { images: { chat: true } });
    expect((await ask()).text).toBe('red');
  });
});

describe('unpublishing', () => {
  it("takes the article's attachments out of search", async () => {
    expect((await search('reader', 'quokka duty phone'))[0]?.id).toBe(ids.article);
    const retired = await call('editor', 'POST', `/articles/${ids.article}/retire`);
    expect(retired.status, JSON.stringify(retired.body)).toBe(200);
    const hits = await eventually(
      () => search('reader', 'quokka duty phone'),
      (x) => !x.some((hit) => hit.id === ids.article),
    );
    expect(hits.map((x) => x.id)).not.toContain(ids.article);
  });
});
