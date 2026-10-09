/**
 * What waits for a requester in the service desk (`manifest.work`, shown on My work): changes they asked for that are
 * in their post-implementation review (accept it or report a problem), and their resolved incidents and requests
 * (confirm the fix or reopen). Agents' queues stay on the service desk itself.
 */
import type { WorkProvider } from '@isbp/sdk/server';
import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { refOf, SOLVED_STATUSES, ticketHref } from './rules';
import { changes, tickets } from './schema';

const mine = (me: string) => or(eq(tickets.requesterId, me), eq(tickets.requestedForId, me));

/** Changes in review whose requester hasn't accepted them (or reported a problem) yet. */
const acceptChanges: WorkProvider = async (auth, ctx, { limit }) => {
  const where = and(
    eq(tickets.type, 'change'),
    eq(tickets.status, 'review'),
    mine(auth.user!.id),
    isNull(changes.acceptance),
  );
  const base = () => ctx.db.select().from(tickets).innerJoin(changes, eq(changes.ticketId, tickets.id));
  const [[total], rows] = await Promise.all([
    ctx.db
      .select({ n: count() })
      .from(tickets)
      .innerJoin(changes, eq(changes.ticketId, tickets.id))
      .where(where),
    limit > 0 ? base().where(where).orderBy(desc(tickets.updatedAt)).limit(limit) : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map(({ tickets: t }) => {
      const reference = refOf(t);
      return {
        id: t.id,
        title: t.title,
        subtitle: reference,
        href: ticketHref(reference),
        since: t.updatedAt,
      };
    }),
  };
};

/** Resolved incidents and requests of the person: confirm the fix or reopen. */
const confirmFixes: WorkProvider = async (auth, ctx, { limit }) => {
  const where = and(
    inArray(tickets.type, ['incident', 'service_request']),
    inArray(tickets.status, [...SOLVED_STATUSES]),
    mine(auth.user!.id),
  );
  const [[total], rows] = await Promise.all([
    ctx.db.select({ n: count() }).from(tickets).where(where),
    limit > 0
      ? ctx.db
          .select({
            id: tickets.id,
            type: tickets.type,
            number: tickets.number,
            title: tickets.title,
            updatedAt: tickets.updatedAt,
          })
          .from(tickets)
          .where(where)
          .orderBy(desc(tickets.updatedAt))
          .limit(limit)
      : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map((t) => {
      const reference = refOf(t);
      return {
        id: t.id,
        title: t.title,
        subtitle: reference,
        href: ticketHref(reference),
        since: t.updatedAt,
      };
    }),
  };
};

export const itsmWork = { 'accept-changes': acceptChanges, 'confirm-fixes': confirmFixes };
