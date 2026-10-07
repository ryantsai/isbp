'use client';

import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedNumber, Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ActivityIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleXIcon,
  GaugeIcon,
  HistoryIcon,
  LoaderCircleIcon,
  type LucideIcon,
  PlusIcon,
  TimerIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo } from 'react';
import { CHART_SERIES, type ChartSeries, type Dashboard } from '../../contracts';
import { RunStatusText } from '../badges';
import { ChartFrame, DataTableView, Legend, type SeriesDef, StackedColumns } from '../charts';
import { jobHref, runHref, useDurationMs } from '../lib';

/** Fixed categorical order: colours never move between series. */
const SERIES_COLOR: Record<ChartSeries, string> = {
  succeeded: 'bg-chart-5',
  failed: 'bg-destructive',
  timed_out: 'bg-chart-4',
  cancelled: 'bg-chart-3',
  skipped: 'bg-muted-foreground/40',
  active: 'bg-chart-1',
};

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  href,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  tone?: 'warning' | 'destructive';
}) {
  const body = (
    <div className="flex h-full items-start justify-between gap-3 rounded-xl border bg-card px-4 py-4 shadow-xs transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md motion-reduce:group-hover:translate-y-0">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-lg',
          tone === 'destructive'
            ? 'bg-destructive/10 text-destructive dark:bg-destructive/20'
            : tone === 'warning'
              ? 'bg-warning/15 text-warning-foreground'
              : 'bg-primary/10 text-primary',
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
    </div>
  );
  return (
    <StaggerItem className="h-full min-w-0">
      {href ? (
        <Link
          href={href}
          className="group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </StaggerItem>
  );
}

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
          <Button asChild variant="ghost" size="sm">
            <Link href={href}>
              {t('viewAll')}
              <ArrowRightIcon />
            </Link>
          </Button>
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

/** Monitoring: KPIs, runs per hour by status, upcoming runs, failing and slowest jobs. */
export default function OverviewPage() {
  const t = useTranslations('scheduler');
  const format = useFormatter();
  const duration = useDurationMs();
  const canCreate = useCan('scheduler.jobs.create');
  const {
    data: d,
    isLoading,
    error,
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

  const header = (
    <PageHeader
      title={t('overview.title')}
      description={t('overview.description')}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link href="/scheduler/runs">
              <HistoryIcon /> {t('nav.runs')}
            </Link>
          </Button>
          {canCreate && (
            <Button asChild>
              <Link href="/scheduler/jobs/new">
                <PlusIcon /> {t('jobs.new')}
              </Link>
            </Button>
          )}
        </>
      }
    />
  );

  if (error)
    return (
      <>
        {header}
        <EmptyState icon={<ActivityIcon />} title={t('overview.unavailable')} />
      </>
    );

  const pct = (v: number | null) =>
    v === null ? '—' : format.number(v / 100, { style: 'percent', maximumFractionDigits: 1 });
  const hourLabel = (iso: string) => format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {header}
      {isLoading || !d ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <Stagger
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            role="group"
            aria-label={t('overview.kpis')}
          >
            <Kpi
              icon={ActivityIcon}
              label={t('overview.kpi.runs24h')}
              value={<AnimatedNumber value={d.kpis.runs24h} />}
              hint={t('overview.kpi.jobsHint', { enabled: d.kpis.enabledJobs, total: d.kpis.jobs })}
              href="/scheduler/runs?hours=24"
            />
            <Kpi
              icon={CircleCheckIcon}
              label={t('overview.kpi.successRate24h')}
              value={pct(d.kpis.successRate24h)}
              hint={t('overview.kpi.successHint')}
            />
            <Kpi
              icon={GaugeIcon}
              label={t('overview.kpi.successRate7d')}
              value={pct(d.kpis.successRate7d)}
              hint={t('overview.kpi.successHint')}
            />
            <Kpi
              icon={CircleXIcon}
              label={t('overview.kpi.failingJobs')}
              value={<AnimatedNumber value={d.kpis.failingJobs} />}
              hint={t('overview.kpi.failingHint')}
              href="/scheduler/jobs?view=failing"
              tone={d.kpis.failingJobs > 0 ? 'destructive' : undefined}
            />
            <Kpi
              icon={LoaderCircleIcon}
              label={t('overview.kpi.runningNow')}
              value={<AnimatedNumber value={d.kpis.runningNow} />}
              href="/scheduler/runs?view=active"
            />
            <Kpi
              icon={TimerIcon}
              label={t('overview.kpi.avgDuration')}
              value={duration(d.kpis.avgDurationMs24h)}
              hint={t('overview.kpi.avgDurationHint')}
            />
          </Stagger>

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

          <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <ListCard
              title={t('overview.upcoming')}
              description={t('overview.upcomingHint')}
              href="/scheduler/jobs"
              empty={!d.upcoming.length}
              emptyText={t('overview.noUpcoming')}
            >
              {d.upcoming.slice(0, 10).map((u) => (
                <li
                  key={`${u.job.id}-${u.at}`}
                  className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm"
                >
                  <Link
                    href={jobHref(u.job.id)}
                    className="flex min-w-0 items-center gap-2 font-medium hover:underline"
                  >
                    <CalendarClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{u.job.name}</span>
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    <time
                      dateTime={u.at}
                      title={format.dateTime(new Date(u.at), { dateStyle: 'medium', timeStyle: 'short' })}
                    >
                      {format.dateTime(new Date(u.at), { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </span>
                </li>
              ))}
            </ListCard>
            <ListCard
              title={t('overview.failing')}
              description={t('overview.failingHint')}
              href="/scheduler/jobs?view=failing"
              empty={!d.failing.length}
              emptyText={t('overview.noFailing')}
            >
              {d.failing.map((f) => (
                <li key={f.job.id} className="grid min-w-0 gap-0.5 py-2 text-sm">
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <Link href={jobHref(f.job.id)} className="min-w-0 truncate font-medium hover:underline">
                      {f.job.name}
                    </Link>
                    <span className="shrink-0 text-xs font-medium text-destructive">
                      {t('overview.streak', { count: f.streak })}
                    </span>
                  </span>
                  {f.lastFailure && (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <Link href={runHref(f.lastFailure.runId)} className="hover:underline">
                        <RunStatusText status={f.lastFailure.status} />
                      </Link>
                      <RelativeTime date={f.lastFailure.at} />
                      {!f.enabled && <span>· {t('jobs.disabled')}</span>}
                    </span>
                  )}
                  {f.lastFailure?.error && (
                    <span className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
                      {f.lastFailure.error}
                    </span>
                  )}
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
