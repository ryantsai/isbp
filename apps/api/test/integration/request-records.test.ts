/**
 * Requests as records (`core.request`): who sees a request through the record resolver (the requester, its approvers
 * and their delegates, form administrators, workflow readers) and who may change it (`editable`: attach files and
 * links — the requester and approvers until it is withdrawn, form administrators always), evidence through the core
 * files API, and links to and from a request. A tiny inline module (`rqtest.doc`, readable and editable by anyone)
 * is the other end of cross-module links.
 */
import { approvalTasks, auditLogs } from '@isbp/db/schema';
import { defineManifest, defineServerModule, type RecordSummary } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

const doc = (id: string): RecordSummary => ({
  id,
  reference: `DOC-${id}`,
  title: `Document ${id}`,
  href: `/rqtest/${id}`,
  editable: true,
});

const testModule = defineServerModule(
  defineManifest({
    id: 'rqtest',
    version: '0.1.0',
    name: 'rqtest.meta.name',
    permissions: [{ key: 'rqtest.docs.read', description: 'read' }],
    records: {
      types: [
        { type: 'doc', name: 'rqtest.entities.doc', icon: 'file-text', permission: 'rqtest.docs.read' },
      ],
    },
  }),
  {
    records: {
      doc: {
        async resolve(ids) {
          return ids.filter((id) => ['d1', 'd2'].includes(id)).map(doc);
        },
        async search() {
          return [doc('d1'), doc('d2')];
        },
      },
    },
  },
);

let h: Harness;
let admin: Session;
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const t = processActionHelpers(() => ({ h, admin }));
const MODULES = process.env.ISBP_TEST_MODULES;

/** Two requests of the requester (with an approval), one of a stranger (without). */
const req: Record<'a' | 'b' | 'theirs', LooseJson> = { a: null, b: null, theirs: null };

const record = (who: string, id: string) => h.call(s[who]!, 'GET', `/api/v1/records/core.request/${id}`);

function multipart(name: string, content: Buffer, type = 'text/plain') {
  const boundary = '----isbp-request-records';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(who: string, submissionId: string, name: string, text: string) {
  const body = multipart(name, Buffer.from(text));
  const session = s[who]!;
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/v1/records/core.request/${submissionId}/files`,
    payload: body.payload,
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf, 'content-type': body.contentType },
  });
  return { status: res.statusCode, body: res.json() as LooseJson };
}

const download = (who: string, href: string) =>
  h.app.inject({ method: 'GET', url: href, headers: { cookie: s[who]!.cookie } });

async function role(key: string, permissions: string[], usernames: string[]) {
  const created = await h.call(admin, 'POST', '/api/v1/roles', { key, name: key, permissions });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  for (const u of usernames) {
    const assigned = await h.call(admin, 'POST', '/api/v1/role-assignments', {
      roleId: created.body.id,
      principalType: 'user',
      principalId: ids[u],
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
  }
}

const pendingOf = (instanceId: string) =>
  h.kernel.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));

beforeAll(async () => {
  // Core and the inline module only.
  process.env.ISBP_TEST_MODULES = MODULES ?? '';
  try {
    h = await createHarness({ extraModules: [testModule] });
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  admin = await h.login('admin');
  for (const u of ['requester', 'approver', 'delegate', 'formadmin', 'reader', 'stranger'])
    ids[u] = await t.mkUser(u);
  await role('rq-forms-admin', ['core.forms.manage', 'core.forms.read'], ['formadmin']);
  await role('rq-workflow-reader', ['core.workflows.read'], ['reader']);
  // Pickers list requests for form readers; reading forms alone doesn't show other people's requests.
  await role('rq-forms-reader', ['core.forms.read', 'rqtest.docs.read'], ['requester', 'stranger']);
  for (const u of Object.keys(ids)) s[u] = await h.login(u);

  const workflow = await t.approvalWorkflow('Request records', ids.approver!);
  await t.mkForm('rq-equipment', { elements: [t.field('what', 'text')] }, { workflowDefinitionId: workflow });
  await t.mkForm('rq-plain', { elements: [t.field('what', 'text')] });
  req.a = await t.submit(s.requester!, 'rq-equipment', { what: 'A docking station' });
  req.b = await t.submit(s.requester!, 'rq-equipment', { what: 'A headset' });
  req.theirs = await t.submit(s.stranger!, 'rq-plain', { what: 'A chair' });
  // The approver hands request B to a colleague: both of them were asked.
  const [task] = await pendingOf(req.b.workflow.id);
  const delegated = await h.call(s.approver!, 'POST', `/api/v1/approvals/${task!.id}/delegate`, {
    userId: ids.delegate,
    comment: 'You know the headset models',
  });
  expect(delegated.status, JSON.stringify(delegated.body)).toBe(200);
});

afterAll(async () => {
  await h?.close();
});

describe('the core.request record', () => {
  it('is visible to the requester, approvers, delegates, form admins and workflow readers', async () => {
    const mine = await record('requester', req.a.id);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({
      type: 'core.request',
      moduleId: 'core',
      id: req.a.id,
      reference: req.a.reference,
      title: 'rq-equipment — requester',
      status: { key: 'workflows.status.request.pending', tone: 'warning' },
      href: `/requests/${req.a.reference}`,
      editable: true,
    });
    const editable = async (who: string, id: string) => {
      const res = await record(who, id);
      return res.status === 200 ? (res.body.editable as boolean) : res.status;
    };
    expect(await editable('approver', req.a.id)).toBe(true);
    // Delegated: the delegate (now the assignee) and the approver who handed it over.
    expect(await editable('delegate', req.b.id)).toBe(true);
    expect(await editable('approver', req.b.id)).toBe(true);
    expect(await editable('delegate', req.a.id)).toBe(404);
    expect(await editable('formadmin', req.a.id)).toBe(true);
    expect(await editable('formadmin', req.theirs.id)).toBe(true);
    // Workflow readers see every request, but don't change them.
    expect(await editable('reader', req.a.id)).toBe(false);
    expect(await editable('reader', req.theirs.id)).toBe(false);
    // Unrelated people (and the approver of another request) get 404, so ids can't be probed.
    expect(await editable('stranger', req.a.id)).toBe(404);
    expect(await editable('approver', req.theirs.id)).toBe(404);
    expect(await editable('requester', req.theirs.id)).toBe(404);
    expect(await editable('requester', '0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d10')).toBe(404);
  });

  it('resolves several requests as each person sees them', async () => {
    const refs = [req.a, req.b, req.theirs].map((r) => `core.request:${r.id}`).join(',');
    const asRequester = await h.call(s.requester!, 'GET', `/api/v1/records/resolve?refs=${refs}`);
    expect(asRequester.body.items.map((r: LooseJson) => r.id).sort()).toEqual([req.a.id, req.b.id].sort());
    expect(asRequester.body.hidden).toBe(1);
    const asStranger = await h.call(s.stranger!, 'GET', `/api/v1/records/resolve?refs=${refs}`);
    expect(asStranger.body.items.map((r: LooseJson) => r.id)).toEqual([req.theirs.id]);
    expect(asStranger.body.hidden).toBe(2);
  });

  it('finds only the requests a form reader may see', async () => {
    const search = (who: string, q: string) =>
      h.call(s[who]!, 'GET', `/api/v1/records/search?types=core.request&q=${encodeURIComponent(q)}`);
    const own = await search('requester', req.a.reference);
    expect(own.status).toBe(200);
    expect(own.body.items.map((r: LooseJson) => r.id)).toEqual([req.a.id]);
    expect((await search('stranger', req.a.reference)).body.items).toEqual([]);
    expect((await search('stranger', '')).body.items.map((r: LooseJson) => r.id)).toEqual([req.theirs.id]);
    // The type is offered only to people who read forms.
    expect((await search('approver', req.a.reference)).body.items).toEqual([]);
  });

  it('keeps a withdrawn request readable but closes it to the requester and approvers', async () => {
    const sub = await t.submit(s.requester!, 'rq-equipment', { what: 'A webcam' });
    expect(await upload('requester', sub.id, 'quote.txt', 'Quote: 49 USD')).toMatchObject({ status: 201 });
    const cancelled = await h.call(s.requester!, 'POST', `/api/v1/form-submissions/${sub.id}/cancel`, {
      reason: 'Found one',
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    const mine = await record('requester', sub.id);
    expect(mine.body).toMatchObject({
      editable: false,
      status: { key: 'workflows.status.request.cancelled', tone: 'neutral' },
    });
    expect((await record('approver', sub.id)).body.editable).toBe(false);
    expect((await record('formadmin', sub.id)).body.editable).toBe(true);
    // Evidence stays, but no more can be added.
    const files = await h.call(s.requester!, 'GET', `/api/v1/records/core.request/${sub.id}/files`);
    expect(files.body.files.map((f: LooseJson) => f.name)).toEqual(['quote.txt']);
    const refused = await upload('requester', sub.id, 'late.txt', 'Too late');
    expect(refused.status).toBe(403);
    expect((await upload('formadmin', sub.id, 'note.txt', 'Filed by the forms team')).status).toBe(201);
  });
});

describe('evidence on a request', () => {
  let fromRequester: LooseJson;

  it('lets the requester and an approver attach files, audited', async () => {
    const up = await upload('requester', req.a.id, 'serial-number.txt', 'SN: DK-2026-0042');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body).toMatchObject({ name: 'serial-number.txt', contentType: 'text/plain' });
    fromRequester = up.body;
    const approver = await upload('approver', req.a.id, 'evaluation.txt', 'Compatible with the laptop fleet');
    expect(approver.status, JSON.stringify(approver.body)).toBe(201);
    const delegate = await upload('delegate', req.b.id, 'models.txt', 'Model H-200 approved');
    expect(delegate.status).toBe(201);

    const list = await h.call(s.approver!, 'GET', `/api/v1/records/core.request/${req.a.id}/files`);
    expect(list.status).toBe(200);
    expect(list.body.record).toMatchObject({ id: req.a.id, editable: true });
    expect(list.body.files.map((f: LooseJson) => f.name).sort()).toEqual([
      'evaluation.txt',
      'serial-number.txt',
    ]);
    const audit = await h.kernel.db
      .select({ action: auditLogs.action, actorId: auditLogs.actorId })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, fromRequester.id));
    expect(audit).toEqual([{ action: 'core.file.uploaded', actorId: ids.requester }]);

    const dl = await download('requester', fromRequester.href);
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('SN: DK-2026-0042');
    expect((await download('reader', fromRequester.href)).statusCode).toBe(200);
  });

  it('refuses people who may not see or change the request', async () => {
    const stranger = await upload('stranger', req.a.id, 'spam.txt', 'Hello');
    expect(stranger.status).toBe(404);
    // Workflow readers see it, but can't add evidence.
    const reader = await upload('reader', req.a.id, 'note.txt', 'Read only');
    expect(reader.status).toBe(403);
    expect((await h.call(s.stranger!, 'GET', `/api/v1/records/core.request/${req.a.id}/files`)).status).toBe(
      404,
    );
    expect((await download('stranger', fromRequester.href)).statusCode).toBe(404);
    expect((await h.call(s.stranger!, 'DELETE', fromRequester.href)).status).toBe(404);
    expect((await h.call(s.reader!, 'DELETE', fromRequester.href)).status).toBe(403);
    expect(
      (await h.call(s.requester!, 'GET', `/api/v1/records/core.request/${req.a.id}/files`)).body.files,
    ).toHaveLength(2);
  });

  it('lets the requester remove their own attachment', async () => {
    const extra = await upload('requester', req.a.id, 'wrong.txt', 'Wrong file');
    expect((await h.call(s.requester!, 'DELETE', extra.body.href)).status).toBe(204);
    expect((await download('requester', extra.body.href)).statusCode).toBe(404);
  });
});

describe('links to and from a request', () => {
  it('links a request to another of the same person, both ways', async () => {
    const linked = await h.call(s.requester!, 'POST', `/api/v1/records/core.request/${req.a.id}/links`, {
      to: { type: 'core.request', id: req.b.id },
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    expect(linked.body.created).toBe(true);
    const fromB = await h.call(s.requester!, 'GET', `/api/v1/records/core.request/${req.b.id}/links`);
    expect(fromB.status).toBe(200);
    expect(fromB.body.record).toMatchObject({ id: req.b.id, editable: true });
    expect(fromB.body.links).toEqual([
      expect.objectContaining({
        ref: { type: 'core.request', id: req.a.id },
        record: expect.objectContaining({ reference: req.a.reference }),
        hidden: null,
        createdBy: expect.objectContaining({ id: ids.requester }),
      }),
    ]);
    // The delegate was asked about B only: A is listed, but hidden.
    const asDelegate = await h.call(s.delegate!, 'GET', `/api/v1/records/core.request/${req.b.id}/links`);
    expect(asDelegate.body.links[0]).toMatchObject({ record: null, hidden: 'forbidden' });
  });

  it('links a request to a record of another module, and that record back to it', async () => {
    const out = await h.call(s.requester!, 'POST', `/api/v1/records/core.request/${req.a.id}/links`, {
      to: { type: 'rqtest.doc', id: 'd1' },
    });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    // From the other record's side: the request is listed for people who may see it, hidden for others.
    const fromDoc = await h.call(s.requester!, 'GET', '/api/v1/records/rqtest.doc/d1/links');
    expect(fromDoc.body.links).toEqual([
      expect.objectContaining({
        ref: { type: 'core.request', id: req.a.id },
        record: expect.objectContaining({ type: 'core.request', href: `/requests/${req.a.reference}` }),
      }),
    ]);
    const hidden = await h.call(s.stranger!, 'GET', '/api/v1/records/rqtest.doc/d1/links');
    expect(hidden.body.links).toEqual([expect.objectContaining({ record: null, hidden: 'forbidden' })]);

    // Linking from the other record needs sight of the request.
    const back = await h.call(s.approver!, 'POST', '/api/v1/records/rqtest.doc/d2/links', {
      to: { type: 'core.request', id: req.a.id },
    });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    const unseen = await h.call(s.stranger!, 'POST', '/api/v1/records/rqtest.doc/d2/links', {
      to: { type: 'core.request', id: req.a.id },
    });
    expect(unseen.status).toBe(404);
    const onA = await h.call(s.requester!, 'GET', `/api/v1/records/core.request/${req.a.id}/links`);
    expect(onA.body.links.map((l: LooseJson) => `${l.ref.type}:${l.ref.id}`).sort()).toEqual(
      [`core.request:${req.b.id}`, 'rqtest.doc:d1', 'rqtest.doc:d2'].sort(),
    );
    const [audit] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.record.linked'), eq(auditLogs.entityId, back.body.id)));
    expect(audit).toBeDefined();
  });

  it('refuses links by people who may not change the request, or to requests they can’t see', async () => {
    const stranger = await h.call(s.stranger!, 'POST', `/api/v1/records/core.request/${req.a.id}/links`, {
      to: { type: 'rqtest.doc', id: 'd2' },
    });
    expect(stranger.status).toBe(404);
    const reader = await h.call(s.reader!, 'POST', `/api/v1/records/core.request/${req.a.id}/links`, {
      to: { type: 'rqtest.doc', id: 'd2' },
    });
    expect(reader.status).toBe(403);
    const toTheirs = await h.call(s.requester!, 'POST', `/api/v1/records/core.request/${req.a.id}/links`, {
      to: { type: 'core.request', id: req.theirs.id },
    });
    expect(toTheirs.status).toBe(404);
  });

  it('lets the requester remove a link, and not a stranger', async () => {
    const links = await h.call(s.requester!, 'GET', `/api/v1/records/core.request/${req.a.id}/links`);
    const toDoc = links.body.links.find((l: LooseJson) => l.ref.id === 'd1');
    expect(
      (await h.call(s.stranger!, 'DELETE', `/api/v1/records/core.request/${req.a.id}/links/${toDoc.id}`))
        .status,
    ).toBe(404);
    expect(
      (await h.call(s.requester!, 'DELETE', `/api/v1/records/core.request/${req.a.id}/links/${toDoc.id}`))
        .status,
    ).toBe(204);
    const after = await h.call(s.requester!, 'GET', '/api/v1/records/rqtest.doc/d1/links');
    expect(after.body.links).toEqual([]);
  });
});
