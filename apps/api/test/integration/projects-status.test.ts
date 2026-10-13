/**
 * Status reporting (Phase 11, `docs/architecture.md` §17.1–17.3): the organisation's schedule, expected updates and
 * reminders, posting and editing updates (a manager's sets the project's health), the status report computed per
 * reader, templates, the customisation kinds, the Scheduled Jobs task type and the AI tools.
 */
import {
  auditLogs,
  groupMembers,
  groups,
  notifications,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { addDays, todayIn } from '@isbp/module-projects/model';
import { reportNarratives, statusSchedule, statusUpdates } from '@isbp/module-projects/schema';
import type { AuthContext, Db, JobRun, TaskContext } from '@isbp/sdk/server';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'pm' | 'alice' | 'bob' | 'viewer' | 'pmo' | 'lead', string>;

const API = '/api/v1/projects';
const ctx = () => h.kernel.registry.context('projects');
const authOf = async (userId: string): Promise<AuthContext> => (await ctx().rbac.authFor(userId))!;

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

/** An active project managed by `pm` with alice and bob as members and a viewer. */
async function activeProject(key: string, extra: Record<string, unknown> = {}) {
  const created = await h.call(s.pm!, 'POST', `${API}/projects`, {
    name: `Project ${key}`,
    key,
    budgetHours: 40,
    targetDate: addDays(todayIn('Asia/Taipei'), 60),
    ...extra,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await h.call(s.pm!, 'POST', `${API}/projects/${key}/start`)).body.status).toBe('active');
  for (const [user, role] of [
    ['alice', 'member'],
    ['bob', 'member'],
    ['viewer', 'viewer'],
  ] as const) {
    const res = await h.call(s.pm!, 'POST', `${API}/projects/${key}/members`, { userId: ids[user], role });
    expect(res.status).toBe(201);
  }
  return created.body as LooseJson;
}

const runJob = async (name: string, data: unknown = {}) => {
  const job = h.kernel.registry.get('projects')!.jobs![name]!;
  const run: JobRun = {
    id: 't',
    name,
    data,
    attempt: 1,
    log: async () => undefined,
    updateProgress: async () => undefined,
  };
  return job.handler(run, ctx());
};

const schedule = (body: Record<string, unknown> = {}) => ({
  enabled: true,
  cadence: 'weekly',
  dueWeekday: 5,
  timeZone: 'Asia/Taipei',
  managers: true,
  groupKey: 'team-leads',
  remindDaysBefore: 1,
  ...body,
});

const update = (body: Record<string, unknown> = {}) => ({
  status: 'on_track',
  summary: 'Going to plan.',
  done: '- Finished the design',
  next: '- Build it',
  ...body,
});

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  for (const u of ['pm', 'alice', 'bob', 'viewer', 'pmo', 'lead'] as const) ids[u] = await mkUser(u);
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('projects-manager'), userId: ids.pm },
    { roleId: await roleId('projects-pmo'), userId: ids.pmo },
  ]);
  const [g] = await h.kernel.db.insert(groups).values({ key: 'team-leads', name: 'Team leads' }).returning();
  await h.kernel.db.insert(groupMembers).values([
    { groupId: g!.id, userId: ids.alice },
    { groupId: g!.id, userId: ids.lead },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'pm', 'alice', 'bob', 'viewer', 'pmo', 'lead', 'outsider'])
    s[u] = await h.login(u);
  await activeProject('STA');
  await activeProject('STB');
  await activeProject('PRV', { visibility: 'private' });
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('the reporting schedule', () => {
  it('starts switched off, and only the PMO changes it', async () => {
    const res = await h.call(s.alice!, 'GET', `${API}/reporting/schedule`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, cadence: 'weekly', dueWeekday: 5, canManage: false });
    expect(res.body.current.key).toMatch(/^\d{4}-W\d{2}$/);
    expect((await h.call(s.pm!, 'PUT', `${API}/reporting/schedule`, schedule())).status).toBe(403);
  });

  it('refuses a schedule nobody reports on, or naming a group that does not exist', async () => {
    const none = await h.call(
      s.pmo!,
      'PUT',
      `${API}/reporting/schedule`,
      schedule({ managers: false, groupKey: null }),
    );
    expect(none.status).toBe(400);
    const unknown = await h.call(s.pmo!, 'PUT', `${API}/reporting/schedule`, schedule({ groupKey: 'nope' }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details.issues[0].path).toBe('groupKey');
  });

  it('opens the updates people owe: managers, and the group on projects they work on', async () => {
    const res = await h.call(s.pmo!, 'PUT', `${API}/reporting/schedule`, schedule());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      group: { key: 'team-leads', name: 'Team leads' },
      canManage: true,
    });
    const [audit] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'projects.status-schedule.updated'));
    expect(audit).toBeDefined();
    await runJob('status-updates');
    const owed = await h.kernel.db.select().from(statusUpdates).where(eq(statusUpdates.state, 'pending'));
    const pairs = owed
      .map((u) => `${u.authorId === ids.pm ? 'pm' : u.authorId === ids.alice ? 'alice' : '?'}`)
      .sort();
    // pm manages and alice (team lead, member) works on STA, STB and PRV; bob isn't in the group, viewer never, lead
    // works on no project.
    expect(pairs).toEqual(['alice', 'alice', 'alice', 'pm', 'pm', 'pm']);
    // Running again opens nothing new.
    await runJob('status-updates');
    expect(
      await h.kernel.db.select().from(statusUpdates).where(eq(statusUpdates.state, 'pending')),
    ).toHaveLength(6);
  });

  it('puts owed updates on My work, for that person only', async () => {
    const work = (await h.call(s.alice!, 'GET', '/api/v1/me/work')).body as LooseJson;
    const section = work.sections.find((x: LooseJson) => x.source === 'projects.status-updates');
    expect(section.count).toBe(3);
    expect(section.items[0].href).toMatch(/^\/projects\/(STA|STB|PRV)\?view=updates&compose=1$/);
    const bobWork = (await h.call(s.bob!, 'GET', '/api/v1/me/work')).body as LooseJson;
    expect(bobWork.sections.find((x: LooseJson) => x.source === 'projects.status-updates')?.count ?? 0).toBe(
      0,
    );
  });
});

describe('status updates', () => {
  it("lets members post; a member's at-risk update tells the managers without touching health", async () => {
    const res = await h.call(
      s.alice!,
      'POST',
      `${API}/projects/STA/status-updates`,
      update({ status: 'at_risk' }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      state: 'submitted',
      standing: 'submitted',
      expected: true,
      byManager: false,
    });
    expect(res.body.signals).toMatchObject({ openTasks: 0, overdueTasks: 0 });
    const project = (await h.call(s.pm!, 'GET', `${API}/projects/STA`)).body;
    expect(project.health).toBe('on_track');
    const flagged = await eventually(
      () => notificationsOf(ids.pm, 'projects.status-update.flagged'),
      (n) => n.length > 0,
    );
    expect(flagged).toHaveLength(1);
    // The owed update is no longer on My work.
    const work = (await h.call(s.alice!, 'GET', '/api/v1/me/work')).body as LooseJson;
    expect(work.sections.find((x: LooseJson) => x.source === 'projects.status-updates').count).toBe(2);
  });

  it("sets the project's health from a manager's update", async () => {
    const res = await h.call(
      s.pm!,
      'POST',
      `${API}/projects/STA/status-updates`,
      update({
        status: 'off_track',
        summary: 'Vendor slipped two weeks.',
        forecastDate: addDays(todayIn('Asia/Taipei'), 90),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.byManager).toBe(true);
    const project = (await h.call(s.pm!, 'GET', `${API}/projects/STA`)).body;
    expect(project).toMatchObject({ health: 'off_track', healthNote: 'Vendor slipped two weeks.' });
  });

  it('refuses a second update, viewers, people outside Projects and empty summaries', async () => {
    const again = await h.call(s.alice!, 'POST', `${API}/projects/STA/status-updates`, update());
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('already_sent');
    expect((await h.call(s.viewer!, 'POST', `${API}/projects/STA/status-updates`, update())).status).toBe(
      403,
    );
    expect((await h.call(s.outsider!, 'POST', `${API}/projects/STA/status-updates`, update())).status).toBe(
      403,
    );
    expect(
      (await h.call(s.bob!, 'POST', `${API}/projects/STA/status-updates`, update({ summary: ' ' }))).status,
    ).toBe(400);
  });

  it('lets the author change their update while the period is open, and nobody else', async () => {
    const tab = (await h.call(s.alice!, 'GET', `${API}/projects/STA/status-updates`)).body;
    expect(tab.mine.state).toBe('submitted');
    expect(tab.canPost).toBe(false);
    const edited = await h.call(s.alice!, 'PATCH', `${API}/status-updates/${tab.mine.id}`, {
      blockers: '- Waiting for parts',
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ blockers: '- Waiting for parts', summary: 'Going to plan.' });
    expect(edited.body.editedAt).not.toBeNull();
    expect(
      (await h.call(s.pm!, 'PATCH', `${API}/status-updates/${tab.mine.id}`, { summary: 'x' })).status,
    ).toBe(403);
    await h.kernel.db
      .update(statusUpdates)
      .set({ closesAt: new Date(Date.now() - 1_000) })
      .where(eq(statusUpdates.id, tab.mine.id));
    const closed = await h.call(s.alice!, 'PATCH', `${API}/status-updates/${tab.mine.id}`, {
      summary: 'Late edit',
    });
    expect(closed.status).toBe(409);
    expect(closed.body.error.details.reason).toBe('period_closed');
    await h.kernel.db
      .update(statusUpdates)
      .set({ closesAt: new Date(Date.now() + 86_400_000) })
      .where(eq(statusUpdates.id, tab.mine.id));
  });

  it('drafts an update from the period (builtin without a model), storing nothing', async () => {
    const task = await h.call(s.pm!, 'POST', `${API}/projects/STB/tasks`, {
      title: 'Overdue work',
      assigneeId: ids.bob,
      dueDate: addDays(todayIn('Asia/Taipei'), -3),
    });
    expect(task.status).toBe(201);
    const before = await h.kernel.db.select({ n: sql<number>`count(*)::int` }).from(statusUpdates);
    const res = await h.call(s.bob!, 'POST', `${API}/projects/STB/status-updates/draft`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.mode).toBe('builtin');
    expect(res.body.draft.blockers).toContain(task.body.reference);
    expect(res.body.sources.overdue.map((t: LooseJson) => t.reference)).toEqual([task.body.reference]);
    const after = await h.kernel.db.select({ n: sql<number>`count(*)::int` }).from(statusUpdates);
    expect(after[0]!.n).toBe(before[0]!.n);
    expect((await h.call(s.viewer!, 'POST', `${API}/projects/STB/status-updates/draft`)).status).toBe(403);
  });
});

describe('reminders', () => {
  it('reminds the reporter once when overdue, and tells the managers who is missing', async () => {
    await h.kernel.db
      .update(statusUpdates)
      .set({ dueAt: new Date(Date.now() - 60_000) })
      .where(and(eq(statusUpdates.state, 'pending'), eq(statusUpdates.authorId, ids.alice)));
    const first = (await runJob('status-updates')) as { overdue: number };
    expect(first.overdue).toBe(2);
    expect(await notificationsOf(ids.alice, 'projects.status-update.overdue')).toHaveLength(2);
    const missing = await notificationsOf(ids.pm, 'projects.status-update.missing');
    expect(missing.length).toBeGreaterThanOrEqual(2);
    const again = (await runJob('status-updates')) as { overdue: number };
    expect(again.overdue).toBe(0);
    expect(await notificationsOf(ids.alice, 'projects.status-update.overdue')).toHaveLength(2);
  });
});

describe('the status report', () => {
  it('shows each reader the projects they may see, with measured states', async () => {
    const res = await h.call(s.bob!, 'GET', `${API}/status-report`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const keys = (res.body.projects as LooseJson[]).map((p) => p.key).sort();
    expect(keys).toEqual(['PRV', 'STA', 'STB']);
    const sta = res.body.projects.find((p: LooseJson) => p.key === 'STA');
    // The manager's update says off track, and the expected finish is after the target date.
    expect(sta.state).toBe('delayed');
    expect(sta.reported).toBe('off_track');
    expect(sta.reasons.map((r: LooseJson) => r.code)).toEqual(['reported_off_track', 'slip']);
    expect(res.body.template.key).toBe('executive');
    expect(res.body.narrative).toMatchObject({ state: 'ready', mode: 'builtin' });
    expect(res.body.narrative.summary).toContain('STA');
    // Private projects stay with their members.
    const outside = await h.call(s.lead!, 'GET', `${API}/status-report`);
    expect(outside.status).toBe(200);
    expect((outside.body.projects as LooseJson[]).map((p) => p.key)).not.toContain('PRV');
  });

  it('honours the template, scope and period, and refuses what makes no sense', async () => {
    const detailed = await h.call(s.pmo!, 'GET', `${API}/status-report?template=detailed&scope=mine`);
    expect(detailed.status).toBe(200);
    expect(detailed.body.template.key).toBe('detailed');
    expect(detailed.body.projects).toEqual([]);
    expect((await h.call(s.pmo!, 'GET', `${API}/status-report?scope=department`)).status).toBe(400);
    const previous = await h.call(s.pm!, 'GET', `${API}/status-report?period=${detailed.body.previousKey}`);
    expect(previous.status).toBe(200);
    expect(previous.body.current).toBe(false);
    expect((await h.call(s.pm!, 'GET', `${API}/status-report?period=2099-W01`)).status).toBe(400);
    expect((await h.call(s.pm!, 'GET', `${API}/status-report?period=garbage`)).status).toBe(400);
  });

  it('exports Markdown in the reader’s language', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${API}/status-report/export?template=detailed`,
      headers: { cookie: s.pm!.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="status-report-/);
    expect(res.body).toContain('# Detailed status');
    expect(res.body).toContain('### STA Project STA — Delayed');
  });

  it('keeps nothing per reader without a model (narratives are only stored for AI text)', async () => {
    expect(await h.kernel.db.select().from(reportNarratives)).toHaveLength(0);
  });
});

describe('who sent their update', () => {
  it('lists the period for the PMO, with counts per standing', async () => {
    const res = await h.call(s.pmo!, 'GET', `${API}/status-updates`);
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ submitted: 2, overdue: 2 });
    expect(res.body.items.length).toBe(res.body.total);
    const overdue = await h.call(s.pmo!, 'GET', `${API}/status-updates?standing=overdue`);
    expect(overdue.body.items.every((u: LooseJson) => u.standing === 'overdue')).toBe(true);
    expect((await h.call(s.alice!, 'GET', `${API}/status-updates`)).status).toBe(403);
  });
});

describe('report templates', () => {
  const tpl = {
    key: 'board',
    name: { en: 'Board report', 'zh-TW': '董事會報告', 'ja-JP': '取締役会向け' },
    sections: [
      { id: 'summary', type: 'summary', instructions: 'Lead with risks.' },
      { id: 'late', type: 'projects', states: ['delayed'], detail: 'table' },
    ],
  };

  it('lets the PMO create, change and archive templates', async () => {
    expect((await h.call(s.pm!, 'POST', `${API}/report-templates`, tpl)).status).toBe(403);
    const created = await h.call(s.pmo!, 'POST', `${API}/report-templates`, tpl);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await h.call(s.pmo!, 'POST', `${API}/report-templates`, tpl)).status).toBe(400);
    const renamed = await h.call(s.pmo!, 'PUT', `${API}/report-templates/${created.body.id}`, {
      ...tpl,
      key: 'other',
    });
    expect(renamed.status).toBe(400);
    const dupSections = await h.call(s.pmo!, 'PUT', `${API}/report-templates/board`, {
      ...tpl,
      sections: [tpl.sections[0], tpl.sections[0]],
    });
    expect(dupSections.status).toBe(400);
    const report = await h.call(s.pm!, 'GET', `${API}/status-report?template=board`);
    expect(report.body.template.sections.map((x: LooseJson) => x.type)).toEqual(['summary', 'projects']);
    expect((await h.call(s.pmo!, 'POST', `${API}/report-templates/board/archive`)).body.archived).toBe(true);
    // An archived template falls back to the first one.
    expect((await h.call(s.pm!, 'GET', `${API}/status-report?template=board`)).body.template.key).toBe(
      'executive',
    );
    expect((await h.call(s.pmo!, 'POST', `${API}/report-templates/board/restore`)).body.archived).toBe(false);
  });
});

describe('customisation kinds', () => {
  const cz = () => h.kernel.customizations;
  class Rollback extends Error {}

  it('round-trips the schedule and changes it through a change set', async () => {
    const pmo = await authOf(ids.pmo);
    const current = await cz().get('projects.status-schedule', 'default', pmo);
    expect(current!.value).toMatchObject({ enabled: true, groupKey: 'team-leads' });
    const same = await h.kernel.db.transaction((tx) =>
      cz().apply(
        'projects.status-schedule',
        { op: 'update', id: 'default', value: current!.value },
        { auth: pmo, tx: tx as unknown as Db },
      ),
    );
    expect(same.after!.version).toBe(current!.version);
    const check = await cz().validate(
      'projects.status-schedule',
      { op: 'update', id: 'default', value: { ...(current!.value as object), groupKey: 'ghosts' } },
      pmo,
    );
    expect(check.issues.map((i) => i.code)).toContain('unknown_group');
  });

  it('creates templates in a dry run that leaves nothing behind', async () => {
    const pmo = await authOf(ids.pmo);
    const value = {
      key: 'dry-run',
      name: { en: 'Dry run' },
      sections: [{ id: 'counts', type: 'counts' }],
    };
    await h.kernel.db
      .transaction(async (tx) => {
        await cz().apply(
          'projects.report-template',
          { op: 'create', id: null, value },
          { auth: pmo, tx: tx as unknown as Db, dryRun: true },
        );
        throw new Rollback();
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });
    expect((await h.call(s.pmo!, 'GET', `${API}/report-templates/dry-run`)).status).toBe(400);
    const created = await h.kernel.db.transaction((tx) =>
      cz().apply(
        'projects.report-template',
        { op: 'create', id: null, value },
        { auth: pmo, tx: tx as unknown as Db },
      ),
    );
    await h.kernel.db.transaction((tx) =>
      cz().apply(
        'projects.report-template',
        { op: 'archive', id: created.id, value: null },
        { auth: pmo, tx: tx as unknown as Db },
      ),
    );
    const listed = await cz().list('projects.report-template', { limit: 20, includeArchived: true }, pmo);
    expect(listed.find((x) => x.id === created.id)?.archived).toBe(true);
  });
});

describe('delivery and the group the schedule names', () => {
  it('tells the recipients the report is ready (task type)', async () => {
    const task: TaskContext = {
      runId: 'run-1',
      jobId: 'job-1',
      attempt: 1,
      scheduledFor: new Date(),
      timeZone: 'Asia/Taipei',
      lastSuccessAt: null,
      signal: new AbortController().signal,
      log: () => undefined,
    };
    const outcome = await ctx().taskTypes.run(
      'projects.status-report',
      { template: 'executive', groupKeys: ['team-leads'], userIds: [ids.pm] },
      task,
    );
    expect(outcome).toMatchObject({
      summary: 'projects.taskTypes.statusReport.result',
      summaryParams: { count: 3 },
    });
    expect(outcome.href).toMatch(/^\/projects\/status-report\?period=/);
    for (const who of [ids.alice, ids.lead, ids.pm])
      expect(await notificationsOf(who, 'projects.status-report.ready')).toHaveLength(1);
  });

  it('keeps the reporters’ group from being deleted while the schedule is on', async () => {
    const [g] = await h.kernel.db.select().from(groups).where(eq(groups.key, 'team-leads'));
    const res = await h.call(s.admin!, 'DELETE', `/api/v1/groups/${g!.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });
});

describe('AI tools', () => {
  it('reads the report and posts an update as the caller', async () => {
    const tools = ctx().ai.tools;
    const report = await tools.invoke<LooseJson>(
      'projects.status_report',
      {},
      { auth: await authOf(ids.pm) },
    );
    expect(report.projects.find((p: LooseJson) => p.key === 'STA').state).toBe('delayed');
    expect(report.projects.find((p: LooseJson) => p.key === 'STA').reasons[0]).toBe('Reported off track');
    const posted = await tools.invoke<LooseJson>(
      'projects.post_status_update',
      { project: 'STB', status: 'at_risk', summary: 'Overdue work is piling up.' },
      { auth: await authOf(ids.pm) },
    );
    expect(posted).toMatchObject({ project: 'STB', status: 'at_risk', setsHealth: true });
    expect((await h.call(s.pm!, 'GET', `${API}/projects/STB`)).body.health).toBe('at_risk');
  });

  it('turning the schedule off removes unsent updates of the open period and keeps sent ones', async () => {
    const res = await h.call(s.pmo!, 'PUT', `${API}/reporting/schedule`, schedule({ enabled: false }));
    expect(res.status).toBe(200);
    await runJob('status-updates');
    const rows = await h.kernel.db.select().from(statusUpdates);
    expect(rows.filter((r) => r.state === 'pending' && r.closesAt > new Date())).toHaveLength(0);
    expect(rows.filter((r) => r.state === 'submitted').length).toBeGreaterThanOrEqual(3);
    const [row] = await h.kernel.db.select().from(statusSchedule);
    expect(row!.enabled).toBe(false);
  });
});
