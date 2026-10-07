import { auditLogs, outboxEvents } from '@isbp/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from './harness';

let h: Harness;
let admin: Session;

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
});
afterAll(async () => h?.close());

describe('infrastructure', () => {
  it('serves liveness/readiness and the OpenAPI 3.1 document publicly', async () => {
    expect((await h.call(null, 'GET', '/healthz')).status).toBe(200);
    expect((await h.call(null, 'GET', '/readyz')).body).toEqual({ status: 'ready' });
    const doc = await h.call(null, 'GET', '/api/openapi.json');
    expect(doc.body.openapi).toBe('3.1.0');
    expect(doc.body.paths['/api/v1/users']).toBeDefined();
    expect(doc.body.paths['/api/v1/announcements/posts']).toBeDefined();
  });
});

describe('authentication', () => {
  it('is required by default', async () => {
    const res = await h.call(null, 'GET', '/api/v1/users');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects bad passwords with a generic error and audits the failure', async () => {
    const res = await h.call(null, 'POST', '/api/v1/auth/login', {
      username: 'outsider',
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const [row] = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'core.auth.login_failed'))
      .orderBy(desc(auditLogs.seq))
      .limit(1);
    expect(row?.outcome).toBe('failure');
  });

  it('locks an account after repeated failures', async () => {
    for (let i = 0; i < 5; i++)
      await h.call(null, 'POST', '/api/v1/auth/login', { username: 'hr', password: 'nope-nope-nope' });
    const res = await h.call(null, 'POST', '/api/v1/auth/login', {
      username: 'hr',
      password: 'Integration-Test-1!',
    });
    expect(res.status).toBe(423);
    await h.kernel.db.execute(
      sql`update core.users set locked_until = null, failed_login_count = 0 where username = 'hr'`,
    );
  });

  it('enforces CSRF on cookie-authenticated mutations', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      payload: { timezone: 'Asia/Tokyo' },
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_INVALID');
    expect((await h.call(admin, 'PATCH', '/api/v1/me', { timezone: 'Asia/Tokyo' })).status).toBe(200);
  });

  it('logout revokes the session server-side', async () => {
    const s = await h.login('outsider');
    expect((await h.call(s, 'POST', '/api/v1/auth/logout')).status).toBe(200);
    expect((await h.call(s, 'GET', '/api/v1/auth/session')).status).toBe(401);
  });
});

describe('people lifecycle', () => {
  let userId: string;

  it('creates a person atomically with an audit row and an outbox event', async () => {
    const res = await h.call(admin, 'POST', '/api/v1/users', {
      email: 'New.Hire@test.example',
      username: 'new.hire',
      displayName: 'New Hire',
      departmentId: h.ids.salesTpe,
      status: 'pending',
      password: 'a-long-initial-password',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'new.hire@test.example',
      status: 'pending',
      department: { id: h.ids.salesTpe },
    });
    userId = res.body.id;
    const [audit] = await h.kernel.db.select().from(auditLogs).where(eq(auditLogs.entityId, userId));
    expect(audit?.action).toBe('core.user.created');
    const events = await h.kernel.db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.payload}->>'userId' = ${userId}`);
    expect(events.map((e) => e.name)).toContain('core.user.created');
  });

  it('rejects duplicates with 409', async () => {
    const res = await h.call(admin, 'POST', '/api/v1/users', {
      email: 'new.hire@test.example',
      username: 'other',
      displayName: 'Dup',
    });
    expect(res.status).toBe(409);
  });

  it('pending users cannot sign in until onboarded', async () => {
    const before = await h.call(null, 'POST', '/api/v1/auth/login', {
      username: 'new.hire',
      password: 'a-long-initial-password',
    });
    expect(before.status).toBe(403);
    expect((await h.call(admin, 'POST', `/api/v1/users/${userId}/onboard`)).body.status).toBe('active');
    const after = await h.call(null, 'POST', '/api/v1/auth/login', {
      username: 'new.hire',
      password: 'a-long-initial-password',
    });
    expect(after.status).toBe(200);
  });

  it('offboarding revokes sessions immediately and emits core.user.offboarded', async () => {
    const s = await h.login('new.hire', 'a-long-initial-password');
    const res = await h.call(admin, 'POST', `/api/v1/users/${userId}/offboard`, { reason: 'Contract ended' });
    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBeGreaterThanOrEqual(1);
    expect((await h.call(s, 'GET', '/api/v1/me')).status).toBe(401);
    const events = await h.kernel.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.name, 'core.user.offboarded'));
    expect(events.some((e) => (e.payload as { userId: string }).userId === userId)).toBe(true);
  });
});

describe('RBAC', () => {
  it('department scope covers the whole subtree and nothing else', async () => {
    const hr = await h.login('hr');
    const list = await h.call(hr, 'GET', '/api/v1/users?pageSize=100');
    expect(list.status).toBe(200);
    for (const u of list.body.items) expect([h.ids.sales, h.ids.salesTpe]).toContain(u.department?.id);
    expect((await h.call(hr, 'GET', `/api/v1/users/${h.ids.outsider}`)).status).toBe(403);
    // Creating outside the scope is denied, inside is allowed.
    const outside = await h.call(hr, 'POST', '/api/v1/users', {
      email: 'x@test.example',
      username: 'outside.user',
      displayName: 'X',
      departmentId: h.ids.finance,
    });
    expect(outside.status).toBe(403);
    const inside = await h.call(hr, 'POST', '/api/v1/users', {
      email: 'y@test.example',
      username: 'inside.user',
      displayName: 'Y',
      departmentId: h.ids.sales,
    });
    expect(inside.status).toBe(201);
  });

  it('blocks privilege escalation: you cannot grant what you do not hold', async () => {
    const hr = await h.login('hr');
    const roles = await h.call(admin, 'GET', '/api/v1/roles');
    const platformAdmin = roles.body.items.find((r: { key: string }) => r.key === 'platform-admin');
    const res = await h.call(hr, 'POST', '/api/v1/role-assignments', {
      roleId: platformAdmin.id,
      principalType: 'user',
      principalId: h.ids.hr,
      scopeType: 'department',
      scopeDepartmentId: h.ids.sales,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
    expect(res.body.error.details.missing).toContain('*');
  });

  it('time-bound access stops working at expiry', async () => {
    const roles = await h.call(admin, 'GET', '/api/v1/roles');
    const auditor = roles.body.items.find((r: { key: string }) => r.key === 'security-auditor');
    const grant = await h.call(admin, 'POST', '/api/v1/role-assignments', {
      roleId: auditor.id,
      principalType: 'user',
      principalId: h.ids.outsider,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(grant.status).toBe(201);
    const outsider = await h.login('outsider');
    expect((await h.call(outsider, 'GET', '/api/v1/audit-logs')).status).toBe(200);
    await h.kernel.db.execute(
      sql`update core.role_assignments set expires_at = now() - interval '1 second' where id = ${grant.body.id}`,
    );
    await h.kernel.rbac.bump();
    expect((await h.call(outsider, 'GET', '/api/v1/audit-logs')).status).toBe(403);
  });

  it('explains effective permissions with their source', async () => {
    const res = await h.call(admin, 'GET', `/api/v1/users/${h.ids.hr}/permissions`);
    expect(res.status).toBe(200);
    expect(
      res.body.sources.some(
        (s: { role: { key: string }; scopeType: string }) =>
          s.role.key === 'identity-admin' && s.scopeType === 'department',
      ),
    ).toBe(true);
    expect(res.body.sources.some((s: { via: string }) => s.via === 'everyone')).toBe(true);
  });
});

describe('audit trail', () => {
  it('is append-only at the database level', async () => {
    const pgMessage = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
      );
    expect(
      await pgMessage(h.kernel.db.execute(sql`update core.audit_logs set actor_name = 'mallory'`)),
    ).toMatch(/append-only/);
    expect(await pgMessage(h.kernel.db.execute(sql`delete from core.audit_logs`))).toMatch(/append-only/);
    expect(await pgMessage(h.kernel.db.execute(sql`truncate core.audit_logs`))).toMatch(/append-only/);
  });

  it('verifies record integrity hashes', async () => {
    const list = await h.call(admin, 'GET', '/api/v1/audit-logs?pageSize=5');
    const seq = list.body.items[0].seq;
    const res = await h.call(admin, 'GET', `/api/v1/audit-logs/${seq}/verify`);
    expect(res.body.valid).toBe(true);
  });
});

describe('module system', () => {
  it('lists installed modules with their manifests', async () => {
    const res = await h.call(admin, 'GET', '/api/v1/modules');
    expect(res.body.items.map((m: { id: string }) => m.id)).toEqual(
      expect.arrayContaining(['core', 'announcements']),
    );
  });

  it('a disabled module disappears from navigation and its API returns MODULE_DISABLED', async () => {
    expect((await h.call(admin, 'POST', '/api/v1/modules/core/toggle', { enabled: false })).status).toBe(409);
    expect(
      (await h.call(admin, 'POST', '/api/v1/modules/announcements/toggle', { enabled: false })).status,
    ).toBe(200);
    const res = await h.call(admin, 'GET', '/api/v1/announcements/posts');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MODULE_DISABLED');
    const nav = await h.call(admin, 'GET', '/api/v1/platform/navigation');
    expect(nav.body.items.some((i: { moduleId: string }) => i.moduleId === 'announcements')).toBe(false);
    await h.call(admin, 'POST', '/api/v1/modules/announcements/toggle', { enabled: true });
    expect((await h.call(admin, 'GET', '/api/v1/announcements/posts')).status).toBe(200);
  });

  it('navigation keeps each group together even when modules interleave their orders', async () => {
    const nav = await h.call(admin, 'GET', '/api/v1/platform/navigation');
    const items = nav.body.items as { section: string; group?: string | null }[];
    // The sidebar renders each section from the items in order; a group must not reappear after a gap.
    for (const section of ['main', 'admin']) {
      const seen = new Set<string>();
      let previous: string | null = null;
      for (const i of items.filter((x) => x.section === section)) {
        const key = i.group ?? null;
        if (key && key !== previous) {
          expect(seen.has(key), `group ${key} appears twice in ${section}`).toBe(false);
          seen.add(key);
        }
        previous = key;
      }
    }
  });

  it('module roles marked grantByDefault apply to everyone', async () => {
    const outsider = await h.login('outsider');
    expect((await h.call(outsider, 'GET', '/api/v1/announcements/posts')).status).toBe(200);
    expect((await h.call(outsider, 'POST', '/api/v1/announcements/posts', { title: 'Nope' })).status).toBe(
      403,
    );
  });

  it('module mutations go through the same audit + outbox pipeline', async () => {
    const res = await h.call(admin, 'POST', '/api/v1/announcements/posts', {
      title: 'Patch Tuesday',
      severity: 'maintenance',
      publish: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('published');
    const events = await h.kernel.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.name, 'announcements.post.published'));
    expect(events).toHaveLength(1);
    const [audit] = await h.kernel.db.select().from(auditLogs).where(eq(auditLogs.entityId, res.body.id));
    expect(audit?.moduleId).toBe('announcements');
  });

  it('global search aggregates enabled modules', async () => {
    const res = await h.call(admin, 'GET', '/api/v1/platform/search?q=patch');
    expect(res.body.hits.some((hit: { moduleId: string }) => hit.moduleId === 'announcements')).toBe(true);
  });
});
