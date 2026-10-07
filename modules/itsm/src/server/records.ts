import {
  type AuthContext,
  likePattern,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
} from '@isbp/sdk/server';
import { and, desc, eq, ilike, inArray, ne, notInArray, or, type SQL } from 'drizzle-orm';
import { parseTicketRef } from '../contracts';
import { canRead, canWork, isRequesterOf, visibilityFilter } from './access';
import { FINAL_STATUSES, refOf, statusTone, ticketHref } from './rules';
import { tickets } from './schema';

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
    status: { key: `itsm.status.${t.status}`, tone: statusTone(t.status) },
    href: ticketHref(reference),
    editable: canWork(t, auth) || requesterAttach,
  };
}

function resolver(kind: 'ticket' | 'change'): RecordResolver {
  const typeFilter: SQL = kind === 'change' ? eq(tickets.type, 'change') : ne(tickets.type, 'change');
  return {
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
