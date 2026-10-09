/**
 * Searching the audit log the way people read it: by the action labels the UI shows (in their language or English),
 * by "What changed" (several action prefixes), and per role (the role's own changes plus its grants). Entries come
 * back with the current names of the ids they mention. Also: `GET /roles` pages when asked to.
 */
import { roles, users } from '@isbp/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from './harness';

let h: Harness;
let admin: Session;
const MODULES = process.env.ISBP_TEST_MODULES;
const ids: Record<string, string> = {};

const actions = (body: { items: { action: string }[] }) => body.items.map((i) => i.action);

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? '';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  admin = await h.login('admin');
  const role = await h.call(admin, 'POST', '/api/v1/roles', {
    key: 'night-desk',
    name: 'Night desk',
    permissions: ['core.users.read'],
  });
  ids.role = role.body.id;
  expect(
    (await h.call(admin, 'PATCH', `/api/v1/roles/${ids.role}`, { description: 'Covers the night shift' }))
      .status,
  ).toBe(200);
  const grant = await h.call(admin, 'POST', '/api/v1/role-assignments', {
    roleId: ids.role,
    principalType: 'user',
    principalId: h.ids.outsider,
  });
  expect(grant.status, JSON.stringify(grant.body)).toBe(201);
  await h.kernel.db.update(users).set({ locale: 'zh-TW' }).where(eq(users.id, h.ids.admin));
});

afterAll(async () => {
  await h?.close();
});

describe('GET /audit-logs', () => {
  it('finds entries by the label the Action column shows', async () => {
    const res = await h.call(admin, 'GET', `/api/v1/audit-logs?q=${encodeURIComponent('Updated role')}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(actions(res.body)).toContain('core.role.updated');
    expect(actions(res.body).every((a: string) => a === 'core.role.updated')).toBe(true);
  });

  it('matches labels in the viewer’s language as well as English', async () => {
    // The admin now works in zh-TW (a new session reads the profile's locale).
    const zh = await h.login('admin');
    const res = await h.call(zh, 'GET', `/api/v1/audit-logs?q=${encodeURIComponent('授予角色')}`);
    expect(res.status).toBe(200);
    expect(actions(res.body)).toContain('core.role-assignment.granted');
  });

  it('filters by several action prefixes ("What changed")', async () => {
    const res = await h.call(
      admin,
      'GET',
      '/api/v1/audit-logs?actions=core.role.*&actions=core.role-assignment.*&pageSize=100',
    );
    const found = new Set(actions(res.body));
    expect(found).toEqual(
      new Set(['core.role.created', 'core.role.updated', 'core.role-assignment.granted']),
    );
  });

  it('lists a role’s own history: its changes and its grants', async () => {
    const res = await h.call(admin, 'GET', `/api/v1/audit-logs?roleId=${ids.role}`);
    expect(actions(res.body)).toEqual([
      'core.role-assignment.granted',
      'core.role.updated',
      'core.role.created',
    ]);
    // Another role's history doesn't include them.
    const [other] = await h.kernel.db.select().from(roles).where(eq(roles.key, 'security-auditor'));
    const none = await h.call(admin, 'GET', `/api/v1/audit-logs?roleId=${other!.id}`);
    expect(actions(none.body)).not.toContain('core.role.updated');
  });

  it('names the ids an entry mentions', async () => {
    const res = await h.call(
      admin,
      'GET',
      `/api/v1/audit-logs?roleId=${ids.role}&actions=core.role-assignment.*`,
    );
    const [grant] = res.body.items;
    expect(grant.refs[h.ids.outsider]).toEqual({ type: 'user', name: 'outsider', key: null, moduleId: null });
    expect(grant.refs['role:night-desk']).toMatchObject({
      type: 'role',
      name: 'Night desk',
      key: 'night-desk',
    });
    const one = await h.call(admin, 'GET', `/api/v1/audit-logs/${grant.seq}`);
    expect(one.body.refs[h.ids.outsider].name).toBe('outsider');
  });
});

describe('GET /roles', () => {
  it('lists every role without paging parameters, and one page with them', async () => {
    const all = await h.call(admin, 'GET', '/api/v1/roles');
    expect(all.status).toBe(200);
    expect(all.body.total).toBeUndefined();
    const count = all.body.items.length;
    expect(count).toBeGreaterThan(3);
    const first = await h.call(admin, 'GET', '/api/v1/roles?pageSize=2');
    const second = await h.call(admin, 'GET', '/api/v1/roles?pageSize=2&page=2');
    expect(first.body).toMatchObject({ total: count, page: 1, pageSize: 2 });
    expect(first.body.items.map((r: { id: string }) => r.id)).toEqual(
      all.body.items.slice(0, 2).map((r: { id: string }) => r.id),
    );
    expect(second.body.items.map((r: { id: string }) => r.id)).toEqual(
      all.body.items.slice(2, 4).map((r: { id: string }) => r.id),
    );
    const found = await h.call(admin, 'GET', '/api/v1/roles?q=night&pageSize=10');
    expect(found.body).toMatchObject({ total: 1, items: [expect.objectContaining({ key: 'night-desk' })] });
  });
});
