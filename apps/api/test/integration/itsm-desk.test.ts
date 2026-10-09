/**
 * The service desk's working flows after the UX pass: one primary step per status (submit a draft change, start
 * implementation takes ownership), concurrency on transitions, resolving with the article that solved it, problems
 * raised from their incidents and their known-error article, and the queues' scope (incidents and requests only).
 */
import { groupMembers, groups, recordLinks, roleAssignments, roles, users } from '@isbp/db/schema';
import { categories, ticketActivities as activities, tickets } from '@isbp/module-itsm/schema';
import { and, eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'alice' | 'agent' | 'cm', string>;
const API = '/api/v1/itsm';

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

const raise = (who: string, body: Record<string, unknown>) => h.call(s[who]!, 'POST', `${API}/tickets`, body);
const move = (who: string, ref: string, body: Record<string, unknown>) =>
  h.call(s[who]!, 'POST', `${API}/tickets/${ref}/transition`, body);

const statusEntries = async (ticketId: string, to: string) =>
  (await h.kernel.db.select().from(activities).where(eq(activities.ticketId, ticketId))).filter(
    (a) => a.kind === 'status' && (a.data as LooseJson).to === to,
  );

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  const db = h.kernel.db;
  ids.alice = await mkUser('alice', h.ids.salesTpe);
  ids.agent = await mkUser('agent');
  ids.cm = await mkUser('cm');
  const [sd] = await db.insert(groups).values({ key: 'service-desk', name: 'Service Desk' }).returning();
  await db.insert(groupMembers).values([{ groupId: sd!.id, userId: ids.agent }]);
  await db.insert(roleAssignments).values([
    { roleId: await roleId('itsm-agent'), userId: ids.agent },
    { roleId: await roleId('itsm-change-manager'), userId: ids.cm },
    { roleId: await roleId('itsm-agent'), userId: ids.cm },
  ]);
  await h.kernel.rbac.bump();
  await h.kernel.settings.update(
    h.kernel.registry.get('itsm')!.manifest,
    { defaultGroupKey: 'service-desk' },
    null,
  );
  for (const u of ['admin', 'alice', 'agent', 'cm']) s[u] = await h.login(u);
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('concurrent transitions', () => {
  it('lets exactly one of two simultaneous "resolve" requests through', async () => {
    const t = await raise('alice', { title: 'Printer jams on page two' });
    expect(t.status).toBe(201);
    const body = { status: 'resolved', resolutionCode: 'solved', resolutionNotes: 'Cleared the tray.' };
    const results = await Promise.all([
      move('agent', t.body.reference, body),
      move('agent', t.body.reference, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('INVALID_TRANSITION');
    expect(await statusEntries(t.body.id, 'resolved')).toHaveLength(1);
  });

  it('links two tickets once when the same link is added twice at once', async () => {
    const a = await raise('alice', { title: 'Wi-Fi drops in room 5' });
    const b = await raise('alice', { title: 'Wi-Fi drops in room 6' });
    const body = { target: b.body.reference, type: 'related' };
    const results = await Promise.all([
      h.call(s.agent!, 'POST', `${API}/tickets/${a.body.reference}/links`, body),
      h.call(s.agent!, 'POST', `${API}/tickets/${a.body.reference}/links`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await h.call(s.agent!, 'GET', `${API}/tickets/${a.body.reference}`);
    expect(after.body.links).toHaveLength(1);
  });

  it('lets exactly one of two simultaneous "it is fixed" confirmations close the ticket', async () => {
    const t = await raise('alice', { title: 'Monitor flickers' });
    await move('agent', t.body.reference, {
      status: 'resolved',
      resolutionCode: 'solved',
      resolutionNotes: 'New cable.',
    });
    const results = await Promise.all([
      h.call(s.alice!, 'POST', `${API}/tickets/${t.body.reference}/confirm`, {}),
      h.call(s.alice!, 'POST', `${API}/tickets/${t.body.reference}/confirm`, {}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await statusEntries(t.body.id, 'closed')).toHaveLength(1);
  });
});

describe('concurrent edits', () => {
  it('keeps the priority on impact × urgency when both are changed at once', async () => {
    const t = await raise('alice', { title: 'Shared drive is slow' });
    const results = await Promise.all([
      h.call(s.agent!, 'PATCH', `${API}/tickets/${t.body.reference}`, { impact: 1 }),
      h.call(s.agent!, 'PATCH', `${API}/tickets/${t.body.reference}`, { urgency: 1 }),
    ]);
    // Neither edit is lost: the second one is recomputed from the first one's result.
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const [row] = await h.kernel.db.select().from(tickets).where(eq(tickets.id, t.body.id));
    expect(row).toMatchObject({ impact: 1, urgency: 1, priority: 1 });
    const fields = (
      await h.kernel.db.select().from(activities).where(eq(activities.ticketId, t.body.id))
    ).filter((a) => a.kind === 'field');
    expect(fields).toHaveLength(2);
  });
});

describe('configuration seen across processes', () => {
  it('uses a category created elsewhere at once (the cache checks the database)', async () => {
    const before = await h.call(s.agent!, 'GET', `${API}/categories`);
    expect(before.status).toBe(200);
    // Written by "another process": straight into the table, so this process's cache is not told.
    const [row] = await h.kernel.db
      .insert(categories)
      .values({ key: 'meeting-rooms', name: { en: 'Meeting rooms' }, ticketTypes: ['incident'] })
      .returning();
    const after = await h.call(s.agent!, 'GET', `${API}/categories`);
    expect(after.body.items.map((c: LooseJson) => c.id)).toContain(row!.id);
    const t = await raise('agent', {
      title: 'Projector in room 7 is dead',
      categoryId: row!.id,
      requesterId: ids.alice,
    });
    expect(t.status).toBe(201);
    expect(t.body.category).toMatchObject({ key: 'meeting-rooms' });
  });
});

describe('changes: one primary step per status', () => {
  it('submits a draft for approval in one step and tells what is missing first', async () => {
    const c = await raise('cm', { type: 'change', title: 'Patch the VPN gateway' });
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('draft');
    expect(c.body.viewer.transitions).toContain('authorization');
    // No window yet: the reason comes back as fields (the page offers "Edit plan").
    const missing = await move('cm', c.body.reference, { status: 'authorization' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fields).toMatchObject({ plannedStart: 'required' });
    const start = new Date(Date.now() + 3 * 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    const plan = await h.call(s.cm!, 'PATCH', `${API}/tickets/${c.body.reference}/change`, {
      plannedStart: start.toISOString(),
      plannedEnd: end.toISOString(),
    });
    expect(plan.status).toBe(200);
    const submitted = await move('cm', c.body.reference, { status: 'authorization' });
    expect(submitted.status).toBe(200);
    // Past the draft in one call; the CAB (required workflow) decides from here.
    expect(['authorization', 'scheduled', 'rejected']).toContain(submitted.body.status);
    const entries = await statusEntries(c.body.id, 'authorization');
    expect(entries).toHaveLength(1);
    expect((entries[0]!.data as LooseJson).from).toBe('draft');
  });

  it('gives an unowned change to the person who starts implementing it', async () => {
    const start = new Date(Date.now() + 2 * 86_400_000);
    const c = await raise('cm', {
      type: 'change',
      title: 'Rotate the TLS certificate',
      change: {
        changeType: 'standard',
        plannedStart: start.toISOString(),
        plannedEnd: new Date(start.getTime() + 1_800_000).toISOString(),
      },
    });
    expect(c.body.assignee).toBeNull();
    // As if the CAB had approved it.
    await h.kernel.db.update(tickets).set({ status: 'scheduled' }).where(eq(tickets.id, c.body.id));
    const started = await move('cm', c.body.reference, { status: 'implementing' });
    expect(started.status).toBe(200);
    expect(started.body.assignee?.id).toBe(ids.cm);
  });
});

describe('problems from incidents', () => {
  it('raises a problem with its incidents linked as "caused by" and flags a known error from new', async () => {
    const a = await raise('alice', { title: 'VPN drops every few minutes' });
    const b = await raise('alice', { title: 'VPN disconnects at home' });
    const p = await raise('agent', {
      type: 'problem',
      title: 'VPN tunnels drop',
      ticketLinks: [
        { target: a.body.reference, type: 'caused_by', direction: 'incoming' },
        { target: b.body.reference, type: 'caused_by', direction: 'incoming' },
      ],
    });
    expect(p.status).toBe(201);
    expect(p.body.links).toHaveLength(2);
    expect(p.body.links.every((l: LooseJson) => l.type === 'caused_by' && l.direction === 'incoming')).toBe(
      true,
    );
    const incident = await h.call(s.agent!, 'GET', `${API}/tickets/${a.body.reference}`);
    expect(incident.body.links[0]).toMatchObject({ type: 'caused_by', direction: 'outgoing' });

    // Linking from the problem's side: "causes" this incident.
    const c = await raise('alice', { title: 'VPN keeps reconnecting' });
    const linked = await h.call(s.agent!, 'POST', `${API}/tickets/${p.body.reference}/links`, {
      target: c.body.reference,
      type: 'caused_by',
      direction: 'incoming',
    });
    expect(linked.status).toBe(200);
    expect(linked.body.links).toHaveLength(3);

    // A new problem can be marked as a known error directly (its status follows).
    const known = await move('agent', p.body.reference, { status: 'known_error' });
    expect(known.status).toBe(200);
    expect(known.body.status).toBe('known_error');
    expect(known.body.problem.knownError).toBe(true);
  });
});

describe('the desk queues', () => {
  it('count only open incidents and service requests', async () => {
    const before = (await h.call(s.agent!, 'GET', `${API}/queues`)).body;
    await raise('cm', { type: 'change', title: 'Draft change that waits for nobody' });
    await raise('agent', { type: 'problem', title: 'A problem has its own page' });
    await raise('alice', { type: 'service_request', title: 'New headset please' });
    const after = (await h.call(s.agent!, 'GET', `${API}/queues`)).body;
    expect(after.open - before.open).toBe(1);
    expect(after).toHaveProperty('attention');
    const list = await h.call(s.agent!, 'GET', `${API}/tickets?types=incident,service_request&pageSize=100`);
    expect(list.status).toBe(200);
    expect(list.body.items.every((r: LooseJson) => ['incident', 'service_request'].includes(r.type))).toBe(
      true,
    );
    const attention = await h.call(s.agent!, 'GET', `${API}/tickets?sla=attention&sort=slaDue`);
    expect(attention.status).toBe(200);
    const bad = await h.call(s.agent!, 'GET', `${API}/tickets?types=incident,nope`);
    expect(bad.status).toBe(400);
  });

  it('shows requesters their own words for a ticket in "My requests"', async () => {
    const t = await raise('alice', { title: 'Keyboard missing keys' });
    const mine = await h.call(s.alice!, 'GET', '/api/v1/me/requests?pageSize=100');
    expect(mine.status).toBe(200);
    const row = (mine.body.items as LooseJson[]).find((r) => r.reference === t.body.reference);
    expect(row?.statusKey).toBe('itsm.requesterStatus.new');
  });
});

describe('knowledge used to resolve', () => {
  it('links the article that solved it and writes a problem’s known-error article as a draft', async () => {
    // The admin holds every permission: knowledge drafts and publishing included.
    const p = await raise('admin', {
      type: 'problem',
      title: 'Printers lose their queue',
      requesterId: ids.alice,
    });
    expect(p.status).toBe(201);
    const written = await h.call(s.admin!, 'POST', `${API}/tickets/${p.body.reference}/problem/article`, {
      title: 'Known error: Printers lose their queue',
      body: '## Workaround\n\nRestart the spooler.',
      locale: 'en',
    });
    expect(written.status).toBe(201);
    expect(written.body.article.reference).toMatch(/^KB-/);
    const problem = await h.call(s.admin!, 'GET', `${API}/tickets/${p.body.reference}`);
    expect(problem.body.problem.kbArticle).toMatchObject({ id: written.body.article.id });

    const t = await raise('alice', { title: 'My print job vanished' });
    const resolved = await move('admin', t.body.reference, {
      status: 'resolved',
      resolutionCode: 'solved',
      resolutionNotes: 'Restarted the spooler as the article says.',
      articleId: written.body.article.id,
    });
    expect(resolved.status).toBe(200);
    const links = await h.kernel.db
      .select()
      .from(recordLinks)
      .where(
        or(
          and(eq(recordLinks.aId, t.body.id), eq(recordLinks.bId, written.body.article.id)),
          and(eq(recordLinks.bId, t.body.id), eq(recordLinks.aId, written.body.article.id)),
        ),
      );
    expect(links).toHaveLength(1);
    const [entry] = await statusEntries(t.body.id, 'resolved');
    expect((entry!.data as LooseJson).article).toMatchObject({ id: written.body.article.id });
    const [row] = await h.kernel.db.select().from(tickets).where(eq(tickets.id, t.body.id));
    expect(row!.status).toBe('resolved');
  });
});

describe('configuration items tickets cite', () => {
  it('refuses to delete a CI a ticket cites with IN_USE (409), not a server error', async () => {
    const ci = await h.call(s.admin!, 'POST', '/api/v1/cmdb/cis', {
      name: 'print-srv-02',
      classKey: 'server',
    });
    expect(ci.status).toBe(201);
    const t = await raise('agent', { title: 'Cannot print to the second floor', ciIds: [ci.body.id] });
    expect(t.status).toBe(201);
    const refused = await h.call(s.admin!, 'DELETE', `/api/v1/cmdb/cis/${ci.body.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('IN_USE');
    expect((await h.call(s.admin!, 'GET', `/api/v1/cmdb/cis/${ci.body.id}`)).status).toBe(200);
  });
});
