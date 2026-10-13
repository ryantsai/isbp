/**
 * Meeting minutes (Phase 11, `docs/architecture.md` §17.4–17.5): who sees a meeting, organising the notes (builtin),
 * accepting the minutes, sending them (attendees told, items live, task items created in their project as the sender
 * through the tool registry, refusals kept here), items following their task, owners completing items, My work,
 * reminders, follow-ups, the AI tools (and Projects reading decisions through them), search and deleting.
 */
import { auditLogs, notifications, roleAssignments, roles, users } from '@isbp/db/schema';
import { addDays, todayIn } from '@isbp/module-meetings/model';
import type { AuthContext, JobRun } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'pm' | 'alice' | 'bob' | 'carol' | 'reader', string>;

const API = '/api/v1/meetings';
const PROJECTS = '/api/v1/projects';
const ctx = () => h.kernel.registry.context('meetings');
const authOf = async (userId: string): Promise<AuthContext> => (await ctx().rbac.authFor(userId))!;

const today = todayIn('Asia/Taipei');
const tomorrow = addDays(today, 1);
const yesterday = addDays(today, -1);
const nextWeek = addDays(today, 7);

let projectId = '';
let meeting: LooseJson;
const item: Record<'task' | 'refused' | 'tracked' | 'unowned', string> = {} as never;

async function eventually<T>(
  fn: () => Promise<T>,
  accept: (v: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(username: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: `${username[0]!.toUpperCase()}${username.slice(1)}`,
      passwordHash: await hashPassword(PASSWORD),
      timezone: 'Asia/Taipei',
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

const notificationsOf = (userId: string, type: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

const detail = async (who: Session, ref = meeting.reference) => h.call(who, 'GET', `${API}/meetings/${ref}`);
const itemOf = (body: LooseJson, id: string) => (body.actionItems as LooseJson[]).find((i) => i.id === id);

const runReminders = async () => {
  const job = h.kernel.registry.get('meetings')!.jobs!['action-item-reminders']!;
  const run: JobRun = {
    id: 't',
    name: 'action-item-reminders',
    data: {},
    attempt: 1,
    log: async () => undefined,
    updateProgress: async () => undefined,
  };
  return job.handler(run, ctx()) as Promise<{ dueSoon: number; overdue: number }>;
};

const notes = [
  'Firewall replacement planning.',
  'Decision: Replace the edge firewall in the first quarter.',
  `Action: @alice update the firewall runbook by ${nextWeek}`,
  `TODO @bob order the new appliances by ${nextWeek}`,
  '- [ ] @zed check the licence terms',
  'Is the vendor still supporting the old model?',
].join('\n');

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  for (const u of ['pm', 'alice', 'bob', 'carol', 'reader'] as const) ids[u] = await mkUser(u);
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('projects-manager'), userId: ids.pm },
    { roleId: await roleId('meetings-reader'), userId: ids.reader },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['pm', 'alice', 'bob', 'carol', 'reader']) s[u] = await h.login(u);

  // An active project managed by pm with alice as its only member (bob is not one).
  const created = await h.call(s.pm!, 'POST', `${PROJECTS}/projects`, {
    name: 'Edge firewall',
    key: 'MTA',
    budgetHours: 40,
    targetDate: addDays(today, 60),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  projectId = created.body.id;
  expect((await h.call(s.pm!, 'POST', `${PROJECTS}/projects/MTA/start`)).body.status).toBe('active');
  const member = await h.call(s.pm!, 'POST', `${PROJECTS}/projects/MTA/members`, {
    userId: ids.alice,
    role: 'member',
  });
  expect(member.status).toBe(201);
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('recording a meeting', () => {
  it('records a private meeting about a project, with the organiser as an attendee', async () => {
    const res = await h.call(s.pm!, 'POST', `${API}/meetings`, {
      title: 'Firewall planning',
      startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      attendeeIds: [ids.alice, ids.bob],
      links: [`projects.project:${projectId}`],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    meeting = res.body;
    expect(meeting).toMatchObject({
      reference: 'MTG-00001',
      status: 'draft',
      visibility: 'private',
      attendeeCount: 3,
      projects: [{ id: projectId, key: 'MTA' }],
      viewer: { canEdit: true, canDelete: true, isAttendee: true },
    });
    const [audit] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'meetings.meeting.created'));
    expect(audit).toMatchObject({ entityId: meeting.id });
  });

  it('refuses links to records the organiser cannot see, and attendees who are not active people', async () => {
    const link = await h.call(s.pm!, 'POST', `${API}/meetings`, {
      title: 'Nope',
      startsAt: new Date().toISOString(),
      links: [`projects.project:${crypto.randomUUID()}`],
    });
    expect(link.status).toBe(400);
    const person = await h.call(s.pm!, 'POST', `${API}/meetings`, {
      title: 'Nope',
      startsAt: new Date().toISOString(),
      attendeeIds: [crypto.randomUUID()],
    });
    expect(person.status).toBe(400);
  });

  it('shows a private meeting to its attendees and to readers of every meeting only', async () => {
    expect((await detail(s.alice!)).body.viewer).toMatchObject({ canEdit: true, canDelete: false });
    expect((await detail(s.carol!)).status).toBe(404);
    const reader = await detail(s.reader!);
    expect(reader.status).toBe(200);
    expect(reader.body.viewer).toMatchObject({ canEdit: false, canDelete: false });
    expect((await h.call(s.carol!, 'GET', `${API}/meetings?mine=false`)).body.total).toBe(0);
    expect(
      (await h.call(s.reader!, 'PATCH', `${API}/meetings/${meeting.reference}`, { notes: 'x' })).status,
    ).toBe(403);
  });
});

describe('organising the notes', () => {
  it('needs notes first', async () => {
    const res = await h.call(s.alice!, 'POST', `${API}/meetings/${meeting.reference}/organise`, {});
    expect(res.status).toBe(400);
  });

  it('proposes minutes with the builtin organiser and stores nothing', async () => {
    expect((await h.call(s.alice!, 'PATCH', `${API}/meetings/${meeting.reference}`, { notes })).status).toBe(
      200,
    );
    const res = await h.call(s.alice!, 'POST', `${API}/meetings/${meeting.reference}/organise`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mode: 'builtin', fallback: false });
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.decisions[0]).toMatch(/edge firewall/);
    expect(res.body.questions).toEqual(['Is the vendor still supporting the old model?']);
    // Linked to exactly one project: items default to tasks there.
    expect(res.body.actionItems).toEqual([
      {
        title: 'update the firewall runbook',
        ownerId: ids.alice,
        ownerHint: null,
        dueDate: nextWeek,
        destination: 'task',
        projectId,
      },
      {
        title: 'order the new appliances',
        ownerId: ids.bob,
        ownerHint: null,
        dueDate: nextWeek,
        destination: 'task',
        projectId,
      },
      {
        title: 'check the licence terms',
        ownerId: null,
        ownerHint: 'zed',
        dueDate: null,
        destination: 'task',
        projectId,
      },
    ]);
    expect((await detail(s.pm!)).body.actionItems).toEqual([]);
    // Unsaved notes on screen are organised as they are.
    const onScreen = await h.call(s.alice!, 'POST', `${API}/meetings/${meeting.reference}/organise`, {
      notes: 'Decision: Keep it.',
    });
    expect(onScreen.body.decisions).toEqual(['Keep it.']);
    expect((await h.call(s.carol!, 'POST', `${API}/meetings/${meeting.reference}/organise`, {})).status).toBe(
      404,
    );
  });
});

describe('accepting and sending the minutes', () => {
  it('refuses a task item without a project, at that item', async () => {
    const res = await h.call(s.pm!, 'POST', `${API}/meetings/${meeting.reference}/minutes`, {
      summary: null,
      decisions: [],
      questions: [],
      actionItems: [{ title: 'Something', destination: 'task' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0].path).toBe('actionItems.0.projectId');
  });

  it('saves the minutes; items wait until they are sent', async () => {
    const res = await h.call(s.pm!, 'POST', `${API}/meetings/${meeting.reference}/minutes`, {
      summary: '- Firewall replacement planning',
      decisions: ['Replace the edge firewall in the first quarter.'],
      questions: ['Is the vendor still supporting the old model?'],
      mode: 'builtin',
      actionItems: [
        {
          title: 'update the firewall runbook',
          ownerId: ids.alice,
          dueDate: nextWeek,
          destination: 'task',
          projectId,
        },
        // bob is not a member of MTA: the project will refuse the task.
        {
          title: 'order the new appliances',
          ownerId: ids.bob,
          dueDate: yesterday,
          destination: 'task',
          projectId,
        },
        { title: 'send the risk note to the CAB', ownerId: ids.alice, dueDate: tomorrow },
        { title: 'check the licence terms', ownerId: null },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      organisedMode: 'builtin',
      status: 'draft',
      items: { open: 4, total: 4 },
    });
    const items = res.body.actionItems as LooseJson[];
    item.task = items[0].id;
    item.refused = items[1].id;
    item.tracked = items[2].id;
    item.unowned = items[3].id;
    expect(items.map((i) => [i.destination, i.live, i.task])).toEqual([
      ['task', false, null],
      ['task', false, null],
      ['meeting', false, null],
      ['meeting', false, null],
    ]);
    expect(await notificationsOf(ids.alice, 'meetings.action-item.assigned')).toHaveLength(0);
    // Not on My work yet.
    const work = await h.call(s.alice!, 'GET', '/api/v1/me/work');
    expect(work.body.sections.find((x: LooseJson) => x.source === 'meetings.action-items')).toBeUndefined();
  });

  it('sends the minutes: attendees are told, items start and task items become project tasks as the sender', async () => {
    const res = await h.call(s.pm!, 'POST', `${API}/meetings/${meeting.reference}/publish`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.routed).toEqual([
      { itemId: item.task, title: 'update the firewall runbook', ok: true, reference: 'MTA-1', error: null },
      {
        itemId: item.refused,
        title: 'order the new appliances',
        ok: false,
        reference: null,
        error: 'invalid',
      },
    ]);
    expect(res.body.meeting).toMatchObject({ status: 'published', publishedBy: { id: ids.pm } });
    const task = itemOf(res.body.meeting, item.task);
    expect(task).toMatchObject({
      destination: 'task',
      live: true,
      task: { reference: 'MTA-1' },
      routeError: null,
    });
    expect(itemOf(res.body.meeting, item.refused)).toMatchObject({
      destination: 'meeting',
      routeError: 'invalid',
      task: null,
    });

    // The project task, created by pm for alice, with the meeting in its description, linked to the meeting.
    const created = await h.call(s.alice!, 'GET', `${PROJECTS}/tasks/MTA-1`);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ title: 'update the firewall runbook', dueDate: nextWeek });
    expect(created.body.assignee.id).toBe(ids.alice);
    expect(created.body.description).toContain(meeting.reference);
    const links = await ctx().records.linked(
      { type: 'meetings.meeting', id: meeting.id },
      { types: ['projects.task'] },
    );
    expect(links.map((l) => l.id)).toEqual([task.task.id]);
    const routed = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'meetings.action-item.routed'));
    expect(routed).toHaveLength(1);
    expect(routed[0]!.actorId).toBe(ids.pm);

    // Everyone else at the meeting gets the minutes; owners of items tracked here get theirs (task owners get the
    // project's own notification).
    for (const who of [ids.alice, ids.bob]) {
      const got = await eventually(
        () => notificationsOf(who, 'meetings.minutes.published'),
        (r) => r.length > 0,
      );
      expect(got).toHaveLength(1);
    }
    expect(await notificationsOf(ids.pm, 'meetings.minutes.published')).toHaveLength(0);
    const alice = await eventually(
      () => notificationsOf(ids.alice, 'meetings.action-item.assigned'),
      (r) => r.length > 0,
    );
    expect(alice.map((n) => n.href)).toEqual([`/meetings/${meeting.reference}?item=${item.tracked}`]);
    const bob = await eventually(
      () => notificationsOf(ids.bob, 'meetings.action-item.assigned'),
      (r) => r.length > 0,
    );
    expect(bob).toHaveLength(1);

    const again = await h.call(s.alice!, 'POST', `${API}/meetings/${meeting.reference}/publish`);
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('already_published');
  });

  it('lets an item owner who is not an attendee read the meeting and complete the item', async () => {
    const added = await h.call(s.pm!, 'POST', `${API}/meetings/${meeting.reference}/action-items`, {
      title: 'share the licence report',
      ownerId: ids.carol,
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const view = await detail(s.carol!);
    expect(view.status).toBe(200);
    expect(view.body.viewer).toMatchObject({ canEdit: false, isAttendee: false });
    expect(itemOf(view.body, added.body.id)).toMatchObject({ canEdit: false, canComplete: true, live: true });
    const done = await h.call(s.carol!, 'PATCH', `${API}/action-items/${added.body.id}`, { status: 'done' });
    expect(done.status).toBe(200);
    expect(
      (await h.call(s.carol!, 'PATCH', `${API}/action-items/${added.body.id}`, { title: 'Something else' }))
        .status,
    ).toBe(403);
    expect(
      (await h.call(s.carol!, 'PATCH', `${API}/action-items/${item.tracked}`, { status: 'done' })).status,
    ).toBe(403);
    expect((await h.call(s.pm!, 'DELETE', `${API}/action-items/${added.body.id}`)).status).toBe(204);
    expect((await detail(s.carol!)).status).toBe(404);
  });
});

describe('after the minutes are sent', () => {
  it('items that became project tasks follow their task, and are changed there', async () => {
    const done = await h.call(s.alice!, 'PATCH', `${PROJECTS}/tasks/MTA-1`, { status: 'done' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const after = await eventually(
      () => detail(s.pm!),
      (r) => itemOf(r.body, item.task)?.status === 'done',
    );
    expect(itemOf(after.body, item.task)).toMatchObject({ status: 'done', task: { reference: 'MTA-1' } });
    const edit = await h.call(s.pm!, 'PATCH', `${API}/action-items/${item.task}`, { title: 'Renamed' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.details).toMatchObject({ reason: 'routed', reference: 'MTA-1' });
  });

  it('puts open items tracked here on their owner’s My work and action items list', async () => {
    const work = await h.call(s.alice!, 'GET', '/api/v1/me/work');
    const section = work.body.sections.find((x: LooseJson) => x.source === 'meetings.action-items');
    expect(section).toMatchObject({ kind: 'task', count: 1 });
    expect(section.items).toEqual([
      expect.objectContaining({
        id: item.tracked,
        title: 'send the risk note to the CAB',
        due: expect.stringMatching(new RegExp(`^${tomorrow}`)),
        href: `/meetings/${meeting.reference}?item=${item.tracked}`,
      }),
    ]);
    const mine = await h.call(s.alice!, 'GET', `${API}/action-items`);
    expect(mine.body.items.map((i: LooseJson) => i.id)).toEqual([item.tracked]);
    const all = await h.call(s.alice!, 'GET', `${API}/action-items?status=all`);
    expect(all.body.items.map((i: LooseJson) => i.id).sort()).toEqual([item.task, item.tracked].sort());
    const organised = await h.call(s.pm!, 'GET', `${API}/action-items?view=assigned`);
    expect(organised.body.total).toBe(3);
  });

  it('reminds owners the day before, and of overdue items with the organiser the first time, once', async () => {
    const first = await runReminders();
    expect(first).toEqual({ dueSoon: 1, overdue: 1 });
    const soon = await eventually(
      () => notificationsOf(ids.alice, 'meetings.action-item.due_soon'),
      (r) => r.length > 0,
    );
    expect(soon).toHaveLength(1);
    for (const who of [ids.bob, ids.pm]) {
      const overdue = await eventually(
        () => notificationsOf(who, 'meetings.action-item.overdue'),
        (r) => r.length > 0,
      );
      expect(overdue, who).toHaveLength(1);
    }
    expect(await runReminders()).toEqual({ dueSoon: 0, overdue: 0 });
  });

  it('lets owners mark their items done and reopen them; others at the meeting may too, outsiders not', async () => {
    expect(
      (await h.call(s.carol!, 'PATCH', `${API}/action-items/${item.tracked}`, { status: 'done' })).status,
    ).toBe(404);
    const done = await h.call(s.alice!, 'PATCH', `${API}/action-items/${item.tracked}`, { status: 'done' });
    expect(done.status).toBe(200);
    expect(itemOf((await detail(s.alice!)).body, item.tracked)).toMatchObject({ status: 'done' });
    expect(
      (await h.call(s.bob!, 'PATCH', `${API}/action-items/${item.tracked}`, { status: 'open' })).status,
    ).toBe(200);
    const [row] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'meetings.action-item.updated'), eq(auditLogs.actorId, ids.bob)));
    expect(row).toBeDefined();
  });

  it('starts a follow-up meeting with the same people and links, listing the open items before it', async () => {
    const res = await h.call(s.alice!, 'POST', `${API}/meetings/${meeting.reference}/follow-up`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      reference: 'MTG-00002',
      status: 'draft',
      title: 'Firewall planning',
      attendeeCount: 3,
      previous: { reference: meeting.reference },
      projects: [{ key: 'MTA' }],
      // Whoever starts the follow-up organises it.
      organizer: { id: ids.alice },
    });
    expect((res.body.earlierItems as LooseJson[]).map((i) => i.id).sort()).toEqual(
      [item.refused, item.tracked, item.unowned].sort(),
    );
    expect((await h.call(s.pm!, 'DELETE', `${API}/meetings/${res.body.reference}`)).status).toBe(403);
    expect((await h.call(s.alice!, 'DELETE', `${API}/meetings/${res.body.reference}`)).status).toBe(204);
  });
});

describe('the AI tools and Projects', () => {
  it('finds the meetings of a project, with decisions and items, as the caller', async () => {
    const auth = await authOf(ids.alice);
    const out = await ctx().ai.tools.invoke<{ meetings: LooseJson[] }>(
      'meetings.find_meetings',
      { project: 'MTA' },
      { auth },
    );
    expect(out.meetings).toHaveLength(1);
    expect(out.meetings[0]).toMatchObject({
      reference: meeting.reference,
      projectIds: [projectId],
      decisions: ['Replace the edge firewall in the first quarter.'],
    });
    expect(out.meetings[0].actionItems).toContainEqual(
      expect.objectContaining({ title: 'update the firewall runbook', task: 'MTA-1', status: 'done' }),
    );
    const outsider = await ctx().ai.tools.invoke<{ meetings: LooseJson[] }>(
      'meetings.find_meetings',
      { projectIds: [projectId] },
      { auth: await authOf(ids.carol) },
    );
    expect(outsider.meetings).toEqual([]);
  });

  it('lists my action items', async () => {
    const out = await ctx().ai.tools.invoke<{ total: number; items: LooseJson[] }>(
      'meetings.my_action_items',
      {},
      { auth: await authOf(ids.alice) },
    );
    expect(out.items.map((i) => i.title)).toEqual(['send the risk note to the CAB']);
  });

  it('feeds the decisions of the project’s meetings into its status draft and the status report', async () => {
    const draft = await h.call(s.pm!, 'POST', `${PROJECTS}/projects/MTA/status-updates/draft`);
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect(draft.body.sources.meetings.map((m: LooseJson) => m.reference)).toEqual([meeting.reference]);
    const report = await h.call(s.pm!, 'GET', `${PROJECTS}/status-report?template=detailed`);
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body.decisions).toContainEqual(
      expect.objectContaining({
        text: 'Replace the edge firewall in the first quarter.',
        projects: ['MTA'],
        meeting: expect.objectContaining({ reference: meeting.reference }),
      }),
    );
  });

  it('records a draft meeting from a conversation, linked to a project', async () => {
    const out = await ctx().ai.tools.invoke<LooseJson>(
      'meetings.create_minutes',
      {
        title: 'Vendor call',
        startsAt: new Date().toISOString(),
        attendeeEmails: ['alice@test.example'],
        notes: 'Decision: Order in November.',
        project: 'MTA',
      },
      { auth: await authOf(ids.pm) },
    );
    expect(out.reference).toMatch(/^MTG-\d{5}$/);
    const res = await detail(s.alice!, out.reference);
    expect(res.body).toMatchObject({ status: 'draft', attendeeCount: 2, projects: [{ key: 'MTA' }] });
    await expect(
      ctx().ai.tools.invoke(
        'meetings.create_minutes',
        {
          title: 'x',
          startsAt: new Date().toISOString(),
          attendeeEmails: ['nobody@test.example'],
          notes: 'x',
        },
        { auth: await authOf(ids.pm) },
      ),
    ).rejects.toThrow();
  });

  it('indexes the minutes for search with the meeting’s readers', async () => {
    const search = async (who: string) =>
      ctx().ai.index.search('firewall runbook', {
        types: ['meetings.meeting'],
        auth: await authOf(who),
        limit: 5,
      });
    const hits = await eventually(
      () => search(ids.bob),
      (r) => r.some((x) => x.id === meeting.id),
    );
    expect(hits.map((x) => x.id)).toContain(meeting.id);
    expect((await search(ids.carol)).map((x) => x.id)).not.toContain(meeting.id);
    expect((await search(ids.reader)).map((x) => x.id)).toContain(meeting.id);
  });
});

describe('deleting a meeting', () => {
  it('is for the organiser; the project tasks made from it stay', async () => {
    expect((await h.call(s.alice!, 'DELETE', `${API}/meetings/${meeting.reference}`)).status).toBe(403);
    expect((await h.call(s.pm!, 'DELETE', `${API}/meetings/${meeting.reference}`)).status).toBe(204);
    expect((await detail(s.pm!)).status).toBe(404);
    expect((await h.call(s.alice!, 'GET', `${PROJECTS}/tasks/MTA-1`)).status).toBe(200);
    const hits = await eventually(
      async () =>
        ctx().ai.index.search('firewall runbook', {
          types: ['meetings.meeting'],
          auth: await authOf(ids.reader),
          limit: 5,
        }),
      (r) => !r.some((x) => x.id === meeting.id),
    );
    expect(hits.map((x) => x.id)).not.toContain(meeting.id);
  });
});
