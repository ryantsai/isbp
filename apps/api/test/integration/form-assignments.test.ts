import { periodKey } from '@isbp/contracts';
import {
  auditLogs,
  formAssignments,
  groupMembers,
  groups,
  notifications,
  outboxEvents,
  users,
} from '@isbp/db/schema';
import type { AuthContext, ModuleContext, TaskContext } from '@isbp/sdk/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FormAssignmentService } from '../../src/core/services/form-assignments';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/** Core plus Scheduled jobs (the `core.assign-form` task type runs there); restored after setup. */
const MODULES = process.env.ISBP_TEST_MODULES;
const FORM_KEY = 'server-room-inspection';
const HOUR = 3_600_000;

let h: Harness;
let core: ModuleContext;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<
  'alice' | 'bob' | 'carol' | 'dave' | 'gone' | 'itOps' | 'form' | 'draftForm',
  string
>;

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(username: string, status: 'active' | 'suspended' = 'active') {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      status,
    })
    .returning();
  return u!.id;
}

const authOf = async (userId: string) => (await core.rbac.authFor(userId)) as AuthContext;
const assign = (body: Record<string, unknown>, formId = ids.form, who = 'admin') =>
  h.call(s[who]!, 'POST', `/api/v1/forms/${formId}/assignments`, {
    dueAt: new Date(Date.now() + 7 * 24 * HOUR).toISOString(),
    ...body,
  });
const submit = (who: string, assignment?: string, data: Record<string, unknown> = { ok: true }) =>
  h.call(
    s[who]!,
    'POST',
    `/api/v1/forms/by-key/${FORM_KEY}/submissions${assignment ? `?assignment=${assignment}` : ''}`,
    { data: { checkedBy: 'me', ...data } },
  );
const mine = async (who: string, status = 'open') =>
  (await h.call(s[who]!, 'GET', `/api/v1/me/form-assignments?status=${status}`)).body as LooseJson;
const rowOf = async (id: string) =>
  (await h.kernel.db.select().from(formAssignments).where(eq(formAssignments.id, id)))[0]!;
const notesFor = (userId: string, type: string, href?: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, type),
        href ? eq(notifications.href, href) : undefined,
      ),
    )
    .orderBy(asc(notifications.createdAt));
const eventsFor = (name: string, assignmentId: string) =>
  h.kernel.db
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.name, name), sql`${outboxEvents.payload}->>'assignmentId' = ${assignmentId}`));

function task(over: Partial<TaskContext> = {}): TaskContext {
  return {
    runId: '01a10fa3-5141-77f6-9b0a-10258b3a22fb',
    jobId: '01a10fa3-5141-77f6-9b0a-10258b3a22fc',
    attempt: 1,
    scheduledFor: new Date(),
    lastSuccessAt: null,
    signal: new AbortController().signal,
    log: () => undefined,
    ...over,
  };
}

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? 'scheduler';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  core = h.kernel.registry.context('core');
  stopWorker = await startWorker(h.kernel);
  const db = h.kernel.db;
  ids.alice = await mkUser('alice');
  ids.bob = await mkUser('bob');
  ids.carol = await mkUser('carol');
  ids.dave = await mkUser('dave');
  ids.gone = await mkUser('gone', 'suspended');
  const [ops] = await db.insert(groups).values({ key: 'it-ops', name: 'IT operations' }).returning();
  ids.itOps = ops!.id;
  await db.insert(groups).values({ key: 'auditors', name: 'Auditors' });
  await db.insert(groupMembers).values([
    { groupId: ops!.id, userId: ids.bob },
    { groupId: ops!.id, userId: ids.carol },
  ]);
  for (const u of ['admin', 'outsider', 'alice', 'bob', 'carol', 'dave']) s[u] = await h.login(u);

  // A checklist offered only to auditors: assignees fill it in through their assignment.
  const form = await h.call(s.admin!, 'POST', '/api/v1/forms', {
    key: FORM_KEY,
    name: { en: 'Server room inspection', 'zh-TW': '機房巡檢' },
    icon: 'clipboard-check',
  });
  expect(form.status).toBe(201);
  ids.form = form.body.id;
  const patched = await h.call(s.admin!, 'PATCH', `/api/v1/forms/${ids.form}`, {
    audience: { type: 'groups', groupKeys: ['auditors'] },
    draft: {
      elements: [
        { id: 'a', key: 'checkedBy', type: 'text', label: { en: 'Checked by' }, required: true },
        { id: 'b', key: 'ok', type: 'boolean', label: { en: 'Temperature and humidity are normal' } },
      ],
    },
  });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  expect((await h.call(s.admin!, 'POST', `/api/v1/forms/${ids.form}/publish`)).status).toBe(200);
  const draft = await h.call(s.admin!, 'POST', '/api/v1/forms', {
    key: 'never-published',
    name: { en: 'Draft' },
  });
  ids.draftForm = draft.body.id;
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('assigning by hand', () => {
  let aliceTodo: LooseJson;

  it('assigns a form to a person, who is told', async () => {
    const res = await assign({
      assignee: { type: 'user', userId: ids.alice },
      title: 'Server room inspection — October',
      periodKey: '2026-10',
      note: 'Check the UPS log too.',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    aliceTodo = res.body;
    expect(aliceTodo).toMatchObject({
      title: 'Server room inspection — October',
      periodKey: '2026-10',
      status: 'open',
      state: 'open',
      assignee: { type: 'user', user: { id: ids.alice } },
      source: { type: 'manual', id: null },
      submission: null,
      createdBy: { id: h.ids.admin },
      form: { key: FORM_KEY },
      href: `/requests/forms/${FORM_KEY}?assignment=${aliceTodo.id}`,
    });
    const [note] = await notesFor(ids.alice, 'core.form-assignment.assigned', aliceTodo.href);
    expect(note!.title).toBe('To do: Server room inspection — October');
    expect(note!.body).toContain('Server room inspection');
    expect(await eventsFor('core.form-assignment.created', aliceTodo.id)).toHaveLength(1);
    const [audit] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.form-assignment.created'), eq(auditLogs.entityId, aliceTodo.id)));
    expect(audit).toBeTruthy();
  });

  it('names the assignment after the form when no title is given', async () => {
    const res = await assign({ assignee: { type: 'user', userId: ids.dave }, periodKey: '2026-Q4' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Server room inspection 2026-Q4');
    expect(
      (await h.call(s.admin!, 'POST', `/api/v1/form-assignments/${res.body.id}/cancel`, {})).status,
    ).toBe(200);
  });

  it('refuses outsiders, unpublished forms, unknown groups and inactive people', async () => {
    expect(
      (await assign({ assignee: { type: 'user', userId: ids.alice } }, ids.form, 'outsider')).status,
    ).toBe(403);
    const draft = await assign({ assignee: { type: 'user', userId: ids.alice } }, ids.draftForm);
    expect(draft.status).toBe(409);
    expect(draft.body.error.code).toBe('INVALID_STATE');
    const group = await assign({ assignee: { type: 'group', groupKey: 'no-such-group' } });
    expect(group.status).toBe(400);
    expect(group.body.error.details.issues[0].path).toBe('assignee.groupKey');
    expect((await assign({ assignee: { type: 'user', userId: ids.gone } })).status).toBe(400);
    expect((await assign({ assignee: { type: 'user', userId: ids.alice }, dueAt: 'tomorrow' })).status).toBe(
      400,
    );
  });

  it('lists the to-do for the assignee only', async () => {
    const list = await mine('alice');
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(aliceTodo.id);
    expect((await mine('carol')).total).toBe(0);
    expect((await h.call(s.alice!, 'GET', `/api/v1/me/form-assignments/${aliceTodo.id}`)).status).toBe(200);
    expect((await h.call(s.dave!, 'GET', `/api/v1/me/form-assignments/${aliceTodo.id}`)).status).toBe(404);
  });

  it('opens the form to the assignee through the assignment, whatever its audience', async () => {
    const plain = await h.call(s.alice!, 'GET', `/api/v1/forms/by-key/${FORM_KEY}`);
    expect(plain.status).toBe(404);
    expect(plain.body.error.code).toBe('FORM_NOT_AVAILABLE');
    const viaTodo = await h.call(
      s.alice!,
      'GET',
      `/api/v1/forms/by-key/${FORM_KEY}?assignment=${aliceTodo.id}`,
    );
    expect(viaTodo.status).toBe(200);
    const preview = (q: string) =>
      h.call(s.alice!, 'POST', `/api/v1/forms/by-key/${FORM_KEY}/preview${q}`, { data: {} });
    expect((await preview('')).status).toBe(404);
    expect((await preview(`?assignment=${aliceTodo.id}`)).body).toEqual({ steps: [] });
    // Someone else's assignment opens nothing.
    expect(
      (await h.call(s.dave!, 'GET', `/api/v1/forms/by-key/${FORM_KEY}?assignment=${aliceTodo.id}`)).status,
    ).toBe(404);
    expect(
      (await h.call(s.alice!, 'GET', '/api/v1/forms/catalog')).body.items.map((f: LooseJson) => f.key),
    ).not.toContain(FORM_KEY);
  });

  it('is completed only by the assignee, once', async () => {
    const wrong = await submit('dave', aliceTodo.id);
    expect(wrong.status).toBe(403);
    expect((await rowOf(aliceTodo.id)).status).toBe('open');

    const invalid = await submit('alice', aliceTodo.id, { checkedBy: '' });
    expect(invalid.status).toBe(400);
    expect((await rowOf(aliceTodo.id)).status).toBe('open');

    const done = await submit('alice', aliceTodo.id);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    const row = await rowOf(aliceTodo.id);
    expect(row).toMatchObject({ status: 'done', submissionId: done.body.id });
    const view = (await h.call(s.alice!, 'GET', `/api/v1/me/form-assignments/${aliceTodo.id}`)).body;
    expect(view).toMatchObject({ state: 'done', submission: { reference: done.body.reference } });
    expect(await eventsFor('core.form-assignment.completed', aliceTodo.id)).toMatchObject([
      { payload: { submissionId: done.body.id, late: false, periodKey: '2026-10' } },
    ]);

    const again = await submit('alice', aliceTodo.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ASSIGNMENT_CLOSED');
    // Without the assignment the form stays closed to her (it's offered to auditors).
    expect((await submit('alice')).status).toBe(404);
    expect((await mine('alice')).total).toBe(0);
    expect((await mine('alice', 'closed')).items.map((i: LooseJson) => i.id)).toEqual([aliceTodo.id]);
  });

  it('refuses an assignment for another form', async () => {
    await h.call(s.admin!, 'POST', '/api/v1/forms', { key: 'backup-check', name: { en: 'Backup check' } });
    const other = (await h.call(s.admin!, 'GET', '/api/v1/forms?q=backup-check')).body.items[0];
    await h.call(s.admin!, 'PATCH', `/api/v1/forms/${other.id}`, {
      draft: { elements: [{ id: 'a', key: 'note', type: 'text', label: { en: 'Note' } }] },
    });
    await h.call(s.admin!, 'POST', `/api/v1/forms/${other.id}/publish`);
    const todo = (await assign({ assignee: { type: 'user', userId: ids.alice } }, other.id)).body;
    const res = await submit('alice', todo.id);
    expect(res.status).toBe(400);
    expect((await rowOf(todo.id)).status).toBe('open');
    expect((await h.call(s.admin!, 'POST', `/api/v1/form-assignments/${todo.id}/cancel`, {})).status).toBe(
      200,
    );
  });
});

describe('group assignments', () => {
  it('lets any member of the group complete it, through its own link', async () => {
    const todo = (await assign({ assignee: { type: 'group', groupKey: 'it-ops' }, title: 'Backup check' }))
      .body;
    expect(todo.assignee).toMatchObject({ type: 'group', group: { id: ids.itOps, key: 'it-ops' } });
    expect(await notesFor(ids.bob, 'core.form-assignment.assigned', todo.href)).toHaveLength(1);
    expect(await notesFor(ids.carol, 'core.form-assignment.assigned', todo.href)).toHaveLength(1);
    expect((await mine('bob')).items.map((i: LooseJson) => i.id)).toContain(todo.id);
    expect((await mine('carol')).items.map((i: LooseJson) => i.id)).toContain(todo.id);
    expect((await mine('dave')).items.map((i: LooseJson) => i.id)).not.toContain(todo.id);
    expect((await submit('dave', todo.id)).status).toBe(403);

    const done = await h.call(s.bob!, 'POST', `/api/v1/me/form-assignments/${todo.id}/submissions`, {
      data: { checkedBy: 'bob' },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.submittedBy.id).toBe(ids.bob);
    expect((await mine('carol')).items.map((i: LooseJson) => i.id)).not.toContain(todo.id);
    const late = await h.call(s.carol!, 'POST', `/api/v1/me/form-assignments/${todo.id}/submissions`, {
      data: { checkedBy: 'carol' },
    });
    expect(late.status).toBe(409);
    expect(
      (await h.call(s.carol!, 'GET', `/api/v1/me/form-assignments/${todo.id}`)).body.submission.submittedBy
        .id,
    ).toBe(ids.bob);
  });
});

describe('cancelling', () => {
  it('cancels open assignments only; a cancelled one cannot be completed', async () => {
    const todo = (await assign({ assignee: { type: 'user', userId: ids.alice }, periodKey: '2026-09' })).body;
    expect((await h.call(s.alice!, 'POST', `/api/v1/form-assignments/${todo.id}/cancel`, {})).status).toBe(
      403,
    );
    const res = await h.call(s.admin!, 'POST', `/api/v1/form-assignments/${todo.id}/cancel`, {
      reason: 'Room closed for renovation',
    });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('cancelled');
    expect(await eventsFor('core.form-assignment.cancelled', todo.id)).toHaveLength(1);
    const twice = await h.call(s.admin!, 'POST', `/api/v1/form-assignments/${todo.id}/cancel`, {});
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('ASSIGNMENT_CLOSED');
    expect((await submit('alice', todo.id)).status).toBe(409);
  });
});

describe('administration', () => {
  it('lists with filters and summarises each period', async () => {
    // Done after its due date: late.
    const late = (
      await assign({
        assignee: { type: 'user', userId: ids.alice },
        periodKey: '2026-08',
        dueAt: new Date(Date.now() - 2 * 24 * HOUR).toISOString(),
      })
    ).body;
    expect(late.state).toBe('overdue');
    expect((await submit('alice', late.id)).status).toBe(201);
    expect((await h.call(s.alice!, 'GET', `/api/v1/me/form-assignments/${late.id}`)).body.state).toBe('late');
    expect(await eventsFor('core.form-assignment.completed', late.id)).toMatchObject([
      { payload: { late: true } },
    ]);
    const overdue = (
      await assign({
        assignee: { type: 'user', userId: ids.dave },
        periodKey: '2026-08',
        dueAt: new Date(Date.now() - HOUR).toISOString(),
      })
    ).body;

    const list = async (q: string) =>
      (await h.call(s.admin!, 'GET', `/api/v1/forms/${ids.form}/assignments?${q}`)).body as LooseJson;
    expect((await list('state=late')).items.map((i: LooseJson) => i.id)).toEqual([late.id]);
    expect((await list('state=overdue')).items.map((i: LooseJson) => i.id)).toEqual([overdue.id]);
    expect((await list('period=2026-08')).total).toBe(2);
    expect((await list('state=cancelled')).total).toBeGreaterThanOrEqual(2);
    expect((await list('q=backup')).items.map((i: LooseJson) => i.title)).toEqual(['Backup check']);
    expect((await h.call(s.outsider!, 'GET', `/api/v1/forms/${ids.form}/assignments`)).status).toBe(403);

    const compliance = (await h.call(s.admin!, 'GET', `/api/v1/forms/${ids.form}/assignments/compliance`))
      .body;
    const aug = compliance.periods.find((p: LooseJson) => p.periodKey === '2026-08');
    expect(aug).toMatchObject({ total: 2, late: 1, overdue: 1, onTime: 0, open: 0, cancelled: 0 });
    const oct = compliance.periods.find((p: LooseJson) => p.periodKey === '2026-10');
    expect(oct).toMatchObject({ total: 1, onTime: 1 });

    const options = (await h.call(s.admin!, 'GET', '/api/v1/form-assignments/options')).body;
    expect(options.forms.find((f: LooseJson) => f.key === FORM_KEY)).toMatchObject({ published: true });
    expect(options.forms.find((f: LooseJson) => f.key === 'never-published')).toMatchObject({
      published: false,
    });
    expect(options.groups.map((g: LooseJson) => g.key)).toContain('it-ops');
    await h.call(s.admin!, 'POST', `/api/v1/form-assignments/${overdue.id}/cancel`, {});
  });

  it('keeps the personal routes for people', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/me/form-assignments' });
    expect(res.statusCode).toBe(401);
  });
});

describe('core.assign-form (Scheduled Jobs)', () => {
  const config = {
    formKey: FORM_KEY,
    assignee: { type: 'group', groupKey: 'it-ops' },
    period: 'month',
    due: { type: 'end-of-period' },
    title: 'Server room inspection {{period}}',
    note: 'Monthly checklist',
  };

  it('opens one assignment per period, in the job’s time zone', async () => {
    // 00:30 on 1 November in Taipei (still October in UTC).
    const first = await core.taskTypes.run(
      'core.assign-form',
      config,
      task({ scheduledFor: new Date('2026-10-31T16:30:00Z'), timeZone: 'Asia/Taipei' }),
    );
    expect(first).toMatchObject({
      summary: 'core.taskTypes.assignForm.assigned',
      summaryParams: { title: 'Server room inspection 2026-11' },
      metrics: { created: 1 },
    });
    const [row] = await h.kernel.db
      .select()
      .from(formAssignments)
      .where(and(eq(formAssignments.formId, ids.form), eq(formAssignments.periodKey, '2026-11')));
    expect(row).toMatchObject({
      title: 'Server room inspection 2026-11',
      assigneeGroupId: ids.itOps,
      note: 'Monthly checklist',
      source: { type: 'job', id: task().jobId },
      createdBy: null,
    });
    expect(row!.dueAt.toISOString()).toBe('2026-11-30T15:59:59.000Z');
    expect(
      await notesFor(
        ids.bob,
        'core.form-assignment.assigned',
        `/requests/forms/${FORM_KEY}?assignment=${row!.id}`,
      ),
    ).toHaveLength(1);

    // A retry, "Run now" or a later slot of the same month changes nothing.
    const again = await core.taskTypes.run(
      'core.assign-form',
      config,
      task({ scheduledFor: new Date('2026-11-15T01:00:00Z'), timeZone: 'Asia/Taipei', attempt: 2 }),
    );
    expect(again).toMatchObject({
      summary: 'core.taskTypes.assignForm.alreadyAssigned',
      summaryParams: { period: '2026-11' },
      metrics: { created: 0 },
    });
    const next = await core.taskTypes.run(
      'core.assign-form',
      { ...config, due: { type: 'days', days: 7 } },
      task({ scheduledFor: new Date('2026-12-01T01:00:00Z'), timeZone: 'Asia/Taipei' }),
    );
    expect(next.metrics).toEqual({ created: 1 });
    const rows = await h.kernel.db
      .select()
      .from(formAssignments)
      .where(and(eq(formAssignments.formId, ids.form), sql`${formAssignments.source}->>'type' = 'job'`));
    expect(rows.map((r) => r.periodKey).sort()).toEqual(['2026-11', '2026-12']);
    expect(rows.find((r) => r.periodKey === '2026-12')!.dueAt.toISOString()).toBe('2026-12-08T15:59:59.000Z');
  });

  it('validates the configuration as the job’s editor', async () => {
    const admin = await authOf(h.ids.admin);
    await expect(core.taskTypes.validate('core.assign-form', config, admin)).resolves.toBeTruthy();
    const issue = async (c: unknown) => {
      const err = (await core.taskTypes
        .validate('core.assign-form', c, admin)
        .catch((e: unknown) => e)) as LooseJson;
      return { status: err?.statusCode, path: err?.details?.issues?.[0]?.path };
    };
    expect(await issue({ ...config, formKey: 'nope' })).toEqual({ status: 400, path: 'formKey' });
    expect(await issue({ ...config, formKey: 'never-published' })).toEqual({ status: 400, path: 'formKey' });
    expect(await issue({ ...config, assignee: { type: 'group', groupKey: 'nope' } })).toEqual({
      status: 400,
      path: 'assignee.groupKey',
    });
    expect(await issue({ ...config, assignee: { type: 'user', userId: ids.gone } })).toEqual({
      status: 400,
      path: 'assignee.userId',
    });
    expect((await issue({ ...config, period: 'fortnight' })).status).toBe(400);
    const refused = (await core.taskTypes
      .validate('core.assign-form', config, await authOf(h.ids.outsider))
      .catch((e: unknown) => e)) as LooseJson;
    expect(refused.statusCode).toBe(403);
    // The group's name, not its key, in the reader's language.
    expect(await core.taskTypes.describe('core.assign-form', config)).toEqual({
      label: 'Assign “Server room inspection” to IT operations, every month',
      href: `/admin/forms/${ids.form}?tab=assignments`,
    });
    expect((await core.taskTypes.describe('core.assign-form', config, { locale: 'zh-TW' })).label).toBe(
      '每月將「機房巡檢」指派給IT operations',
    );
  });

  it('runs as a scheduled job and is offered to the assistant’s scheduler.job kind', async () => {
    const created = await h.call(s.admin!, 'POST', '/api/v1/scheduler/jobs', {
      name: 'Monthly server room inspection',
      type: 'core.assign-form',
      config: { ...config, assignee: { type: 'user', userId: ids.carol }, title: 'Inspection {{period}}' },
      trigger: { kind: 'cron', cron: '0 9 1 * *', timezone: 'Asia/Taipei' },
      timeoutSeconds: 60,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const run = await h.call(s.admin!, 'POST', `/api/v1/scheduler/jobs/${created.body.id}/run`);
    expect(run.status).toBe(201);
    const finished = await eventually(
      async () => (await h.call(s.admin!, 'GET', `/api/v1/scheduler/runs/${run.body.id}`)).body as LooseJson,
      (r) => ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(r.status),
    );
    expect(finished.status, JSON.stringify(finished)).toBe('succeeded');
    const key = periodKey(new Date(finished.scheduledFor), 'month', 'Asia/Taipei');
    const todo = (await mine('carol')).items.find((i: LooseJson) => i.title === `Inspection ${key}`);
    expect(todo).toMatchObject({ periodKey: key, source: { type: 'job', id: created.body.id } });

    const guide = (await h.kernel.customizations.describe('scheduler.job', await authOf(h.ids.admin))).guide;
    const types = (guide.reference as LooseJson).taskTypes;
    expect(types.find((t: LooseJson) => t.type === 'core.assign-form')).toMatchObject({
      permission: 'core.forms.manage',
    });
    const check = await h.kernel.customizations.validate(
      'scheduler.job',
      {
        op: 'create',
        id: null,
        value: {
          name: 'Quarterly firewall rule review',
          description: null,
          ownerGroupId: null,
          type: 'core.assign-form',
          config: { ...config, period: 'quarter', title: 'Firewall rule review {{period}}' },
          trigger: { kind: 'cron', cron: '0 9 1 1,4,7,10 *', timezone: 'Asia/Taipei' },
          timeoutSeconds: 60,
          retries: { maxAttempts: 1, backoff: 'fixed', delaySeconds: 60 },
          concurrency: 'skip',
          alerts: { onFailure: true, channels: false, autoDisableAfter: 0 },
        },
      },
      await authOf(h.ids.admin),
    );
    expect(check.issues).toEqual([]);
  });
});

describe('reminders', () => {
  it('reminds before the due date and when overdue, at most daily, and tells the editors once', async () => {
    const svc = new FormAssignmentService(core);
    const now = new Date();
    const todo = (
      await assign({
        assignee: { type: 'user', userId: ids.alice },
        title: 'Backup check — reminders',
        dueAt: new Date(now.getTime() + 30 * HOUR).toISOString(),
      })
    ).body;
    const fresh = (
      await assign({
        assignee: { type: 'user', userId: ids.dave },
        title: 'Just assigned',
        dueAt: new Date(now.getTime() + 10 * HOUR).toISOString(),
      })
    ).body;
    const group = (
      await assign({
        assignee: { type: 'group', groupKey: 'it-ops' },
        title: 'Group overdue',
        dueAt: new Date(now.getTime() - 3 * HOUR).toISOString(),
      })
    ).body;
    // Assigned two days ago (a reminder never follows the assignment on the same day).
    await h.kernel.db
      .update(formAssignments)
      .set({ createdAt: new Date(now.getTime() - 48 * HOUR) })
      .where(sql`${formAssignments.id} in (${todo.id}, ${group.id})`);
    const reminders = (userId: string, href: string) =>
      notesFor(userId, 'core.form-assignment.reminder', href).then((r) => r.map((n) => n.title));

    await svc.remind(now);
    expect(await reminders(ids.alice, todo.href)).toEqual(['Due soon: Backup check — reminders']);
    expect(await reminders(ids.dave, fresh.href)).toEqual([]);
    expect(await reminders(ids.bob, group.href)).toEqual(['Overdue: Group overdue']);
    expect(await reminders(ids.carol, group.href)).toEqual(['Overdue: Group overdue']);
    expect(await eventsFor('core.form-assignment.overdue', group.id)).toHaveLength(1);

    // Not again within the day.
    await svc.remind(new Date(now.getTime() + HOUR));
    expect(await reminders(ids.alice, todo.href)).toHaveLength(1);
    expect(await reminders(ids.bob, group.href)).toHaveLength(1);

    // Two days later it is overdue: Alice is reminded, the form's editors hear about it once.
    await svc.remind(new Date(now.getTime() + 48 * HOUR));
    expect(await reminders(ids.alice, todo.href)).toEqual([
      'Due soon: Backup check — reminders',
      'Overdue: Backup check — reminders',
    ]);
    const editors = await h.kernel.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.type, 'core.form-assignment.overdue'),
          eq(notifications.userId, h.ids.admin),
          eq(notifications.title, 'Overdue: Backup check — reminders'),
        ),
      );
    expect(editors).toHaveLength(1);
    expect(editors[0]!.body).toContain('alice');
    expect(editors[0]!.href).toBe(`/admin/forms/${ids.form}?tab=assignments`);
    expect(await eventsFor('core.form-assignment.overdue', todo.id)).toHaveLength(1);

    await svc.remind(new Date(now.getTime() + 49 * HOUR));
    await svc.remind(new Date(now.getTime() + 72 * HOUR));
    expect(await reminders(ids.alice, todo.href)).toHaveLength(3);
    expect(await eventsFor('core.form-assignment.overdue', todo.id)).toHaveLength(1);

    // Done or cancelled: no more reminders.
    const bobBefore = (await reminders(ids.bob, group.href)).length;
    expect(bobBefore).toBe(3);
    expect((await submit('alice', todo.id)).status).toBe(201);
    await h.call(s.admin!, 'POST', `/api/v1/form-assignments/${group.id}/cancel`, {});
    await svc.remind(new Date(now.getTime() + 120 * HOUR));
    expect(await reminders(ids.alice, todo.href)).toHaveLength(3);
    expect(await reminders(ids.bob, group.href)).toHaveLength(bobBefore);
    expect((await rowOf(fresh.id)).lastRemindedAt).not.toBeNull();
  });
});
