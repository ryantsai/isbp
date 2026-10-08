import type { AddressInfo } from 'node:net';
import { groupMembers, groups } from '@isbp/db/schema';
import { createMockServer } from '@isbp/integration-mocks';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';

/*
 * Phase 8 in the assistant: a change set with a form gives the form's own link (`/requests/forms/<key>`, "Open the
 * form") on the change set, in the agent's apply result and in its reply — after the person confirms, or after a
 * review applies it — and the builtin-mode template "Approval process" proposes a workflow and the form using it as
 * one change set. The chat model is the scripted stand-in of `tooling/integration-mocks` (`/llm/v1`).
 */

let h: Harness;
let admin: Session;
let author: Session;
let stopWorker: () => Promise<void>;
let mocks: FastifyInstance;
const A = '/api/v1/assistant';
const OPEN_FORM = { en: 'Open the form', 'zh-TW': '開啟表單', 'ja-JP': 'フォームを開く' };

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

function sse(body: string) {
  return body
    .split('\n\n')
    .filter((b) => b.includes('data: '))
    .map((b) => ({
      event: /event: (.+)/.exec(b)?.[1] ?? 'message',
      data: JSON.parse(/data: (.+)/.exec(b)![1]!) as LooseJson,
    }));
}

const t3 = (en: string) => ({ en, 'zh-TW': en, 'ja-JP': en });

/** A workflow and a form using it, as the scripted model proposes them from a ```json block. */
const proposals = (key: string) => [
  {
    kind: 'core.workflow',
    op: 'create',
    ref: 'approval',
    value: {
      name: `${key} approval`,
      description: null,
      triggerKey: 'core.form-submission',
      isDefault: false,
      graph: {
        steps: [
          {
            id: 'manager',
            type: 'approval',
            name: t3('Manager'),
            approvers: [{ type: 'manager' }],
            mode: 'any',
          },
        ],
      },
    },
  },
  {
    kind: 'core.form',
    op: 'create',
    ref: 'form',
    value: {
      key,
      name: t3(`Request ${key}`),
      description: null,
      icon: 'file-text',
      category: null,
      schema: { elements: [{ id: 'why', key: 'why', type: 'text', label: t3('Why'), required: true }] },
      workflowId: '$ref:approval',
      audience: { type: 'everyone' },
      active: true,
    },
  },
];

async function ask(session: Session, conversationId: string, content: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: `${A}/conversations/${conversationId}/messages`,
    payload: { content },
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
  });
  return sse(res.body);
}

async function grant(userId: string, key: string, permissions: string[]) {
  const role = await h.call(admin, 'POST', '/api/v1/roles', { key, name: key, permissions });
  expect(role.status).toBe(201);
  const assigned = await h.call(admin, 'POST', '/api/v1/role-assignments', {
    roleId: role.body.id,
    principalType: 'user',
    principalId: userId,
    scopeType: 'global',
  });
  expect(assigned.status).toBe(201);
}

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
  const [cab] = await h.kernel.db.insert(groups).values({ key: 'cab', name: 'CAB' }).returning();
  await h.kernel.db.insert(groupMembers).values({ groupId: cab!.id, userId: h.ids.outsider });
  // Proposes processes; applying them needs a reviewer.
  await grant(h.ids.hr, 'process-author', [
    'assistant.agent.use',
    'core.forms.read',
    'core.workflows.read',
    'cmdb.cis.read',
  ]);
  author = await h.login('hr');
  stopWorker = await startWorker(h.kernel);
  mocks = await createMockServer();
  await mocks.listen({ port: 0, host: '127.0.0.1' });
  await h.kernel.settings.update(
    h.kernel.registry.get('core')!.manifest,
    {
      'ai.chat.provider': 'openai-compatible',
      'ai.chat.baseUrl': `http://127.0.0.1:${(mocks.server.address() as AddressInfo).port}/llm/v1`,
      'ai.chat.model': 'scripted',
    },
    null,
  );
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await mocks?.close();
  await h?.close();
});

describe('the approval-process template (builtin mode)', () => {
  let setId: string;
  const answers = (name: string, groupFactKey: string) => ({
    name,
    recordType: 'cmdb.ci',
    recordLabel: 'Servers',
    recordMultiple: true,
    q1Label: 'Summary',
    q1Type: 'text',
    q1Required: true,
    q2Label: 'Start',
    q2Type: 'date',
    q3Label: 'End',
    q3Type: 'date',
    managerApproves: true,
    recordGroupApproves: true,
    [groupFactKey]: 'ownerGroup',
    groupApproves: true,
    group: 'cab',
    createChange: true,
  });

  it('proposes the workflow and the form that uses it in one change set, renaming refs already taken', async () => {
    const status = await h.call(admin, 'GET', `${A}/status`);
    const formKind = status.body.kinds.find((k: LooseJson) => k.kind === 'core.form');
    expect(formKind.templates.map((t: LooseJson) => t.id)).toEqual(['request-form', 'approval-process']);
    const { body } = await h.call(admin, 'GET', `${A}/templates/core.form/approval-process`);
    const factKey = (body.fields as LooseJson[]).find(
      (f) => f.key.startsWith('recordGroupFact') && JSON.stringify(f.visibleWhen).includes('cmdb.ci'),
    ).key;

    const built = await h.call(admin, 'POST', `${A}/templates/build`, {
      kind: 'core.form',
      templateId: 'approval-process',
      answers: answers('Server change request', factKey),
    });
    expect(built.status).toBe(200);
    setId = built.body.id;
    expect(built.body.title).toBe('Server change request');
    expect(built.body.items.map((i: LooseJson) => [i.kind, i.ref, i.check?.ok])).toEqual([
      ['core.workflow', 'approval', true],
      ['core.form', 'form', true],
    ]);
    expect(built.body.items[1].value.workflowId).toBe('$ref:approval');

    // A second process in the same change set: its names are made unique, its reference follows.
    const again = await h.call(admin, 'POST', `${A}/templates/build`, {
      kind: 'core.form',
      templateId: 'approval-process',
      answers: answers('Network change request', factKey),
      changeSetId: setId,
    });
    expect(again.status).toBe(200);
    expect(again.body.title).toBe('Server change request');
    expect(again.body.items.map((i: LooseJson) => [i.ref, i.check?.ok])).toEqual([
      ['approval', true],
      ['form', true],
      ['approval-2', true],
      ['form-2', true],
    ]);
    expect(again.body.items[3].value.workflowId).toBe('$ref:approval-2');

    // Nothing is proposed when the answers can't make a process.
    const before = (await h.call(admin, 'GET', `${A}/change-sets/${setId}`)).body.items.length;
    const none = await h.call(admin, 'POST', `${A}/templates/build`, {
      kind: 'core.form',
      templateId: 'approval-process',
      answers: { name: 'Nobody approves', q1Label: 'Why', q1Type: 'text', managerApproves: false },
      changeSetId: setId,
    });
    expect(none.status).toBe(422);
    expect((await h.call(admin, 'GET', `${A}/change-sets/${setId}`)).body.items).toHaveLength(before);
  });

  it('once applied, gives each form’s own link on the change set and in the tools’ result', async () => {
    const applied = await h.call(admin, 'POST', `${A}/change-sets/${setId}/apply`, {});
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('applied');
    expect(applied.body.items.map((i: LooseJson) => i.after.links ?? [])).toEqual([
      [],
      [{ href: '/requests/forms/server-change-request', label: OPEN_FORM }],
      [],
      [{ href: '/requests/forms/network-change-request', label: OPEN_FORM }],
    ]);
    // The form is live for requesters, with its approval and its action.
    const form = await h.call(admin, 'GET', '/api/v1/forms/by-key/server-change-request');
    expect(form.status).toBe(200);
    expect(form.body.hasApproval).toBe(true);

    const auth = (await h.kernel.registry.context('assistant').rbac.authFor(h.ids.admin))!;
    const result = await h.kernel.registry
      .context('assistant')
      .ai.tools.invoke<LooseJson>('assistant.get_change_set', { changeSetId: setId }, { auth });
    expect(result.links).toEqual([
      {
        object: 'Server change request',
        label: 'Open the form',
        href: '/requests/forms/server-change-request',
      },
      {
        object: 'Network change request',
        label: 'Open the form',
        href: '/requests/forms/network-change-request',
      },
    ]);
    expect(result.note).toContain('links');
  });
});

describe('the built-in agent with a chat model', () => {
  it('answers an applied change set with the form’s own link, and gives the model the links', async () => {
    const { id } = (await h.call(admin, 'POST', `${A}/conversations`)).body;
    const events = await ask(
      admin,
      id,
      `Create the agent process and apply it:\n\`\`\`json\n${JSON.stringify(proposals('agent-form'))}\n\`\`\``,
    );
    const confirm = events.find((e) => e.event === 'confirm')!.data;
    expect(confirm).toMatchObject({ name: 'assistant.apply_change_set', status: 'pending' });
    expect(confirm.label).toMatch(/^Apply CS-\d{5} \(2 changes\)$/);

    const confirmed = await h.call(
      admin,
      'POST',
      `${A}/conversations/${id}/confirmations/${confirm.toolCallId}`,
      {
        approve: true,
      },
    );
    expect(confirmed.status).toBe(200);
    const reply = (confirmed.body.messages as LooseJson[]).at(-1);
    expect(reply.role).toBe('assistant');
    expect(reply.content).toBe(
      `Done: ${confirm.label}.\n\nReady to use:\n\n- Request agent-form: [Open the form](/requests/forms/agent-form)`,
    );
    expect(confirmed.body.changeSet.status).toBe('applied');

    // What the model reads for that call from now on is the real result, links included.
    const { rows } = await h.kernel.db.execute<{ content: string; is_error: boolean }>(
      sql`select content, is_error from assistant.messages where conversation_id = ${id} and tool_name = 'assistant.apply_change_set'`,
    );
    expect(rows[0]!.is_error).toBe(false);
    expect(JSON.parse(rows[0]!.content).links).toEqual([
      { object: 'Request agent-form', label: 'Open the form', href: '/requests/forms/agent-form' },
    ]);
  });

  it('tells the conversation where the form is when a review applies its change set', async () => {
    const { id } = (await h.call(author, 'POST', `${A}/conversations`)).body;
    const events = await ask(
      author,
      id,
      `Create the reviewed process:\n\`\`\`json\n${JSON.stringify(proposals('reviewed-form'))}\n\`\`\``,
    );
    const changeSet = events.filter((e) => e.event === 'change_set').at(-1)!.data;
    expect(changeSet).toMatchObject({ itemCount: 2, ready: true });
    const submitted = await h.call(author, 'POST', `${A}/change-sets/${changeSet.id}/submit`, {});
    expect(submitted.status).toBe(200);

    const inbox = await eventually(
      () => h.call(admin, 'GET', '/api/v1/me/approvals?status=pending'),
      (r) => r.body.items?.some((t: LooseJson) => t.instance.subject.id === changeSet.id),
    );
    const task = inbox.body.items.find((t: LooseJson) => t.instance.subject.id === changeSet.id);
    expect((await h.call(admin, 'POST', `/api/v1/approvals/${task.task.id}/approve`, {})).status).toBe(200);

    const conversation = await eventually(
      () => h.call(author, 'GET', `${A}/conversations/${id}`),
      (r) => r.body.changeSet?.status === 'applied' && r.body.messages.at(-1)?.content.includes('approved'),
    );
    // Added after the agent's own answer (shown as one assistant message).
    const last = conversation.body.messages.at(-1);
    expect(last.role).toBe('assistant');
    expect(
      last.content.endsWith(
        `${changeSet.reference} was approved and applied by admin.\n\nReady to use:\n\n- Request reviewed-form: [Open the form](/requests/forms/reviewed-form)`,
      ),
    ).toBe(true);
    const { rows } = await h.kernel.db.execute<{ n: number }>(
      sql`select count(*)::int as n from core.forms where key = 'reviewed-form' and published_version = 1`,
    );
    expect(rows[0]!.n).toBe(1);
  });
});
