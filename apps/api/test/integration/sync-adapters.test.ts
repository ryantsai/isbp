/**
 * Phase 5 sync adapters of the data modules, exercised through the kernel's `ctx.sync` the way the
 * Integrations Hub calls them: as its agent (holding `*.*.sync`), inside a transaction, with a source.
 *
 * DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_adapt_test REDIS_URL=redis://localhost:6379/14 \
 *   ISBP_TEST_MODULES=cmdb,itsm,itam,knowledge,projects,alm \
 *   npx vitest run --project integration test/integration/sync-adapters.test.ts
 */
import { auditLogs, groups, outboxEvents, roleAssignments, roles, users } from '@isbp/db/schema';
import { changes as itsmChanges, ticketActivities, tickets } from '@isbp/module-itsm/schema';
import { repositories } from '@isbp/module-alm/schema';
import { articles, articleVersions } from '@isbp/module-knowledge/schema';
import {
  members,
  milestones,
  projects,
  projectUpdates,
  taskActivity,
  taskDependencies,
} from '@isbp/module-projects/schema';
import {
  type AuthContext,
  type DomainEvent,
  PermissionSet,
  type SyncService,
  type SyncSource,
  type SyncWriteInput,
} from '@isbp/sdk/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, type LooseJson, PASSWORD } from './harness';

let h: Harness;
const ids = {} as Record<'alice' | 'bob' | 'gone' | 'cm', string>;
let serviceDesk: string;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `ctx.sync` (the same service every module context carries). */
const sync = (): SyncService => h.kernel.registry.context('core').sync;

const agentWith = (permissions: string[]) =>
  buildAuthContext(
    { type: 'ai_agent', id: null, name: 'Integrations Hub' },
    null,
    null,
    new PermissionSet(permissions.map((p) => ({ p, s: 'g' as const }))),
  );
/** The hub's agent identity: `*.*.sync` and nothing else. */
const agent = agentWith(['*.*.sync']);

const source = (remoteRef: string): SyncSource => ({
  connectionId: '0199a000-0000-7000-8000-000000000001',
  connectionName: 'Contoso ServiceDesk Plus',
  connector: 'sdp.server',
  remoteRef,
  remoteUrl: `https://sdp.contoso.example/app/itdesk/WorkOrder.do?woID=${remoteRef.replace('#', '')}`,
});

/** A sync write in its own transaction, as the hub runs one (link and snapshot would join it). */
const write = (entity: string, input: SyncWriteInput, opts: { auth?: AuthContext; ref?: string } = {}) =>
  h.kernel.db.transaction((tx) =>
    sync().write(entity, input, {
      auth: opts.auth ?? agent,
      tx: tx as never,
      source: source(opts.ref ?? '#1234'),
    }),
  );

/** The error a promise rejects with (`{ statusCode, code, details }`). */
async function failure(p: Promise<unknown>): Promise<LooseJson> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to fail');
}

/** Outbox rows of an event about `id` (payload field `idKey`), oldest first. */
const outboxOf = (name: string, idKey: string, id: string) =>
  h.kernel.db
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.name, name), sql`${outboxEvents.payload}->>${idKey} = ${id}`))
    .orderBy(outboxEvents.seq);

/** What the kernel routes to `onSyncChange` for an outbox row: `idFromEvent` resolved per entity. */
function changesOf(row: typeof outboxEvents.$inferSelect) {
  const event: DomainEvent = {
    id: row.eventId,
    name: row.name,
    moduleId: row.moduleId,
    payload: row.payload,
    actor: null,
    occurredAt: row.occurredAt.toISOString(),
  };
  return h.kernel.sync.changesFor(event).map((c) => ({ entity: c.entity, id: c.id, kind: c.kind }));
}

const auditOf = (action: string, entityId: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.seq));

async function mkUser(username: string, status: 'active' | 'offboarded' = 'active') {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: `${username[0]!.toUpperCase()}${username.slice(1)}`,
      passwordHash: await hashPassword(PASSWORD),
      status,
    })
    .returning();
  return u!.id;
}

beforeAll(async () => {
  h = await createHarness();
  ids.alice = await mkUser('alice');
  ids.bob = await mkUser('bob');
  ids.gone = await mkUser('gone', 'offboarded');
  ids.cm = await mkUser('cm');
  const [sd] = await h.kernel.db
    .insert(groups)
    .values({ key: 'service-desk', name: 'Service Desk' })
    .returning();
  serviceDesk = sd!.id;
  // A change manager, so the CAB workflow of a normal change waits for a decision.
  const [cmRole] = await h.kernel.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, 'itsm-change-manager'));
  await h.kernel.db.insert(roleAssignments).values({ roleId: cmRole!.id, userId: ids.cm });
  await h.kernel.rbac.bump();
});

afterAll(async () => {
  await h?.close();
});

describe('sync entities', () => {
  it('lists the adapters of enabled modules, filtered by the caller’s .sync permissions', () => {
    const all = sync().entities();
    expect(all.map((e) => e.entity)).toEqual(expect.arrayContaining(['itsm.ticket', 'itsm.change']));
    const ticket = all.find((e) => e.entity === 'itsm.ticket')!;
    expect(ticket).toMatchObject({
      moduleId: 'itsm',
      permission: 'itsm.tickets.sync',
      comments: true,
      recordType: true,
      container: null,
    });
    expect(sync().entities(agent).length).toBe(all.length);
    expect(
      sync()
        .entities(agentWith(['itsm.tickets.sync']))
        .map((e) => e.entity),
    ).toEqual(['itsm.ticket']);
    expect(sync().entities(agentWith([]))).toEqual([]);
  });
});

/* ───────────────────────────── itsm.ticket ───────────────────────────── */

describe('itsm.ticket', () => {
  let id: string;

  it('describes its fields with the documented keys, types and flags', async () => {
    const fields = await sync().fields('itsm.ticket');
    expect(fields.map((f) => f.key)).toEqual([
      'type',
      'title',
      'description',
      'status',
      'impact',
      'urgency',
      'priority',
      'category',
      'assignmentGroup',
      'assignee',
      'requester',
      'resolutionCode',
      'resolutionNotes',
      'major',
      'ref',
    ]);
    const by = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(by.type).toMatchObject({ type: 'choice', createOnly: true });
    expect(by.type!.choices!.map((c) => c.value)).toEqual(['incident', 'service_request', 'problem']);
    expect(by.title).toMatchObject({ type: 'string', required: true, maxLength: 200 });
    // Not required: the other system may know people ISBP doesn't.
    expect(by.requester).toMatchObject({ type: 'user' });
    expect(by.requester!.required).toBeFalsy();
    expect(by.ref).toMatchObject({ readOnly: true });
    expect(by.status!.choices!.map((c) => c.value)).toContain('known_error');
    expect(by.status!.choices!.map((c) => c.value)).not.toContain('scheduled');
    expect(by.assignmentGroup!.choices).toContainEqual({
      value: serviceDesk,
      label: { en: 'Service Desk', 'zh-TW': 'Service Desk', 'ja-JP': 'Service Desk' },
    });
    expect(by.priority!.choices![0]).toEqual({ value: '1', label: 'itsm.priority.1' });
  });

  it('needs itsm.tickets.sync to write (403)', async () => {
    const err = await failure(
      write(
        'itsm.ticket',
        { values: { title: 'No permission', requester: ids.alice } },
        { auth: agentWith([]) },
      ),
    );
    expect(err.statusCode).toBe(403);
    expect(err.details).toMatchObject({ permission: 'itsm.tickets.sync' });
  });

  it('refuses invalid values before the adapter runs (422)', async () => {
    const bad = await failure(
      write('itsm.ticket', {
        values: { title: 'Bad', requester: ids.alice, status: 'bogus', ref: 'INC-1', colour: 'red' },
      }),
    );
    expect(bad.statusCode).toBe(422);
    expect(bad.code).toBe('VALIDATION_FAILED');
    expect(bad.details.issues).toEqual(
      expect.arrayContaining([
        { path: 'status', message: '"bogus" is not a choice' },
        { path: 'ref', message: 'read-only' },
        { path: 'colour', message: 'unknown field' },
      ]),
    );
    // From someone ISBP doesn't know: no requester (only integrations may do that).
    const { id: anonymous } = await write('itsm.ticket', { values: { title: 'No requester' } });
    expect((await sync().read('itsm.ticket', anonymous))!.values.requester).toBeNull();
    const gone = await failure(
      write('itsm.ticket', { values: { title: 'Gone requester', requester: ids.gone } }),
    );
    expect(gone.statusCode).toBe(422);
    expect(gone.details.issues).toEqual([{ path: 'requester', message: 'unknown or inactive person' }]);
    const short = await failure(write('itsm.ticket', { values: { title: 'ab', requester: ids.alice } }));
    expect(short.statusCode).toBe(422);
    expect(short.details.issues[0].path).toBe('title');
  });

  it('creates an incident with the module’s rules: priority override, channel, history, audit, events', async () => {
    ({ id } = await write(
      'itsm.ticket',
      {
        values: {
          type: 'incident',
          title: 'VPN drops every hour',
          description: 'Since **Monday**.',
          requester: ids.alice,
          urgency: '1',
          priority: '1',
          assignmentGroup: serviceDesk,
          assignee: ids.bob,
        },
      },
      { ref: '#1234' },
    ));
    const record = await sync().read('itsm.ticket', id);
    expect(record).toMatchObject({
      id,
      ref: expect.stringMatching(/^INC-\d{5}$/),
      title: 'VPN drops every hour',
      href: expect.stringMatching(/^\/itsm\/tickets\/INC-\d{5}$/),
      values: {
        type: 'incident',
        status: 'new',
        priority: '1',
        urgency: '1',
        impact: '2',
        requester: ids.alice,
        assignee: ids.bob,
        assignmentGroup: serviceDesk,
        major: false,
        resolutionCode: null,
      },
    });
    const [row] = await h.kernel.db.select().from(tickets).where(eq(tickets.id, id));
    expect(row).toMatchObject({ channel: 'integration', priorityOverridden: true, createdBy: null });
    const [created] = await h.kernel.db
      .select()
      .from(ticketActivities)
      .where(and(eq(ticketActivities.ticketId, id), eq(ticketActivities.kind, 'system')));
    expect(created!.authorName).toBe('Integrations Hub');
    expect(created!.data).toMatchObject({
      event: 'created',
      channel: 'integration',
      via: { connection: 'Contoso ServiceDesk Plus', ref: '#1234', connector: 'sdp.server' },
    });
    const [audit] = await auditOf('itsm.ticket.created', id);
    expect(audit).toMatchObject({ actorType: 'ai_agent', actorName: 'Integrations Hub' });
    expect(audit!.metadata).toMatchObject({
      source: { connectionName: 'Contoso ServiceDesk Plus', remoteRef: '#1234' },
    });
    const [event] = await outboxOf('itsm.ticket.created', 'ticketId', id);
    expect(changesOf(event!)).toEqual([{ entity: 'itsm.ticket', id, kind: 'record' }]);
  });

  it('updates a subset and moves the status along the state machine', async () => {
    await write('itsm.ticket', {
      id,
      values: { title: 'VPN drops every hour (Taipei)', status: 'in_progress' },
    });
    const record = await sync().read('itsm.ticket', id);
    expect(record!.values).toMatchObject({
      title: 'VPN drops every hour (Taipei)',
      status: 'in_progress',
      priority: '1',
    });
    const [status] = await outboxOf('itsm.ticket.status_changed', 'ticketId', id);
    expect(status!.payload).toMatchObject({ from: 'new', to: 'in_progress' });
    expect(changesOf(status!)).toEqual([{ entity: 'itsm.ticket', id, kind: 'record' }]);
    const history = await h.kernel.db
      .select()
      .from(ticketActivities)
      .where(and(eq(ticketActivities.ticketId, id), eq(ticketActivities.kind, 'status')));
    expect(history.at(-1)!.data).toMatchObject({ from: 'new', to: 'in_progress', via: { ref: '#1234' } });
  });

  it('resolves with the other system’s word when it has no resolution code; people still give one', async () => {
    // Cancelled in the other system: its word is the resolution too.
    const { id: cancelled } = await write('itsm.ticket', {
      values: { title: 'Duplicate request', requester: ids.alice },
    });
    await write('itsm.ticket', { id: cancelled, values: { status: 'cancelled' } });
    expect((await sync().read('itsm.ticket', cancelled))!.values).toMatchObject({
      status: 'cancelled',
      resolutionCode: 'cancelled_by_requester',
      resolutionNotes: 'Cancelled in Contoso ServiceDesk Plus #1234',
    });

    // Closed in ServiceDesk Plus, which has no resolution codes: resolved (solved) then closed.
    await write('itsm.ticket', { id, values: { status: 'closed' } });
    expect((await sync().read('itsm.ticket', id))!.values).toMatchObject({
      status: 'closed',
      resolutionCode: 'solved',
      resolutionNotes: 'Resolved in Contoso ServiceDesk Plus #1234',
    });

    // Notes the other system wrote win; the default text speaks the requester's language.
    await h.kernel.db.update(users).set({ locale: 'zh-TW' }).where(eq(users.id, ids.bob));
    const { id: zh } = await write('itsm.ticket', { values: { title: '印表機卡紙', requester: ids.bob } });
    await write('itsm.ticket', { id: zh, values: { status: 'resolved' } }, { ref: '#77' });
    expect((await sync().read('itsm.ticket', zh))!.values).toMatchObject({
      resolutionCode: 'solved',
      resolutionNotes: '已於 Contoso ServiceDesk Plus #77 解決',
    });
    const { id: noted } = await write('itsm.ticket', {
      values: { title: 'Toner empty', requester: ids.alice },
    });
    await write('itsm.ticket', {
      id: noted,
      values: { status: 'resolved', resolutionNotes: 'Replaced toner.' },
    });
    expect((await sync().read('itsm.ticket', noted))!.values).toMatchObject({
      resolutionCode: 'solved',
      resolutionNotes: 'Replaced toner.',
    });

    // People resolving in ISBP (UI and API) still give both.
    const { id: manual } = await write('itsm.ticket', {
      values: { title: 'Mouse broken', requester: ids.alice },
    });
    const ui = await h.call(await h.login('admin'), 'POST', `/api/v1/itsm/tickets/${manual}/transition`, {
      status: 'resolved',
    });
    expect(ui.status).toBe(400);
    expect(ui.body.error.code).toBe('RESOLUTION_REQUIRED');

    const back = await failure(write('itsm.ticket', { id, values: { status: 'in_progress' } }));
    expect(back.statusCode).toBe(409);
    expect(back.code).toBe('INVALID_TRANSITION');
    expect(back.details).toMatchObject({ from: 'closed', to: 'in_progress' });
    const typed = await failure(write('itsm.ticket', { id, values: { type: 'problem' } }));
    expect(typed.details.issues).toEqual([{ path: 'type', message: 'can only be set when creating' }]);
  });

  it('leaves nothing behind when a write is refused half-way', async () => {
    const before = await h.kernel.db.$count(tickets);
    const err = await failure(
      // An incident can't become a known error (a problem's status): refused after the ticket was created.
      write('itsm.ticket', { values: { title: 'Half-way', requester: ids.alice, status: 'known_error' } }),
    );
    expect(err.statusCode).toBe(409);
    expect(await h.kernel.db.$count(tickets)).toBe(before);
  });

  it('lists in update order, page by page', async () => {
    for (const title of ['Printer jam', 'Monitor flickers', 'Keyboard missing keys'])
      await write('itsm.ticket', { values: { title, requester: ids.alice } });
    const first = await sync().list('itsm.ticket', { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.next).toEqual(expect.any(String));
    const rest = await sync().list('itsm.ticket', { limit: 50, after: first.next });
    const all = [...first.items, ...rest.items];
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(all.map((r) => r.updatedAt)).toEqual([...all.map((r) => r.updatedAt)].sort());
    expect(all.map((r) => r.title)).toEqual(
      expect.arrayContaining(['Printer jam', 'VPN drops every hour (Taipei)']),
    );
    expect(rest.next).toBeNull();
    const since = await sync().list('itsm.ticket', { limit: 50, since: all.at(-1)!.updatedAt });
    expect(since.items.map((r) => r.id)).toContain(all.at(-1)!.id);
    expect(since.items.every((r) => r.values.type !== 'change')).toBe(true);
  });

  it('syncs public comments and internal notes with the remote author', async () => {
    const { id: ticketId } = await write('itsm.ticket', {
      values: { title: 'Laptop battery swells', requester: ids.alice },
    });
    const reply = await h.kernel.db.transaction((tx) =>
      sync().comments.add(
        'itsm.ticket',
        ticketId,
        {
          body: 'We ordered a replacement battery.',
          authorName: 'Jane Remote',
          authorEmail: 'jane@contoso.example',
          createdAt: new Date(Date.now() - HOUR).toISOString(),
        },
        { auth: agent, tx: tx as never, source: source('#1300') },
      ),
    );
    await h.kernel.db.transaction((tx) =>
      sync().comments.add(
        'itsm.ticket',
        ticketId,
        { body: 'Vendor case 99-123.', authorName: 'Jane Remote', internal: true },
        { auth: agent, tx: tx as never, source: source('#1300') },
      ),
    );
    const list = await sync().comments.list('itsm.ticket', ticketId);
    expect(list).toEqual([
      expect.objectContaining({
        id: reply.id,
        body: 'We ordered a replacement battery.',
        authorName: 'Jane Remote',
        authorEmail: 'jane@contoso.example',
        internal: false,
      }),
      expect.objectContaining({ body: 'Vendor case 99-123.', internal: true }),
    ]);
    expect(Date.parse(list[0]!.createdAt)).toBeLessThan(Date.now() - HOUR / 2);
    const events = await outboxOf('itsm.ticket.commented', 'ticketId', ticketId);
    expect(events.map((e) => (e.payload as LooseJson).public)).toEqual([true, false]);
    expect(changesOf(events[0]!)).toEqual([{ entity: 'itsm.ticket', id: ticketId, kind: 'comment' }]);
    const denied = await failure(
      h.kernel.db.transaction((tx) =>
        sync().comments.add(
          'itsm.ticket',
          ticketId,
          { body: 'x', authorName: 'Jane' },
          { auth: agentWith([]), tx: tx as never, source: source('#1300') },
        ),
      ),
    );
    expect(denied.statusCode).toBe(403);
  });
});

/* ───────────────────────────── itsm.change ───────────────────────────── */

describe('itsm.change', () => {
  const later = (days: number) => new Date(Date.now() + days * DAY).toISOString();

  it('describes the change plan fields', async () => {
    const fields = await sync().fields('itsm.change');
    expect(fields.map((f) => f.key)).toEqual([
      'title',
      'description',
      'status',
      'changeType',
      'risk',
      'reason',
      'plannedStart',
      'plannedEnd',
      'implementationPlan',
      'backoutPlan',
      'testPlan',
      'assignmentGroup',
      'assignee',
      'ref',
    ]);
    expect(fields.find((f) => f.key === 'plannedStart')).toMatchObject({ type: 'datetime' });
  });

  it('creates a change in its first status, and never past CAB authorization', async () => {
    const { id } = await write('itsm.change', {
      values: {
        title: 'Upgrade the core switch firmware',
        changeType: 'normal',
        risk: 'high',
        plannedStart: later(7),
        plannedEnd: later(7.1),
        implementationPlan: 'Follow the vendor runbook.',
      },
    });
    const record = await sync().read('itsm.change', id);
    expect(record).toMatchObject({
      ref: expect.stringMatching(/^CHG-/),
      values: { status: 'draft', risk: 'high' },
    });
    expect(await sync().read('itsm.ticket', id)).toBeNull();

    const skip = await failure(write('itsm.change', { id, values: { status: 'scheduled' } }));
    expect(skip.statusCode).toBe(409);
    expect(skip.details).toMatchObject({ from: 'draft', to: 'scheduled', reason: 'approval_required' });

    // Submitting for approval is a move the change's state machine allows: the CAB workflow starts.
    await write('itsm.change', { id, values: { status: 'authorization' } });
    expect((await sync().read('itsm.change', id))!.values.status).toBe('authorization');
    const [c] = await h.kernel.db.select().from(itsmChanges).where(eq(itsmChanges.ticketId, id));
    expect(c!.approvalInstanceId).toEqual(expect.any(String));

    const implement = await failure(write('itsm.change', { id, values: { status: 'implementing' } }));
    expect(implement.details).toMatchObject({ reason: 'approval_required', to: 'implementing' });
    const replan = await failure(write('itsm.change', { id, values: { plannedEnd: later(8) } }));
    expect(replan.statusCode).toBe(409);
    expect(replan.code).toBe('INVALID_STATE');

    const created = await outboxOf('itsm.ticket.created', 'ticketId', id);
    expect(changesOf(created[0]!)).toEqual([{ entity: 'itsm.change', id, kind: 'record' }]);
  });

  it('lets an approved (pre-approved standard) change move on', async () => {
    const { id } = await write('itsm.change', {
      values: {
        title: 'Rotate the TLS certificate',
        changeType: 'standard',
        risk: 'low',
        plannedStart: later(2),
        plannedEnd: later(2.05),
        status: 'authorization',
      },
    });
    expect((await sync().read('itsm.change', id))!.values.status).toBe('scheduled');
    await write('itsm.change', { id, values: { status: 'implementing', assignee: ids.bob } });
    expect((await sync().read('itsm.change', id))!.values).toMatchObject({
      status: 'implementing',
      assignee: ids.bob,
    });
  });
});

/* ───────────────────────────── itam.asset ───────────────────────────── */

describe('itam.asset', () => {
  let id: string;

  it('describes its fields and matches on serial number', async () => {
    const fields = await sync().fields('itam.asset');
    expect(fields.map((f) => f.key)).toEqual([
      'name',
      'category',
      'serialNumber',
      'status',
      'assignedTo',
      'location',
      'vendor',
      'purchaseDate',
      'purchaseCost',
      'currency',
      'invoiceNumber',
      'warrantyEnd',
      'notes',
      'ref',
    ]);
    const by = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(by.category).toMatchObject({ type: 'choice', required: true });
    expect(by.purchaseDate).toMatchObject({ type: 'date' });
    expect(by.purchaseCost).toMatchObject({ type: 'number' });
    expect(by.ref).toMatchObject({ readOnly: true });
    expect(
      sync()
        .entities()
        .find((e) => e.entity === 'itam.asset'),
    ).toMatchObject({
      matchKeys: ['serialNumber'],
      comments: false,
      permission: 'itam.assets.sync',
    });
  });

  it('creates an asset handed to a person, and finds it by serial number', async () => {
    ({ id } = await write(
      'itam.asset',
      {
        values: {
          name: 'TPE-LT-0420',
          category: 'laptop',
          serialNumber: 'PF3ABC12',
          assignedTo: ids.alice,
          location: 'Taipei HQ 7F',
          purchaseDate: '2026-01-15',
          purchaseCost: 42000,
          currency: 'twd',
          warrantyEnd: '2029-01-14',
        },
      },
      { ref: '#A-77' },
    ));
    const record = await sync().read('itam.asset', id);
    expect(record).toMatchObject({
      ref: expect.stringMatching(/^AST-\d{5}$/),
      href: expect.stringMatching(/^\/itam\/hardware\/AST-/),
      values: {
        status: 'deployed',
        assignedTo: ids.alice,
        currency: 'TWD',
        purchaseCost: 42000,
        purchaseDate: '2026-01-15',
        vendor: null,
      },
    });
    expect((await sync().findBy('itam.asset', 'serialNumber', 'pf3abc12'))?.id).toBe(id);
    expect(await sync().findBy('itam.asset', 'serialNumber', 'NOPE')).toBeNull();
    expect(await sync().findBy('itam.asset', 'name', 'TPE-LT-0420')).toBeNull();
    const [audit] = await auditOf('itam.asset.created', id);
    expect(audit).toMatchObject({ actorType: 'ai_agent', actorName: 'Integrations Hub' });
    expect(audit!.metadata).toMatchObject({ source: { remoteRef: '#A-77' } });
    const [assigned] = await outboxOf('itam.asset.assigned', 'assetId', id);
    expect(changesOf(assigned!)).toEqual([{ entity: 'itam.asset', id, kind: 'record' }]);
    const duplicate = await failure(
      write('itam.asset', { values: { name: 'Twin', category: 'laptop', serialNumber: 'PF3ABC12' } }),
    );
    expect(duplicate.statusCode).toBe(409);
  });

  it('follows the lifecycle: return and retire step by step, history says where it came from', async () => {
    await write('itam.asset', {
      id,
      values: { location: 'Taipei HQ 3F', assignedTo: null, status: 'retired' },
    });
    expect((await sync().read('itam.asset', id))!.values).toMatchObject({
      status: 'retired',
      assignedTo: null,
      location: 'Taipei HQ 3F',
    });
    const statuses = await outboxOf('itam.asset.status_changed', 'assetId', id);
    expect(statuses.map((e) => [(e.payload as LooseJson).from, (e.payload as LooseJson).to])).toEqual([
      ['deployed', 'in_stock'],
      ['in_stock', 'retired'],
    ]);
    const history = await h.call(await h.login('admin'), 'GET', `/api/v1/itam/assets/${id}/events`);
    expect(history.status).toBe(200);
    expect(history.body.items[0]).toMatchObject({
      kind: 'status_changed',
      actor: { displayName: 'Integrations Hub' },
      via: { connection: 'Contoso ServiceDesk Plus', ref: '#1234' },
    });
  });

  it('never disposes of an asset: that takes the disposal approval', async () => {
    const err = await failure(write('itam.asset', { id, values: { status: 'disposed' } }));
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.details).toMatchObject({ from: 'retired', to: 'disposed', reason: 'approval_required' });
    const created = await failure(
      write('itam.asset', { values: { name: 'Old phone', category: 'phone', status: 'disposed' } }),
    );
    expect(created.details).toMatchObject({ reason: 'approval_required' });
    const back = await failure(write('itam.asset', { id, values: { status: 'ordered' } }));
    expect(back.statusCode).toBe(409);
    expect(back.details).toMatchObject({ from: 'retired', to: 'ordered' });
  });

  it('refuses bad values with 422 and writes without the permission with 403', async () => {
    const choice = await failure(write('itam.asset', { values: { name: 'X', category: 'spaceship' } }));
    expect(choice.statusCode).toBe(422);
    expect(choice.details.issues).toEqual([{ path: 'category', message: '"spaceship" is not a choice' }]);
    const person = await failure(
      write('itam.asset', { values: { name: 'X', category: 'monitor', assignedTo: ids.gone } }),
    );
    expect(person.details.issues).toEqual([{ path: 'assignedTo', message: 'unknown or inactive person' }]);
    const stock = await failure(
      write('itam.asset', {
        values: { name: 'X', category: 'monitor', assignedTo: ids.alice, status: 'in_stock' },
      }),
    );
    expect(stock.statusCode).toBe(422);
    const currency = await failure(
      write('itam.asset', { values: { name: 'X', category: 'monitor', currency: '$$' } }),
    );
    expect(currency.details.issues[0].path).toBe('currency');
    const denied = await failure(
      write(
        'itam.asset',
        { values: { name: 'X', category: 'monitor' } },
        { auth: agentWith(['itsm.tickets.sync']) },
      ),
    );
    expect(denied.statusCode).toBe(403);
  });

  it('lists in update order, page by page', async () => {
    for (const name of ['TPE-MON-1', 'TPE-MON-2'])
      await write('itam.asset', { values: { name, category: 'monitor', status: 'ordered' } });
    const first = await sync().list('itam.asset', { limit: 1 });
    const second = await sync().list('itam.asset', { limit: 1, after: first.next });
    const rest = await sync().list('itam.asset', { limit: 10, after: second.next });
    const all = [...first.items, ...second.items, ...rest.items];
    expect(all.map((a) => a.title)).toEqual(['TPE-LT-0420', 'TPE-MON-1', 'TPE-MON-2']);
    expect(rest.next).toBeNull();
    expect(
      (
        await sync().readMany(
          'itam.asset',
          all.map((a) => a.id),
        )
      ).length,
    ).toBe(3);
  });
});

/* ───────────────────────────── knowledge.article ───────────────────────────── */

describe('knowledge.article', () => {
  /** The agent with the publish permission an admin granted it. */
  const publisher = agentWith(['*.*.sync', 'knowledge.articles.publish']);
  let id: string;

  it('describes its fields and matches on title', async () => {
    const fields = await sync().fields('knowledge.article');
    expect(fields.map((f) => f.key)).toEqual([
      'title',
      'summary',
      'body',
      'category',
      'tags',
      'locale',
      'audience',
      'status',
      'ref',
    ]);
    const by = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(by.body).toMatchObject({ type: 'markdown' });
    expect(by.tags).toMatchObject({ type: 'tags' });
    expect(by.locale!.choices!.map((c) => c.value)).toEqual(['en', 'zh-TW', 'ja-JP']);
    expect(
      sync()
        .entities()
        .find((e) => e.entity === 'knowledge.article'),
    ).toMatchObject({
      matchKeys: ['title'],
      permission: 'knowledge.articles.sync',
    });
  });

  it('creates a draft that says where it came from, and finds it by title', async () => {
    ({ id } = await write(
      'knowledge.article',
      {
        values: {
          title: 'Reset your VPN token',
          summary: 'When the token app shows an error.',
          body: '1. Open the token app\n2. Choose **Reset**',
          tags: ['VPN', 'token'],
          audience: 'everyone',
        },
      },
      { ref: '#S-812' },
    ));
    const record = await sync().read('knowledge.article', id);
    expect(record).toMatchObject({
      ref: expect.stringMatching(/^KB-\d{5}$/),
      values: { status: 'draft', tags: ['vpn', 'token'], locale: 'en', category: null },
    });
    const [row] = await h.kernel.db.select().from(articles).where(eq(articles.id, id));
    expect(row).toMatchObject({
      ownerId: null,
      source: { type: 'integration', reference: 'Contoso ServiceDesk Plus #S-812' },
    });
    expect((await sync().findBy('knowledge.article', 'title', 'reset your vpn TOKEN'))?.id).toBe(id);
    await write('knowledge.article', { values: { title: 'Printer offline' } });
    await write('knowledge.article', { values: { title: 'printer OFFLINE' } });
    expect(await sync().findBy('knowledge.article', 'title', 'Printer offline')).toBeNull();
    expect(await sync().findBy('knowledge.article', 'title', 'Reset%')).toBeNull();
  });

  it('submits drafts for review as their author, and publishes what the other system approved', async () => {
    await write('knowledge.article', { id, values: { summary: 'If the token app shows an error.' } });
    // Submitting goes to review (not straight to published).
    await write('knowledge.article', { id, values: { status: 'in_review' } });
    expect((await sync().read('knowledge.article', id))!.values.status).toBe('in_review');

    // knowledge.articles.sync (held by the hub's agent) is enough to publish synced content.
    await write('knowledge.article', { id, values: { status: 'published' } });
    expect((await sync().read('knowledge.article', id))!.values.status).toBe('published');
    const versions = await h.kernel.db
      .select()
      .from(articleVersions)
      .where(eq(articleVersions.articleId, id));
    expect(versions).toEqual([expect.objectContaining({ version: 1, publishedBy: null })]);
    const [published] = await outboxOf('knowledge.article.published', 'articleId', id);
    expect(changesOf(published!)).toEqual([{ entity: 'knowledge.article', id, kind: 'record' }]);

    // Editing the live article publishes a new version.
    await write('knowledge.article', { id, values: { body: 'New steps' } });
    expect(await h.kernel.db.$count(articleVersions, eq(articleVersions.articleId, id))).toBe(2);
  });

  it('leaves the decision to a running review workflow', async () => {
    const { id: other } = await write('knowledge.article', {
      values: { title: 'Map a network drive', body: 'Use **File Explorer**.', status: 'in_review' },
    });
    await h.kernel.db
      .update(articles)
      .set({ reviewInstanceId: '0199a000-0000-7000-8000-0000000000ff' })
      .where(eq(articles.id, other));
    const err = await failure(
      write('knowledge.article', { id: other, values: { status: 'published' } }, { auth: publisher }),
    );
    expect(err.statusCode).toBe(409);
    expect(err.details).toMatchObject({ from: 'in_review', to: 'published', reason: 'approval_required' });
    // Back to a draft goes through the lifecycle: retire, then restore (both need the publish permission).
    await write('knowledge.article', { id, values: { status: 'draft' } }, { auth: publisher });
    expect((await sync().read('knowledge.article', id))!.values.status).toBe('draft');
    expect(await outboxOf('knowledge.article.retired', 'articleId', id)).toHaveLength(1);
  });

  it('refuses bad values with 422 and lists in update order', async () => {
    const locale = await failure(write('knowledge.article', { values: { title: 'X', locale: 'fr' } }));
    expect(locale.details.issues).toEqual([{ path: 'locale', message: '"fr" is not a choice' }]);
    const tags = await failure(
      write('knowledge.article', {
        values: { title: 'X', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      }),
    );
    expect(tags.statusCode).toBe(422);
    expect(tags.details.issues[0].path).toBe('tags');
    const first = await sync().list('knowledge.article', { limit: 2 });
    const rest = await sync().list('knowledge.article', { limit: 10, after: first.next });
    const titles = [...first.items, ...rest.items].map((a) => a.title);
    expect(titles).toHaveLength(4);
    expect(titles.at(-1)).toBe('Reset your VPN token');
  });
});

/* ───────────────────────────── projects.project / projects.task ───────────────────────────── */

describe('projects.project', () => {
  let id: string;

  it('describes its fields and matches on name', async () => {
    const fields = await sync().fields('projects.project');
    expect(fields.map((f) => f.key)).toEqual([
      'name',
      'description',
      'startDate',
      'targetDate',
      'status',
      'ref',
    ]);
    expect(
      sync()
        .entities()
        .find((e) => e.entity === 'projects.project'),
    ).toMatchObject({
      matchKeys: ['name'],
      container: null,
      permission: 'projects.projects.sync',
    });
  });

  it('creates a proposed project with a free key and no manager yet', async () => {
    ({ id } = await write(
      'projects.project',
      {
        values: { name: 'Network Refresh', description: 'Core and access switches', startDate: '2026-11-02' },
      },
      { ref: 'Contoso/NetworkRefresh' },
    ));
    const record = await sync().read('projects.project', id);
    expect(record).toMatchObject({
      ref: 'NR',
      href: '/projects/NR',
      values: { status: 'proposed', startDate: '2026-11-02', targetDate: null, ref: 'NR' },
    });
    const [row] = await h.kernel.db.select().from(projects).where(eq(projects.id, id));
    expect(row).toMatchObject({ ownerId: null, approvalStatus: null, createdBy: null });
    const { id: twin } = await write('projects.project', { values: { name: 'network refresh' } });
    expect((await sync().read('projects.project', twin))!.ref).toBe('NR2');
    expect(await sync().findBy('projects.project', 'name', 'Network Refresh')).toBeNull();
    const { id: unique } = await write('projects.project', { values: { name: '高雄辦公室搬遷' } });
    expect((await sync().read('projects.project', unique))!.ref).toBe('PRJ');
    expect((await sync().findBy('projects.project', 'name', '高雄辦公室搬遷'))?.id).toBe(unique);
    const [created] = await outboxOf('projects.project.created', 'projectId', id);
    expect(changesOf(created!)).toEqual([{ entity: 'projects.project', id, kind: 'record' }]);
  });

  it('never starts a project: that is the proposal approval’s decision', async () => {
    const err = await failure(write('projects.project', { id, values: { status: 'active' } }));
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.details).toMatchObject({ from: 'proposed', to: 'active', reason: 'approval_required' });
    const done = await failure(write('projects.project', { id, values: { status: 'completed' } }));
    expect(done.details).toMatchObject({ reason: 'approval_required' });
    const created = await failure(
      write('projects.project', { values: { name: 'Started elsewhere', status: 'active' } }),
    );
    expect(created.details).toMatchObject({ reason: 'approval_required' });
    expect(await sync().findBy('projects.project', 'name', 'Started elsewhere')).toBeNull();
  });

  it('updates fields and follows the status flow once the project was approved', async () => {
    const dates = await failure(write('projects.project', { id, values: { targetDate: '2026-10-01' } }));
    expect(dates.statusCode).toBe(422);
    expect(dates.details.issues[0].path).toBe('targetDate');
    await write('projects.project', { id, values: { targetDate: '2027-03-31', description: null } });
    expect((await sync().read('projects.project', id))!.values).toMatchObject({
      targetDate: '2027-03-31',
      description: null,
    });
    // The proposal approval decided (as `decide` does).
    await h.kernel.db
      .update(projects)
      .set({ status: 'active', approvalStatus: 'approved' })
      .where(eq(projects.id, id));
    await write('projects.project', { id, values: { status: 'on_hold' } }, { ref: 'Contoso/NetworkRefresh' });
    const [update] = await h.kernel.db
      .select()
      .from(projectUpdates)
      .where(and(eq(projectUpdates.projectId, id), eq(projectUpdates.kind, 'status')));
    expect(update).toMatchObject({
      fromValue: 'active',
      toValue: 'on_hold',
      authorId: null,
      authorName: 'Integrations Hub',
      via: { ref: 'Contoso/NetworkRefresh' },
    });
    const [status] = await outboxOf('projects.project.status_changed', 'projectId', id);
    expect(changesOf(status!)).toEqual([{ entity: 'projects.project', id, kind: 'record' }]);
  });
});

describe('projects.task', () => {
  let projectId: string;
  let otherProject: string;
  let milestoneId: string;
  let epic: string;
  let story: string;

  beforeAll(async () => {
    ({ id: projectId } = await write('projects.project', { values: { name: 'Zero Trust Rollout' } }));
    ({ id: otherProject } = await write('projects.project', { values: { name: 'ERP Upgrade' } }));
    const [m] = await h.kernel.db
      .insert(milestones)
      .values({ projectId, name: 'Pilot', dueDate: '2026-12-15' })
      .returning();
    milestoneId = m!.id;
  });

  it('describes its fields, with the container project’s milestones', async () => {
    const fields = await sync().fields('projects.task', { containerId: projectId });
    expect(fields.map((f) => f.key)).toEqual([
      'type',
      'title',
      'description',
      'status',
      'priority',
      'assignee',
      'parent',
      'milestone',
      'startDate',
      'dueDate',
      'estimateHours',
      'remainingHours',
      'labels',
      'ref',
    ]);
    const milestone = fields.find((f) => f.key === 'milestone')!;
    expect(milestone.choices).toEqual([
      { value: milestoneId, label: { en: 'Pilot', 'zh-TW': 'Pilot', 'ja-JP': 'Pilot' } },
    ]);
    expect(
      (await sync().fields('projects.task')).find((f) => f.key === 'milestone')!.choices,
    ).toBeUndefined();
    expect(fields.find((f) => f.key === 'parent')).toMatchObject({ type: 'parent' });
    expect(
      sync()
        .entities()
        .find((e) => e.entity === 'projects.task'),
    ).toMatchObject({
      container: 'projects.project',
      comments: true,
    });
  });

  it('creates tasks in their project, with parents, milestones and the membership rule for assignees', async () => {
    const container = await failure(write('projects.task', { values: { title: 'No project' } }));
    expect(container.statusCode).toBe(422);
    expect(container.details.issues).toEqual([{ path: 'containerId', message: 'required' }]);

    ({ id: epic } = await write(
      'projects.task',
      { containerId: projectId, values: { type: 'epic', title: 'Device trust', priority: 'high' } },
      { ref: 'Epic 801' },
    ));
    // Someone the other system assigns joins the project as a member (0 %), with the source on record.
    const { id: joined } = await write(
      'projects.task',
      { containerId: projectId, values: { title: 'Pilot group', assignee: ids.bob } },
      { ref: 'Task 800' },
    );
    expect((await sync().read('projects.task', joined))!.values.assignee).toBe(ids.bob);
    const [membership] = await h.kernel.db
      .select()
      .from(members)
      .where(and(eq(members.projectId, projectId), eq(members.userId, ids.bob)));
    expect(membership).toMatchObject({ role: 'member', allocationPct: 0, via: { ref: 'Task 800' } });
    const [added] = await auditOf('projects.member.added', projectId);
    expect(added).toMatchObject({ actorName: 'Integrations Hub' });
    expect(added!.metadata).toMatchObject({ userId: ids.bob, source: { remoteRef: 'Task 800' } });
    const project = await h.call(await h.login('admin'), 'GET', `/api/v1/projects/projects/${projectId}`);
    expect(project.body.members).toContainEqual(
      expect.objectContaining({ userId: ids.bob, via: expect.objectContaining({ ref: 'Task 800' }) }),
    );
    // Inactive people never join; viewers stay viewers (and can't be assigned).
    const gone = await failure(
      write('projects.task', { containerId: projectId, values: { title: 'x', assignee: ids.gone } }),
    );
    expect(gone.details.issues).toEqual([{ path: 'assignee', message: 'unknown or inactive person' }]);
    await h.kernel.db.insert(members).values({ projectId, userId: ids.alice, role: 'viewer' });
    const viewer = await failure(
      write('projects.task', { containerId: projectId, values: { title: 'x', assignee: ids.alice } }),
    );
    expect(viewer.statusCode).toBe(422);
    expect(viewer.details.issues).toEqual([{ path: 'assignee', message: expect.any(String) }]);
    ({ id: story } = await write(
      'projects.task',
      {
        containerId: projectId,
        values: {
          type: 'story',
          title: 'Enrol laptops',
          assignee: ids.bob,
          parent: epic,
          milestone: milestoneId,
          dueDate: '2026-12-01',
          estimateHours: 16,
          labels: ['Intune', 'pilot'],
        },
      },
      { ref: 'Story 802' },
    ));
    const record = await sync().read('projects.task', story);
    expect(record).toMatchObject({
      ref: 'ZTR-3',
      href: '/projects/tasks/ZTR-3',
      containerId: projectId,
      values: {
        type: 'story',
        status: 'todo',
        assignee: ids.bob,
        parent: epic,
        milestone: milestoneId,
        estimateHours: 16,
        labels: ['Intune', 'pilot'],
      },
    });
    const [assigned] = await outboxOf('projects.task.assigned', 'taskId', story);
    expect(changesOf(assigned!)).toEqual([{ entity: 'projects.task', id: story, kind: 'record' }]);
    const created = await h.kernel.db.select().from(taskActivity).where(eq(taskActivity.taskId, story));
    expect(created[0]).toMatchObject({ kind: 'created', actorId: null, actorName: 'Integrations Hub' });
    expect(created[0]!.via).toMatchObject({ ref: 'Story 802' });

    const foreign = await write('projects.task', {
      containerId: otherProject,
      values: { title: 'Plan cutover' },
    });
    const badParent = await failure(write('projects.task', { id: story, values: { parent: foreign.id } }));
    expect(badParent.statusCode).toBe(422);
    expect(badParent.code).toBe('INVALID_PARENT');
    expect(badParent.details.issues[0].path).toBe('parent');
    const moved = await failure(
      write('projects.task', { id: story, containerId: otherProject, values: { title: 'Moved' } }),
    );
    expect(moved.statusCode).toBe(409);
  });

  it('finds a task by title within its project, so a first sync links instead of duplicating', async () => {
    expect(
      sync()
        .entities()
        .find((e) => e.entity === 'projects.task')!.matchKeys,
    ).toEqual(['title']);
    expect(
      (await sync().findBy('projects.task', 'title', 'enrol LAPTOPS', { containerId: projectId }))?.id,
    ).toBe(story);
    expect(await sync().findBy('projects.task', 'title', 'Enrol laptops')).toBeNull();
    expect(
      await sync().findBy('projects.task', 'title', 'Enrol laptops', { containerId: otherProject }),
    ).toBeNull();
    for (let i = 0; i < 2; i++)
      await write('projects.task', { containerId: otherProject, values: { title: 'Data migration' } });
    expect(
      await sync().findBy('projects.task', 'title', 'data migration', { containerId: otherProject }),
    ).toBeNull();
    expect(await sync().findBy('projects.task', 'title', 'Enrol%', { containerId: projectId })).toBeNull();
  });

  it('holds tasks to their dependencies', async () => {
    const { id: prereq } = await write('projects.task', {
      containerId: projectId,
      values: { title: 'Buy the licences' },
    });
    await h.kernel.db.insert(taskDependencies).values({ taskId: story, dependsOnId: prereq });
    const blocked = await failure(write('projects.task', { id: story, values: { status: 'in_progress' } }));
    expect(blocked.statusCode).toBe(409);
    expect(blocked.details).toMatchObject({ reason: 'blocked' });
    await write('projects.task', { id: prereq, values: { status: 'done' } });
    await write('projects.task', { id: story, values: { status: 'in_progress', remainingHours: 10 } });
    expect((await sync().read('projects.task', story))!.values).toMatchObject({
      status: 'in_progress',
      remainingHours: 10,
    });
    const [status] = await outboxOf('projects.task.status_changed', 'taskId', story);
    expect(status!.payload).toMatchObject({ from: 'todo', to: 'in_progress' });
  });

  it('syncs comments with the remote author; no internal notes', async () => {
    const at = new Date(Date.now() - 2 * HOUR).toISOString();
    await h.kernel.db.transaction((tx) =>
      sync().comments.add(
        'projects.task',
        story,
        {
          body: 'Pilot group is ready.',
          authorName: 'Kenji Sato',
          authorEmail: 'kenji@contoso.example',
          createdAt: at,
        },
        { auth: agent, tx: tx as never, source: source('Story 802') },
      ),
    );
    expect(await sync().comments.list('projects.task', story)).toEqual([
      expect.objectContaining({
        body: 'Pilot group is ready.',
        authorName: 'Kenji Sato',
        authorEmail: 'kenji@contoso.example',
        createdAt: at,
        internal: false,
      }),
    ]);
    const internal = await failure(
      h.kernel.db.transaction((tx) =>
        sync().comments.add(
          'projects.task',
          story,
          { body: 'Secret', authorName: 'Kenji Sato', internal: true },
          { auth: agent, tx: tx as never, source: source('Story 802') },
        ),
      ),
    );
    expect(internal.statusCode).toBe(422);
    const [commented] = await outboxOf('projects.task.commented', 'taskId', story);
    expect(changesOf(commented!)).toEqual([{ entity: 'projects.task', id: story, kind: 'comment' }]);
    const session = await h.login('admin');
    const list = await h.call(session, 'GET', `/api/v1/projects/tasks/${story}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({
      author: null,
      authorName: 'Kenji Sato',
      via: { ref: 'Story 802', connection: 'Contoso ServiceDesk Plus' },
    });
  });

  it('lists a project’s tasks in update order, and refuses writes to archived projects', async () => {
    const first = await sync().list('projects.task', { containerId: projectId, limit: 2 });
    const rest = await sync().list('projects.task', { containerId: projectId, limit: 10, after: first.next });
    const all = [...first.items, ...rest.items];
    expect(all.map((t) => t.containerId)).toEqual(all.map(() => projectId));
    expect(new Set(all.map((t) => t.id))).toEqual(
      new Set([
        epic,
        story,
        all.find((t) => t.title === 'Pilot group')!.id,
        all.find((t) => t.title === 'Buy the licences')!.id,
      ]),
    );
    expect(all.at(-1)!.id).toBe(story);
    await h.kernel.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, projectId));
    const err = await failure(
      write('projects.task', { id: epic, values: { title: 'Device trust (phase 1)' } }),
    );
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('INVALID_STATE');
  });
});

/* ───────────────────────────── alm.repository ───────────────────────────── */

describe('alm.repository', () => {
  let appId: string;
  let otherApp: string;
  let id: string;
  const url = 'https://ado.contoso.local/tfs/DefaultCollection/ERP/_git/erp-core';
  const git = {
    defaultBranch: 'main',
    lastCommitSha: '9f2c1e7a4b',
    lastCommitAt: '2026-10-06T08:30:00Z',
    lastCommitMessage: 'Fix VAT rounding\n\nCloses #812',
    lastCommitAuthor: 'Mei Lin',
    branches: [
      { name: 'refs/heads/main', commitSha: '9f2c1e7a4b', committedAt: '2026-10-06T08:30:00Z' },
      { name: 'refs/heads/feature/einvoice', commitSha: '1a2b3c4d5e', ahead: 3, behind: 1 },
    ],
    pullRequests: [
      {
        id: 57,
        title: 'E-invoice export',
        author: 'Kenji Sato',
        sourceBranch: 'refs/heads/feature/einvoice',
        targetBranch: 'refs/heads/main',
        url: 'https://ado.contoso.local/tfs/DefaultCollection/ERP/_git/erp-core/pullrequest/57',
        createdAt: '2026-10-05T02:00:00Z',
        draft: false,
      },
    ],
  };

  beforeAll(async () => {
    const admin = await h.login('admin');
    const erp = await h.call(admin, 'POST', '/api/v1/alm/applications', { code: 'erp', name: 'ERP' });
    expect(erp.status, JSON.stringify(erp.body)).toBe(201);
    appId = erp.body.id;
    const hr = await h.call(admin, 'POST', '/api/v1/alm/applications', {
      code: 'hr-portal',
      name: 'HR Portal',
    });
    otherApp = hr.body.id;
  });

  it('describes its fields, lives in an application and matches on URL', async () => {
    const fields = await sync().fields('alm.repository');
    expect(fields.map((f) => [f.key, f.type])).toEqual([
      ['name', 'string'],
      ['url', 'string'],
      ['provider', 'choice'],
      ['defaultBranch', 'string'],
      ['lastCommitSha', 'string'],
      ['lastCommitAt', 'datetime'],
      ['lastCommitMessage', 'text'],
      ['lastCommitAuthor', 'string'],
      ['branches', 'json'],
      ['pullRequests', 'json'],
    ]);
    expect(
      sync()
        .entities()
        .find((e) => e.entity === 'alm.repository'),
    ).toMatchObject({
      container: 'alm.application',
      matchKeys: ['url'],
      recordType: false,
    });
  });

  it('creates a repository with its Git status, shown on the application page', async () => {
    const missing = await failure(write('alm.repository', { values: { name: 'erp-core', url } }));
    expect(missing.details.issues).toEqual([{ path: 'containerId', message: 'required' }]);
    ({ id } = await write(
      'alm.repository',
      { containerId: appId, values: { name: 'erp-core', url, provider: 'azure_devops', ...git } },
      { ref: 'ERP/erp-core' },
    ));
    const record = await sync().read('alm.repository', id);
    expect(record).toMatchObject({
      ref: 'erp/erp-core',
      href: '/alm/erp',
      containerId: appId,
      values: {
        url,
        defaultBranch: 'main',
        lastCommitAt: '2026-10-06T08:30:00.000Z',
        branches: [
          { name: 'main', commitSha: '9f2c1e7a4b' },
          { name: 'feature/einvoice', ahead: 3, behind: 1 },
        ],
        pullRequests: [{ id: '57', sourceBranch: 'feature/einvoice', targetBranch: 'main', draft: false }],
      },
    });
    const app = await h.call(await h.login('admin'), 'GET', '/api/v1/alm/applications/erp');
    expect(app.status, JSON.stringify(app.body)).toBe(200);
    expect(app.body.repositories[0]).toMatchObject({
      name: 'erp-core',
      lastCommit: { sha: '9f2c1e7a4b', author: 'Mei Lin' },
      branches: [{ name: 'main' }, { name: 'feature/einvoice' }],
      pullRequests: [{ title: 'E-invoice export' }],
      syncedAt: expect.any(String),
    });
    const [created] = await outboxOf('alm.repository.created', 'repositoryId', id);
    expect(created!.payload).toMatchObject({ applicationId: appId, code: 'erp', repository: 'erp-core' });
    expect(changesOf(created!)).toEqual([{ entity: 'alm.repository', id, kind: 'record' }]);
    const [audit] = await auditOf('alm.repository.created', appId);
    expect(audit!.metadata).toMatchObject({ repositoryId: id, source: { remoteRef: 'ERP/erp-core' } });
  });

  it('finds a repository by URL, within its application', async () => {
    expect((await sync().findBy('alm.repository', 'url', `${url.toUpperCase()}/`))?.id).toBe(id);
    expect((await sync().findBy('alm.repository', 'url', url, { containerId: appId }))?.id).toBe(id);
    expect(await sync().findBy('alm.repository', 'url', url, { containerId: otherApp })).toBeNull();
    expect(await sync().findBy('alm.repository', 'url', 'https://ado.contoso.local/other')).toBeNull();
  });

  it('updates the Git status, and only says when it last looked when nothing changed', async () => {
    await write('alm.repository', { id, values: { pullRequests: [], lastCommitSha: 'abcdef1234' } });
    const [updated] = await outboxOf('alm.repository.updated', 'repositoryId', id);
    expect((updated!.payload as LooseJson).changes).toEqual(
      expect.arrayContaining(['pullRequests', 'lastCommitSha']),
    );
    expect(changesOf(updated!)).toEqual([{ entity: 'alm.repository', id, kind: 'record' }]);
    const [before] = await h.kernel.db.select().from(repositories).where(eq(repositories.id, id));
    await new Promise((r) => setTimeout(r, 20));
    await write('alm.repository', { id, values: { pullRequests: [], lastCommitSha: 'abcdef1234' } });
    const [after] = await h.kernel.db.select().from(repositories).where(eq(repositories.id, id));
    expect(after!.updatedAt).toEqual(before!.updatedAt);
    expect(after!.syncedAt!.getTime()).toBeGreaterThan(before!.syncedAt!.getTime());
    expect(await outboxOf('alm.repository.updated', 'repositoryId', id)).toHaveLength(1);
  });

  it('holds values to the module’s rules (http(s) links, commit hashes, Git status shapes) and needs the permission', async () => {
    // A Git server without TLS (Azure DevOps Server behind "Allow insecure HTTP") reports http links.
    const { id: legacy } = await write('alm.repository', {
      containerId: appId,
      values: { name: 'legacy', url: 'http://git.contoso.local/tfs/DefaultCollection/_git/legacy' },
    });
    expect((await sync().read('alm.repository', legacy))!.values.url).toBe(
      'http://git.contoso.local/tfs/DefaultCollection/_git/legacy',
    );
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://git.contoso.local/x']) {
      const bad = await failure(
        write('alm.repository', { containerId: appId, values: { name: 'bad', url } }),
      );
      expect(bad.statusCode, url).toBe(422);
      expect(
        bad.details.issues.every((i: LooseJson) => i.path === 'url'),
        url,
      ).toBe(true);
    }
    const admin = await h.login('admin');
    const ui = await h.call(admin, 'POST', '/api/v1/alm/applications/hr-portal/repositories', {
      name: 'hr-legacy',
      url: 'http://git.contoso.local/hr-legacy',
    });
    expect(ui.status, JSON.stringify(ui.body)).toBe(201);
    const uiBad = await h.call(admin, 'POST', '/api/v1/alm/applications/hr-portal/repositories', {
      name: 'hr-bad',
      url: 'javascript:alert(1)',
    });
    expect(uiBad.status).toBe(400);
    const sha = await failure(write('alm.repository', { id, values: { lastCommitSha: 'not-a-sha' } }));
    expect(sha.details.issues[0].path).toBe('lastCommitSha');
    const branches = await failure(write('alm.repository', { id, values: { branches: [{ commit: 'x' }] } }));
    expect(branches.statusCode).toBe(422);
    expect(branches.details.issues[0].path).toBe('branches');
    const app = await failure(
      write('alm.repository', {
        containerId: '0199a000-0000-7000-8000-000000000999',
        values: { name: 'x', url },
      }),
    );
    expect(app.details.issues).toEqual([{ path: 'containerId', message: 'unknown application' }]);
    const moved = await failure(
      write('alm.repository', { id, containerId: otherApp, values: { name: 'moved' } }),
    );
    expect(moved.statusCode).toBe(409);
    const denied = await failure(
      write('alm.repository', { id, values: { name: 'x' } }, { auth: agentWith(['projects.tasks.sync']) }),
    );
    expect(denied.statusCode).toBe(403);
  });

  it('takes an empty repository without a default branch: keeps the one on record (main for a new one)', async () => {
    const { id: empty } = await write('alm.repository', {
      containerId: otherApp,
      values: {
        name: 'hr-empty',
        url: 'https://ado.contoso.local/tfs/DefaultCollection/HR/_git/hr-empty',
        defaultBranch: null,
      },
    });
    expect((await sync().read('alm.repository', empty))!.values.defaultBranch).toBe('main');
    await write('alm.repository', { id: empty, values: { defaultBranch: 'develop' } });
    await write('alm.repository', { id: empty, values: { defaultBranch: null, branches: [] } });
    await write('alm.repository', { id: empty, values: { defaultBranch: '' } });
    expect((await sync().read('alm.repository', empty))!.values).toMatchObject({
      defaultBranch: 'develop',
      branches: [],
    });
    const nameless = await failure(write('alm.repository', { id: empty, values: { name: null } }));
    expect(nameless.details.issues).toEqual([{ path: 'name', message: 'required' }]);
  });

  it('lists an application’s repositories in update order', async () => {
    await write('alm.repository', {
      containerId: otherApp,
      values: { name: 'hr-web', url: 'https://ado.contoso.local/tfs/DefaultCollection/HR/_git/hr-web' },
    });
    const erp = await sync().list('alm.repository', { containerId: appId, limit: 10 });
    expect(erp.items.map((r) => r.title)).toEqual(['erp-core', 'legacy']);
    expect(erp.items[0]!.id).toBe(id);
    const all = await sync().list('alm.repository', { limit: 2 });
    const rest = await sync().list('alm.repository', { limit: 10, after: all.next });
    expect([...all.items, ...rest.items].map((r) => r.title)).toEqual([
      'erp-core',
      'legacy',
      'hr-legacy',
      'hr-empty',
      'hr-web',
    ]);
    expect(rest.next).toBeNull();
  });
});
