import { departments, groupMembers, groups, users } from '@isbp/db/schema';
import { actionItems, meetings } from '@isbp/module-meetings/schema';
import { projects, reportTemplates, statusSchedule, statusUpdates } from '@isbp/module-projects/schema';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { seedPhase11Links } from '../../src/seed-phase11';
import { createHarness, type Harness, PASSWORD } from './harness';

/** The Projects demo data, with Phase 11's status reporting and meeting minutes: idempotent, and the report reads it. */
let h: Harness;

const seed = async () => {
  const m = h.kernel.registry.get('projects')!;
  await m.seed!(h.kernel.registry.context('projects'));
};

beforeAll(async () => {
  h = await createHarness();
  const db = h.kernel.db;
  const hash = await hashPassword(PASSWORD);
  const [it] = await db
    .insert(departments)
    .values({ code: 'IS-INF', name: 'Infrastructure', path: '/' })
    .returning();
  const people = [];
  for (const username of ['ann', 'ben', 'cho', 'dai', 'eve', 'fay'])
    people.push(
      (
        await db
          .insert(users)
          .values({
            email: `${username}@test.example`,
            username,
            displayName: username.toUpperCase(),
            departmentId: it!.id,
            passwordHash: hash,
          })
          .returning()
      )[0]!,
    );
  const [team] = await db.insert(groups).values({ key: 'network-team', name: 'Network Team' }).returning();
  await db.insert(groupMembers).values(people.slice(0, 3).map((p) => ({ groupId: team!.id, userId: p.id })));
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('projects demo data', () => {
  it('seeds projects, the reporting schedule and weeks of status updates once', async () => {
    await seed();
    const [p] = await h.kernel.db.select({ n: count() }).from(projects);
    expect(p!.n).toBeGreaterThan(3);
    const [schedule] = await h.kernel.db.select().from(statusSchedule);
    expect(schedule).toMatchObject({ enabled: true, cadence: 'weekly', groupKey: 'network-team' });
    const [templates] = await h.kernel.db.select({ n: count() }).from(reportTemplates);
    expect(templates!.n).toBe(2);
    const sent = await h.kernel.db.select().from(statusUpdates).where(eq(statusUpdates.state, 'submitted'));
    expect(sent.length).toBeGreaterThan(8);
    expect(new Set(sent.map((u) => u.periodKey)).size).toBeGreaterThanOrEqual(4);
    const pending = await h.kernel.db.select().from(statusUpdates).where(eq(statusUpdates.state, 'pending'));
    expect(pending.length).toBeGreaterThan(0);

    const before = await h.kernel.db.select({ n: count() }).from(statusUpdates);
    await seed();
    const after = await h.kernel.db.select({ n: count() }).from(statusUpdates);
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('builds a status report from it', async () => {
    const admin = await h.login('admin');
    const res = await h.call(admin, 'GET', '/api/v1/projects/status-report?template=detailed');
    expect(res.status).toBe(200);
    expect(res.body.counts.total).toBeGreaterThan(0);
    expect(res.body.counts.submitted).toBeGreaterThan(0);
    const previous = await h.call(
      admin,
      'GET',
      `/api/v1/projects/status-report?period=${res.body.previousKey}`,
    );
    expect(previous.body.counts.submitted).toBeGreaterThan(0);
  });

  it('records meeting minutes about the network project after it, with items that became its tasks', async () => {
    await seedPhase11Links(h.kernel);
    const rows = await h.kernel.db.select().from(meetings);
    expect(rows.map((m) => m.status).sort()).toEqual(['draft', 'published', 'published']);
    const items = await h.kernel.db.select().from(actionItems);
    const routed = items.filter((i) => i.targetReference);
    expect(routed.length).toBeGreaterThan(0);
    for (const i of routed) expect(i.targetReference).toMatch(/^NET-\d+$/);
    expect(items.some((i) => i.destination === 'meeting' && i.status === 'open')).toBe(true);

    const admin = await h.login('admin');
    const sync = rows.find(
      (m) => m.status === 'published' && m.previousId === null && m.title.includes('sync'),
    )!;
    const detail = await h.call(admin, 'GET', `/api/v1/meetings/meetings/${sync.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.projects.map((p: { key: string }) => p.key)).toEqual(['NET']);
    // The follow-up lists the sync's open items.
    const next = rows.find((m) => m.previousId === sync.id)!;
    expect(
      (await h.call(admin, 'GET', `/api/v1/meetings/meetings/${next.id}`)).body.earlierItems.length,
    ).toBeGreaterThan(0);

    await seedPhase11Links(h.kernel);
    expect((await h.kernel.db.select({ n: count() }).from(meetings))[0]!.n).toBe(3);
  });
});
