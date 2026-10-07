import type { ModuleContext } from '@isbp/sdk/server';
import { and, desc, eq, gt, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { type AttentionOut, CHART_SERIES, type ChartSeries, type DashboardOut } from '../contracts';
import type { RunStatus } from '../model';
import { runsBetween } from '../schedule';
import { specOf } from './engine';
import { jobs, runs } from './schema';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const seriesOf = (s: RunStatus): ChartSeries =>
  s === 'queued' || s === 'running' || s === 'retrying' ? 'active' : s;

const rate = (ok: number, bad: number) => (ok + bad ? Math.round((ok / (ok + bad)) * 1000) / 10 : null);

/** The monitoring dashboard: KPIs, runs per hour, what's coming, what's failing and what's slow. */
export class DashboardService {
  constructor(private readonly ctx: ModuleContext) {}

  async dashboard(now = new Date()): Promise<DashboardOut> {
    const db = this.ctx.db;
    const day = new Date(now.getTime() - DAY);
    const week = new Date(now.getTime() - 7 * DAY);
    const firstHour = new Date(Math.floor(now.getTime() / HOUR) * HOUR - 23 * HOUR);

    const [[k], [jobCounts], [running], hourly, upcomingJobs, failing, slowest] = await Promise.all([
      db
        .select({
          runs24h: sql<number>`count(*) filter (where ${runs.createdAt} >= ${day})::int`,
          ok24: sql<number>`count(*) filter (where ${runs.createdAt} >= ${day} and ${runs.status} = 'succeeded')::int`,
          bad24: sql<number>`count(*) filter (where ${runs.createdAt} >= ${day} and ${runs.status} in ('failed', 'timed_out'))::int`,
          ok7: sql<number>`count(*) filter (where ${runs.status} = 'succeeded')::int`,
          bad7: sql<number>`count(*) filter (where ${runs.status} in ('failed', 'timed_out'))::int`,
          avg24: sql<
            number | null
          >`round(avg(${runs.durationMs}) filter (where ${runs.createdAt} >= ${day} and ${runs.status} in ('succeeded', 'failed', 'timed_out')))::int`,
        })
        .from(runs)
        .where(gte(runs.createdAt, week)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          enabled: sql<number>`count(*) filter (where ${jobs.enabled})::int`,
          failing: sql<number>`count(*) filter (where ${jobs.failureStreak} > 0)::int`,
        })
        .from(jobs),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(runs)
        .where(eq(runs.status, 'running')),
      db
        .select({
          hour: sql<Date>`date_trunc('hour', ${runs.createdAt})`.mapWith((v: string | Date) => new Date(v)),
          status: runs.status,
          n: sql<number>`count(*)::int`,
        })
        .from(runs)
        .where(gte(runs.createdAt, firstHour))
        .groupBy(sql`date_trunc('hour', ${runs.createdAt})`, runs.status),
      db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.enabled, true),
            isNotNull(jobs.nextRunAt),
            lte(jobs.nextRunAt, new Date(now.getTime() + DAY)),
            inArray(jobs.triggerKind, ['cron', 'interval']),
          ),
        ),
      db
        .select({
          id: jobs.id,
          name: jobs.name,
          type: jobs.type,
          enabled: jobs.enabled,
          streak: jobs.failureStreak,
        })
        .from(jobs)
        .where(gt(jobs.failureStreak, 0))
        .orderBy(desc(jobs.failureStreak), jobs.name)
        .limit(8),
      db
        .select({
          jobId: runs.jobId,
          name: jobs.name,
          type: jobs.type,
          p95: sql<number>`round(percentile_cont(0.95) within group (order by ${runs.durationMs}))::int`,
          runs: sql<number>`count(*)::int`,
        })
        .from(runs)
        .innerJoin(jobs, eq(jobs.id, runs.jobId))
        .where(and(eq(runs.status, 'succeeded'), gte(runs.createdAt, week), isNotNull(runs.durationMs)))
        .groupBy(runs.jobId, jobs.name, jobs.type)
        .orderBy(sql`percentile_cont(0.95) within group (order by ${runs.durationMs}) desc`)
        .limit(5),
    ]);

    const buckets = Array.from({ length: 24 }, (_, i) => ({
      hour: new Date(firstHour.getTime() + i * HOUR),
      counts: Object.fromEntries(CHART_SERIES.map((s) => [s, 0])) as Record<ChartSeries, number>,
    }));
    for (const h of hourly) {
      const idx = Math.round((h.hour.getTime() - firstHour.getTime()) / HOUR);
      const b = buckets[idx];
      if (b) b.counts[seriesOf(h.status)] += h.n;
    }

    const until = new Date(now.getTime() + DAY);
    const upcoming = upcomingJobs
      .flatMap((j) =>
        runsBetween(specOf(j), j.nextRunAt, until, 50).map((at) => ({
          job: { id: j.id, name: j.name, type: j.type },
          at,
        })),
      )
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, 25);

    const failures = failing.length
      ? await db
          .selectDistinctOn([runs.jobId], {
            jobId: runs.jobId,
            runId: runs.id,
            status: runs.status,
            at: runs.finishedAt,
            createdAt: runs.createdAt,
            error: runs.error,
          })
          .from(runs)
          .where(
            and(
              inArray(
                runs.jobId,
                failing.map((f) => f.id),
              ),
              inArray(runs.status, ['failed', 'timed_out']),
            ),
          )
          .orderBy(runs.jobId, desc(runs.createdAt))
      : [];
    const failureOf = new Map(failures.map((f) => [f.jobId, f]));

    return {
      kpis: {
        runs24h: k!.runs24h,
        successRate24h: rate(k!.ok24, k!.bad24),
        successRate7d: rate(k!.ok7, k!.bad7),
        failingJobs: jobCounts!.failing,
        runningNow: running!.n,
        avgDurationMs24h: k!.avg24,
        jobs: jobCounts!.total,
        enabledJobs: jobCounts!.enabled,
      },
      hourly: buckets,
      upcoming,
      failing: failing.map((f) => {
        const last = failureOf.get(f.id);
        return {
          job: { id: f.id, name: f.name, type: f.type },
          streak: f.streak,
          enabled: f.enabled,
          lastFailure: last
            ? {
                runId: last.runId,
                status: last.status,
                at: last.at ?? last.createdAt,
                error: last.error,
              }
            : null,
        };
      }),
      slowest: slowest.map((s) => ({
        job: { id: s.jobId, name: s.name, type: s.type },
        p95Ms: s.p95,
        runs: s.runs,
      })),
    };
  }

  /** "Failing jobs" on the home dashboard. */
  async attention(): Promise<AttentionOut> {
    const db = this.ctx.db;
    const [items, [counts], [running]] = await Promise.all([
      db
        .select({ id: jobs.id, name: jobs.name, type: jobs.type, streak: jobs.failureStreak })
        .from(jobs)
        .where(gt(jobs.failureStreak, 0))
        .orderBy(desc(jobs.failureStreak), jobs.name)
        .limit(5),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(gt(jobs.failureStreak, 0)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(runs)
        .where(eq(runs.status, 'running')),
    ]);
    const last = items.length
      ? await db
          .selectDistinctOn([runs.jobId], { jobId: runs.jobId, runId: runs.id, at: runs.finishedAt })
          .from(runs)
          .where(
            and(
              inArray(
                runs.jobId,
                items.map((i) => i.id),
              ),
              inArray(runs.status, ['failed', 'timed_out']),
            ),
          )
          .orderBy(runs.jobId, desc(runs.createdAt))
      : [];
    const byJob = new Map(last.map((l) => [l.jobId, l]));
    return {
      failingJobs: counts!.n,
      runningNow: running!.n,
      items: items.map((i) => ({
        job: { id: i.id, name: i.name, type: i.type },
        streak: i.streak,
        at: byJob.get(i.id)?.at ?? null,
        runId: byJob.get(i.id)?.runId ?? null,
      })),
    };
  }
}
