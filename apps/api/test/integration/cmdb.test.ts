import { auditLogs, outboxEvents, users } from '@isbp/db/schema';
import { type Edge, traverse } from '@isbp/module-cmdb/model';
import { ciRelationships, cis } from '@isbp/module-cmdb/schema';
import type { AuthContext } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { toSessionUser } from '../../src/kernel/sessions';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
let outsider: Session;
const byName = new Map<string, string>();

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function authFor(userId: string): Promise<AuthContext> {
  const [u] = await h.kernel.db.select().from(users).where(eq(users.id, userId));
  return buildAuthContext(
    { type: 'user', id: u!.id, name: u!.displayName },
    toSessionUser(u!),
    null,
    await h.kernel.rbac.permissionsFor(u!.id),
  );
}

const ci = (name: string) => {
  const id = byName.get(name);
  if (!id) throw new Error(`no seeded CI ${name}`);
  return id;
};

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  const cmdb = h.kernel.registry.get('cmdb')!;
  await cmdb.seed!(h.kernel.registry.context('cmdb'));
  for (const r of await h.kernel.db.select({ id: cis.id, name: cis.name }).from(cis))
    byName.set(r.name, r.id);
  admin = await h.login('admin');
  outsider = await h.login('outsider');
});
afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('cmdb seed', () => {
  it('creates a realistic estate with the names ITSM looks up', () => {
    expect(byName.size).toBeGreaterThanOrEqual(40);
    for (const name of [
      'Email & Calendar',
      'Remote Access (VPN)',
      'Finance ERP',
      'HR Portal',
      'Corporate Website',
      'Wi-Fi',
      'Printing',
      'Single Sign-On',
      'File Sharing',
      'vpn-gw-01',
      'erp-app-01',
      'erp-db-01',
      'tpe-sw-core-01',
      'tpe-fw-01',
      'mail-relay-01',
      'hr-app-01',
      'nas-01',
      'print-srv-01',
      'wlc-01',
    ])
      expect(byName.has(name), name).toBe(true);
  });

  it('is idempotent', async () => {
    const before = byName.size;
    await h.kernel.registry.get('cmdb')!.seed!(h.kernel.registry.context('cmdb'));
    expect((await h.kernel.db.select({ id: cis.id }).from(cis)).length).toBe(before);
  });
});

describe('permissions', () => {
  it('denies CI routes without cmdb.cis.read but lists business services for everyone', async () => {
    expect((await h.call(outsider, 'GET', '/api/v1/cmdb/cis')).status).toBe(403);
    expect((await h.call(outsider, 'GET', `/api/v1/cmdb/cis/${ci('erp-db-01')}`)).status).toBe(403);
    expect((await h.call(outsider, 'GET', `/api/v1/cmdb/cis/${ci('erp-db-01')}/impact`)).status).toBe(403);
    expect(
      (await h.call(outsider, 'POST', '/api/v1/cmdb/cis', { name: 'x', classKey: 'server' })).status,
    ).toBe(403);
    expect((await h.call(outsider, 'GET', '/api/v1/cmdb/classes')).status).toBe(403);

    const services = await h.call(outsider, 'GET', '/api/v1/cmdb/services');
    expect(services.status).toBe(200);
    const names = services.body.items.map((s: { name: string }) => s.name);
    expect(names).toContain('Finance ERP');
    expect(names).not.toContain('erp-db-01');
    expect(Object.keys(services.body.items[0]).sort()).toEqual(
      ['description', 'id', 'name', 'number', 'reference'].sort(),
    );
    const filtered = await h.call(outsider, 'GET', '/api/v1/cmdb/services?q=vpn');
    expect(filtered.body.items.map((s: { name: string }) => s.name)).toEqual(['Remote Access (VPN)']);
  });

  it('requires a session', async () => {
    expect((await h.call(null, 'GET', '/api/v1/cmdb/services')).status).toBe(401);
  });
});

describe('configuration items', () => {
  let created: LooseJson;

  it('lists with filters, quick views, search by number and sorting', async () => {
    const all = await h.call(admin, 'GET', '/api/v1/cmdb/cis?pageSize=100');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(byName.size);

    const services = await h.call(admin, 'GET', '/api/v1/cmdb/cis?view=services&pageSize=100');
    expect(services.body.items.every((c: LooseJson) => c.class.key === 'business-service')).toBe(true);
    expect(services.body.total).toBe(10);

    const infra = await h.call(admin, 'GET', '/api/v1/cmdb/cis?view=infrastructure&status=maintenance');
    expect(infra.body.items.map((c: LooseJson) => c.name)).toEqual(['print-srv-01']);

    const crit = await h.call(admin, 'GET', '/api/v1/cmdb/cis?class=database&criticality=critical');
    expect(crit.body.items.map((c: LooseJson) => c.name)).toEqual(['erp-db-01']);

    const test = await h.call(admin, 'GET', '/api/v1/cmdb/cis?environment=test&sort=-name');
    expect(test.body.items.map((c: LooseJson) => c.name)).toEqual(['erp-db-test-01', 'erp-app-test-01']);

    const search = await h.call(admin, 'GET', '/api/v1/cmdb/cis?q=core');
    expect(search.body.items.map((c: LooseJson) => c.name).sort()).toEqual([
      'tpe-sw-core-01',
      'tpe-sw-core-02',
    ]);
    const ref = search.body.items[0].reference as string;
    const byNumber = await h.call(admin, 'GET', `/api/v1/cmdb/cis?q=${ref}`);
    expect(byNumber.body.items.map((c: LooseJson) => c.reference)).toEqual([ref]);

    const sorted = await h.call(admin, 'GET', '/api/v1/cmdb/cis?sort=criticality&pageSize=5');
    expect(sorted.body.items.every((c: LooseJson) => c.criticality === 'critical')).toBe(true);
  });

  it('validates references instead of trusting client ids', async () => {
    const badClass = await h.call(admin, 'POST', '/api/v1/cmdb/cis', { name: 'x', classKey: 'nope' });
    expect(badClass.status).toBe(400);
    expect(badClass.body.error.code).toBe('VALIDATION_FAILED');
    expect(badClass.body.error.details.issues[0].path).toBe('classKey');
    const badOwner = await h.call(admin, 'POST', '/api/v1/cmdb/cis', {
      name: 'x',
      classKey: 'server',
      ownerId: '0190a1b2-0000-7000-8000-000000000000',
    });
    expect(badOwner.status).toBe(400);
    expect(badOwner.body.error.details.issues[0].path).toBe('ownerId');
  });

  it('creates, reads by id and number, updates, retires and deletes — audited and evented', async () => {
    const res = await h.call(admin, 'POST', '/api/v1/cmdb/cis', {
      name: 'tpe-app-09',
      classKey: 'server',
      environment: 'staging',
      criticality: 'high',
      ownerId: h.ids.hr,
      tags: ['linux', 'linux', 'staging'],
      description: 'Staging app server',
    });
    expect(res.status).toBe(201);
    created = res.body;
    expect(created.reference).toMatch(/^CI-\d{5}$/);
    expect(created.status).toBe('in_use');
    expect(created.tags).toEqual(['linux', 'staging']);
    expect(created.owner.id).toBe(h.ids.hr);
    expect(created.class).toMatchObject({ key: 'server', icon: 'server' });
    expect(created.canManage).toBe(true);
    expect(created.relationshipCounts).toEqual({ total: 0, outgoing: 0, incoming: 0 });

    const byNumber = await h.call(admin, 'GET', `/api/v1/cmdb/cis/${created.reference}`);
    expect(byNumber.status).toBe(200);
    expect(byNumber.body.id).toBe(created.id);
    expect((await h.call(admin, 'GET', '/api/v1/cmdb/cis/CI-99999')).status).toBe(404);
    expect((await h.call(admin, 'GET', '/api/v1/cmdb/cis/not-a-ref')).status).toBe(404);

    const patched = await h.call(admin, 'PATCH', `/api/v1/cmdb/cis/${created.id}`, {
      criticality: 'critical',
      supportGroupId: null,
      description: 'Staging app server (Ubuntu)',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.criticality).toBe('critical');

    const retired = await h.call(admin, 'POST', `/api/v1/cmdb/cis/${created.id}/retire`);
    expect(retired.body.status).toBe('retired');
    const again = await h.call(admin, 'POST', `/api/v1/cmdb/cis/${created.id}/retire`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');

    // A relationship is deleted with the CI.
    await h.call(admin, 'POST', '/api/v1/cmdb/relationships', {
      sourceId: created.id,
      targetId: ci('tpe-esx-01'),
      type: 'runs_on',
    });
    expect((await h.call(admin, 'DELETE', `/api/v1/cmdb/cis/${created.id}`)).status).toBe(204);
    expect((await h.call(admin, 'GET', `/api/v1/cmdb/cis/${created.id}`)).status).toBe(404);
    const left = await h.kernel.db
      .select()
      .from(ciRelationships)
      .where(eq(ciRelationships.sourceId, created.id));
    expect(left).toHaveLength(0);

    const audit = await h.kernel.db
      .select({ action: auditLogs.action, changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'cmdb.ci'), eq(auditLogs.entityId, created.id)));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'cmdb.ci.created',
        'cmdb.ci.updated',
        'cmdb.ci.retired',
        'cmdb.relationship.created',
        'cmdb.ci.deleted',
      ]),
    );
    expect(audit.find((a) => a.action === 'cmdb.ci.updated')!.changes).toMatchObject({
      criticality: ['high', 'critical'],
    });
    const events = await h.kernel.db
      .select({ name: outboxEvents.name, payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.moduleId, 'cmdb'));
    const mine = events
      .filter((e) => (e.payload as { ciId?: string }).ciId === created.id)
      .map((e) => e.name);
    expect(mine).toEqual(
      expect.arrayContaining(['cmdb.ci.created', 'cmdb.ci.updated', 'cmdb.ci.retired', 'cmdb.ci.deleted']),
    );
    expect(events.map((e) => e.name)).toContain('cmdb.relationship.created');
  });

  it('returns relationships labelled from each CI’s point of view', async () => {
    const res = await h.call(admin, 'GET', `/api/v1/cmdb/cis/${ci('erp-db-01')}/relationships`);
    expect(res.status).toBe(200);
    const rows = res.body.items.map((r: LooseJson) => `${r.direction} ${r.label} ${r.ci.name}`);
    expect(rows).toEqual(
      expect.arrayContaining([
        'incoming used by ERP Application',
        'outgoing runs on tpe-esx-01',
        'incoming backed up by bkp-01',
      ]),
    );
    const detail = await h.call(admin, 'GET', `/api/v1/cmdb/cis/${ci('erp-db-01')}`);
    expect(detail.body.relationshipCounts).toEqual({ total: 3, outgoing: 1, incoming: 2 });
  });
});

describe('relationship rules', () => {
  const post = (body: object) => h.call(admin, 'POST', '/api/v1/cmdb/relationships', body);

  it('refuses self links, duplicates and containment cycles with RELATIONSHIP_INVALID', async () => {
    const self = await post({ sourceId: ci('nas-01'), targetId: ci('nas-01'), type: 'depends_on' });
    expect(self.status).toBe(409);
    expect(self.body.error).toMatchObject({ code: 'RELATIONSHIP_INVALID', details: { reason: 'self' } });

    const dup = await post({ sourceId: ci('fs-01'), targetId: ci('nas-01'), type: 'depends_on' });
    expect(dup.body.error).toMatchObject({ code: 'RELATIONSHIP_INVALID', details: { reason: 'duplicate' } });

    // Taipei Data Center ⊃ Rack A1 ⊃ tpe-esx-01: the host can't contain the data center.
    const cycle = await post({
      sourceId: ci('tpe-esx-01'),
      targetId: ci('Taipei Data Center'),
      type: 'contains',
    });
    expect(cycle.body.error).toMatchObject({ code: 'RELATIONSHIP_INVALID', details: { reason: 'cycle' } });
    const direct = await post({
      sourceId: ci('TPE-DC Rack A1'),
      targetId: ci('Taipei Data Center'),
      type: 'contains',
    });
    expect(direct.body.error.details.reason).toBe('cycle');

    // Other types may point "back" (they are not containment).
    const ok = await post({
      sourceId: ci('tpe-esx-01'),
      targetId: ci('Taipei Data Center'),
      type: 'depends_on',
      note: 'Power and cooling',
    });
    expect(ok.status).toBe(201);
    const removed = await h.call(admin, 'DELETE', `/api/v1/cmdb/relationships/${ok.body.id}`);
    expect(removed.status).toBe(204);
    expect((await h.call(admin, 'DELETE', `/api/v1/cmdb/relationships/${ok.body.id}`)).status).toBe(404);
  });

  it('refuses unknown CIs', async () => {
    const res = await post({
      sourceId: ci('nas-01'),
      targetId: '0190a1b2-0000-7000-8000-000000000000',
      type: 'depends_on',
    });
    expect(res.status).toBe(404);
  });
});

describe('impact analysis', () => {
  const impact = async (name: string, depth: number) =>
    (await h.call(admin, 'GET', `/api/v1/cmdb/cis/${ci(name)}/impact?depth=${depth}`)).body;
  const at = (nodes: LooseJson[]) => new Map(nodes.map((n) => [n.ci.name as string, n]));

  it('walks upstream: losing the core switch takes services down, layer by layer', async () => {
    const res = await impact('tpe-sw-core-01', 5);
    const up = at(res.impacted);
    expect(up.get('tpe-esx-01')).toMatchObject({
      depth: 1,
      edgeType: 'depends_on',
      parentId: ci('tpe-sw-core-01'),
    });
    expect(up.get('erp-app-01')).toMatchObject({ depth: 2, edgeType: 'runs_on', parentId: ci('tpe-esx-01') });
    expect(up.get('ERP Application')).toMatchObject({ depth: 3 });
    expect(up.get('Finance ERP')).toMatchObject({ depth: 4, isService: true });
    expect(up.get('Single Sign-On')).toMatchObject({ depth: 3, isService: true });
    // connects_to doesn't propagate failures; the rack containing the switch isn't impacted.
    expect(up.has('tpe-fw-01')).toBe(false);
    expect(up.has('TPE-DC Rack A1')).toBe(false);
    expect(res.impactedServices).toBe(res.impacted.filter((n: LooseJson) => n.isService).length);
    expect(res.impactedServices).toBeGreaterThanOrEqual(8);
    expect(res.root.name).toBe('tpe-sw-core-01');
    expect(res.truncated).toBe(false);

    const shallow = await impact('tpe-sw-core-01', 1);
    expect(shallow.impacted.every((n: LooseJson) => n.depth === 1)).toBe(true);
    expect((await h.call(admin, 'GET', `/api/v1/cmdb/cis/${ci('nas-01')}/impact?depth=6`)).status).toBe(400);
  });

  it('follows containment downwards and reports what a CI needs', async () => {
    const dc = await impact('Taipei Data Center', 3);
    const up = at(dc.impacted);
    expect(up.get('TPE-DC Rack A1')).toMatchObject({ depth: 1, edgeType: 'contains' });
    expect(up.get('tpe-esx-01')).toMatchObject({ depth: 2, edgeType: 'contains' });
    expect(up.get('erp-app-01')).toMatchObject({ depth: 3, edgeType: 'runs_on' });

    const erp = await impact('Finance ERP', 5);
    const down = at(erp.dependsOn);
    expect(down.get('ERP Application')).toMatchObject({ depth: 1, edgeType: 'depends_on' });
    expect(down.get('erp-db-01')).toMatchObject({ depth: 2 });
    expect(down.get('tpe-esx-01')).toMatchObject({ depth: 3 });
    expect(down.get('TPE-DC Rack A1')).toMatchObject({ depth: 4, edgeType: 'contains' });
    expect(down.get('Taipei Data Center')).toMatchObject({ depth: 5, edgeType: 'contains' });
    expect(erp.impacted).toEqual([]);
  });

  it('is cycle-safe and matches the reference traversal', async () => {
    // A dependency loop: tpe-san-01 → dc-01 → tpe-esx-01 → tpe-san-01.
    const loop = await h.call(admin, 'POST', '/api/v1/cmdb/relationships', {
      sourceId: ci('tpe-san-01'),
      targetId: ci('dc-01'),
      type: 'depends_on',
    });
    expect(loop.status).toBe(201);
    const edges: Edge[] = (await h.kernel.db.select().from(ciRelationships)).map((r) => ({
      sourceId: r.sourceId,
      targetId: r.targetId,
      type: r.type,
    }));
    for (const name of ['tpe-sw-core-01', 'tpe-san-01', 'Single Sign-On', 'Taipei Data Center', 'bkp-01']) {
      for (const depth of [2, 5]) {
        const res = await impact(name, depth);
        for (const [key, direction] of [
          ['impacted', 'impacted'],
          ['dependsOn', 'dependsOn'],
        ] as const) {
          const expected = traverse(edges, ci(name), direction, depth)
            .map((n) => `${n.id}@${n.depth}`)
            .sort();
          const actual = (res[key] as LooseJson[]).map((n) => `${n.ci.id}@${n.depth}`).sort();
          expect(actual, `${name} ${key} depth ${depth}`).toEqual(expected);
          expect((res[key] as LooseJson[]).some((n) => n.ci.id === ci(name))).toBe(false);
        }
      }
    }
    await h.call(admin, 'DELETE', `/api/v1/cmdb/relationships/${loop.body.id}`);
  });
});

describe('classes', () => {
  it('lists system classes and lets admins add, rename and delete their own', async () => {
    const list = await h.call(admin, 'GET', '/api/v1/cmdb/classes');
    expect(list.body.items.filter((c: LooseJson) => c.system)).toHaveLength(9);
    expect(list.body.items.find((c: LooseJson) => c.key === 'business-service').ciCount).toBe(10);

    const created = await h.call(admin, 'POST', '/api/v1/cmdb/classes', {
      key: 'iot-device',
      name: { en: 'IoT device', 'zh-TW': '物聯網裝置' },
      icon: 'cpu',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'iot-device', system: false, ciCount: 0 });
    expect(
      (await h.call(admin, 'POST', '/api/v1/cmdb/classes', { key: 'iot-device', name: { en: 'x' } })).status,
    ).toBe(409);

    const renamed = await h.call(admin, 'PATCH', '/api/v1/cmdb/classes/server', {
      name: { en: 'Server (physical or virtual)' },
      icon: 'server-cog',
    });
    expect(renamed.body).toMatchObject({ icon: 'server-cog', system: true });

    const sensor = await h.call(admin, 'POST', '/api/v1/cmdb/cis', {
      name: 'temp-sensor-01',
      classKey: 'iot-device',
    });
    const inUse = await h.call(admin, 'DELETE', '/api/v1/cmdb/classes/iot-device');
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('IN_USE');
    await h.call(admin, 'DELETE', `/api/v1/cmdb/cis/${sensor.body.id}`);
    expect((await h.call(admin, 'DELETE', '/api/v1/cmdb/classes/iot-device')).status).toBe(204);

    const system = await h.call(admin, 'DELETE', '/api/v1/cmdb/classes/other');
    expect(system.status).toBe(409);
    expect(system.body.error.code).toBe('INVALID_STATE');
  });
});

describe('AI tools and search', () => {
  it('finds CIs, describes one and analyses impact through the tool registry', async () => {
    const ai = h.kernel.registry.context('cmdb').ai;
    const auth = await authFor(h.ids.admin);
    const found = await ai.tools.invoke<LooseJson[]>('cmdb.find_cis', { query: 'erp' }, { auth });
    expect(found.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Finance ERP', 'erp-db-01', 'erp-app-01']),
    );
    expect(found[0]).toMatchObject({
      number: expect.stringMatching(/^CI-/),
      href: expect.stringMatching(/^\/cmdb\/CI-/),
    });

    const dbOnly = await ai.tools.invoke<LooseJson[]>(
      'cmdb.find_cis',
      { query: 'erp', classKey: 'database' },
      { auth },
    );
    expect(dbOnly.map((c) => c.name).sort()).toEqual(['erp-db-01', 'erp-db-test-01']);

    const one = await ai.tools.invoke<LooseJson>(
      'cmdb.get_ci',
      { number: found.find((c) => c.name === 'erp-db-01')!.number },
      { auth },
    );
    expect(one.name).toBe('erp-db-01');
    expect(one.relationships.map((r: LooseJson) => `${r.label} ${r.ci.name}`)).toContain(
      'used by ERP Application',
    );
    await expect(ai.tools.invoke('cmdb.get_ci', {}, { auth })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    const blast = await ai.tools.invoke<LooseJson>('cmdb.get_impact', { ciId: ci('erp-db-01') }, { auth });
    expect(blast.depth).toBe(3);
    expect(blast.impacted.find((n: LooseJson) => n.name === 'Finance ERP')).toMatchObject({
      isBusinessService: true,
      depth: 2,
      via: 'depends on',
    });

    const denied = await authFor(h.ids.outsider);
    await expect(ai.tools.invoke('cmdb.find_cis', { query: 'erp' }, { auth: denied })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('feeds the global search for people who can read the CMDB', async () => {
    const hits = await h.kernel.search('erp-db', await authFor(h.ids.admin));
    expect(
      hits.some((x) => x.moduleId === 'cmdb' && x.title === 'erp-db-01' && x.href.startsWith('/cmdb/CI-')),
    ).toBe(true);
    const none = await h.kernel.search('erp-db', await authFor(h.ids.outsider));
    expect(none.some((x) => x.moduleId === 'cmdb')).toBe(false);
  });
});

describe('offboarding', () => {
  it('clears the owner of a leaver’s CIs and audits it', async () => {
    await h.call(admin, 'PATCH', `/api/v1/cmdb/cis/${ci('nas-01')}`, { ownerId: h.ids.hr });
    const res = await h.call(admin, 'POST', `/api/v1/users/${h.ids.hr}/offboard`, {
      reason: 'Left the company',
    });
    expect(res.status).toBe(200);
    const after = await eventually(
      () => h.call(admin, 'GET', `/api/v1/cmdb/cis/${ci('nas-01')}`),
      (r) => r.body.owner === null,
    );
    expect(after.body.owner).toBeNull();
    const audit = await h.kernel.db
      .select({ changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'cmdb.ci.owner_released'), eq(auditLogs.entityId, ci('nas-01'))));
    expect(audit[0]!.changes).toEqual({ ownerId: [h.ids.hr, null] });
  });
});
