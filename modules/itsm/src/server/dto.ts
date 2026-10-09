/**
 * Builds the API shapes (contracts.ts) from rows, batching every lookup so a page of tickets costs a
 * constant number of queries.
 */
import { departments, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { formatCiNumber } from '@isbp/module-cmdb/model';
import type { AuthContext, ModuleContext } from '@isbp/sdk/server';
import { aliasedTable, and, asc, desc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  activitySchema,
  changeTypeSchema,
  riskSchema,
  ticketDetailSchema,
  ticketListItemSchema,
} from '../contracts';

type ChangeType = z.infer<typeof changeTypeSchema>;
type Risk = z.infer<typeof riskSchema>;
import { canRead, viewerOf } from './access';
import { categoryMap, categoryRef, groupsByIds, peopleByIds, personRef } from './lookups';
import { isDone, refOf } from './rules';
import {
  changes,
  problems,
  slaPolicies,
  ticketActivities,
  ticketCis,
  ticketLinks,
  tickets,
  ticketSlas,
} from './schema';
import type { SlaService } from './sla';

export type TicketRow = typeof tickets.$inferSelect;
type ActivityRow = typeof ticketActivities.$inferSelect;
type SlaRow = typeof ticketSlas.$inferSelect;

/** Server-side (decoded) shapes: dates are `Date`s, encoded to ISO strings by the route schemas. */
export type TicketListItem = z.output<typeof ticketListItemSchema>;
export type TicketDetail = z.output<typeof ticketDetailSchema>;
export type Activity = z.output<typeof activitySchema>;

export interface ListRow {
  ticket: TicketRow;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  changeType?: ChangeType | null;
  risk?: Risk | null;
}

/** Conflicting changes: same CI, overlapping window, still going ahead. */
export const ACTIVE_CHANGE_STATUSES = ['assessment', 'authorization', 'scheduled', 'implementing'] as const;

const doneAt = (t: TicketRow) => t.resolvedAt ?? t.closedAt ?? null;

export class TicketReader {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly sla: SlaService,
  ) {}

  /** The most urgent timer for a list row: breached first, then the next running deadline, then paused. */
  private async badge(t: TicketRow, rows: SlaRow[], now: Date): Promise<TicketListItem['sla']> {
    if (isDone(t.status)) return null;
    const rank = (r: SlaRow) => (r.status === 'breached' ? 0 : r.status === 'running' ? 1 : 2);
    const pick = rows
      .filter((r) => r.status === 'breached' || r.status === 'running' || r.status === 'paused')
      .sort((a, b) => rank(a) - rank(b) || a.dueAt.getTime() - b.dueAt.getTime())[0];
    if (!pick) return null;
    return {
      metric: pick.metric,
      status: pick.status,
      dueAt: pick.dueAt,
      elapsedRatio: await this.sla.ratio(pick, now, doneAt(t)),
    };
  }

  async listItems(rows: ListRow[], now = new Date()): Promise<TicketListItem[]> {
    const ts = rows.map((r) => r.ticket);
    const [people, groupMap, cats, slaRows] = await Promise.all([
      peopleByIds(
        this.ctx.db,
        ts.flatMap((t) => [t.requesterId, t.assigneeId]),
      ),
      groupsByIds(
        this.ctx.db,
        ts.map((t) => t.assignmentGroupId),
      ),
      categoryMap(this.ctx.db),
      this.sla.forTickets(ts.map((t) => t.id)),
    ]);
    const slaBy = new Map<string, SlaRow[]>();
    for (const s of slaRows) slaBy.set(s.ticketId, [...(slaBy.get(s.ticketId) ?? []), s]);
    return Promise.all(
      rows.map(async ({ ticket: t, plannedStart, plannedEnd, changeType, risk }) => ({
        id: t.id,
        type: t.type,
        number: t.number,
        reference: refOf(t),
        title: t.title,
        status: t.status,
        priority: t.priority,
        impact: t.impact,
        urgency: t.urgency,
        category: categoryRef(t.categoryId ? cats.get(t.categoryId) : null),
        requester: personRef(t.requesterId ? people.get(t.requesterId) : null),
        assignmentGroup: (t.assignmentGroupId && groupMap.get(t.assignmentGroupId)) || null,
        assignee: personRef(t.assigneeId ? people.get(t.assigneeId) : null),
        major: t.major,
        channel: t.channel,
        sla: await this.badge(t, slaBy.get(t.id) ?? [], now),
        plannedStart: plannedStart,
        plannedEnd: plannedEnd,
        changeType: t.type === 'change' ? (changeType ?? null) : null,
        risk: t.type === 'change' ? (risk ?? null) : null,
        awaitingSignOff: Boolean(t.signOffInstanceId) && t.status === 'pending_approval',
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        resolvedAt: t.resolvedAt,
      })),
    );
  }

  async listItem(t: TicketRow): Promise<TicketListItem> {
    const [change] =
      t.type === 'change'
        ? await this.ctx.db
            .select({
              plannedStart: changes.plannedStart,
              plannedEnd: changes.plannedEnd,
              changeType: changes.changeType,
              risk: changes.risk,
            })
            .from(changes)
            .where(eq(changes.ticketId, t.id))
        : [];
    const [item] = await this.listItems([
      {
        ticket: t,
        plannedStart: change?.plannedStart ?? null,
        plannedEnd: change?.plannedEnd ?? null,
        changeType: change?.changeType ?? null,
        risk: change?.risk ?? null,
      },
    ]);
    return item!;
  }

  async cisOf(ticketId: string) {
    const rows = await this.ctx.db
      .select({
        id: cis.id,
        number: cis.number,
        name: cis.name,
        classKey: cis.classKey,
        status: cis.status,
        criticality: cis.criticality,
      })
      .from(ticketCis)
      .innerJoin(cis, eq(cis.id, ticketCis.ciId))
      .where(eq(ticketCis.ticketId, ticketId))
      .orderBy(asc(cis.name));
    return rows.map((c) => ({ ...c, reference: formatCiNumber(c.number) }));
  }

  async linksOf(ticketId: string, auth: AuthContext) {
    const other = aliasedTable(tickets, 'other');
    const [outgoing, incoming] = await Promise.all([
      this.ctx.db
        .select({ link: ticketLinks, other })
        .from(ticketLinks)
        .innerJoin(other, eq(other.id, ticketLinks.targetId))
        .where(eq(ticketLinks.sourceId, ticketId)),
      this.ctx.db
        .select({ link: ticketLinks, other })
        .from(ticketLinks)
        .innerJoin(other, eq(other.id, ticketLinks.sourceId))
        .where(eq(ticketLinks.targetId, ticketId)),
    ]);
    const map = (direction: 'outgoing' | 'incoming') => (r: (typeof outgoing)[number]) => ({
      id: r.link.id,
      type: r.link.type,
      direction,
      ticket: {
        id: r.other.id,
        type: r.other.type,
        reference: refOf(r.other),
        title: r.other.title,
        status: r.other.status,
        priority: r.other.priority,
      },
      visible: canRead(r.other, auth),
    });
    return [...outgoing.map(map('outgoing')), ...incoming.map(map('incoming'))]
      .filter((l) => l.visible)
      .map(({ visible: _v, ...l }) => l)
      .sort((a, b) => a.ticket.reference.localeCompare(b.ticket.reference));
  }

  async slasOf(t: TicketRow, now = new Date()) {
    const rows = await this.ctx.db
      .select({ sla: ticketSlas, policyName: slaPolicies.name, policyLabel: slaPolicies.label })
      .from(ticketSlas)
      .innerJoin(slaPolicies, eq(slaPolicies.id, ticketSlas.policyId))
      .where(eq(ticketSlas.ticketId, t.id))
      .orderBy(asc(ticketSlas.metric));
    return Promise.all(
      rows.map(async ({ sla, policyName, policyLabel }) => ({
        id: sla.id,
        metric: sla.metric,
        policy: { id: sla.policyId, name: policyName, label: policyLabel ?? { en: policyName } },
        status: sla.status,
        startedAt: sla.startedAt,
        dueAt: sla.dueAt,
        stoppedAt: sla.stoppedAt,
        elapsedRatio: await this.sla.ratio(sla, now, doneAt(t)),
        warned: Boolean(sla.warnedAt),
      })),
    );
  }

  /** Changes touching the same CIs in an overlapping window (`exclude` = the change itself). */
  async conflicts(start: Date, end: Date, ciIds: string[], exclude?: string) {
    if (!ciIds.length || end <= start) return [];
    const rows = await this.ctx.db
      .select({
        id: tickets.id,
        type: tickets.type,
        number: tickets.number,
        title: tickets.title,
        status: tickets.status,
        plannedStart: changes.plannedStart,
        plannedEnd: changes.plannedEnd,
        ciId: cis.id,
        ciName: cis.name,
      })
      .from(changes)
      .innerJoin(tickets, eq(tickets.id, changes.ticketId))
      .innerJoin(ticketCis, eq(ticketCis.ticketId, tickets.id))
      .innerJoin(cis, eq(cis.id, ticketCis.ciId))
      .where(
        and(
          inArray(tickets.status, [...ACTIVE_CHANGE_STATUSES]),
          inArray(ticketCis.ciId, ciIds),
          // Overlap: starts before our end and ends after our start.
          lt(changes.plannedStart, end),
          gt(changes.plannedEnd, start),
          exclude ? ne(tickets.id, exclude) : undefined,
        ),
      )
      .orderBy(asc(changes.plannedStart));
    const out = new Map<
      string,
      {
        id: string;
        reference: string;
        title: string;
        status: TicketRow['status'];
        plannedStart: Date;
        plannedEnd: Date;
        sharedCis: { id: string; name: string }[];
      }
    >();
    for (const r of rows) {
      const hit = out.get(r.id) ?? {
        id: r.id,
        reference: refOf(r),
        title: r.title,
        status: r.status,
        plannedStart: r.plannedStart!,
        plannedEnd: r.plannedEnd!,
        sharedCis: [],
      };
      if (!hit.sharedCis.some((c) => c.id === r.ciId)) hit.sharedCis.push({ id: r.ciId, name: r.ciName });
      out.set(r.id, hit);
    }
    return [...out.values()];
  }

  async detail(t: TicketRow, auth: AuthContext, now = new Date()): Promise<TicketDetail> {
    const viewer = viewerOf(t, auth);
    const agent = viewer.role === 'agent';
    const [item, people, dept, ciList, links, slas, change, problem] = await Promise.all([
      this.listItem(t),
      peopleByIds(this.ctx.db, [t.requestedForId]),
      t.departmentId
        ? this.ctx.db
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(eq(departments.id, t.departmentId))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      this.cisOf(t.id),
      agent ? this.linksOf(t.id, auth) : Promise.resolve([]),
      agent ? this.slasOf(t, now) : Promise.resolve([]),
      t.type === 'change'
        ? this.ctx.db
            .select()
            .from(changes)
            .where(eq(changes.ticketId, t.id))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      t.type === 'problem'
        ? this.ctx.db
            .select()
            .from(problems)
            .where(eq(problems.ticketId, t.id))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);
    if (!agent) item.sla = null;
    const acceptance =
      t.type === 'change' &&
      (t.status === 'review' || t.status === 'closed') &&
      (t.requesterId || t.requestedForId)
        ? {
            state: change?.acceptance ?? ('pending' as const),
            note: change?.acceptanceNote ?? null,
            by: change?.acceptanceBy
              ? personRef((await peopleByIds(this.ctx.db, [change.acceptanceBy])).get(change.acceptanceBy))
              : null,
            at: change?.acceptanceAt ?? null,
            required: Boolean(await this.ctx.settings.get<boolean>('changes.requireAcceptance')),
          }
        : null;
    const conflicts =
      change?.plannedStart && change.plannedEnd
        ? await this.conflicts(
            change.plannedStart,
            change.plannedEnd,
            ciList.map((c) => c.id),
            t.id,
          )
        : [];
    return {
      ...item,
      description: t.description,
      requestedFor: personRef(t.requestedForId ? people.get(t.requestedForId) : null),
      department: dept,
      cis: ciList,
      links,
      slas,
      resolutionCode: t.resolutionCode,
      resolutionNotes: t.resolutionNotes,
      satisfaction: t.satisfaction,
      satisfactionComment: t.satisfactionComment,
      source: t.source,
      answers: t.answers,
      change:
        change && agent
          ? {
              changeType: change.changeType,
              risk: change.risk,
              reason: change.reason,
              plannedStart: change.plannedStart,
              plannedEnd: change.plannedEnd,
              implementationPlan: change.implementationPlan,
              backoutPlan: change.backoutPlan,
              testPlan: change.testPlan,
              approvalInstanceId: change.approvalInstanceId,
              conflicts: conflicts.map((c) => ({
                id: c.id,
                reference: c.reference,
                title: c.title,
                status: c.status,
              })),
            }
          : null,
      acceptance,
      signOff:
        t.signOffInstanceId && t.status === 'pending_approval'
          ? {
              instanceId: t.signOffInstanceId,
              to: t.type === 'service_request' ? ('fulfilled' as const) : ('resolved' as const),
            }
          : null,
      problem:
        problem && agent
          ? {
              rootCause: problem.rootCause,
              workaround: problem.workaround,
              knownError: problem.knownError,
              kbArticle: problem.kbArticle ?? null,
            }
          : null,
      attributes: agent ? t.attributes : {},
      firstResponseAt: t.firstResponseAt,
      closedAt: t.closedAt,
      viewer,
    };
  }

  /* ───────────────────────────── timeline ───────────────────────────── */

  async activityDtos(rows: ActivityRow[]): Promise<Activity[]> {
    const people = await peopleByIds(
      this.ctx.db,
      rows.map((r) => r.authorId),
    );
    return rows.map((r) => {
      const p = r.authorId ? people.get(r.authorId) : undefined;
      const author =
        r.authorId || r.authorName
          ? {
              id: r.authorId,
              displayName: p?.displayName ?? r.authorName ?? '—',
              avatarUrl: p?.avatarUrl ?? null,
              ai: r.authorAi,
            }
          : null;
      return {
        id: r.id,
        kind: r.kind,
        public: r.public,
        author,
        body: r.body,
        data: r.data,
        createdAt: r.createdAt,
      };
    });
  }

  async activities(
    ticketId: string,
    opts: { publicOnly: boolean; page: number; pageSize: number; order: 'asc' | 'desc' },
  ) {
    const where = and(
      eq(ticketActivities.ticketId, ticketId),
      opts.publicOnly ? eq(ticketActivities.public, true) : undefined,
    );
    const order =
      opts.order === 'asc'
        ? [asc(ticketActivities.createdAt), asc(ticketActivities.id)]
        : [desc(ticketActivities.createdAt), desc(ticketActivities.id)];
    const [rows, total] = await Promise.all([
      this.ctx.db
        .select()
        .from(ticketActivities)
        .where(where)
        .orderBy(...order)
        .limit(opts.pageSize)
        .offset((opts.page - 1) * opts.pageSize),
      this.ctx.db.$count(ticketActivities, where),
    ]);
    return { items: await this.activityDtos(rows), total, page: opts.page, pageSize: opts.pageSize };
  }

  /** People's names for AI payloads. */
  async userName(id: string | null): Promise<string | null> {
    if (!id) return null;
    const [u] = await this.ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, id));
    return u?.name ?? null;
  }
}
