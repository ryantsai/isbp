import { aiChunks, approvalTasks, groupMembers, groups, users } from '@isbp/db/schema';
import { changes, problems, ticketLinks, tickets, ticketSlas } from '@isbp/module-itsm/schema';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, everyPage, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let admin: Session;
const API = '/api/v1/itsm';

const seedModule = async (id: string) => {
  const m = h.kernel.registry.get(id)!;
  await m.seed!(h.kernel.registry.context(id));
};

beforeAll(async () => {
  h = await createHarness();
  const db = h.kernel.db;
  const hash = await hashPassword(PASSWORD);
  const mk = async (username: string, displayName: string, locale: string, departmentId: string | null) => {
    const [u] = await db
      .insert(users)
      .values({
        email: `${username}@test.example`,
        username,
        displayName,
        locale,
        departmentId,
        passwordHash: hash,
      })
      .returning();
    return u!.id;
  };
  const people = {
    helpdesk: await mk('helpdesk', '林雅婷', 'zh-TW', null),
    net: await mk('net1', 'Kevin Wu', 'en', null),
    sec: await mk('sec1', 'Mia Chen', 'en', null),
    dba: await mk('dba1', 'Ken Sato', 'ja-JP', null),
    itadmin: await mk('itadm', 'Grace Lee', 'en', null),
    cab: await mk('cabber', 'Paul Ho', 'en', null),
  };
  for (const [i, locale] of ['en', 'en', 'zh-TW', 'zh-TW', 'ja-JP', 'en'].entries())
    await mk(`staff${i}`, `Staff ${i}`, locale, i % 2 ? h.ids.salesTpe : h.ids.finance);
  const groupRows = await db
    .insert(groups)
    .values(
      ['service-desk', 'network-team', 'security-team', 'dba-team', 'it-admins', 'cab'].map((key) => ({
        key,
        name: key,
      })),
    )
    .returning();
  const gid = (key: string) => groupRows.find((g) => g.key === key)!.id;
  await db.insert(groupMembers).values([
    { groupId: gid('service-desk'), userId: people.helpdesk },
    { groupId: gid('network-team'), userId: people.net },
    { groupId: gid('security-team'), userId: people.sec },
    { groupId: gid('dba-team'), userId: people.dba },
    { groupId: gid('it-admins'), userId: people.itadmin },
    { groupId: gid('cab'), userId: people.cab },
  ]);
  await seedModule('cmdb');
  await seedModule('itsm');
  admin = await h.login('admin');
}, 240_000);

afterAll(async () => {
  await h?.close();
});

const countWhere = async (where?: ReturnType<typeof and>) =>
  (await h.kernel.db.select({ n: count() }).from(tickets).where(where))[0]!.n;

describe('itsm demo seed', () => {
  it('raises ~150 tickets of every type with a realistic mix of states', async () => {
    const byType = await h.kernel.db
      .select({ type: tickets.type, n: count() })
      .from(tickets)
      .groupBy(tickets.type);
    const n = Object.fromEntries(byType.map((r) => [r.type, r.n]));
    expect(n.incident).toBeGreaterThanOrEqual(100);
    expect(n.service_request).toBeGreaterThanOrEqual(30);
    expect(n.problem).toBe(6);
    expect(n.change).toBe(11);
    const total = await countWhere();
    const open = await countWhere(sql`${tickets.status} in ('new', 'in_progress', 'on_hold')`);
    expect(open / total).toBeGreaterThan(0.2);
    expect(open / total).toBeLessThan(0.5);
    expect(await countWhere(and(eq(tickets.major, true), eq(tickets.status, 'in_progress')))).toBe(1);
    expect(await countWhere(isNotNull(tickets.satisfaction))).toBeGreaterThan(10);
    expect(await countWhere(sql`${tickets.title} ~ '[一-龥]'`)).toBeGreaterThan(0);
  });

  it('links the VPN incidents to the known error and plans changes (one waiting for CAB)', async () => {
    const [vpn] = await h.kernel.db
      .select({ id: tickets.id, status: tickets.status, knownError: problems.knownError })
      .from(tickets)
      .innerJoin(problems, eq(problems.ticketId, tickets.id))
      .where(eq(tickets.title, 'VPN client 5.2 crashes on macOS 15'));
    expect(vpn).toMatchObject({ status: 'known_error', knownError: true });
    const [links] = await h.kernel.db
      .select({ n: count() })
      .from(ticketLinks)
      .where(and(eq(ticketLinks.targetId, vpn!.id), eq(ticketLinks.type, 'caused_by')));
    expect(links!.n).toBe(8);

    const [waiting] = await h.kernel.db
      .select({ instanceId: changes.approvalInstanceId })
      .from(changes)
      .innerJoin(tickets, eq(tickets.id, changes.ticketId))
      .where(eq(tickets.status, 'authorization'));
    expect(waiting?.instanceId).toBeTruthy();
    const tasks = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.instanceId, waiting!.instanceId!), eq(approvalTasks.status, 'pending')));
    expect(tasks.length).toBeGreaterThan(0);
    const standard = await h.kernel.db
      .select({ status: tickets.status })
      .from(changes)
      .innerJoin(tickets, eq(tickets.id, changes.ticketId))
      .where(eq(changes.changeType, 'standard'));
    expect(standard.map((s) => s.status)).toEqual(['scheduled']);
  });

  it('computes timers: some breached, some at risk now', async () => {
    const rows = await h.kernel.db
      .select({ status: ticketSlas.status, n: count() })
      .from(ticketSlas)
      .groupBy(ticketSlas.status);
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(by.met).toBeGreaterThan(50);
    expect(by.breached).toBeGreaterThan(0);
    const [atRisk] = await h.kernel.db
      .select({ n: count() })
      .from(ticketSlas)
      .where(and(eq(ticketSlas.status, 'running'), isNotNull(ticketSlas.warnedAt)));
    expect(atRisk!.n).toBeGreaterThanOrEqual(2);
    const queues = await h.call(admin, 'GET', `${API}/queues`);
    expect(queues.body).toMatchObject({ majorOpen: 1 });
    expect(queues.body.breached).toBeGreaterThan(0);
    expect(queues.body.atRisk).toBeGreaterThanOrEqual(2);
  });

  it('indexes resolved tickets for similar-ticket search', async () => {
    const [chunks] = await h.kernel.db
      .select({ n: sql<number>`count(distinct ${aiChunks.sourceId})`.mapWith(Number) })
      .from(aiChunks)
      .where(eq(aiChunks.sourceType, 'itsm.ticket'));
    expect(chunks!.n).toBeGreaterThan(50);
  });

  it('serves every seeded ticket through the API', async () => {
    const all = await h.kernel.db.select({ id: tickets.id }).from(tickets);
    for (const { id } of all) {
      const res = await h.call(admin, 'GET', `${API}/tickets/${id}`);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    }
    const list = await h.call(admin, 'GET', `${API}/tickets?pageSize=200&sort=-priority`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(all.length);
    const report = await h.call(admin, 'GET', `${API}/reports/overview?days=60`);
    expect(report.status).toBe(200);
    expect(report.body.topCategories.length).toBeGreaterThan(3);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const calendar = await everyPage(
      h,
      admin,
      `${API}/changes/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(
      calendar.items
        .filter((c: LooseJson) => c.hasConflict)
        .map((c: LooseJson) => c.title)
        .sort(),
    ).toEqual(['ERP application server OS patching', 'ERP database index rebuild']);
  });

  it('is idempotent', async () => {
    const before = await countWhere();
    await seedModule('itsm');
    expect(await countWhere()).toBe(before);
  });
});
