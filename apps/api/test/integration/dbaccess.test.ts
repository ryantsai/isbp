import { randomBytes } from 'node:crypto';
import {
  approvalTasks,
  auditLogs,
  dbConnections,
  groupMembers,
  groups,
  notifications,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { manifest } from '@isbp/module-dbaccess/manifest';
import { addDays } from '@isbp/module-dbaccess/model';
import { grants, inventoryRoles, reveals, reviews } from '@isbp/module-dbaccess/schema';
import { services } from '@isbp/module-dbaccess/services';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/**
 * Database access end to end against the test database itself (superuser `isbp` as the admin connection):
 * request → approvals → provisioning (the account and membership really exist) → one-time reveal → expiry,
 * early revocation, offboarding, access reviews, drift and the failure path. Every role this file creates
 * starts with a random `itest_<hex>` prefix (roles are cluster-wide) and is dropped afterwards.
 */

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<
  'alice' | 'mgr' | 'owner' | 'bob' | 'sec' | 'dba' | 'rm' | 'leaver' | 'drift' | 'ownersGroup',
  string
>;
const fx = {} as Record<'connection' | 'server' | 'reader' | 'writer' | 'hi', string>;

const API = '/api/v1/dbaccess';
const PREFIX = `itest_${randomBytes(3).toString('hex')}`;
const ADMIN_LOGIN = `${PREFIX}_dba`;
const ADMIN_PASSWORD = `Itest-${randomBytes(9).toString('base64url')}`;
const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgres://isbp:isbp@localhost:5432/isbp_dba_test');
const today = () => new Date().toISOString().slice(0, 10);
const ctx = () => h.kernel.registry.context('dbaccess');

async function eventually<T>(
  fn: () => Promise<T>,
  accept: (v: T) => boolean,
  timeoutMs = 20_000,
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
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

const post = (who: string, path: string, body: unknown = {}) =>
  h.call(s[who]!, 'POST', `${API}${path}`, body);
const get = (who: string, path: string) => h.call(s[who]!, 'GET', `${API}${path}`);

const raw = (q: string) => h.kernel.db.execute(sql.raw(q));
const pgRole = async (name: string) =>
  (
    await h.kernel.db.execute<{ rolname: string; rolcanlogin: boolean }>(
      sql`select rolname, rolcanlogin from pg_roles where rolname = ${name}`,
    )
  ).rows[0];
const isMember = async (role: string, member: string) =>
  (
    await h.kernel.db.execute(sql`
      select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
       where r.rolname = ${role} and u.rolname = ${member}`)
  ).rows.length > 0;

const auditOf = (action: string, entityId?: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), entityId ? eq(auditLogs.entityId, entityId) : undefined));

const notificationsOf = (userId: string, type: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

/** Runs statements as the least-privilege admin login (a DBA working by hand, outside the platform). */
async function asAdminLogin(statements: string[]) {
  const client = new pg.Client({
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 5432),
    database: dbUrl.pathname.slice(1),
    user: ADMIN_LOGIN,
    password: ADMIN_PASSWORD,
  });
  await client.connect();
  try {
    for (const q of statements) await client.query(q);
  } finally {
    await client.end();
  }
}

/** Approves the pending task of `who` on an instance (the step must already be waiting for them). */
async function approve(instanceId: string, who: keyof typeof ids & keyof typeof s) {
  const task = await eventually(
    async () =>
      (
        await h.kernel.db
          .select()
          .from(approvalTasks)
          .where(
            and(
              eq(approvalTasks.instanceId, instanceId),
              eq(approvalTasks.status, 'pending'),
              eq(approvalTasks.assigneeId, ids[who]),
            ),
          )
      )[0],
    (t) => Boolean(t),
  );
  expect(task, `pending task for ${who}`).toBeTruthy();
  const res = await h.call(s[who]!, 'POST', `/api/v1/approvals/${task!.id}/approve`, { comment: 'OK' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const grantOf = (id: string) => get('dba', `/grants/${id}`).then((r) => r.body as LooseJson);
const waitGrant = (id: string, status: string) =>
  eventually(
    () => grantOf(id),
    (g) => g.status === status,
  );

/** Requests a role as `who` and returns the request. */
async function request(
  who: string,
  role: string,
  expiresOn: string | null,
  justification = 'Integration test access',
) {
  const res = await post(who, '/requests', { items: [{ roleId: role, expiresOn }], justification });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.items[0] as LooseJson;
}

/** Waits until the request is approved and returns its grant id. */
async function grantFor(requestRef: string, who: string) {
  const r = await eventually(
    () => get(who, `/requests/${requestRef}`),
    (x) => Boolean(x.body.grant),
  );
  expect(r.body.status).toBe('approved');
  return r.body.grant.id as string;
}

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  const db = h.kernel.db;
  ids.mgr = await mkUser('mgr');
  ids.alice = await mkUser('alice', ids.mgr);
  ids.leaver = await mkUser('leaver', ids.mgr);
  ids.owner = await mkUser('owner');
  ids.bob = await mkUser('bob');
  ids.sec = await mkUser('sec');
  ids.dba = await mkUser('dba');
  ids.rm = await mkUser('rm');
  ids.drift = await mkUser('drift');
  const [security] = await db
    .insert(groups)
    .values({ key: 'security-team', name: 'Security Team' })
    .returning();
  const [owners] = await db.insert(groups).values({ key: 'itest-owners', name: 'Role owners' }).returning();
  ids.ownersGroup = owners!.id;
  await db.insert(groupMembers).values([
    { groupId: security!.id, userId: ids.sec },
    { groupId: owners!.id, userId: ids.bob },
    { groupId: owners!.id, userId: ids.dba },
  ]);
  await db.insert(roleAssignments).values([
    { roleId: await roleId('dbaccess-dba'), userId: ids.dba },
    { roleId: await roleId('dbaccess-review-manager'), userId: ids.rm },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'alice', 'mgr', 'owner', 'bob', 'sec', 'dba', 'rm', 'leaver', 'drift'])
    s[u] = await h.login(u);
  await h.kernel.settings.update(manifest, { 'provisioning.retrySeconds': 1 }, null);

  // Group roles to request (NOLOGIN), and a least-privilege admin login holding ADMIN OPTION on them —
  // exactly like the demo's demo_* roles and isbp_demo_dba (PostgreSQL 16+ role administration rules apply).
  for (const r of ['reader', 'writer', 'hi']) await raw(`create role ${PREFIX}_${r} nologin`);
  await raw(`create role ${ADMIN_LOGIN} login createrole password '${ADMIN_PASSWORD}'`);
  await raw(`grant ${PREFIX}_reader, ${PREFIX}_writer, ${PREFIX}_hi to ${ADMIN_LOGIN} with admin option`);
  const [conn] = await db
    .insert(dbConnections)
    .values({
      key: `itest-admin-${PREFIX.slice(-6)}`,
      name: 'Integration test (admin)',
      engine: 'postgres',
      host: dbUrl.hostname,
      port: Number(dbUrl.port || 5432),
      database: dbUrl.pathname.slice(1),
      username: ADMIN_LOGIN,
      passwordSealed: h.kernel.box.encrypt(ADMIN_PASSWORD),
      options: { tls: 'off', ca: null, instanceName: null, domain: null },
      purposes: ['admin'],
      readOnly: false,
      enabled: true,
    })
    .returning();
  fx.connection = conn!.id;
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  if (h) {
    // Accounts first, then the group roles, then the admin login (it granted the memberships).
    const { rows } = await h.kernel.db.execute<{ rolname: string }>(
      sql`select rolname from pg_roles where rolname like ${`${PREFIX}%`}
           order by rolname = ${ADMIN_LOGIN}, rolname like ${`${PREFIX}\\_u\\_%`} desc, rolname`,
    );
    for (const r of rows) await raw(`drop role if exists "${r.rolname}"`);
    await h.close();
  }
});

describe('servers and requestable roles', () => {
  it('configures a server on an admin connection and syncs its inventory', async () => {
    expect((await post('alice', '/servers', { connectionId: fx.connection, displayName: 'x' })).status).toBe(
      403,
    );
    const bad = await post('dba', '/servers', {
      connectionId: fx.connection,
      displayName: 'Test server',
      accountPattern: 'no tokens here',
    });
    expect(bad.status).toBe(400);
    const created = await post('dba', '/servers', {
      connectionId: fx.connection,
      displayName: 'Test server',
      environment: 'test',
      accountPattern: `${PREFIX}_u_{username}`,
      authMode: 'password',
      ownerGroupId: ids.ownersGroup,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    fx.server = created.body.id;
    expect(created.body).toMatchObject({
      engine: 'postgres',
      authMode: 'password',
      connection: { key: expect.any(String) },
    });
    expect(
      (await post('dba', '/servers', { connectionId: fx.connection, displayName: 'Again' })).status,
    ).toBe(409);
    // Windows logins exist on SQL Server only.
    const windows = await h.call(s.dba!, 'PATCH', `${API}/servers/${fx.server}`, {
      authMode: 'windows',
      windowsDomain: 'CONTOSO',
    });
    expect(windows.status).toBe(400);

    const synced = await post('dba', `/servers/${fx.server}/sync`);
    expect(synced.status, JSON.stringify(synced.body)).toBe(200);
    expect(synced.body.roles).toBeGreaterThanOrEqual(3);
    const inventory = await get('dba', `/servers/${fx.server}/inventory`);
    const names = inventory.body.roles.map((r: LooseJson) => r.name);
    expect(names).toEqual(expect.arrayContaining([`${PREFIX}_reader`, `${PREFIX}_writer`, `${PREFIX}_hi`]));
    expect(await auditOf('dbaccess.server.synced', fx.server)).not.toHaveLength(0);
  });

  it('makes inventory roles requestable (only roles the sync saw)', async () => {
    const missing = await post('dba', `/servers/${fx.server}/roles`, {
      roleName: `${PREFIX}_nope`,
      name: { en: 'Nope' },
      ownerUserId: ids.owner,
    });
    expect(missing.status).toBe(400);
    const noOwner = await post('dba', `/servers/${fx.server}/roles`, {
      roleName: `${PREFIX}_reader`,
      name: { en: 'Reader' },
    });
    expect(noOwner.status).toBe(400);
    const reader = await post('dba', `/servers/${fx.server}/roles`, {
      roleName: `${PREFIX}_reader`,
      name: { en: 'Reader', 'zh-TW': '讀取者' },
      ownerUserId: ids.owner,
      risk: 'low',
      defaultDays: 30,
      maxDays: 90,
    });
    expect(reader.status, JSON.stringify(reader.body)).toBe(201);
    fx.reader = reader.body.id;
    const writer = await post('dba', `/servers/${fx.server}/roles`, {
      roleName: `${PREFIX}_writer`,
      name: { en: 'Writer' },
      ownerUserId: ids.owner,
      risk: 'medium',
      defaultDays: null,
      maxDays: null,
      allowPermanent: true,
      justificationRequired: false,
    });
    expect(writer.status, JSON.stringify(writer.body)).toBe(201);
    fx.writer = writer.body.id;
    const hi = await post('dba', `/servers/${fx.server}/roles`, {
      roleName: `${PREFIX}_hi`,
      name: { en: 'High risk' },
      ownerGroupId: ids.ownersGroup,
      risk: 'high',
      defaultDays: 7,
      maxDays: 14,
    });
    expect(hi.status, JSON.stringify(hi.body)).toBe(201);
    fx.hi = hi.body.id;
    expect(hi.body.owner).toMatchObject({ kind: 'group', name: 'Role owners' });
    // Partial updates change only what they name.
    const paused = await h.call(s.dba!, 'PATCH', `${API}/roles/${fx.hi}`, { active: false });
    expect(paused.body).toMatchObject({ active: false, risk: 'high', maxDays: 14, owner: { kind: 'group' } });
    expect((await h.call(s.dba!, 'PATCH', `${API}/roles/${fx.hi}`, { active: true })).body.active).toBe(true);
    const server = await h.call(s.dba!, 'PATCH', `${API}/servers/${fx.server}`, { autoSync: false });
    expect(server.body).toMatchObject({
      autoSync: false,
      accountPattern: `${PREFIX}_u_{username}`,
      environment: 'test',
    });
    const catalog = await get('alice', '/catalog');
    expect(catalog.body.items.map((i: LooseJson) => i.roleName)).toEqual(
      expect.arrayContaining([`${PREFIX}_reader`, `${PREFIX}_writer`, `${PREFIX}_hi`]),
    );
  });
});

describe('request → approve → provision → reveal → expiry', () => {
  let grantId = '';
  const account = `${PREFIX}_u_alice`;

  it('refuses durations over the maximum, missing justifications and duplicates', async () => {
    const tooLong = await post('alice', '/requests', {
      items: [{ roleId: fx.reader, expiresOn: addDays(today(), 120) }],
      justification: 'Monthly reporting for finance',
    });
    expect(tooLong.status).toBe(409);
    expect(tooLong.body.error.code).toBe('DURATION_TOO_LONG');
    const permanent = await post('alice', '/requests', {
      items: [{ roleId: fx.reader, expiresOn: null }],
      justification: 'Monthly reporting for finance',
    });
    expect(permanent.body.error.code).toBe('DURATION_TOO_LONG');
    const noReason = await post('alice', '/requests', {
      items: [{ roleId: fx.reader, expiresOn: addDays(today(), 30) }],
    });
    expect(noReason.status).toBe(400);
  });

  it('runs the manager → owner workflow and provisions a verified account', async () => {
    const req = await request('alice', fx.reader, addDays(today(), 30), 'Monthly reporting for finance');
    expect(req).toMatchObject({ status: 'pending', reference: expect.stringMatching(/^DBR-\d{5}$/) });
    expect(req.instanceId).toBeTruthy();
    const dup = await post('alice', '/requests', {
      items: [{ roleId: fx.reader, expiresOn: addDays(today(), 30) }],
      justification: 'Monthly reporting for finance',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_REQUEST');
    // The approvers see the request; others don't.
    expect((await get('mgr', `/requests/${req.reference}`)).status).toBe(200);
    expect((await get('bob', `/requests/${req.reference}`)).status).toBe(403);

    await approve(req.instanceId, 'mgr');
    await approve(req.instanceId, 'owner');
    grantId = await grantFor(req.reference, 'alice');
    const g = await waitGrant(grantId, 'active');
    expect(g).toMatchObject({
      status: 'active',
      accountName: account,
      source: 'request',
      grantee: { id: ids.alice },
    });
    expect(new Date(g.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    expect((await pgRole(account))?.rolcanlogin).toBe(true);
    expect(await isMember(`${PREFIX}_reader`, account)).toBe(true);
    expect(await auditOf('dbaccess.account.created')).toHaveLength(1);
    expect(await auditOf('dbaccess.grant.provisioned', grantId)).toHaveLength(1);
    expect(
      await eventually(
        () => notificationsOf(ids.alice, 'dbaccess.grant.ready'),
        (n) => n.length > 0,
      ),
    ).toHaveLength(1);
    expect(await notificationsOf(ids.alice, 'dbaccess.request.approved')).toHaveLength(1);

    const again = await post('alice', '/requests', {
      items: [{ roleId: fx.reader, expiresOn: addDays(today(), 30) }],
      justification: 'Monthly reporting for finance',
    });
    expect(again.body.error.code).toBe('ALREADY_GRANTED');
  });

  it('reveals the generated password once, to the grantee only', async () => {
    const mine = await get('alice', '/me/access');
    const g = mine.body.grants.find((x: LooseJson) => x.id === grantId);
    expect(g.reveal).toMatchObject({ available: true });
    expect((await post('bob', `/reveals/${g.reveal.id}`)).status).toBe(404);
    const first = await post('alice', `/reveals/${g.reveal.id}`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ accountName: account, connection: { engine: 'postgres' } });
    expect(first.body.password).toMatch(/^[A-Za-z][A-Za-z0-9\-_.!#%*+=~]{23}$/);
    // The password works.
    const client = new pg.Client({
      host: dbUrl.hostname,
      port: Number(dbUrl.port || 5432),
      database: dbUrl.pathname.slice(1),
      user: account,
      password: first.body.password,
    });
    await client.connect();
    expect((await client.query('select current_user as u')).rows[0].u).toBe(account);
    await client.end();

    const second = await post('alice', `/reveals/${g.reveal.id}`);
    expect(second.status).toBe(410);
    expect(second.body.error.code).toBe('REVEAL_EXPIRED');
    const [row] = await h.kernel.db.select().from(reveals).where(eq(reveals.id, g.reveal.id));
    expect(row!.secretSealed).toBeNull();
    expect(await auditOf('dbaccess.credential.revealed')).toHaveLength(2); // success + denied
  });

  it('the expiry job revokes expired grants', async () => {
    await h.kernel.db
      .update(grants)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(grants.id, grantId));
    await services(ctx()).grants.sweep();
    const g = await waitGrant(grantId, 'expired');
    expect(g).toMatchObject({ endReason: 'expired' });
    expect(await isMember(`${PREFIX}_reader`, account)).toBe(false);
    // The account stays; its password validity follows the grants (none left).
    expect(await pgRole(account)).toBeTruthy();
  });

  it('re-request, then the role owner revokes early with a reason', async () => {
    const req = await request('alice', fx.reader, addDays(today(), 10), 'Back for the quarter close');
    await approve(req.instanceId, 'mgr');
    await approve(req.instanceId, 'owner');
    const id = await grantFor(req.reference, 'alice');
    await waitGrant(id, 'active');
    expect(await isMember(`${PREFIX}_reader`, account)).toBe(true);
    // The existing account is reused; it held nothing any more, so it gets a fresh password (shown once).
    const mine = await get('alice', '/me/access');
    const reveal = mine.body.grants.find((x: LooseJson) => x.id === id).reveal;
    expect(reveal).toMatchObject({ available: true });
    expect(await auditOf('dbaccess.account.created')).toHaveLength(1);
    const audit = await auditOf('dbaccess.account.enabled');
    expect(audit.map((a) => (a.metadata as LooseJson).passwordReset)).toEqual([true]);

    // Role owners find the grants of their roles ("Access to roles you own"), and only those.
    expect((await get('owner', '/me/access')).body.ownedRoles).toBe(2);
    expect((await get('bob', '/me/access')).body.ownedRoles).toBe(1); // the high-risk role, via the group
    expect((await get('alice', '/me/access')).body.ownedRoles).toBe(0);
    const owned = await get('owner', '/grants?status=live');
    expect(owned.status, JSON.stringify(owned.body)).toBe(200);
    expect(owned.body.items.map((x: LooseJson) => x.id)).toContain(id);
    for (const x of owned.body.items) expect([fx.reader, fx.writer]).toContain(x.role.id);
    expect(owned.body.items.find((x: LooseJson) => x.id === id).viewer.canRevoke).toBe(true);
    // Asking for someone else's role doesn't widen the scope.
    expect((await get('bob', `/grants?roleId=${fx.reader}`)).body).toMatchObject({ items: [], total: 0 });
    expect((await get('bob', '/grants')).body.items.map((x: LooseJson) => x.id)).not.toContain(id);
    // Without owned roles or dbaccess.grants.read the list is refused (and the denial audited).
    expect((await get('alice', '/grants')).status).toBe(403);
    expect((await get('mgr', '/grants?owned=true')).status).toBe(403);
    // Readers see all access, or with `owned` only the grants of the roles they own.
    expect((await get('dba', '/grants?status=live')).body.items.map((x: LooseJson) => x.id)).toContain(id);
    const dbaOwned = await get('dba', '/grants?owned=true');
    expect(dbaOwned.status).toBe(200);
    for (const x of dbaOwned.body.items) expect(x.role.id).toBe(fx.hi);

    expect((await post('bob', `/grants/${id}/revoke`, { reason: 'Not needed' })).status).toBe(403);
    const revoked = await post('owner', `/grants/${id}/revoke`, { reason: 'Project finished early' });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(revoked.body.status).toBe('revoking');
    const g = await waitGrant(id, 'revoked');
    expect(g).toMatchObject({ endReason: 'revoked', endNote: 'Project finished early' });
    expect(await isMember(`${PREFIX}_reader`, account)).toBe(false);
    expect(
      await eventually(
        () => notificationsOf(ids.alice, 'dbaccess.grant.revoked'),
        (n) => n.length > 0,
      ),
    ).not.toHaveLength(0);
  });

  it('a manager sees their report’s access; others do not', async () => {
    expect((await get('mgr', `/people/${ids.alice}/access`)).status).toBe(200);
    expect((await get('bob', `/people/${ids.alice}/access`)).status).toBe(403);
    expect((await get('dba', `/people/${ids.alice}/access`)).status).toBe(200);
  });
});

describe('high-risk roles and offboarding', () => {
  it('high-risk roles also need information security; offboarding revokes and disables the account', async () => {
    const req = await request('leaver', fx.hi, addDays(today(), 7), 'Emergency data fix CHG-1234');
    await approve(req.instanceId, 'mgr');
    // The owning group: any member (bob or dba) approves.
    await approve(req.instanceId, 'bob');
    await approve(req.instanceId, 'sec');
    const id = await grantFor(req.reference, 'leaver');
    await waitGrant(id, 'active');
    const account = `${PREFIX}_u_leaver`;
    expect(await isMember(`${PREFIX}_hi`, account)).toBe(true);

    const off = await h.call(s.admin!, 'POST', `/api/v1/users/${ids.leaver}/offboard`, {
      reason: 'Left the company',
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const g = await waitGrant(id, 'revoked');
    expect(g.endReason).toBe('offboarded');
    expect(await isMember(`${PREFIX}_hi`, account)).toBe(false);
    const role = await eventually(
      () => pgRole(account),
      (r) => r?.rolcanlogin === false,
    );
    expect(role?.rolcanlogin).toBe(false);
    expect(
      await eventually(
        () => auditOf('dbaccess.account.disabled'),
        (a) => a.length > 0,
      ),
    ).toHaveLength(1);
  });
});

describe('access reviews', () => {
  it('a revoke decision is applied when the campaign closes; closed campaigns are read-only', async () => {
    const req = await request('alice', fx.writer, null, 'Batch loads');
    await approve(req.instanceId, 'mgr');
    await approve(req.instanceId, 'owner');
    const id = await grantFor(req.reference, 'alice');
    await waitGrant(id, 'active');
    const account = `${PREFIX}_u_alice`;
    expect(await isMember(`${PREFIX}_writer`, account)).toBe(true);

    expect((await post('owner', '/reviews', { name: 'Nope', dueOn: addDays(today(), 7) })).status).toBe(403);
    const created = await post('rm', '/reviews', {
      name: 'Integration access review',
      serverIds: [fx.server],
      dueOn: addDays(today(), 7),
      reviewerRule: 'owner',
      policy: 'keep',
      recurrence: 'none',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ status: 'active', totals: { items: 1, pending: 1 } });
    const reviewId = created.body.id as string;
    expect(await notificationsOf(ids.owner, 'dbaccess.review.assigned')).toHaveLength(1);

    // The owner sees the campaign and their item; alice (the grantee) cannot decide her own access.
    const mine = await get('owner', `/reviews/${reviewId}/items?view=mine`);
    expect(mine.body.items).toHaveLength(1);
    const item = mine.body.items[0];
    expect(item).toMatchObject({ grantId: id, canDecide: true, reviewer: { kind: 'user', id: ids.owner } });
    expect(
      (await post('alice', `/reviews/${reviewId}/decisions`, { itemIds: [item.id], decision: 'keep' }))
        .status,
    ).toBe(403);
    expect(
      (await post('owner', `/reviews/${reviewId}/decisions`, { itemIds: [item.id], decision: 'revoke' }))
        .status,
    ).toBe(400);
    const decided = await post('owner', `/reviews/${reviewId}/decisions`, {
      itemIds: [item.id],
      decision: 'revoke',
      comment: 'No longer on the data team',
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body.updated).toBe(1);

    const closed = await post('rm', `/reviews/${reviewId}/close`);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body).toMatchObject({ status: 'closed', totals: { revoked: 1 } });
    const g = await waitGrant(id, 'revoked');
    expect(g.endReason).toBe('review');
    expect(await isMember(`${PREFIX}_writer`, account)).toBe(false);

    const late = await post('owner', `/reviews/${reviewId}/decisions`, {
      itemIds: [item.id],
      decision: 'keep',
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('REVIEW_CLOSED');
    expect((await post('rm', `/reviews/${reviewId}/close`)).body.error.code).toBe('REVIEW_CLOSED');

    const csv = await h.app.inject({
      method: 'GET',
      url: `${API}/reviews/${reviewId}/report.csv`,
      headers: { cookie: s.rm!.cookie },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('No longer on the data team');
    expect(csv.body).toContain(account);
  });
});

describe('AI tools', () => {
  it('list my access, and request access only with confirmation', async () => {
    const [u] = await h.kernel.db.select().from(users).where(eq(users.id, ids.bob));
    const auth = buildAuthContext(
      { type: 'user', id: ids.bob, name: u!.displayName },
      {
        id: u!.id,
        email: u!.email,
        username: u!.username,
        displayName: u!.displayName,
        locale: 'en',
        timezone: 'UTC',
        departmentId: null,
        avatarUrl: null,
      },
      null,
      await h.kernel.rbac.permissionsFor(ids.bob),
    );
    const tools = ctx().ai.tools;
    const before = (await tools.invoke('dbaccess.list_my_access', {}, { auth })) as LooseJson;
    expect(before).toMatchObject({ access: [], pendingRequests: [] });
    await expect(
      tools.invoke(
        'dbaccess.request_access',
        { role: `${PREFIX}_reader`, justification: 'Reporting for the team' },
        { auth },
      ),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const created = (await tools.invoke(
      'dbaccess.request_access',
      { role: `${PREFIX}_reader`, justification: 'Reporting for the team' },
      { auth, confirmed: true },
    )) as LooseJson;
    expect(created).toMatchObject({
      reference: expect.stringMatching(/^DBR-/),
      status: 'pending',
      role: 'Reader',
    });
    // The role default (30 days) applies when no end date is given.
    expect(created.requestedUntil).toBe(addDays(today(), 30));
    const after = (await tools.invoke('dbaccess.list_my_access', {}, { auth })) as LooseJson;
    expect(after.pendingRequests).toHaveLength(1);
    expect((await post('bob', `/requests/${created.reference}/cancel`)).body.status).toBe('cancelled');
  });
});

describe('review schedule', () => {
  it('starts scheduled campaigns, reminds reviewers, closes overdue ones with the policy and recurs', async () => {
    const req = await request('alice', fx.writer, null, 'Batch loads again');
    await approve(req.instanceId, 'mgr');
    await approve(req.instanceId, 'owner');
    const grantId = await grantFor(req.reference, 'alice');
    await waitGrant(grantId, 'active');

    const created = await post('rm', '/reviews', {
      name: 'Q3 2026 scheduled review',
      serverIds: [fx.server],
      startOn: addDays(today(), 3),
      dueOn: addDays(today(), 10),
      policy: 'revoke',
      recurrence: 'quarterly',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ status: 'scheduled', totals: { items: 0 } });
    const id = created.body.id as string;
    const tick = () => services(ctx()).reviews.tick();

    await h.kernel.db
      .update(reviews)
      .set({ startOn: addDays(today(), -2) })
      .where(eq(reviews.id, id));
    expect((await tick()).started).toBe(1);
    expect((await get('rm', `/reviews/${id}`)).body).toMatchObject({
      status: 'active',
      totals: { items: 1, pending: 1 },
    });

    await h.kernel.db
      .update(reviews)
      .set({ dueOn: addDays(today(), 2) })
      .where(eq(reviews.id, id));
    const reminded = (await notificationsOf(ids.owner, 'dbaccess.review.reminder')).length;
    await tick();
    expect(await notificationsOf(ids.owner, 'dbaccess.review.reminder')).toHaveLength(reminded + 1);
    await tick(); // once per campaign
    expect(await notificationsOf(ids.owner, 'dbaccess.review.reminder')).toHaveLength(reminded + 1);

    // Nobody decided by the due date: the policy revokes.
    await h.kernel.db
      .update(reviews)
      .set({ dueOn: addDays(today(), -2) })
      .where(eq(reviews.id, id));
    expect((await tick()).closed).toBe(1);
    expect((await get('rm', `/reviews/${id}`)).body).toMatchObject({
      status: 'closed',
      totals: { pending: 1 },
    });
    const g = await waitGrant(grantId, 'revoked');
    expect(g).toMatchObject({ endReason: 'review', endNote: expect.stringContaining('not reviewed') });
    const next = await h.kernel.db.select().from(reviews).where(eq(reviews.previousId, id));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      name: 'Q4 2026 scheduled review',
      status: 'scheduled',
      policy: 'revoke',
    });
  });
});

describe('drift', () => {
  it('shows memberships made outside the platform as unmanaged; adopt and revoke work', async () => {
    const drift = `${PREFIX}_u_drift`;
    const ghost = `${PREFIX}_u_ghost`;
    const root = `${PREFIX}_u_root`;
    // A DBA used the admin login by hand (like the demo's legacy report login)…
    await asAdminLogin([
      `create role ${drift} login`,
      `create role ${ghost} login`,
      `grant ${PREFIX}_reader to ${drift}, ${ghost}`,
    ]);
    // …and someone granted a membership as the superuser.
    await raw(`create role ${root} login`);
    await raw(`grant ${PREFIX}_reader to ${root}`);
    await post('dba', `/servers/${fx.server}/sync`);

    const list = await get('dba', `/unmanaged?serverId=${fx.server}`);
    expect(list.status).toBe(200);
    const byName = new Map(list.body.items.map((u: LooseJson) => [u.memberName, u]));
    expect(byName.get(drift)).toMatchObject({ role: { id: fx.reader }, suggested: { id: ids.drift } });
    expect(byName.get(ghost)).toMatchObject({ suggested: null });
    const accounts = await get('dba', `/accounts?serverId=${fx.server}&orphan=true&q=${PREFIX}`);
    expect(accounts.body.items.map((a: LooseJson) => a.name)).toContain(ghost);

    expect(
      (
        await post('alice', '/unmanaged/adopt', {
          serverId: fx.server,
          roleId: fx.reader,
          memberName: drift,
          userId: ids.drift,
          expiresOn: addDays(today(), 10),
        })
      ).status,
    ).toBe(403);
    // Only active people get adopted access: a suspended person is reactivated first, an offboarded one never.
    const adoptBody = {
      serverId: fx.server,
      roleId: fx.reader,
      memberName: drift,
      userId: ids.drift,
      expiresOn: addDays(today(), 10),
    };
    for (const [status, code] of [
      ['suspended', 'PRINCIPAL_SUSPENDED'],
      ['offboarded', 'PRINCIPAL_OFFBOARDED'],
    ] as const) {
      await h.kernel.db.update(users).set({ status }).where(eq(users.id, ids.drift));
      const refused = await post('dba', '/unmanaged/adopt', adoptBody);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe(code);
    }
    await h.kernel.db.update(users).set({ status: 'active' }).where(eq(users.id, ids.drift));
    const adopted = await post('dba', '/unmanaged/adopt', adoptBody);
    expect(adopted.status, JSON.stringify(adopted.body)).toBe(201);
    expect(adopted.body).toMatchObject({
      status: 'active',
      source: 'adopted',
      accountName: drift,
      grantee: { id: ids.drift },
    });

    const revoked = await post('dba', '/unmanaged/revoke', {
      serverId: fx.server,
      roleId: fx.reader,
      memberName: ghost,
      reason: 'Unknown account',
    });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(202);
    await waitGrant(revoked.body.id, 'revoked');
    expect(await isMember(`${PREFIX}_reader`, ghost)).toBe(false);

    // PostgreSQL 16+: only the grantor (or a superuser) may revoke a membership; the DBA is told why.
    const blocked = await post('dba', '/unmanaged/revoke', {
      serverId: fx.server,
      roleId: fx.reader,
      memberName: root,
      reason: 'Granted by hand',
    });
    expect(blocked.status).toBe(202);
    const failed = await eventually(
      () => grantOf(blocked.body.id),
      (g) => g.status === 'failed',
      30_000,
    );
    expect(failed).toMatchObject({ operation: 'revoke', attempts: 3 });
    expect(failed.lastError).toMatch(/granted by isbp/);

    const after = await get('dba', `/unmanaged?serverId=${fx.server}`);
    expect(after.body.items.map((u: LooseJson) => u.memberName)).not.toContain(drift);
    expect(after.body.items.map((u: LooseJson) => u.memberName)).not.toContain(ghost);
    // The adopted grant can be revoked like any other.
    const back = await post('dba', `/grants/${adopted.body.id}/revoke`, {
      reason: 'Adopted for the record, now removed',
    });
    expect(back.status).toBe(200);
    await waitGrant(adopted.body.id, 'revoked');
    expect(await isMember(`${PREFIX}_reader`, drift)).toBe(false);
  });
});

describe('task type and failures', () => {
  it('the dbaccess.sync task type syncs and reports metrics', async () => {
    const outcome = await ctx().taskTypes.run(
      'dbaccess.sync',
      { serverId: fx.server },
      {
        runId: 'run-1',
        jobId: 'job-1',
        attempt: 1,
        scheduledFor: new Date(),
        lastSuccessAt: null,
        signal: new AbortController().signal,
        log: () => undefined,
      },
    );
    expect(outcome.metrics).toMatchObject({ accounts: expect.any(Number), roles: expect.any(Number) });
    expect(outcome.metrics!.roles).toBeGreaterThanOrEqual(3);
    expect(outcome.href).toBe(`/dbaccess/servers/${fx.server}`);
  });

  it('an unreachable server fails after 3 attempts, alerts the DBAs and can be retried', async () => {
    const alertsBefore = (await notificationsOf(ids.bob, 'dbaccess.provisioning.failed')).length;
    const [conn] = await h.kernel.db
      .insert(dbConnections)
      .values({
        key: `itest-down-${PREFIX.slice(-6)}`,
        name: 'Unreachable',
        engine: 'postgres',
        host: '127.0.0.1',
        port: 1,
        database: 'nowhere',
        username: 'nobody',
        passwordSealed: h.kernel.box.encrypt('x'),
        options: { tls: 'off', ca: null, instanceName: null, domain: null },
        purposes: ['admin'],
        enabled: true,
      })
      .returning();
    const server = await post('dba', '/servers', {
      connectionId: conn!.id,
      displayName: 'Down server',
      accountPattern: `${PREFIX}_u_{username}`,
      ownerGroupId: ids.ownersGroup,
    });
    expect(server.status).toBe(201);
    const sync = await post('dba', `/servers/${server.body.id}/sync`);
    expect(sync.status).toBe(422);
    expect(sync.body.error.code).toBe('DATABASE_ERROR');
    // Inventory as a previous sync would have left it.
    await h.kernel.db
      .insert(inventoryRoles)
      .values({ serverId: server.body.id, name: 'down_reader', syncedAt: new Date() });
    const role = await post('dba', `/servers/${server.body.id}/roles`, {
      roleName: 'down_reader',
      name: { en: 'Down reader' },
      ownerUserId: ids.owner,
      risk: 'low',
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const req = await request('alice', role.body.id, addDays(today(), 5), 'Testing the failure path');
    await approve(req.instanceId, 'mgr');
    await approve(req.instanceId, 'owner');
    const id = await grantFor(req.reference, 'alice');
    const failed = await eventually(
      () => grantOf(id),
      (g) => g.status === 'failed',
      30_000,
    );
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 3,
      operation: 'grant',
      viewer: { canRetry: true },
    });
    expect(failed.lastError).toBeTruthy();
    expect((await get('alice', `/grants/${id}`)).body.lastError).toBeNull();
    expect(await notificationsOf(ids.bob, 'dbaccess.provisioning.failed')).toHaveLength(alertsBefore + 1);
    expect(await auditOf('dbaccess.grant.provisioning_failed', id)).toHaveLength(1);

    expect((await post('alice', `/grants/${id}/retry`)).status).toBe(403);
    const retried = await post('dba', `/grants/${id}/retry`);
    expect(retried.status).toBe(200);
    expect(['provisioning', 'failed']).toContain(retried.body.status);
    // Clean up: the grantee gives it back (it never reached the server).
    await eventually(
      () => grantOf(id),
      (g) => g.status === 'failed',
      30_000,
    );
    const back = await post('alice', `/grants/${id}/relinquish`, { reason: 'Not needed any more' });
    expect(back.status).toBe(200);
  });
});
