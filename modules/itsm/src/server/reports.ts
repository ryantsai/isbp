/** Service-desk overview report, computed in SQL (days are in the viewer's time zone). */
import type { ModuleContext } from '@isbp/sdk/server';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DONE_STATUSES, type overviewReportSchema, type TicketStatus, type TicketType } from '../contracts';
import { isValidTimeZone } from './business-time';
import { categoryMap, categoryRef } from './lookups';

type Overview = z.output<typeof overviewReportSchema>;
const BUCKETS = ['lt1d', '1to3d', '3to7d', '7to30d', 'gt30d'] as const;

export async function overviewReport(ctx: ModuleContext, days: number, timeZone: string): Promise<Overview> {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const db = ctx.db;
  const done = sql.join(
    DONE_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  // Local midnight `days - 1` days ago, as an instant.
  const since = sql`((date_trunc('day', now() at time zone ${tz}) - ${days - 1}::int * interval '1 day') at time zone ${tz})`;

  const [open, volume, slas, mttr, backlog, top, csat] = await Promise.all([
    db.execute<{ priority: number; type: TicketType; status: TicketStatus; n: number }>(sql`
      select priority, type, status, count(*)::int as n
        from itsm.tickets where status not in (${done})
       group by priority, type, status`),
    db.execute<{ date: string; created: number; resolved: number }>(sql`
      with days as (
        select generate_series(date_trunc('day', now() at time zone ${tz}) - ${days - 1}::int * interval '1 day',
                               date_trunc('day', now() at time zone ${tz}), interval '1 day') as d
      ), c as (
        select date_trunc('day', created_at at time zone ${tz}) as d, count(*)::int as n
          from itsm.tickets where created_at >= ${since} group by 1
      ), r as (
        select date_trunc('day', resolved_at at time zone ${tz}) as d, count(*)::int as n
          from itsm.tickets where resolved_at >= ${since} group by 1
      )
      select to_char(days.d, 'YYYY-MM-DD') as date, coalesce(c.n, 0) as created, coalesce(r.n, 0) as resolved
        from days left join c on c.d = days.d left join r on r.d = days.d
       order by days.d`),
    db.execute<{ metric: string; status: string; n: number }>(sql`
      select metric, status, count(*)::int as n from itsm.ticket_slas
       where started_at >= ${since} and status in ('met', 'breached')
       group by metric, status`),
    db.execute<{ priority: number; hours: number; n: number }>(sql`
      select priority, avg(extract(epoch from resolved_at - created_at)) / 3600.0 as hours, count(*)::int as n
        from itsm.tickets
       where resolved_at >= ${since} and type in ('incident', 'service_request')
       group by priority order by priority`),
    db.execute<{ bucket: (typeof BUCKETS)[number]; n: number }>(sql`
      select case
               when age < interval '1 day' then 'lt1d'
               when age < interval '3 days' then '1to3d'
               when age < interval '7 days' then '3to7d'
               when age < interval '30 days' then '7to30d'
               else 'gt30d' end as bucket,
             count(*)::int as n
        from (select now() - created_at as age from itsm.tickets where status not in (${done})) o
       group by 1`),
    db.execute<{ id: string; n: number }>(sql`
      select category_id as id, count(*)::int as n from itsm.tickets
       where created_at >= ${since} and category_id is not null
       group by 1 order by 2 desc limit 8`),
    db.execute<{ average: number | null; n: number; major: number }>(sql`
      select (select avg(satisfaction)::float from itsm.tickets where closed_at >= ${since} and satisfaction is not null) as average,
             (select count(*)::int from itsm.tickets where closed_at >= ${since} and satisfaction is not null) as n,
             (select count(*)::int from itsm.tickets where major and status not in (${done})) as major`),
  ]);

  const sum = <K extends string | number>(key: (r: (typeof open.rows)[number]) => K) => {
    const m = new Map<K, number>();
    for (const r of open.rows) m.set(key(r), (m.get(key(r)) ?? 0) + Number(r.n));
    return m;
  };
  const byPriority = sum((r) => Number(r.priority));
  const byType = sum((r) => r.type);
  const byStatus = sum((r) => r.status);
  const slaCount = (metric: string, status: string) =>
    Number(slas.rows.find((r) => r.metric === metric && r.status === status)?.n ?? 0);
  const cats = await categoryMap(db);
  const stats = csat.rows[0];

  return {
    days,
    open: {
      total: open.rows.reduce((n, r) => n + Number(r.n), 0),
      byPriority: [1, 2, 3, 4].map((priority) => ({ priority, count: byPriority.get(priority) ?? 0 })),
      byType: [...byType].map(([type, count]) => ({ type, count })),
      byStatus: [...byStatus].map(([status, count]) => ({ status, count })),
    },
    volume: volume.rows.map((r) => ({
      date: r.date,
      created: Number(r.created),
      resolved: Number(r.resolved),
    })),
    sla: {
      responseMet: slaCount('response', 'met'),
      responseBreached: slaCount('response', 'breached'),
      resolutionMet: slaCount('resolution', 'met'),
      resolutionBreached: slaCount('resolution', 'breached'),
    },
    mttrHours: mttr.rows.map((r) => ({
      priority: Number(r.priority),
      hours: Math.round(Number(r.hours) * 10) / 10,
      count: Number(r.n),
    })),
    backlogAge: BUCKETS.map((bucket) => ({
      bucket,
      count: Number(backlog.rows.find((r) => r.bucket === bucket)?.n ?? 0),
    })),
    topCategories: top.rows
      .map((r) => ({ category: categoryRef(cats.get(r.id)), count: Number(r.n) }))
      .filter((r): r is { category: NonNullable<typeof r.category>; count: number } => Boolean(r.category)),
    csat: {
      average: stats?.average == null ? null : Math.round(Number(stats.average) * 100) / 100,
      responses: Number(stats?.n ?? 0),
    },
    majorOpen: Number(stats?.major ?? 0),
  };
}
