import {
  approvalTasks,
  auditLogs,
  notifications,
  outboxEvents,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { members, projects, taskActivity, tasks } from '@isbp/module-projects/schema';
import { addDays, todayIn, weekStart } from '@isbp/module-projects/model';
import type { AuthContext, JobRun } from '@isbp/sdk/server';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { toSessionUser } from '../../src/kernel/sessions';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'boss' | 'pm' | 'alice' | 'bob' | 'viewer' | 'carol' | 'pmo', string>;

const API = '/api/v1/projects';
const ctx = () => h.kernel.registry.context('projects');

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

async function mkUser(username: string, managerId: string | null = null) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: `${username[0]!.toUpperCase()}${username.slice(1)}`,
      passwordHash: await hashPassword(PASSWORD),
      managerId,
      timezone: 'Asia/Taipei',
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

async function authOf(userId: string): Promise<AuthContext> {
  const [u] = await h.kernel.db.select().from(users).where(eq(users.id, userId));
  return buildAuthContext(
    { type: 'user', id: userId, name: u!.displayName },
    toSessionUser(u!),
    null,
    await h.kernel.rbac.permissionsFor(userId),
  );
}

const notificationsOf = (userId: string, type: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

const today = () => todayIn('Asia/Taipei');

async function newProject(who: string, body: Record<string, unknown>) {
  const res = await h.call(s[who]!, 'POST', `${API}/projects`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as LooseJson;
}

async function newTask(who: string, key: string, body: Record<string, unknown>) {
  const res = await h.call(s[who]!, 'POST', `${API}/projects/${key}/tasks`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as LooseJson;
}

/** Starts a small (auto-approved) project with members. */
async function activeProject(key: string, extra: Record<string, unknown> = {}) {
  await newProject('pm', { name: `Project ${key}`, key, budgetHours: 40, ...extra });
  const started = await h.call(s.pm!, 'POST', `${API}/projects/${key}/start`);
  expect(started.body.status).toBe('active');
  for (const [user, role, allocationPct] of [
    ['alice', 'member', 50],
    ['bob', 'member', 100],
    ['viewer', 'viewer', 0],
  ] as const) {
    const res = await h.call(s.pm!, 'POST', `${API}/projects/${key}/members`, {
      userId: ids[user],
      role,
      allocationPct,
    });
    expect(res.status).toBe(201);
  }
}

async function board(who: string, key: string, query = '') {
  const res = await h.call(s[who]!, 'GET', `${API}/projects/${key}/board${query}`);
  expect(res.status).toBe(200);
  const col = (status: string) =>
    (res.body.columns as LooseJson[])
      .find((c) => c.status === status)!
      .tasks.map((t: LooseJson) => t.reference);
  return { body: res.body, col };
}

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  ids.boss = await mkUser('boss');
  ids.pm = await mkUser('pm', ids.boss);
  ids.alice = await mkUser('alice', ids.boss);
  ids.bob = await mkUser('bob');
  ids.viewer = await mkUser('viewer');
  ids.carol = await mkUser('carol');
  ids.pmo = await mkUser('pmo');
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('projects-manager'), userId: ids.pm },
    { roleId: await roleId('projects-pmo'), userId: ids.pmo },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'boss', 'pm', 'alice', 'bob', 'viewer', 'carol', 'pmo', 'outsider'])
    s[u] = await h.login(u);
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('projects', () => {
  it('creates projects with a unique key and makes the creator a manager', async () => {
    const created = await newProject('pm', {
      name: 'Data center move',
      key: 'dcm',
      description: '## Scope\nMove racks',
      startDate: '2026-11-02',
      targetDate: '2027-01-29',
      budgetHours: 120,
    });
    expect(created).toMatchObject({
      key: 'DCM',
      status: 'proposed',
      health: 'on_track',
      visibility: 'internal',
      owner: { id: ids.pm },
      myRole: 'manager',
      viewer: { canManage: true, canStart: true, canDelete: true },
    });
    expect(created.members).toEqual([
      expect.objectContaining({ userId: ids.pm, role: 'manager', isOwner: true }),
    ]);

    const dup = await h.call(s.pm!, 'POST', `${API}/projects`, { name: 'Other', key: 'DCM' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    const bad = await h.call(s.pm!, 'POST', `${API}/projects`, { name: 'Bad', key: '1X' });
    expect(bad.status).toBe(400);
    const dates = await h.call(s.pm!, 'POST', `${API}/projects`, {
      name: 'Backwards',
      key: 'BWD',
      startDate: '2026-12-01',
      targetDate: '2026-11-01',
    });
    expect(dates.body.error.code).toBe('VALIDATION_FAILED');

    // Without projects.projects.create.
    expect((await h.call(s.alice!, 'POST', `${API}/projects`, { name: 'Nope', key: 'NOPE' })).status).toBe(
      403,
    );
    expect((await h.call(null, 'GET', `${API}/projects`)).status).toBe(401);

    const renamed = await h.call(s.pm!, 'PATCH', `${API}/projects/DCM`, {
      name: 'Data centre move',
      key: 'DCX',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ key: 'DCX', name: 'Data centre move' });
    await newTask('pm', 'DCX', { title: 'Inventory racks' });
    const locked = await h.call(s.pm!, 'PATCH', `${API}/projects/DCX`, { key: 'DCY' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('INVALID_STATE');

    const list = await h.call(s.pm!, 'GET', `${API}/projects?mine=true`);
    expect(list.body.items.map((p: LooseJson) => p.key)).toContain('DCX');
    expect(list.body.items.find((p: LooseJson) => p.key === 'DCX')).toMatchObject({
      totalTasks: 1,
      doneTasks: 0,
      progress: 0,
      memberCount: 1,
      taskCounts: { todo: 1 },
    });
    const audit = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'projects.project.created'));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('auto-approves small proposals and asks the owner’s manager for large ones', async () => {
    await newProject('pm', { name: 'Small one', key: 'SML', budgetHours: 120 });
    const small = await h.call(s.pm!, 'POST', `${API}/projects/SML/start`);
    expect(small.status).toBe(200);
    expect(small.body).toMatchObject({ status: 'active', approval: { status: 'approved' } });
    expect((await h.call(s.pm!, 'POST', `${API}/projects/SML/start`)).body.error.code).toBe(
      'INVALID_TRANSITION',
    );

    await newProject('pm', { name: 'Large one', key: 'LRG', budgetHours: 800 });
    const large = await h.call(s.pm!, 'POST', `${API}/projects/LRG/start`);
    expect(large.body).toMatchObject({
      status: 'proposed',
      approval: { status: 'pending' },
      viewer: { canStart: false },
    });
    const instanceId = large.body.approval.instanceId as string;
    const [task] = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));
    expect(task?.assigneeId).toBe(ids.boss);
    const approved = await h.call(s.boss!, 'POST', `/api/v1/approvals/${task!.id}/approve`, {
      comment: 'Go',
    });
    expect(approved.status).toBe(200);
    const active = await eventually(
      () => h.call(s.pm!, 'GET', `${API}/projects/LRG`),
      (r) => r.body.status === 'active',
    );
    expect(active.body).toMatchObject({ status: 'active', approval: { status: 'approved' } });
    expect(await notificationsOf(ids.pm, 'projects.proposal.decided')).toHaveLength(1);

    await newProject('pm', { name: 'Too large', key: 'TLG', budgetHours: 2000 });
    const big = await h.call(s.pm!, 'POST', `${API}/projects/TLG/start`);
    const [t2] = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(
        and(eq(approvalTasks.instanceId, big.body.approval.instanceId), eq(approvalTasks.status, 'pending')),
      );
    await h.call(s.boss!, 'POST', `/api/v1/approvals/${t2!.id}/reject`, { comment: 'Not this year' });
    const rejected = await eventually(
      () => h.call(s.pm!, 'GET', `${API}/projects/TLG`),
      (r) => r.body.approval?.status === 'rejected',
    );
    expect(rejected.body).toMatchObject({
      status: 'proposed',
      approval: { status: 'rejected', comment: 'Not this year' },
      viewer: { canStart: true },
    });
  });

  it('routes proposals on the project custom fields (attributes.<key>)', async () => {
    const admin = s.admin!;
    const field = await h.call(admin, 'POST', '/api/v1/custom-fields', {
      entityType: 'projects.project',
      field: { key: 'regulated', type: 'boolean', label: { en: 'Regulated (SOX)' } },
    });
    expect(field.status, JSON.stringify(field.body)).toBe(201);
    const previous = (
      await h.call(admin, 'GET', '/api/v1/workflows?triggerKey=projects.proposal')
    ).body.items.find((w: LooseJson) => w.isDefault);
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Compliance review',
      triggerKey: 'projects.proposal',
    });
    await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: 'compliance',
            type: 'approval',
            name: { en: 'Compliance review' },
            when: { fact: 'attributes.regulated', op: 'eq', value: true },
            approvers: [{ type: 'user', userId: ids.pmo }],
            mode: 'any',
          },
        ],
      },
    });
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/default`)).status).toBe(200);
    try {
      await newProject('pm', {
        name: 'SOX controls',
        key: 'SOX',
        budgetHours: 40,
        attributes: { regulated: true },
      });
      const regulated = await h.call(s.pm!, 'POST', `${API}/projects/SOX/start`);
      expect(regulated.body).toMatchObject({ status: 'proposed', approval: { status: 'pending' } });
      const [task] = await h.kernel.db
        .select()
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.instanceId, regulated.body.approval.instanceId),
            eq(approvalTasks.status, 'pending'),
          ),
        );
      expect(task?.assigneeId).toBe(ids.pmo);
      await newProject('pm', {
        name: 'Team offsite',
        key: 'OFS',
        budgetHours: 40,
        attributes: { regulated: false },
      });
      const plain = await h.call(s.pm!, 'POST', `${API}/projects/OFS/start`);
      expect(plain.body).toMatchObject({ status: 'active', approval: { status: 'approved' } });
    } finally {
      await h.call(admin, 'POST', `/api/v1/workflows/${previous.id}/default`);
      await h.call(admin, 'POST', `/api/v1/custom-fields/${field.body.id}/archive`);
    }
  });

  it('moves through the status flow and completes only when tasks are closed (or forced)', async () => {
    await activeProject('FLOW');
    const hold = await h.call(s.pm!, 'POST', `${API}/projects/FLOW/status`, { status: 'on_hold' });
    expect(hold.body.status).toBe('on_hold');
    const direct = await h.call(s.pm!, 'POST', `${API}/projects/FLOW/status`, { status: 'completed' });
    expect(direct.body.error.code).toBe('INVALID_TRANSITION');
    await h.call(s.pm!, 'POST', `${API}/projects/FLOW/status`, { status: 'active' });
    await newTask('alice', 'FLOW', { title: 'Open work' });
    const blocked = await h.call(s.pm!, 'POST', `${API}/projects/FLOW/status`, { status: 'completed' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'INVALID_STATE', details: { openTasks: 1 } });
    const noComment = await h.call(s.pm!, 'POST', `${API}/projects/FLOW/status`, {
      status: 'completed',
      force: true,
    });
    expect(noComment.body.error.code).toBe('COMMENT_REQUIRED');
    const forced = await h.call(s.pm!, 'POST', `${API}/projects/FLOW/status`, {
      status: 'completed',
      force: true,
      comment: 'Remaining work moves to the next phase',
    });
    expect(forced.body.status).toBe('completed');
    expect(forced.body.updates[0]).toMatchObject({
      kind: 'status',
      to: 'completed',
      note: 'Remaining work moves to the next phase',
    });

    // Health: members hear about it when it goes at risk.
    await activeProject('HLT');
    const health = await h.call(s.pm!, 'POST', `${API}/projects/HLT/health`, {
      health: 'at_risk',
      note: 'Vendor late',
    });
    expect(health.body).toMatchObject({ health: 'at_risk', healthNote: 'Vendor late' });
    expect(await notificationsOf(ids.alice, 'projects.project.health_changed')).toHaveLength(1);
    expect(await notificationsOf(ids.pm, 'projects.project.health_changed')).toHaveLength(0);
    expect(
      (await h.call(s.alice!, 'POST', `${API}/projects/HLT/health`, { health: 'on_track', note: 'x' }))
        .status,
    ).toBe(403);
  });
});

describe('membership and visibility', () => {
  it('hides private projects from non-members and keeps viewers and outsiders read-only', async () => {
    await activeProject('PRV', { visibility: 'private' });
    const task = await newTask('alice', 'PRV', { title: 'Secret work' });

    expect((await h.call(s.carol!, 'GET', `${API}/projects/PRV`)).status).toBe(404);
    expect((await h.call(s.carol!, 'GET', `${API}/tasks/${task.reference}`)).status).toBe(404);
    const carolList = await h.call(s.carol!, 'GET', `${API}/projects?pageSize=200`);
    expect(carolList.body.items.map((p: LooseJson) => p.key)).not.toContain('PRV');
    expect((await h.call(s.pmo!, 'GET', `${API}/projects/PRV`)).status).toBe(200);
    expect((await h.call(s.admin!, 'GET', `${API}/projects/PRV`)).status).toBe(200);

    const asViewer = await h.call(s.viewer!, 'GET', `${API}/projects/PRV`);
    expect(asViewer.body.viewer).toMatchObject({
      role: 'viewer',
      canManage: false,
      canEditTasks: false,
      canComment: true,
    });
    expect((await h.call(s.viewer!, 'PATCH', `${API}/tasks/${task.reference}`, { title: 'x' })).status).toBe(
      403,
    );
    expect((await h.call(s.viewer!, 'POST', `${API}/projects/PRV/tasks`, { title: 'x' })).status).toBe(403);
    expect(
      (await h.call(s.viewer!, 'POST', `${API}/tasks/${task.reference}/comments`, { body: 'Looks good' }))
        .status,
    ).toBe(201);
    expect((await h.call(s.alice!, 'PATCH', `${API}/projects/PRV`, { name: 'x' })).status).toBe(403);

    // An internal project: everyone with projects.projects.use reads it, non-members can't change anything.
    await activeProject('INT');
    const internalTask = await newTask('bob', 'INT', { title: 'Visible work' });
    const asCarol = await h.call(s.carol!, 'GET', `${API}/projects/INT`);
    expect(asCarol.status).toBe(200);
    expect(asCarol.body.viewer).toMatchObject({ role: null, canEditTasks: false, canComment: false });
    expect(
      (await h.call(s.carol!, 'GET', `${API}/tasks/${internalTask.reference}`)).body.viewer,
    ).toMatchObject({
      canEdit: false,
      canComment: false,
    });
    expect((await h.call(s.carol!, 'POST', `${API}/projects/INT/tasks`, { title: 'x' })).status).toBe(403);
    expect(
      (await h.call(s.carol!, 'POST', `${API}/tasks/${internalTask.reference}/comments`, { body: 'x' }))
        .status,
    ).toBe(403);

    // Assignees must be members who work on the project.
    const notMember = await h.call(s.pm!, 'PATCH', `${API}/tasks/${internalTask.reference}`, {
      assigneeId: ids.carol,
    });
    expect(notMember.body.error.code).toBe('VALIDATION_FAILED');
    const viewerAssignee = await h.call(s.pm!, 'PATCH', `${API}/tasks/${internalTask.reference}`, {
      assigneeId: ids.viewer,
    });
    expect(viewerAssignee.body.error.code).toBe('VALIDATION_FAILED');

    // The owner stays a manager; removing a member unassigns their open tasks.
    const demote = await h.call(s.pm!, 'PATCH', `${API}/projects/INT/members/${ids.pm}`, { role: 'member' });
    expect(demote.body.error.code).toBe('INVALID_STATE');
    await h.call(s.pm!, 'PATCH', `${API}/tasks/${internalTask.reference}`, { assigneeId: ids.bob });
    expect((await h.call(s.pm!, 'DELETE', `${API}/projects/INT/members/${ids.bob}`)).status).toBe(204);
    expect((await h.call(s.pm!, 'GET', `${API}/tasks/${internalTask.reference}`)).body.assignee).toBeNull();
  });
});

describe('tasks', () => {
  it('numbers concurrent creates without gaps or duplicates', async () => {
    await activeProject('NUM');
    const created = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        h.call(s.alice!, 'POST', `${API}/projects/NUM/tasks`, { title: `Task ${i}` }),
      ),
    );
    expect(created.every((r) => r.status === 201)).toBe(true);
    const numbers = created.map((r) => r.body.number as number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(created.map((r) => r.body.reference)).size).toBe(10);
  });

  it('validates dates, ranks moves on the board and stamps completion', async () => {
    await activeProject('MOV');
    const bad = await h.call(s.alice!, 'POST', `${API}/projects/MOV/tasks`, {
      title: 'Backwards',
      startDate: '2026-11-10',
      dueDate: '2026-11-01',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: 'dueDate' }] },
    });

    const a = await newTask('alice', 'MOV', { title: 'A' });
    const b = await newTask('alice', 'MOV', { title: 'B' });
    const c = await newTask('alice', 'MOV', { title: 'C' });
    // Quick-add puts new tasks on top.
    expect((await board('alice', 'MOV')).col('todo')).toEqual([c.reference, b.reference, a.reference]);

    const moved = await h.call(s.alice!, 'POST', `${API}/tasks/${a.reference}/move`, {
      status: 'todo',
      before: c.reference,
    });
    expect(moved.status).toBe(200);
    expect((await board('alice', 'MOV')).col('todo')).toEqual([a.reference, c.reference, b.reference]);
    await h.call(s.alice!, 'POST', `${API}/tasks/${b.reference}/move`, {
      status: 'todo',
      after: a.reference,
    });
    expect((await board('alice', 'MOV')).col('todo')).toEqual([a.reference, b.reference, c.reference]);

    // Repeated inserts at the same spot keep a strict order.
    for (let i = 0; i < 25; i++) {
      const top = (await board('alice', 'MOV')).col('todo');
      const mover = i % 2 ? a.reference : b.reference;
      const other = top.filter((r: string) => r !== mover);
      await h.call(s.alice!, 'POST', `${API}/tasks/${mover}/move`, {
        status: 'todo',
        after: other[0],
        before: other[1],
      });
    }
    const after = (await board('alice', 'MOV')).body.columns.find(
      (x: LooseJson) => x.status === 'todo',
    ).tasks;
    const ranks = after.map((t: LooseJson) => t.rank);
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ranks).size).toBe(ranks.length);

    const toDone = await h.call(s.alice!, 'POST', `${API}/tasks/${c.reference}/move`, { status: 'done' });
    expect(toDone.body.status).toBe('done');
    const doneTask = await h.call(s.alice!, 'GET', `${API}/tasks/${c.reference}`);
    expect(doneTask.body.completedAt).toBeTruthy();
    expect((await board('alice', 'MOV')).col('done')).toEqual([c.reference]);
    await h.call(s.alice!, 'PATCH', `${API}/tasks/${c.reference}`, { status: 'in_review' });
    expect((await h.call(s.alice!, 'GET', `${API}/tasks/${c.reference}`)).body.completedAt).toBeNull();

    const activity = await h.call(s.alice!, 'GET', `${API}/tasks/${c.reference}/activity`);
    expect(activity.body.items.map((x: LooseJson) => x.kind)).toEqual(['created', 'status', 'status']);
    expect(activity.body.items[2]).toMatchObject({ from: 'done', to: 'in_review', actor: { id: ids.alice } });

    // Managers delete; members can't.
    expect((await h.call(s.alice!, 'DELETE', `${API}/tasks/${b.reference}`)).status).toBe(403);
    expect((await h.call(s.pm!, 'DELETE', `${API}/tasks/${b.reference}`)).status).toBe(204);
    expect((await h.call(s.pm!, 'GET', `${API}/tasks/${b.reference}`)).status).toBe(404);
  });

  it('refuses dependency loops and starting a blocked task', async () => {
    await activeProject('DEP');
    const a = await newTask('alice', 'DEP', { title: 'Design' });
    const b = await newTask('alice', 'DEP', { title: 'Build' });
    const c = await newTask('alice', 'DEP', { title: 'Test' });
    expect(
      (await h.call(s.alice!, 'POST', `${API}/tasks/${b.reference}/dependencies`, { dependsOn: a.reference }))
        .status,
    ).toBe(201);
    await h.call(s.alice!, 'POST', `${API}/tasks/${c.reference}/dependencies`, { dependsOn: b.reference });
    const loop = await h.call(s.alice!, 'POST', `${API}/tasks/${a.reference}/dependencies`, {
      dependsOn: c.reference,
    });
    expect(loop.status).toBe(409);
    expect(loop.body.error).toMatchObject({ code: 'RELATIONSHIP_INVALID', details: { reason: 'cycle' } });
    const self = await h.call(s.alice!, 'POST', `${API}/tasks/${a.reference}/dependencies`, {
      dependsOn: a.reference,
    });
    expect(self.body.error.details.reason).toBe('self');
    const dup = await h.call(s.alice!, 'POST', `${API}/tasks/${b.reference}/dependencies`, {
      dependsOn: a.reference,
    });
    expect(dup.body.error.details.reason).toBe('duplicate');

    const blocked = await h.call(s.alice!, 'POST', `${API}/tasks/${b.reference}/move`, {
      status: 'in_progress',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({
      code: 'INVALID_STATE',
      details: { reason: 'blocked', blockedBy: [{ reference: a.reference, status: 'todo' }] },
    });
    expect(
      (await h.call(s.alice!, 'PATCH', `${API}/tasks/${b.reference}`, { status: 'in_progress' })).status,
    ).toBe(409);
    expect(
      (await board('alice', 'DEP')).body.columns.find((x: LooseJson) => x.status === 'todo').tasks,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ reference: b.reference, blocked: true })]));

    await h.call(s.alice!, 'PATCH', `${API}/tasks/${a.reference}`, { status: 'done' });
    const started = await h.call(s.alice!, 'POST', `${API}/tasks/${b.reference}/move`, {
      status: 'in_progress',
    });
    expect(started.body.status).toBe('in_progress');
    const detail = await h.call(s.alice!, 'GET', `${API}/tasks/${b.reference}`);
    expect(detail.body.blockedBy.map((x: LooseJson) => x.reference)).toEqual([a.reference]);
    expect(detail.body.blocking.map((x: LooseJson) => x.reference)).toEqual([c.reference]);

    const timeline = await h.call(s.alice!, 'GET', `${API}/projects/DEP/timeline`);
    expect(timeline.body.unscheduled).toHaveLength(3);
    expect(timeline.body.dependencies).toHaveLength(2);

    const removed = await h.call(
      s.alice!,
      'DELETE',
      `${API}/tasks/${c.reference}/dependencies/${b.reference}`,
    );
    expect(removed.body.blockedBy).toEqual([]);

    // Parents: no loops either.
    await h.call(s.alice!, 'PATCH', `${API}/tasks/${b.reference}`, { parentId: a.id });
    const parentLoop = await h.call(s.alice!, 'PATCH', `${API}/tasks/${a.reference}`, { parentId: b.id });
    expect(parentLoop.body.error.code).toBe('INVALID_PARENT');
  });

  it('notifies assignees and commenters but never the person acting', async () => {
    await activeProject('NTF');
    const count = async (userId: string, type: string) => (await notificationsOf(userId, type)).length;
    const bobAssigned = await count(ids.bob, 'projects.task.assigned');
    const t = await newTask('pm', 'NTF', { title: 'Order cables', assigneeId: ids.bob });
    expect(await count(ids.bob, 'projects.task.assigned')).toBe(bobAssigned + 1);
    const n = (await notificationsOf(ids.bob, 'projects.task.assigned')).find((x) =>
      x.href?.endsWith(t.reference),
    );
    expect(n).toMatchObject({
      title: `${t.reference} is assigned to you: Order cables`,
      href: `/projects/tasks/${t.reference}`,
    });
    const aliceAssigned = await count(ids.alice, 'projects.task.assigned');
    await newTask('alice', 'NTF', { title: 'Self-assigned', assigneeId: ids.alice });
    expect(await count(ids.alice, 'projects.task.assigned')).toBe(aliceAssigned);

    const before = {
      bob: await count(ids.bob, 'projects.task.commented'),
      pm: await count(ids.pm, 'projects.task.commented'),
      alice: await count(ids.alice, 'projects.task.commented'),
    };
    const comment = await h.call(s.alice!, 'POST', `${API}/tasks/${t.reference}/comments`, {
      body: 'Ordered **48** cables',
    });
    expect(comment.status).toBe(201);
    expect(comment.body).toMatchObject({ canEdit: true, canDelete: true, author: { id: ids.alice } });
    expect(await count(ids.bob, 'projects.task.commented')).toBe(before.bob + 1);
    expect(await count(ids.pm, 'projects.task.commented')).toBe(before.pm + 1);
    expect(await count(ids.alice, 'projects.task.commented')).toBe(before.alice);

    expect(
      (await h.call(s.bob!, 'PATCH', `${API}/comments/${comment.body.id}`, { body: 'hijack' })).status,
    ).toBe(403);
    const edited = await h.call(s.alice!, 'PATCH', `${API}/comments/${comment.body.id}`, {
      body: 'Ordered 50 cables',
    });
    expect(edited.body).toMatchObject({ body: 'Ordered 50 cables', editedAt: expect.any(String) });
    const list = await h.call(s.bob!, 'GET', `${API}/tasks/${t.reference}/comments`);
    expect(list.body.items[0]).toMatchObject({ canEdit: false, canDelete: false });
    expect((await h.call(s.bob!, 'DELETE', `${API}/comments/${comment.body.id}`)).status).toBe(403);
    expect((await h.call(s.pm!, 'DELETE', `${API}/comments/${comment.body.id}`)).status).toBe(204);
  });

  it('reminds assignees of tasks due tomorrow once', async () => {
    await activeProject('DUE');
    await newTask('pm', 'DUE', { title: 'Due tomorrow', assigneeId: ids.bob, dueDate: addDays(today(), 1) });
    const job = h.kernel.registry.get('projects')!.jobs!['due-reminders']!;
    const run: JobRun = {
      id: 't',
      name: 'due-reminders',
      data: {},
      attempt: 1,
      log: async () => undefined,
      updateProgress: async () => undefined,
    };
    const first = (await job.handler(run, ctx())) as { sent: number };
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(await notificationsOf(ids.bob, 'projects.task.due_soon')).toHaveLength(1);
    const again = (await job.handler(run, ctx())) as { sent: number };
    expect(again.sent).toBe(0);
  });
});

describe('workload and my tasks', () => {
  it('spreads remaining hours over working days against allocation', async () => {
    await activeProject('WRK');
    const monday = addDays(weekStart(today()), 7);
    const friday = addDays(monday, 4);
    await newTask('pm', 'WRK', {
      title: 'Ten hours',
      assigneeId: ids.alice,
      startDate: monday,
      dueDate: friday,
      estimateHours: 10,
    });
    await newTask('pm', 'WRK', {
      title: 'Twenty hours',
      assigneeId: ids.alice,
      startDate: monday,
      dueDate: friday,
      estimateHours: 30,
      remainingHours: 20,
    });
    await newTask('pm', 'WRK', {
      title: 'Nobody yet',
      startDate: monday,
      dueDate: addDays(monday, 1),
      estimateHours: 8,
    });
    const res = await h.call(s.pm!, 'GET', `${API}/projects/WRK/workload?from=${monday}&weeks=2`);
    expect(res.status).toBe(200);
    expect(res.body.weeks).toEqual([monday, addDays(monday, 7)]);
    const alice = res.body.people.find((p: LooseJson) => p.user.id === ids.alice);
    // 50% of 40 h = 20 h capacity; 10 h + 20 h remaining = 30 h planned → over by 10 h.
    expect(alice.cells[0]).toMatchObject({ planned: 30, capacity: 20, utilisation: 1.5, overBy: 10 });
    expect(alice.cells[0].tasks.map((t: LooseJson) => t.hours)).toEqual([20, 10]);
    expect(alice.cells[1]).toMatchObject({ planned: 0, overBy: 0 });
    expect(res.body.unassigned[0]).toMatchObject({ planned: 8 });
    const bob = res.body.people.find((p: LooseJson) => p.user.id === ids.bob);
    expect(bob.cells[0]).toMatchObject({ planned: 0, capacity: 40 });
    expect(res.body.people.find((p: LooseJson) => p.user.id === ids.viewer)).toBeUndefined();

    const portfolio = await h.call(s.pm!, 'GET', `${API}/workload?from=${monday}&weeks=1`);
    const alicePortfolio = portfolio.body.people.find((p: LooseJson) => p.user.id === ids.alice);
    expect(alicePortfolio.projects.map((p: LooseJson) => p.key)).toContain('WRK');
    expect((await h.call(s.carol!, 'GET', `${API}/workload`)).body.people).toEqual([]);
  });

  it('groups my open tasks by due date', async () => {
    await activeProject('ME');
    const t0 = today();
    await newTask('pm', 'ME', { title: 'Late', assigneeId: ids.bob, dueDate: addDays(t0, -2) });
    await newTask('pm', 'ME', { title: 'Now', assigneeId: ids.bob, dueDate: t0 });
    await newTask('pm', 'ME', { title: 'Someday', assigneeId: ids.bob, dueDate: addDays(t0, 30) });
    await newTask('pm', 'ME', { title: 'Undated', assigneeId: ids.bob });
    const finished = await newTask('pm', 'ME', { title: 'Finished', assigneeId: ids.bob, dueDate: t0 });
    await h.call(s.bob!, 'PATCH', `${API}/tasks/${finished.reference}`, { status: 'done' });
    const res = await h.call(s.bob!, 'GET', `${API}/me/tasks?project=ME`);
    expect(res.status).toBe(200);
    const titles = (g: string) => res.body.groups[g].map((t: LooseJson) => t.title);
    expect(titles('overdue')).toEqual(['Late']);
    expect(titles('today')).toEqual(['Now']);
    expect(titles('later')).toEqual(['Someday']);
    expect(titles('noDate')).toEqual(['Undated']);
    expect(res.body.total).toBe(4);

    const overdue = await h.call(s.bob!, 'GET', `${API}/tasks?assignee=me&due=overdue&project=ME`);
    expect(overdue.body.items.map((t: LooseJson) => t.title)).toEqual(['Late']);
  });
});

describe('milestones, archive, delete and offboarding', () => {
  it('manages milestones in order and completes them', async () => {
    await activeProject('MIL');
    const base = `${API}/projects/MIL/milestones`;
    await h.call(s.pm!, 'POST', base, { name: 'Design', dueDate: '2026-11-01' });
    await h.call(s.pm!, 'POST', base, { name: 'Build', dueDate: '2026-12-01' });
    const created = await h.call(s.pm!, 'POST', base, { name: 'Launch' });
    expect(created.status).toBe(201);
    const ids = created.body.items.map((m: LooseJson) => m.id);
    expect(created.body.items.map((m: LooseJson) => m.name)).toEqual(['Design', 'Build', 'Launch']);
    expect((await h.call(s.alice!, 'POST', base, { name: 'Nope' })).status).toBe(403);

    const reordered = await h.call(s.pm!, 'POST', `${base}/reorder`, { ids: [ids[2], ids[0]] });
    expect(reordered.body.items.map((m: LooseJson) => m.name)).toEqual(['Launch', 'Design', 'Build']);

    const task = await newTask('alice', 'MIL', { title: 'Wireframes', milestoneId: ids[0] });
    await h.call(s.alice!, 'PATCH', `${API}/tasks/${task.reference}`, { status: 'done' });
    const done = await h.call(s.pm!, 'PATCH', `${base}/${ids[0]}`, { status: 'done' });
    expect(done.body.items.find((m: LooseJson) => m.id === ids[0])).toMatchObject({
      status: 'done',
      taskCount: 1,
      doneCount: 1,
      completedAt: expect.any(String),
    });
    const event = await eventually(
      () =>
        h.kernel.db.select().from(outboxEvents).where(eq(outboxEvents.name, 'projects.milestone.completed')),
      (rows) => rows.length > 0,
    );
    expect(event[0]!.payload).toMatchObject({ milestone: 'Design' });

    expect((await h.call(s.pm!, 'DELETE', `${base}/${ids[0]}`)).status).toBe(204);
    expect((await h.call(s.pm!, 'GET', `${API}/tasks/${task.reference}`)).body.milestone).toBeNull();
  });

  it('archives read-only and deletes only empty projects (admins any)', async () => {
    await activeProject('ARC');
    const task = await newTask('alice', 'ARC', { title: 'Keep me' });
    const archived = await h.call(s.pm!, 'PATCH', `${API}/projects/ARC`, { archived: true });
    expect(archived.body).toMatchObject({
      archivedAt: expect.any(String),
      viewer: { canEditTasks: false, canManage: true },
    });
    expect((await h.call(s.alice!, 'PATCH', `${API}/tasks/${task.reference}`, { title: 'x' })).status).toBe(
      403,
    );
    expect(
      (await h.call(s.pm!, 'GET', `${API}/projects`)).body.items.map((p: LooseJson) => p.key),
    ).not.toContain('ARC');
    expect(
      (await h.call(s.pm!, 'GET', `${API}/projects?archived=true`)).body.items.map((p: LooseJson) => p.key),
    ).toContain('ARC');
    await h.call(s.pm!, 'PATCH', `${API}/projects/ARC`, { archived: false });

    const refused = await h.call(s.pm!, 'DELETE', `${API}/projects/ARC`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('INVALID_STATE');
    expect((await h.call(s.alice!, 'DELETE', `${API}/projects/ARC`)).status).toBe(403);
    expect((await h.call(s.admin!, 'DELETE', `${API}/projects/ARC`)).status).toBe(204);
    expect((await h.call(s.pm!, 'GET', `${API}/projects/ARC`)).status).toBe(404);

    await newProject('pm', { name: 'Empty', key: 'EMP' });
    expect((await h.call(s.pm!, 'DELETE', `${API}/projects/EMP`)).status).toBe(204);
    const audit = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'projects.project.deleted'));
    expect(audit.map((a) => a.entityLabel)).toEqual(expect.arrayContaining(['ARC Project ARC', 'EMP Empty']));
  });

  it('unassigns and removes people who leave the company', async () => {
    await activeProject('OFF');
    const leaver = await mkUser('leaver');
    await h.call(s.pm!, 'POST', `${API}/projects/OFF/members`, { userId: leaver, role: 'member' });
    const t = await newTask('pm', 'OFF', { title: 'Half done', assigneeId: leaver });
    const handler = h.kernel.registry.get('projects')!.events!['core.user.offboarded']!;
    const event = {
      id: 'e',
      name: 'core.user.offboarded',
      moduleId: 'core',
      payload: { userId: leaver },
      actor: null,
      occurredAt: new Date().toISOString(),
    };
    await handler(event, ctx());
    await handler(event, ctx()); // at-least-once delivery: idempotent
    expect((await h.call(s.pm!, 'GET', `${API}/tasks/${t.reference}`)).body.assignee).toBeNull();
    const memberRows = await h.kernel.db.select().from(members).where(eq(members.userId, leaver));
    expect(memberRows).toEqual([]);
    const activity = await h.call(s.pm!, 'GET', `${API}/tasks/${t.reference}/activity`);
    expect(activity.body.items.at(-1)).toMatchObject({ kind: 'assignee', from: leaver, to: null });
  });
});

describe('records, search and AI tools', () => {
  it('resolves projects and tasks for the caller and links them to other records', async () => {
    await activeProject('REC', { visibility: 'private' });
    const t = await newTask('alice', 'REC', { title: 'Patch the firewall' });
    const [project] = await h.kernel.db.select().from(projects).where(eq(projects.key, 'REC'));

    const asAlice = await h.kernel.records.get({ type: 'projects.task', id: t.id }, await authOf(ids.alice));
    expect(asAlice).toMatchObject({
      reference: t.reference,
      title: 'Patch the firewall',
      href: `/projects/tasks/${t.reference}`,
      status: { key: 'projects.taskStatus.todo', tone: 'neutral' },
      editable: true,
    });
    expect(
      await h.kernel.records.get({ type: 'projects.task', id: t.id }, await authOf(ids.carol)),
    ).toBeNull();
    expect(
      (await h.kernel.records.get({ type: 'projects.task', id: t.id }, await authOf(ids.viewer)))?.editable,
    ).toBe(false);
    expect(
      await h.kernel.records.get({ type: 'projects.project', id: project!.id }, await authOf(ids.pm)),
    ).toMatchObject({ reference: 'REC', editable: true });

    const found = await h.kernel.records.search('firewall', {
      auth: await authOf(ids.alice),
      types: ['projects.task'],
    });
    expect(found.map((r) => r.reference)).toContain(t.reference);
    expect(
      await h.kernel.records.search('firewall', { auth: await authOf(ids.carol), types: ['projects.task'] }),
    ).toEqual([]);

    const linked = await h.call(s.alice!, 'POST', `/api/v1/records/projects.task/${t.id}/links`, {
      to: { type: 'projects.project', id: project!.id },
    });
    expect(linked.status).toBe(201);
    const links = await h.call(s.alice!, 'GET', `/api/v1/records/projects.task/${t.id}/links`);
    expect(links.body.links[0]).toMatchObject({
      ref: { type: 'projects.project', id: project!.id },
      record: { reference: 'REC' },
    });
    expect(
      (await board('alice', 'REC')).body.columns.find((c: LooseJson) => c.status === 'todo').tasks[0]
        .linkCount,
    ).toBe(1);
    expect(
      (
        await h.call(s.carol!, 'POST', `/api/v1/records/projects.task/${t.id}/links`, {
          to: { type: 'projects.project', id: project!.id },
        })
      ).status,
    ).toBe(404);

    // Global search sees only visible records.
    const hits = await h.kernel.registry.get('projects')!.search!(
      'firewall',
      ctx(),
      await authOf(ids.alice),
      10,
    );
    expect(hits.map((x) => x.title)).toContain('Patch the firewall');
    expect(
      await h.kernel.registry.get('projects')!.search!('firewall', ctx(), await authOf(ids.carol), 10),
    ).toEqual([]);

    // Deleting the task forgets its links.
    await h.call(s.pm!, 'DELETE', `${API}/tasks/${t.reference}`);
    expect(await ctx().records.linked({ type: 'projects.project', id: project!.id })).toEqual([]);
  });

  it('serves the AI tools with the same membership rules', async () => {
    await activeProject('AIT', { name: 'Network refresh pilot' });
    const ai = ctx().ai;
    const alice = await authOf(ids.alice);
    const created = await ai.tools.invoke<LooseJson>(
      'projects.create_task',
      {
        project: 'AIT',
        title: 'Label the patch panels',
        assigneeEmail: 'bob@test.example',
        dueDate: addDays(today(), 3),
        priority: 'high',
      },
      { auth: alice },
    );
    expect(created).toMatchObject({
      project: 'AIT',
      title: 'Label the patch panels',
      assignee: 'Bob',
      priority: 'high',
      status: 'todo',
    });
    await expect(
      ai.tools.invoke(
        'projects.create_task',
        { project: 'AIT', title: 'x' },
        { auth: await authOf(ids.carol) },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    const byName = await ai.tools.invoke<LooseJson>(
      'projects.find_tasks',
      { project: 'refresh pilot', query: 'patch' },
      { auth: alice },
    );
    expect(byName.tasks.map((x: LooseJson) => x.reference)).toEqual([created.reference]);
    const bobTasks = await ai.tools.invoke<LooseJson>(
      'projects.my_tasks',
      {},
      { auth: await authOf(ids.bob) },
    );
    expect(bobTasks.tasks.map((x: LooseJson) => x.reference)).toContain(created.reference);

    const moved = await ai.tools.invoke<LooseJson>(
      'projects.update_task_status',
      { task: created.reference, status: 'in_progress', comment: 'Started on 8F' },
      { auth: await authOf(ids.bob) },
    );
    expect(moved.status).toBe('in_progress');
    expect(
      (await h.call(s.bob!, 'GET', `${API}/tasks/${created.reference}/comments`)).body.items[0].body,
    ).toBe('Started on 8F');

    await h.call(s.pm!, 'POST', `${API}/projects/AIT/health`, {
      health: 'at_risk',
      note: 'Cabling contractor delayed',
    });
    const report = await ai.tools.invoke<LooseJson>(
      'projects.project_status',
      { project: 'network refresh' },
      { auth: alice },
    );
    expect(report).toMatchObject({
      project: { key: 'AIT' },
      status: 'active',
      health: 'at_risk',
      healthNote: 'Cabling contractor delayed',
      progress: { total: 1, done: 0 },
    });
  });
});

describe('seed', () => {
  it('creates the demo portfolio once, with a real pending approval for KHH', async () => {
    const module = h.kernel.registry.get('projects')!;
    await module.seed!(ctx());
    const keys = (await h.kernel.db.select({ key: projects.key }).from(projects)).map((p) => p.key);
    for (const key of ['NET', 'ERP', 'ZTA', 'M365', 'KHH', 'ITSM']) expect(keys).toContain(key);
    const [{ n: before } = { n: 0 }] = await h.kernel.db.select({ n: count() }).from(tasks);
    await module.seed!(ctx());
    const [{ n: after } = { n: 0 }] = await h.kernel.db.select({ n: count() }).from(tasks);
    expect(after).toBe(before);

    const titles = await h.kernel.db
      .select({ title: tasks.title, key: projects.key })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId));
    expect(titles).toEqual(
      expect.arrayContaining([
        { title: 'Replace core switch tpe-sw-core-01', key: 'NET' },
        { title: 'Cut over production to ERP v12', key: 'ERP' },
        { title: 'Enforce MFA for VPN', key: 'ZTA' },
      ]),
    );
    expect(
      titles.filter((t) => ['NET', 'ERP', 'ZTA', 'M365', 'KHH', 'ITSM'].includes(t.key)).length,
    ).toBeGreaterThanOrEqual(150);

    const [khh] = await h.kernel.db.select().from(projects).where(eq(projects.key, 'KHH'));
    expect(khh).toMatchObject({ status: 'proposed', budgetHours: 800, approvalStatus: 'pending' });
    const pending = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(
        and(eq(approvalTasks.instanceId, khh!.approvalInstanceId!), eq(approvalTasks.status, 'pending')),
      );
    expect(pending.length).toBeGreaterThan(0);

    const [erp] = await h.kernel.db.select().from(projects).where(eq(projects.key, 'ERP'));
    expect(erp).toMatchObject({ health: 'at_risk', status: 'active' });
    const net = await h.call(s.admin!, 'GET', `${API}/projects/NET`);
    expect(net.body).toMatchObject({ status: 'active', health: 'on_track', viewer: { canManage: true } });
    expect(net.body.milestones.map((m: LooseJson) => m.name)).toEqual([
      'Design',
      'Pilot (Taipei 12F)',
      'Rollout HQ',
      'Rollout Hsinchu',
    ]);
    const boardNet = await h.call(s.admin!, 'GET', `${API}/projects/NET/board`);
    expect(boardNet.body.columns.every((c: LooseJson) => c.total >= 1)).toBe(true);
    const memberRows = await h.kernel.db.select().from(members).where(eq(members.projectId, erp!.id));
    expect(memberRows.length).toBeGreaterThan(1);
    const activityRows = await h.kernel.db.select({ n: count() }).from(taskActivity);
    expect(activityRows[0]!.n).toBeGreaterThan(150);
  });
});
