import { groupMembers, groups, roleAssignments, rolePermissions, roles, users } from '@isbp/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';

let h: Harness;
let admin: Session;
let appId: string;
let key: string;
let clientId: string;
let clientRow: string;

/** Calls the API as an API client (no cookie, bearer credentials). */
async function bearer(token: string, method: string, url: string, body?: unknown) {
  const res = await h.app.inject({
    method: method as 'GET',
    url,
    payload: body as object | undefined,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.statusCode, body: res.json() as LooseJson };
}

async function token(id: string, secret: string, extra: Record<string, string> = {}) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
      ...extra,
    }).toString(),
  });
  return { status: res.statusCode, body: res.json() as LooseJson, headers: res.headers };
}

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
});
afterAll(async () => h?.close());

describe('applications', () => {
  it('registers an app with its own permission catalog, roles and grants', async () => {
    const app = await h.call(admin, 'POST', '/api/v1/applications', {
      key: 'erp',
      name: 'ERP',
      ownerId: h.ids.admin,
    });
    expect(app.status).toBe(201);
    appId = app.body.id;
    expect((await h.call(admin, 'POST', '/api/v1/applications', { key: 'isbp', name: 'Nope' })).status).toBe(
      409,
    );
    for (const k of ['invoices.read', 'invoices.approve', 'payments.release'])
      expect(
        (await h.call(admin, 'POST', `/api/v1/applications/${appId}/permissions`, { key: k })).status,
      ).toBe(200);
    const approver = await h.call(admin, 'POST', `/api/v1/applications/${appId}/roles`, {
      key: 'approver',
      name: 'Approver',
      permissions: ['invoices.*'],
    });
    expect(approver.status).toBe(201);
    expect(approver.body.application).toMatchObject({ key: 'erp', isPlatform: false });
    const treasurer = await h.call(admin, 'POST', `/api/v1/applications/${appId}/roles`, {
      key: 'treasurer',
      name: 'Treasurer',
      permissions: ['payments.release'],
    });
    // App roles never leak into platform permissions or the platform role list.
    expect(
      (await h.call(admin, 'GET', '/api/v1/roles')).body.items.some(
        (r: { key: string }) => r.key === 'approver',
      ),
    ).toBe(false);
    expect((await h.call(admin, 'PATCH', `/api/v1/roles/${approver.body.id}`, { name: 'x' })).status).toBe(
      404,
    );

    // Direct grant to `hr`, department-scoped grant to `outsider`, group grant.
    expect(
      (
        await h.call(admin, 'POST', `/api/v1/applications/${appId}/assignments`, {
          roleId: approver.body.id,
          principalType: 'user',
          principalId: h.ids.hr,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await h.call(admin, 'POST', `/api/v1/applications/${appId}/assignments`, {
          roleId: treasurer.body.id,
          principalType: 'user',
          principalId: h.ids.outsider,
          scopeType: 'department',
          scopeDepartmentId: h.ids.sales,
        })
      ).status,
    ).toBe(201);
    const [g] = await h.kernel.db.insert(groups).values({ key: 'finance', name: 'Finance' }).returning();
    await h.kernel.db.insert(groupMembers).values({ groupId: g!.id, userId: h.ids.outsider });
    await h.call(admin, 'POST', `/api/v1/applications/${appId}/assignments`, {
      roleId: approver.body.id,
      principalType: 'group',
      principalId: g!.id,
    });
    const members = await h.call(admin, 'GET', `/api/v1/applications/${appId}/assignments`);
    expect(members.body.total).toBe(3);
  });

  it('answers the Role Query API for a session with the permission (console)', async () => {
    const r = await h.call(admin, 'GET', '/api/v1/role-query/users/hr?application=erp');
    expect(r.status).toBe(200);
    expect(r.body.roles.map((x: { key: string; source: string }) => [x.key, x.source])).toEqual([
      ['approver', 'direct'],
    ]);
    expect(r.body.permissions).toEqual(['invoices.approve', 'invoices.read']);
    const o = await h.call(admin, 'GET', '/api/v1/role-query/users/outsider@test.example?application=erp');
    expect(o.body.roles.map((x: { key: string; source: string }) => [x.key, x.source]).sort()).toEqual([
      ['approver', 'group'],
      ['treasurer', 'direct'],
    ]);
    expect(o.body.scopedPermissions).toEqual([
      {
        permission: 'payments.release',
        scope: expect.objectContaining({ type: 'department', departmentId: h.ids.sales }),
      },
    ]);
  });

  it('checks a permission, honouring department subtrees', async () => {
    const check = (body: object) =>
      h.call(admin, 'POST', '/api/v1/role-query/check', { user: 'outsider', application: 'erp', ...body });
    expect((await check({ permission: 'payments.release' })).body.allowed).toBe(false);
    expect(
      (await check({ permission: 'payments.release', departmentId: h.ids.salesTpe })).body,
    ).toMatchObject({
      allowed: true,
      matchedRoles: ['treasurer'],
    });
    expect((await check({ permission: 'payments.release', departmentId: h.ids.finance })).body.allowed).toBe(
      false,
    );
    expect((await check({ permission: 'invoices.approve' })).body.allowed).toBe(true);
  });

  it('reports people who are not active as holding nothing', async () => {
    await h.kernel.db.update(users).set({ status: 'suspended' }).where(eq(users.id, h.ids.hr));
    const r = await h.call(admin, 'GET', '/api/v1/role-query/users/hr?application=erp');
    expect(r.body).toMatchObject({ active: false, roles: [], permissions: [] });
    await h.kernel.db.update(users).set({ status: 'active' }).where(eq(users.id, h.ids.hr));
  });
});

describe('API clients', () => {
  it('creates a client and returns its secret exactly once', async () => {
    const created = await h.call(admin, 'POST', '/api/v1/api-clients', {
      name: 'ERP sync',
      applicationIds: [appId],
    });
    expect(created.status).toBe(201);
    key = created.body.secret;
    clientId = created.body.client.clientId;
    clientRow = created.body.client.id;
    expect(key).toMatch(/^isbp_sk_/);
    const again = await h.call(admin, 'GET', `/api/v1/api-clients/${clientRow}`);
    expect(JSON.stringify(again.body)).not.toContain(key);
    expect(again.body.secrets[0].prefix).toBe(key.slice(0, 14));
  });

  it('authenticates with the API key, limited to its applications', async () => {
    const ok = await bearer(key, 'GET', '/api/v1/role-query/users/hr?application=erp');
    expect(ok.status).toBe(200);
    expect(ok.body.roles[0].key).toBe('approver');
    // Unknown and not-granted applications look the same.
    const other = await h.call(admin, 'POST', '/api/v1/applications', { key: 'crm', name: 'CRM' });
    expect((await bearer(key, 'GET', '/api/v1/role-query/users/hr?application=crm')).status).toBe(404);
    expect((await bearer(key, 'GET', '/api/v1/role-query/users/hr?application=nope')).status).toBe(404);
    expect(other.status).toBe(201);
    // Personal routes and routes without a grant are closed to service principals.
    expect((await bearer(key, 'GET', '/api/v1/me')).status).toBe(403);
    expect((await bearer(key, 'GET', '/api/v1/users')).status).toBe(403);
    expect((await bearer('isbp_sk_wrong', 'GET', '/api/v1/role-query/users/hr?application=erp')).status).toBe(
      401,
    );
    // No CSRF token needed for bearer calls (no ambient cookie).
    expect(
      (
        await bearer(key, 'POST', '/api/v1/role-query/check', {
          user: 'hr',
          application: 'erp',
          permission: 'invoices.read',
        })
      ).body.allowed,
    ).toBe(true);
  });

  it('issues OAuth client-credentials tokens (RFC 6749 errors)', async () => {
    expect((await token(clientId, 'wrong')).body).toEqual({ error: 'invalid_client' });
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      payload: { grant_type: 'password' },
    });
    expect(bad.json()).toEqual({ error: 'unsupported_grant_type' });
    const t = await token(clientId, key, { scope: 'role-query' });
    expect(t.status).toBe(200);
    expect(t.headers['cache-control']).toBe('no-store');
    expect(t.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'role-query' });
    expect(
      (await bearer(t.body.access_token, 'GET', '/api/v1/role-query/applications/erp/members')).body.total,
    ).toBe(2);
    // HTTP Basic works too.
    const basic = await h.app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { authorization: `Basic ${Buffer.from(`${clientId}:${key}`).toString('base64')}` },
      payload: { grant_type: 'client_credentials' },
    });
    expect(basic.statusCode).toBe(200);
  });

  it('cannot be given platform permissions the creator does not hold', async () => {
    const [mgr] = await h.kernel.db
      .insert(roles)
      .values({
        applicationId: (await h.kernel.db.select().from(roles).where(eq(roles.key, 'platform-admin')))[0]!
          .applicationId,
        key: 'client-admin',
        name: 'Client admin',
      })
      .returning();
    await h.kernel.db
      .insert(rolePermissions)
      .values({ roleId: mgr!.id, permission: 'core.api-clients.manage' });
    await h.kernel.db.insert(roleAssignments).values({ roleId: mgr!.id, userId: h.ids.outsider });
    await h.kernel.rbac.bump();
    const outsider = await h.login('outsider');
    const res = await h.call(outsider, 'POST', '/api/v1/api-clients', {
      name: 'Sneaky',
      permissions: ['core.users.read'],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: 'PRIVILEGE_ESCALATION',
      details: { missing: ['core.users.read'] },
    });
  });

  it('can call the platform API with granted permissions; scope narrows tokens', async () => {
    const created = await h.call(admin, 'POST', '/api/v1/api-clients', {
      name: 'Directory reader',
      permissions: ['core.users.read'],
    });
    const apiKey = created.body.secret as string;
    expect((await bearer(apiKey, 'GET', '/api/v1/users?pageSize=1')).status).toBe(200);
    const narrow = await token(created.body.client.clientId, apiKey, { scope: 'role-query' });
    expect((await bearer(narrow.body.access_token, 'GET', '/api/v1/users')).status).toBe(403);
  });

  it('rotates and revokes secrets; revoking the client kills its tokens', async () => {
    const rotated = await h.call(admin, 'POST', `/api/v1/api-clients/${clientRow}/secrets`, {
      expiresInDays: 30,
    });
    const second = rotated.body.secret as string;
    expect((await bearer(second, 'GET', '/api/v1/role-query/users/hr?application=erp')).status).toBe(200);
    const oldId = rotated.body.client.secrets.find(
      (x: { prefix: string }) => x.prefix === key.slice(0, 14),
    ).id;
    await h.call(admin, 'DELETE', `/api/v1/api-clients/${clientRow}/secrets/${oldId}`);
    expect((await bearer(key, 'GET', '/api/v1/role-query/users/hr?application=erp')).status).toBe(401);
    const tok = (await token(clientId, second)).body.access_token as string;
    expect((await bearer(tok, 'GET', '/api/v1/role-query/users/hr?application=erp')).status).toBe(200);
    await h.call(admin, 'POST', `/api/v1/api-clients/${clientRow}/revoke`);
    expect((await bearer(second, 'GET', '/api/v1/role-query/users/hr?application=erp')).status).toBe(401);
    expect((await bearer(tok, 'GET', '/api/v1/role-query/users/hr?application=erp')).status).toBe(401);
  });

  it('enforces IP allow-lists', async () => {
    const created = await h.call(admin, 'POST', '/api/v1/api-clients', {
      name: 'Fenced',
      applicationIds: [appId],
      allowedCidrs: ['10.0.0.0/8'],
    });
    expect(
      (await bearer(created.body.secret, 'GET', '/api/v1/role-query/users/hr?application=erp')).status,
    ).toBe(401);
  });
});
