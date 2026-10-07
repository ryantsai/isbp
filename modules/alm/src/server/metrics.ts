import type { ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, gte, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { dashboardSchema, doraSchema } from '../contracts';
import {
  APP_STAGES,
  assembleDora,
  type AppStage,
  CRITICALITIES,
  type Criticality,
  type DoraFacts,
} from '../model';
import type { ApplicationService } from './applications';
import type { ReleaseService } from './releases';
import { applications, deployments, environments } from './schema';

const DAY_MS = 86_400_000;
const CRITICALITY_RANK = sql`case ${applications.criticality} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

/** DORA-style delivery metrics and the portfolio dashboard — aggregated in SQL. */
export class MetricsService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly apps: ApplicationService,
    private readonly releases: ReleaseService,
  ) {}

  /**
   * Production delivery metrics over the last `days` days: deployment frequency, change failure rate,
   * median lead time (release created → first successful production deployment) and median time to
   * restore (failed production deployment → next success on that environment), plus a weekly series.
   */
  async dora(appRef: string, days: number, now = new Date()): Promise<z.output<typeof doraSchema>> {
    const app = await this.apps.resolve(appRef);
    const to = now;
    const from = new Date(to.getTime() - days * DAY_MS);
    const inWindow = and(
      eq(deployments.applicationId, app.id),
      eq(environments.kind, 'production'),
      gte(deployments.startedAt, from),
      lt(deployments.startedAt, to),
    );
    const week = sql<string>`to_char(date_trunc('week', ${deployments.startedAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    const [[totals], weeks, lead, restore] = await Promise.all([
      this.ctx.db
        .select({
          succeeded: sql<number>`count(*) filter (where ${deployments.status} = 'succeeded')`.mapWith(Number),
          failed: sql<number>`count(*) filter (where ${deployments.status} = 'failed')`.mapWith(Number),
          rolledBack: sql<number>`count(*) filter (where ${deployments.status} = 'rolled_back')`.mapWith(
            Number,
          ),
        })
        .from(deployments)
        .innerJoin(environments, eq(environments.id, deployments.environmentId))
        .where(inWindow),
      this.ctx.db
        .select({
          week,
          succeeded: sql<number>`count(*) filter (where ${deployments.status} = 'succeeded')`.mapWith(Number),
          failed:
            sql<number>`count(*) filter (where ${deployments.status} in ('failed', 'rolled_back'))`.mapWith(
              Number,
            ),
        })
        .from(deployments)
        .innerJoin(environments, eq(environments.id, deployments.environmentId))
        .where(inWindow)
        .groupBy(week),
      this.ctx.db.execute<{ median: number | null; samples: number }>(sql`
        select percentile_cont(0.5) within group (order by minutes) as median, count(*)::int as samples
        from (
          select greatest(0, extract(epoch from (f.first_at - r.created_at)) / 60) as minutes
          from alm.releases r
          join lateral (
            select min(coalesce(d.finished_at, d.started_at)) as first_at
            from alm.deployments d
            join alm.environments e on e.id = d.environment_id
            where d.release_id = r.id and e.kind = 'production' and d.status = 'succeeded'
          ) f on f.first_at is not null
          where r.application_id = ${app.id} and f.first_at >= ${from} and f.first_at < ${to}
        ) t`),
      this.ctx.db.execute<{ median: number | null; samples: number }>(sql`
        select percentile_cont(0.5) within group (order by minutes) as median, count(*)::int as samples
        from (
          select greatest(0, extract(epoch from (n.next_at - coalesce(d.finished_at, d.started_at))) / 60) as minutes
          from alm.deployments d
          join alm.environments e on e.id = d.environment_id and e.kind = 'production'
          join lateral (
            select coalesce(s.finished_at, s.started_at) as next_at
            from alm.deployments s
            where s.environment_id = d.environment_id and s.status = 'succeeded' and s.started_at > d.started_at
            order by s.started_at
            limit 1
          ) n on true
          where d.application_id = ${app.id} and d.status in ('failed', 'rolled_back')
            and d.started_at >= ${from} and d.started_at < ${to}
        ) t`),
    ]);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const facts: DoraFacts = {
      succeeded: totals?.succeeded ?? 0,
      failed: totals?.failed ?? 0,
      rolledBack: totals?.rolledBack ?? 0,
      leadTimeMinutes: num(lead.rows[0]?.median),
      leadTimeSamples: Number(lead.rows[0]?.samples ?? 0),
      restoreMinutes: num(restore.rows[0]?.median),
      restoreSamples: Number(restore.rows[0]?.samples ?? 0),
      weeks,
    };
    return assembleDora(facts, from, to);
  }

  /** The inventory's summary strip and the portfolio dashboard. */
  async dashboard(): Promise<z.output<typeof dashboardSchema>> {
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    const live = ne(applications.stage, 'retired');
    const ownerless = or(isNull(applications.businessOwnerId), isNull(applications.technicalOwnerId));
    const ciless = isNull(applications.ciId);
    const [stages, crits, [week], upcoming, ownerRows, [ownerCount], ciRows, [ciCount]] = await Promise.all([
      this.ctx.db
        .select({ stage: applications.stage, n: count() })
        .from(applications)
        .groupBy(applications.stage),
      this.ctx.db
        .select({ criticality: applications.criticality, n: count() })
        .from(applications)
        .where(live)
        .groupBy(applications.criticality),
      this.ctx.db
        .select({
          succeeded: sql<number>`count(*) filter (where ${deployments.status} = 'succeeded')`.mapWith(Number),
          failed:
            sql<number>`count(*) filter (where ${deployments.status} in ('failed', 'rolled_back'))`.mapWith(
              Number,
            ),
          inProgress: sql<number>`count(*) filter (where ${deployments.status} = 'in_progress')`.mapWith(
            Number,
          ),
          total: count(),
        })
        .from(deployments)
        .where(gte(deployments.startedAt, weekAgo)),
      this.releases.upcoming(14, 8),
      this.ctx.db
        .select({
          id: applications.id,
          code: applications.code,
          name: applications.name,
          bo: applications.businessOwnerId,
          to: applications.technicalOwnerId,
        })
        .from(applications)
        .where(and(live, ownerless))
        .orderBy(CRITICALITY_RANK, asc(applications.name))
        .limit(5),
      this.ctx.db.select({ n: count() }).from(applications).where(and(live, ownerless)),
      this.ctx.db
        .select({ id: applications.id, code: applications.code, name: applications.name })
        .from(applications)
        .where(and(live, ciless))
        .orderBy(CRITICALITY_RANK, asc(applications.name))
        .limit(5),
      this.ctx.db.select({ n: count() }).from(applications).where(and(live, ciless)),
    ]);
    const byStage = Object.fromEntries(APP_STAGES.map((s) => [s, 0])) as Record<AppStage, number>;
    for (const r of stages) byStage[r.stage] = r.n;
    const byCriticality = Object.fromEntries(CRITICALITIES.map((c) => [c, 0])) as Record<Criticality, number>;
    for (const r of crits) byCriticality[r.criticality] = r.n;
    return {
      total: Object.values(byStage).reduce((a, b) => a + b, 0),
      byStage,
      byCriticality,
      week: {
        succeeded: week?.succeeded ?? 0,
        failed: week?.failed ?? 0,
        inProgress: week?.inProgress ?? 0,
        total: week?.total ?? 0,
      },
      upcoming,
      withoutOwner: {
        total: ownerCount?.n ?? 0,
        items: ownerRows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          missing: [...(r.bo ? [] : ['business' as const]), ...(r.to ? [] : ['technical' as const])],
        })),
      },
      withoutCi: { total: ciCount?.n ?? 0, items: ciRows },
    };
  }
}
