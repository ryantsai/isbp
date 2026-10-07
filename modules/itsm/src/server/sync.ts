/**
 * Sync adapters (Phase 5): `itsm.ticket` (incidents, service requests, problems) and `itsm.change`, so the
 * Integrations Hub can keep them in step with another system (ServiceDesk Plus requests, problems and
 * changes) without this module knowing it. Writes go through `TicketService` with the hub's agent: the
 * state machines, required fields, SLA timers, history, audit, events and notifications are the UI's, and
 * a change only gets past `authorization` through the CAB workflow in ISBP.
 */
import { groups, users } from '@isbp/db/schema';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import {
  type AuthContext,
  type Db,
  type DomainEvent,
  httpErrors,
  localize,
  type LocalizedText,
  type ModuleContext,
  type SyncAdapter,
  type SyncChoice,
  type SyncComment,
  type SyncFieldDef,
  type SyncRecord,
} from '@isbp/sdk/server';
import { and, asc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import {
  createTicketSchema,
  resolutionCodeSchema,
  type ResolutionCode,
  type TicketStatus,
  type TicketType,
  updateChangeSchema,
  updateTicketSchema,
} from '../contracts';
import type { TicketRow } from './dto';
import { categoryMap } from './lookups';
import { allowedTransitions, refOf, RESOLVING_STATUSES, ticketHref } from './rules';
import { changes, ticketActivities, tickets } from './schema';
import { services } from './services';
import {
  approvalRequired,
  assertActiveUsers,
  cursorAt,
  inSyncWrite,
  invalidValues,
  isUuid,
  literal,
  noTransition,
  pageLimit,
  pageOf,
  pageOrder,
  pageWhere,
  parseInput,
  statusPath,
  syncErrors,
  viaOf,
  writerAuth,
} from './sync-support';

type Values = Record<string, unknown>;
type ChangeRow = typeof changes.$inferSelect;

const TICKET_TYPES = ['incident', 'service_request', 'problem'] as const;
const TICKET_STATUSES: TicketStatus[] = [
  'new',
  'pending_approval',
  'in_progress',
  'on_hold',
  'resolved',
  'fulfilled',
  'closed',
  'cancelled',
  'investigating',
  'known_error',
];
const CHANGE_STATUSES: TicketStatus[] = [
  'draft',
  'assessment',
  'authorization',
  'scheduled',
  'implementing',
  'review',
  'closed',
  'cancelled',
  'rejected',
];
/** Decided by the CAB workflow (`authorization →`), or only reachable after it approved. */
const CAB_STATUSES: TicketStatus[] = ['scheduled', 'implementing', 'review', 'closed', 'rejected'];
/** A change that has not been through its CAB approval yet. */
const PRE_CAB_STATUSES: TicketStatus[] = ['draft', 'assessment', 'authorization', 'rejected'];

/** What `itsm.tickets.sync` / `itsm.changes.sync` stand for (the kernel checked them). */
const TICKET_WRITER = ['itsm.tickets.read', 'itsm.tickets.work', 'itsm.problems.manage'];
const CHANGE_WRITER = ['itsm.changes.read', 'itsm.changes.manage'];

/** Module field (REST API) → sync field key, for error details. */
const KEYS: Record<string, string> = {
  categoryId: 'category',
  assignmentGroupId: 'assignmentGroup',
  assigneeId: 'assignee',
  requesterId: 'requester',
};

const label = (key: string) => `itsm.sync.fields.${key}`;
const choices = (values: readonly string[], prefix: string): SyncChoice[] =>
  values.map((value) => ({ value, label: `itsm.${prefix}.${value}` }));
const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** `'2'` → 2 (choices are strings); null stays null. */
const level = (v: unknown) => (v === null || v === undefined ? (v as null | undefined) : Number(v));
const text = (v: unknown) => (v === null ? '' : (v as string | undefined));
const defined = <T extends Values>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/* ───────────────────────────── shared lookups ───────────────────────────── */

const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;

/** Active categories of the given ticket types, labelled with their path per locale ("Network › VPN"). */
async function categoryChoices(db: Db, types: readonly TicketType[]): Promise<SyncChoice[]> {
  const all = await categoryMap(db);
  return [...all.values()]
    .filter((c) => c.active && c.ticketTypes.some((t) => types.includes(t)))
    .map((c) => ({
      value: c.id,
      label: Object.fromEntries(
        LOCALES.map((l) => [
          l,
          [...c.ancestors.map((a) => a.name), c.name].map((n: LocalizedText) => localize(n, l)).join(' › '),
        ]),
      ),
    }));
}

async function groupChoices(db: Db): Promise<SyncChoice[]> {
  const rows = await db.select({ id: groups.id, name: groups.name }).from(groups).orderBy(asc(groups.name));
  return rows.map((g) => ({ value: g.id, label: literal(g.name) }));
}

/** 404 unless `id` is a ticket of the entity's kind (changes are their own entity). */
async function rowOf(db: Db, id: string, kind: 'ticket' | 'change'): Promise<TicketRow> {
  const [row] = isUuid(id) ? await db.select().from(tickets).where(eq(tickets.id, id)) : [];
  if (!row || (row.type === 'change') !== (kind === 'change'))
    throw httpErrors.notFound(kind === 'change' ? 'Change not found' : 'Ticket not found');
  return row;
}

const kindFilter = (kind: 'ticket' | 'change'): SQL =>
  kind === 'change' ? eq(tickets.type, 'change') : ne(tickets.type, 'change');

/**
 * Other systems resolve incidents and service requests alike; ISBP resolves incidents and problems and fulfils
 * service requests. A sync's "resolved" on a service request means "fulfilled", and the other way round.
 */
export function forType(type: TicketType, to: TicketStatus): TicketStatus {
  if (type === 'service_request' && to === 'resolved') return 'fulfilled';
  if (type !== 'service_request' && type !== 'change' && to === 'fulfilled') return 'resolved';
  return to;
}

/**
 * Moves a ticket to `to` along the shortest path its state machine allows, one `transition` per step
 * (resolving steps use the resolution being written, else the one on the ticket). Changes never get past
 * `authorization` this way: the CAB decides in ISBP.
 */
async function moveTo(
  ctx: ModuleContext,
  auth: AuthContext,
  row: TicketRow,
  to: TicketStatus,
  resolution: { code?: ResolutionCode | null; notes?: string | null },
): Promise<{ row: TicketRow; resolved: boolean }> {
  to = forType(row.type, to);
  if (to === row.status) return { row, resolved: false };
  const path = statusPath((s) => allowedTransitions(row.type, s), row.status, to);
  if (!path) {
    if (row.type === 'change' && CAB_STATUSES.includes(to) && PRE_CAB_STATUSES.includes(row.status))
      throw approvalRequired(
        row.status,
        to,
        'A change is scheduled (or rejected) by its CAB approval in ISBP, not by a sync',
      );
    throw noTransition(row.status, to, allowedTransitions(row.type, row.status), `A ${row.type}`);
  }
  const s = services(ctx).tickets;
  let current = row;
  let resolved = false;
  for (const step of path) {
    const resolving = RESOLVING_STATUSES.includes(step);
    let code = resolution.code ?? current.resolutionCode ?? undefined;
    let notes = resolution.notes?.trim() || current.resolutionNotes || undefined;
    // ServiceDesk Plus and others have no resolution code: the other system resolved (or cancelled) it, so
    // its word is the resolution. A person resolving in ISBP always gives one.
    if (resolving) {
      code ??= step === 'cancelled' ? 'cancelled_by_requester' : 'solved';
      notes ??= await resolvedIn(ctx, current, step === 'cancelled' ? 'cancelledIn' : 'resolvedIn');
    }
    current = await s.transition(
      current.id,
      { status: step, ...(resolving ? { resolutionCode: code, resolutionNotes: notes } : {}) },
      auth,
    );
    if (resolving) resolved = true;
  }
  return { row: current, resolved };
}

const CATALOGS: Record<string, typeof en> = { en, 'zh-TW': zh as typeof en, 'ja-JP': ja as typeof en };

/** "Resolved in Contoso ServiceDesk Plus #1234" (or "Cancelled in …"), in the requester's language. */
async function resolvedIn(
  ctx: ModuleContext,
  t: TicketRow,
  key: 'resolvedIn' | 'cancelledIn' = 'resolvedIn',
): Promise<string | undefined> {
  const via = viaOf(ctx);
  if (!via) return undefined;
  const [person] = t.requesterId
    ? await ctx.db.select({ locale: users.locale }).from(users).where(eq(users.id, t.requesterId))
    : [];
  const template = (CATALOGS[person?.locale ?? 'en'] ?? en).sync[key];
  return template.replace('{system}', () => via.connection).replace('{reference}', () => via.ref);
}

/* ───────────────────────────── comments (tickets and changes) ───────────────────────────── */

function commentsOf(
  kind: 'ticket' | 'change',
  writer: readonly string[],
): NonNullable<SyncAdapter['comments']> {
  return {
    async list(id, ctx) {
      const t = await rowOf(ctx.db, id, kind);
      const rows = await ctx.db
        .select({ a: ticketActivities, name: users.displayName, email: users.email })
        .from(ticketActivities)
        .leftJoin(users, eq(users.id, ticketActivities.authorId))
        .where(
          and(eq(ticketActivities.ticketId, t.id), inArray(ticketActivities.kind, ['comment', 'work_note'])),
        )
        .orderBy(asc(ticketActivities.createdAt), asc(ticketActivities.id))
        .limit(1_000);
      return rows.map(({ a, name, email }): SyncComment => {
        const remote = (a.data as { author?: { email?: unknown } }).author;
        return {
          id: a.id,
          body: a.body ?? '',
          authorName: name ?? a.authorName ?? '—',
          authorEmail: email ?? (typeof remote?.email === 'string' ? remote.email : null),
          createdAt: a.createdAt.toISOString(),
          internal: !a.public,
        };
      });
    },
    add(id, comment, opts, ctx) {
      return inSyncWrite(ctx, opts, async (bound) => {
        const t = await rowOf(bound.db, id, kind);
        const at = comment.createdAt ? new Date(comment.createdAt) : undefined;
        const a = await syncErrors({}, () =>
          services(bound).tickets.comment(
            t.id,
            { body: comment.body.trim().slice(0, 20_000), public: !comment.internal },
            writerAuth(opts.auth, writer),
            {
              author: { name: comment.authorName.slice(0, 200) || '—', email: comment.authorEmail ?? null },
              at: at && !Number.isNaN(at.getTime()) ? at : undefined,
            },
          ),
        );
        return { id: a.id };
      });
    },
  };
}

/* ───────────────────────────── itsm.ticket ───────────────────────────── */

function ticketRecord(t: TicketRow): SyncRecord {
  const reference = refOf(t);
  return {
    id: t.id,
    ref: reference,
    title: t.title,
    href: ticketHref(reference),
    updatedAt: t.updatedAt.toISOString(),
    containerId: null,
    values: {
      type: t.type,
      title: t.title,
      description: t.description,
      status: t.status,
      impact: String(t.impact),
      urgency: String(t.urgency),
      priority: String(t.priority),
      category: t.categoryId,
      assignmentGroup: t.assignmentGroupId,
      assignee: t.assigneeId,
      requester: t.requesterId,
      resolutionCode: t.resolutionCode,
      resolutionNotes: t.resolutionNotes,
      major: t.major,
      ref: reference,
    },
  };
}

/** Status, then resolution fields the status steps did not take. */
async function statusAndResolution(ctx: ModuleContext, auth: AuthContext, row: TicketRow, v: Values) {
  const resolution = {
    code: v.resolutionCode as ResolutionCode | null | undefined,
    notes: v.resolutionNotes as string | null | undefined,
  };
  let current = row;
  let resolved = false;
  if (typeof v.status === 'string')
    ({ row: current, resolved } = await moveTo(ctx, auth, row, v.status as TicketStatus, resolution));
  if (!resolved && (resolution.code !== undefined || resolution.notes !== undefined))
    current = await services(ctx).tickets.setResolution(
      current.id,
      { resolutionCode: resolution.code, resolutionNotes: resolution.notes },
      auth,
    );
  return current;
}

async function createTicket(ctx: ModuleContext, auth: AuthContext, v: Values) {
  const type = (v.type ?? 'incident') as TicketType;
  if (v.major === true && type !== 'incident')
    throw invalidValues([{ path: 'major', message: 'only incidents can be major' }]);
  if (v.priority === null) delete v.priority;
  const input = parseInput(
    createTicketSchema,
    defined({
      type,
      title: v.title,
      description: text(v.description),
      impact: level(v.impact) ?? undefined,
      urgency: level(v.urgency) ?? undefined,
      categoryId: v.category ?? undefined,
      assignmentGroupId: v.assignmentGroup ?? undefined,
      assigneeId: v.assignee ?? undefined,
      requesterId: v.requester,
      major: v.major ?? undefined,
    }),
    KEYS,
  );
  const s = services(ctx).tickets;
  let row = await s.create(input, auth, { channel: 'integration' });
  // A priority someone chose (here: the other system) overrides the impact × urgency matrix, as in the UI.
  if (v.priority !== undefined) row = await s.update(row.id, { priority: Number(v.priority) }, auth);
  return statusAndResolution(ctx, auth, row, v);
}

async function updateTicket(ctx: ModuleContext, auth: AuthContext, before: TicketRow, v: Values) {
  if (v.major === true && before.type !== 'incident')
    throw invalidValues([{ path: 'major', message: 'only incidents can be major' }]);
  const cleared = (['requester', 'impact', 'urgency'] as const).filter((k) => v[k] === null);
  if (cleared.length) throw invalidValues(cleared.map((path) => ({ path, message: 'required' })));
  const patch = parseInput(
    updateTicketSchema,
    defined({
      title: v.title,
      description: text(v.description),
      impact: level(v.impact),
      urgency: level(v.urgency),
      priority: level(v.priority),
      categoryId: v.category,
      assignmentGroupId: v.assignmentGroup,
      assigneeId: v.assignee,
      requesterId: v.requester,
      major: v.major ?? undefined,
    }),
    KEYS,
  );
  const row = Object.keys(patch).length ? await services(ctx).tickets.update(before.id, patch, auth) : before;
  return statusAndResolution(ctx, auth, row, v);
}

export const ticketAdapter: SyncAdapter = {
  async fields(ctx): Promise<SyncFieldDef[]> {
    const [categories, groupList] = await Promise.all([
      categoryChoices(ctx.db, TICKET_TYPES),
      groupChoices(ctx.db),
    ]);
    return [
      {
        key: 'type',
        label: label('type'),
        type: 'choice',
        choices: choices(TICKET_TYPES, 'types'),
        createOnly: true,
      },
      { key: 'title', label: label('title'), type: 'string', required: true, maxLength: 200 },
      { key: 'description', label: label('description'), type: 'markdown', maxLength: 20_000 },
      { key: 'status', label: label('status'), type: 'choice', choices: choices(TICKET_STATUSES, 'status') },
      {
        key: 'impact',
        label: label('impact'),
        type: 'choice',
        choices: choices(['1', '2', '3'], 'impactShort'),
      },
      {
        key: 'urgency',
        label: label('urgency'),
        type: 'choice',
        choices: choices(['1', '2', '3'], 'urgencyShort'),
      },
      {
        key: 'priority',
        label: label('priority'),
        type: 'choice',
        choices: choices(['1', '2', '3', '4'], 'priority'),
      },
      { key: 'category', label: label('category'), type: 'choice', choices: categories },
      { key: 'assignmentGroup', label: label('assignmentGroup'), type: 'choice', choices: groupList },
      { key: 'assignee', label: label('assignee'), type: 'user' },
      // Not required: the other system may know people ISBP doesn't (the ticket then has no requester).
      { key: 'requester', label: label('requester'), type: 'user' },
      {
        key: 'resolutionCode',
        label: label('resolutionCode'),
        type: 'choice',
        choices: choices(resolutionCodeSchema.options, 'resolution'),
      },
      { key: 'resolutionNotes', label: label('resolutionNotes'), type: 'markdown', maxLength: 10_000 },
      { key: 'major', label: label('major'), type: 'boolean' },
      { key: 'ref', label: label('ref'), type: 'string', readOnly: true },
    ];
  },

  async read(id, ctx) {
    if (!isUuid(id)) return null;
    const [row] = await ctx.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), kindFilter('ticket')));
    return row ? ticketRecord(row) : null;
  },

  async readMany(ids, ctx) {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    const rows = await ctx.db
      .select()
      .from(tickets)
      .where(and(inArray(tickets.id, valid), kindFilter('ticket')));
    return rows.map(ticketRecord);
  },

  async list(opts, ctx) {
    const limit = pageLimit(opts.limit);
    const rows = await ctx.db
      .select({ t: tickets, cursorAt: cursorAt(tickets.updatedAt) })
      .from(tickets)
      .where(and(kindFilter('ticket'), pageWhere(tickets.updatedAt, tickets.id, opts)))
      .orderBy(...pageOrder(tickets.updatedAt, tickets.id))
      .limit(limit + 1);
    const page = pageOf(
      rows.map((r) => ({ ...r, id: r.t.id })),
      limit,
    );
    return { items: page.rows.map((r) => ticketRecord(r.t)), next: page.next };
  },

  write(input, opts, ctx) {
    return inSyncWrite(ctx, opts, async (bound) => {
      const v: Values = { ...input.values };
      const auth = writerAuth(opts.auth, TICKET_WRITER);
      await assertActiveUsers(bound.db, [
        ['assignee', v.assignee],
        ['requester', v.requester],
      ]);
      return syncErrors(KEYS, async () => {
        if (!input.id) return { id: (await createTicket(bound, auth, v)).id };
        const before = await rowOf(bound.db, input.id, 'ticket');
        await updateTicket(bound, auth, before, v);
        return { id: before.id };
      });
    });
  },

  idFromEvent(event: DomainEvent) {
    const p = event.payload as { ticketId?: unknown; type?: unknown };
    return p.type !== 'change' && isUuid(p.ticketId) ? p.ticketId : null;
  },

  comments: commentsOf('ticket', TICKET_WRITER),
};

/* ───────────────────────────── itsm.change ───────────────────────────── */

const CHANGE_FIELDS = [
  'changeType',
  'risk',
  'reason',
  'plannedStart',
  'plannedEnd',
  'implementationPlan',
  'backoutPlan',
  'testPlan',
] as const;

function changeRecord(t: TicketRow, c: ChangeRow | null): SyncRecord {
  const reference = refOf(t);
  return {
    id: t.id,
    ref: reference,
    title: t.title,
    href: ticketHref(reference),
    updatedAt: t.updatedAt.toISOString(),
    containerId: null,
    values: {
      title: t.title,
      description: t.description,
      status: t.status,
      changeType: c?.changeType ?? 'normal',
      risk: c?.risk ?? 'medium',
      reason: c?.reason ?? '',
      plannedStart: iso(c?.plannedStart ?? null),
      plannedEnd: iso(c?.plannedEnd ?? null),
      implementationPlan: c?.implementationPlan ?? '',
      backoutPlan: c?.backoutPlan ?? '',
      testPlan: c?.testPlan ?? '',
      assignmentGroup: t.assignmentGroupId,
      assignee: t.assigneeId,
      ref: reference,
    },
  };
}

const selectChanges = (db: Db) =>
  db.select({ t: tickets, c: changes }).from(tickets).leftJoin(changes, eq(changes.ticketId, tickets.id));

/** The plan's fields in the shape of the module's change schemas (texts: null → ''). */
function changePlan(v: Values) {
  const plan: Values = {};
  for (const k of CHANGE_FIELDS) {
    if (!(k in v)) continue;
    const value = v[k];
    if (k === 'plannedStart' || k === 'plannedEnd')
      plan[k] = typeof value === 'string' ? new Date(value).toISOString() : value;
    else if (k === 'changeType' || k === 'risk') {
      if (value === null) throw invalidValues([{ path: k, message: 'required' }]);
      plan[k] = value;
    } else plan[k] = value ?? '';
  }
  return plan;
}

async function createChange(ctx: ModuleContext, auth: AuthContext, v: Values) {
  const input = parseInput(
    createTicketSchema,
    defined({
      type: 'change',
      title: v.title,
      description: text(v.description),
      assignmentGroupId: v.assignmentGroup ?? undefined,
      assigneeId: v.assignee ?? undefined,
      change: defined(changePlan(v)),
    }),
    KEYS,
  );
  // A created change starts in `draft`, like one raised in the UI.
  const row = await services(ctx).tickets.create(input, auth, { channel: 'integration' });
  return typeof v.status === 'string'
    ? (await moveTo(ctx, auth, row, v.status as TicketStatus, {})).row
    : row;
}

async function updateChange(ctx: ModuleContext, auth: AuthContext, before: TicketRow, v: Values) {
  const s = services(ctx).tickets;
  // The plan first: once submitted for approval it is frozen (409 INVALID_STATE), as in the UI.
  const plan = changePlan(v);
  if (Object.keys(plan).length)
    await s.updateChange(before.id, parseInput(updateChangeSchema, plan, KEYS), auth);
  const patch = parseInput(
    updateTicketSchema,
    defined({
      title: v.title,
      description: text(v.description),
      assignmentGroupId: v.assignmentGroup,
      assigneeId: v.assignee,
    }),
    KEYS,
  );
  let row = Object.keys(patch).length
    ? await s.update(before.id, patch, auth)
    : await rowOf(ctx.db, before.id, 'change');
  if (typeof v.status === 'string') row = (await moveTo(ctx, auth, row, v.status as TicketStatus, {})).row;
  return row;
}

export const changeAdapter: SyncAdapter = {
  async fields(ctx): Promise<SyncFieldDef[]> {
    const groupList = await groupChoices(ctx.db);
    return [
      { key: 'title', label: label('title'), type: 'string', required: true, maxLength: 200 },
      { key: 'description', label: label('description'), type: 'markdown', maxLength: 20_000 },
      { key: 'status', label: label('status'), type: 'choice', choices: choices(CHANGE_STATUSES, 'status') },
      {
        key: 'changeType',
        label: label('changeType'),
        type: 'choice',
        choices: choices(['standard', 'normal', 'emergency'], 'changeType'),
      },
      {
        key: 'risk',
        label: label('risk'),
        type: 'choice',
        choices: choices(['low', 'medium', 'high'], 'risk'),
      },
      { key: 'reason', label: label('reason'), type: 'markdown', maxLength: 5_000 },
      { key: 'plannedStart', label: label('plannedStart'), type: 'datetime' },
      { key: 'plannedEnd', label: label('plannedEnd'), type: 'datetime' },
      {
        key: 'implementationPlan',
        label: label('implementationPlan'),
        type: 'markdown',
        maxLength: 20_000,
      },
      { key: 'backoutPlan', label: label('backoutPlan'), type: 'markdown', maxLength: 20_000 },
      { key: 'testPlan', label: label('testPlan'), type: 'markdown', maxLength: 20_000 },
      { key: 'assignmentGroup', label: label('assignmentGroup'), type: 'choice', choices: groupList },
      { key: 'assignee', label: label('assignee'), type: 'user' },
      { key: 'ref', label: label('ref'), type: 'string', readOnly: true },
    ];
  },

  async read(id, ctx) {
    if (!isUuid(id)) return null;
    const [row] = await selectChanges(ctx.db).where(and(eq(tickets.id, id), kindFilter('change')));
    return row ? changeRecord(row.t, row.c) : null;
  },

  async readMany(ids, ctx) {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    const rows = await selectChanges(ctx.db).where(and(inArray(tickets.id, valid), kindFilter('change')));
    return rows.map((r) => changeRecord(r.t, r.c));
  },

  async list(opts, ctx) {
    const limit = pageLimit(opts.limit);
    const rows = await ctx.db
      .select({ t: tickets, c: changes, cursorAt: cursorAt(tickets.updatedAt) })
      .from(tickets)
      .leftJoin(changes, eq(changes.ticketId, tickets.id))
      .where(and(kindFilter('change'), pageWhere(tickets.updatedAt, tickets.id, opts)))
      .orderBy(...pageOrder(tickets.updatedAt, tickets.id))
      .limit(limit + 1);
    const page = pageOf(
      rows.map((r) => ({ ...r, id: r.t.id })),
      limit,
    );
    return { items: page.rows.map((r) => changeRecord(r.t, r.c)), next: page.next };
  },

  write(input, opts, ctx) {
    return inSyncWrite(ctx, opts, async (bound) => {
      const v: Values = { ...input.values };
      const auth = writerAuth(opts.auth, CHANGE_WRITER);
      await assertActiveUsers(bound.db, [['assignee', v.assignee]]);
      return syncErrors(KEYS, async () => {
        if (!input.id) return { id: (await createChange(bound, auth, v)).id };
        const before = await rowOf(bound.db, input.id, 'change');
        await updateChange(bound, auth, before, v);
        return { id: before.id };
      });
    });
  },

  idFromEvent(event: DomainEvent) {
    const p = event.payload as { ticketId?: unknown; type?: unknown };
    return p.type === 'change' && isUuid(p.ticketId) ? p.ticketId : null;
  },

  comments: commentsOf('change', CHANGE_WRITER),
};

export const sync = { ticket: ticketAdapter, change: changeAdapter };
