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

export class ChangeCalendar {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly reader: TicketReader,
  ) {}

  async calendar(q: { from: Date; to: Date; ciId?: string }, auth: AuthContext) {
    assertChangeReader(auth);
    if (q.to <= q.from) throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, '`to` must be after `from`');
    if (q.to.getTime() - q.from.getTime() > 400 * 86_400_000)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Ask for at most 400 days at a time');
    const rows = await this.ctx.db
      .select({ ticket: tickets, change: changes })
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
        ),
      )
      .orderBy(asc(changes.plannedStart))
      .limit(1_000);
    const ids = rows.map((r) => r.ticket.id);
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
        rows.map((r) => r.ticket.assigneeId),
      ),
      this.conflicted(ids),
    ]);
    const cisBy = new Map<string, { id: string; name: string }[]>();
    for (const c of ciRows)
      cisBy.set(c.ticketId, [...(cisBy.get(c.ticketId) ?? []), { id: c.id, name: c.name }]);
    return {
      items: rows.map(({ ticket: t, change: c }) => ({
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
