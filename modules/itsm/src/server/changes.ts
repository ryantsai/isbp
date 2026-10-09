/** Change calendar and conflict detection (changes touching the same CI in overlapping windows). */
import { cis } from '@isbp/module-cmdb/schema';
import { type AuthContext, ErrorCodes, HttpError, httpErrors, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, eq, gt, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { visibilityFilter } from './access';
import { ACTIVE_CHANGE_STATUSES, type TicketReader } from './dto';
import { peopleByIds, personRef } from './lookups';
import { refOf } from './rules';
import { changes, ticketCis, tickets } from './schema';

const uuidList = z.array(z.uuid()).max(100);

export function assertChangeReader(auth: AuthContext) {
  if (!auth.permissions.hasAny('itsm.changes.read') && !auth.permissions.hasAny('itsm.tickets.read'))
    throw httpErrors.forbidden('Seeing changes needs itsm.changes.read or itsm.tickets.read');
}

/* Calendar cursors: the last change's planned start to the microsecond, and its ticket id, as base64url JSON. */
const CURSOR_START = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres refuses the dates JS would roll over (30 February), so the calendar is checked too. */
function isCursorStart(text: string): boolean {
  const m = CURSOR_START.exec(text);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const day = new Date(0);
  day.setUTCFullYear(y, mo - 1, d);
  return (
    y >= 1 &&
    h <= 23 &&
    mi <= 59 &&
    s <= 59 &&
    day.getUTCFullYear() === y &&
    day.getUTCMonth() === mo - 1 &&
    day.getUTCDate() === d
  );
}

const encodeCursor = (at: string, id: string) => Buffer.from(JSON.stringify([at, id])).toString('base64url');

function decodeCursor(value: string): { at: string; id: string } {
  const invalid = () =>
    new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Invalid cursor', {
      issues: [{ path: 'cursor', message: 'invalid cursor' }],
    });
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parts) || parts.length !== 2) throw invalid();
  const [at, id] = parts as unknown[];
  if (typeof at !== 'string' || typeof id !== 'string' || !isCursorStart(at) || !UUID.test(id))
    throw invalid();
  return { at, id };
}

export class ChangeCalendar {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly reader: TicketReader,
  ) {}

  /**
   * One page of the changes planned in the window, by planned start then id. The page after `cursor` starts strictly
   * after the last change of the page before, so equal starts neither repeat nor get skipped.
   */
  async calendar(
    q: { from: Date; to: Date; ciId?: string; cursor?: string; limit: number },
    auth: AuthContext,
  ) {
    assertChangeReader(auth);
    if (q.to <= q.from) throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, '`to` must be after `from`');
    if (q.to.getTime() - q.from.getTime() > 400 * 86_400_000)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Ask for at most 400 days at a time');
    const after = q.cursor === undefined ? null : decodeCursor(q.cursor);
    // One row beyond the page tells whether another page follows.
    const rows = await this.ctx.db
      .select({
        ticket: tickets,
        change: changes,
        // The start as text to the microsecond: a Date would round it, and the next page would repeat or skip changes.
        startAt: sql<string>`to_char(${changes.plannedStart} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(changes)
      .innerJoin(tickets, eq(tickets.id, changes.ticketId))
      .where(
        and(
          visibilityFilter(auth),
          notInArray(tickets.status, ['cancelled', 'rejected']),
          lt(changes.plannedStart, q.to),
          gt(changes.plannedEnd, q.from),
          q.ciId
            ? sql`exists (select 1 from ${ticketCis} where ${ticketCis.ticketId} = ${tickets.id} and ${ticketCis.ciId} = ${q.ciId})`
            : undefined,
          after
            ? sql`(${changes.plannedStart}, ${tickets.id}) > (${after.at}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(changes.plannedStart), asc(tickets.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > q.limit && last ? encodeCursor(last.startAt, last.ticket.id) : null;
    const ids = page.map((r) => r.ticket.id);
    const [ciRows, people, conflicted] = await Promise.all([
      ids.length
        ? this.ctx.db
            .select({ ticketId: ticketCis.ticketId, id: cis.id, name: cis.name })
            .from(ticketCis)
            .innerJoin(cis, eq(cis.id, ticketCis.ciId))
            .where(inArray(ticketCis.ticketId, ids))
            .orderBy(asc(cis.name))
        : Promise.resolve([]),
      peopleByIds(
        this.ctx.db,
        page.map((r) => r.ticket.assigneeId),
      ),
      // Each change is checked against every active change on its CIs, not just this page.
      this.conflicted(ids),
    ]);
    const cisBy = new Map<string, { id: string; name: string }[]>();
    for (const c of ciRows)
      cisBy.set(c.ticketId, [...(cisBy.get(c.ticketId) ?? []), { id: c.id, name: c.name }]);
    return {
      items: page.map(({ ticket: t, change: c }) => ({
        id: t.id,
        reference: refOf(t),
        title: t.title,
        status: t.status,
        changeType: c.changeType,
        risk: c.risk,
        plannedStart: c.plannedStart!,
        plannedEnd: c.plannedEnd!,
        cis: cisBy.get(t.id) ?? [],
        assignee: personRef(t.assigneeId ? people.get(t.assigneeId) : null),
        hasConflict: conflicted.has(t.id),
      })),
      nextCursor,
    };
  }

  /** Active changes among `ids` that overlap another active change on a shared CI. */
  private async conflicted(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const active = sql.join(
      ACTIVE_CHANGE_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    );
    const res = await this.ctx.db.execute<{ id: string }>(sql`
      select distinct a.ticket_id as id
        from itsm.changes a
        join itsm.tickets at on at.id = a.ticket_id and at.status in (${active})
        join itsm.ticket_cis ac on ac.ticket_id = a.ticket_id
        join itsm.ticket_cis bc on bc.ci_id = ac.ci_id and bc.ticket_id <> a.ticket_id
        join itsm.changes b on b.ticket_id = bc.ticket_id
        join itsm.tickets bt on bt.id = b.ticket_id and bt.status in (${active})
       where a.ticket_id in (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
         and b.planned_start < a.planned_end
         and b.planned_end > a.planned_start`);
    return new Set(res.rows.map((r) => r.id));
  }

  async conflicts(q: { start: Date; end: Date; ciIds?: string; exclude?: string }, auth: AuthContext) {
    assertChangeReader(auth);
    const parsed = uuidList.safeParse(
      (q.ciIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (!parsed.success)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'ciIds must be comma-separated CI ids', {
        fields: { ciIds: 'invalid' },
      });
    const items = await this.reader.conflicts(q.start, q.end, parsed.data, q.exclude);
    // Only conflicts the caller is allowed to see.
    if (!items.length) return { items };
    const visible = await this.ctx.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          inArray(
            tickets.id,
            items.map((i) => i.id),
          ),
          visibilityFilter(auth),
        ),
      );
    const ok = new Set(visible.map((v) => v.id));
    return { items: items.filter((i) => ok.has(i.id)) };
  }
}
