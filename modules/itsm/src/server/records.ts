import {
  type AuthContext,
  likePattern,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
} from '@isbp/sdk/server';
import { departments, groups } from '@isbp/db/schema';
import { and, desc, eq, ilike, inArray, ne, notInArray, or, type SQL } from 'drizzle-orm';
import { parseTicketRef } from '../contracts';
import type { ChangeRecordFacts, TicketFacts } from '../manifest';
import { canRead, canWork, isRequesterOf, visibilityFilter } from './access';
import { FINAL_STATUSES, refOf, statusLabelKey, statusTone, ticketHref } from './rules';
import { categories, changes, tickets } from './schema';

type Row = typeof tickets.$inferSelect;

/**
 * Tickets as linkable records for the platform's record registry: `itsm.ticket` (incidents, service
 * requests, problems) and `itsm.change`. Visibility is the same as the ticket pages (`access.ts`). People
 * who work the ticket may link records and attach files; requesters may attach files to their own open
 * tickets (screenshots), which the core panel checks through `editable`.
 */
function summary(t: Row, auth: AuthContext): RecordSummary {
  const reference = refOf(t);
  const requesterAttach = isRequesterOf(t, auth) && !FINAL_STATUSES.includes(t.status);
  return {
    id: t.id,
    reference,
    title: t.title,
    status: { key: statusLabelKey(t), tone: statusTone(t.status) },
    href: ticketHref(reference),
    editable: canWork(t, auth) || requesterAttach,
  };
}

/** Approval facts (`ticketFactsSchema`, `changeRecordFactsSchema`) by id — not permission-filtered. */
async function ticketFacts(
  kind: 'ticket' | 'change',
  typeFilter: SQL,
  ids: readonly string[],
  ctx: ModuleContext,
): Promise<Map<string, TicketFacts | ChangeRecordFacts>> {
  const valid = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!valid.length) return new Map();
  const rows = await ctx.db
    .select({
      t: tickets,
      category: categories.key,
      groupKey: groups.key,
      departmentCode: departments.code,
      change: changes,
    })
    .from(tickets)
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .leftJoin(groups, eq(groups.id, tickets.assignmentGroupId))
    .leftJoin(departments, eq(departments.id, tickets.departmentId))
    .leftJoin(changes, eq(changes.ticketId, tickets.id))
    .where(and(inArray(tickets.id, valid), typeFilter));
  return new Map(
    rows.map(({ t, category, groupKey, departmentCode, change }) => {
      const base: TicketFacts = {
        type: t.type,
        status: t.status,
        priority: t.priority,
        impact: t.impact,
        urgency: t.urgency,
        major: t.major,
        category,
        groupKey,
        assigneeId: t.assigneeId,
        requesterId: t.requesterId,
        departmentCode,
      };
      if (kind === 'ticket' || !change) return [t.id, base];
      return [
        t.id,
        {
          ...base,
          changeType: change.changeType,
          risk: change.risk,
          plannedStart: change.plannedStart?.toISOString() ?? null,
          plannedEnd: change.plannedEnd?.toISOString() ?? null,
        } satisfies ChangeRecordFacts,
      ];
    }),
  );
}

function resolver(kind: 'ticket' | 'change'): RecordResolver {
  const typeFilter: SQL = kind === 'change' ? eq(tickets.type, 'change') : ne(tickets.type, 'change');
  return {
    facts: (ids, ctx) => ticketFacts(kind, typeFilter, ids, ctx),
    async resolve(ids, ctx: ModuleContext, auth) {
      const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      if (!valid.length) return [];
      const rows = await ctx.db
        .select()
        .from(tickets)
        .where(and(inArray(tickets.id, valid), typeFilter));
      return rows.filter((t) => canRead(t, auth)).map((t) => summary(t, auth));
    },
    async search(query, ctx, auth, limit) {
      const ref = parseTicketRef(query);
      const q = query.trim();
      const match = !q
        ? kind === 'change'
          ? undefined
          : notInArray(tickets.status, FINAL_STATUSES as Row['status'][])
        : or(
            ilike(tickets.title, likePattern(q)),
            ref ? and(eq(tickets.type, ref.type), eq(tickets.number, ref.number)) : undefined,
          );
      const rows = await ctx.db
        .select()
        .from(tickets)
        .where(and(typeFilter, visibilityFilter(auth), match))
        .orderBy(desc(tickets.updatedAt))
        .limit(limit);
      return rows.map((t) => summary(t, auth));
    },
  };
}

export const records = { ticket: resolver('ticket'), change: resolver('change') };
