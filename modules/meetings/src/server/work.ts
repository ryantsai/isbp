/**
 * Meetings on My work: the person's open action items of sent minutes that are tracked here (items that became project
 * tasks are on My work as those tasks).
 */
import type { WorkProvider } from '@isbp/sdk/server';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { formatMeetingRef } from '../model';
import { visibleMeetings } from './access';
import { actionItems, meetings } from './schema';
import { itemHref } from './shared';

const actionItemsWork: WorkProvider = async (auth, ctx, { limit }) => {
  const where = and(
    eq(actionItems.ownerId, auth.user!.id),
    eq(actionItems.status, 'open'),
    eq(actionItems.destination, 'meeting'),
    isNull(actionItems.targetId),
    eq(meetings.status, 'published'),
    visibleMeetings(auth),
  );
  const [[total], rows] = await Promise.all([
    ctx.db
      .select({ n: count() })
      .from(actionItems)
      .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
      .where(where),
    limit > 0
      ? ctx.db
          .select({
            id: actionItems.id,
            title: actionItems.title,
            dueDate: actionItems.dueDate,
            createdAt: actionItems.createdAt,
            number: meetings.number,
            meeting: meetings.title,
          })
          .from(actionItems)
          .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
          .where(where)
          .orderBy(sql`${actionItems.dueDate} asc nulls last`, desc(meetings.startsAt), asc(actionItems.sort))
          .limit(limit)
      : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map((r) => {
      const reference = formatMeetingRef(r.number);
      return {
        id: r.id,
        title: r.title,
        subtitle: `${reference} · ${r.meeting}`,
        href: itemHref(reference, r.id),
        due: r.dueDate,
        since: r.createdAt,
      };
    }),
  };
};

export const meetingsWork = { 'action-items': actionItemsWork };
