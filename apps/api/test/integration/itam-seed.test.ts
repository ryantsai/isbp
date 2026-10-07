import {
  departments,
  files,
  groupMembers,
  groups,
  notifications,
  roleAssignments,
  roles,
  users,
  uuidv7,
} from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { addDays, todayIn } from '@isbp/module-itam/model';
import {
  assets,
  contracts,
  licenses,
  models,
  softwareInstallations,
  vendors,
} from '@isbp/module-itam/schema';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/** The demo data: `ISBP_TEST_MODULES=cmdb,itam`, the CMDB seed first (servers link to its CIs by name). */
let h: Harness;
let admin: Session;
const API = '/api/v1/itam';
const today = todayIn('Asia/Taipei');

const seedModule = async (id: string) => {
  const m = h.kernel.registry.get(id)!;
  await m.seed!(h.kernel.registry.context(id));
};

beforeAll(async () => {
  h = await createHarness();
  const db = h.kernel.db;
  const hash = await hashPassword(PASSWORD);
  const mk = async (username: string, displayName: string, departmentId: string | null, locale = 'en') => {
    const [u] = await db
      .insert(users)
      .values({
        email: `${username}@test.example`,
        username,
        displayName,
        departmentId,
        locale,
        passwordHash: hash,
      })
      .returning();
    return u!.id;
  };
  const helpdesk = await mk('helpdesk', '林雅婷', null, 'zh-TW');
  const manager = await mk('assets.lead', 'Grace Lee', null);
  const sec = await mk('sec1', 'Mia Chen', null);
  // The demo organisation's departments (codes the seed places devices and owners by).
  const codes = [
    'IT',
    'IT-INFRA',
    'IT-SD',
    'IT-APP',
    'IT-SEC',
    'IT-DATA',
    'HR',
    'RND',
    'OPS',
    'SALES-TYO',
    'SALES-GLB',
  ];
  const deptIds = [h.ids.salesTpe, h.ids.finance, h.ids.sales];
  for (const code of codes) {
    const id = uuidv7();
    await db.insert(departments).values({ id, code, name: code, path: `/${id}/` });
    deptIds.push(id);
  }
  await db.insert(users).values(
    Array.from({ length: 170 }, (_, i) => ({
      email: `staff${i}@test.example`,
      username: `staff${String(i).padStart(3, '0')}`,
      displayName: `Staff ${i}`,
      departmentId: deptIds[i % deptIds.length]!,
      passwordHash: hash,
    })),
  );
  const [security] = await db
    .insert(groups)
    .values({ key: 'security-team', name: 'Security Team' })
    .returning();
  await db.insert(groupMembers).values({ groupId: security!.id, userId: sec });
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'itam-asset-manager'));
  await db.insert(roleAssignments).values({ roleId: role!.id, userId: manager });
  await h.kernel.rbac.bump();
  void helpdesk;
  await seedModule('cmdb');
  await seedModule('itam');
  admin = await h.login('admin');
}, 240_000);

afterAll(async () => {
  await h?.close();
});

const n = async (
  table: typeof assets | typeof vendors | typeof models | typeof licenses | typeof contracts,
) => (await h.kernel.db.select({ n: count() }).from(table))[0]!.n;

describe('itam demo seed', () => {
  it('creates the catalogue, ~170 assets and links infrastructure to CMDB CIs by name', async () => {
    expect(await n(vendors)).toBe(12);
    expect(await n(models)).toBeGreaterThanOrEqual(15);
    expect(await n(assets)).toBeGreaterThan(100);
    const linked = await h.kernel.db
      .select({ name: assets.name, ciName: cis.name })
      .from(assets)
      .innerJoin(cis, eq(cis.id, assets.ciId));
    const names = linked.map((l) => l.name);
    for (const ci of [
      'erp-app-01',
      'erp-db-01',
      'tpe-sw-core-01',
      'tpe-fw-01',
      'vpn-gw-01',
      'nas-01',
      'print-srv-01',
      'hr-app-01',
      'wlc-01',
      'mail-relay-01',
    ])
      expect(names, ci).toContain(ci);
    expect(linked.every((l) => l.name === l.ciName)).toBe(true);
  });

  it('gives the admin AST-00001 and the service desk lead a laptop and a phone', async () => {
    const mine = await h.call(admin, 'GET', `${API}/me/assets`);
    expect(mine.body.devices.map((d: LooseJson) => d.tag)).toContain('AST-00001');
    expect(mine.body.devices.find((d: LooseJson) => d.tag === 'AST-00001').model.name).toBe(
      'MacBook Pro 14 (M4)',
    );
    const [helpdesk] = await h.kernel.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'helpdesk'));
    const held = await h.kernel.db
      .select({ category: assets.category })
      .from(assets)
      .where(eq(assets.assignedTo, helpdesk!.id));
    expect(held.map((x) => x.category).sort()).toEqual(['laptop', 'phone']);
  });

  it('has a realistic mix of statuses and warranties', async () => {
    const rows = await h.kernel.db
      .select({ status: assets.status, n: count() })
      .from(assets)
      .groupBy(assets.status);
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(by.deployed).toBeGreaterThan(50);
    expect(by.in_stock).toBeGreaterThan(5);
    expect(by.in_repair).toBe(2);
    expect(by.retired).toBe(2);
    expect(by.disposed).toBe(1);
    expect(by.lost).toBe(1);
    expect(by.ordered).toBe(3);
    const [expiring] = await h.kernel.db
      .select({ n: count() })
      .from(assets)
      .where(
        and(
          eq(assets.status, 'deployed'),
          sql`${assets.warrantyEnd} between ${today}::date and ${addDays(today, 30)}::date`,
        ),
      );
    expect(expiring!.n).toBeGreaterThan(0);
    const [expired] = await h.kernel.db
      .select({ n: count() })
      .from(assets)
      .where(sql`${assets.warrantyEnd} < ${today}::date`);
    expect(expired!.n).toBeGreaterThan(0);
    // One retired laptop waits for disposal approval.
    const [pending] = await h.kernel.db
      .select({ n: count() })
      .from(assets)
      .where(isNotNull(assets.disposalInstanceId));
    expect(pending!.n).toBe(1);
  });

  it('computes licence compliance: over-deployed, under-used, expiring and expired', async () => {
    const rows = await h.kernel.db
      .select({ product: licenses.product, state: licenses.complianceState })
      .from(licenses);
    const state = Object.fromEntries(rows.map((r) => [r.product, r.state]));
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(state['Adobe Acrobat Pro']).toBe('over_deployed');
    expect(state['AutoCAD']).toBe('under_used');
    expect(state['Veeam Backup']).toBe('expiring');
    expect(state['TeamViewer Business']).toBe('expired');
    const acrobat = (await h.call(admin, 'GET', `${API}/licenses?q=acrobat`)).body.items[0];
    expect(acrobat.unlicensed).toBeGreaterThan(0);
    const [installs] = await h.kernel.db.select({ n: count() }).from(softwareInstallations);
    expect(installs!.n).toBeGreaterThan(100);
    // Asset managers heard about it.
    const [manager] = await h.kernel.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'assets.lead'));
    const told = await h.kernel.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, manager!.id), eq(notifications.type, 'itam.license.non_compliant')),
      );
    expect(told.length).toBeGreaterThanOrEqual(2);
  });

  it('seeds contracts: one renewing within 30 days, one expired, one draft, with the signed PDF', async () => {
    const rows = await h.kernel.db.select().from(contracts);
    expect(rows.length).toBe(12);
    const dell = rows.find((c) => c.title === 'Dell ProSupport')!;
    expect(dell.status).toBe('expiring');
    expect(dell.endDate! <= addDays(today, 30)).toBe(true);
    expect(rows.filter((c) => c.status === 'expired').map((c) => c.title)).toEqual([
      'Symantec Endpoint Protection',
    ]);
    expect(rows.filter((c) => c.status === 'draft')).toHaveLength(1);
    const detail = await h.call(admin, 'GET', `${API}/contracts/${dell.id}`);
    expect(detail.body.items.length).toBe(8);
    const attachments = await h.kernel.db
      .select()
      .from(files)
      .where(and(eq(files.recordType, 'itam.contract'), eq(files.recordId, dell.id)));
    expect(attachments.map((f) => f.name)).toEqual(['Dell-ProSupport-Plus-signed.pdf']);
    const ea = await h.call(
      admin,
      'GET',
      `${API}/contracts/${rows.find((c) => c.title === 'Microsoft Enterprise Agreement')!.id}`,
    );
    expect(ea.body.licenses.map((l: LooseJson) => l.product)).toContain('Microsoft 365 E3');
  });

  it('serves every seeded record and the dashboard through the API', async () => {
    const all = await h.kernel.db.select({ id: assets.id }).from(assets);
    for (const { id } of all) {
      const res = await h.call(admin, 'GET', `${API}/assets/${id}`);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    }
    for (const path of [
      '/assets?pageSize=200&sort=-warrantyEnd',
      '/licenses?pageSize=100',
      '/contracts?pageSize=100',
      '/vendors',
      '/models?pageSize=100',
    ])
      expect((await h.call(admin, 'GET', `${API}${path}`)).status, path).toBe(200);
    const dashboard = await h.call(admin, 'GET', `${API}/dashboard`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.assets.byCategory.length).toBeGreaterThan(8);
    expect(dashboard.body.spendByVendor.length).toBeGreaterThan(5);
    expect(dashboard.body.contracts.renewing90).toBeGreaterThan(2);
    expect(dashboard.body.attention.licenses.map((l: LooseJson) => l.product)).toContain('Adobe Acrobat Pro');
  });

  it('is idempotent', async () => {
    const before = await n(assets);
    await seedModule('itam');
    expect(await n(assets)).toBe(before);
    expect(await n(vendors)).toBe(12);
  });
});
