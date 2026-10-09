/**
 * Assets and information security under concurrency and the counts that used to read 0: two requests fired at once
 * get one success and one 409 (or the same idempotent result), with one audit entry and one event; vendors and models
 * count their records; discovery keeps what each device reported when titles are mapped and unmapped.
 */
import { auditLogs, notifications, outboxEvents, roleAssignments, roles, users } from '@isbp/db/schema';
import { addDays, todayIn } from '@isbp/module-itam/model';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<
  'am' | 'cm' | 'alice' | 'bob' | 'carol' | 'sec' | 'mgr' | 'reviewer' | 'custodian',
  string
>;
const today = todayIn('Asia/Taipei');

async function mkUser(username: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: `${username[0]!.toUpperCase()}${username.slice(1)}`,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  return u!.id;
}
const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

const auditOf = (action: string, entityId?: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), entityId ? eq(auditLogs.entityId, entityId) : undefined));
const outboxOf = (name: string) => h.kernel.db.select().from(outboxEvents).where(eq(outboxEvents.name, name));

const call = (who: string, method: string, path: string, body?: unknown) =>
  h.call(s[who]!, method, `/api/v1${path}`, body);
const post = (who: string, path: string, body: unknown = {}) => call(who, 'POST', path, body);
const get = (who: string, path: string) => call(who, 'GET', path);
/** Both requests at once; the statuses sorted so a test can expect e.g. `[200, 409]`. */
const twice = async (fn: () => ReturnType<typeof post>) => {
  const results = await Promise.all([fn(), fn()]);
  return { results, statuses: results.map((r) => r.status).sort() };
};

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  for (const k of Object.keys({
    am: 1,
    cm: 1,
    alice: 1,
    bob: 1,
    carol: 1,
    sec: 1,
    mgr: 1,
    reviewer: 1,
    custodian: 1,
  }) as (keyof typeof ids)[])
    ids[k] = await mkUser(k);
  await h.kernel.db.insert(roleAssignments).values([
    { roleId: await roleId('itam-asset-manager'), userId: ids.am },
    { roleId: await roleId('itam-contract-manager'), userId: ids.cm },
    { roleId: await roleId('isms-asset-manager'), userId: ids.am },
    { roleId: await roleId('isms-security-officer'), userId: ids.sec },
  ]);
  await h.kernel.rbac.bump();
  for (const u of Object.keys(ids)) s[u] = await h.login(u);
}, 180_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('assets', () => {
  let vendor: LooseJson;
  let model: LooseJson;

  it('counts each vendor’s and model’s records (not 0)', async () => {
    vendor = (await post('am', '/itam/vendors', { name: 'Contoso Hardware' })).body;
    const other = (await post('am', '/itam/vendors', { name: 'Fabrikam' })).body;
    model = (
      await post('am', '/itam/models', { category: 'laptop', manufacturer: 'Contoso', name: 'Book 14' })
    ).body;
    for (const n of [1, 2]) {
      const a = await post('am', '/itam/assets', {
        name: `LT-${n}`,
        category: 'laptop',
        modelId: model.id,
        vendorId: vendor.id,
        serialNumber: `RACE-${n}`,
      });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
    }
    expect(
      (
        await post('cm', '/itam/contracts', {
          title: 'Contoso support',
          kind: 'support',
          vendorId: vendor.id,
          startDate: addDays(today, -30),
          endDate: addDays(today, 300),
          cost: 1000,
          billing: 'annual',
          ownerId: ids.cm,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post('am', '/itam/licenses', {
          product: 'Contoso Tools',
          vendorId: vendor.id,
          licenseType: 'site',
        })
      ).status,
    ).toBe(201);

    const list = (await get('cm', '/itam/vendors')).body.items as LooseJson[];
    expect(list.find((v) => v.id === vendor.id)!.counts).toEqual({ assets: 2, licenses: 1, contracts: 1 });
    expect(list.find((v) => v.id === other.id)!.counts).toEqual({ assets: 0, licenses: 0, contracts: 0 });
    expect((await get('cm', `/itam/vendors/${vendor.id}`)).body.counts).toEqual({
      assets: 2,
      licenses: 1,
      contracts: 1,
    });
    const models = (await get('am', '/itam/models')).body.items as LooseJson[];
    expect(models.find((m) => m.id === model.id)!.assetCount).toBe(2);
    expect(
      (await call('am', 'PATCH', `/itam/models/${model.id}`, { partNumber: 'B14' })).body.assetCount,
    ).toBe(2);
  });

  it('gives seats to two people at once without a deadlock, and one seat when the same person is sent twice', async () => {
    const lic = (
      await post('am', '/itam/licenses', { product: 'Race Office', licenseType: 'per_user', quantity: 5 })
    ).body;
    const [a, b] = await Promise.all([
      post('am', `/itam/licenses/${lic.reference}/assignments`, { userId: ids.alice }),
      post('am', `/itam/licenses/${lic.reference}/assignments`, { userId: ids.bob }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const same = await twice(() =>
      post('am', `/itam/licenses/${lic.reference}/assignments`, { userId: ids.carol }),
    );
    expect(same.statuses).toEqual([201, 409]);
    const assigned = (await auditOf('itam.license.assigned', lic.id)).filter(
      (x) => (x.metadata as { userId?: string }).userId === ids.carol,
    );
    expect(assigned).toHaveLength(1);
    expect((await get('am', `/itam/licenses/${lic.reference}`)).body).toMatchObject({ assigned: 3 });
  });

  it('takes two reports for one device at once, one after the other', async () => {
    const pc = (
      await post('am', '/itam/assets', { name: 'LT-race', category: 'laptop', serialNumber: 'RACE-DISC' })
    ).body;
    const report = () =>
      post('am', '/itam/discovery/software', {
        assetId: pc.id,
        source: 'api',
        products: [{ product: 'Race Viewer', version: '1.0' }, { product: 'Race Editor' }],
      });
    const both = await twice(report);
    expect(both.statuses).toEqual([200, 200]);
    expect(both.results.map((r) => r.body.added).sort()).toEqual([0, 2]);
    const software = (await get('am', `/itam/assets/${pc.tag}/software`)).body.installations as LooseJson[];
    expect(software.map((i) => i.product).sort()).toEqual(['Race Editor', 'Race Viewer']);
    expect((await get('am', `/itam/discovery/reports?q=${pc.tag}`)).body.total).toBe(2);
  });

  it('keeps what each device reported when a title is mapped and unmapped', async () => {
    const lic = (
      await post('am', '/itam/licenses', {
        product: 'Race Visio Plan 2',
        licenseType: 'per_user',
        quantity: 5,
      })
    ).body;
    const both = (
      await post('am', '/itam/assets', { name: 'LT-both', category: 'laptop', serialNumber: 'RACE-BOTH' })
    ).body;
    const titleOnly = (
      await post('am', '/itam/assets', { name: 'LT-title', category: 'laptop', serialNumber: 'RACE-TITLE' })
    ).body;
    // One device reports the licence's product and the title, another only the title.
    await post('am', '/itam/discovery/software', {
      assetId: both.id,
      products: [{ product: 'Race Visio Plan 2' }, { product: 'Race Visio 2021' }],
    });
    await post('am', '/itam/discovery/software', {
      assetId: titleOnly.id,
      products: [{ product: 'Race Visio 2021' }],
    });
    const installs = async (tag: string) =>
      ((await get('am', `/itam/assets/${tag}/software`)).body.installations as LooseJson[])
        .map((i) => [i.product, i.reportedAs])
        .sort((x, y) => String(x).localeCompare(String(y)));
    const usage = async () => (await get('am', `/itam/licenses/${lic.reference}`)).body.unlicensed;
    expect(await usage()).toBe(1);

    const rule = await post('am', '/itam/discovery/rules', { title: 'Race Visio 2021', licenseId: lic.id });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    expect(await installs(both.tag)).toEqual([
      ['Race Visio Plan 2', null],
      ['Race Visio Plan 2', 'Race Visio 2021'],
    ]);
    // Each device counts once for the licence, and lists once on its Installations tab.
    expect(await usage()).toBe(2);
    const listed = (await get('am', `/itam/licenses/${lic.reference}/installations`)).body
      .items as LooseJson[];
    expect(listed.map((i) => i.asset.id).sort()).toEqual([both.id, titleOnly.id].sort());

    // A report while the mapping is active keeps both titles.
    const during = await post('am', '/itam/discovery/software', {
      assetId: both.id,
      products: [{ product: 'race visio 2021' }, { product: 'Race Visio Plan 2' }],
    });
    expect(during.body).toMatchObject({ added: 0, updated: 2, removed: 0 });
    expect(await installs(both.tag)).toHaveLength(2);

    // Unmapping restores every reported title at once, without waiting for the next report.
    expect((await call('am', 'DELETE', `/itam/discovery/rules/${rule.body.id}`)).status).toBe(204);
    expect(await installs(both.tag)).toEqual([
      ['Race Visio 2021', null], // as the device first reported it
      ['Race Visio Plan 2', null],
    ]);
    expect(await installs(titleOnly.tag)).toEqual([['Race Visio 2021', null]]);
    expect(await usage()).toBe(1);
    // And mapping again works the same way.
    expect(
      (await post('am', '/itam/discovery/rules', { title: 'Race Visio 2021', licenseId: lic.id })).status,
    ).toBe(201);
    expect(await usage()).toBe(2);
  });
});

describe('information security', () => {
  it('signs a stocktake off once when it is sent twice at once', async () => {
    const taxonomy = (await get('sec', '/isms/taxonomy')).body;
    const hw = taxonomy.classes.find((c: LooseJson) => c.code === 'HW').id;
    const site = taxonomy.sites[0].id;
    const asset = await post('am', '/isms/assets', {
      name: 'Race switch',
      classId: hw,
      siteId: site,
      managerId: ids.mgr,
      confidentiality: 2,
      integrity: 2,
      availability: 2,
    });
    expect(asset.status, JSON.stringify(asset.body)).toBe(201);
    const st = (await post('am', '/isms/stocktakes', { name: 'Race stocktake', dueOn: today })).body;
    const items = (await get('am', `/isms/stocktakes/${st.reference}/items`)).body.items as LooseJson[];
    for (const item of items) {
      const recorded = await twice(() =>
        post('am', `/isms/stocktakes/${st.reference}/items/${item.id}`, { result: 'confirmed' }),
      );
      expect(recorded.statuses).toEqual([200, 200]);
    }
    const signed = await twice(() => post('sec', `/isms/stocktakes/${st.reference}/sign-off`, {}));
    expect(signed.statuses).toEqual([200, 409]);
    expect(await auditOf('isms.stocktake.signed_off', st.id)).toHaveLength(1);
    expect(await outboxOf('isms.stocktake.signed_off')).toHaveLength(1);
  });

  it('records a password change once when it is sent twice at once', async () => {
    const acc = await post('sec', '/isms/accounts', {
      accountName: 'svc-race',
      targetSystem: 'Race server',
      custodianId: ids.custodian,
      memberIds: [ids.alice],
    });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    const ref = acc.body.reference;
    expect((await call('custodian', 'DELETE', `/isms/accounts/${ref}/members/${ids.alice}`)).status).toBe(
      200,
    );
    expect((await get('custodian', `/isms/accounts/${ref}`)).body.passwordChange.due).toBe(true);
    const both = await twice(() =>
      post('custodian', `/isms/accounts/${ref}/password-changed`, { changedOn: today }),
    );
    expect(both.statuses).toEqual([200, 200]);
    expect(both.results.every((r) => r.body.passwordChange.due === false)).toBe(true);
    expect(await auditOf('isms.account.password_changed', acc.body.id)).toHaveLength(1);
    expect(await outboxOf('isms.account.password_changed')).toHaveLength(1);
  });

  it('raises one ticket per account and completes a review once, however often it is sent', async () => {
    const rv = (
      await post('sec', '/isms/reviews', { target: 'Race firewall', reviewerId: ids.reviewer, dueOn: today })
    ).body;
    const add = (accountName: string) =>
      post('reviewer', `/isms/reviews/${rv.reference}/items`, {
        accountName,
        privilege: 'user',
        accountStatus: 'enabled',
      });
    const added = [(await add('old-a')).body, (await add('old-b')).body, (await add('keep-c')).body];
    expect(added.every((i) => i.id)).toBe(true);
    await post('reviewer', `/isms/reviews/${rv.reference}/decisions`, {
      itemIds: [added[0].id, added[1].id],
      decision: 'disable',
      doneOn: today,
    });
    await post('reviewer', `/isms/reviews/${rv.reference}/decisions`, {
      itemIds: [added[2].id],
      decision: 'keep',
    });

    const tickets = await twice(() => post('reviewer', `/isms/reviews/${rv.reference}/tickets`));
    expect(tickets.statuses).toEqual([200, 200]);
    expect(tickets.results.reduce((n, r) => n + r.body.raised, 0)).toBe(2);
    expect(tickets.results.reduce((n, r) => n + r.body.failed, 0)).toBe(0);
    expect(await auditOf('isms.review.ticket_raised', rv.id)).toHaveLength(2);
    expect(await auditOf('itsm.ticket.created')).toHaveLength(2);

    const done = await twice(() => post('reviewer', `/isms/reviews/${rv.reference}/complete`));
    expect(done.statuses).toEqual([200, 409]);
    expect(await auditOf('isms.review.completed', rv.id)).toHaveLength(1);
    expect(await outboxOf('isms.review.completed')).toHaveLength(1);
    expect(
      await h.kernel.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, ids.sec), eq(notifications.type, 'isms.review.ready'))),
    ).toHaveLength(1);
  });
});
