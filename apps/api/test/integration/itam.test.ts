import {
  approvalTasks,
  auditLogs,
  groupMembers,
  groups,
  notifications,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { addDays, todayIn } from '@isbp/module-itam/model';
import { assetEvents, contracts, licenseAssignments } from '@isbp/module-itam/schema';
import { services } from '@isbp/module-itam/services';
import type { AuthContext } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<
  'am' | 'am2' | 'viewer' | 'scoped' | 'cm' | 'sec' | 'alice' | 'bob' | 'leaver',
  string
>;
const fx = {} as Record<'vendor' | 'laptopModel' | 'phoneModel' | 'serverModel', string>;

const API = '/api/v1/itam';
const itam = () => h.kernel.registry.context('itam');
const today = todayIn('Asia/Taipei');

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

async function mkUser(username: string, departmentId: string | null = null) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: `${username[0]!.toUpperCase()}${username.slice(1)}`,
      passwordHash: await hashPassword(PASSWORD),
      departmentId,
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
    {
      id: u!.id,
      email: u!.email,
      username: u!.username,
      displayName: u!.displayName,
      locale: 'en',
      timezone: 'UTC',
      departmentId: u!.departmentId,
      avatarUrl: null,
    },
    null,
    await h.kernel.rbac.permissionsFor(userId),
  );
}

const notificationsOf = (userId: string, type: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

const auditOf = (action: string, entityId?: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), entityId ? eq(auditLogs.entityId, entityId) : undefined));

const post = (who: string, path: string, body: unknown = {}) =>
  h.call(s[who]!, 'POST', `${API}${path}`, body);
const get = (who: string, path: string) => h.call(s[who]!, 'GET', `${API}${path}`);
const patch = (who: string, path: string, body: unknown) => h.call(s[who]!, 'PATCH', `${API}${path}`, body);

let serialSeq = 0;
async function newAsset(body: Record<string, unknown> = {}) {
  const res = await post('am', '/assets', {
    name: `TPE-LT-${String(++serialSeq).padStart(4, '0')}`,
    category: 'laptop',
    modelId: fx.laptopModel,
    vendorId: fx.vendor,
    serialNumber: `SN-${serialSeq}-${Date.now() % 100000}`,
    purchaseDate: addDays(today, -200),
    purchaseCost: 45000,
    warrantyEnd: addDays(today, 900),
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as LooseJson;
}

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  const db = h.kernel.db;
  ids.am = await mkUser('am');
  ids.am2 = await mkUser('am2');
  ids.viewer = await mkUser('viewer');
  ids.scoped = await mkUser('scoped');
  ids.cm = await mkUser('cm');
  ids.sec = await mkUser('sec');
  ids.alice = await mkUser('alice', h.ids.salesTpe);
  ids.bob = await mkUser('bob', h.ids.finance);
  ids.leaver = await mkUser('leaver', h.ids.salesTpe);
  const [security] = await db
    .insert(groups)
    .values({ key: 'security-team', name: 'Security Team' })
    .returning();
  await db.insert(groupMembers).values({ groupId: security!.id, userId: ids.sec });
  await db.insert(roleAssignments).values([
    { roleId: await roleId('itam-asset-manager'), userId: ids.am },
    { roleId: await roleId('itam-asset-manager'), userId: ids.am2 },
    { roleId: await roleId('itam-viewer'), userId: ids.viewer },
    {
      roleId: await roleId('itam-viewer'),
      userId: ids.scoped,
      scopeType: 'department',
      scopeDepartmentId: h.ids.sales,
    },
    { roleId: await roleId('itam-contract-manager'), userId: ids.cm },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'am', 'am2', 'viewer', 'scoped', 'cm', 'sec', 'alice', 'bob', 'outsider'])
    s[u] = await h.login(u);

  const vendor = await post('am', '/vendors', { name: 'Dell Technologies', website: 'https://www.dell.com' });
  expect(vendor.status).toBe(201);
  fx.vendor = vendor.body.id;
  expect((await post('am', '/vendors', { name: 'dell technologies' })).body.error.code).toBe('CONFLICT');
  const laptop = await post('am', '/models', {
    category: 'laptop',
    manufacturer: 'Dell',
    name: 'Latitude 7450',
  });
  expect(laptop.status).toBe(201);
  expect(laptop.body.lifespanMonths).toBe(36);
  fx.laptopModel = laptop.body.id;
  fx.phoneModel = (
    await post('am', '/models', { category: 'phone', manufacturer: 'Apple', name: 'iPhone 16' })
  ).body.id;
  fx.serverModel = (
    await post('am', '/models', { category: 'server', manufacturer: 'Dell', name: 'PowerEdge R760' })
  ).body.id;
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('hardware lifecycle', () => {
  it('registers an asset with a tag, depreciation and a timeline', async () => {
    const a = await newAsset({ attributes: {} });
    expect(a.tag).toMatch(/^AST-\d{5}$/);
    expect(a).toMatchObject({
      status: 'in_stock',
      category: 'laptop',
      currency: 'TWD',
      model: { manufacturer: 'Dell', name: 'Latitude 7450' },
      vendor: { name: 'Dell Technologies' },
      warrantyState: 'active',
      viewer: { canManage: true, canAssign: true, canDispose: false },
    });
    expect(a.depreciation.lifespanMonths).toBe(36);
    expect(a.depreciation.bookValue).toBeGreaterThan(0);
    expect(a.depreciation.bookValue).toBeLessThan(45000);
    expect(a.retireOn).toBe(a.depreciation.fullyDepreciatedOn);
    const byTag = await get('viewer', `/assets/${a.tag}`);
    expect(byTag.body.id).toBe(a.id);
    const events = await get('viewer', `/assets/${a.tag}/events`);
    expect(events.body.items.map((e: LooseJson) => e.kind)).toEqual(['created']);
    expect(await auditOf('itam.asset.created', a.id)).toHaveLength(1);
  });

  it('refuses duplicate serials (any case) and a model of another category', async () => {
    const a = await newAsset({ serialNumber: 'ABC-DUP-1' });
    const dup = await post('am', '/assets', { name: 'x', category: 'laptop', serialNumber: 'abc-dup-1' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'CONFLICT', details: { field: 'serialNumber' } });
    const wrong = await post('am', '/assets', { name: 'x', category: 'phone', modelId: fx.laptopModel });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('VALIDATION_FAILED');
    const renamed = await patch('am', `/assets/${a.id}`, {
      name: 'TPE-LT-RENAMED',
      location: 'Taipei HQ 12F',
    });
    expect(renamed.body).toMatchObject({ name: 'TPE-LT-RENAMED', location: 'Taipei HQ 12F' });
    expect((await auditOf('itam.asset.updated', a.id))[0]!.changes).toMatchObject({
      name: [expect.any(String), 'TPE-LT-RENAMED'],
    });
  });

  it('assigns (deployed, notified), refuses illegal transitions, returns to stock', async () => {
    const a = await newAsset();
    const assigned = await post('am', `/assets/${a.tag}/assign`, { userId: ids.alice, note: 'New starter' });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({ status: 'deployed', assignee: { id: ids.alice } });
    expect(await notificationsOf(ids.alice, 'itam.asset.assigned')).toHaveLength(1);
    expect(await auditOf('itam.asset.assigned', a.id)).toHaveLength(1);

    const retire = await post('am', `/assets/${a.tag}/status`, { status: 'retired' });
    expect(retire.status).toBe(409);
    expect(retire.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { from: 'deployed', to: 'retired', allowed: ['in_stock', 'in_repair', 'lost'] },
    });
    const dispose = await post('am', `/assets/${a.tag}/status`, { status: 'disposed' });
    expect(dispose.body.error.code).toBe('INVALID_TRANSITION');

    const returned = await post('am', `/assets/${a.tag}/return`, { note: 'Leaving the team' });
    expect(returned.body).toMatchObject({ status: 'in_stock', assignee: null });
    const again = await post('am', `/assets/${a.tag}/return`, {});
    expect(again.body.error.code).toBe('INVALID_STATE');
    const events = await get('am', `/assets/${a.tag}/events`);
    expect(events.body.items.map((e: LooseJson) => e.kind)).toEqual(['returned', 'assigned', 'created']);
    expect(events.body.items[1]).toMatchObject({
      user: { id: ids.alice },
      actor: { id: ids.am },
      note: 'New starter',
    });

    // Lost keeps who had it; leaving for stock releases them.
    await post('am', `/assets/${a.tag}/assign`, { userId: ids.bob });
    const lost = await post('am', `/assets/${a.tag}/status`, { status: 'lost', note: 'Left in a taxi' });
    expect(lost.body).toMatchObject({ status: 'lost', assignee: { id: ids.bob } });
    const found = await post('am', `/assets/${a.tag}/status`, { status: 'in_stock' });
    expect(found.body).toMatchObject({ status: 'in_stock', assignee: null });

    // Only managers act.
    expect((await post('viewer', `/assets/${a.tag}/assign`, { userId: ids.alice })).status).toBe(403);
    expect((await post('viewer', '/assets', { name: 'x', category: 'other' })).status).toBe(403);
  });

  it('creates an asset deployed straight to a person', async () => {
    const a = await newAsset({ category: 'phone', modelId: fx.phoneModel, assigneeId: ids.bob });
    expect(a).toMatchObject({ status: 'deployed', assignee: { id: ids.bob } });
    expect(await notificationsOf(ids.bob, 'itam.asset.assigned')).not.toHaveLength(0);
  });
});

describe('visibility', () => {
  let salesAsset: LooseJson;
  let financeAsset: LooseJson;

  beforeAll(async () => {
    salesAsset = await newAsset({ assigneeId: ids.alice }); // assigned to a Sales Taipei person
    financeAsset = await newAsset({ departmentId: h.ids.finance });
  });

  it('department readers see their departments and their people', async () => {
    const list = await get('scoped', '/assets?pageSize=200');
    expect(list.status).toBe(200);
    const tags = list.body.items.map((a: LooseJson) => a.tag);
    expect(tags).toContain(salesAsset.tag);
    expect(tags).not.toContain(financeAsset.tag);
    expect((await get('scoped', `/assets/${financeAsset.tag}`)).status).toBe(404);
    expect((await get('scoped', `/assets/${salesAsset.tag}`)).status).toBe(200);
    const salesDept = await newAsset({ departmentId: h.ids.salesTpe });
    expect((await get('scoped', `/assets/${salesDept.tag}`)).status).toBe(200);
    // Filters and quick views.
    const deployed = await get('viewer', '/assets?view=deployed&pageSize=200');
    expect(deployed.body.items.every((a: LooseJson) => a.status === 'deployed')).toBe(true);
    const bySerial = await get(
      'viewer',
      `/assets?q=${encodeURIComponent(salesAsset.serialNumber.toLowerCase())}`,
    );
    expect(bySerial.body.items.map((a: LooseJson) => a.id)).toEqual([salesAsset.id]);
    const sorted = await get('viewer', '/assets?sort=-warrantyEnd&pageSize=5');
    expect(sorted.status).toBe(200);
  });

  it('people without hardware access are denied; everyone sees their own devices', async () => {
    expect((await get('outsider', '/assets')).status).toBe(403);
    expect((await get('alice', '/assets')).status).toBe(403);
    const mine = await get('alice', '/me/assets');
    expect(mine.status).toBe(200);
    expect(mine.body.devices.map((d: LooseJson) => d.id)).toContain(salesAsset.id);
    expect(mine.body.devices[0].since).toBeTruthy();
    const none = await get('outsider', '/me/assets');
    expect(none.body.devices).toEqual([]);
  });

  it('the person page lists holdings within reach', async () => {
    const holdings = await get('viewer', `/people/${ids.alice}/holdings`);
    expect(holdings.body.assets.map((a: LooseJson) => a.id)).toContain(salesAsset.id);
    expect(Array.isArray(holdings.body.licenses)).toBe(true);
    const scoped = await get('scoped', `/people/${ids.bob}/holdings`);
    expect(scoped.body.assets).toEqual([]);
    expect(scoped.body.licenses).toBeNull();
  });
});

describe('licences and compliance', () => {
  let lic: LooseJson;

  it('creates a licence with a sealed key that only revealers see (audited)', async () => {
    const res = await post('am', '/licenses', {
      product: 'Adobe Acrobat Pro',
      publisher: 'Adobe',
      licenseType: 'per_user',
      quantity: 2,
      cost: 15800,
      billing: 'annual',
      endDate: addDays(today, 300),
      licenseKey: 'AAAA-BBBB-CCCC-DDDD-1234',
    });
    expect(res.status).toBe(201);
    lic = res.body;
    expect(lic).toMatchObject({
      reference: expect.stringMatching(/^LIC-/),
      used: 0,
      complianceState: 'compliant',
      hasKey: true,
      keyHint: '1234',
    });
    expect(JSON.stringify(lic)).not.toContain('AAAA-BBBB');
    const list = await get('viewer', '/licenses');
    expect(JSON.stringify(list.body)).not.toContain('AAAA-BBBB');
    expect((await post('viewer', `/licenses/${lic.reference}/reveal-key`)).status).toBe(403);
    const revealed = await post('am', `/licenses/${lic.reference}/reveal-key`);
    expect(revealed.body.key).toBe('AAAA-BBBB-CCCC-DDDD-1234');
    const [audit] = await auditOf('itam.license.key_revealed', lic.id);
    expect(audit).toMatchObject({ category: 'security', actorId: ids.am });
  });

  it('assignments drive usage and compliance, and over-deployment notifies asset managers', async () => {
    for (const userId of [ids.alice, ids.bob]) {
      const r = await post('am', `/licenses/${lic.reference}/assignments`, { userId });
      expect(r.status).toBe(201);
    }
    const dup = await post('am', `/licenses/${lic.reference}/assignments`, { userId: ids.bob });
    expect(dup.body.error.code).toBe('CONFLICT');
    expect((await get('am', `/licenses/${lic.reference}`)).body).toMatchObject({
      used: 2,
      complianceState: 'compliant',
    });
    const third = await post('am', `/licenses/${lic.reference}/assignments`, { userId: ids.am });
    expect(third.status).toBe(201);
    const over = await get('am', `/licenses/${lic.reference}`);
    expect(over.body).toMatchObject({ used: 3, quantity: 2, complianceState: 'over_deployed' });
    expect(await notificationsOf(ids.am, 'itam.license.non_compliant')).toHaveLength(1);
    expect(await notificationsOf(ids.am2, 'itam.license.non_compliant')).toHaveLength(1);
    expect(await auditOf('itam.license.compliance_changed', lic.id)).toHaveLength(1);

    await post('am', `/licenses/${lic.reference}/assignments`, { userId: ids.cm });
    expect(await notificationsOf(ids.am, 'itam.license.non_compliant')).toHaveLength(1); // still over: no repeat
    const seats = await get('viewer', `/licenses/${lic.reference}/assignments?pageSize=50`);
    expect(seats.body.total).toBe(4);
    for (const seat of seats.body.items.filter((x: LooseJson) => [ids.am, ids.cm].includes(x.user.id)))
      expect(
        (await h.call(s.am!, 'DELETE', `${API}/licenses/${lic.reference}/assignments/${seat.id}`)).status,
      ).toBe(204);
    expect((await get('am', `/licenses/${lic.reference}`)).body.complianceState).toBe('compliant');

    const bigger = await patch('am', `/licenses/${lic.reference}`, { quantity: 20 });
    expect(bigger.body).toMatchObject({ quantity: 20, complianceState: 'under_used' });
    await patch('am', `/licenses/${lic.reference}`, { quantity: 2 });
  });

  it('per-device licences are assigned to devices; type rules are enforced', async () => {
    const ws = await post('am', '/licenses', {
      product: 'Windows Server 2025 Datacenter',
      licenseType: 'per_device',
      quantity: 1,
      billing: 'one_time',
    });
    expect(
      (await post('am', `/licenses/${ws.body.reference}/assignments`, { userId: ids.alice })).body.error.code,
    ).toBe('VALIDATION_FAILED');
    const both = await post('am', `/licenses/${ws.body.reference}/assignments`, {
      userId: ids.alice,
      assetId: ws.body.id,
    });
    expect(both.status).toBe(400);
  });
});

describe('discovery', () => {
  it('upserts installs, removes uninstalled products and flags unlicensed devices', async () => {
    const laptop = await newAsset({ assigneeId: ids.leaver, serialNumber: 'DISC-001' });
    const first = await post('am', '/discovery/software', {
      assetSerial: 'disc-001',
      source: 'api',
      products: [
        { product: 'Adobe Acrobat Pro', publisher: 'Adobe', version: '24.1' },
        { product: 'Google Chrome', version: '129' },
      ],
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ added: 2, updated: 0, removed: 0, unlicensed: ['Adobe Acrobat Pro'] });
    const acrobat = (await get('viewer', '/licenses?q=acrobat')).body.items[0];
    const unlicensed = await get('viewer', `/licenses/${acrobat.reference}/installations?unlicensed=true`);
    expect(unlicensed.body.items.map((i: LooseJson) => i.asset.id)).toEqual([laptop.id]);
    expect(unlicensed.body.items[0]).toMatchObject({ licensed: false, managed: true });

    const second = await post('am', '/discovery/software', {
      assetId: laptop.id,
      products: [{ product: 'adobe acrobat pro', version: '24.2' }],
    });
    expect(second.body).toMatchObject({ added: 0, updated: 1, removed: 1 });
    const software = await get('viewer', `/assets/${laptop.tag}/software`);
    expect(software.body.installations.map((i: LooseJson) => [i.product, i.version, i.licensed])).toEqual([
      ['Adobe Acrobat Pro', '24.2', false],
    ]);
    // A seat for the device's user licenses the install.
    await post('am', `/licenses/${acrobat.reference}/assignments`, { userId: ids.leaver });
    const covered = await get('viewer', `/assets/${laptop.tag}/software`);
    expect(covered.body.installations[0].licensed).toBe(true);
    expect(covered.body.userLicenses.map((l: LooseJson) => l.product)).toContain('Adobe Acrobat Pro');
    expect((await post('viewer', '/discovery/software', { assetId: laptop.id, products: [] })).status).toBe(
      403,
    );
    expect((await post('am', '/discovery/software', { assetSerial: 'nope', products: [] })).status).toBe(404);
  });

  it('counts unlicensed installs in per-device usage', async () => {
    const lic = (
      await post('am', '/licenses', {
        product: 'Veeam Backup & Replication',
        licenseType: 'per_device',
        quantity: 1,
      })
    ).body;
    const s1 = await newAsset({ category: 'server', modelId: fx.serverModel, name: 'bkp-01' });
    const s2 = await newAsset({ category: 'server', modelId: fx.serverModel, name: 'bkp-02' });
    await post('am', `/licenses/${lic.reference}/assignments`, { assetId: s1.id });
    expect((await get('am', `/licenses/${lic.reference}`)).body).toMatchObject({
      used: 1,
      complianceState: 'compliant',
    });
    for (const a of [s1, s2])
      await post('am', '/discovery/software', {
        assetId: a.id,
        products: [{ product: 'Veeam Backup & Replication' }],
      });
    expect((await get('am', `/licenses/${lic.reference}`)).body).toMatchObject({
      assigned: 1,
      unlicensed: 1,
      used: 2,
      complianceState: 'over_deployed',
    });
  });
});

describe('disposal approval', () => {
  const approvePending = async (instanceId: string, who: string) => {
    const task = await eventually(
      async () =>
        (
          await h.kernel.db
            .select()
            .from(approvalTasks)
            .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')))
        )[0],
      (t) => Boolean(t),
    );
    expect(task?.assigneeId).toBe(ids[who as 'am2']);
    const res = await h.call(s[who]!, 'POST', `/api/v1/approvals/${task!.id}/approve`, { comment: 'OK' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };

  it('needs the asset manager and, for a data-bearing device with book value, information security', async () => {
    const a = await newAsset();
    expect((await post('am', `/assets/${a.tag}/dispose`, { note: 'x' })).body.error.code).toBe(
      'INVALID_TRANSITION',
    );
    await post('am', `/assets/${a.tag}/status`, { status: 'retired' });
    const requested = await post('am', `/assets/${a.tag}/dispose`, { note: 'Wipe and recycle' });
    expect(requested.status).toBe(200);
    expect(requested.body).toMatchObject({
      status: 'retired',
      viewer: { canDispose: false, transitions: [] },
    });
    const instanceId = requested.body.disposalInstanceId as string;
    expect(instanceId).toBeTruthy();
    expect((await post('am', `/assets/${a.tag}/dispose`, { note: 'again' })).body.error.code).toBe(
      'INVALID_STATE',
    );

    await approvePending(instanceId, 'am2'); // the requester (am) can't approve their own request
    await approvePending(instanceId, 'sec');
    const disposed = await eventually(
      () => get('viewer', `/assets/${a.tag}`),
      (r) => r.body.status === 'disposed',
    );
    expect(disposed.body).toMatchObject({
      status: 'disposed',
      disposalNote: 'Wipe and recycle',
      disposalInstanceId: null,
    });
    expect(disposed.body.disposedAt).toBeTruthy();
    const events = await get('viewer', `/assets/${a.tag}/events`);
    expect(events.body.items[0]).toMatchObject({ kind: 'disposed', note: 'Wipe and recycle' });
    expect(await auditOf('itam.asset.disposed', a.id)).toHaveLength(1);
  });

  it('a rejection leaves the asset retired', async () => {
    const a = await newAsset({ category: 'other', modelId: null, purchaseCost: null });
    await post('am', `/assets/${a.tag}/status`, { status: 'retired' });
    const requested = await post('am', `/assets/${a.tag}/dispose`, { note: 'Old dongle' });
    const instanceId = requested.body.disposalInstanceId as string;
    const [task] = await eventually(
      () =>
        h.kernel.db
          .select()
          .from(approvalTasks)
          .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending'))),
      (t) => t.length > 0,
    );
    const res = await h.call(s.am2!, 'POST', `/api/v1/approvals/${task!.id}/reject`, {
      comment: 'Sell it instead',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await eventually(
      () => get('viewer', `/assets/${a.tag}`),
      (r) => r.body.disposalInstanceId === null,
    );
    expect(after.body).toMatchObject({ status: 'retired', viewer: { canDispose: false } });
    expect((await get('am', `/assets/${a.tag}`)).body.viewer.canDispose).toBe(true);
    expect(await auditOf('itam.asset.disposal_rejected', a.id)).toHaveLength(1);
  });
});

describe('contracts', () => {
  const contractsSvc = () => services(itam()).contracts;

  it('creates contracts whose status follows the dates', async () => {
    const soon = await post('cm', '/contracts', {
      title: 'Dell ProSupport',
      kind: 'support',
      vendorId: fx.vendor,
      startDate: addDays(today, -700),
      endDate: addDays(today, 40),
      cost: 420000,
      billing: 'annual',
      ownerId: ids.cm,
    });
    expect(soon.status).toBe(201);
    expect(soon.body).toMatchObject({
      status: 'expiring',
      reference: expect.stringMatching(/^CTR-/),
      noticeDate: addDays(today, -20),
      daysToEnd: 40,
      annualCost: 420000,
    });
    const later = await post('cm', '/contracts', {
      title: 'Leased line',
      kind: 'service',
      startDate: addDays(today, -30),
      endDate: addDays(today, 300),
      cost: 68000,
      billing: 'monthly',
    });
    expect(later.body).toMatchObject({ status: 'active', annualCost: 816000 });
    const draft = await post('cm', '/contracts', { title: 'Draft', kind: 'other', draft: true });
    expect(draft.body.status).toBe('draft');
    const activated = await patch('cm', `/contracts/${draft.body.reference}`, { activate: true });
    expect(activated.body.status).toBe('active');
    expect((await post('viewer', '/contracts', { title: 'x', kind: 'other' })).status).toBe(403);
    expect(
      (
        await post('cm', '/contracts', {
          title: 'x',
          kind: 'other',
          startDate: today,
          endDate: addDays(today, -1),
        })
      ).status,
    ).toBe(400);
    const renewing = await get('viewer', '/contracts?renewal=90d');
    expect(renewing.body.items.map((c: LooseJson) => c.id)).toContain(soon.body.id);
    expect(renewing.body.items.map((c: LooseJson) => c.id)).not.toContain(later.body.id);
  });

  it('sends renewal reminders once per end date, and again a week before the end', async () => {
    const c = (
      await post('cm', '/contracts', {
        title: 'Reminder test',
        kind: 'support',
        startDate: addDays(today, -300),
        endDate: addDays(today, 30),
        noticeDays: 45,
        ownerId: ids.bob,
      })
    ).body;
    const reminders = async () =>
      (await notificationsOf(ids.bob, 'itam.contract.renewal_due')).filter((n) =>
        n.href?.endsWith(c.reference),
      );
    await contractsSvc().daily(today);
    expect(await reminders()).toHaveLength(1);
    expect(await notificationsOf(ids.cm, 'itam.contract.renewal_due')).not.toHaveLength(0);
    await contractsSvc().daily(today);
    await contractsSvc().daily(addDays(today, 10));
    expect(await reminders()).toHaveLength(1);
    await contractsSvc().daily(addDays(today, 24)); // 6 days before the end
    expect(await reminders()).toHaveLength(2);
    await contractsSvc().daily(addDays(today, 25));
    expect(await reminders()).toHaveLength(2);
    const [row] = await h.kernel.db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(row).toMatchObject({ lastReminderFor: c.endDate, lastRemindedOn: addDays(today, 24) });
  });

  it('expires contracts past their end and rolls auto-renewals over', async () => {
    const ending = (
      await post('cm', '/contracts', {
        title: 'Ends soon',
        kind: 'support',
        startDate: addDays(today, -360),
        endDate: addDays(today, 2),
      })
    ).body;
    const auto = (
      await post('cm', '/contracts', {
        title: 'Auto renews',
        kind: 'subscription',
        startDate: addDays(today, -363),
        endDate: addDays(today, 1),
        autoRenew: true,
      })
    ).body;
    const result = await contractsSvc().daily(addDays(today, 5));
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect((await get('viewer', `/contracts/${ending.reference}`)).body.status).toBe('expired');
    expect(await auditOf('itam.contract.expired', ending.id)).toHaveLength(1);
    const renewed = (await get('viewer', `/contracts/${auto.reference}`)).body;
    expect(renewed.startDate).toBe(addDays(today, 2));
    expect(renewed.endDate > addDays(today, 300)).toBe(true);
    const [audit] = await auditOf('itam.contract.renewed', auto.id);
    expect(audit!.metadata).toMatchObject({ automatic: true });
  });

  it('renews, cancels, covers items and keeps the history', async () => {
    const c = (
      await post('cm', '/contracts', {
        title: 'Cisco SmartNet',
        kind: 'maintenance',
        startDate: addDays(today, -365),
        endDate: addDays(today, 10),
        cost: 380000,
      })
    ).body;
    const tooEarly = await post('cm', `/contracts/${c.reference}/renew`, { endDate: addDays(today, 5) });
    expect(tooEarly.status).toBe(400);
    const renewed = await post('cm', `/contracts/${c.reference}/renew`, {
      endDate: addDays(today, 375),
      cost: 399000,
      note: '3% uplift',
    });
    expect(renewed.body).toMatchObject({
      startDate: addDays(today, 11),
      endDate: addDays(today, 375),
      cost: 399000,
      status: 'active',
    });
    const a = await newAsset();
    const lic = (await get('viewer', '/licenses?q=acrobat')).body.items[0];
    const covered = await h.call(s.cm!, 'PUT', `${API}/contracts/${c.reference}/items`, {
      assetIds: [a.id],
      licenseIds: [lic.id],
    });
    expect(covered.body.items).toHaveLength(2);
    expect(
      (await get('viewer', `/assets/${a.tag}/contracts`)).body.items.map((x: LooseJson) => x.id),
    ).toEqual([c.id]);
    expect((await get('scoped', `/assets/${a.tag}/contracts`)).status).toBe(403);
    const history = await get('viewer', `/contracts/${c.reference}/history`);
    expect(history.body.items.map((x: LooseJson) => x.action)).toEqual([
      'itam.contract.items_updated',
      'itam.contract.renewed',
      'itam.contract.created',
    ]);
    const cancelled = await post('cm', `/contracts/${c.reference}/cancel`, { note: 'Replaced' });
    expect(cancelled.body.status).toBe('cancelled');
    expect(
      (await post('cm', `/contracts/${c.reference}/renew`, { endDate: addDays(today, 900) })).body.error.code,
    ).toBe('INVALID_STATE');
  });
});

describe('people who leave', () => {
  it('reclaims seats, asks for devices back and tells the asset managers, once', async () => {
    const laptop = await newAsset({ assigneeId: ids.leaver });
    const before = await h.kernel.db
      .select()
      .from(licenseAssignments)
      .where(eq(licenseAssignments.userId, ids.leaver));
    expect(before.length).toBeGreaterThan(0);
    const handler = h.kernel.registry.get('itam')!.events!['core.user.offboarded']!;
    const event = {
      id: 'e1',
      name: 'core.user.offboarded',
      moduleId: 'core',
      payload: { userId: ids.leaver, email: 'leaver@test.example', reason: null },
      actor: null,
      occurredAt: new Date().toISOString(),
    };
    await handler(event, itam());
    await handler(event, itam()); // at-least-once delivery
    expect(
      await h.kernel.db.select().from(licenseAssignments).where(eq(licenseAssignments.userId, ids.leaver)),
    ).toHaveLength(0);
    const unassigned = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'itam.license.unassigned'));
    expect(unassigned.filter((a) => (a.metadata as LooseJson)?.reason === 'offboarded')).toHaveLength(
      before.length,
    );
    const requests = await h.kernel.db
      .select()
      .from(assetEvents)
      .where(and(eq(assetEvents.kind, 'return_requested'), eq(assetEvents.userId, ids.leaver)));
    expect(requests.length).toBeGreaterThanOrEqual(2); // this laptop and the discovery one
    expect(requests.map((r) => r.assetId)).toContain(laptop.id);
    expect((await get('viewer', `/assets/${laptop.tag}`)).body.status).toBe('deployed');
    expect(await notificationsOf(ids.am, 'itam.offboarding.return')).toHaveLength(1);
  });
});

describe('records, links and files', () => {
  it('resolves assets for hardware readers and for their own assignee only', async () => {
    const a = await newAsset({ assigneeId: ids.alice });
    const ref = { type: 'itam.asset', id: a.id };
    const asViewer = await h.kernel.records.get(ref, await authOf(ids.viewer));
    expect(asViewer).toMatchObject({
      reference: a.tag,
      title: a.name,
      href: `/itam/hardware/${a.tag}`,
      editable: false,
      status: { key: 'itam.status.deployed', tone: 'success' },
    });
    expect((await h.kernel.records.get(ref, await authOf(ids.am)))?.editable).toBe(true);
    const own = await h.kernel.records.get(ref, await authOf(ids.alice));
    expect(own).toMatchObject({ href: '/itam/mine', editable: false });
    expect(await h.kernel.records.get(ref, await authOf(ids.bob))).toBeNull();
    expect(
      await h.kernel.records.get({ type: 'itam.asset', id: 'not-a-uuid' }, await authOf(ids.am)),
    ).toBeNull();

    const found = await h.kernel.records.search(a.tag, { auth: await authOf(ids.am), types: ['itam.asset'] });
    expect(found[0]).toMatchObject({ id: a.id, reference: a.tag });
    const ownSearch = await itam().records.search('', { auth: await authOf(ids.alice) });
    expect(ownSearch.every((r) => r.type !== 'itam.asset' || r.href === '/itam/mine')).toBe(true);
    const resolver = h.kernel.registry.get('itam')!.records!.asset!;
    const mine = await resolver.search('', itam(), await authOf(ids.alice), 25);
    expect(mine.map((r) => r.id)).toContain(a.id);
    expect(mine.every((r) => r.editable === false)).toBe(true);

    const lic = (await get('viewer', '/licenses?q=acrobat')).body.items[0];
    expect(
      await h.kernel.records.get({ type: 'itam.license', id: lic.id }, await authOf(ids.scoped)),
    ).toBeNull();
    expect(
      await h.kernel.records.get({ type: 'itam.license', id: lic.id }, await authOf(ids.viewer)),
    ).toMatchObject({
      reference: lic.reference,
      status: { key: expect.stringMatching(/^itam\.compliance\./) },
    });
    expect(
      await h.kernel.records.get({ type: 'itam.license', id: lic.id }, await authOf(ids.alice)),
    ).toBeNull();
  });

  it('links an asset to a contract and attaches a file through the record routes', async () => {
    const a = await newAsset();
    const c = (await post('cm', '/contracts', { title: 'Warranty pack', kind: 'warranty' })).body;
    const linked = await h.call(s.am!, 'POST', `/api/v1/records/itam.asset/${a.id}/links`, {
      to: { type: 'itam.contract', id: c.id },
    });
    expect(linked.status).toBe(201);
    const links = await h.call(s.viewer!, 'GET', `/api/v1/records/itam.asset/${a.id}/links`);
    expect(links.body.links[0].record).toMatchObject({ type: 'itam.contract', reference: c.reference });
    expect(
      (
        await h.call(s.viewer!, 'POST', `/api/v1/records/itam.asset/${a.id}/links`, {
          to: { type: 'itam.contract', id: c.id },
        })
      ).status,
    ).toBe(403);

    const boundary = '----itam-test';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="invoice.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      Buffer.from('Invoice INV-2026-0042 for TPE-LT'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await h.app.inject({
      method: 'POST',
      url: `/api/v1/records/itam.asset/${a.id}/files`,
      payload,
      headers: {
        cookie: s.am!.cookie,
        'x-csrf-token': s.am!.csrf,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const files = await h.call(s.viewer!, 'GET', `/api/v1/records/itam.asset/${a.id}/files`);
    expect(files.body.files.map((f: LooseJson) => f.name)).toEqual(['invoice.txt']);
    expect(files.body.record.editable).toBe(false);
  });
});

describe('AI tools, search and the dashboard', () => {
  const tools = () => itam().ai.tools;

  it('find, get and my assets respect the caller', async () => {
    const a = await newAsset({ assigneeId: ids.alice, serialNumber: 'AI-SERIAL-9' });
    const viewer = await authOf(ids.viewer);
    const found = await tools().invoke<LooseJson>(
      'itam.find_assets',
      { query: 'ai-serial-9' },
      { auth: viewer },
    );
    expect(found.items.map((x: LooseJson) => x.tag)).toEqual([a.tag]);
    const byPerson = await tools().invoke<LooseJson>(
      'itam.find_assets',
      { assignee: 'alice@test.example' },
      { auth: viewer },
    );
    expect(byPerson.items.map((x: LooseJson) => x.tag)).toContain(a.tag);
    const got = await tools().invoke<LooseJson>('itam.get_asset', { reference: a.tag }, { auth: viewer });
    expect(got).toMatchObject({ tag: a.tag, assignee: 'Alice', vendor: 'Dell Technologies' });
    expect(got.history.length).toBeGreaterThan(0);
    const bySerial = await tools().invoke<LooseJson>(
      'itam.get_asset',
      { serial: 'ai-serial-9' },
      { auth: viewer },
    );
    expect(bySerial.id).toBe(a.id);
    const alice = await authOf(ids.alice);
    await expect(tools().invoke('itam.find_assets', {}, { auth: alice })).rejects.toMatchObject({
      statusCode: 403,
    });
    const mine = await tools().invoke<LooseJson>('itam.my_assets', {}, { auth: alice });
    expect(mine.devices.map((d: LooseJson) => d.tag)).toContain(a.tag);
    expect(mine.software.map((x: LooseJson) => x.product)).toContain('Adobe Acrobat Pro');
    await expect(
      tools().invoke('itam.get_asset', { reference: a.tag }, { auth: await authOf(ids.scoped) }),
    ).resolves.toBeTruthy();
    const finance = await newAsset({ departmentId: h.ids.finance });
    await expect(
      tools().invoke('itam.get_asset', { id: finance.id }, { auth: await authOf(ids.scoped) }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reports licence compliance and expiring contracts', async () => {
    const compliance = await tools().invoke<LooseJson>(
      'itam.license_compliance',
      { product: 'veeam' },
      { auth: await authOf(ids.viewer) },
    );
    expect(compliance.items[0]).toMatchObject({
      product: 'Veeam Backup & Replication',
      state: 'over_deployed',
      unlicensedInstalls: 1,
    });
    const expiring = await tools().invoke<LooseJson>(
      'itam.expiring_contracts',
      { days: 60 },
      { auth: await authOf(ids.cm) },
    );
    expect(expiring.items.map((c: LooseJson) => c.title)).toContain('Dell ProSupport');
    expect(expiring.items.every((c: LooseJson) => c.daysToEnd <= 60)).toBe(true);
    await expect(
      tools().invoke('itam.expiring_contracts', {}, { auth: await authOf(ids.alice) }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('global search, the dashboard and the attention counts', async () => {
    const hits = await h.call(s.viewer!, 'GET', '/api/v1/platform/search?q=acrobat');
    expect(hits.status).toBe(200);
    expect(JSON.stringify(hits.body)).toContain('Adobe Acrobat Pro');
    const dashboard = await get('viewer', '/dashboard');
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);
    expect(dashboard.body.assets.total).toBeGreaterThan(10);
    expect(dashboard.body.assets.byStatus.deployed).toBeGreaterThan(0);
    expect(dashboard.body.assets.bookValue).toBeGreaterThan(0);
    expect(dashboard.body.assets.bookValue).toBeLessThan(dashboard.body.assets.purchaseCost);
    expect(dashboard.body.software.nonCompliant).toBeGreaterThan(0);
    expect(dashboard.body.contracts.renewing90).toBeGreaterThan(0);
    expect(dashboard.body.spendByVendor[0].vendor.name).toBe('Dell Technologies');
    const scoped = await get('scoped', '/dashboard');
    expect(scoped.body.assets.total).toBeLessThan(dashboard.body.assets.total);
    expect(scoped.body.software).toBeNull(); // department-scoped: software is a global permission
    const attention = await get('am', '/attention');
    expect(attention.body).toMatchObject({
      nonCompliantLicenses: expect.any(Number),
      contractsRenewing30: expect.any(Number),
    });
    expect((await get('outsider', '/attention')).status).toBe(403);
    const settings = await get('alice', '/settings');
    expect(settings.body).toMatchObject({
      currency: 'TWD',
      warrantyDays: 30,
      underUsedPercent: 60,
      canEditSettings: false,
    });
    const vendors = await get('cm', '/vendors');
    expect(vendors.body.items[0]).toMatchObject({
      name: 'Dell Technologies',
      counts: { contracts: expect.any(Number) },
    });
    expect((await get('alice', '/vendors')).status).toBe(403);
    const vendor = await get('viewer', `/vendors/${fx.vendor}`);
    expect(vendor.body.contracts.length).toBeGreaterThan(0);
    const cisLookup = await get('am', '/lookups/cis?q=x');
    expect(cisLookup.status).toBe(200);
  });
});
