import { randomBytes } from 'node:crypto';
import {
  dbConnections,
  groupMembers,
  groups,
  roleAssignments,
  roles,
  users,
  workflowInstances,
} from '@isbp/db/schema';
import {
  accounts,
  grants,
  inventoryAccounts,
  requestableRoles,
  requests,
  reveals,
  reviewItems,
  reviews,
  servers,
} from '@isbp/module-dbaccess/schema';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';

/**
 * The demo data. `contoso-erp-admin` points at the test database with a CREATEROLE login holding ADMIN OPTION
 * on the `demo_*` roles (like the demo's `isbp_demo_dba`), so the seed REALLY
 * syncs and provisions (`demo_u_*` accounts, members of the cluster-wide `demo_*` group roles); `hr-sql01`
 * and `fin-ora01` point at hosts that do not exist and must never be contacted. Every `demo_u_*` role this
 * file creates is dropped afterwards (and the `demo_*` group roles too, when this file created them).
 */
let h: Harness;
let admin: Session;
const API = '/api/v1/dbaccess';
const DEMO_ROLES = ['demo_reporting', 'demo_finance_analyst', 'demo_app_rw', 'demo_readonly'];
const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgres://isbp:isbp@localhost:5432/isbp_dba_test');
const ADMIN_LOGIN = `itest_${randomBytes(3).toString('hex')}_demo_dba`;
const ADMIN_PASSWORD = `Itest-${randomBytes(9).toString('base64url')}`;
const createdGroupRoles: string[] = [];

/**
 * `demo_u_*` roles are cluster-wide: after `pnpm db:seed` on the same PostgreSQL the demo's own accounts exist,
 * and this file must not touch them — it is skipped then (it always runs on a fresh CI cluster).
 */
async function demoAccountsInCluster(): Promise<string[]> {
  const client = new pg.Client({ connectionString: dbUrl.toString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ rolname: string }>(
      "select rolname from pg_roles where rolname like 'demo\\_u\\_%'",
    );
    return rows.map((r) => r.rolname);
  } finally {
    await client.end();
  }
}
const preexisting = await demoAccountsInCluster();

const raw = (q: string) => h.kernel.db.execute(sql.raw(q));
const roleNames = async (like: string) =>
  (
    await h.kernel.db.execute<{ rolname: string }>(
      sql`select rolname from pg_roles where rolname like ${like}`,
    )
  ).rows.map((r) => r.rolname);

describe.skipIf(preexisting.length > 0)('dbaccess demo data (fresh cluster)', () => {
  beforeAll(async () => {
    h = await createHarness();
    const db = h.kernel.db;
    const present = new Set(await roleNames('demo\\_%'));
    for (const r of DEMO_ROLES)
      if (!present.has(r)) {
        await raw(`create role ${r} nologin`);
        createdGroupRoles.push(r);
      }
    // The demo's least-privilege account administrator (like isbp_demo_dba): CREATEROLE + ADMIN OPTION.
    await raw(`create role ${ADMIN_LOGIN} login createrole password '${ADMIN_PASSWORD}'`);
    await raw(`grant ${DEMO_ROLES.join(', ')} to ${ADMIN_LOGIN} with admin option`);

    const hash = await hashPassword('Integration-Test-1!');
    const mk = async (username: string, displayName: string, managerId: string | null = null) => {
      const [u] = await db
        .insert(users)
        .values({ email: `${username}@test.example`, username, displayName, managerId, passwordHash: hash })
        .returning();
      return u!.id;
    };
    await mk('helpdesk', '林雅婷', h.ids.admin);
    await mk('hr.partner', '佐藤 美咲', h.ids.admin);
    const auditor = await mk('auditor', 'Olivia Bennett', h.ids.admin);
    const groupIds: Record<string, string> = {};
    for (const key of ['dba-team', 'finance-team', 'hr-team', 'security-team']) {
      const [g] = await db.insert(groups).values({ key, name: key }).returning();
      groupIds[key] = g!.id;
    }
    await db.insert(groupMembers).values({ groupId: groupIds['security-team']!, userId: auditor });
    const people = [
      'ann.lee',
      'bo.chen',
      'cy.wu',
      'di.lin',
      'ed.ho',
      'fay.kao',
      'gus.tsai',
      'hal.yu',
      'ivy.su',
      'jo.lai',
      'ken.ma',
      'liv.ng',
      'max.ko',
      'ned.pan',
      'oli.fu',
      'pia.xu',
      'quin.he',
      'rex.lo',
      'sue.qi',
      'tim.yi',
      'uma.li',
      'vic.jo',
      'wes.do',
      'xia.bo',
    ];
    for (const [i, p] of people.entries()) {
      const id = await mk(p, p.replace('.', ' '), h.ids.admin);
      const group = ['dba-team', 'finance-team', 'hr-team', null][i % 4];
      if (group) await db.insert(groupMembers).values({ groupId: groupIds[group]!, userId: id });
    }
    const [dbaRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'dbaccess-dba'));
    await db.insert(roleAssignments).values({ roleId: dbaRole!.id, groupId: groupIds['dba-team']! });
    await h.kernel.rbac.bump();

    const base = {
      options: { tls: 'off' as const, ca: null, instanceName: null, domain: null },
      readOnly: false,
      enabled: true,
    };
    await db.insert(dbConnections).values([
      {
        key: 'contoso-erp-admin',
        name: 'Contoso ERP – account administration',
        engine: 'postgres',
        host: dbUrl.hostname,
        port: Number(dbUrl.port || 5432),
        database: dbUrl.pathname.slice(1),
        username: ADMIN_LOGIN,
        passwordSealed: h.kernel.box.encrypt(ADMIN_PASSWORD),
        purposes: ['admin'],
        ...base,
      },
      {
        key: 'hr-sql01',
        name: 'HR (SQL Server)',
        engine: 'mssql',
        host: 'sql-hr-01.corp.contoso.example',
        port: 1433,
        database: 'HRIS',
        username: 'svc_isbp',
        passwordSealed: h.kernel.box.encrypt('x'),
        purposes: ['data', 'admin'],
        status: 'error',
        ...base,
      },
      {
        key: 'fin-ora01',
        name: 'Finance (Oracle)',
        engine: 'oracle',
        host: 'ora-fin-01.corp.contoso.example',
        port: 1521,
        database: 'FINPDB',
        username: 'ISBP_ADMIN',
        passwordSealed: h.kernel.box.encrypt('x'),
        purposes: ['admin'],
        status: 'error',
        ...base,
      },
    ]);
    const m = h.kernel.registry.get('dbaccess')!;
    await m.seed!(h.kernel.registry.context('dbaccess'));
    admin = await h.login('admin');
  }, 180_000);

  afterAll(async () => {
    if (h) {
      for (const r of await roleNames('demo\\_u\\_%'))
        if (!preexisting.includes(r)) await raw(`drop role if exists "${r}"`);
      await raw(`drop role if exists "${ADMIN_LOGIN}"`);
      for (const r of createdGroupRoles) await raw(`drop role if exists "${r}"`);
      await h.close();
    }
  });

  describe('dbaccess demo data', () => {
    it('configures the three servers and their requestable roles', async () => {
      const rows = await h.kernel.db.select().from(servers);
      expect(rows.map((s) => s.displayName).sort()).toEqual([
        'Contoso ERP (PostgreSQL)',
        'Finance ledger (Oracle)',
        'HR (SQL Server)',
      ]);
      const roleRows = await h.kernel.db.select().from(requestableRoles);
      expect(roleRows.map((r) => r.roleName).sort()).toEqual(
        [
          'FIN_POSTING',
          'FIN_READONLY',
          'db_datareader',
          'demo_app_rw',
          'demo_finance_analyst',
          'demo_readonly',
          'demo_reporting',
          'hr_payroll_read',
        ].sort(),
      );
      const readonly = roleRows.find((r) => r.roleName === 'demo_readonly')!;
      expect(readonly).toMatchObject({ allowPermanent: true, ownerUserId: h.ids.admin });
      const res = await h.call(admin, 'GET', `${API}/servers`);
      expect(res.status).toBe(200);
      const erp = res.body.items.find((s: LooseJson) => s.displayName === 'Contoso ERP (PostgreSQL)');
      expect(erp).toMatchObject({ lastSyncStatus: 'ok', accountPattern: 'demo_u_{username}' });
      expect(erp.counts.unmanaged).toBeGreaterThanOrEqual(1);
      const hr = res.body.items.find((s: LooseJson) => s.displayName === 'HR (SQL Server)');
      expect(hr).toMatchObject({ authMode: 'windows', windowsDomain: 'CONTOSO', lastSyncStatus: 'ok' });
      expect(hr.counts.failed).toBe(1);
      expect(hr.counts.unmanaged).toBeGreaterThanOrEqual(2);
    });

    it('provisioned real accounts on the demo server, with a reveal waiting for admin', async () => {
      const member = await h.kernel.db.execute(sql`
      select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
       where r.rolname = 'demo_reporting' and u.rolname = 'demo_u_admin'`);
      expect(member.rows).toHaveLength(1);
      expect((await roleNames('demo\\_u\\_%')).length).toBeGreaterThanOrEqual(6);
      const [pending] = await h.kernel.db
        .select({ n: count() })
        .from(reveals)
        .where(and(eq(reveals.userId, h.ids.admin), isNotNull(reveals.secretSealed)));
      expect(pending!.n).toBe(1);
      const mine = await h.call(admin, 'GET', `${API}/me/access`);
      expect(
        mine.body.grants.some((g: LooseJson) => g.reveal?.available && g.role.roleName === 'demo_reporting'),
      ).toBe(true);
      const states = await h.kernel.db
        .select({ status: grants.status, n: count() })
        .from(grants)
        .groupBy(grants.status);
      const by = Object.fromEntries(states.map((s) => [s.status, s.n]));
      expect(by.active).toBeGreaterThanOrEqual(10);
      expect(by.failed).toBe(1);
      expect(by.expired).toBeGreaterThanOrEqual(2);
      expect(by.revoked).toBeGreaterThanOrEqual(1);
      const expiring = await h.call(admin, 'GET', `${API}/grants?status=expiring`);
      expect(expiring.body.total).toBeGreaterThanOrEqual(1);
    });

    it('shows unmanaged access and orphans, including the legacy report login', async () => {
      const res = await h.call(admin, 'GET', `${API}/unmanaged`);
      const names = res.body.items.map((u: LooseJson) => u.memberName);
      expect(names).toContain('demo_u_legacy_report');
      // The admin login holds ADMIN OPTION on the demo roles: a service account, not unmanaged access.
      expect(names).not.toContain(ADMIN_LOGIN);
      expect(names).toContain('TMPLOAD');
      expect(names).toContain('hr_app');
      const orphans = await h.call(admin, 'GET', `${API}/accounts?orphan=true&pageSize=200`);
      expect(orphans.body.items.map((a: LooseJson) => a.name)).toEqual(
        expect.arrayContaining(['TMPLOAD', 'CONTOSO\\old_contractor', 'demo_u_legacy_report']),
      );
      // The admin login of a connection is a service account, not an orphan.
      expect(orphans.body.items.map((a: LooseJson) => a.name)).not.toContain('ISBP_ADMIN');
      expect(await h.kernel.db.select({ n: count() }).from(inventoryAccounts)).not.toEqual([{ n: 0 }]);
    });

    it('has a request waiting for approval and the history', async () => {
      const reqs = await h.kernel.db
        .select({ status: requests.status, n: count() })
        .from(requests)
        .groupBy(requests.status);
      const by = Object.fromEntries(reqs.map((s) => [s.status, s.n]));
      expect(by).toMatchObject({ pending: 1, rejected: 1, cancelled: 1 });
      const [pending] = await h.kernel.db.select().from(requests).where(eq(requests.status, 'pending'));
      const [inst] = await h.kernel.db
        .select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, pending!.instanceId!));
      expect(inst!.status).toBe('running');
      const dto = await h.call(admin, 'GET', `${API}/requests/${pending!.id}`);
      expect(dto.body).toMatchObject({
        status: 'pending',
        role: { roleName: 'hr_payroll_read', risk: 'high' },
      });
    });

    it('runs the Q4 2026 access review with items for admin', async () => {
      const [review] = await h.kernel.db.select().from(reviews);
      expect(review).toMatchObject({ name: 'Q4 2026 database access review', status: 'active' });
      const items = await h.kernel.db.select().from(reviewItems).where(eq(reviewItems.reviewId, review!.id));
      expect(items.length).toBeGreaterThanOrEqual(10);
      expect(items.filter((i) => i.reviewerUserId === h.ids.admin).length).toBeGreaterThanOrEqual(3);
      expect(items.filter((i) => i.decision).length).toBeGreaterThanOrEqual(2);
      const summary = await h.call(admin, 'GET', `${API}/me/summary`);
      expect(summary.body.reviews[0]).toMatchObject({ name: 'Q4 2026 database access review' });
      expect(summary.body.reviews[0].pending).toBeGreaterThanOrEqual(2);
    });

    it('is idempotent', async () => {
      const before = await h.kernel.db.select({ n: count() }).from(grants);
      await h.kernel.registry.get('dbaccess')!.seed!(h.kernel.registry.context('dbaccess'));
      expect(await h.kernel.db.select({ n: count() }).from(grants)).toEqual(before);
      expect(await h.kernel.db.select({ n: count() }).from(accounts)).not.toEqual([{ n: 0 }]);
    });
  });
});
