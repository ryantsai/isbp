/**
 * Ticket business rules — shared by the REST routes, the AI tools, event handlers, jobs and the seed.
 * Every mutation runs in one transaction with its timeline entry, audit row, outbox events,
 * notifications and "My requests" / form-fulfilment updates.
 */
import { groupMembers, groups, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
  type NotificationParam,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import type { z } from 'zod';
import {
  type acceptanceSchema,
  type commentSchema,
  type confirmSchema,
  type createLinkSchema,
  type createTicketSchema,
  DESK_TYPES,
  type knownErrorArticleSchema,
  type LinkType,
  DONE_STATUSES,
  formatTicketRef,
  parseTicketRef,
  priorityFor,
  type reopenSchema,
  type ResolutionCode,
  SIGN_OFF_TYPES,
  type TICKET_SORT_KEYS,
  type TicketStatus,
  ticketStatusSchema,
  type TicketType,
  ticketTypeSchema,
  type ticketQuerySchema,
  type transitionSchema,
  type updateChangeSchema,
  type updateProblemSchema,
  type updateTicketSchema,
} from '../contracts';
import { canRead, canReadAsAgent, canWork, isAgent, viewerOf, visibilityFilter } from './access';
import { TicketReader, type TicketRow } from './dto';
import { categoryMap, peopleByIds } from './lookups';
import {
  canTransition,
  allowedTransitions,
  excerpt,
  fulfilmentState,
  isDone,
  isSymmetricLink,
  linkProblem,
  portalState,
  refOf,
  RESOLVING_STATUSES,
  requesterStatusKey,
  SOLVED_STATUSES,
  statusTone,
  ticketHref,
} from './rules';
import {
  changes,
  type ChangeType,
  type Channel,
  type ManualField,
  problems,
  type Risk,
  ticketActivities,
  type TicketAnswer,
  ticketCis,
  ticketLinks,
  tickets,
  type TicketSource,
  ticketSlas,
} from './schema';
import { SlaService } from './sla';
import { viaOf } from './sync-support';

type CreateTicketOutput = z.output<typeof createTicketSchema>;
/** A parsed create request; `ticketLinks` may be left out by internal callers. */
export type CreateTicketData = Omit<CreateTicketOutput, 'ticketLinks'> &
  Partial<Pick<CreateTicketOutput, 'ticketLinks'>>;
export type UpdateTicketData = z.output<typeof updateTicketSchema>;
export type TransitionData = z.output<typeof transitionSchema>;
export type TicketQueryData = z.output<typeof ticketQuerySchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEQUENCES: Record<TicketType, SQL> = {
  incident: sql`nextval('itsm.incident_number_seq')`,
  service_request: sql`nextval('itsm.service_request_number_seq')`,
  problem: sql`nextval('itsm.problem_number_seq')`,
  change: sql`nextval('itsm.change_number_seq')`,
};

const INITIAL_STATUS: Record<TicketType, TicketStatus> = {
  incident: 'new',
  service_request: 'new',
  problem: 'new',
  change: 'draft',
};

/** Who wrote a timeline entry: a person, an AI agent identity, a service or the system (all null). */
export interface Actor {
  authorId: string | null;
  authorName: string | null;
  authorAi: boolean;
}

export const SYSTEM_ACTOR: Actor = { authorId: null, authorName: null, authorAi: false };

export function actorOf(auth: AuthContext): Actor {
  if (auth.principal.type === 'ai_agent')
    return { authorId: null, authorName: auth.principal.name, authorAi: true };
  if (auth.user) return { authorId: auth.user.id, authorName: null, authorAi: false };
  return { authorId: null, authorName: auth.principal.name, authorAi: false };
}

/** Everything needed to insert a ticket (already validated). */
export interface NewTicket {
  type: TicketType;
  title: string;
  description: string;
  status?: TicketStatus;
  impact: number;
  urgency: number;
  priority?: number;
  categoryId: string | null;
  requesterId: string | null;
  requestedForId: string | null;
  departmentId: string | null;
  assignmentGroupId: string | null;
  assigneeId: string | null;
  channel: Channel;
  source?: TicketSource | null;
  answers?: TicketAnswer[] | null;
  major: boolean;
  attributes: Record<string, unknown>;
  manualFields: ManualField[];
  createdBy: string | null;
  createdAt?: Date;
  ciIds: string[];
  change?: {
    changeType: ChangeType;
    risk: Risk;
    reason: string;
    plannedStart: Date | null;
    plannedEnd: Date | null;
    implementationPlan: string;
    backoutPlan: string;
    testPlan: string;
  };
  problem?: { rootCause: string; workaround: string; knownError: boolean };
}

/** A knowledge article as a ticket names it. */
export interface KbArticleRef {
  id: string;
  reference: string;
  title: string;
}

export interface StatusOptions {
  actor: Actor;
  /** Person acting (excluded from notifications). */
  actorUserId?: string | null;
  note?: string;
  resolutionCode?: ResolutionCode | null;
  resolutionNotes?: string | null;
  now?: Date;
  /** Seed/back-fill: no events, audit or notifications. */
  quiet?: boolean;
  data?: Record<string, unknown>;
  /** Added to the audit entry's metadata. */
  metadata?: Record<string, unknown>;
}

const validation = (field: string, message: string) =>
  new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { fields: { [field]: message } });

export class TicketService {
  readonly sla: SlaService;
  readonly reader: TicketReader;

  constructor(private readonly ctx: ModuleContext) {
    this.sla = new SlaService(ctx);
    this.reader = new TicketReader(ctx, this.sla);
  }

  /* ───────────────────────────── lookup ───────────────────────────── */

  async findRow(ref: string, db: Db = this.ctx.db): Promise<TicketRow | null> {
    const value = ref.trim();
    if (UUID_RE.test(value)) {
      const [row] = await db.select().from(tickets).where(eq(tickets.id, value.toLowerCase()));
      return row ?? null;
    }
    const parsed = parseTicketRef(value);
    if (!parsed) return null;
    const [row] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.type, parsed.type), eq(tickets.number, parsed.number)));
    return row ?? null;
  }

  /** The ticket if the caller may see it — otherwise 404 (existence is not revealed). */
  async visibleRow(ref: string, auth: AuthContext): Promise<TicketRow> {
    const row = await this.findRow(ref);
    if (!row || !canRead(row, auth)) throw httpErrors.notFound('Ticket not found');
    return row;
  }

  async workableRow(ref: string, auth: AuthContext): Promise<TicketRow> {
    const row = await this.visibleRow(ref, auth);
    if (!canWork(row, auth)) throw httpErrors.forbidden('You cannot work this ticket');
    return row;
  }

  async detail(ref: string, auth: AuthContext) {
    return this.reader.detail(await this.visibleRow(ref, auth), auth);
  }

  async detailOf(id: string, auth: AuthContext) {
    const row = await this.findRow(id);
    if (!row) throw httpErrors.notFound('Ticket not found');
    return this.reader.detail(row, auth);
  }

  private async myGroupIds(userId: string | undefined): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.ctx.db
      .select({ id: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));
    return rows.map((r) => r.id);
  }

  private async groupMemberIds(groupId: string | null, limit = 50): Promise<string[]> {
    if (!groupId) return [];
    const rows = await this.ctx.db
      .select({ id: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, groupId), eq(users.status, 'active')))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /* ───────────────────────────── lists ───────────────────────────── */

  private static readonly SORTS: Record<(typeof TICKET_SORT_KEYS)[number], AnyColumn | SQL> = {
    slaDue: sql`(select min(${ticketSlas.dueAt}) from ${ticketSlas} where ${ticketSlas.ticketId} = ${tickets.id} and ${ticketSlas.status} in ('running', 'breached'))`,
    createdAt: tickets.createdAt,
    updatedAt: tickets.updatedAt,
    priority: tickets.priority,
    number: tickets.number,
    status: tickets.status,
    title: tickets.title,
    resolvedAt: tickets.resolvedAt,
    plannedStart: changes.plannedStart,
  };

  private statusFilter(value: string | undefined): SQL | undefined {
    if (!value) return undefined;
    if (value === 'open') return notInArray(tickets.status, [...DONE_STATUSES]);
    if (value === 'done') return inArray(tickets.status, [...DONE_STATUSES]);
    const list = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = list.map((s) => ticketStatusSchema.safeParse(s));
    if (parsed.some((p) => !p.success)) throw validation('status', `Unknown status in "${value}"`);
    return inArray(
      tickets.status,
      parsed.map((p) => p.data!),
    );
  }

  private typesOf(value: string): TicketType[] {
    const parsed = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ticketTypeSchema.safeParse(s));
    if (!parsed.length || parsed.some((p) => !p.success))
      throw validation('types', `Unknown ticket type in "${value}"`);
    return parsed.map((p) => p.data!);
  }

  /** Filters shared by the list and its count (tickets table only). */
  private async listWhere(q: TicketQueryData, auth: AuthContext): Promise<SQL | undefined> {
    const me = auth.user?.id;
    const conds: (SQL | undefined)[] = [visibilityFilter(auth)];
    if (q.view !== 'all' && q.view !== 'mine' && !auth.permissions.hasAny('itsm.tickets.read'))
      throw httpErrors.forbidden('Only agents have work queues');
    switch (q.view) {
      case 'mine':
        conds.push(me ? or(eq(tickets.requesterId, me), eq(tickets.requestedForId, me)) : sql`false`);
        break;
      case 'assigned':
        conds.push(me ? eq(tickets.assigneeId, me) : sql`false`);
        break;
      case 'groups':
      case 'unassigned': {
        const mine = await this.myGroupIds(me);
        conds.push(mine.length ? inArray(tickets.assignmentGroupId, mine) : sql`false`);
        if (q.view === 'unassigned') conds.push(isNull(tickets.assigneeId));
        break;
      }
    }
    if (q.type) conds.push(eq(tickets.type, q.type));
    else if (q.types) conds.push(inArray(tickets.type, this.typesOf(q.types)));
    conds.push(this.statusFilter(q.status));
    if (q.priority) conds.push(eq(tickets.priority, q.priority));
    if (q.categoryId) {
      const cats = await categoryMap(this.ctx.db);
      const ids = [...cats.values()]
        .filter((c) => c.id === q.categoryId || c.ancestors.some((a) => a.id === q.categoryId))
        .map((c) => c.id);
      conds.push(inArray(tickets.categoryId, ids.length ? ids : [q.categoryId]));
    }
    if (q.groupId) conds.push(eq(tickets.assignmentGroupId, q.groupId));
    if (q.assigneeId) conds.push(eq(tickets.assigneeId, q.assigneeId));
    if (q.requesterId)
      conds.push(or(eq(tickets.requesterId, q.requesterId), eq(tickets.requestedForId, q.requesterId)));
    if (q.ciId)
      conds.push(
        sql`exists (select 1 from ${ticketCis} where ${ticketCis.ticketId} = ${tickets.id} and ${ticketCis.ciId} = ${q.ciId})`,
      );
    if (q.sla) {
      conds.push(notInArray(tickets.status, [...DONE_STATUSES]));
      conds.push(
        q.sla === 'breached'
          ? breachedSql()
          : q.sla === 'at_risk'
            ? atRiskSql()
            : or(breachedSql(), atRiskSql()),
      );
    }
    if (q.major !== undefined) conds.push(eq(tickets.major, q.major));
    if (q.q) {
      const ref = parseTicketRef(q.q);
      conds.push(
        or(
          ilike(tickets.title, likePattern(q.q)),
          ref ? and(eq(tickets.type, ref.type), eq(tickets.number, ref.number)) : undefined,
        ),
      );
    }
    return and(...conds);
  }

  async list(q: TicketQueryData, auth: AuthContext) {
    const where = await this.listWhere(q, auth);
    const sortKey = (q.sort?.replace(/^-/, '') ?? 'createdAt') as keyof typeof TicketService.SORTS;
    const column = TicketService.SORTS[sortKey];
    if (!column) throw validation('sort', `Cannot sort by "${q.sort}"`);
    const direction = q.sort ? (q.sort.startsWith('-') ? desc : asc) : desc;
    const [rows, total] = await Promise.all([
      this.ctx.db
        .select({
          ticket: tickets,
          plannedStart: changes.plannedStart,
          plannedEnd: changes.plannedEnd,
          changeType: changes.changeType,
          risk: changes.risk,
        })
        .from(tickets)
        .leftJoin(changes, eq(changes.ticketId, tickets.id))
        .where(where)
        .orderBy(direction(column), desc(tickets.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.$count(tickets, where),
    ]);
    return { items: await this.reader.listItems(rows), total, page: q.page, pageSize: q.pageSize };
  }

  /** Counts for the agent views: open incidents and service requests (`queueCountsSchema`). */
  async queues(auth: AuthContext) {
    const me = auth.user?.id ?? null;
    const mine = await this.myGroupIds(me ?? undefined);
    const inMyGroups = mine.length ? inArray(tickets.assignmentGroupId, mine) : sql`false`;
    const count = (cond: SQL | undefined) =>
      sql<number>`count(*) filter (where ${cond ?? sql`true`})`.mapWith(Number);
    const [row] = await this.ctx.db
      .select({
        assigned: count(me ? eq(tickets.assigneeId, me) : sql`false`),
        groups: count(inMyGroups),
        unassigned: count(and(inMyGroups, isNull(tickets.assigneeId))),
        breached: count(breachedSql()),
        atRisk: count(atRiskSql()),
        attention: count(or(breachedSql(), atRiskSql())),
        mine: count(me ? or(eq(tickets.requesterId, me), eq(tickets.requestedForId, me)) : sql`false`),
        majorOpen: count(eq(tickets.major, true)),
        open: count(undefined),
      })
      .from(tickets)
      .where(
        and(
          notInArray(tickets.status, [...DONE_STATUSES, 'draft']),
          inArray(tickets.type, [...DESK_TYPES]),
          visibilityFilter(auth),
        ),
      );
    return row!;
  }

  /* ───────────────────────────── validation helpers ───────────────────────────── */

  private async assertCategory(id: string | null | undefined, type: TicketType) {
    if (!id) return null;
    const c = (await categoryMap(this.ctx.db)).get(id);
    if (!c) throw validation('categoryId', 'Unknown category');
    if (!c.ticketTypes.includes(type))
      throw validation('categoryId', `The category does not apply to ${type}`);
    return c;
  }

  private async assertGroup(id: string | null | undefined) {
    if (!id) return null;
    const [g] = await this.ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.id, id));
    if (!g) throw validation('assignmentGroupId', 'Unknown group');
    return g.id;
  }

  /** A person who can be named on a ticket (`activeOnly`: active accounts only, e.g. a new requester). */
  private async assertUser(id: string | null | undefined, field: string, activeOnly = false) {
    if (!id) return null;
    const [u] = await this.ctx.db
      .select({ id: users.id, status: users.status, departmentId: users.departmentId })
      .from(users)
      .where(eq(users.id, id));
    if (!u || u.status === 'offboarded' || (activeOnly && u.status !== 'active'))
      throw validation(field, 'Unknown or inactive person');
    return u;
  }

  private async assertCis(ids: readonly string[] | undefined) {
    const unique = [...new Set(ids ?? [])];
    if (!unique.length) return [];
    const rows = await this.ctx.db
      .select({ id: cis.id, criticality: cis.criticality })
      .from(cis)
      .where(inArray(cis.id, unique));
    if (rows.length !== unique.length) throw validation('ciIds', 'Unknown configuration item');
    return rows;
  }

  private async defaultGroupId(categoryDefault: string | null | undefined): Promise<string | null> {
    if (categoryDefault) return categoryDefault;
    const key = await this.ctx.settings.get<string>('defaultGroupKey');
    if (!key) return null;
    const [g] = await this.ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.key, key));
    return g?.id ?? null;
  }

  /* ───────────────────────────── create ───────────────────────────── */

  /**
   * Raises a ticket. Requesters set title, description, urgency, CIs and incident/request; agents
   * (`itsm.tickets.work` for the requester's department) set everything, including the requester.
   */
  async create(
    input: CreateTicketData,
    auth: AuthContext,
    /** `source`: the request behind a ticket a form's process action raises (unique: a retry finds it). */
    opts: { channel?: Channel; source?: TicketSource } = {},
  ): Promise<TicketRow> {
    const me = auth.user?.id ?? null;
    const type = input.type;
    const requesterId = input.requesterId ?? me;
    const requester = await this.assertUser(requesterId, 'requesterId');
    // A change raised by a service, and anything an integration brings in from someone ISBP doesn't know, may
    // have no requester (no person signed in).
    if (!requester && !((type === 'change' || opts.channel === 'integration') && !me))
      throw validation('requesterId', 'Who is this ticket for?');
    const agent = isAgent(auth, requester?.departmentId ?? null);
    if (requesterId !== me && !agent)
      throw httpErrors.forbidden('Only agents can raise tickets for someone else');

    if (type === 'change' && !(agent || auth.can('itsm.changes.manage')))
      throw httpErrors.forbidden('Raising changes needs the change permission');
    if (type === 'problem' && !(agent || auth.can('itsm.problems.manage')))
      throw httpErrors.forbidden('Raising problems needs the problem permission');
    const full = agent || type === 'change' || type === 'problem';

    const manual: ManualField[] = [];
    if (input.urgency) manual.push('urgency');
    let category = null;
    let groupId: string | null = null;
    let assigneeId: string | null = null;
    let requestedForId: string | null = null;
    let impact = 2;
    let attributes: Record<string, unknown> = {};
    if (full) {
      if (input.impact) {
        impact = input.impact;
        manual.push('impact');
      }
      category = await this.assertCategory(input.categoryId, type);
      if (category) manual.push('category');
      groupId = await this.assertGroup(input.assignmentGroupId);
      if (groupId) manual.push('group');
      assigneeId = (await this.assertUser(input.assigneeId, 'assigneeId'))?.id ?? null;
      if (assigneeId) manual.push('assignee');
      requestedForId = (await this.assertUser(input.requestedForId, 'requestedForId'))?.id ?? null;
      if (input.attributes) attributes = await this.ctx.fields.validate('itsm.ticket', input.attributes);
    }
    groupId ??= await this.defaultGroupId(category?.defaultGroupId);
    await this.assertCis(input.ciIds);
    const urgency = input.urgency ?? 2;
    const channel: Channel = opts.channel ?? (full ? (input.channel ?? 'agent') : 'portal');
    // Linked records must be visible to the caller (e.g. "Report a problem" from their own device).
    for (const link of input.links)
      if (!(await this.ctx.records.get(link, auth))) throw httpErrors.notFound('Linked record not found');
    // Tickets to link from the start (a problem created from its incidents): readable by the caller.
    const others = await Promise.all(
      (input.ticketLinks ?? []).map(async (l) => {
        const other = await this.findRow(l.target);
        if (!other || !canRead(other, auth)) throw httpErrors.notFound('Linked ticket not found');
        return { ...l, other };
      }),
    );

    return this.ctx.transaction(async (tx) => {
      const ticket = await this.insertTicket(
        tx,
        {
          type,
          title: input.title,
          description: input.description,
          impact,
          urgency,
          categoryId: category?.id ?? null,
          requesterId,
          requestedForId,
          departmentId: requester?.departmentId ?? null,
          assignmentGroupId: groupId,
          assigneeId,
          channel,
          source: opts.source,
          major: full && type === 'incident' ? Boolean(input.major) : false,
          attributes,
          manualFields: manual,
          createdBy: me,
          ciIds: input.ciIds,
          change:
            type === 'change'
              ? {
                  changeType: input.change?.changeType ?? 'normal',
                  risk: input.change?.risk ?? 'medium',
                  reason: input.change?.reason ?? '',
                  plannedStart: input.change?.plannedStart ?? null,
                  plannedEnd: input.change?.plannedEnd ?? null,
                  implementationPlan: input.change?.implementationPlan ?? '',
                  backoutPlan: input.change?.backoutPlan ?? '',
                  testPlan: input.change?.testPlan ?? '',
                }
              : undefined,
          problem: type === 'problem' ? { rootCause: '', workaround: '', knownError: false } : undefined,
        },
        actorOf(auth),
      );
      const self = { type: type === 'change' ? 'itsm.change' : 'itsm.ticket', id: ticket.id };
      for (const link of input.links) await this.ctx.records.link(self, link, { tx });
      const seen = new Set<string>();
      for (const { other, type: linkType, direction } of others) {
        if (seen.has(other.id)) continue;
        seen.add(other.id);
        const [source, target] = direction === 'incoming' ? [other, ticket] : [ticket, other];
        const problem = linkProblem(linkType, source.type, target.type);
        if (problem) throw new HttpError(409, ErrorCodes.RELATIONSHIP_INVALID, problem);
        await this.insertLink(tx, { source, target, type: linkType }, actorOf(auth), auth);
      }
      return ticket;
    });
  }

  /** Inserts a validated ticket with its details, SLAs, timeline, portal entry, audit, events and notifications. */
  async insertTicket(tx: Db, n: NewTicket, actor: Actor, opts: { quiet?: boolean } = {}): Promise<TicketRow> {
    const now = n.createdAt ?? new Date();
    if (n.change?.plannedStart && n.change.plannedEnd && n.change.plannedEnd <= n.change.plannedStart)
      throw validation('change.plannedEnd', 'The window must end after it starts');
    const [t] = await tx
      .insert(tickets)
      .values({
        type: n.type,
        number: SEQUENCES[n.type],
        title: n.title,
        description: n.description,
        status: n.status ?? INITIAL_STATUS[n.type],
        impact: n.impact,
        urgency: n.urgency,
        priority: n.priority ?? priorityFor(n.impact, n.urgency),
        priorityOverridden: n.priority !== undefined && n.priority !== priorityFor(n.impact, n.urgency),
        categoryId: n.categoryId,
        requesterId: n.requesterId,
        requestedForId: n.requestedForId,
        departmentId: n.departmentId,
        assignmentGroupId: n.assignmentGroupId,
        assigneeId: n.assigneeId,
        channel: n.channel,
        source: n.source ?? null,
        answers: n.answers ?? null,
        major: n.major,
        attributes: n.attributes,
        manualFields: n.manualFields,
        createdBy: n.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = t!;
    if (n.change) await tx.insert(changes).values({ ticketId: row.id, ...n.change });
    if (n.problem) await tx.insert(problems).values({ ticketId: row.id, ...n.problem });
    const ciIds = [...new Set(n.ciIds)];
    if (ciIds.length) await tx.insert(ticketCis).values(ciIds.map((ciId) => ({ ticketId: row.id, ciId })));
    await this.activity(tx, row.id, actor, {
      kind: 'system',
      public: true,
      data: {
        event: 'created',
        channel: n.channel,
        ...(n.requesterId && actor.authorId && n.requesterId !== actor.authorId
          ? { onBehalfOf: n.requesterId }
          : {}),
      },
      at: now,
    });
    await this.sla.attach(tx, row, now);
    await this.sync(tx, row);
    if (opts.quiet) return row;

    const reference = refOf(row);
    const ref = { ticketId: row.id, reference, type: row.type, title: row.title };
    await this.ctx.audit.record(
      {
        action: 'itsm.ticket.created',
        entityType: 'itsm.ticket',
        entityId: row.id,
        entityLabel: `${reference} ${row.title}`,
        metadata: { type: row.type, priority: row.priority, channel: row.channel },
      },
      { tx },
    );
    await this.ctx.events.publish('itsm.ticket.created', { ...ref, channel: row.channel }, { tx });
    if (row.assigneeId || row.assignmentGroupId)
      await this.ctx.events.publish(
        'itsm.ticket.assigned',
        { ...ref, assigneeId: row.assigneeId, groupId: row.assignmentGroupId },
        { tx },
      );
    if (row.type === 'incident' || row.type === 'service_request')
      await this.notify(tx, 'itsm.ticket.created', [row.requesterId, row.requestedForId], row, {}, null);
    if (row.assigneeId)
      await this.notify(
        tx,
        'itsm.ticket.assigned',
        [row.assigneeId],
        row,
        { priority: row.priority },
        actor.authorId,
      );
    if (row.major) await this.declareMajor(tx, row);
    return row;
  }

  /* ───────────────────────────── helpers ───────────────────────────── */

  async activity(
    tx: Db,
    ticketId: string,
    actor: Actor,
    a: {
      kind: (typeof ticketActivities.$inferInsert)['kind'];
      public: boolean;
      body?: string | null;
      data?: Record<string, unknown>;
      at?: Date;
    },
  ) {
    // Changes a sync makes say where they came from ("via ServiceDesk Plus #1234").
    const via = viaOf(this.ctx);
    const [row] = await tx
      .insert(ticketActivities)
      .values({
        ticketId,
        kind: a.kind,
        public: a.public,
        authorId: actor.authorId,
        authorName: actor.authorName,
        authorAi: actor.authorAi,
        body: a.body ?? null,
        data: via ? { ...a.data, via } : (a.data ?? {}),
        ...(a.at ? { createdAt: a.at } : {}),
      })
      .returning();
    return row!;
  }

  /** Notifies people about a ticket (never the person who caused it). */
  async notify(
    tx: Db,
    type: string,
    recipients: readonly (string | null | undefined)[],
    t: TicketRow,
    params: Record<string, NotificationParam>,
    exclude: string | null | undefined,
  ) {
    const list = [...new Set(recipients.filter((r): r is string => Boolean(r) && r !== exclude))];
    if (!list.length) return;
    const reference = refOf(t);
    await this.ctx.notifications.notify(
      {
        type,
        recipients: list,
        params: { reference, title: t.title, type: t.type, ...params },
        href: ticketHref(reference),
        data: { ticketId: t.id, reference },
      },
      { tx },
    );
  }

  private async declareMajor(tx: Db, t: TicketRow) {
    if (t.type !== 'incident' || !(await this.ctx.settings.get<boolean>('majorIncidentBroadcast'))) return;
    const reference = refOf(t);
    await this.ctx.notifications.broadcast(
      {
        type: 'itsm.major-incident.declared',
        params: { reference, title: t.title, description: excerpt(t.description, 400) },
        href: ticketHref(reference),
        data: { ticketId: t.id, reference },
      },
      { tx },
    );
  }

  /** Keeps "My requests" (or the form submission being fulfilled) in step with the ticket. */
  async sync(tx: Db, t: TicketRow) {
    const reference = refOf(t);
    if (t.source?.type === 'form-submission') {
      await this.ctx.forms.setFulfilment(
        t.source.id,
        {
          reference,
          href: ticketHref(reference),
          state: fulfilmentState(t.status),
          statusKey: requesterStatusKey(t),
          tone: statusTone(t.status),
        },
        { tx },
      );
      return;
    }
    if (t.type !== 'incident' && t.type !== 'service_request') return;
    await this.ctx.portal.track(
      {
        kind: 'itsm.ticket',
        id: t.id,
        reference,
        title: t.title,
        state: portalState(t.status),
        statusKey: requesterStatusKey(t),
        tone: statusTone(t.status),
        href: ticketHref(reference),
        icon: t.type === 'incident' ? 'life-buoy' : 'package',
        people: [t.requesterId, t.requestedForId],
        createdAt: t.createdAt,
      },
      { tx },
    );
  }

  private ref(t: TicketRow) {
    return { ticketId: t.id, reference: refOf(t), type: t.type, title: t.title };
  }

  /* ───────────────────────────── update ───────────────────────────── */

  /**
   * Edits fields. The new values are computed from the ticket as read; the write re-checks it under a row lock and,
   * when someone changed it in between (two people setting impact and urgency at once), starts over from the fresh
   * row — so the priority always follows the stored impact × urgency and nothing is lost.
   */
  async update(refOrId: string, input: UpdateTicketData, auth: AuthContext): Promise<TicketRow> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.updateOnce(refOrId, input, auth);
      } catch (err) {
        if (!(err instanceof StaleTicket) || attempt >= 4) throw err;
      }
    }
  }

  private async updateOnce(refOrId: string, input: UpdateTicketData, auth: AuthContext): Promise<TicketRow> {
    const before = await this.workableRow(refOrId, auth);
    const actor = actorOf(auth);
    const set: Partial<typeof tickets.$inferInsert> = {};
    const manual = new Set(before.manualFields);
    const changesLog: Record<string, [unknown, unknown]> = {};
    const note = (field: string, a: unknown, b: unknown) => {
      if (a !== b) changesLog[field] = [a, b];
    };

    if (input.title !== undefined) {
      set.title = input.title;
      note('title', before.title, input.title);
    }
    if (input.description !== undefined) {
      set.description = input.description;
      if (input.description !== before.description) changesLog.description = ['…', '…'];
    }
    const impact = input.impact ?? before.impact;
    const urgency = input.urgency ?? before.urgency;
    if (input.impact !== undefined) {
      set.impact = input.impact;
      manual.add('impact');
      note('impact', before.impact, input.impact);
    }
    if (input.urgency !== undefined) {
      set.urgency = input.urgency;
      manual.add('urgency');
      note('urgency', before.urgency, input.urgency);
    }
    let priority = before.priority;
    let overridden = before.priorityOverridden;
    if (input.priority !== undefined) {
      overridden = input.priority !== null;
      priority = input.priority ?? priorityFor(impact, urgency);
      if (overridden) manual.add('priority');
      else manual.delete('priority');
    } else if (!before.priorityOverridden) {
      priority = priorityFor(impact, urgency);
    }
    if (priority !== before.priority || overridden !== before.priorityOverridden) {
      set.priority = priority;
      set.priorityOverridden = overridden;
      note('priority', before.priority, priority);
    }
    if (input.categoryId !== undefined) {
      await this.assertCategory(input.categoryId, before.type);
      set.categoryId = input.categoryId;
      manual.add('category');
      note('categoryId', before.categoryId, input.categoryId);
    }
    let groupId = before.assignmentGroupId;
    let assigneeId = before.assigneeId;
    if (input.assignmentGroupId !== undefined) {
      groupId = await this.assertGroup(input.assignmentGroupId);
      manual.add('group');
      if (groupId !== before.assignmentGroupId && input.assigneeId === undefined && assigneeId) {
        // Moving to another group drops an assignee who is not in it.
        const members = await this.groupMemberIds(groupId, 10_000);
        if (!members.includes(assigneeId)) assigneeId = null;
      }
    }
    if (input.assigneeId !== undefined) {
      assigneeId = (await this.assertUser(input.assigneeId, 'assigneeId'))?.id ?? null;
      manual.add('assignee');
    }
    const assignmentChanged = groupId !== before.assignmentGroupId || assigneeId !== before.assigneeId;
    if (assignmentChanged) {
      set.assignmentGroupId = groupId;
      set.assigneeId = assigneeId;
    }
    if (input.requestedForId !== undefined) {
      set.requestedForId = (await this.assertUser(input.requestedForId, 'requestedForId'))?.id ?? null;
      note('requestedForId', before.requestedForId, set.requestedForId);
    }
    if (input.requesterId !== undefined && input.requesterId !== before.requesterId) {
      // Correcting who reported it. The department (permission scope) stays the original one, so the
      // ticket never drops out of the reach of the agents already working it.
      set.requesterId = (await this.assertUser(input.requesterId, 'requesterId', true))!.id;
      note('requesterId', before.requesterId, set.requesterId);
    }
    if (input.major !== undefined && before.type === 'incident') {
      set.major = input.major;
      note('major', before.major, input.major);
    }
    if (input.attributes !== undefined) {
      set.attributes = await this.ctx.fields.validate('itsm.ticket', input.attributes, before.attributes);
      if (JSON.stringify(set.attributes) !== JSON.stringify(before.attributes))
        changesLog.attributes = ['…', '…'];
    }
    let ciChange: { added: string[]; removed: string[] } | null = null;
    if (input.ciIds !== undefined) {
      await this.assertCis(input.ciIds);
      const current = (
        await this.ctx.db
          .select({ id: ticketCis.ciId })
          .from(ticketCis)
          .where(eq(ticketCis.ticketId, before.id))
      ).map((r) => r.id);
      const next = [...new Set(input.ciIds)];
      const added = next.filter((id) => !current.includes(id));
      const removed = current.filter((id) => !next.includes(id));
      if (added.length || removed.length) {
        ciChange = { added, removed };
        changesLog.cis = [current.length, next.length];
      }
    }
    if (!Object.keys(changesLog).length && !assignmentChanged && !ciChange) return before;
    set.manualFields = [...manual];

    return this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(tickets).where(eq(tickets.id, before.id)).for('update');
      if (!locked || !sameEditableState(locked, before)) throw new StaleTicket();
      const [after] = await tx.update(tickets).set(set).where(eq(tickets.id, before.id)).returning();
      const t = after!;
      if (ciChange) {
        if (ciChange.removed.length)
          await tx
            .delete(ticketCis)
            .where(and(eq(ticketCis.ticketId, t.id), inArray(ticketCis.ciId, ciChange.removed)));
        if (ciChange.added.length)
          await tx
            .insert(ticketCis)
            .values(ciChange.added.map((ciId) => ({ ticketId: t.id, ciId })))
            .onConflictDoNothing();
      }
      const fieldChanges = Object.fromEntries(Object.entries(changesLog));
      if (Object.keys(fieldChanges).length)
        await this.activity(tx, t.id, actor, {
          kind: 'field',
          public: false,
          data: {
            changes: fieldChanges,
            ...(input.priority !== undefined ? { priorityOverride: input.priority !== null } : {}),
            ...(ciChange ? { cis: ciChange } : {}),
          },
        });
      if (assignmentChanged) await this.recordAssignment(tx, before, t, actor, auth.user?.id ?? null);
      if (t.priority !== before.priority) await this.sla.retarget(tx, t.id, t.priority);
      if (t.major && !before.major) await this.declareMajor(tx, t);
      // "My requests" follows the title and the people (requester, requested-for).
      if (
        t.title !== before.title ||
        t.requesterId !== before.requesterId ||
        t.requestedForId !== before.requestedForId
      )
        await this.sync(tx, t);
      await this.ctx.audit.record(
        {
          action: 'itsm.ticket.updated',
          entityType: 'itsm.ticket',
          entityId: t.id,
          entityLabel: `${refOf(t)} ${t.title}`,
          changes: {
            ...changesLog,
            ...(assignmentChanged
              ? {
                  assignmentGroupId: [before.assignmentGroupId, t.assignmentGroupId],
                  assigneeId: [before.assigneeId, t.assigneeId],
                }
              : {}),
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itsm.ticket.updated',
        {
          ...this.ref(t),
          changes: [...Object.keys(changesLog), ...(assignmentChanged ? ['assignment'] : [])],
        },
        { tx },
      );
      return t;
    });
  }

  private async recordAssignment(
    tx: Db,
    before: TicketRow,
    t: TicketRow,
    actor: Actor,
    actorUserId: string | null,
  ) {
    await this.activity(tx, t.id, actor, {
      kind: 'assignment',
      public: false,
      data: {
        from: { groupId: before.assignmentGroupId, assigneeId: before.assigneeId },
        to: { groupId: t.assignmentGroupId, assigneeId: t.assigneeId },
      },
    });
    await this.ctx.events.publish(
      'itsm.ticket.assigned',
      { ...this.ref(t), assigneeId: t.assigneeId, groupId: t.assignmentGroupId },
      { tx },
    );
    if (t.assigneeId && t.assigneeId !== before.assigneeId)
      await this.notify(tx, 'itsm.ticket.assigned', [t.assigneeId], t, { priority: t.priority }, actorUserId);
  }

  async assignToMe(refOrId: string, auth: AuthContext) {
    const me = auth.user?.id;
    if (!me) throw httpErrors.forbidden('Only people can take tickets');
    return this.update(refOrId, { assigneeId: me }, auth);
  }

  /* ───────────────────────────── status ───────────────────────────── */

  async transition(refOrId: string, input: TransitionData, auth: AuthContext): Promise<TicketRow> {
    const t = await this.workableRow(refOrId, auth);
    const to = input.status;
    const signingOff = Boolean(t.signOffInstanceId);
    if (!canTransition(t.type, t.status, to, signingOff))
      throw new HttpError(
        409,
        ErrorCodes.INVALID_TRANSITION,
        `A ${t.type} cannot move from ${t.status} to ${to}`,
        {
          from: t.status,
          to,
          allowed: allowedTransitions(t.type, t.status, signingOff),
        },
      );
    if (RESOLVING_STATUSES.includes(to) && (!input.resolutionCode || !input.resolutionNotes))
      throw new HttpError(400, ErrorCodes.RESOLUTION_REQUIRED, 'Give a resolution code and notes', {
        fields: {
          ...(input.resolutionCode ? {} : { resolutionCode: 'required' }),
          ...(input.resolutionNotes ? {} : { resolutionNotes: 'required' }),
        },
      });
    const actor = actorOf(auth);
    const me = auth.user?.id ?? null;
    if (t.type === 'change' && (t.status === 'assessment' || t.status === 'draft') && to === 'authorization')
      return this.submitChange(t, actor, me, input.note);
    // The article that solved it: checked as the caller, linked to the ticket with the resolution.
    const article =
      input.articleId && SOLVED_STATUSES.includes(to)
        ? await this.kbArticle(input.articleId, auth, 'articleId')
        : null;
    // Resolving may need a sign-off first (`itsm.resolution`, when a workflow is bound).
    if (SOLVED_STATUSES.includes(to) && SIGN_OFF_TYPES.includes(t.type))
      return this.resolveWithSignOff(t, to, input, actor, me, article);
    const acceptance =
      t.type === 'change' && t.status === 'review' && to === 'closed'
        ? await this.acceptanceToClose(t)
        : null;
    return this.ctx.transaction(async (tx) => {
      await this.lockAsRead(tx, t, to);
      if (signingOff) {
        // Withdrawn (back to work) or cancelled while waiting for the sign-off: the sign-off ends with it.
        await this.ctx.workflows.cancel(t.signOffInstanceId!, 'The resolution was withdrawn', { tx });
        await tx
          .update(tickets)
          .set({
            signOffInstanceId: null,
            ...(to === 'in_progress' ? { resolutionCode: null, resolutionNotes: null } : {}),
          })
          .where(eq(tickets.id, t.id));
      }
      const after = await this.applyStatus(tx, signingOff ? { ...t, signOffInstanceId: null } : t, to, {
        actor,
        actorUserId: me,
        note: input.note,
        resolutionCode: input.resolutionCode ?? null,
        resolutionNotes: input.resolutionNotes ?? null,
        ...(signingOff ? { data: { signOff: 'withdrawn' } } : {}),
        ...(acceptance ? { data: { accepted: acceptance.accepted }, metadata: acceptance } : {}),
        ...(article ? { data: { article } } : {}),
      });
      if (article) await this.linkArticle(tx, t, article);
      if (t.type === 'change' && t.status === 'authorization' && to === 'cancelled') {
        const [c] = await tx.select().from(changes).where(eq(changes.ticketId, t.id));
        if (c?.approvalInstanceId)
          await this.ctx.workflows.cancel(c.approvalInstanceId, 'The change was cancelled', { tx });
      }
      // "Start implementation" on a change nobody owns: the person starting it owns it from now on.
      if (t.type === 'change' && to === 'implementing' && !after.assigneeId && me) {
        const [owned] = await tx
          .update(tickets)
          .set({ assigneeId: me, updatedAt: new Date() })
          .where(eq(tickets.id, t.id))
          .returning();
        await this.recordAssignment(tx, after, owned!, actor, me);
        return owned!;
      }
      // Post-implementation review: the requester is asked to accept the change.
      if (t.type === 'change' && to === 'review')
        await this.notify(
          tx,
          'itsm.change.acceptance_requested',
          [after.requesterId, after.requestedForId],
          after,
          {},
          me,
        );
      return after;
    });
  }

  /**
   * Locks the ticket for this transaction and checks it is still as `t` was read (status and sign-off): the read
   * happened outside, so two people (or a person and a sync) acting at once would otherwise both pass the checks.
   */
  private async lockAsRead(tx: Db, t: TicketRow, to: TicketStatus): Promise<TicketRow> {
    const [row] = await tx.select().from(tickets).where(eq(tickets.id, t.id)).for('update');
    if (!row || row.status !== t.status || (row.signOffInstanceId ?? null) !== (t.signOffInstanceId ?? null))
      throw this.staleTransition(row ?? t, to);
    return row;
  }

  private staleTransition(t: TicketRow, to: TicketStatus) {
    return new HttpError(409, ErrorCodes.INVALID_TRANSITION, 'Someone changed this ticket in the meantime', {
      from: t.status,
      to,
      reason: 'changed',
    });
  }

  /* ───────────────────────────── resolution sign-off ───────────────────────────── */

  /** Facts the `itsm.resolution` workflow decides on (manifest `resolutionFacts`), with the custom fields. */
  private async resolutionFacts(t: TicketRow, resolutionCode: ResolutionCode) {
    const [category, group, ciRows] = await Promise.all([
      t.categoryId ? categoryMap(this.ctx.db).then((m) => m.get(t.categoryId!) ?? null) : null,
      t.assignmentGroupId
        ? this.ctx.db.select({ key: groups.key }).from(groups).where(eq(groups.id, t.assignmentGroupId))
        : Promise.resolve([]),
      this.ctx.db
        .select({ criticality: cis.criticality })
        .from(ticketCis)
        .innerJoin(cis, eq(cis.id, ticketCis.ciId))
        .where(eq(ticketCis.ticketId, t.id)),
    ]);
    const order = ['critical', 'high', 'medium', 'low'] as const;
    const highest = order.find((c) => ciRows.some((r) => r.criticality === c)) ?? null;
    return {
      ...(await this.ctx.fields.facts('itsm.ticket', t.attributes)),
      ticket: {
        type: t.type,
        category: category?.key ?? null,
        priority: t.priority,
        impact: t.impact,
        urgency: t.urgency,
        major: t.major,
        groupKey: group[0]?.key ?? null,
        resolutionCode,
        ciCount: ciRows.length,
        ciCriticality: highest,
        criticalCis: highest === 'critical',
      },
    };
  }

  /**
   * Resolving (or fulfilling) a ticket: when a workflow is bound to `itsm.resolution` and asks someone, the ticket
   * waits for the sign-off (`pending_approval`, "Waiting for sign-off") with its resolution kept; otherwise it is
   * resolved at once. The person resolving is the workflow's requester (so "their manager" signs off).
   */
  private async resolveWithSignOff(
    t: TicketRow,
    to: TicketStatus,
    input: TransitionData,
    actor: Actor,
    me: string | null,
    article: KbArticleRef | null = null,
  ): Promise<TicketRow> {
    const code = input.resolutionCode!;
    const facts = await this.resolutionFacts(t, code);
    const reference = refOf(t);
    return this.ctx.transaction(async (tx) => {
      await this.lockAsRead(tx, t, to);
      const started = await this.ctx.workflows.start(
        'itsm.resolution',
        {
          subject: {
            type: 'ticket',
            id: t.id,
            label: `${reference} · ${t.title}`,
            href: ticketHref(reference),
          },
          facts,
          requesterId: me,
        },
        { tx },
      );
      const options: StatusOptions = {
        actor,
        actorUserId: me,
        note: input.note,
        resolutionCode: code,
        resolutionNotes: input.resolutionNotes ?? null,
        ...(article ? { data: { article } } : {}),
      };
      if (article) await this.linkArticle(tx, t, article);
      if (!started || started.status === 'approved') return this.applyStatus(tx, t, to, options);
      if (started.status === 'rejected') {
        // Nobody could sign off and the workflow declines: the ticket stays as it is.
        await this.activity(tx, t.id, SYSTEM_ACTOR, {
          kind: 'approval',
          public: false,
          data: { event: 'rejected', signOff: true, instanceId: started.instanceId },
        });
        return t;
      }
      const [held] = await tx
        .update(tickets)
        .set({
          signOffInstanceId: started.instanceId,
          resolutionCode: code,
          resolutionNotes: input.resolutionNotes ?? null,
        })
        .where(eq(tickets.id, t.id))
        .returning();
      await this.activity(tx, t.id, SYSTEM_ACTOR, {
        kind: 'approval',
        public: false,
        data: { event: 'started', signOff: true, instanceId: started.instanceId, to },
      });
      const row = await this.applyStatus(tx, held!, 'pending_approval', {
        actor,
        actorUserId: me,
        note: input.note,
        data: { signOff: 'requested', to, resolutionCode: code },
      });
      await this.ctx.events.publish(
        'itsm.ticket.sign_off_requested',
        { ...this.ref(row), instanceId: started.instanceId, to },
        { tx },
      );
      return row;
    });
  }

  /**
   * The sign-off finished (outbox, at-least-once): approved → resolved / fulfilled with the kept resolution;
   * rejected → back to in progress with the reason (the resolver and the assignee are told); withdrawn → nothing.
   */
  async onResolutionCompleted(result: WorkflowCompletion) {
    await this.ctx.transaction(async (tx) => {
      const [t] = await tx.select().from(tickets).where(eq(tickets.id, result.subjectId)).for('update');
      if (!t || t.signOffInstanceId !== result.instanceId || t.status !== 'pending_approval') return;
      const resolver: Actor = result.requesterId
        ? { authorId: result.requesterId, authorName: null, authorAi: false }
        : SYSTEM_ACTOR;
      await this.activity(tx, t.id, SYSTEM_ACTOR, {
        kind: 'approval',
        public: false,
        body: result.comment,
        data: {
          event: result.outcome,
          signOff: true,
          instanceId: result.instanceId,
          ...(result.decidedBy ? { decidedBy: result.decidedBy } : {}),
        },
      });
      if (result.outcome === 'approved') {
        const [row] = await tx
          .update(tickets)
          .set({ signOffInstanceId: null })
          .where(eq(tickets.id, t.id))
          .returning();
        await this.applyStatus(tx, row!, t.type === 'service_request' ? 'fulfilled' : 'resolved', {
          actor: resolver,
          actorUserId: result.requesterId,
          resolutionCode: t.resolutionCode,
          resolutionNotes: t.resolutionNotes,
          data: { signOff: 'approved' },
          metadata: { signOff: { instanceId: result.instanceId, decidedBy: result.decidedBy ?? null } },
        });
        return;
      }
      const [row] = await tx
        .update(tickets)
        .set({ signOffInstanceId: null, resolutionCode: null, resolutionNotes: null })
        .where(eq(tickets.id, t.id))
        .returning();
      const after = await this.applyStatus(tx, row!, 'in_progress', {
        actor: SYSTEM_ACTOR,
        data: { signOff: result.outcome },
        metadata: { signOff: { instanceId: result.instanceId, outcome: result.outcome } },
      });
      if (result.outcome === 'rejected')
        await this.notify(
          tx,
          'itsm.ticket.sign_off_rejected',
          [result.requesterId, after.assigneeId],
          after,
          { reason: result.comment ?? '', name: result.decidedBy?.name ?? '' },
          null,
        );
    });
  }

  /* ───────────────────────────── change acceptance ───────────────────────────── */

  /**
   * Closing a change in review records whether its requester accepted it; with the setting "require the requester's
   * acceptance" a change that has a requester closes only once they accepted it.
   */
  private async acceptanceToClose(t: TicketRow) {
    const [c] = await this.ctx.db.select().from(changes).where(eq(changes.ticketId, t.id));
    const accepted = c?.acceptance === 'accepted' ? true : c?.acceptance === 'problem' ? false : null;
    const hasRequester = Boolean(t.requesterId || t.requestedForId);
    if (
      hasRequester &&
      accepted !== true &&
      (await this.ctx.settings.get<boolean>('changes.requireAcceptance'))
    )
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The requester has not accepted the change yet', {
        reason: 'acceptance_required',
        acceptance: c?.acceptance ?? null,
      });
    return { accepted, acceptanceNote: c?.acceptanceNote ?? null };
  }

  /**
   * The change's requester, in the post-implementation review: "Accept the change", or "Report a problem" with the
   * reason. Recorded on the change (the latest verdict counts) and in the conversation; the implementer is told.
   */
  async accept(refOrId: string, input: z.output<typeof acceptanceSchema>, auth: AuthContext) {
    const t = await this.visibleRow(refOrId, auth);
    if (t.type !== 'change')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This ticket is not a change');
    if (t.status !== 'review')
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        'A change is accepted in its post-implementation review',
        {
          status: t.status,
        },
      );
    if (!viewerOf(t, auth).canAccept) throw httpErrors.forbidden('Only the change’s requester can accept it');
    const me = auth.user!.id;
    const actor = actorOf(auth);
    const verdict = input.accepted ? 'accepted' : 'problem';
    const note = input.note?.trim() || null;
    return this.ctx.transaction(async (tx) => {
      await this.lockAsRead(tx, t, 'review');
      const [before] = await tx.select().from(changes).where(eq(changes.ticketId, t.id)).for('update');
      await tx
        .insert(changes)
        .values({
          ticketId: t.id,
          acceptance: verdict,
          acceptanceNote: note,
          acceptanceAt: new Date(),
          acceptanceBy: me,
        })
        .onConflictDoUpdate({
          target: changes.ticketId,
          set: { acceptance: verdict, acceptanceNote: note, acceptanceAt: new Date(), acceptanceBy: me },
        });
      await this.activity(tx, t.id, actor, {
        kind: 'comment',
        public: true,
        body: note,
        data: { acceptance: verdict },
      });
      const [row] = await tx
        .update(tickets)
        .set({ updatedAt: new Date() })
        .where(eq(tickets.id, t.id))
        .returning();
      await this.ctx.audit.record(
        {
          action: input.accepted ? 'itsm.change.accepted' : 'itsm.change.problem_reported',
          entityType: 'itsm.ticket',
          entityId: t.id,
          entityLabel: `${refOf(t)} ${t.title}`,
          changes: { acceptance: [before?.acceptance ?? null, verdict] },
          metadata: { note },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itsm.change.acceptance_recorded',
        { ...this.ref(t), accepted: input.accepted },
        { tx },
      );
      const name = (await peopleByIds(tx, [me])).get(me)?.displayName ?? '';
      const recipients = row!.assigneeId
        ? [row!.assigneeId, row!.createdBy]
        : [...(await this.groupMemberIds(row!.assignmentGroupId)), row!.createdBy];
      await this.notify(
        tx,
        input.accepted ? 'itsm.change.accepted' : 'itsm.change.problem_reported',
        recipients,
        row!,
        { name, reason: note ? excerpt(note) : '' },
        me,
      );
      return row!;
    });
  }

  /**
   * Moves a ticket to `to` (already validated) with every side effect: timestamps, SLA timers, the
   * timeline, "My requests"/fulfilment, audit, events and the requester's notification.
   */
  async applyStatus(tx: Db, t: TicketRow, to: TicketStatus, o: StatusOptions): Promise<TicketRow> {
    const now = o.now ?? new Date();
    const from = t.status;
    const solved = SOLVED_STATUSES.includes(to);
    const reopened = SOLVED_STATUSES.includes(from) && !isDone(to);
    const set: Partial<typeof tickets.$inferInsert> = { status: to, updatedAt: now };
    if (RESOLVING_STATUSES.includes(to)) {
      set.resolutionCode = o.resolutionCode ?? t.resolutionCode;
      set.resolutionNotes = o.resolutionNotes ?? t.resolutionNotes;
    }
    if (solved) set.resolvedAt = now;
    if (to === 'closed' || to === 'cancelled' || to === 'rejected') set.closedAt = now;
    if (to === 'closed' && !t.resolvedAt && t.type !== 'change') set.resolvedAt = now;
    if (reopened) {
      set.resolvedAt = null;
      set.closedAt = null;
      set.resolutionCode = null;
      set.resolutionNotes = null;
    }
    if (to === 'in_progress' && !t.firstResponseAt) set.firstResponseAt = now;
    if (solved && !t.firstResponseAt) set.firstResponseAt = now;
    // Only from the status the caller decided on: a concurrent change in between makes this a conflict (409), not a
    // second "new → resolved" (the whole transaction rolls back).
    const [after] = await tx
      .update(tickets)
      .set(set)
      .where(and(eq(tickets.id, t.id), eq(tickets.status, from)))
      .returning();
    if (!after) throw this.staleTransition(t, to);
    const row = after;

    await this.sla.onStatusChange(tx, t.id, from, to, now);
    if (
      row.type === 'problem' &&
      (to === 'known_error' || (from === 'known_error' && to === 'investigating'))
    )
      await tx
        .insert(problems)
        .values({ ticketId: t.id, knownError: to === 'known_error' })
        .onConflictDoUpdate({ target: problems.ticketId, set: { knownError: to === 'known_error' } });

    const resolving = RESOLVING_STATUSES.includes(to);
    await this.activity(tx, t.id, o.actor, {
      kind: 'status',
      public: true,
      body: resolving ? (o.resolutionNotes ?? null) : null,
      data: {
        from,
        to,
        ...(resolving && o.resolutionCode ? { resolutionCode: o.resolutionCode } : {}),
        ...o.data,
      },
      at: now,
    });
    if (o.note)
      await this.activity(tx, t.id, o.actor, {
        kind: solved ? 'comment' : 'work_note',
        public: solved,
        body: o.note,
        at: now,
      });
    await this.sync(tx, row);
    if (o.quiet) return row;

    const ref = this.ref(row);
    await this.ctx.audit.record(
      {
        action: 'itsm.ticket.status_changed',
        entityType: 'itsm.ticket',
        entityId: row.id,
        entityLabel: `${ref.reference} ${row.title}`,
        changes: { status: [from, to] },
        metadata:
          resolving || o.metadata
            ? { ...(resolving ? { resolutionCode: o.resolutionCode } : {}), ...o.metadata }
            : undefined,
      },
      { tx },
    );
    await this.ctx.events.publish('itsm.ticket.status_changed', { ...ref, from, to }, { tx });
    if (solved)
      await this.ctx.events.publish(
        'itsm.ticket.resolved',
        { ...ref, resolutionCode: row.resolutionCode ?? null },
        { tx },
      );
    if (to === 'closed') await this.ctx.events.publish('itsm.ticket.closed', ref, { tx });
    if (row.type === 'problem' && to === 'known_error')
      await this.ctx.events.publish('itsm.problem.known_error', ref, { tx });
    if (reopened) await this.ctx.events.publish('itsm.ticket.reopened', ref, { tx });
    if (solved && (row.type === 'incident' || row.type === 'service_request'))
      await this.notify(
        tx,
        'itsm.ticket.resolved',
        [row.requesterId, row.requestedForId],
        row,
        { status: to, notes: row.resolutionNotes ?? '' },
        o.actorUserId,
      );
    return row;
  }

  /* ───────────────────────────── conversation ───────────────────────────── */

  /**
   * Adds a public reply or an internal work note. `opts.author` is a person from another system (a sync
   * copying their comment): they are named on the entry, and count as the requester when their email is
   * the requester's. `opts.at` keeps the time they wrote it.
   */
  async comment(
    refOrId: string,
    input: z.output<typeof commentSchema>,
    auth: AuthContext,
    opts: { author?: { name: string; email?: string | null }; at?: Date } = {},
  ) {
    const t = await this.visibleRow(refOrId, auth);
    const viewer = viewerOf(t, auth);
    if (input.public ? !viewer.canComment : !viewer.canWorkNote)
      throw httpErrors.forbidden(
        input.public ? 'You cannot comment on this ticket' : 'Work notes are for agents',
      );
    const remote = opts.author;
    const actor: Actor = remote
      ? { authorId: null, authorName: remote.name, authorAi: false }
      : actorOf(auth);
    const me = remote ? null : (auth.user?.id ?? null);
    const now = new Date();
    const at = opts.at && opts.at < now ? opts.at : now;
    const remoteRequester = remote?.email ? await this.isRequesterEmail(t, remote.email) : false;
    const fromRequester = remote
      ? remoteRequester
      : Boolean(me && (me === t.requesterId || me === t.requestedForId)) && !viewer.canEdit;
    const author = me ? (await peopleByIds(this.ctx.db, [me])).get(me)?.displayName : actor.authorName;
    const activity = await this.ctx.transaction(async (tx) => {
      const a = await this.activity(tx, t.id, actor, {
        kind: input.public ? 'comment' : 'work_note',
        public: input.public,
        body: input.body,
        data: remote ? { author: { name: remote.name, email: remote.email ?? null } } : undefined,
        at,
      });
      const set: Partial<typeof tickets.$inferInsert> = { updatedAt: now };
      // First response: a public reply from someone other than the requester.
      const responder = input.public && (remote ? !remoteRequester : me ? me !== t.requesterId : true);
      if (responder && !t.firstResponseAt) {
        set.firstResponseAt = now;
        await this.sla.meetResponse(tx, t.id, now);
      }
      await tx.update(tickets).set(set).where(eq(tickets.id, t.id));
      await this.ctx.events.publish(
        'itsm.ticket.commented',
        { ...this.ref(t), public: input.public },
        { tx },
      );
      if (input.public) {
        const params = { author: author ?? '', excerpt: excerpt(input.body) };
        if (fromRequester) {
          const recipients = t.assigneeId ? [t.assigneeId] : await this.groupMemberIds(t.assignmentGroupId);
          await this.notify(tx, 'itsm.ticket.commented', recipients, t, params, me);
        } else {
          await this.notify(tx, 'itsm.ticket.commented', [t.requesterId, t.requestedForId], t, params, me);
        }
      }
      return a;
    });
    return (await this.reader.activityDtos([activity]))[0]!;
  }

  /** Whether `email` belongs to the ticket's requester (or the person it was requested for). */
  private async isRequesterEmail(t: TicketRow, email: string): Promise<boolean> {
    const ids = [t.requesterId, t.requestedForId].filter((x): x is string => Boolean(x));
    if (!ids.length) return false;
    const [hit] = await this.ctx.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), sql`lower(${users.email}) = lower(${email})`))
      .limit(1);
    return Boolean(hit);
  }

  /**
   * Sets the resolution code and notes without a status change — an integration keeping them in step
   * with another system. Resolving still needs both (`transition`); reopening clears them.
   */
  async setResolution(
    refOrId: string,
    input: { resolutionCode?: ResolutionCode | null; resolutionNotes?: string | null },
    auth: AuthContext,
  ): Promise<TicketRow> {
    const before = await this.workableRow(refOrId, auth);
    const set: Partial<typeof tickets.$inferInsert> = {};
    const changesLog: Record<string, [unknown, unknown]> = {};
    if (input.resolutionCode !== undefined && input.resolutionCode !== before.resolutionCode) {
      set.resolutionCode = input.resolutionCode;
      changesLog.resolutionCode = [before.resolutionCode, input.resolutionCode];
    }
    const notes = input.resolutionNotes?.trim() || null;
    if (input.resolutionNotes !== undefined && notes !== before.resolutionNotes) {
      set.resolutionNotes = notes;
      changesLog.resolutionNotes = ['…', '…'];
    }
    if (!Object.keys(changesLog).length) return before;
    return this.ctx.transaction(async (tx) => {
      const [after] = await tx.update(tickets).set(set).where(eq(tickets.id, before.id)).returning();
      const t = after!;
      await this.activity(tx, t.id, actorOf(auth), {
        kind: 'field',
        public: false,
        data: { changes: changesLog },
      });
      await this.ctx.audit.record(
        {
          action: 'itsm.ticket.updated',
          entityType: 'itsm.ticket',
          entityId: t.id,
          entityLabel: `${refOf(t)} ${t.title}`,
          changes: changesLog,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itsm.ticket.updated',
        { ...this.ref(t), changes: Object.keys(changesLog) },
        { tx },
      );
      return t;
    });
  }

  async activities(
    refOrId: string,
    q: { page: number; pageSize: number; order: 'asc' | 'desc' },
    auth: AuthContext,
  ) {
    const t = await this.visibleRow(refOrId, auth);
    return this.reader.activities(t.id, { ...q, publicOnly: !canReadAsAgent(t, auth) });
  }

  /** Requester: "it's still broken" — back to work, with the reason in the conversation. */
  async reopen(refOrId: string, input: z.output<typeof reopenSchema>, auth: AuthContext) {
    const t = await this.visibleRow(refOrId, auth);
    if (!viewerOf(t, auth).canReopen) throw this.requesterOnly(t, 'reopen');
    const actor = actorOf(auth);
    const me = auth.user?.id ?? null;
    return this.ctx.transaction(async (tx) => {
      await this.lockAsRead(tx, t, 'in_progress');
      await this.activity(tx, t.id, actor, {
        kind: 'comment',
        public: true,
        body: input.reason,
        data: { reopen: true },
      });
      const row = await this.applyStatus(tx, t, 'in_progress', {
        actor,
        actorUserId: me,
        data: { reopened: true },
      });
      const recipients = row.assigneeId ? [row.assigneeId] : await this.groupMemberIds(row.assignmentGroupId);
      const name = me ? ((await peopleByIds(this.ctx.db, [me])).get(me)?.displayName ?? '') : '';
      await this.notify(
        tx,
        'itsm.ticket.reopened',
        recipients,
        row,
        { name, reason: excerpt(input.reason) },
        me,
      );
      return row;
    });
  }

  /** Requester: "it's fixed" — closes the ticket, with an optional satisfaction rating. */
  async confirm(refOrId: string, input: z.output<typeof confirmSchema>, auth: AuthContext) {
    const t = await this.visibleRow(refOrId, auth);
    if (!viewerOf(t, auth).canConfirm) throw this.requesterOnly(t, 'confirm');
    const csat = Boolean(await this.ctx.settings.get<boolean>('csatEnabled'));
    const actor = actorOf(auth);
    const rated = csat && input.rating !== undefined;
    return this.ctx.transaction(async (tx) => {
      await this.lockAsRead(tx, t, 'closed');
      if (rated)
        await tx
          .update(tickets)
          .set({ satisfaction: input.rating, satisfactionComment: input.comment ?? null })
          .where(eq(tickets.id, t.id));
      // Without a rating, a closing remark still belongs in the conversation.
      if (input.comment && !rated)
        await this.activity(tx, t.id, actor, { kind: 'comment', public: true, body: input.comment });
      return this.applyStatus(tx, t, 'closed', {
        actor,
        actorUserId: auth.user?.id ?? null,
        data: { confirmed: true, ...(rated ? { rating: input.rating } : {}) },
      });
    });
  }

  private requesterOnly(t: TicketRow, action: string) {
    if (!SOLVED_STATUSES.includes(t.status))
      return new HttpError(409, ErrorCodes.INVALID_TRANSITION, `Only a resolved ticket can be ${action}ed`, {
        from: t.status,
        allowed: [],
      });
    return httpErrors.forbidden(`Only the requester can ${action} this ticket`);
  }

  /* ───────────────────────────── links ───────────────────────────── */

  async addLink(refOrId: string, input: z.output<typeof createLinkSchema>, auth: AuthContext) {
    const current = await this.workableRow(refOrId, auth);
    const link = await this.checkLink(current, input, auth);
    const actor = actorOf(auth);
    await this.ctx.transaction(async (tx) => {
      // Two people linking the same tickets at once: the second finds the first one's link.
      await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, current.id)).for('update');
      if (await this.linkExists(tx, link))
        throw new HttpError(409, ErrorCodes.RELATIONSHIP_INVALID, 'These tickets are already linked');
      await this.insertLink(tx, link, actor, auth);
    });
    return current;
  }

  private async linkExists(
    db: Db,
    { source, target, type }: { source: TicketRow; target: TicketRow; type: LinkType },
  ) {
    const rows = await db
      .select({ id: ticketLinks.id })
      .from(ticketLinks)
      .where(
        and(
          eq(ticketLinks.type, type),
          or(
            and(eq(ticketLinks.sourceId, source.id), eq(ticketLinks.targetId, target.id)),
            isSymmetricLink(type) || type === 'parent_of' || type === 'duplicate_of'
              ? and(eq(ticketLinks.sourceId, target.id), eq(ticketLinks.targetId, source.id))
              : undefined,
          ),
        ),
      );
    return rows.length > 0;
  }

  /**
   * Checks a link from `current` (the ticket the person works) to another ticket they can read: `incoming` means the
   * other ticket points at this one (on a problem: "this incident is caused by it").
   */
  private async checkLink(
    current: TicketRow,
    input: { target: string; type: LinkType; direction?: 'outgoing' | 'incoming' },
    auth: AuthContext,
  ) {
    const other = await this.findRow(input.target);
    if (!other || !canRead(other, auth)) throw httpErrors.notFound('Linked ticket not found');
    const [source, target] = input.direction === 'incoming' ? [other, current] : [current, other];
    const invalid = (message: string) => new HttpError(409, ErrorCodes.RELATIONSHIP_INVALID, message);
    if (target.id === source.id) throw invalid('A ticket cannot be linked to itself');
    const problem = linkProblem(input.type, source.type, target.type);
    if (problem) throw invalid(problem);
    const link = { source, target, type: input.type };
    if (await this.linkExists(this.ctx.db, link)) throw invalid('These tickets are already linked');
    return link;
  }

  private async insertLink(
    tx: Db,
    { source, target, type }: { source: TicketRow; target: TicketRow; type: LinkType },
    actor: Actor,
    auth: AuthContext,
  ) {
    const [link] = await tx
      .insert(ticketLinks)
      .values({ sourceId: source.id, targetId: target.id, type, createdBy: auth.user?.id ?? null })
      .returning();
    const data = { linkId: link!.id, type, action: 'added' };
    await this.activity(tx, source.id, actor, {
      kind: 'link',
      public: false,
      data: { ...data, direction: 'outgoing', ticket: { id: target.id, reference: refOf(target) } },
    });
    await this.activity(tx, target.id, actor, {
      kind: 'link',
      public: false,
      data: { ...data, direction: 'incoming', ticket: { id: source.id, reference: refOf(source) } },
    });
    await this.ctx.audit.record(
      {
        action: 'itsm.ticket.linked',
        entityType: 'itsm.ticket',
        entityId: source.id,
        entityLabel: refOf(source),
        metadata: { type, target: refOf(target) },
      },
      { tx },
    );
    for (const t of [source, target])
      await this.ctx.events.publish('itsm.ticket.updated', { ...this.ref(t), changes: ['links'] }, { tx });
  }

  async removeLink(refOrId: string, linkId: string, auth: AuthContext) {
    const t = await this.workableRow(refOrId, auth);
    const [link] = await this.ctx.db
      .select()
      .from(ticketLinks)
      .where(
        and(eq(ticketLinks.id, linkId), or(eq(ticketLinks.sourceId, t.id), eq(ticketLinks.targetId, t.id))),
      );
    if (!link) throw httpErrors.notFound('Link not found');
    const otherId = link.sourceId === t.id ? link.targetId : link.sourceId;
    const other = await this.findRow(otherId);
    const actor = actorOf(auth);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(ticketLinks).where(eq(ticketLinks.id, link.id));
      for (const [id, peer] of [
        [t.id, other],
        [otherId, t],
      ] as const)
        await this.activity(tx, id, actor, {
          kind: 'link',
          public: false,
          data: {
            linkId: link.id,
            type: link.type,
            action: 'removed',
            ticket: peer ? { id: peer.id, reference: refOf(peer) } : null,
          },
        });
      await this.ctx.audit.record(
        {
          action: 'itsm.ticket.unlinked',
          entityType: 'itsm.ticket',
          entityId: t.id,
          entityLabel: refOf(t),
          metadata: { type: link.type, other: other ? refOf(other) : otherId },
        },
        { tx },
      );
      await this.ctx.events.publish('itsm.ticket.updated', { ...this.ref(t), changes: ['links'] }, { tx });
    });
    return t;
  }

  /* ───────────────────────────── problems ───────────────────────────── */

  async updateProblem(refOrId: string, input: z.output<typeof updateProblemSchema>, auth: AuthContext) {
    const t = await this.visibleRow(refOrId, auth);
    if (t.type !== 'problem')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This ticket is not a problem');
    if (!auth.can('itsm.problems.manage'))
      throw httpErrors.forbidden('Managing problems needs itsm.problems.manage');
    const [before] = await this.ctx.db.select().from(problems).where(eq(problems.ticketId, t.id));
    const set: Partial<typeof problems.$inferInsert> = {};
    if (input.rootCause !== undefined) set.rootCause = input.rootCause;
    if (input.workaround !== undefined) set.workaround = input.workaround;
    if (input.knownError !== undefined) set.knownError = input.knownError;
    if (input.kbArticleId !== undefined) {
      set.kbArticleId = input.kbArticleId;
      set.kbArticle = input.kbArticleId ? await this.kbArticle(input.kbArticleId, auth) : null;
    }
    const changesLog = this.ctx.audit.diff(
      (before ?? {}) as Record<string, unknown>,
      set as Record<string, unknown>,
      ['rootCause', 'workaround', 'knownError', 'kbArticleId'],
    );
    if (!Object.keys(changesLog).length) return t;
    const actor = actorOf(auth);
    return this.ctx.transaction(async (tx) => {
      await tx
        .insert(problems)
        .values({ ticketId: t.id, ...set })
        .onConflictDoUpdate({ target: problems.ticketId, set });
      await this.activity(tx, t.id, actor, {
        kind: 'field',
        public: false,
        data: { changes: Object.fromEntries(Object.keys(changesLog).map((k) => [k, changesLog[k]])) },
      });
      let row = t;
      // Flagging a known error moves the problem there (it publishes `itsm.problem.known_error`).
      if (input.knownError && !before?.knownError && (t.status === 'investigating' || t.status === 'new'))
        row = await this.applyStatus(tx, t, 'known_error', { actor, actorUserId: auth.user?.id ?? null });
      else if (input.knownError && !before?.knownError)
        await this.ctx.events.publish('itsm.problem.known_error', this.ref(t), { tx });
      await this.ctx.audit.record(
        {
          action: 'itsm.problem.updated',
          entityType: 'itsm.ticket',
          entityId: t.id,
          entityLabel: `${refOf(t)} ${t.title}`,
          changes: changesLog,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itsm.ticket.updated',
        { ...this.ref(t), changes: Object.keys(changesLog) },
        { tx },
      );
      return row;
    });
  }

  /**
   * "Write the known-error article": a knowledge draft for agents (through the knowledge module's AI tool, as the
   * caller), linked to the problem as its article. The author reviews and publishes it in the knowledge base.
   */
  async writeKnownErrorArticle(
    refOrId: string,
    input: z.output<typeof knownErrorArticleSchema>,
    auth: AuthContext,
  ) {
    const t = await this.workableRow(refOrId, auth);
    if (t.type !== 'problem')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This ticket is not a problem');
    if (!auth.can('itsm.problems.manage'))
      throw httpErrors.forbidden('Managing problems needs itsm.problems.manage');
    const reference = refOf(t);
    const draft = await this.ctx.ai.tools.invoke<{ id: string; reference: string; href: string }>(
      'knowledge.create_draft',
      {
        title: input.title,
        summary: input.summary,
        body: input.body,
        locale: input.locale,
        audience: 'agents',
        source: { type: 'itsm.problem', id: t.id, reference },
      },
      { auth },
    );
    const article = { id: draft.id, reference: draft.reference, title: input.title };
    await this.ctx.transaction(async (tx) => {
      await tx
        .insert(problems)
        .values({ ticketId: t.id, kbArticleId: article.id, kbArticle: article })
        .onConflictDoUpdate({
          target: problems.ticketId,
          set: { kbArticleId: article.id, kbArticle: article },
        });
      await this.activity(tx, t.id, actorOf(auth), {
        kind: 'field',
        public: false,
        data: { changes: { kbArticleId: [null, article.reference] } },
      });
      await this.linkArticle(tx, t, article);
      await this.ctx.audit.record(
        {
          action: 'itsm.problem.updated',
          entityType: 'itsm.ticket',
          entityId: t.id,
          entityLabel: `${reference} ${t.title}`,
          changes: { kbArticleId: [null, article.id] },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itsm.ticket.updated',
        { ...this.ref(t), changes: ['kbArticleId'] },
        { tx },
      );
    });
    return { article: { id: draft.id, reference: draft.reference, href: draft.href } };
  }

  /** The knowledge article (read through the knowledge module's AI tool, as the caller). */
  private async kbArticle(id: string, auth: AuthContext, field = 'kbArticleId'): Promise<KbArticleRef> {
    try {
      const a = await this.ctx.ai.tools.invoke<{ id: string; reference: string; title: string }>(
        'knowledge.get_article',
        { id },
        { auth },
      );
      return { id: a.id, reference: a.reference, title: a.title };
    } catch {
      throw validation(field, 'Knowledge article not found');
    }
  }

  /** "This article solved it": a platform link between the ticket and the article (idempotent). */
  private async linkArticle(tx: Db, t: TicketRow, article: KbArticleRef) {
    await this.ctx.records.link(
      { type: t.type === 'change' ? 'itsm.change' : 'itsm.ticket', id: t.id },
      { type: 'knowledge.article', id: article.id },
      { tx },
    );
  }

  /* ───────────────────────────── changes ───────────────────────────── */

  async updateChange(refOrId: string, input: z.output<typeof updateChangeSchema>, auth: AuthContext) {
    const t = await this.visibleRow(refOrId, auth);
    if (t.type !== 'change')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This ticket is not a change');
    if (!auth.can('itsm.changes.manage'))
      throw httpErrors.forbidden('Planning changes needs itsm.changes.manage');
    if (!['draft', 'assessment', 'rejected'].includes(t.status))
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        'A change can only be edited before it is submitted for approval',
      );
    const [before] = await this.ctx.db.select().from(changes).where(eq(changes.ticketId, t.id));
    const start = input.plannedStart !== undefined ? input.plannedStart : (before?.plannedStart ?? null);
    const end = input.plannedEnd !== undefined ? input.plannedEnd : (before?.plannedEnd ?? null);
    if (start && end && end <= start) throw validation('plannedEnd', 'The window must end after it starts');
    const changesLog = this.ctx.audit.diff(
      (before ?? {}) as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    if (!Object.keys(changesLog).length) return t;
    const actor = actorOf(auth);
    return this.ctx.transaction(async (tx) => {
      await tx
        .insert(changes)
        .values({ ticketId: t.id, ...input })
        .onConflictDoUpdate({ target: changes.ticketId, set: input });
      await tx.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, t.id));
      await this.activity(tx, t.id, actor, {
        kind: 'field',
        public: false,
        data: { changes: Object.fromEntries(Object.keys(changesLog).map((k) => [k, changesLog[k]])) },
      });
      await this.ctx.audit.record(
        {
          action: 'itsm.change.updated',
          entityType: 'itsm.ticket',
          entityId: t.id,
          entityLabel: `${refOf(t)} ${t.title}`,
          changes: changesLog,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itsm.ticket.updated',
        { ...this.ref(t), changes: Object.keys(changesLog) },
        { tx },
      );
      return t;
    });
  }

  /** Facts the CAB workflow decides on (manifest `changeFacts`), with the ticket's custom fields. */
  private async changeFacts(t: TicketRow, c: typeof changes.$inferSelect) {
    const ciRows = await this.ctx.db
      .select({ criticality: cis.criticality })
      .from(ticketCis)
      .innerJoin(cis, eq(cis.id, ticketCis.ciId))
      .where(eq(ticketCis.ticketId, t.id));
    return {
      ...(await this.ctx.fields.facts('itsm.ticket', t.attributes)),
      change: {
        type: c.changeType,
        risk: c.risk,
        impact: t.impact,
        ciCount: ciRows.length,
        durationHours:
          c.plannedStart && c.plannedEnd
            ? Math.round(((c.plannedEnd.getTime() - c.plannedStart.getTime()) / 3_600_000) * 100) / 100
            : null,
        criticalCis: ciRows.some((r) => r.criticality === 'critical'),
      },
    };
  }

  /**
   * assessment → authorization: starts the required `itsm.change` workflow. Standard changes have no
   * approval step, so they come back approved and go straight to `scheduled`.
   */
  async submitChange(
    t: TicketRow,
    actor: Actor,
    requesterId: string | null,
    note?: string,
    opts: { now?: Date; quiet?: boolean } = {},
  ): Promise<TicketRow> {
    const [c] = await this.ctx.db.select().from(changes).where(eq(changes.ticketId, t.id));
    if (!c?.plannedStart || !c.plannedEnd)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Plan the change window before submitting it', {
        fields: {
          ...(c?.plannedStart ? {} : { plannedStart: 'required' }),
          ...(c?.plannedEnd ? {} : { plannedEnd: 'required' }),
        },
      });
    const now = opts.now ?? new Date();
    if (c.changeType !== 'emergency' && c.plannedStart < now)
      throw new HttpError(409, ErrorCodes.SCHEDULE_CONFLICT, 'The planned window starts in the past', {
        plannedStart: c.plannedStart.toISOString(),
      });
    const reference = refOf(t);
    const facts = await this.changeFacts(t, c);
    return this.ctx.transaction(async (tx) => {
      await this.lockAsRead(tx, t, 'authorization');
      let row = await this.applyStatus(tx, t, 'authorization', {
        actor,
        actorUserId: requesterId,
        note,
        now,
        quiet: opts.quiet,
      });
      const started = await this.ctx.workflows.start(
        'itsm.change',
        {
          subject: {
            type: 'change',
            id: t.id,
            label: `${reference} · ${t.title}`,
            href: ticketHref(reference),
          },
          facts,
          requesterId,
        },
        { tx },
      );
      await tx
        .update(changes)
        .set({ approvalInstanceId: started?.instanceId ?? null })
        .where(eq(changes.ticketId, t.id));
      await this.activity(tx, t.id, SYSTEM_ACTOR, {
        kind: 'approval',
        public: false,
        data: { event: 'started', instanceId: started?.instanceId ?? null, facts: facts.change },
        at: now,
      });
      if (!opts.quiet) {
        await this.ctx.events.publish(
          'itsm.change.submitted',
          { ...this.ref(row), instanceId: started?.instanceId ?? null },
          { tx },
        );
        await this.ctx.audit.record(
          {
            action: 'itsm.change.submitted',
            entityType: 'itsm.ticket',
            entityId: t.id,
            entityLabel: `${reference} ${t.title}`,
            metadata: { instanceId: started?.instanceId ?? null, ...facts.change },
          },
          { tx },
        );
      }
      if (started && started.status !== 'running')
        row = await this.decideChange(tx, row, started.status, null, { now, quiet: opts.quiet });
      return row;
    });
  }

  private async decideChange(
    tx: Db,
    t: TicketRow,
    outcome: 'approved' | 'rejected',
    comment: string | null,
    opts: { now?: Date; quiet?: boolean } = {},
  ) {
    const to: TicketStatus = outcome === 'approved' ? 'scheduled' : 'rejected';
    await this.activity(tx, t.id, SYSTEM_ACTOR, {
      kind: 'approval',
      public: false,
      body: comment,
      data: { event: outcome },
      at: opts.now,
    });
    const row = await this.applyStatus(tx, t, to, { actor: SYSTEM_ACTOR, now: opts.now, quiet: opts.quiet });
    if (opts.quiet) return row;
    const [c] = await tx.select().from(changes).where(eq(changes.ticketId, t.id));
    const recipients = [row.requesterId, row.assigneeId, row.createdBy];
    if (outcome === 'approved') {
      await this.ctx.events.publish('itsm.change.approved', this.ref(row), { tx });
      await this.notify(
        tx,
        'itsm.change.approved',
        recipients,
        row,
        { start: c?.plannedStart ?? null },
        null,
      );
    } else {
      await this.ctx.events.publish('itsm.change.rejected', { ...this.ref(row), comment }, { tx });
      await this.notify(tx, 'itsm.change.rejected', recipients, row, { comment: comment ?? '' }, null);
    }
    await this.ctx.audit.record(
      {
        action: `itsm.change.${outcome}`,
        entityType: 'itsm.ticket',
        entityId: row.id,
        entityLabel: `${refOf(row)} ${row.title}`,
        metadata: { comment },
      },
      { tx },
    );
    return row;
  }

  /** CAB workflow finished (outbox, at-least-once): schedule or reject, once. */
  async onChangeCompleted(result: WorkflowCompletion) {
    const t = await this.findRow(result.subjectId);
    if (!t || t.type !== 'change' || t.status !== 'authorization') return;
    const [c] = await this.ctx.db.select().from(changes).where(eq(changes.ticketId, t.id));
    if (!c || c.approvalInstanceId !== result.instanceId) return;
    await this.ctx.transaction(async (tx) => {
      // Re-check under a row lock so a concurrent delivery cannot decide twice.
      const [locked] = await tx.select().from(tickets).where(eq(tickets.id, t.id)).for('update');
      if (!locked || locked.status !== 'authorization') return;
      if (result.outcome === 'cancelled') {
        await this.activity(tx, t.id, SYSTEM_ACTOR, {
          kind: 'approval',
          public: false,
          data: { event: 'cancelled' },
        });
        await this.applyStatus(tx, locked, 'assessment', { actor: SYSTEM_ACTOR });
        return;
      }
      await this.decideChange(tx, locked, result.outcome, result.comment);
    });
  }

  /* ───────────────────────────── triage ───────────────────────────── */

  /**
   * Classifies and routes a ticket (AI or agent). With `onlyEmpty`, category, group and assignee are
   * only filled when empty (a group that was only defaulted counts as empty until first triage), and
   * impact/urgency only when the ticket was never triaged and nobody chose them. Recomputed from the fresh row
   * when the ticket changed while this ran (see `update`).
   */
  async triage(input: TriageInput, auth: AuthContext) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.triageOnce(input, auth);
      } catch (err) {
        if (!(err instanceof StaleTicket) || attempt >= 4) throw err;
      }
    }
  }

  private async triageOnce(input: TriageInput, auth: AuthContext) {
    const t = await this.findRow(input.ticketId);
    if (!t || !(auth.can('itsm.tickets.triage') || canWork(t, auth)))
      throw httpErrors.notFound('Ticket not found');
    if (isDone(t.status))
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Closed tickets are not triaged');
    const manual = new Set(t.manualFields);
    const fresh = !t.triagedAt;
    const may = (field: ManualField, current: unknown, autoFilled = false) =>
      !input.onlyEmpty || current === null || (autoFilled && fresh && !manual.has(field));
    const set: Partial<typeof tickets.$inferInsert> = {};
    const applied: string[] = [];
    const skipped: string[] = [];
    const consider = (field: string, ok: boolean, apply: () => void) => {
      if (ok) {
        apply();
        applied.push(field);
      } else skipped.push(field);
    };

    let category = null;
    if (input.categoryId !== undefined) {
      category = await this.assertCategory(input.categoryId, t.type);
      consider('category', may('category', t.categoryId), () => (set.categoryId = category!.id));
    }
    if (input.impact !== undefined)
      consider(
        'impact',
        !input.onlyEmpty || (fresh && !manual.has('impact')),
        () => (set.impact = input.impact),
      );
    if (input.urgency !== undefined)
      consider(
        'urgency',
        !input.onlyEmpty || (fresh && !manual.has('urgency')),
        () => (set.urgency = input.urgency),
      );
    const groupAuto = !manual.has('group');
    let groupId =
      input.assignmentGroupId !== undefined ? await this.assertGroup(input.assignmentGroupId) : undefined;
    if (groupId === undefined && set.categoryId && category?.defaultGroupId)
      groupId = category.defaultGroupId;
    if (groupId !== undefined && groupId !== t.assignmentGroupId) {
      if (input.assignmentGroupId !== undefined)
        consider(
          'group',
          may('group', t.assignmentGroupId, groupAuto),
          () => (set.assignmentGroupId = groupId),
        );
      else if (may('group', t.assignmentGroupId, groupAuto)) set.assignmentGroupId = groupId;
    }
    if (input.assigneeId !== undefined) {
      const user = await this.assertUser(input.assigneeId, 'assigneeId');
      consider('assignee', may('assignee', t.assigneeId), () => (set.assigneeId = user!.id));
    }
    const impact = set.impact ?? t.impact;
    const urgency = set.urgency ?? t.urgency;
    if (!t.priorityOverridden && priorityFor(impact, urgency) !== t.priority)
      set.priority = priorityFor(impact, urgency);
    if (set.assignmentGroupId && set.assigneeId === undefined && t.assigneeId) {
      const members = await this.groupMemberIds(set.assignmentGroupId, 10_000);
      if (!members.includes(t.assigneeId)) set.assigneeId = null;
    }

    const actor = actorOf(auth);
    const by: 'ai' | 'agent' = actor.authorAi ? 'ai' : 'agent';
    const now = new Date();
    set.triagedAt = now;
    set.triagedBy = {
      type: by,
      id: auth.user?.id ?? null,
      name: actor.authorName ?? auth.user?.displayName ?? auth.principal.name,
    };
    const row = await this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(tickets).where(eq(tickets.id, t.id)).for('update');
      if (!locked || !sameEditableState(locked, t) || locked.triagedAt?.getTime() !== t.triagedAt?.getTime())
        throw new StaleTicket();
      const [after] = await tx.update(tickets).set(set).where(eq(tickets.id, t.id)).returning();
      const a = after!;
      await this.activity(tx, t.id, actor, {
        kind: 'triage',
        public: false,
        body: input.rationale ?? null,
        data: {
          confidence: input.confidence ?? null,
          rationale: input.rationale ?? null,
          fields: applied,
          skipped,
          onlyEmpty: input.onlyEmpty,
          values: {
            ...(set.categoryId ? { categoryId: set.categoryId } : {}),
            ...(set.impact ? { impact: set.impact } : {}),
            ...(set.urgency ? { urgency: set.urgency } : {}),
            ...(set.priority ? { priority: set.priority } : {}),
            ...(set.assignmentGroupId ? { assignmentGroupId: set.assignmentGroupId } : {}),
            ...(set.assigneeId ? { assigneeId: set.assigneeId } : {}),
          },
          ...(auth.principal.type !== 'ai_agent' && this.ctx.principal().type === 'ai_agent'
            ? { via: this.ctx.principal().name }
            : {}),
        },
        at: now,
      });
      if (a.priority !== t.priority) await this.sla.retarget(tx, t.id, a.priority, now);
      if (a.assigneeId !== t.assigneeId || a.assignmentGroupId !== t.assignmentGroupId)
        await this.recordAssignment(tx, t, a, actor, auth.user?.id ?? null);
      await this.ctx.audit.record(
        {
          action: 'itsm.ticket.triaged',
          entityType: 'itsm.ticket',
          entityId: t.id,
          entityLabel: `${refOf(t)} ${t.title}`,
          metadata: { by, fields: applied, confidence: input.confidence ?? null },
        },
        { tx },
      );
      await this.ctx.events.publish('itsm.ticket.triaged', { ...this.ref(a), by, fields: applied }, { tx });
      return a;
    });
    return { row, applied, skipped };
  }

  /* ───────────────────────────── housekeeping ───────────────────────────── */

  /** A person left: their open tickets go back to the group queue. */
  async offboard(userId: string) {
    const open = await this.ctx.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.assigneeId, userId), notInArray(tickets.status, [...DONE_STATUSES])))
      .limit(5_000);
    for (const t of open)
      await this.ctx.transaction(async (tx) => {
        const [after] = await tx
          .update(tickets)
          .set({ assigneeId: null })
          .where(and(eq(tickets.id, t.id), eq(tickets.assigneeId, userId)))
          .returning();
        if (!after) return;
        await this.activity(tx, t.id, SYSTEM_ACTOR, {
          kind: 'assignment',
          public: false,
          data: {
            from: { groupId: t.assignmentGroupId, assigneeId: userId },
            to: { groupId: t.assignmentGroupId, assigneeId: null },
            reason: 'offboarded',
          },
        });
        await this.ctx.events.publish(
          'itsm.ticket.assigned',
          { ...this.ref(after), assigneeId: null, groupId: after.assignmentGroupId },
          { tx },
        );
      });
    return open.length;
  }

  /** Resolved/fulfilled tickets the requester never confirmed close after `autoCloseDays`. */
  async autoClose(now = new Date()) {
    const days = Number((await this.ctx.settings.get<number>('autoCloseDays')) ?? 5);
    if (!(days > 0)) return 0;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const due = await this.ctx.db
      .select()
      .from(tickets)
      .where(and(inArray(tickets.status, ['resolved', 'fulfilled']), lte(tickets.resolvedAt, cutoff)))
      .orderBy(asc(tickets.resolvedAt))
      .limit(1_000);
    let closed = 0;
    for (const t of due) {
      if (t.type === 'problem') continue;
      const done = await this.ctx.transaction(async (tx) => {
        const [locked] = await tx.select().from(tickets).where(eq(tickets.id, t.id)).for('update');
        if (!locked || !SOLVED_STATUSES.includes(locked.status)) return false;
        await this.applyStatus(tx, locked, 'closed', {
          actor: SYSTEM_ACTOR,
          now,
          data: { auto: true, days },
        });
        return true;
      });
      if (done) closed++;
    }
    return closed;
  }

  /** Global search: references and titles of tickets the caller can see. */
  async search(query: string, auth: AuthContext, limit: number) {
    if (!auth.permissions.hasAny('itsm.tickets.create') && !auth.permissions.hasAny('itsm.tickets.read'))
      return [];
    const ref = parseTicketRef(query);
    const rows = await this.ctx.db
      .select()
      .from(tickets)
      .where(
        and(
          visibilityFilter(auth),
          or(
            ilike(tickets.title, likePattern(query)),
            ref ? and(eq(tickets.type, ref.type), eq(tickets.number, ref.number)) : undefined,
          ),
        ),
      )
      .orderBy(desc(tickets.createdAt))
      .limit(limit);
    return rows.map((t) => ({
      id: t.id,
      type: 'ticket',
      title: `${refOf(t)} · ${t.title}`,
      status: `itsm.status.${t.status}`,
      exact: Boolean(ref && t.type === ref.type && t.number === ref.number),
      href: ticketHref(refOf(t)),
      icon: t.type === 'change' ? 'calendar-clock' : t.type === 'problem' ? 'bug' : 'life-buoy',
    }));
  }

  /** Semantic index entry for similar-ticket search (resolved/closed incidents, requests and problems). */
  async index(ticketId: string) {
    const t = await this.findRow(ticketId);
    if (!t || t.type === 'change' || !['resolved', 'fulfilled', 'closed'].includes(t.status)) return false;
    const cat = t.categoryId ? (await categoryMap(this.ctx.db)).get(t.categoryId) : undefined;
    const reference = refOf(t);
    await this.ctx.ai.index.upsert({
      type: 'itsm.ticket',
      id: t.id,
      title: `${reference} ${t.title}`,
      text: `${t.description}\n\nResolution: ${t.resolutionNotes ?? ''}`.trim(),
      locale: null,
      href: ticketHref(reference),
      acl: {
        permission: 'itsm.tickets.read',
        scope: t.departmentId ? { departmentId: t.departmentId } : undefined,
      },
      // Logs, error screenshots and runbooks attached to a resolved ticket help find it for the next one.
      attachments: true,
      metadata: {
        reference,
        type: t.type,
        categoryId: t.categoryId,
        categoryKey: cat?.key ?? null,
        assignmentGroupId: t.assignmentGroupId,
        assigneeId: t.assigneeId,
        priority: t.priority,
        impact: t.impact,
        urgency: t.urgency,
        resolutionCode: t.resolutionCode,
      },
    });
    return true;
  }

  /** Same-number reference helper for other services. */
  static reference(t: { type: TicketType; number: number }) {
    return formatTicketRef(t.type, t.number);
  }
}

/** What a triage may set (AI suggestions or an agent), with the AI's confidence and rationale. */
type TriageInput = {
  ticketId: string;
  categoryId?: string;
  impact?: number;
  urgency?: number;
  assignmentGroupId?: string;
  assigneeId?: string;
  onlyEmpty: boolean;
  confidence?: number;
  rationale?: string;
};

/** The ticket changed between reading it and locking it: compute the edit again from the fresh row. */
class StaleTicket extends Error {}

/** What an edit is computed from: unchanged means the edit computed earlier still holds. */
function sameEditableState(a: TicketRow, b: TicketRow) {
  const keys = [
    'status',
    'title',
    'description',
    'impact',
    'urgency',
    'priority',
    'priorityOverridden',
    'categoryId',
    'assignmentGroupId',
    'assigneeId',
    'requesterId',
    'requestedForId',
    'major',
    'signOffInstanceId',
  ] as const;
  return (
    keys.every((k) => a[k] === b[k]) &&
    JSON.stringify(a.attributes) === JSON.stringify(b.attributes) &&
    JSON.stringify(a.manualFields) === JSON.stringify(b.manualFields)
  );
}

/** Open ticket with a breached timer. */
export function breachedSql(): SQL {
  return sql`exists (select 1 from ${ticketSlas} where ${ticketSlas.ticketId} = ${tickets.id} and ${ticketSlas.status} = 'breached')`;
}

/** Open ticket with a running timer past its warning threshold. */
export function atRiskSql(): SQL {
  return sql`exists (select 1 from ${ticketSlas} where ${ticketSlas.ticketId} = ${tickets.id} and ${ticketSlas.status} = 'running' and (${ticketSlas.warnedAt} is not null or ${ticketSlas.warnAt} <= now()))`;
}
