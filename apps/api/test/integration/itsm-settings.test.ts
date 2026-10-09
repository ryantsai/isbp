/**
 * Service desk settings: categories in order (subcategories included in SLA rules), SLA policies that are placed so
 * they apply, flagged when they never do, reordered and named in every language, and the groups that have agents.
 *
 *   DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_c5_test REDIS_URL=redis://localhost:6379/15 \
 *   pnpm --filter @isbp/api exec vitest run --project integration test/integration/itsm-settings.test.ts
 */
import { groupMembers, groups, roleAssignments, roles, users } from '@isbp/db/schema';
import { type Db } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { toSessionUser } from '../../src/kernel/sessions';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
const s: Record<string, Session> = {};
const ids = {} as Record<
  | 'agent'
  | 'clerk'
  | 'desk'
  | 'hr'
  | 'calendar'
  | 'critical'
  | 'incidents'
  | 'requests'
  | 'hardware'
  | 'laptop',
  string
>;

const API = '/api/v1/itsm';
const target = (response: number, resolution: number) => ({
  responseMinutes: response,
  resolutionMinutes: resolution,
});
const flat = (response: number, resolution: number) => ({
  '1': target(response, resolution),
  '2': target(response, resolution),
  '3': target(response, resolution),
  '4': target(response, resolution),
});

async function mkUser(username: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  return u!.id;
}

const policies = async () => (await h.call(s.admin!, 'GET', `${API}/sla-policies`)).body.items as LooseJson[];
const order = async () => (await policies()).map((p) => p.id as string);
const policy = async (id: string) => (await policies()).find((p) => p.id === id);

async function createPolicy(body: Record<string, unknown>) {
  const res = await h.call(s.admin!, 'POST', `${API}/sla-policies`, {
    description: null,
    condition: null,
    calendarId: ids.calendar,
    pauseStatuses: ['on_hold'],
    warnAt: 0.75,
    active: true,
    targets: flat(60, 480),
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as LooseJson;
}

beforeAll(async () => {
  h = await createHarness();
  const db = h.kernel.db;
  ids.agent = await mkUser('agent');
  ids.clerk = await mkUser('clerk');
  const [desk] = await db.insert(groups).values({ key: 'service-desk', name: 'Service Desk' }).returning();
  const [hr] = await db.insert(groups).values({ key: 'hr-team', name: 'HR Team' }).returning();
  ids.desk = desk!.id;
  ids.hr = hr!.id;
  await db.insert(groupMembers).values([
    { groupId: ids.desk, userId: ids.agent },
    { groupId: ids.hr, userId: ids.clerk },
  ]);
  const [agentRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'itsm-agent'));
  await db.insert(roleAssignments).values({ roleId: agentRole!.id, userId: ids.agent });
  await h.kernel.rbac.bump();
  s.admin = await h.login('admin');
  s.agent = await h.login('agent');

  const days = Array.from({ length: 7 }, () => [] as { start: string; end: string }[]);
  const cal = await h.call(s.admin, 'POST', `${API}/calendars`, {
    name: '24×7',
    timezone: 'UTC',
    hours: { days },
    holidays: [],
    alwaysOpen: true,
  });
  ids.calendar = cal.body.id;
  ids.critical = (
    await createPolicy({
      name: 'Critical incidents',
      ticketTypes: ['incident'],
      condition: { fact: 'ticket.priority', op: 'eq', value: 1 },
      targets: flat(15, 240),
      sortOrder: 10,
    })
  ).id;
  ids.incidents = (await createPolicy({ name: 'Incidents', ticketTypes: ['incident'], sortOrder: 20 })).id;
  ids.requests = (
    await createPolicy({ name: 'Service requests', ticketTypes: ['service_request'], sortOrder: 30 })
  ).id;
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('groups', () => {
  it('counts the members who can work tickets', async () => {
    const res = await h.call(s.admin!, 'GET', `${API}/groups`);
    expect(res.status).toBe(200);
    const by = new Map(res.body.items.map((g: LooseJson) => [g.key, g]));
    expect(by.get('service-desk')).toMatchObject({ memberCount: 1, agentCount: 1, worksTickets: false });
    expect(by.get('hr-team')).toMatchObject({ memberCount: 1, agentCount: 0, worksTickets: false });
    // A group that routes a category is a service desk group, listed first by pickers.
    const cat = await h.call(s.admin!, 'POST', `${API}/categories`, {
      key: 'desk-routed',
      name: { en: 'Routed' },
      ticketTypes: ['incident'],
      defaultGroupId: ids.desk,
    });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    const again = await h.call(s.admin!, 'GET', `${API}/groups`);
    expect(again.body.items.find((g: LooseJson) => g.key === 'service-desk').worksTickets).toBe(true);
    expect((await h.call(s.admin!, 'DELETE', `${API}/categories/${cat.body.id}`)).status).toBe(204);
  });
});

describe('categories', () => {
  it('adds new categories after their siblings and reorders one level', async () => {
    const mk = async (key: string, parentId: string | null = null) => {
      const res = await h.call(s.admin!, 'POST', `${API}/categories`, {
        key,
        name: { en: key },
        parentId,
        ticketTypes: ['incident', 'service_request'],
      });
      expect(res.status).toBe(201);
      return res.body as LooseJson;
    };
    const hw = await mk('hardware');
    const net = await mk('network');
    ids.hardware = hw.id;
    expect([hw.sortOrder, net.sortOrder]).toEqual([10, 20]);
    const laptop = await mk('hardware-laptop', hw.id);
    ids.laptop = laptop.id;
    const printer = await mk('hardware-printer', hw.id);
    expect([laptop.sortOrder, printer.sortOrder]).toEqual([10, 20]);

    const moved = await h.call(s.admin!, 'PUT', `${API}/categories/order`, {
      parentId: hw.id,
      ids: [printer.id, laptop.id],
    });
    expect(moved.status).toBe(200);
    const children = moved.body.items
      .filter((c: LooseJson) => c.parentId === hw.id)
      .sort((a: LooseJson, b: LooseJson) => a.sortOrder - b.sortOrder)
      .map((c: LooseJson) => c.key);
    expect(children).toEqual(['hardware-printer', 'hardware-laptop']);

    // Every child of the level, once: anything else means the list changed meanwhile.
    const stale = await h.call(s.admin!, 'PUT', `${API}/categories/order`, {
      parentId: hw.id,
      ids: [laptop.id],
    });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'CONFLICT']);
    const notMine = await h.call(s.agent!, 'PUT', `${API}/categories/order`, {
      parentId: hw.id,
      ids: [laptop.id, printer.id],
    });
    expect(notMine.status).toBe(403);
  });

  it('puts a category moved under another parent after its new siblings', async () => {
    const res = await h.call(s.admin!, 'POST', `${API}/categories`, {
      key: 'docking',
      name: { en: 'Docking stations' },
      ticketTypes: ['incident'],
    });
    const moved = await h.call(s.admin!, 'PATCH', `${API}/categories/${res.body.id}`, {
      parentId: ids.hardware,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.sortOrder).toBe(30);
  });
});

describe('SLA policies', () => {
  let hardwarePolicy = '';

  it('places a category policy before the general one, so it applies to subcategories too', async () => {
    const created = await createPolicy({
      name: { en: 'Hardware incidents', 'zh-TW': '硬體事件', 'ja-JP': 'ハードウェア インシデント' },
      ticketTypes: ['incident'],
      condition: { fact: 'ticket.categoryKeys', op: 'eq', value: 'hardware' },
      targets: flat(30, 120),
    });
    hardwarePolicy = created.id;
    // After the P1 policy (which keeps P1 hardware incidents), before "Incidents".
    expect(await order()).toEqual([ids.critical, hardwarePolicy, ids.incidents, ids.requests]);
    expect(created.sortOrder).toBe(15);
    expect(created.reach).toEqual({ blocked: [] });
    expect(created.name).toEqual({
      en: 'Hardware incidents',
      'zh-TW': '硬體事件',
      'ja-JP': 'ハードウェア インシデント',
    });

    // A laptop (a subcategory of Hardware) incident gets it; the ticket's SLA keeps the plain (English) name and the
    // policy's name in every language for the timer.
    const t = await h.call(s.agent!, 'POST', `${API}/tickets`, {
      title: 'Laptop keyboard broken',
      categoryId: ids.laptop,
      impact: 2,
      urgency: 2,
    });
    expect(t.status).toBe(201);
    const response = t.body.slas.find((x: LooseJson) => x.metric === 'response');
    expect(response.policy).toEqual({
      id: hardwarePolicy,
      name: 'Hardware incidents',
      label: { en: 'Hardware incidents', 'zh-TW': '硬體事件', 'ja-JP': 'ハードウェア インシデント' },
    });

    // A P1 one still gets the critical targets.
    const p1 = await h.call(s.agent!, 'POST', `${API}/tickets`, {
      title: 'Every laptop is down',
      categoryId: ids.laptop,
      impact: 1,
      urgency: 1,
    });
    expect(p1.body.slas[0].policy.id).toBe(ids.critical);
  });

  it('flags a policy that never applies, and "check it first" moves it before the policy that takes its tickets', async () => {
    const late = await createPolicy({
      name: 'Network incidents',
      ticketTypes: ['incident', 'service_request'],
      condition: { fact: 'ticket.categoryKeys', op: 'eq', value: 'network' },
      sortOrder: 100,
    });
    expect(late.reach).toEqual({
      blocked: [
        { type: 'incident', by: ids.incidents },
        { type: 'service_request', by: ids.requests },
      ],
    });

    const placed = await h.call(s.admin!, 'PATCH', `${API}/sla-policies/${late.id}`, {
      placeBefore: ids.incidents,
    });
    expect(placed.status).toBe(200);
    expect(placed.body.reach).toEqual({ blocked: [] });
    expect(await order()).toEqual([ids.critical, hardwarePolicy, late.id, ids.incidents, ids.requests]);

    const self = await h.call(s.admin!, 'PATCH', `${API}/sla-policies/${late.id}`, { placeBefore: late.id });
    expect(self.body.error.code).toBe('VALIDATION_FAILED');
    await h.call(s.admin!, 'DELETE', `${API}/sla-policies/${late.id}`);
  });

  it('makes room when neighbours have consecutive numbers', async () => {
    const a = await createPolicy({ name: 'A', ticketTypes: ['change'], sortOrder: 40 });
    const b = await createPolicy({ name: 'B', ticketTypes: ['change'], sortOrder: 41 });
    const c = await createPolicy({ name: 'C', ticketTypes: ['change'], placeBefore: b.id });
    expect(await order()).toEqual([
      ids.critical,
      hardwarePolicy,
      ids.incidents,
      ids.requests,
      a.id,
      c.id,
      b.id,
    ]);
    expect((await policies()).map((p) => p.sortOrder)).toEqual([10, 20, 30, 40, 50, 60, 70]);
    for (const p of [a, b, c]) await h.call(s.admin!, 'DELETE', `${API}/sla-policies/${p.id}`);
  });

  it('reorders every policy at once (Move up / Move down)', async () => {
    const now = await order();
    const swapped = [now[1]!, now[0]!, ...now.slice(2)];
    const res = await h.call(s.admin!, 'PUT', `${API}/sla-policies/order`, { ids: swapped });
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: LooseJson) => p.id)).toEqual(swapped);
    // The hardware policy now comes first: P1 hardware incidents get it, nothing is shadowed completely.
    expect(res.body.items.every((p: LooseJson) => p.reach.blocked.length === 0)).toBe(true);

    const stale = await h.call(s.admin!, 'PUT', `${API}/sla-policies/order`, { ids: swapped.slice(1) });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'CONFLICT']);
    await h.call(s.admin!, 'PUT', `${API}/sla-policies/order`, { ids: now });
    expect(await order()).toEqual(now);
  });

  it('keeps plain-text names working and localizes the name in pickers', async () => {
    const plain = await policy(ids.incidents);
    expect(plain.name).toEqual({ en: 'Incidents' });
    const renamed = await h.call(s.admin!, 'PATCH', `${API}/sla-policies/${ids.incidents}`, {
      name: { en: 'Incidents', 'zh-TW': '事件' },
    });
    expect(renamed.body.name).toEqual({ en: 'Incidents', 'zh-TW': '事件' });
    const tooLong = await h.call(s.admin!, 'PATCH', `${API}/sla-policies/${ids.incidents}`, {
      name: { 'ja-JP': 'あ'.repeat(201) },
    });
    expect(tooLong.status).toBe(400);
  });
});

describe('itsm.sla-policy customisation kind', () => {
  it('places a policy created without an order, and round-trips the localized name', async () => {
    const [u] = await h.kernel.db.select().from(users).where(eq(users.username, 'admin'));
    const auth = buildAuthContext(
      { type: 'user', id: u!.id, name: u!.displayName },
      toSessionUser(u!),
      null,
      await h.kernel.rbac.permissionsFor(u!.id),
    );
    const cz = h.kernel.customizations;
    const value = {
      name: 'Hardware requests',
      description: null,
      ticketTypes: ['service_request'],
      condition: { fact: 'ticket.categoryKeys', op: 'eq', value: 'hardware' },
      targets: flat(120, 960),
      calendarId: ids.calendar,
    };
    const created = await h.kernel.db.transaction((tx) =>
      cz.apply('itsm.sla-policy', { op: 'create', id: null, value }, { auth, tx: tx as unknown as Db }),
    );
    const list = await order();
    expect(list.indexOf(created.id)).toBe(list.indexOf(ids.requests) - 1);
    const got = (await cz.get('itsm.sla-policy', created.id, auth))!;
    expect(got.value).toMatchObject({ name: { en: 'Hardware requests' } });
    const same = await h.kernel.db.transaction((tx) =>
      cz.apply(
        'itsm.sla-policy',
        { op: 'update', id: created.id, value: got.value, baseVersion: got.version } as never,
        { auth, tx: tx as unknown as Db },
      ),
    );
    expect(same.after!.version).toBe(got.version);
    const guide = (await cz.describe('itsm.sla-policy', auth)).guide.reference as LooseJson;
    expect(guide.policies.map((p: LooseJson) => p.id)).toEqual(list);
    expect(guide.facts['ticket.categoryKeys']).toBeTruthy();
  });
});
