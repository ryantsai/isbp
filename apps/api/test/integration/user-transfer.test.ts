/**
 * Department transfers: changing a person's department publishes `core.user.transferred` and asks the old and the new
 * manager to review the person's access (notification `core.user.transferred`, listing their direct roles and marking
 * those scoped to the old department "to review"). Nothing is revoked.
 */
import {
  auditLogs,
  departments,
  groupMembers,
  groups,
  notifications,
  outboxEvents,
  roleAssignments,
  roles,
  users,
  uuidv7,
} from '@isbp/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, PASSWORD, type Session } from './harness';

let h: Harness;
let admin: Session;
const MODULES = process.env.ISBP_TEST_MODULES;
type Dept = { id: string; path: string };
const dept = {} as { ops: Dept; opsNight: Dept; dev: Dept; lab: Dept };
const ids: Record<string, string> = {};

async function mkDept(code: string, managerId: string | null, parent?: { id: string; path: string }) {
  const id = uuidv7();
  const path = `${parent?.path ?? '/'}${id}/`;
  await h.kernel.db
    .insert(departments)
    .values({ id, code, name: `${code} team`, parentId: parent?.id ?? null, path, managerId });
  return { id, path };
}

async function mkUser(username: string, opts: { departmentId?: string; managerId?: string } = {}) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      departmentId: opts.departmentId ?? null,
      managerId: opts.managerId ?? null,
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

const transferEvents = (userId: string) =>
  h.kernel.db
    .select({ payload: outboxEvents.payload, moduleId: outboxEvents.moduleId })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.name, 'core.user.transferred'),
        sql`${outboxEvents.payload}->>'userId' = ${userId}`,
      ),
    );

const transferNotices = (about: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.type, 'core.user.transferred'), sql`${notifications.data}->>'userId' = ${about}`),
    );

const move = (userId: string, body: Record<string, unknown>) =>
  h.call(admin, 'PATCH', `/api/v1/users/${userId}`, body);

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? '';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  admin = await h.login('admin');
  ids.opsHead = await mkUser('ops-head');
  ids.devHead = await mkUser('dev-head');
  ids.lineManager = await mkUser('line-manager');
  dept.ops = await mkDept('OPS', ids.opsHead);
  dept.opsNight = await mkDept('OPS-NIGHT', null, dept.ops);
  dept.dev = await mkDept('DEV', ids.devHead);
  dept.lab = await mkDept('LAB', null);

  // Mover: in OPS, with no manager of their own (their department's manager stands in).
  ids.mover = await mkUser('mover', { departmentId: dept.ops.id });
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('configuration-viewer'), userId: ids.mover },
    {
      roleId: await roleId('identity-admin'),
      userId: ids.mover,
      scopeType: 'department',
      scopeDepartmentId: dept.opsNight.id,
    },
    {
      roleId: await roleId('workflow-admin'),
      userId: ids.mover,
      scopeType: 'department',
      scopeDepartmentId: dept.dev.id,
    },
    // Expired: not listed.
    {
      roleId: await roleId('module-admin'),
      userId: ids.mover,
      expiresAt: new Date(Date.now() - 86_400_000),
    },
  ]);
  await h.kernel.rbac.bump();
});

afterAll(async () => {
  await h?.close();
});

describe('a department change', () => {
  it('publishes core.user.transferred with both departments', async () => {
    const res = await move(ids.mover!, { departmentId: dept.dev.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.department).toMatchObject({ id: dept.dev.id });
    expect(await transferEvents(ids.mover!)).toEqual([
      {
        moduleId: 'core',
        payload: { userId: ids.mover, fromDepartmentId: dept.ops.id, toDepartmentId: dept.dev.id },
      },
    ]);
  });

  it('asks the old and the new manager to review the person’s access', async () => {
    const sent = await transferNotices(ids.mover!);
    expect(sent.map((n) => n.userId).sort()).toEqual([ids.opsHead, ids.devHead].sort());
    // The person who moved isn't told.
    expect(sent.some((n) => n.userId === ids.mover)).toBe(false);
    for (const n of sent) {
      expect(n).toMatchObject({
        moduleId: 'core',
        title: 'mover moved to DEV team: please review their access',
        data: { userId: ids.mover, fromDepartmentId: dept.ops.id, toDepartmentId: dept.dev.id },
      });
      expect(n.body).toContain('mover moved from OPS team to DEV team.');
      // Direct, unexpired roles, by name; the one scoped to the old department (or below it) to review.
      expect(n.body).toContain(
        'Their 3 roles: Configuration viewer, Identity administrator · OPS-NIGHT team, Workflow administrator · DEV team.',
      );
      expect(n.body).toContain(
        'To review, scoped to the old department: Identity administrator · OPS-NIGHT team.',
      );
      expect(n.body).not.toContain('Module administrator');
      expect(n.body).toContain('Nothing was revoked');
    }
  });

  it('revokes nothing', async () => {
    const kept = await h.kernel.db
      .select({ roleId: roleAssignments.roleId, scope: roleAssignments.scopeDepartmentId })
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, ids.mover!));
    expect(kept).toHaveLength(4);
    const perms = await h.kernel.rbac.permissionsFor(ids.mover!);
    expect(perms.hasAny('core.users.update')).toBe(true);
    expect(perms.hasAny('core.workflows.read')).toBe(true);
  });

  it('tells their own manager rather than the old department’s, and a new manager given with the move', async () => {
    const person = await mkUser('reporter', { departmentId: dept.dev.id, managerId: ids.lineManager });
    const newManager = await mkUser('new-manager');
    const res = await move(person, { departmentId: dept.ops.id, managerId: newManager });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sent = await transferNotices(person);
    expect(sent.map((n) => n.userId).sort()).toEqual([ids.lineManager, newManager].sort());
    expect(sent[0]!.body).toContain('They have no roles assigned to them directly.');
    expect(sent[0]!.body).not.toContain('To review');
  });

  it('covers moves into and out of no department', async () => {
    const newcomer = await mkUser('newcomer');
    expect((await move(newcomer, { departmentId: dept.dev.id })).status).toBe(200);
    expect(await transferEvents(newcomer)).toEqual([
      expect.objectContaining({
        payload: { userId: newcomer, fromDepartmentId: null, toDepartmentId: dept.dev.id },
      }),
    ]);
    const joined = await transferNotices(newcomer);
    expect(joined.map((n) => n.userId)).toEqual([ids.devHead]);
    expect(joined[0]!.body).toContain('newcomer moved from no department to DEV team.');

    expect((await move(newcomer, { departmentId: null })).status).toBe(200);
    const events = await transferEvents(newcomer);
    expect(events.map((e) => e.payload)).toContainEqual({
      userId: newcomer,
      fromDepartmentId: dept.dev.id,
      toDepartmentId: null,
    });
    const left = (await transferNotices(newcomer)).filter((n) => n.title.includes('no department'));
    expect(left.map((n) => n.userId)).toEqual([ids.devHead]);
    expect(left[0]!.title).toBe('newcomer moved to no department: please review their access');
  });

  it('publishes an event but notifies nobody when neither department has a manager', async () => {
    const loner = await mkUser('loner', { departmentId: dept.lab.id });
    expect((await move(loner, { departmentId: dept.opsNight.id })).status).toBe(200);
    expect(await transferEvents(loner)).toHaveLength(1);
    expect(await transferNotices(loner)).toEqual([]);
  });

  it('does nothing of the kind for other changes', async () => {
    const before = (await transferEvents(ids.mover!)).length;
    expect((await move(ids.mover!, { jobTitle: 'Platform engineer' })).status).toBe(200);
    expect((await move(ids.mover!, { departmentId: dept.dev.id })).status).toBe(200);
    expect(await transferEvents(ids.mover!)).toHaveLength(before);
    expect(await transferNotices(ids.mover!)).toHaveLength(2);
  });
});

/* ───────────────────────── one change: Move to another department ───────────────────────── */

const groupId = async (key: string) => {
  const [g] = await h.kernel.db
    .insert(groups)
    .values({ key, name: `${key} group` })
    .returning();
  return g!.id;
};
const memberships = async (userId: string) =>
  (
    await h.kernel.db
      .select({ groupId: groupMembers.groupId, source: groupMembers.source })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId))
  )
    .map((m) => m.groupId)
    .sort();
const auditOf = (userId: string, action: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, userId)));

describe('POST /users/:id/transfer', () => {
  const g = {} as Record<'opsShared' | 'devShared' | 'personal' | 'synced', string>;
  const people = {} as Record<'walker' | 'opsMate1' | 'opsMate2' | 'devMate1' | 'devMate2', string>;

  beforeAll(async () => {
    g.opsShared = await groupId('ops-shared');
    g.devShared = await groupId('dev-shared');
    g.personal = await groupId('personal');
    const [synced] = await h.kernel.db
      .insert(groups)
      .values({ key: 'ldap-staff', name: 'Staff (LDAP)', source: 'ldap' })
      .returning();
    g.synced = synced!.id;
    people.walker = await mkUser('walker', { departmentId: dept.ops.id, managerId: ids.lineManager });
    people.opsMate1 = await mkUser('ops-mate-1', { departmentId: dept.ops.id });
    people.opsMate2 = await mkUser('ops-mate-2', { departmentId: dept.ops.id });
    people.devMate1 = await mkUser('dev-mate-1', { departmentId: dept.dev.id });
    people.devMate2 = await mkUser('dev-mate-2', { departmentId: dept.dev.id });
    await h.kernel.db.insert(groupMembers).values([
      { groupId: g.opsShared, userId: people.walker },
      { groupId: g.opsShared, userId: people.opsMate1 },
      { groupId: g.opsShared, userId: people.opsMate2 },
      { groupId: g.personal, userId: people.walker },
      { groupId: g.synced, userId: people.walker, source: 'sync' },
      { groupId: g.devShared, userId: people.devMate1 },
      { groupId: g.devShared, userId: people.devMate2 },
    ]);
    await h.kernel.db.insert(roleAssignments).values({
      roleId: await roleId('identity-admin'),
      userId: people.walker,
      scopeType: 'department',
      scopeDepartmentId: dept.ops.id,
    });
  });

  it('suggests the new manager, the groups to leave and join, and the roles to review', async () => {
    const res = await h.call(
      admin,
      'GET',
      `/api/v1/users/${people.walker}/transfer?departmentId=${dept.dev.id}`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.department).toEqual({
      id: dept.dev.id,
      name: 'DEV team',
      manager: { id: ids.devHead, displayName: 'dev-head' },
    });
    // Shared by the old department and not the new one; never a synced membership or a personal group.
    expect(res.body.leave).toEqual([g.opsShared]);
    expect(res.body.join).toEqual([g.devShared]);
    expect(res.body.roles).toEqual([
      expect.objectContaining({
        role: expect.objectContaining({ key: 'identity-admin' }),
        scope: { id: dept.ops.id, name: 'OPS team' },
        oldDepartment: true,
      }),
    ]);
  });

  it('moves the person, their groups and the roles chosen in one change', async () => {
    const options = await h.call(
      admin,
      'GET',
      `/api/v1/users/${people.walker}/transfer?departmentId=${dept.dev.id}`,
    );
    const res = await h.call(admin, 'POST', `/api/v1/users/${people.walker}/transfer`, {
      departmentId: dept.dev.id,
      managerId: ids.devHead,
      jobTitle: 'Developer',
      leaveGroupIds: [g.opsShared],
      joinGroupIds: [g.devShared],
      revokeAssignmentIds: [options.body.roles[0].assignmentId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ joined: 1, left: 1, revoked: 1 });

    const detail = await h.call(admin, 'GET', `/api/v1/users/${people.walker}`);
    expect(detail.body).toMatchObject({
      department: { id: dept.dev.id },
      manager: { id: ids.devHead },
      jobTitle: 'Developer',
    });
    expect(await memberships(people.walker!)).toEqual([g.devShared, g.personal, g.synced].sort());
    const left = await h.kernel.db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, people.walker!));
    expect(left).toHaveLength(0);

    // The person's history: one entry that says it all.
    const [entry, ...more] = await auditOf(people.walker!, 'core.user.transferred');
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      category: 'security',
      changes: {
        departmentId: [dept.ops.id, dept.dev.id],
        managerId: [ids.lineManager, ids.devHead],
        jobTitle: [null, 'Developer'],
      },
      metadata: { groupsJoined: [g.devShared], groupsLeft: [g.opsShared] },
    });
    const history = await h.call(admin, 'GET', `/api/v1/audit-logs?userId=${people.walker}`);
    expect(history.body.items.map((l: { action: string }) => l.action)).toEqual(['core.user.transferred']);
    expect(history.body.items[0].refs[dept.dev.id]).toMatchObject({ type: 'department', name: 'DEV team' });
    // The groups and the security trail keep their own entries.
    const groupLog = await h.call(
      admin,
      'GET',
      `/api/v1/audit-logs?entityType=group&entityId=${g.devShared}`,
    );
    expect(groupLog.body.items[0]).toMatchObject({
      action: 'core.group.members_added',
      metadata: { userIds: [people.walker], via: 'core.user.transferred' },
    });
    expect(await auditOf(people.walker!, 'core.role-assignment.revoked')).toHaveLength(1);
    // Events for every part, and the managers are asked to review the rest.
    expect(await transferEvents(people.walker!)).toHaveLength(1);
    expect((await transferNotices(people.walker!)).map((n) => n.userId).sort()).toEqual(
      [ids.lineManager, ids.devHead].sort(),
    );
  });

  it('refuses a synced membership, "Everyone", the same department and offboarded people', async () => {
    const res = await h.call(admin, 'POST', `/api/v1/users/${people.walker}/transfer`, {
      departmentId: dept.ops.id,
      leaveGroupIds: [g.synced],
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'synced_membership' } });
    expect(
      (await h.call(admin, 'POST', `/api/v1/users/${people.walker}/transfer`, { departmentId: dept.dev.id }))
        .status,
    ).toBe(400);
    const [everyone] = await h.kernel.db.select().from(groups).where(eq(groups.key, 'everyone'));
    const sys = await h.call(admin, 'POST', `/api/v1/users/${people.walker}/transfer`, {
      departmentId: dept.ops.id,
      joinGroupIds: [everyone!.id],
    });
    expect(sys.body.error.code).toBe('SYSTEM_GROUP');
    // Nothing changed.
    expect((await h.call(admin, 'GET', `/api/v1/users/${people.walker}`)).body.department.id).toBe(
      dept.dev.id,
    );
  });

  it('needs update rights in both departments', async () => {
    // hr is an identity administrator for SALES only.
    const hr = await h.login('hr');
    const inSales = await mkUser('sales-person', { departmentId: h.ids.sales });
    const out = await h.call(hr, 'POST', `/api/v1/users/${inSales}/transfer`, { departmentId: dept.dev.id });
    expect(out.status).toBe(403);
    const within = await h.call(hr, 'POST', `/api/v1/users/${inSales}/transfer`, {
      departmentId: h.ids.salesTpe,
    });
    expect(within.status, JSON.stringify(within.body)).toBe(200);
  });
});

describe('POST /users/:id/groups', () => {
  it('adds and removes groups in one change, and the person’s history lists them', async () => {
    const person = await mkUser('grouper');
    const a = await groupId('grouper-a');
    const b = await groupId('grouper-b');
    expect((await h.call(admin, 'POST', `/api/v1/users/${person}/groups`, { add: [a, b] })).body).toEqual({
      added: 2,
      removed: 0,
    });
    expect((await h.call(admin, 'POST', `/api/v1/users/${person}/groups`, { remove: [a] })).body).toEqual({
      added: 0,
      removed: 1,
    });
    expect(await memberships(person)).toEqual([b]);
    const detail = await h.call(admin, 'GET', `/api/v1/users/${person}`);
    expect(detail.body.groups).toEqual([
      { id: b, key: 'grouper-b', name: 'grouper-b group', source: 'manual', groupSource: 'local' },
    ]);
    const history = await h.call(admin, 'GET', `/api/v1/audit-logs?userId=${person}`);
    expect(history.body.items.map((l: { action: string }) => l.action)).toEqual([
      'core.group.members_removed',
      'core.group.members_added',
      'core.group.members_added',
    ]);
    expect((await h.call(admin, 'POST', `/api/v1/users/${person}/groups`, {})).status).toBe(400);
  });
});

describe('simultaneous department changes', () => {
  const auditCount = async (userId: string) => (await auditOf(userId, 'core.user.transferred')).length;

  it('two PATCHes at once move the person, record, publish and notify once', async () => {
    const twin = await mkUser('twin-patch', { departmentId: dept.ops.id });
    const [a, b] = await Promise.all([
      move(twin, { departmentId: dept.dev.id }),
      move(twin, { departmentId: dept.dev.id }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await expect.poll(() => transferEvents(twin).then((e) => e.length)).toBe(1);
    const updates = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.user.updated'), eq(auditLogs.entityId, twin)));
    expect(updates).toHaveLength(1);
    const sent = await transferNotices(twin);
    expect(sent.map((n) => n.userId).sort()).toEqual([ids.opsHead, ids.devHead].sort());
  });

  it('two transfers at once: one moves the person, the other is refused and records nothing', async () => {
    const twin = await mkUser('twin-transfer', { departmentId: dept.ops.id });
    const body = { departmentId: dept.dev.id };
    const results = await Promise.all([
      h.call(admin, 'POST', `/api/v1/users/${twin}/transfer`, body),
      h.call(admin, 'POST', `/api/v1/users/${twin}/transfer`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    await expect.poll(() => transferEvents(twin).then((e) => e.length)).toBe(1);
    expect(await auditCount(twin)).toBe(1);
    const sent = await transferNotices(twin);
    expect(sent.map((n) => n.userId).sort()).toEqual([ids.opsHead, ids.devHead].sort());
  });
});
