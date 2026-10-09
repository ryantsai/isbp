/**
 * Information security (module `isms`): the asset register (numbering per site and class, value = max(C,I,A),
 * permissions, import and export, record facts, create from other records), stocktakes, shared accounts (people
 * leaving and moving), the shared-account process action, account reviews (import, decisions, sign-off,
 * recurrence, tickets), the asset-class customisation kind and the seed.
 */
import {
  applications,
  auditLogs,
  notifications,
  outboxEvents,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { formatAssetNumber, todayIn } from '@isbp/module-isms/model';
import {
  accountEvents,
  assets,
  reviewItems,
  reviews,
  sharedAccounts,
  stocktakes,
} from '@isbp/module-isms/schema';
import { services } from '@isbp/module-isms/services';
import { type AuthContext, type Db, PermissionSet, type ServerModule } from '@isbp/sdk/server';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<
  'am' | 'sec' | 'viewer' | 'mgr' | 'mgr2' | 'custodian' | 'm1' | 'm2' | 'm3' | 'reviewer' | 'cfg',
  string
>;
const API = '/api/v1/isms';
const ctx = () => h.kernel.registry.context('isms');
const today = todayIn('Asia/Taipei');

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

/** What a process action runs as: a system principal holding only `isms.*`. */
function moduleAuth(): AuthContext {
  const permissions = new PermissionSet([{ p: 'isms.*', s: 'g' }]);
  return {
    principal: { type: 'system', id: null, name: 'form:shared-account' },
    user: null,
    sessionId: null,
    permissions,
    can: (p, r) => permissions.can(p, r),
    require(p, r) {
      if (!permissions.can(p, r)) throw new Error('forbidden');
    },
    reach: (p) => permissions.reach(p),
  };
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
const outboxOf = (name: string) => h.kernel.db.select().from(outboxEvents).where(eq(outboxEvents.name, name));

const get = (who: string, path: string) => h.call(s[who]!, 'GET', `${API}${path}`);
const post = (who: string, path: string, body: unknown = {}) =>
  h.call(s[who]!, 'POST', `${API}${path}`, body);
const patch = (who: string, path: string, body: unknown) => h.call(s[who]!, 'PATCH', `${API}${path}`, body);
const del = (who: string, path: string) => h.call(s[who]!, 'DELETE', `${API}${path}`);

/** The default taxonomy's ids by code/key. */
const tx = {} as {
  cls: Record<string, string>;
  sub: Record<string, string>;
  label: Record<string, string>;
  hq: string;
  t1: string;
  t2: string;
};

async function newAsset(who: string, body: Record<string, unknown>) {
  const res = await post(who, '/assets', {
    name: 'Asset',
    classId: tx.cls.HW,
    siteId: tx.t1,
    confidentiality: 1,
    integrity: 1,
    availability: 1,
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as LooseJson;
}

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  ids.am = await mkUser('am');
  ids.sec = await mkUser('sec');
  ids.viewer = await mkUser('viewer');
  ids.mgr = await mkUser('mgr');
  ids.mgr2 = await mkUser('mgr2');
  ids.custodian = await mkUser('custodian');
  ids.m1 = await mkUser('member1', h.ids.sales);
  ids.m2 = await mkUser('member2', h.ids.sales);
  ids.m3 = await mkUser('member3');
  ids.reviewer = await mkUser('reviewer');
  ids.cfg = await mkUser('cfg');
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('isms-asset-manager'), userId: ids.am },
    { roleId: await roleId('isms-security-officer'), userId: ids.sec },
    { roleId: await roleId('isms-viewer'), userId: ids.viewer },
    { roleId: await roleId('isms-admin'), userId: ids.cfg },
  ]);
  await h.kernel.rbac.bump();
  for (const u of [
    'admin',
    'am',
    'sec',
    'viewer',
    'mgr',
    'mgr2',
    'custodian',
    'member1',
    'reviewer',
    'cfg',
    'outsider',
  ])
    s[u] = await h.login(u);
}, 180_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('seed', () => {
  it('fills the demo once (assets of every class, a stocktake, two accounts, a review) and is idempotent', async () => {
    const m = h.kernel.registry.get('isms')!;
    await m.seed!(ctx());
    const n = async () => (await h.kernel.db.select({ n: count() }).from(assets))[0]!.n;
    const first = await n();
    expect(first).toBeGreaterThanOrEqual(15);
    await m.seed!(ctx());
    expect(await n()).toBe(first);
    const codes = await h.kernel.db.execute<{ code: string }>(
      sql`select distinct c.code from isms.assets a join isms.classes c on c.id = a.class_id order by 1`,
    );
    expect(codes.rows.map((r) => r.code)).toEqual(['DA', 'HW', 'PE', 'SV', 'SW']);
    expect(await h.kernel.db.select().from(stocktakes).where(eq(stocktakes.status, 'open'))).toHaveLength(1);
    const accounts = await h.kernel.db.select().from(sharedAccounts);
    expect(accounts).toHaveLength(2);
    expect(accounts.filter((a) => a.passwordDueSince !== null).length).toBeLessThanOrEqual(1);
    expect(await h.kernel.db.select().from(reviews).where(eq(reviews.status, 'open'))).toHaveLength(1);
    // Six accounts in the demo; fewer here, where the same person plays several parts.
    const items = (await h.kernel.db.select({ n: count() }).from(reviewItems))[0]!.n;
    expect(items).toBeGreaterThanOrEqual(4);
    expect(items).toBeLessThanOrEqual(6);
  });
});

describe('taxonomy', () => {
  it('starts with the default classes, sub-classes, labels and a site, readable by register readers only', async () => {
    const res = await get('viewer', '/taxonomy');
    expect(res.status).toBe(200);
    const t = res.body as LooseJson;
    expect(t.classes.map((c: LooseJson) => c.code)).toEqual(['PE', 'HW', 'SW', 'DA', 'SV']);
    const hw = t.classes.find((c: LooseJson) => c.code === 'HW');
    expect(hw.subclasses.map((x: LooseJson) => x.key)).toEqual([
      'servers',
      'network-devices',
      'portable-media',
      'mobile-devices',
      'iot-devices',
    ]);
    expect(hw.guidance.a['4'].en).toMatch(/8 hours/);
    expect(hw.guidance.a['4']['zh-TW']).toBeTruthy();
    expect(hw.guidance.a['4']['ja-JP']).toBeTruthy();
    expect(t.labels.map((l: LooseJson) => l.key)).toEqual([
      'strictly-confidential',
      'customer-confidential',
      'confidential',
      'internal-use-only',
    ]);
    expect(t.sites.map((x: LooseJson) => x.code)).toContain('HQ01');
    expect((await get('outsider', '/taxonomy')).status).toBe(403);
    tx.cls = Object.fromEntries(t.classes.map((c: LooseJson) => [c.code, c.id]));
    tx.sub = Object.fromEntries(
      t.classes.flatMap((c: LooseJson) => c.subclasses.map((x: LooseJson) => [x.key, x.id])),
    );
    tx.label = Object.fromEntries(t.labels.map((l: LooseJson) => [l.key, l.id]));
    tx.hq = t.sites.find((x: LooseJson) => x.code === 'HQ01').id;
  });

  it('lets administrators add sites and classes; codes are unique and fixed', async () => {
    expect((await post('am', '/config/sites', { code: 'TST1', name: 'Test site' })).status).toBe(403);
    const t1 = await post('cfg', '/config/sites', { code: 'TST1', name: 'Test site 1' });
    expect(t1.status).toBe(201);
    tx.t1 = t1.body.id;
    tx.t2 = (await post('cfg', '/config/sites', { code: 'TST2', name: 'Test site 2' })).body.id;
    const dup = await post('cfg', '/config/sites', { code: 'TST1', name: 'Again' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe('VALIDATION_FAILED');
    expect((await post('cfg', '/config/sites', { code: 'bad code', name: 'x' })).status).toBe(400);

    const lv = { '1': { en: 'Low' }, '2': {}, '3': {}, '4': { en: 'High' } };
    const created = await post('cfg', '/config/classes', {
      code: 'NW',
      name: { en: 'Network', 'zh-TW': '網路', 'ja-JP': 'ネットワーク' },
      guidance: { c: lv, i: lv, a: lv },
      subclasses: [{ key: 'links', name: { en: 'Links' } }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.subclasses).toHaveLength(1);
    const renamed = await patch('cfg', `/config/classes/${created.body.id}`, { code: 'NX' });
    expect(renamed.status).toBe(400);
    const updated = await patch('cfg', `/config/classes/${created.body.id}`, {
      subclasses: [{ key: 'wan', name: { en: 'WAN' } }],
    });
    expect(updated.status).toBe(200);
    // The sub-class left out is archived, not deleted (assets may use it).
    expect(updated.body.subclasses.map((x: LooseJson) => [x.key, x.archived])).toEqual([
      ['links', true],
      ['wan', false],
    ]);
    const archived = await post('cfg', `/config/classes/${created.body.id}/archive`);
    expect(archived.body.archived).toBe(true);
    expect((await get('viewer', '/taxonomy')).body.classes.map((c: LooseJson) => c.code)).not.toContain('NW');
    expect(await auditOf('isms.class.archived', created.body.id)).toHaveLength(1);
    expect((await outboxOf('isms.taxonomy.changed')).length).toBeGreaterThanOrEqual(4);
  });
});

describe('the register', () => {
  it('numbers assets per site and class and stores value = max(C, I, A)', async () => {
    const a = await newAsset('am', {
      name: 'Core switch',
      subclassId: tx.sub['network-devices'],
      confidentiality: 3,
      integrity: 1,
      availability: 4,
      managerId: ids.mgr,
      classificationId: tx.label.confidential,
      location: 'Rack A1',
      userIds: [ids.m1],
    });
    expect(a.number).toBe('TST1HW0001');
    expect(a.value).toBe(4);
    expect(a.users.map((u: LooseJson) => u.id)).toEqual([ids.m1]);
    expect((await newAsset('am', { name: 'Edge router' })).number).toBe('TST1HW0002');
    expect((await newAsset('am', { name: 'OS', classId: tx.cls.SW })).number).toBe('TST1SW0001');
    expect((await newAsset('am', { name: 'Remote switch', siteId: tx.t2 })).number).toBe('TST2HW0001');
    expect(await auditOf('isms.asset.created', a.id)).toHaveLength(1);
    expect(
      (await outboxOf('isms.asset.created')).some((e) => (e.payload as LooseJson).assetId === a.id),
    ).toBe(true);
  });

  it('refuses invalid scores, sub-classes of another class and people who aren’t active', async () => {
    const base = { name: 'x', classId: tx.cls.HW, siteId: tx.t1, integrity: 1, availability: 1 };
    expect((await post('am', '/assets', { ...base, confidentiality: 5 })).status).toBe(400);
    const wrongSub = await post('am', '/assets', {
      ...base,
      confidentiality: 1,
      subclassId: tx.sub['operating-systems'],
    });
    expect(wrongSub.status).toBe(400);
    expect(wrongSub.body.error.details.issues[0].path).toBe('subclassId');
    expect((await post('viewer', '/assets', { ...base, confidentiality: 1 })).status).toBe(403);
    expect((await post('outsider', '/assets', { ...base, confidentiality: 1 })).status).toBe(403);
  });

  it('recomputes the value on change, keeps the number when the class moves, and keeps a history', async () => {
    const a = await newAsset('am', { name: 'Old name', confidentiality: 1 });
    const changed = await patch('am', `/assets/${a.number}`, { confidentiality: 3, name: 'New name' });
    expect(changed.status).toBe(200);
    expect(changed.body.value).toBe(3);
    const moved = await patch('am', `/assets/${a.number}`, { classId: tx.cls.SV });
    expect(moved.body.number).toBe(a.number);
    expect(moved.body.class.code).toBe('SV');
    const history = await get('viewer', `/assets/${a.number}/events`);
    expect(history.body.items.map((e: LooseJson) => e.kind)).toEqual(['updated', 'updated', 'created']);
    expect(history.body.items[1].changes.confidentiality).toEqual([1, 3]);
    expect((await patch('viewer', `/assets/${a.number}`, { name: 'x' })).status).toBe(403);
    expect((await del('am', `/assets/${a.number}`)).status).toBe(204);
    expect((await get('viewer', `/assets/${a.number}`)).status).toBe(404);
    expect(await auditOf('isms.asset.deleted', a.id)).toHaveLength(1);
  });

  it('filters by class, value, site, classification and manager', async () => {
    const list = async (q: string) => (await get('viewer', `/assets?${q}`)).body as LooseJson;
    expect((await list(`site=${tx.t1}&class=${tx.cls.HW}`)).total).toBe(2);
    expect((await list(`site=${tx.t1}&minValue=4`)).items.map((a: LooseJson) => a.number)).toEqual([
      'TST1HW0001',
    ]);
    expect((await list(`manager=${ids.mgr}`)).items.map((a: LooseJson) => a.number)).toContain('TST1HW0001');
    expect((await list(`classification=${tx.label.confidential}&site=${tx.t1}`)).total).toBe(1);
    expect((await list('q=TST1HW')).total).toBe(2);
    expect((await get('outsider', '/assets')).status).toBe(403);
  });

  it('serves the asset as a record with approval facts, to register readers only', async () => {
    const [row] = await h.kernel.db.select().from(assets).where(eq(assets.number, 'TST1HW0001'));
    const ref = { type: 'isms.asset', id: row!.id };
    const facts = await h.kernel.records.facts([ref]);
    expect(facts.get(`isms.asset:${row!.id}`)).toEqual({
      classCode: 'HW',
      subClass: 'network-devices',
      confidentiality: 3,
      integrity: 1,
      availability: 4,
      value: 4,
      classification: 'confidential',
      managerId: ids.mgr,
      managerGroup: null,
      siteCode: 'TST1',
      status: 'active',
    });
    expect(await h.kernel.records.get(ref, await authOf(ids.viewer))).toMatchObject({
      reference: 'TST1HW0001',
      href: '/isms/assets/TST1HW0001',
      editable: false,
    });
    expect((await h.kernel.records.get(ref, await authOf(ids.am)))?.editable).toBe(true);
    expect(await h.kernel.records.get(ref, await authOf(ids.mgr2))).toBeNull();
  });

  it('exports CSV with a BOM in the register’s column order, in the reader’s language', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${API}/assets/export.csv?site=${tx.t1}&locale=zh-TW`,
      headers: { cookie: s.viewer!.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    const lines = res.body.slice(1).split('\r\n');
    expect(lines[0]!.split(',').slice(0, 15)).toEqual([
      '資產編號',
      '資產名稱',
      '大類',
      '小類',
      '資產管理者',
      '資產使用者',
      '存放位置',
      '廠牌',
      '型號',
      '版本',
      '數量',
      '機密性',
      '完整性',
      '可用性',
      '資產價值',
    ]);
    expect(lines.find((l) => l.startsWith('TST1HW0001'))).toContain('硬體');
    expect(await auditOf('isms.asset.exported')).not.toHaveLength(0);
  });

  it('imports CSV: a dry run reports, then rows create and update; bad rows are left out', async () => {
    const csv = [
      'Asset number,Asset name,Class,Sub-class,Asset manager,Location,Confidentiality,Integrity,Availability,Site,Classification',
      `TST1HW0002,Edge router (renamed),,,,Rack B2,,,,,`,
      `,Customer database,DA,Electronic records,mgr,DC,4,4,3,TST1,Customer Confidential`,
      `TST1SW0042,Licensed tool,SW,,mgr2@test.example,,2,2,2,TST1,`,
      `,Broken row,ZZ,,,,9,1,1,TST1,`,
      `,No site,HW,,,,1,1,1,NOPE,`,
    ].join('\n');
    const dry = await post('am', '/assets/import', { csv, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({
      dryRun: true,
      error: null,
      rows: 5,
      created: 2,
      updated: 1,
      skipped: 2,
    });
    expect(dry.body.issues.map((i: LooseJson) => [i.line, i.column, i.code])).toEqual([
      [5, 'class', 'unknownClass'],
      [5, 'confidentiality', 'badLevel'],
      [6, 'site', 'unknownSite'],
    ]);
    expect((await get('viewer', '/assets?q=Customer database')).body.total).toBe(0);
    expect((await post('viewer', '/assets/import', { csv, dryRun: true })).status).toBe(403);

    const real = await post('am', '/assets/import', { csv, dryRun: false });
    expect(real.body).toMatchObject({ dryRun: false, created: 2, updated: 1, skipped: 2 });
    const db = (await get('viewer', '/assets?q=Customer database')).body.items[0];
    expect(db).toMatchObject({
      number: 'TST1DA0001',
      value: 4,
      classification: { key: 'customer-confidential' },
    });
    expect(db.subclass.key).toBe('electronic-records');
    expect(db.manager.id).toBe(ids.mgr);
    expect((await get('viewer', '/assets/TST1HW0002')).body).toMatchObject({
      name: 'Edge router (renamed)',
      location: 'Rack B2',
    });
    // A number given in the file is kept and moves the series' counter past it.
    expect((await get('viewer', '/assets/TST1SW0042')).body.manager.id).toBe(ids.mgr2);
    expect((await newAsset('am', { name: 'Next tool', classId: tx.cls.SW })).number).toBe('TST1SW0043');
    expect(await auditOf('isms.asset.imported')).toHaveLength(1);

    // An export imported again (here in Japanese) changes nothing.
    const exported = await h.app.inject({
      method: 'GET',
      url: `${API}/assets/export.csv?site=${tx.t1}&locale=ja-JP`,
      headers: { cookie: s.am!.cookie },
    });
    const round = await post('am', '/assets/import', { csv: exported.body, dryRun: true });
    expect(round.body, JSON.stringify(round.body.issues)).toMatchObject({
      error: null,
      created: 0,
      updated: 0,
      skipped: 0,
    });
    expect(round.body.unchanged).toBe(round.body.rows);
    expect(round.body.rows).toBeGreaterThanOrEqual(5);

    const missing = await post('am', '/assets/import', { csv: 'Foo,Bar\n1,2', dryRun: true });
    expect(missing.body).toMatchObject({ error: 'missingColumns', missing: ['name'] });
  });

  it('registers CMDB configuration items as assets in bulk, linked and only once', async () => {
    const ci = await h.call(s.admin!, 'POST', '/api/v1/cmdb/cis', { name: 'erp-app-01', classKey: 'server' });
    expect(ci.status, JSON.stringify(ci.body)).toBe(201);
    const found = await get('admin', `/sources?type=cmdb.ci&q=erp-app`);
    expect(found.status).toBe(200);
    const ref = `cmdb.ci:${ci.body.id}`;
    expect(found.body.items.find((r: LooseJson) => r.ref === ref)?.registered).toBeNull();
    const body = {
      refs: [ref, 'cmdb.ci:0192b9a0-0000-7000-8000-00000000dead'],
      classId: tx.cls.HW,
      subclassId: tx.sub.servers,
      siteId: tx.t1,
      confidentiality: 2,
      integrity: 1,
      availability: 3,
    };
    const res = await post('admin', '/assets/from-records', body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.created.map((a: LooseJson) => a.name)).toEqual(['erp-app-01']);
    expect(res.body.skipped).toEqual([
      { ref: 'cmdb.ci:0192b9a0-0000-7000-8000-00000000dead', reason: 'hidden' },
    ]);
    const again = await post('admin', '/assets/from-records', body);
    expect(again.body.created).toEqual([]);
    expect(again.body.skipped[0]).toEqual({ ref, reason: 'registered' });
    const asset = res.body.created[0];
    const linked = await h.kernel.records.linked({ type: 'isms.asset', id: asset.id });
    expect(linked).toContainEqual({ type: 'cmdb.ci', id: ci.body.id });
    expect(
      (await get('admin', `/sources?type=cmdb.ci&q=erp-app`)).body.items.find((r: LooseJson) => r.ref === ref)
        .registered.number,
    ).toBe(asset.number);
    // The CMDB's own permission applies: an asset manager who can't read CIs finds none.
    expect((await get('am', `/sources?type=cmdb.ci&q=erp-app`)).body.items).toEqual([]);
  });
});

describe('stocktakes', () => {
  let st: LooseJson;
  it('snapshots the in-scope assets as items for their managers and tells them', async () => {
    const mgr2Asset = await newAsset('am', { name: 'Mgr2 laptop', siteId: tx.t2, managerId: ids.mgr2 });
    await newAsset('am', { name: 'Mgr laptop', siteId: tx.t2, managerId: ids.mgr });
    expect((await post('viewer', '/stocktakes', { name: 'x', dueOn: today })).status).toBe(403);
    const res = await post('am', '/stocktakes', {
      name: 'Site 2 hardware',
      dueOn: today,
      scope: { classIds: [tx.cls.HW], siteIds: [tx.t2] },
      recurrence: 'yearly',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    st = res.body;
    expect(st).toMatchObject({ status: 'open', progress: { total: 3, done: 0 } });
    expect(st.reference).toMatch(/^STK-\d{5}$/);
    expect(await notificationsOf(ids.mgr, 'isms.stocktake.assigned')).toHaveLength(1);
    expect(await notificationsOf(ids.mgr2, 'isms.stocktake.assigned')).toHaveLength(1);
    // Managers see their own items only; others don't see the stocktake at all.
    const mine = await get('mgr2', `/stocktakes/${st.reference}/items`);
    expect(mine.body.items.map((i: LooseJson) => i.snapshot.number)).toEqual([mgr2Asset.number]);
    expect((await get('mgr2', '/stocktakes')).body.items.map((x: LooseJson) => x.reference)).toContain(
      st.reference,
    );
    expect((await get('custodian', `/stocktakes/${st.reference}`)).status).toBe(404);
    expect((await get('mgr2', '/stocktake-items/mine')).body.items).toHaveLength(1);
    // My work shows the manager their part (one row per stocktake, opening their items); nobody else gets it.
    const work = (await h.call(s.mgr2!, 'GET', '/api/v1/me/work')).body as LooseJson;
    const checks = work.sections.find((x: LooseJson) => x.source === 'isms.stocktake-checks');
    expect(checks).toMatchObject({ kind: 'review', count: 1 });
    expect(checks.items[0]).toMatchObject({
      title: 'Site 2 hardware',
      href: `/isms/stocktakes/${st.reference}?mine=true`,
      detail: { key: 'isms.work.toCheck', params: { count: 1 } },
    });
    const others = (await h.call(s.custodian!, 'GET', '/api/v1/me/work')).body as LooseJson;
    expect(others.sections.find((x: LooseJson) => x.source === 'isms.stocktake-checks')).toBeUndefined();
  });

  it('records items: confirmed, changed (applied to the asset), missing with a note; only by the asset’s manager', async () => {
    const all = (await get('am', `/stocktakes/${st.reference}/items`)).body.items as LooseJson[];
    const mgrItem = all.find((i) => i.assignee?.id === ids.mgr)!;
    const mgr2Item = all.find((i) => i.assignee?.id === ids.mgr2)!;
    const unmanaged = all.find((i) => !i.assignee)!;
    expect(
      (await post('mgr2', `/stocktakes/${st.reference}/items/${mgrItem.id}`, { result: 'confirmed' })).status,
    ).toBe(403);
    const changed = await post('mgr', `/stocktakes/${st.reference}/items/${mgrItem.id}`, {
      result: 'changed',
      changes: { location: 'Desk 12' },
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.changes.location).toEqual([null, 'Desk 12']);
    const asset = (await get('viewer', `/assets/${mgrItem.snapshot.number}`)).body;
    expect(asset.location).toBe('Desk 12');
    expect((await get('viewer', `/assets/${asset.number}/events`)).body.items[0].kind).toBe('stocktake');
    const noNote = await post('mgr2', `/stocktakes/${st.reference}/items/${mgr2Item.id}`, {
      result: 'missing',
    });
    expect(noNote.status).toBe(400);
    expect(
      (
        await post('mgr2', `/stocktakes/${st.reference}/items/${mgr2Item.id}`, {
          result: 'missing',
          note: 'Not at desk',
        })
      ).status,
    ).toBe(200);
    const early = await post('sec', `/stocktakes/${st.reference}/sign-off`, {});
    expect(early.status).toBe(409);
    expect(early.body.error.details).toMatchObject({ reason: 'itemsPending', pending: 1 });
    // Items without a manager are recorded by stocktake managers.
    expect(
      (await post('am', `/stocktakes/${st.reference}/items/${unmanaged.id}`, { result: 'confirmed' })).status,
    ).toBe(200);
    expect(await auditOf('isms.stocktake.item_recorded', st.id)).toHaveLength(3);
  });

  it('is signed off by a security officer: statuses change, the next year is scheduled, results export', async () => {
    expect((await post('am', `/stocktakes/${st.reference}/sign-off`, {})).status).toBe(403);
    await eventually(
      () => notificationsOf(ids.am, 'isms.stocktake.ready'),
      (n) => n.length === 1,
    );
    const done = await post('sec', `/stocktakes/${st.reference}/sign-off`, { note: 'All checked' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({
      status: 'signed_off',
      signOffNote: 'All checked',
      progress: { done: 3 },
    });
    const items = (await get('sec', `/stocktakes/${st.reference}/items`)).body.items as LooseJson[];
    const missing = items.find((i) => i.result === 'missing')!;
    expect((await get('viewer', `/assets/${missing.snapshot.number}`)).body.status).toBe('missing');
    const confirmed = items.find((i) => i.result === 'confirmed')!;
    expect((await get('viewer', `/assets/${confirmed.snapshot.number}`)).body.lastVerifiedOn).toBe(today);
    const next = await h.kernel.db.select().from(stocktakes).where(eq(stocktakes.previousId, st.id));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ status: 'scheduled', recurrence: 'yearly' });
    expect(next[0]!.dueOn.slice(0, 4)).toBe(String(Number(today.slice(0, 4)) + 1));
    expect(
      (await post('mgr', `/stocktakes/${st.reference}/items/${items[0]!.id}`, { result: 'confirmed' }))
        .status,
    ).toBe(409);
    const csv = await h.app.inject({
      method: 'GET',
      url: `${API}/stocktakes/${st.reference}/export.csv?locale=en`,
      headers: { cookie: s.sec!.cookie },
    });
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    expect(csv.body).toContain('Not at desk');

    // The daily job opens a scheduled stocktake on its start date and tells the managers.
    await h.kernel.db.update(stocktakes).set({ startOn: today }).where(eq(stocktakes.id, next[0]!.id));
    const ran = await services(ctx()).stocktakes.daily();
    expect(ran.started).toBe(1);
    expect(
      (await h.kernel.db.select().from(stocktakes).where(eq(stocktakes.id, next[0]!.id)))[0]!.status,
    ).toBe('open');
  });
});

describe('shared accounts', () => {
  let acc: LooseJson;
  it('is registered by account managers and seen by its custodian and members only', async () => {
    const body = {
      accountName: 'svc-report',
      targetSystem: 'Reporting server',
      custodianId: ids.custodian,
      memberIds: [ids.m1, ids.m2, ids.m3],
      purpose: 'Monthly reports',
    };
    expect((await post('am', '/accounts', body)).status).toBe(403);
    const res = await post('sec', '/accounts', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    acc = res.body;
    expect(acc.reference).toMatch(/^SHA-\d{5}$/);
    expect(acc.members).toHaveLength(3);
    expect(acc.passwordChange.due).toBe(false);
    expect(acc.nextReviewOn).toBeTruthy();
    expect((await get('member1', `/accounts/${acc.reference}`)).status).toBe(200);
    expect((await get('custodian', `/accounts/${acc.reference}`)).body.viewer).toMatchObject({
      isCustodian: true,
      canRecordPassword: true,
      canManage: false,
    });
    expect((await get('mgr', `/accounts/${acc.reference}`)).status).toBe(404);
    expect((await get('mgr', '/accounts')).body.total).toBe(0);
    expect((await get('viewer', '/accounts')).body.total).toBeGreaterThanOrEqual(1);
  });

  it('makes the password due and tells the custodian when a member leaves, once', async () => {
    const off = await h.call(s.admin!, 'POST', `/api/v1/users/${ids.m1}/offboard`, { reason: 'Left' });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const notes = await eventually(
      () => notificationsOf(ids.custodian, 'isms.account.password_change_due'),
      (n) => n.length === 1,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toContain('svc-report');
    const a = (await get('custodian', `/accounts/${acc.reference}`)).body;
    expect(a.passwordChange).toMatchObject({ due: true, reason: 'member_left', member: { id: ids.m1 } });
    expect(a.members.map((m: LooseJson) => m.user.id)).not.toContain(ids.m1);
    // At-least-once delivery: the same event again changes nothing.
    const [event] = await outboxOf('core.user.offboarded');
    const handler = h.kernel.registry.get('isms')!.events!['core.user.offboarded']!;
    await handler(
      {
        id: event!.eventId,
        name: 'core.user.offboarded',
        moduleId: 'core',
        payload: event!.payload,
        actor: null,
        occurredAt: new Date().toISOString(),
      },
      ctx(),
    );
    expect(await notificationsOf(ids.custodian, 'isms.account.password_change_due')).toHaveLength(1);
    expect(
      (await get('viewer', '/accounts?view=password')).body.items.map((x: LooseJson) => x.reference),
    ).toContain(acc.reference);
  });

  it('records the password change (custodian only), audited, and clears the flag', async () => {
    expect(
      (await post('member1', `/accounts/${acc.reference}/password-changed`, { changedOn: today })).status,
    ).toBe(401);
    expect(
      (await post('mgr', `/accounts/${acc.reference}/password-changed`, { changedOn: today })).status,
    ).toBe(404);
    const future = await post('custodian', `/accounts/${acc.reference}/password-changed`, {
      changedOn: '2999-01-01',
    });
    expect(future.status).toBe(400);
    const res = await post('custodian', `/accounts/${acc.reference}/password-changed`, { changedOn: today });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ lastPasswordChangeOn: today, passwordChange: { due: false } });
    const audit = await auditOf('isms.account.password_changed', acc.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.category).toBe('security');
  });

  it('makes the password due when a member moves department', async () => {
    const moved = await h.call(s.admin!, 'PATCH', `/api/v1/users/${ids.m2}`, { departmentId: h.ids.finance });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const a = await eventually(
      async () => (await get('custodian', `/accounts/${acc.reference}`)).body,
      (x: LooseJson) => x.passwordChange.due,
    );
    expect(a.passwordChange).toMatchObject({ due: true, reason: 'member_moved', member: { id: ids.m2 } });
    // Movers stay on the list until the custodian or a review takes them off.
    expect(a.members.map((m: LooseJson) => m.user.id)).toContain(ids.m2);
    expect(await notificationsOf(ids.custodian, 'isms.account.password_change_due')).toHaveLength(2);
    await post('custodian', `/accounts/${acc.reference}/password-changed`, { changedOn: today });
  });

  it('reviews the members yearly: unticked members leave the list and the password is due', async () => {
    const res = await post('custodian', `/accounts/${acc.reference}/review`, { memberIds: [ids.m3] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.members.map((m: LooseJson) => m.user.id)).toEqual([ids.m3]);
    expect(res.body.lastReviewedOn).toBe(today);
    expect(res.body.nextReviewOn > today).toBe(true);
    expect(res.body.passwordChange).toMatchObject({ due: true, reason: 'member_removed' });
    expect(
      (await post('custodian', `/accounts/${acc.reference}/review`, { memberIds: [ids.m1] })).status,
    ).toBe(400);
    const events = await h.kernel.db.select().from(accountEvents).where(eq(accountEvents.accountId, acc.id));
    expect(events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['created', 'member_removed', 'password_changed', 'reviewed']),
    );
  });

  it('registers accounts from approved requests through the process action, idempotently', async () => {
    const action = h.kernel.registry.get('isms')!.processActions!['register-shared-account']!;
    const request = {
      id: '0192b9a0-0000-7000-8000-000000000101',
      reference: 'REQ-00101',
      href: '/requests/REQ-00101',
      form: { key: 'shared-account', name: { en: 'Shared account' } },
      outcome: 'approved' as const,
      data: {
        account: 'svc-backup2',
        custodian: ids.custodian,
        users: [{ person: ids.m3, title: 'Engineer' }, { person: ids.mgr }, { person: 'not-a-uuid' }],
        extra: ids.mgr2,
      },
      records: {},
      steps: {},
      requester: { id: ids.mgr, displayName: 'Mgr', email: 'mgr@test.example', departmentId: null },
      decidedBy: null,
    };
    const config = {
      accountName: 'svc-backup2',
      targetSystem: 'Backup console',
      custodianField: 'custodian',
      membersFields: ['users.person', 'extra'],
    };
    const run = (runId: string) =>
      action.run({ config, request, runId, attempt: 1, auth: moduleAuth() }, ctx());
    const first = await run('0192b9a0-0000-7000-8000-000000000201');
    expect(first).toMatchObject({
      summary: 'isms.processActions.registerSharedAccount.created',
      record: { type: 'isms.account' },
    });
    const again = await run('0192b9a0-0000-7000-8000-000000000201');
    expect(again.record).toEqual(first.record);
    const rows = await h.kernel.db
      .select()
      .from(sharedAccounts)
      .where(eq(sharedAccounts.accountName, 'svc-backup2'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      custodianId: ids.custodian,
      requestReference: 'REQ-00101',
      targetSystem: 'Backup console',
    });
    const members = await services(ctx()).accounts.memberIds(rows[0]!.id);
    expect(members.sort()).toEqual([ids.m3, ids.mgr, ids.mgr2].sort());
    // A second request for the same account on the same system adds its people to it.
    const more = await action.run(
      {
        config: { ...config, membersFields: ['extra'] },
        request: { ...request, reference: 'REQ-00102', data: { ...request.data, extra: ids.reviewer } },
        runId: '0192b9a0-0000-7000-8000-000000000202',
        attempt: 1,
        auth: moduleAuth(),
      },
      ctx(),
    );
    expect(more.summary).toBe('isms.processActions.registerSharedAccount.updated');
    expect(await services(ctx()).accounts.memberIds(rows[0]!.id)).toContain(ids.reviewer);
    expect(
      (await h.kernel.db.select().from(sharedAccounts).where(eq(sharedAccounts.accountName, 'svc-backup2')))
        .length,
    ).toBe(1);
  });
});

describe('account reviews', () => {
  let rv: LooseJson;
  it('starts a review for its reviewer, who imports the system’s account list', async () => {
    expect(
      (await post('am', '/reviews', { target: 'fw', reviewerId: ids.reviewer, dueOn: today })).status,
    ).toBe(403);
    const res = await post('sec', '/reviews', {
      target: 'Core firewall 10.0.0.1',
      reviewerId: ids.reviewer,
      dueOn: today,
      recurrence: 'quarterly',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    rv = res.body;
    expect(rv).toMatchObject({
      status: 'open',
      source: 'manual',
      reference: expect.stringMatching(/^ACR-\d{5}$/),
    });
    expect(await notificationsOf(ids.reviewer, 'isms.review.assigned')).toHaveLength(1);
    expect((await get('mgr', `/reviews/${rv.reference}`)).status).toBe(404);

    const csv = [
      '帳號名稱,使用者姓名,權限,目前狀態',
      'admin,Built-in administrator,管理者,啟用',
      'reviewer,Reviewer,使用者,啟用',
      'mgr2,,Administrator,Enabled',
      'oldsvc,Old service,User,Disabled',
      'oldsvc,Again,User,Disabled',
      ',No account,User,Enabled',
      'weird,x,guest,on',
    ].join('\n');
    const dry = await post('reviewer', `/reviews/${rv.reference}/import`, { csv, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ rows: 7, added: 4, updated: 0, skipped: 3 });
    expect(dry.body.issues.map((i: LooseJson) => i.code)).toEqual(['duplicate', 'required', 'badPrivilege']);
    expect((await get('reviewer', `/reviews/${rv.reference}/items`)).body.total).toBe(0);
    const real = await post('reviewer', `/reviews/${rv.reference}/import`, { csv, dryRun: false });
    expect(real.body).toMatchObject({ added: 4, matched: 3 });
    const items = (await get('reviewer', `/reviews/${rv.reference}/items`)).body.items as LooseJson[];
    expect(items.map((i) => [i.accountName, i.privilege, i.accountStatus, i.user?.id ?? null])).toEqual([
      ['admin', 'admin', 'enabled', h.ids.admin],
      ['reviewer', 'user', 'enabled', ids.reviewer],
      ['mgr2', 'admin', 'enabled', ids.mgr2],
      ['oldsvc', 'user', 'disabled', null],
    ]);
    expect((await get('reviewer', `/reviews/${rv.reference}`)).body.source).toBe('csv');
  });

  it('needs every account decided (disable and delete with the date) before completing', async () => {
    const items = (await get('reviewer', `/reviews/${rv.reference}/items`)).body.items as LooseJson[];
    const by = (a: string) => items.find((i) => i.accountName === a)!.id;
    expect(
      (await post('mgr', `/reviews/${rv.reference}/items/${by('admin')}/decision`, { decision: 'keep' }))
        .status,
    ).toBe(404);
    const many = await post('reviewer', `/reviews/${rv.reference}/decisions`, {
      itemIds: [by('admin'), by('reviewer')],
      decision: 'keep',
    });
    expect(many.status, JSON.stringify(many.body)).toBe(200);
    await post('reviewer', `/reviews/${rv.reference}/items/${by('mgr2')}/decision`, {
      decision: 'disable',
      note: 'Moved team',
    });
    await post('reviewer', `/reviews/${rv.reference}/items/${by('oldsvc')}/decision`, { decision: 'delete' });
    const early = await post('reviewer', `/reviews/${rv.reference}/complete`);
    expect(early.status).toBe(409);
    expect(early.body.error.details).toMatchObject({ reason: 'itemsPending', pending: 2 });
    expect(
      (
        await post('reviewer', `/reviews/${rv.reference}/items/${by('oldsvc')}/decision`, {
          decision: 'delete',
          doneOn: '2999-01-01',
        })
      ).status,
    ).toBe(400);
    await post('reviewer', `/reviews/${rv.reference}/decisions`, {
      itemIds: [by('mgr2'), by('oldsvc')],
      decision: 'disable',
      doneOn: today,
    });
    const tickets = await post('reviewer', `/reviews/${rv.reference}/tickets`);
    expect(tickets.status, JSON.stringify(tickets.body)).toBe(200);
    expect(tickets.body).toEqual({ raised: 2, failed: 0 });
    const withTickets = (await get('reviewer', `/reviews/${rv.reference}/items?view=disable`)).body
      .items as LooseJson[];
    expect(withTickets.every((i) => /^[A-Z]+-\d+/.test(i.ticket?.reference ?? ''))).toBe(true);
    expect((await post('reviewer', `/reviews/${rv.reference}/tickets`)).body).toEqual({
      raised: 0,
      failed: 0,
    });
    const done = await post('reviewer', `/reviews/${rv.reference}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe('completed');
    expect(await notificationsOf(ids.sec, 'isms.review.ready')).toHaveLength(1);
    expect(
      (
        await post('reviewer', `/reviews/${rv.reference}/items/${by('admin')}/decision`, {
          decision: 'delete',
        })
      ).body.error.code,
    ).toBe('INVALID_STATE');
  });

  it('is signed off by a security officer, schedules the next quarter and exports the review layout', async () => {
    expect((await post('reviewer', `/reviews/${rv.reference}/sign-off`, {})).status).toBe(403);
    const signed = await post('sec', `/reviews/${rv.reference}/sign-off`, { note: 'OK' });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body).toMatchObject({ status: 'signed_off', signOffNote: 'OK' });
    const [next] = await h.kernel.db.select().from(reviews).where(eq(reviews.previousId, rv.id));
    expect(next).toMatchObject({
      status: 'scheduled',
      recurrence: 'quarterly',
      reviewerId: ids.reviewer,
      target: rv.target,
    });
    // On its start date the daily job opens it with the accounts the last review didn't delete, and tells the reviewer.
    await h.kernel.db.update(reviews).set({ startOn: today }).where(eq(reviews.id, next!.id));
    expect((await services(ctx()).reviews.daily()).started).toBe(1);
    const nextItems = await h.kernel.db.select().from(reviewItems).where(eq(reviewItems.reviewId, next!.id));
    expect(nextItems.map((i) => [i.accountName, i.accountStatus, i.decision]).sort()).toEqual([
      ['admin', 'enabled', null],
      ['mgr2', 'disabled', null],
      ['oldsvc', 'disabled', null],
      ['reviewer', 'enabled', null],
    ]);
    expect(await notificationsOf(ids.reviewer, 'isms.review.assigned')).toHaveLength(2);

    const csv = await h.app.inject({
      method: 'GET',
      url: `${API}/reviews/${rv.reference}/export.csv?locale=en`,
      headers: { cookie: s.reviewer!.cookie },
    });
    expect(csv.statusCode).toBe(200);
    const lines = csv.body.slice(1).split('\r\n');
    expect(lines[0]).toContain('Core firewall 10.0.0.1');
    expect(lines).toContain('Account,User name,Privilege,Current state,Decision,Date done,Note');
    expect(lines.find((l) => l.startsWith('mgr2,'))).toBe(
      `mgr2,Mgr2,Administrator,Enabled,Disable,${today},Moved team`,
    );
  });

  it('fills a review from the role holders of a registered application', async () => {
    const [app] = await h.kernel.db
      .insert(applications)
      .values({ key: 'payroll', name: 'Payroll' })
      .returning();
    const [admin] = await h.kernel.db
      .insert(roles)
      .values({ applicationId: app!.id, key: 'payroll-admin', name: 'Payroll admin', riskLevel: 'high' })
      .returning();
    const [clerk] = await h.kernel.db
      .insert(roles)
      .values({ applicationId: app!.id, key: 'clerk', name: 'Clerk' })
      .returning();
    await h.kernel.db.insert(roleAssignments).values([
      { roleId: admin!.id, userId: ids.mgr },
      { roleId: clerk!.id, userId: ids.mgr2 },
      { roleId: clerk!.id, userId: ids.mgr },
    ]);
    // The security officer can't read the application's role holders; a platform administrator can.
    expect((await get('sec', '/lookups/applications')).body.items.map((a: LooseJson) => a.key)).not.toContain(
      'payroll',
    );
    const refused = await post('sec', '/reviews', {
      target: 'Payroll',
      reviewerId: ids.reviewer,
      dueOn: today,
      applicationId: app!.id,
    });
    expect(refused.status).toBe(400);
    const res = await post('admin', '/reviews', {
      target: 'Payroll',
      reviewerId: ids.reviewer,
      dueOn: today,
      applicationId: app!.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      source: 'application',
      application: { key: 'payroll' },
      progress: { total: 2 },
    });
    const items = (await get('reviewer', `/reviews/${res.body.reference}/items`)).body.items as LooseJson[];
    expect(items.map((i) => [i.accountName, i.privilege]).sort()).toEqual([
      ['mgr', 'admin'],
      ['mgr2', 'user'],
    ]);
    expect(items.find((i) => i.accountName === 'mgr')!.detail).toContain('Payroll admin');
  });
});

describe('the asset-class customisation kind', () => {
  class Rollback extends Error {}
  it('creates, round-trips and leaves nothing behind on a dry run', async () => {
    const cz = h.kernel.customizations;
    const admin = await authOf(ids.cfg);
    const value = {
      code: 'CL',
      name: { en: 'Cloud', 'zh-TW': '雲端', 'ja-JP': 'クラウド' },
      description: null,
      guidance: {
        c: { '1': { en: 'a' }, '2': {}, '3': {}, '4': {} },
        i: { '1': { en: 'b' }, '2': {}, '3': {}, '4': {} },
        a: { '1': { en: 'c' }, '2': {}, '3': {}, '4': {} },
      },
      sortOrder: 60,
      subclasses: [{ key: 'saas', name: { en: 'SaaS' } }],
    };
    const before = (
      await h.kernel.db.execute<{ n: number }>(sql`select count(*)::int as n from isms.classes`)
    ).rows[0]!.n;
    await h.kernel.db
      .transaction(async (tx) => {
        await cz.apply(
          'isms.asset-class',
          { op: 'create', id: null, value },
          { auth: admin, tx: tx as unknown as Db, dryRun: true },
        );
        throw new Rollback();
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });
    expect(
      (await h.kernel.db.execute<{ n: number }>(sql`select count(*)::int as n from isms.classes`)).rows[0]!.n,
    ).toBe(before);
    const created = await h.kernel.db.transaction((tx) =>
      cz.apply(
        'isms.asset-class',
        { op: 'create', id: null, value },
        { auth: admin, tx: tx as unknown as Db },
      ),
    );
    const got = (await cz.get('isms.asset-class', created.id, admin))! as {
      value: LooseJson;
      version: string;
    };
    expect(got.value.subclasses[0].key).toBe('saas');
    await h.kernel.db.transaction((tx) =>
      cz.apply(
        'isms.asset-class',
        { op: 'update', id: created.id, value: got.value, baseVersion: got.version },
        { auth: admin, tx: tx as unknown as Db },
      ),
    );
    expect((await cz.get('isms.asset-class', created.id, admin))!.version).toBe(got.version);
    // The guide's example (the default hardware class) parses; only its code is taken.
    const described = await cz.describe('isms.asset-class', admin);
    const example = described.guide.examples![0]!.value as LooseJson;
    expect(example.code).toBe('HW');
    expect((described.guide.reference as LooseJson).classes.map((c: LooseJson) => c.code)).toContain('CL');
    const exampleCheck = await cz.validate(
      'isms.asset-class',
      { op: 'create', id: null, value: example },
      admin,
    );
    expect(exampleCheck.issues.map((i) => i.code)).toEqual(['duplicate']);
    const check = await cz.validate('isms.asset-class', { op: 'create', id: null, value }, admin);
    expect(check.issues.map((i) => i.code)).toContain('duplicate');
    const viewer = await authOf(ids.viewer);
    await expect(
      h.kernel.db.transaction((tx) =>
        cz.apply(
          'isms.asset-class',
          { op: 'archive', id: created.id, value: null },
          { auth: viewer, tx: tx as unknown as Db },
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('dashboard and AI', () => {
  it('summarises for readers and participants alike', async () => {
    const reader = (await get('sec', '/dashboard')).body;
    expect(reader.assets.total).toBeGreaterThan(0);
    expect(reader.assets.byValue).toHaveLength(4);
    const participant = (await get('mgr', '/dashboard')).body;
    expect(participant.assets).toBeNull();
    expect((await get('outsider', '/dashboard')).status).toBe(200);
  });

  it('finds assets by class and value for AI tools, with the caller’s permissions', async () => {
    const tools = h.kernel.registry.get('isms')!.ai!;
    const found = (await tools['isms.find_assets']!(
      { classCode: 'HW', minValue: 4, limit: 5 },
      ctx(),
      await authOf(ids.viewer),
    )) as LooseJson;
    expect(found.items.length).toBeGreaterThan(0);
    expect(found.items.every((a: LooseJson) => a.value >= 4 && a.class.startsWith('HW'))).toBe(true);
    await expect(
      tools['isms.find_assets']!({ limit: 5 }, ctx(), await authOf(ids.mgr)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(formatAssetNumber('TST1', 'HW', 1)).toBe('TST1HW0001');
  });
});

/** Keeps `ServerModule` referenced for readers looking for how modules are reached in tests. */
export type _Module = ServerModule;
