import { auditLogs, roleAssignments, roles } from '@isbp/db/schema';
import { type AuthContext, defineManifest, defineServerModule, type RecordSummary } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from './harness';

/**
 * The record registry (`ctx.records`) and attachments (`ctx.files`) through a small test module with one
 * record type: `rtest.doc`. "secret" is readable by the admin only.
 */
const DOCS: Record<string, { title: string; adminOnly?: boolean }> = {
  d1: { title: 'Alpha plan' },
  d2: { title: 'Beta notes' },
  secret: { title: 'Secret design', adminOnly: true },
};

const visible = (auth: AuthContext) => (id: string) =>
  Boolean(DOCS[id]) && (!DOCS[id]!.adminOnly || auth.user?.username === 'admin');

const summary = (auth: AuthContext, id: string): RecordSummary => ({
  id,
  reference: `DOC-${id}`,
  title: DOCS[id]!.title,
  status: { key: 'rtest.status.open', tone: 'info' },
  href: `/rtest/${id}`,
  editable: auth.permissions.hasAny('rtest.docs.edit'),
});

const manifest = defineManifest({
  id: 'rtest',
  version: '0.1.0',
  name: 'rtest.meta.name',
  permissions: [
    { key: 'rtest.docs.read', description: 'read' },
    { key: 'rtest.docs.edit', description: 'edit' },
  ],
  roles: [
    { key: 'rtest-viewer', name: 'Viewer', permissions: ['rtest.docs.read'] },
    { key: 'rtest-editor', name: 'Editor', permissions: ['rtest.docs.read', 'rtest.docs.edit'] },
  ],
  records: {
    types: [{ type: 'doc', name: 'rtest.entities.doc', icon: 'file-text', permission: 'rtest.docs.read' }],
  },
});

const testModule = defineServerModule(manifest, {
  records: {
    doc: {
      async resolve(ids, _ctx, auth) {
        if (!auth.permissions.hasAny('rtest.docs.read')) return [];
        return ids.filter(visible(auth)).map((id) => summary(auth, id));
      },
      async search(query, _ctx, auth, limit) {
        if (!auth.permissions.hasAny('rtest.docs.read')) return [];
        const q = query.toLowerCase();
        return Object.keys(DOCS)
          .filter(visible(auth))
          .filter((id) => !q || DOCS[id]!.title.toLowerCase().includes(q) || `doc-${id}` === q)
          .slice(0, limit)
          .map((id) => summary(auth, id));
      },
    },
  },
});

let h: Harness;
let admin: Session;
let editor: Session;
let viewer: Session;

function multipart(name: string, content: Buffer, type = 'application/octet-stream') {
  const boundary = '----isbp-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(session: Session, ref: string, name: string, content: Buffer, type?: string) {
  const body = multipart(name, content, type);
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/v1/records/${ref}/files`,
    payload: body.payload,
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf, 'content-type': body.contentType },
  });
  return {
    status: res.statusCode,
    body: res.json() as Record<string, unknown> & { error?: { code: string } },
  };
}

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES ??= '';
  h = await createHarness({ extraModules: [testModule] });
  const roleId = async (key: string) =>
    (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('rtest-editor'), userId: h.ids.hr },
    { roleId: await roleId('rtest-viewer'), userId: h.ids.outsider },
  ]);
  await h.kernel.rbac.bump();
  admin = await h.login('admin');
  editor = await h.login('hr');
  viewer = await h.login('outsider');
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('record links', () => {
  it('lists linkable types by permission and finds records', async () => {
    const types = await h.call(viewer, 'GET', '/api/v1/records/types');
    expect(types.body.items).toContainEqual({
      type: 'rtest.doc',
      moduleId: 'rtest',
      name: 'rtest.entities.doc',
      icon: 'file-text',
    });
    const found = await h.call(viewer, 'GET', '/api/v1/records/search?q=beta&types=rtest.doc');
    expect(found.body.items.map((r: { id: string }) => r.id)).toEqual(['d2']);
    const exact = await h.call(admin, 'GET', '/api/v1/records/search?q=doc-secret');
    expect(exact.body.items[0]).toMatchObject({ id: 'secret', reference: 'DOC-secret', editable: true });
  });

  it('links two records once, symmetrically, and audits it', async () => {
    const first = await h.call(editor, 'POST', '/api/v1/records/rtest.doc/d2/links', {
      to: { type: 'rtest.doc', id: 'd1' },
    });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    const again = await h.call(editor, 'POST', '/api/v1/records/rtest.doc/d1/links', {
      to: { type: 'rtest.doc', id: 'd2' },
    });
    expect(again.body).toEqual({ id: first.body.id, created: false });

    const fromD1 = await h.call(viewer, 'GET', '/api/v1/records/rtest.doc/d1/links');
    expect(fromD1.status).toBe(200);
    expect(fromD1.body.record).toMatchObject({ id: 'd1', editable: false });
    expect(fromD1.body.links).toHaveLength(1);
    expect(fromD1.body.links[0]).toMatchObject({
      ref: { type: 'rtest.doc', id: 'd2' },
      record: {
        title: 'Beta notes',
        reference: 'DOC-d2',
        status: { key: 'rtest.status.open', tone: 'info' },
      },
      hidden: null,
      createdBy: { id: h.ids.hr },
    });
    const audit = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.record.linked'), eq(auditLogs.entityId, first.body.id)));
    expect(audit).toHaveLength(1);
  });

  it('needs edit rights on the source and sight of the target', async () => {
    const denied = await h.call(viewer, 'POST', '/api/v1/records/rtest.doc/d1/links', {
      to: { type: 'rtest.doc', id: 'd2' },
    });
    expect(denied.status).toBe(403);
    const unseen = await h.call(editor, 'POST', '/api/v1/records/rtest.doc/d1/links', {
      to: { type: 'rtest.doc', id: 'secret' },
    });
    expect(unseen.status).toBe(404);
    const self = await h.call(editor, 'POST', '/api/v1/records/rtest.doc/d1/links', {
      to: { type: 'rtest.doc', id: 'd1' },
    });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('RELATIONSHIP_INVALID');
    const unknown = await h.call(editor, 'GET', '/api/v1/records/nope.thing/x/links');
    expect(unknown.status).toBe(404);
  });

  it("shows links to records the viewer can't see as hidden", async () => {
    const linked = await h.call(admin, 'POST', '/api/v1/records/rtest.doc/d1/links', {
      to: { type: 'rtest.doc', id: 'secret' },
    });
    expect(linked.status).toBe(201);
    const asViewer = await h.call(viewer, 'GET', '/api/v1/records/rtest.doc/d1/links');
    const hidden = asViewer.body.links.find((l: { ref: { id: string } }) => l.ref.id === 'secret');
    expect(hidden).toMatchObject({ record: null, hidden: 'forbidden' });
    expect(await h.kernel.records.linked({ type: 'rtest.doc', id: 'd1' })).toHaveLength(2);
  });

  it('removes a link by id only through a record it touches', async () => {
    const links = await h.call(editor, 'GET', '/api/v1/records/rtest.doc/d2/links');
    const linkId = links.body.links[0].id as string;
    const wrongRecord = await h.call(admin, 'DELETE', `/api/v1/records/rtest.doc/secret/links/${linkId}`);
    expect(wrongRecord.status).toBe(404);
    const ok = await h.call(editor, 'DELETE', `/api/v1/records/rtest.doc/d2/links/${linkId}`);
    expect(ok.status).toBe(204);
    expect((await h.call(editor, 'GET', '/api/v1/records/rtest.doc/d2/links')).body.links).toEqual([]);
  });

  it('treats links to a disabled module as unavailable', async () => {
    await h.kernel.records
      .link({ type: 'rtest.doc', id: 'd2' }, { type: 'gone.thing', id: 'x1' })
      .catch((err: { code?: string }) => expect(err.code).toBe('RELATIONSHIP_INVALID'));
  });
});

describe('attachments', () => {
  it('uploads, lists and downloads a file with safe headers', async () => {
    const text = Buffer.from('VPN config notes\nline two\n');
    const up = await upload(editor, 'rtest.doc/d1', 'notes 筆記.txt', text, 'text/html');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'notes 筆記.txt', contentType: 'text/plain', size: text.length });

    const list = await h.call(viewer, 'GET', '/api/v1/records/rtest.doc/d1/files');
    expect(list.body.files).toHaveLength(1);
    expect(list.body.limits.maxBytes).toBe(25 * 1024 * 1024);

    const dl = await h.app.inject({
      method: 'GET',
      url: up.body.href as string,
      headers: { cookie: viewer.cookie },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe(text.toString());
    expect(dl.headers['content-type']).toBe('text/plain');
    expect(dl.headers['content-disposition']).toMatch(
      /^attachment; filename="notes __.txt"; filename\*=UTF-8''/,
    );
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-security-policy']).toContain('sandbox');
  });

  it('previews images inline only when asked', async () => {
    // 1×1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await upload(editor, 'rtest.doc/d1', 'pixel.png', png);
    expect(up.body).toMatchObject({ contentType: 'image/png', previewable: true });
    const inline = await h.app.inject({
      method: 'GET',
      url: `${up.body.href as string}?inline=1`,
      headers: { cookie: viewer.cookie },
    });
    expect(inline.headers['content-disposition']).toMatch(/^inline;/);
  });

  it('refuses blocked and disguised executables, empty files and oversized files', async () => {
    const exe = await upload(editor, 'rtest.doc/d1', 'setup.exe', Buffer.from('MZ fake'));
    expect(exe.status).toBe(422);
    expect(exe.body.error?.code).toBe('FILE_REJECTED');

    const trailing = await upload(editor, 'rtest.doc/d1', 'invoice.pdf.exe. ', Buffer.from('x'));
    expect(trailing.status).toBe(422);

    const svg = await upload(editor, 'rtest.doc/d1', 'logo.svg', Buffer.from('<svg/>'));
    expect(svg.status).toBe(422);

    // An ELF binary renamed to .txt is caught by content sniffing.
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(120)]);
    const disguised = await upload(editor, 'rtest.doc/d1', 'readme.txt', elf);
    expect(disguised.status).toBe(422);

    const empty = await upload(editor, 'rtest.doc/d1', 'empty.txt', Buffer.alloc(0));
    expect(empty.status).toBe(422);

    const core = h.kernel.registry.get('core')!.manifest;
    await h.kernel.settings.update(core, { 'files.maxSizeMb': 1 }, null);
    const big = await upload(editor, 'rtest.doc/d1', 'big.bin', Buffer.alloc(1024 * 1024 + 10, 1));
    expect(big.status).toBe(413);
    expect(big.body.error?.code).toBe('FILE_TOO_LARGE');
    await h.kernel.settings.update(core, { 'files.maxSizeMb': 25 }, null);
  });

  it('needs edit rights to upload or delete, and sight of the record to download', async () => {
    const denied = await upload(viewer, 'rtest.doc/d1', 'x.txt', Buffer.from('x'));
    expect(denied.status).toBe(403);
    const up = await upload(admin, 'rtest.doc/secret', 'plan.txt', Buffer.from('secret plan'));
    expect(up.status).toBe(201);
    const peek = await h.app.inject({
      method: 'GET',
      url: up.body.href as string,
      headers: { cookie: editor.cookie },
    });
    expect(peek.statusCode).toBe(404);
    const del = await h.call(viewer, 'DELETE', up.body.href as string);
    expect(del.status).toBe(404);
    const ok = await h.call(admin, 'DELETE', up.body.href as string);
    expect(ok.status).toBe(204);
    const gone = await h.app.inject({
      method: 'GET',
      url: up.body.href as string,
      headers: { cookie: admin.cookie },
    });
    expect(gone.statusCode).toBe(404);
  });

  it('forgets the links and files of a deleted record, and purges bytes later', async () => {
    const ref = { type: 'rtest.doc', id: 'd2' };
    await h.kernel.records.link(ref, { type: 'rtest.doc', id: 'd1' });
    await upload(editor, 'rtest.doc/d2', 'a.txt', Buffer.from('a'));
    await h.kernel.records.forget(ref);
    expect(await h.kernel.records.linked(ref)).toEqual([]);
    expect(await h.kernel.files.list(ref)).toEqual([]);
    expect(await h.kernel.files.purge(0)).toBeGreaterThan(0);
  });
});
