import {
  aiChunks,
  approvalTasks,
  auditLogs,
  groupMembers,
  groups,
  notifications,
  outboxEvents,
  roleAssignments,
  roles,
  users,
  workflowInstances,
} from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { aiTicketSchema } from '@isbp/module-itsm/contracts';
import { addBusinessMinutes } from '@isbp/module-itsm/business-time';
import { ticketSlas } from '@isbp/module-itsm/schema';
import { type AuthContext, type JobRun, PermissionSet } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'alice' | 'agent' | 'scoped' | 'cm' | 'cab' | 'bob' | 'vpnCategory', string>;
let serviceDesk: string;
let networkTeam: string;
let taipeiCalendar: LooseJson;
const ci = {} as Record<'vpn' | 'mail', string>;

const API = '/api/v1/itsm';
const itsm = () => h.kernel.registry.context('itsm');

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
  const permissions = await h.kernel.rbac.permissionsFor(userId);
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
    permissions,
  );
}

/** Helpdesk AI's agent identity, as the gateway builds it from a manifest's `ai.agent`. */
const aiAgent = () =>
  buildAuthContext(
    { type: 'ai_agent', id: null, name: 'Helpdesk AI' },
    null,
    null,
    new PermissionSet(
      ['itsm.tickets.read', 'itsm.tickets.triage', 'itsm.tickets.work'].map((p) => ({ p, s: 'g' as const })),
    ),
  );

const notificationsOf = (userId: string, type: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

async function runJob(name: string) {
  const job = h.kernel.registry.get('itsm')!.jobs![name]!;
  const run: JobRun = {
    id: 'test',
    name,
    data: {},
    attempt: 1,
    log: async () => undefined,
    updateProgress: async () => undefined,
  };
  return job.handler(run, itsm()) as Promise<LooseJson>;
}

const raise = (who: string, body: Record<string, unknown>) => h.call(s[who]!, 'POST', `${API}/tickets`, body);

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
  const db = h.kernel.db;

  ids.alice = await mkUser('alice', h.ids.salesTpe); // requester in Sales Taipei
  ids.agent = await mkUser('agent');
  ids.scoped = await mkUser('scoped'); // agent for the Sales organisation only
  ids.cm = await mkUser('cm'); // change manager
  ids.cab = await mkUser('cab1');
  ids.bob = await mkUser('bob', h.ids.finance); // requester in Finance

  const [sd] = await db.insert(groups).values({ key: 'service-desk', name: 'Service Desk' }).returning();
  const [net] = await db.insert(groups).values({ key: 'network-team', name: 'Network Team' }).returning();
  const [cabGroup] = await db
    .insert(groups)
    .values({ key: 'cab', name: 'Change Advisory Board' })
    .returning();
  serviceDesk = sd!.id;
  networkTeam = net!.id;
  await db.insert(groupMembers).values([
    { groupId: serviceDesk, userId: ids.agent },
    { groupId: networkTeam, userId: ids.agent },
    { groupId: cabGroup!.id, userId: ids.cab },
  ]);
  await db.insert(roleAssignments).values([
    { roleId: await roleId('itsm-agent'), userId: ids.agent },
    {
      roleId: await roleId('itsm-agent'),
      userId: ids.scoped,
      scopeType: 'department',
      scopeDepartmentId: h.ids.sales,
    },
    { roleId: await roleId('itsm-change-manager'), userId: ids.cm },
  ]);
  await h.kernel.rbac.bump();

  for (const u of ['admin', 'alice', 'agent', 'scoped', 'cm', 'cab1', 'bob', 'outsider'])
    s[u] = await h.login(u);

  const [vpn] = await db
    .insert(cis)
    .values({ name: 'Remote Access (VPN)', classKey: 'business-service', criticality: 'high' })
    .returning();
  const [mail] = await db
    .insert(cis)
    .values({ name: 'mail-relay-01', classKey: 'server', criticality: 'medium' })
    .returning();
  ci.vpn = vpn!.id;
  ci.mail = mail!.id;

  // Configuration through the API: a business calendar, SLA policies and a category.
  const days = Array.from({ length: 7 }, (_, d) =>
    d === 0 || d === 6 ? [] : [{ start: '09:00', end: '18:00' }],
  );
  const cal = await h.call(s.admin!, 'POST', `${API}/calendars`, {
    name: 'Taipei office hours',
    timezone: 'Asia/Taipei',
    hours: { days },
    holidays: [{ date: '2026-10-09', name: 'National Day (observed)' }],
    alwaysOpen: false,
  });
  expect(cal.status).toBe(201);
  taipeiCalendar = cal.body;
  const bad = await h.call(s.admin!, 'POST', `${API}/calendars`, {
    name: 'x',
    timezone: 'Mars/Base',
    hours: { days },
    holidays: [],
    alwaysOpen: false,
  });
  expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  const target = (response: number, resolution: number) => ({
    responseMinutes: response,
    resolutionMinutes: resolution,
  });
  const incidents = await h.call(s.admin!, 'POST', `${API}/sla-policies`, {
    name: 'Incidents',
    description: null,
    ticketTypes: ['incident'],
    condition: null,
    targets: { '1': target(30, 240), '2': target(60, 480), '3': target(240, 1440), '4': target(480, 2400) },
    calendarId: cal.body.id,
    pauseStatuses: ['on_hold'],
    warnAt: 0.75,
    sortOrder: 20,
    active: true,
  });
  expect(incidents.status).toBe(201);
  const requests = await h.call(s.admin!, 'POST', `${API}/sla-policies`, {
    name: 'Service requests',
    ticketTypes: ['service_request'],
    condition: null,
    targets: {
      '1': target(240, 1620),
      '2': target(240, 1620),
      '3': target(240, 1620),
      '4': target(240, 1620),
    },
    calendarId: cal.body.id,
    pauseStatuses: ['on_hold', 'pending_approval'],
    warnAt: 0.8,
    sortOrder: 30,
    active: true,
  });
  expect(requests.status).toBe(201);
  const cat = await h.call(s.admin!, 'POST', `${API}/categories`, {
    key: 'network-vpn',
    name: { en: 'VPN' },
    ticketTypes: ['incident', 'service_request'],
    defaultGroupId: networkTeam,
  });
  expect(cat.status).toBe(201);
  ids.vpnCategory = cat.body.id;
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('requester → agent → requester', () => {
  let ref: string;

  it('a requester raises an incident (requester fields only) and follows it in My requests', async () => {
    const res = await raise('alice', {
      title: 'VPN keeps disconnecting',
      description: 'Every few minutes since the 5.2 update.',
      urgency: 1,
      impact: 1, // agents only — ignored
      categoryId: ids.vpnCategory, // agents only — ignored
      assigneeId: ids.agent, // agents only — ignored
      ciIds: [ci.vpn],
    });
    expect(res.status).toBe(201);
    const t = res.body;
    ref = t.reference;
    expect(ref).toMatch(/^INC-\d{5}$/);
    expect(t).toMatchObject({
      type: 'incident',
      status: 'new',
      impact: 2,
      urgency: 1,
      priority: 2,
      category: null,
      assignee: null,
      channel: 'portal',
      assignmentGroup: { key: 'service-desk' },
      requester: { id: ids.alice },
      department: { id: h.ids.salesTpe },
      slas: [],
      viewer: { role: 'requester', canEdit: false, canComment: true, canWorkNote: false, transitions: [] },
    });
    expect(t.cis.map((c: LooseJson) => c.name)).toEqual(['Remote Access (VPN)']);

    const mine = await h.call(s.alice!, 'GET', '/api/v1/me/requests');
    expect(mine.status).toBe(200);
    expect(mine.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'module',
          reference: ref,
          statusKey: 'itsm.status.new',
          moduleId: 'itsm',
        }),
      ]),
    );
    expect(await notificationsOf(ids.alice, 'itsm.ticket.created')).toHaveLength(1);
  });

  it('computes SLA deadlines in business time on the policy calendar', async () => {
    const t = (await h.call(s.agent!, 'GET', `${API}/tickets/${ref}`)).body;
    expect(t.viewer.role).toBe('agent');
    const response = t.slas.find((x: LooseJson) => x.metric === 'response');
    const resolution = t.slas.find((x: LooseJson) => x.metric === 'resolution');
    expect(response.policy.name).toBe('Incidents');
    const spec = { timezone: 'Asia/Taipei', hours: taipeiCalendar.hours, holidays: taipeiCalendar.holidays };
    expect(response.dueAt).toBe(addBusinessMinutes(new Date(response.startedAt), 60, spec).toISOString());
    expect(resolution.dueAt).toBe(
      addBusinessMinutes(new Date(resolution.startedAt), 480, spec).toISOString(),
    );
    expect(t.sla).toMatchObject({ metric: 'response', status: 'running' });
  });

  it('refuses illegal transitions and resolutions without notes', async () => {
    const illegal = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, { status: 'closed' });
    expect(illegal.status).toBe(409);
    expect(illegal.body.error.code).toBe('INVALID_TRANSITION');
    expect(illegal.body.error.details.allowed).toEqual(['in_progress', 'on_hold', 'resolved', 'cancelled']);
    const bare = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, { status: 'resolved' });
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe('RESOLUTION_REQUIRED');
    const requester = await h.call(s.alice!, 'POST', `${API}/tickets/${ref}/transition`, {
      status: 'in_progress',
    });
    expect(requester.status).toBe(403);
  });

  it('an agent takes it, replies (first response) and keeps work notes internal', async () => {
    const taken = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/assign-to-me`);
    expect(taken.body.assignee.id).toBe(ids.agent);

    const reply = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/comments`, {
      body: 'Which client version do you have?',
    });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ kind: 'comment', public: true, author: { id: ids.agent } });
    const note = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/comments`, {
      body: 'Probably the macOS 5.2 issue.',
      public: false,
    });
    expect(note.body.kind).toBe('work_note');

    const t = (await h.call(s.agent!, 'GET', `${API}/tickets/${ref}`)).body;
    expect(t.firstResponseAt).not.toBeNull();
    expect(t.slas.find((x: LooseJson) => x.metric === 'response').status).toBe('met');
    expect(await notificationsOf(ids.alice, 'itsm.ticket.commented')).toHaveLength(1);

    const theirs = await h.call(s.alice!, 'GET', `${API}/tickets/${ref}/activities`);
    expect(theirs.body.items.some((a: LooseJson) => a.kind === 'work_note')).toBe(false);
    expect(theirs.body.items.some((a: LooseJson) => a.body === 'Which client version do you have?')).toBe(
      true,
    );
    const ours = await h.call(s.agent!, 'GET', `${API}/tickets/${ref}/activities?order=desc`);
    expect(ours.body.items[0]).toMatchObject({ kind: 'work_note', body: 'Probably the macOS 5.2 issue.' });

    const workNote = await h.call(s.alice!, 'POST', `${API}/tickets/${ref}/comments`, {
      body: 'x',
      public: false,
    });
    expect(workNote.status).toBe(403);
    const answer = await h.call(s.alice!, 'POST', `${API}/tickets/${ref}/comments`, {
      body: 'Version 5.2.0',
    });
    expect(answer.status).toBe(201);
    expect(await notificationsOf(ids.agent, 'itsm.ticket.commented')).toHaveLength(1);
    // Never the author.
    expect(await notificationsOf(ids.alice, 'itsm.ticket.commented')).toHaveLength(1);
  });

  it('resolves, notifies the requester, who confirms with a rating', async () => {
    const resolved = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, {
      status: 'resolved',
      resolutionCode: 'workaround',
      resolutionNotes: 'Rolled back to client 5.1.8.',
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ status: 'resolved', resolutionCode: 'workaround' });
    const [n] = await notificationsOf(ids.alice, 'itsm.ticket.resolved');
    expect(n?.body).toContain('Rolled back to client 5.1.8.');

    const view = (await h.call(s.alice!, 'GET', `${API}/tickets/${ref}`)).body;
    expect(view.viewer).toMatchObject({ canReopen: true, canConfirm: true });
    const confirmed = await h.call(s.alice!, 'POST', `${API}/tickets/${ref}/confirm`, {
      rating: 5,
      comment: 'Great help',
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      status: 'closed',
      satisfaction: 5,
      satisfactionComment: 'Great help',
    });
    const t = (await h.call(s.agent!, 'GET', `${API}/tickets/${ref}`)).body;
    expect(t.slas.find((x: LooseJson) => x.metric === 'resolution').status).toBe('met');

    const mine = await h.call(s.alice!, 'GET', '/api/v1/me/requests');
    expect(mine.body.items.find((i: LooseJson) => i.reference === ref)).toMatchObject({
      statusKey: 'itsm.status.closed',
    });
    // Resolved tickets feed the similar-ticket index (through the module's own event).
    const chunks = await eventually(
      () => h.kernel.db.select().from(aiChunks).where(eq(aiChunks.sourceId, t.id)),
      (rows) => rows.length > 0,
    );
    expect(chunks[0]).toMatchObject({ sourceType: 'itsm.ticket' });
  });

  it('requesters reopen resolved tickets with a reason', async () => {
    const t = (await raise('alice', { title: 'Printer offline again', description: '5F printer' })).body;
    await h.call(s.agent!, 'PATCH', `${API}/tickets/${t.reference}`, { assigneeId: ids.agent });
    await h.call(s.agent!, 'POST', `${API}/tickets/${t.reference}/transition`, {
      status: 'resolved',
      resolutionCode: 'solved',
      resolutionNotes: 'Restarted the spooler.',
    });
    const reopened = await h.call(s.alice!, 'POST', `${API}/tickets/${t.reference}/reopen`, {
      reason: 'Still offline after lunch.',
    });
    expect(reopened.body).toMatchObject({ status: 'in_progress', resolutionCode: null });
    expect(await notificationsOf(ids.agent, 'itsm.ticket.reopened')).toHaveLength(1);
    const again = await h.call(s.alice!, 'POST', `${API}/tickets/${t.reference}/reopen`, {
      reason: 'again!',
    });
    expect(again.status).toBe(409);
  });
});

describe('visibility', () => {
  let salesRef: string;
  let financeRef: string;

  beforeAll(async () => {
    salesRef = (await raise('alice', { title: 'Wi-Fi drops in 7A', description: '' })).body.reference;
    financeRef = (await raise('bob', { title: 'ERP export fails', description: '' })).body.reference;
  });

  it('other people cannot see a ticket at all', async () => {
    expect((await h.call(s.outsider!, 'GET', `${API}/tickets/${salesRef}`)).status).toBe(404);
    const list = await h.call(s.outsider!, 'GET', `${API}/tickets`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((t: LooseJson) => t.reference)).not.toContain(salesRef);
    expect((await h.call(s.outsider!, 'GET', `${API}/tickets?view=assigned`)).status).toBe(403);
  });

  it('department-scoped agents see and work their departments only', async () => {
    const sales = await h.call(s.scoped!, 'GET', `${API}/tickets/${salesRef}`);
    expect(sales.status).toBe(200);
    expect(sales.body.viewer).toMatchObject({ role: 'agent', canEdit: true });
    expect((await h.call(s.scoped!, 'GET', `${API}/tickets/${financeRef}`)).status).toBe(404);
    const all = await h.call(s.scoped!, 'GET', `${API}/tickets?view=all&pageSize=200`);
    const refs = all.body.items.map((t: LooseJson) => t.reference);
    expect(refs).toContain(salesRef);
    expect(refs).not.toContain(financeRef);
    expect(all.body.items.every((t: LooseJson) => t.requester?.id === ids.alice)).toBe(true);
    expect((await h.call(s.scoped!, 'PATCH', `${API}/tickets/${financeRef}`, { urgency: 1 })).status).toBe(
      404,
    );
  });

  it('global agents filter queues', async () => {
    const queues = await h.call(s.agent!, 'GET', `${API}/queues`);
    expect(queues.status).toBe(200);
    expect(queues.body.groups).toBeGreaterThanOrEqual(2);
    // `open` = every open ticket within the viewer's reach.
    const openList = await h.call(s.agent!, 'GET', `${API}/tickets?view=all&status=open&pageSize=1`);
    expect(queues.body.open).toBe(openList.body.total);
    const scopedQueues = await h.call(s.scoped!, 'GET', `${API}/queues`);
    const scopedOpen = await h.call(s.scoped!, 'GET', `${API}/tickets?view=all&status=open&pageSize=1`);
    expect(scopedQueues.body.open).toBe(scopedOpen.body.total);
    expect(scopedQueues.body.open).toBeLessThan(queues.body.open);
    const requesterQueues = await h.call(s.outsider!, 'GET', `${API}/queues`);
    expect(requesterQueues.body).toMatchObject({ open: 0, mine: 0 });
    const unassigned = await h.call(s.agent!, 'GET', `${API}/tickets?view=unassigned&status=open`);
    expect(unassigned.body.items.map((t: LooseJson) => t.reference)).toEqual(
      expect.arrayContaining([salesRef, financeRef]),
    );
    const byRef = await h.call(s.agent!, 'GET', `${API}/tickets?q=${financeRef.toLowerCase()}`);
    expect(byRef.body.items.map((t: LooseJson) => t.reference)).toEqual([financeRef]);
    const search = await h.kernel.search('ERP export', await authOf(h.ids.outsider));
    expect(search.filter((x) => x.moduleId === 'itsm')).toHaveLength(0);
    const found = await h.kernel.search(financeRef, await authOf(ids.bob));
    expect(found.find((x) => x.moduleId === 'itsm')?.href).toBe(`/itsm/tickets/${financeRef}`);
  });
});

describe('SLA monitor', () => {
  it('warns once, then breaches overdue timers and notifies the assignee', async () => {
    const t = (
      await raise('agent', {
        title: 'Monitor test',
        description: '',
        requesterId: ids.alice,
        assigneeId: ids.agent,
        impact: 3,
        urgency: 3,
      })
    ).body;
    expect(t.viewer.role).toBe('agent');
    const db = h.kernel.db;
    const soon = new Date(Date.now() + 30 * 60_000);
    await db
      .update(ticketSlas)
      .set({ warnAt: new Date(Date.now() - 60_000), dueAt: soon })
      .where(and(eq(ticketSlas.ticketId, t.id), eq(ticketSlas.metric, 'resolution')));
    expect((await runJob('sla-monitor')).warned).toBeGreaterThanOrEqual(1);
    expect((await runJob('sla-monitor')).warned).toBe(0);
    expect(await notificationsOf(ids.agent, 'itsm.sla.warning')).toHaveLength(1);

    await db
      .update(ticketSlas)
      .set({ dueAt: new Date(Date.now() - 60_000) })
      .where(eq(ticketSlas.ticketId, t.id));
    const first = await runJob('sla-monitor');
    expect(first.breached).toBe(2);
    expect((await runJob('sla-monitor')).breached).toBe(0);
    const [n] = await notificationsOf(ids.agent, 'itsm.sla.breached');
    expect(n?.title).toContain(t.reference);
    const after = (await h.call(s.agent!, 'GET', `${API}/tickets/${t.reference}`)).body;
    expect(after.slas.every((x: LooseJson) => x.status === 'breached')).toBe(true);
    expect(after.sla).toMatchObject({ status: 'breached' });
    const timeline = await h.call(s.agent!, 'GET', `${API}/tickets/${t.reference}/activities`);
    expect(timeline.body.items.filter((a: LooseJson) => a.kind === 'sla')).toHaveLength(2);
    const breached = await h.call(s.agent!, 'GET', `${API}/tickets?sla=breached`);
    expect(breached.body.items.map((x: LooseJson) => x.reference)).toContain(t.reference);
  });

  it('pausing stops the clock and resuming extends the deadline', async () => {
    const t = (await raise('agent', { title: 'Pause test', description: '', requesterId: ids.alice })).body;
    const before = t.slas.find((x: LooseJson) => x.metric === 'resolution');
    await h.call(s.agent!, 'POST', `${API}/tickets/${t.reference}/transition`, { status: 'on_hold' });
    let paused = (await h.call(s.agent!, 'GET', `${API}/tickets/${t.reference}`)).body;
    expect(paused.slas.find((x: LooseJson) => x.metric === 'resolution').status).toBe('paused');
    // Pretend it sat on hold for two working days.
    await h.kernel.db
      .update(ticketSlas)
      .set({ pausedAt: new Date(Date.now() - 7 * 86_400_000) })
      .where(and(eq(ticketSlas.ticketId, t.id), eq(ticketSlas.metric, 'resolution')));
    await h.call(s.agent!, 'POST', `${API}/tickets/${t.reference}/transition`, { status: 'in_progress' });
    paused = (await h.call(s.agent!, 'GET', `${API}/tickets/${t.reference}`)).body;
    const after = paused.slas.find((x: LooseJson) => x.metric === 'resolution');
    expect(after.status).toBe('running');
    expect(new Date(after.dueAt).getTime()).toBeGreaterThan(
      new Date(before.dueAt).getTime() + 2 * 86_400_000,
    );
  });
});

describe('change authorization (CAB)', () => {
  it('needs a window, then the change manager approves and the change is scheduled', async () => {
    const created = await raise('agent', {
      type: 'change',
      title: 'Renew TLS certificate on mail-relay-01',
      description: 'Certificate expires soon.',
      ciIds: [ci.mail],
      change: { changeType: 'normal', risk: 'low', reason: 'Expiry' },
    });
    expect(created.status).toBe(201);
    const ref = created.body.reference as string;
    expect(ref).toMatch(/^CHG-/);
    expect(created.body).toMatchObject({ status: 'draft', change: { changeType: 'normal', risk: 'low' } });
    await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, { status: 'assessment' });
    const noWindow = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, {
      status: 'authorization',
    });
    expect(noWindow.status).toBe(400);
    expect(noWindow.body.error.code).toBe('VALIDATION_FAILED');

    expect((await h.call(s.agent!, 'PATCH', `${API}/tickets/${ref}/change`, { risk: 'high' })).status).toBe(
      403,
    );
    const start = new Date(Date.now() + 3 * 86_400_000);
    const planned = await h.call(s.cm!, 'PATCH', `${API}/tickets/${ref}/change`, {
      plannedStart: start.toISOString(),
      plannedEnd: new Date(start.getTime() + 3_600_000).toISOString(),
      implementationPlan: 'Swap the certificate',
    });
    expect(planned.status).toBe(200);

    const submitted = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, {
      status: 'authorization',
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('authorization');
    const instanceId = submitted.body.change.approvalInstanceId as string;
    expect(instanceId).toBeTruthy();
    expect(submitted.body.viewer.transitions).toEqual(['cancelled']);

    const [task] = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));
    expect(task?.assigneeId).toBe(ids.cm);
    const decided = await h.call(s.cm!, 'POST', `/api/v1/approvals/${task!.id}/approve`, { comment: 'OK' });
    expect(decided.status).toBe(200);
    const scheduled = await eventually(
      () => h.call(s.agent!, 'GET', `${API}/tickets/${ref}`),
      (r) => r.body.status === 'scheduled',
    );
    expect(scheduled.body.status).toBe('scheduled');
    expect(await notificationsOf(ids.agent, 'itsm.change.approved')).toHaveLength(1);

    const calendar = await h.call(
      s.agent!,
      'GET',
      `${API}/changes/calendar?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 7 * 86_400_000).toISOString())}`,
    );
    expect(calendar.body.items.map((c: LooseJson) => c.reference)).toContain(ref);
  });

  it('standard changes are pre-approved and flagged when they overlap on a CI', async () => {
    const start = new Date(Date.now() + 3 * 86_400_000 + 1_800_000);
    const created = await raise('agent', {
      type: 'change',
      title: 'Restart the mail relay',
      description: '',
      ciIds: [ci.mail],
      change: {
        changeType: 'standard',
        risk: 'low',
        plannedStart: start.toISOString(),
        plannedEnd: new Date(start.getTime() + 3_600_000).toISOString(),
      },
    });
    const ref = created.body.reference as string;
    await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, { status: 'assessment' });
    const done = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, {
      status: 'authorization',
    });
    expect(done.body.status).toBe('scheduled');
    expect(done.body.change.conflicts.map((c: LooseJson) => c.title)).toEqual([
      'Renew TLS certificate on mail-relay-01',
    ]);
    const conflicts = await h.call(
      s.agent!,
      'GET',
      `${API}/changes/conflicts?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(new Date(start.getTime() + 3_600_000).toISOString())}&ciIds=${ci.mail}&exclude=${done.body.id}`,
    );
    expect(conflicts.body.items).toHaveLength(1);
    expect(conflicts.body.items[0].sharedCis).toEqual([{ id: ci.mail, name: 'mail-relay-01' }]);
  });

  it('routes on the ticket custom fields of the change (attributes.<key>)', async () => {
    const admin = s.admin!;
    const field = await h.call(admin, 'POST', '/api/v1/custom-fields', {
      entityType: 'itsm.ticket',
      field: { key: 'outageMinutes', type: 'number', label: { en: 'Expected outage (minutes)' } },
    });
    expect(field.status).toBe(201);
    const previous = (await h.call(admin, 'GET', '/api/v1/workflows?triggerKey=itsm.change')).body.items.find(
      (w: LooseJson) => w.isDefault,
    );
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Outage-aware CAB',
      triggerKey: 'itsm.change',
    });
    expect(wf.status).toBe(201);
    await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: 'outage-board',
            type: 'approval',
            name: { en: 'Outage board' },
            when: { fact: 'attributes.outageMinutes', op: 'gt', value: 30 },
            approvers: [{ type: 'user', userId: ids.cab }],
            mode: 'any',
          },
          {
            id: 'manager',
            type: 'approval',
            name: { en: 'Change manager' },
            approvers: [{ type: 'user', userId: ids.cm }],
            mode: 'any',
          },
        ],
      },
    });
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/default`)).body.isDefault).toBe(
      true,
    );

    /** Raises a normal change with these custom-field values and submits it for authorization. */
    const submit = async (title: string, attributes: Record<string, unknown>) => {
      const created = await raise('agent', {
        type: 'change',
        title,
        description: '',
        attributes,
        change: { changeType: 'normal', risk: 'low', reason: 'Maintenance' },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const ref = created.body.reference as string;
      await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, { status: 'assessment' });
      const start = new Date(Date.now() + 10 * 86_400_000);
      await h.call(s.cm!, 'PATCH', `${API}/tickets/${ref}/change`, {
        plannedStart: start.toISOString(),
        plannedEnd: new Date(start.getTime() + 3_600_000).toISOString(),
      });
      const submitted = await h.call(s.agent!, 'POST', `${API}/tickets/${ref}/transition`, {
        status: 'authorization',
      });
      expect(submitted.body.status).toBe('authorization');
      const instanceId = submitted.body.change.approvalInstanceId as string;
      const [task] = await h.kernel.db
        .select()
        .from(approvalTasks)
        .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));
      const [inst] = await h.kernel.db
        .select({ facts: workflowInstances.facts })
        .from(workflowInstances)
        .where(eq(workflowInstances.id, instanceId));
      return { assignee: task?.assigneeId, facts: inst!.facts as LooseJson };
    };

    try {
      const long = await submit('Replace the core switch', { outageMinutes: 90 });
      expect(long.assignee).toBe(ids.cab);
      expect(long.facts).toMatchObject({
        attributes: { outageMinutes: 90 },
        records: {},
        change: { type: 'normal' },
      });
      const short = await submit('Patch the core switch', { outageMinutes: 5 });
      expect(short.assignee).toBe(ids.cm);
      expect(short.facts.attributes).toEqual({ outageMinutes: 5 });
    } finally {
      await h.call(admin, 'POST', `/api/v1/workflows/${previous.id}/default`);
      await h.call(admin, 'POST', `/api/v1/custom-fields/${field.body.id}/archive`);
    }
  });
});

describe('catalog fulfilment', () => {
  it('opens exactly one service request per submission and reports progress on it', async () => {
    const form = await h.call(s.admin!, 'POST', '/api/v1/forms', {
      key: 'monitor-request',
      name: { en: 'Request a monitor' },
      icon: 'monitor',
    });
    expect(form.status).toBe(201);
    await h.call(s.admin!, 'PATCH', `/api/v1/forms/${form.body.id}`, {
      draft: {
        elements: [
          {
            id: 'a',
            key: 'size',
            type: 'select',
            label: { en: 'Size' },
            required: true,
            options: [
              { value: '24', label: { en: '24 inch' } },
              { value: '27', label: { en: '27 inch' } },
            ],
          },
          { id: 'b', key: 'manager', type: 'user', label: { en: 'Manager' } },
          { id: 'c', key: 'urgent', type: 'boolean', label: { en: 'Urgent' } },
        ],
      },
    });
    expect((await h.call(s.admin!, 'POST', `/api/v1/forms/${form.body.id}/publish`)).status).toBe(200);
    const mapped = await h.call(s.admin!, 'PUT', `${API}/catalog/monitor-request`, {
      groupId: serviceDesk,
      priority: 2,
      fulfilOn: 'approved',
    });
    expect(mapped.status).toBe(200);
    expect(mapped.body).toMatchObject({
      hasApproval: false,
      fulfilment: { priority: 2, fulfilOn: 'approved' },
    });

    const sub = await h.call(s.alice!, 'POST', '/api/v1/forms/by-key/monitor-request/submissions', {
      data: { size: '27', manager: ids.agent, urgent: true },
    });
    expect(sub.status).toBe(201);
    const submission = await eventually(
      () => h.call(s.alice!, 'GET', `/api/v1/form-submissions/${sub.body.id}`),
      (r) => Boolean(r.body.fulfilment),
    );
    const reference = submission.body.fulfilment.reference as string;
    expect(submission.body.fulfilment).toMatchObject({
      moduleId: 'itsm',
      state: 'open',
      statusKey: 'itsm.status.new',
    });
    expect(reference).toMatch(/^SR-/);

    const sr = (await h.call(s.alice!, 'GET', `${API}/tickets/${reference}`)).body;
    expect(sr).toMatchObject({
      type: 'service_request',
      channel: 'form',
      priority: 2,
      title: 'Request a monitor — Alice',
      requester: { id: ids.alice },
      assignmentGroup: { id: serviceDesk },
      source: { type: 'form-submission', id: sub.body.id, formKey: 'monitor-request' },
    });
    expect(sr.answers).toEqual([
      { key: 'size', label: { en: 'Size' }, value: '27 inch' },
      { key: 'manager', label: { en: 'Manager' }, value: 'Agent' },
      { key: 'urgent', label: { en: 'Urgent' }, value: 'Yes' },
    ]);

    // At-least-once delivery: handling the event again changes nothing.
    const handler = h.kernel.registry.get('itsm')!.events!['core.form-submission.created']!;
    await handler(
      {
        id: 'redelivery',
        name: 'core.form-submission.created',
        moduleId: 'core',
        payload: { submissionId: sub.body.id, number: sub.body.number, formId: form.body.id },
        actor: null,
        occurredAt: new Date().toISOString(),
      },
      itsm(),
    );
    const list = await h.call(s.agent!, 'GET', `${API}/tickets?type=service_request&pageSize=200`);
    expect(list.body.items.filter((t: LooseJson) => t.title === 'Request a monitor — Alice')).toHaveLength(1);

    // Progress flows back to the submission.
    await h.call(s.agent!, 'POST', `${API}/tickets/${reference}/transition`, {
      status: 'fulfilled',
      resolutionCode: 'solved',
      resolutionNotes: 'Delivered.',
    });
    const after = await h.call(s.alice!, 'GET', `/api/v1/form-submissions/${sub.body.id}`);
    expect(after.body.fulfilment).toMatchObject({ state: 'done', statusKey: 'itsm.status.fulfilled' });
    // Fulfilled requests report on the submission, not as a second "My requests" row.
    const mine = await h.call(s.alice!, 'GET', '/api/v1/me/requests');
    expect(mine.body.items.filter((i: LooseJson) => i.reference === reference)).toHaveLength(0);
  });
});

describe('AI tools', () => {
  const tools = () => itsm().ai.tools;

  it('triage fills only empty fields with onlyEmpty, and credits the AI agent', async () => {
    const t = (
      await raise('alice', { title: 'VPN drops at home', description: 'Every 5 minutes', urgency: 2 })
    ).body;
    await h.call(s.agent!, 'PATCH', `${API}/tickets/${t.reference}`, { impact: 3 });
    const first = await tools().invoke<LooseJson>(
      'itsm.triage_ticket',
      {
        ticketId: t.id,
        categoryId: ids.vpnCategory,
        impact: 1,
        urgency: 1,
        confidence: 0.82,
        rationale: 'Matches 12 resolved VPN tickets',
      },
      { auth: aiAgent() },
    );
    expect(first.applied.sort()).toEqual(['category']);
    expect(first.skipped.sort()).toEqual(['impact', 'urgency']);
    expect(first.ticket).toMatchObject({ category: { key: 'network-vpn' }, impact: 3, urgency: 2 });
    expect(first.ticket.assignmentGroup.key).toBe('network-team'); // the category's default group
    expect(() => aiTicketSchema.parse(first.ticket)).not.toThrow();

    const second = await tools().invoke<LooseJson>(
      'itsm.triage_ticket',
      { ticketId: t.id, categoryId: ids.vpnCategory, assignmentGroupId: serviceDesk },
      { auth: aiAgent() },
    );
    expect(second.applied).toEqual([]);
    expect(second.skipped.sort()).toEqual(['category', 'group']);

    const forced = await tools().invoke<LooseJson>(
      'itsm.triage_ticket',
      { ticketId: t.id, urgency: 1, onlyEmpty: false },
      { auth: aiAgent() },
    );
    expect(forced.ticket).toMatchObject({ urgency: 1, priority: 3 });

    const timeline = await h.call(s.agent!, 'GET', `${API}/tickets/${t.reference}/activities`);
    const triage = timeline.body.items.find((a: LooseJson) => a.kind === 'triage');
    expect(triage).toMatchObject({
      public: false,
      author: { id: null, displayName: 'Helpdesk AI', ai: true },
      data: { confidence: 0.82, rationale: 'Matches 12 resolved VPN tickets', fields: ['category'] },
    });
    const detail = (await h.call(s.alice!, 'GET', `${API}/tickets/${t.reference}/activities`)).body;
    expect(detail.items.some((a: LooseJson) => a.kind === 'triage')).toBe(false);
  });

  it('resolve_ticket needs confirmation, get/find/my tickets respect scope', async () => {
    const t = (
      await raise('alice', { title: 'Outlook stuck on updating inbox', description: 'Since Monday' })
    ).body;
    await expect(
      tools().invoke(
        'itsm.resolve_ticket',
        { ticketId: t.id, resolutionCode: 'solved', resolutionNotes: 'Rebuilt the profile.' },
        { auth: aiAgent() },
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFIRMATION_REQUIRED' });
    const resolved = await tools().invoke<LooseJson>(
      'itsm.resolve_ticket',
      { ticketId: t.id, resolutionCode: 'solved', resolutionNotes: 'Rebuilt the profile.' },
      { auth: await authOf(ids.agent), confirmed: true },
    );
    expect(resolved).toMatchObject({ status: 'resolved', resolutionNotes: 'Rebuilt the profile.' });

    const alice = await authOf(ids.alice);
    // get_ticket is an agent tool (itsm.tickets.read); requesters use my_tickets.
    await expect(
      tools().invoke('itsm.get_ticket', { reference: t.reference }, { auth: alice }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    const got = await tools().invoke<LooseJson>(
      'itsm.get_ticket',
      { id: t.id },
      { auth: await authOf(ids.agent) },
    );
    expect(() => aiTicketSchema.parse(got)).not.toThrow();
    expect(got.activities.map((a: LooseJson) => a.kind)).toContain('status');
    // Department scope applies inside the tool: Sales agents can't read a Finance ticket.
    const bobs = (await raise('bob', { title: 'Finance share slow', description: '' })).body;
    await expect(
      tools().invoke('itsm.get_ticket', { reference: bobs.reference }, { auth: await authOf(ids.scoped) }),
    ).rejects.toMatchObject({ statusCode: 404 });
    const mine = await tools().invoke<LooseJson>('itsm.my_tickets', { status: 'all' }, { auth: alice });
    expect(mine.items.map((x: LooseJson) => x.reference)).toContain(t.reference);
    const found = await tools().invoke<LooseJson>(
      'itsm.find_tickets',
      { query: 'outlook inbox', status: 'all' },
      { auth: aiAgent() },
    );
    expect(found.items.map((x: LooseJson) => x.reference)).toContain(t.reference);
  });

  it('creates tickets for the caller and keeps work notes for agents', async () => {
    const alice = await authOf(ids.alice);
    const created = await tools().invoke<LooseJson>(
      'itsm.create_ticket',
      { title: 'Teams camera not detected', description: 'Camera works in other apps.', channel: 'chat' },
      { auth: alice },
    );
    expect(created).toMatchObject({ type: 'incident', status: 'new', requester: { id: ids.alice } });
    const row = (await h.call(s.agent!, 'GET', `${API}/tickets/${created.reference}`)).body;
    expect(row.channel).toBe('chat');
    await expect(
      tools().invoke(
        'itsm.add_comment',
        { ticketId: created.id, body: 'internal', public: false },
        { auth: alice },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const comment = await tools().invoke<LooseJson>(
      'itsm.add_comment',
      { ticketId: created.id, body: 'It started after the update.' },
      { auth: alice },
    );
    expect(comment).toMatchObject({ reference: created.reference, public: true });
    const options = await tools().invoke<LooseJson>('itsm.get_triage_options', {}, { auth: aiAgent() });
    expect(options.categories.map((c: LooseJson) => c.key)).toContain('network-vpn');
    expect(options.groups.map((g: LooseJson) => g.key)).toEqual(
      expect.arrayContaining(['service-desk', 'network-team']),
    );
  });
});

describe('configuration and reports', () => {
  it('lists groups, agents, categories and an overview report', async () => {
    expect((await h.call(s.alice!, 'GET', `${API}/groups`)).status).toBe(403);
    const groupsRes = await h.call(s.agent!, 'GET', `${API}/groups`);
    expect(groupsRes.body.items.find((g: LooseJson) => g.key === 'service-desk')).toMatchObject({
      memberCount: 1,
    });
    const agents = await h.call(s.agent!, 'GET', `${API}/groups/${serviceDesk}/agents`);
    expect(agents.body.items.map((p: LooseJson) => p.id)).toEqual([ids.agent]);
    const cats = await h.call(s.alice!, 'GET', `${API}/categories`);
    expect(cats.body.items[0]).toMatchObject({
      key: 'network-vpn',
      path: 'VPN',
      defaultGroup: { key: 'network-team' },
    });
    expect((await h.call(s.alice!, 'GET', `${API}/calendars`)).status).toBe(403);
    expect((await h.call(s.admin!, 'DELETE', `${API}/calendars/${taipeiCalendar.id}`)).body.error.code).toBe(
      'IN_USE',
    );
    const report = await h.call(s.agent!, 'GET', `${API}/reports/overview?days=7`);
    expect(report.status).toBe(200);
    expect(report.body.volume).toHaveLength(7);
    expect(report.body.open.total).toBeGreaterThan(0);
    expect(report.body.csat).toMatchObject({ average: 5, responses: 1 });
    expect(report.body.backlogAge.map((b: LooseJson) => b.bucket)).toEqual([
      'lt1d',
      '1to3d',
      '3to7d',
      '7to30d',
      'gt30d',
    ]);
  });

  it('agents can correct the requester; My requests and the department follow the rules', async () => {
    const t = (await raise('alice', { title: 'Logged for the wrong caller', description: '' })).body;
    // Requesters can't change it; inactive people can't become requesters.
    expect(
      (await h.call(s.alice!, 'PATCH', `${API}/tickets/${t.reference}`, { requesterId: ids.bob })).status,
    ).toBe(403);
    const suspended = await mkUser('suspended');
    await h.kernel.db.update(users).set({ status: 'suspended' }).where(eq(users.id, suspended));
    const inactive = await h.call(s.agent!, 'PATCH', `${API}/tickets/${t.reference}`, {
      requesterId: suspended,
    });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.details.fields.requesterId).toBeDefined();

    const slasBefore = (await h.call(s.agent!, 'GET', `${API}/tickets/${t.reference}`)).body.slas;
    expect(slasBefore.length).toBeGreaterThan(0);
    const moved = await h.call(s.agent!, 'PATCH', `${API}/tickets/${t.reference}`, { requesterId: ids.bob });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ requester: { id: ids.bob }, department: { id: h.ids.salesTpe } });
    const timeline = await h.call(s.agent!, 'GET', `${API}/tickets/${t.reference}/activities?order=desc`);
    expect(timeline.body.items[0]).toMatchObject({
      kind: 'field',
      public: false,
      data: { changes: { requesterId: [ids.alice, ids.bob] } },
    });
    // Audited and published like any other update; choosing the same person again is a no-op.
    const audit = await h.kernel.db
      .select({ changes: auditLogs.changes, actorId: auditLogs.actorId })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'itsm.ticket.updated'), eq(auditLogs.entityId, t.id)));
    expect(audit).toEqual([{ changes: { requesterId: [ids.alice, ids.bob] }, actorId: ids.agent }]);
    const events = await h.kernel.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.name, 'itsm.ticket.updated'));
    expect(events.map((e) => e.payload)).toContainEqual(
      expect.objectContaining({ ticketId: t.id, changes: ['requesterId'] }),
    );
    const same = await h.call(s.agent!, 'PATCH', `${API}/tickets/${t.reference}`, { requesterId: ids.bob });
    expect(same.status).toBe(200);
    expect(
      await h.kernel.db
        .select({ seq: auditLogs.seq })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'itsm.ticket.updated'), eq(auditLogs.entityId, t.id))),
    ).toHaveLength(1);
    // The SLA targets don't depend on who reported it.
    expect(moved.body.slas.map((x: LooseJson) => [x.metric, x.dueAt])).toEqual(
      slasBefore.map((x: LooseJson) => [x.metric, x.dueAt]),
    );
    // "My requests" moves to the new requester; the old one no longer sees the ticket.
    const bobs = await h.call(s.bob!, 'GET', '/api/v1/me/requests');
    expect(bobs.body.items.map((i: LooseJson) => i.reference)).toContain(t.reference);
    const alices = await h.call(s.alice!, 'GET', '/api/v1/me/requests');
    expect(alices.body.items.map((i: LooseJson) => i.reference)).not.toContain(t.reference);
    expect((await h.call(s.alice!, 'GET', `${API}/tickets/${t.reference}`)).status).toBe(404);
    expect((await h.call(s.bob!, 'GET', `${API}/tickets/${t.reference}`)).body.viewer.role).toBe('requester');
  });

  it('unassigns the open tickets of people who leave', async () => {
    const leaver = await mkUser('leaver');
    const t = (
      await raise('agent', { title: 'Assigned to a leaver', description: '', requesterId: ids.alice })
    ).body;
    await h.kernel.db.update(users).set({ status: 'active' }).where(eq(users.id, leaver));
    await h.call(s.agent!, 'PATCH', `${API}/tickets/${t.reference}`, { assigneeId: leaver });
    const handler = h.kernel.registry.get('itsm')!.events!['core.user.offboarded']!;
    await handler(
      {
        id: 'e1',
        name: 'core.user.offboarded',
        moduleId: 'core',
        payload: { userId: leaver, email: 'leaver@test.example', reason: null },
        actor: null,
        occurredAt: new Date().toISOString(),
      },
      itsm(),
    );
    const after = (await h.call(s.agent!, 'GET', `${API}/tickets/${t.reference}`)).body;
    expect(after.assignee).toBeNull();
  });
});
