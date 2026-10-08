/**
 * Department transfers: changing a person's department publishes `core.user.transferred` and asks the old and the new
 * manager to review the person's access (notification `core.user.transferred`, listing their direct roles and marking
 * those scoped to the old department "to review"). Nothing is revoked.
 */
import {
  departments,
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
