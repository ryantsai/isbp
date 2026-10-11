'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { useCan } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { problemOf, useRunProblemText } from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import {
  ActivityIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleXIcon,
  LoaderCircleIcon,
  PlayIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo } from 'react';
import { CHART_SERIES, type ChartSeries, type Dashboard, type RunDetail } from '../../contracts';
import { ChartFrame, DataTableView, Legend, type SeriesDef, StackedColumns } from '../charts';
import { INVALIDATE, jobHref, runHref, useDurationMs } from '../lib';
import { SchedulerHeader } from '../section-header';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/** Fixed categorical order: colours never move between series. */
const SERIES_COLOR: Record<ChartSeries, string> = {
  succeeded: 'bg-chart-5',
  failed: 'bg-destructive',
  timed_out: 'bg-chart-4',
  cancelled: 'bg-chart-3',
  skipped: 'bg-muted-foreground/40',
  active: 'bg-chart-1',
};

function ListCard({
  title,
  description,
  href,
  empty,
  emptyText,
  children,
}: {
  title: string;
  description: string;
  href: string;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  const t = useTranslations('scheduler.overview');
  const id = useId();
  return (
    <Card className="min-w-0" role="region" aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button
            label={t('viewAll')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href={href}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-success" aria-hidden />
            {emptyText}
          </p>
        ) : (
          <ul className="divide-y">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

/** What's failing first, each with why in plain words and what to do: open it or run it again. */
function FailingJobs({ failing }: { failing: Dashboard['failing'] }) {
  const t = useTranslations('scheduler');
  const problemText = useRunProblemText();
  const router = useRouter();
  const canRun = useCan('scheduler.jobs.run');
  const id = useId();
  const run = useApiMutation((api, jobId: string) => api.post<RunDetail>(`/scheduler/jobs/${jobId}/run`), {
    invalidate: INVALIDATE,
    success: t('job.runQueued'),
    onSuccess: (r) => router.push(runHref(r.id)),
  });
  return (
    <Card className="min-w-0" role="region" aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id}>
          <HStack gap={2} vAlign="center">
            {failing.length > 0 ? (
              <Icon icon={CircleXIcon} color="error" />
            ) : (
              <Icon icon={CircleCheckIcon} color="success" />
            )}
            {t('overview.failing')}
          </HStack>
        </CardTitle>
        <CardDescription>
          {failing.length > 0 ? t('overview.failingHint') : t('overview.noFailing')}
        </CardDescription>
        {failing.length > 0 && (
          <CardAction>
            <Button
              label={t('overview.viewAll')}
              variant="ghost"
              size="sm"
              endContent={<Icon icon={ArrowRightIcon} />}
              href="/scheduler/jobs?view=failing"
            />
          </CardAction>
        )}
      </CardHeader>
      {failing.length > 0 && (
        <CardContent>
          <ul className="divide-y" aria-labelledby={id}>
            {failing.map((f) => {
              const p = f.lastFailure ? problemOf(f.lastFailure.problem, f.lastFailure.error) : null;
              const reason = p ? problemText(p) : null;
              return (
                <li
                  key={f.job.id}
                  className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <Link href={jobHref(f.job.id)} className="font-medium wrap-anywhere hover:underline">
                      {f.job.name}
                    </Link>
                    {reason && <p className="wrap-anywhere">{reason.title}</p>}
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="font-medium text-destructive">
                        {t('overview.streak', { count: f.streak })}
                      </span>
                      {f.lastFailure && (
                        <Link href={runHref(f.lastFailure.runId)} className="hover:underline">
                          {t('overview.lastFailed')} <RelativeTime date={f.lastFailure.at} />
                        </Link>
                      )}
                      {!f.enabled && <span>· {t('jobs.disabled')}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {f.lastFailure && (
                      <Button
                        label={t('overview.seeRun')}
                        variant="secondary"
                        size="sm"
                        href={runHref(f.lastFailure.runId)}
                      />
                    )}
                    {canRun && f.enabled && (
                      <Button
                        label={t('job.runNow')}
                        aria-label={t('overview.runNowJob', { job: f.job.name })}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={PlayIcon} />}
                        isLoading={run.isPending && run.variables === f.job.id}
                        onClick={() => run.mutate(f.job.id)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/** Monitoring: failing jobs first, three key figures, runs per hour, what comes next and what is slow. */
export default function OverviewPage() {
  const t = useTranslations('scheduler');
  const format = useFormatter();
  const duration = useDurationMs();
  const {
    data: d,
    isLoading,
    error,
    refetch,
  } = useApiQuery<Dashboard>('/scheduler/dashboard', undefined, {
    refetchInterval: 30_000,
  });

  const series = useMemo<SeriesDef<ChartSeries>[]>(
    () => CHART_SERIES.map((s) => ({ key: s, label: t(`series.${s}`), className: SERIES_COLOR[s] })),
    [t],
  );
  const totals = useMemo(() => {
    const out = Object.fromEntries(CHART_SERIES.map((s) => [s, 0])) as Record<ChartSeries, number>;
    for (const h of d?.hourly ?? []) for (const s of CHART_SERIES) out[s] += h.counts[s] ?? 0;
    return out;
  }, [d]);

  const header = <SchedulerHeader description={t('overview.description')} />;

  if (error && !d)
    return (
      <>
        {header}
        <ErrorState error={error} onRetry={() => refetch()} kind="section" />
      </>
    );

  const pct = (v: number | null) =>
    v === null ? '—' : format.number(v / 100, { style: 'percent', maximumFractionDigits: 1 });
  const hourLabel = (iso: string) => format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });
  const time = (iso: string | Date) => format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {header}
      {isLoading || !d ? (
        <div className="space-y-5">
          <Skeleton className="h-28 rounded-xl" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          <FailingJobs failing={d.failing} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label={t('overview.kpis')}>
            <StatTile
              icon={<ActivityIcon />}
              label={t('overview.kpi.runs24h')}
              value={d.kpis.runs24h}
              hint={t('overview.kpi.jobsHint', { enabled: d.kpis.enabledJobs, total: d.kpis.jobs })}
              href="/scheduler/runs?hours=24"
            />
            <StatTile
              icon={<CircleCheckIcon />}
              tone="success"
              label={t('overview.kpi.successRate24h')}
              value={pct(d.kpis.successRate24h)}
              hint={t('overview.kpi.successHint7d', { rate: pct(d.kpis.successRate7d) })}
              href="/scheduler/runs?hours=24&view=failed"
            />
            <StatTile
              icon={<LoaderCircleIcon />}
              tone="info"
              label={t('overview.kpi.runningNow')}
              value={d.kpis.runningNow}
              hint={
                d.kpis.avgDurationMs24h !== null
                  ? t('overview.kpi.avgHint', { duration: duration(d.kpis.avgDurationMs24h) })
                  : undefined
              }
              href="/scheduler/runs?view=active"
            />
          </div>

          <ChartFrame
            title={t('overview.hourly')}
            description={t('overview.hourlyHint')}
            legend={<Legend series={series} totals={totals} />}
            chart={
              <StackedColumns
                ariaLabel={t('overview.hourly')}
                series={series}
                buckets={d.hourly.map((h) => ({
                  key: h.hour,
                  label: hourLabel(h.hour),
                  text: format.dateTime(new Date(h.hour), {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                  counts: h.counts,
                }))}
              />
            }
            table={
              <DataTableView
                caption={t('overview.hourly')}
                head={[t('overview.hour'), ...series.map((s) => s.label), t('overview.total')]}
                rows={d.hourly.map((h) => ({
                  key: h.hour,
                  cells: [
                    format.dateTime(new Date(h.hour), {
                      weekday: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                    ...CHART_SERIES.map((s) => format.number(h.counts[s] ?? 0)),
                    format.number(CHART_SERIES.reduce((n, s) => n + (h.counts[s] ?? 0), 0)),
                  ],
                }))}
              />
            }
          />

          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
            <ListCard
              title={t('overview.upcoming')}
              description={t('overview.upcomingHint')}
              href="/scheduler/jobs"
              empty={!d.upcoming.length}
              emptyText={t('overview.noUpcoming')}
            >
              {d.upcoming.map((u) => (
                <li key={u.job.id} className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm">
                  <Link
                    href={jobHref(u.job.id)}
                    className="flex min-w-0 items-center gap-2 font-medium hover:underline"
                  >
                    <CalendarClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{u.job.name}</span>
                  </Link>
                  <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    <time
                      dateTime={String(u.at)}
                      title={format.dateTime(new Date(u.at), { dateStyle: 'medium', timeStyle: 'short' })}
                    >
                      {t('overview.nextAt', { time: time(u.at) })}
                    </time>
                    {u.count > 1 && (
                      <span className="block">{t('overview.runsIn24h', { count: u.count })}</span>
                    )}
                  </span>
                </li>
              ))}
            </ListCard>
            <ListCard
              title={t('overview.slowest')}
              description={t('overview.slowestHint')}
              href="/scheduler/runs?sort=-durationMs&hours=168"
              empty={!d.slowest.length}
              emptyText={t('overview.noRuns')}
            >
              {d.slowest.map((s) => (
                <li key={s.job.id} className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm">
                  <Link href={jobHref(s.job.id)} className="min-w-0 truncate font-medium hover:underline">
                    {s.job.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t('overview.p95', { duration: duration(s.p95Ms), runs: s.runs })}
                  </span>
                </li>
              ))}
            </ListCard>
          </div>
        </div>
      )}
    </>
  );
}
