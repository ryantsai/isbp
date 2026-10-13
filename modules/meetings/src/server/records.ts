/**
 * Record type `meetings.meeting` (links, pickers, the links panel on projects, tickets, changes…) and global search.
 * Both return only meetings the caller may see (`access.ts`), with `editable` = the caller may change its links.
 */
import { users } from '@isbp/db/schema';
import type { AuthContext, ModuleContext, RecordResolver, RecordSummary, SearchHit } from '@isbp/sdk/server';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { formatMeetingRef, parseMeetingRef } from '../model';
import { accessFor, canUse, involvement, visibleMeetings } from './access';
import { type MeetingRow, meetings } from './schema';
import { meetingHref } from './shared';
import { likePattern } from '@isbp/sdk/server';

const STATUS = {
  draft: { key: 'meetings.status.draft', tone: 'neutral' as const },
  published: { key: 'meetings.status.published', tone: 'success' as const },
};

async function summaries(
  rows: { meeting: MeetingRow; organizer: string | null }[],
  ctx: ModuleContext,
  auth: AuthContext,
) {
  const me = auth.user?.id;
  const ids = rows.map((r) => r.meeting.id);
  const involved = await involvement(ctx.db, ids, me);
  return rows.flatMap(({ meeting: m, organizer }): RecordSummary[] => {
    const access = accessFor(m, involved(m.id), auth);
    if (!access.canView) return [];
    const reference = formatMeetingRef(m.number);
    return [
      {
        id: m.id,
        reference,
        title: m.title,
        subtitle: [m.startsAt.toISOString().slice(0, 10), organizer].filter(Boolean).join(' · '),
        status: STATUS[m.status],
        href: meetingHref(reference),
        editable: access.canEdit,
      },
    ];
  });
}

function select(ctx: ModuleContext) {
  return ctx.db
    .select({ meeting: meetings, organizer: users.displayName })
    .from(meetings)
    .leftJoin(users, eq(users.id, meetings.organizerId));
}

function textFilter(q: string) {
  const ref = parseMeetingRef(q);
  return or(
    ilike(meetings.title, likePattern(q)),
    ref && 'number' in ref ? eq(meetings.number, ref.number) : undefined,
  );
}

export const meetingRecords: RecordResolver = {
  async resolve(ids, ctx, auth) {
    if (!ids.length || !canUse(auth)) return [];
    const rows = await select(ctx).where(and(inArray(meetings.id, [...ids]), visibleMeetings(auth)));
    return summaries(rows, ctx, auth);
  },
  async search(query, ctx, auth, limit) {
    if (!canUse(auth)) return [];
    const q = query.trim();
    const rows = await select(ctx)
      .where(and(visibleMeetings(auth), q ? textFilter(q) : undefined))
      .orderBy(desc(meetings.startsAt))
      .limit(limit);
    return summaries(rows, ctx, auth);
  },
};

/** The command palette: meetings by reference (exact first) or title. */
export async function search(
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q || !canUse(auth)) return [];
  const rows = await select(ctx)
    .where(and(visibleMeetings(auth), textFilter(q)))
    .orderBy(
      sql`case when ${meetings.number}::text = ${q.replace(/^mtg-0*/i, '')} then 0 else 1 end`,
      desc(meetings.startsAt),
    )
    .limit(limit);
  const ref = parseMeetingRef(q);
  return (await summaries(rows, ctx, auth)).map((r) => ({
    id: r.id,
    type: 'meeting',
    title: r.title,
    subtitle: `${r.reference} · ${r.subtitle}`,
    href: r.href!,
    icon: 'notebook-text',
    status: r.status?.key ?? null,
    exact: Boolean(ref && 'number' in ref && r.reference === formatMeetingRef(ref.number)),
  }));
}
