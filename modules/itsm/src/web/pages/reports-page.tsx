'use client';

import { usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { ErrorState } from '@isbp/ui/empty-state';
import { SectionTabs } from '@isbp/ui/section-tabs';
import { StatTile } from '@isbp/ui/stat-tile';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { AlarmClockOffIcon, InboxIcon, ShieldCheckIcon, SmileIcon, TimerIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useListState } from '@isbp/ui/data-table';
import type { OverviewReport } from '../../contracts';
import {
  ChartFrame,
  Columns,
  DataTableView,
  HBars,
  LineChart,
  LineLegend,
  type LineSeries,
  useDayLabel,
} from '../components/report-charts';
import { useCategoryLabel, useHours } from '../lib';

const RANGES = [7, 30, 90] as const;
const BUCKETS = ['lt1d', '1to3d', '3to7d', '7to30d', 'gt30d'] as const;

/** Service desk dashboard: KPIs, volume, backlog and categories for the last 7 / 30 / 90 days. */
export default function ReportsPage() {
  const t = useTranslations('itsm.reports');
  const tt = useTranslations('itsm');
  const format = useFormatter();
  const hours = useHours();
  const dayLabel = useDayLabel();
  const categoryLabel = useCategoryLabel();
  const [state, set] = useListState();
  const days = RANGES.includes(Number(state.days) as (typeof RANGES)[number]) ? Number(state.days) : 30;
  const { enabledModules } = usePlatform();
  // AI insights (Helpdesk AI) is the second tab: report readers see its metrics too.
  const canInsights = enabledModules.includes('helpdesk-ai');
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<OverviewReport>(
    '/itsm/reports/overview',
    {
      days,
    },
  );

  const kpis = useMemo(() => {
    if (!data) return null;
    const met = data.sla.responseMet + data.sla.resolutionMet;
    const breached = data.sla.responseBreached + data.sla.resolutionBreached;
    const resolvedCount = data.mttrHours.reduce((a, m) => a + m.count, 0);
    const mttr = resolvedCount
      ? data.mttrHours.reduce((a, m) => a + m.hours * m.count, 0) / resolvedCount
      : null;
    return {
      compliance: met + breached ? met / (met + breached) : null,
      breached,
      mttr,
      resolvedCount,
    };
  }, [data]);

  const series = useMemo<LineSeries[]>(
    () =>
      data
        ? [
            {
              key: 'created',
              label: t('created'),
              color: 'chart-1',
              values: data.volume.map((v) => v.created),
            },
            {
              key: 'resolved',
              label: t('resolved'),
              color: 'chart-2',
              values: data.volume.map((v) => v.resolved),
            },
          ]
        : [],
    [data, t],
  );

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {canInsights && (
        <SectionTabs
          label={t('sections.label')}
          items={[
            { href: '/itsm/reports', label: t('sections.serviceDesk') },
            { href: '/helpdesk-ai', label: t('sections.ai'), match: 'exact' },
          ]}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5"
          role="group"
          aria-label={t('range')}
        >
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={days === r}
              onClick={() => set({ days: r === 30 ? undefined : r })}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-secondary-foreground"
            >
              {t('lastDays', { days: r })}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : error || !data || !kpis ? (
        <ErrorState
          error={error}
          title={t('loadFailed')}
          onRetry={() => void refetch()}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <div
          className={cn('grid gap-4 transition-opacity', isFetching && 'opacity-70')}
          aria-busy={isFetching || undefined}
        >
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <StatTile
              icon={<InboxIcon />}
              label={t('kpi.open')}
              value={data.open.total}
              hint={data.majorOpen ? t('kpi.majorOpen', { count: data.majorOpen }) : t('kpi.openHint')}
              tone={data.majorOpen ? 'destructive' : undefined}
              href="/itsm?type=__all__"
            />
            <StatTile
              icon={<AlarmClockOffIcon />}
              label={t('kpi.breached')}
              value={kpis.breached}
              hint={t('kpi.breachedHint', {
                response: data.sla.responseBreached,
                resolution: data.sla.resolutionBreached,
              })}
              tone={kpis.breached ? 'destructive' : undefined}
              href="/itsm?view=attention"
            />
            <StatTile
              icon={<TimerIcon />}
              label={t('kpi.mttr')}
              value={kpis.mttr === null ? '—' : hours(kpis.mttr)}
              hint={t('kpi.mttrHint', { count: kpis.resolvedCount })}
            />
            <StatTile
              icon={<SmileIcon />}
              label={t('kpi.csat')}
              value={
                data.csat.average === null
                  ? '—'
                  : `${format.number(data.csat.average, { maximumFractionDigits: 1 })} / 5`
              }
              hint={t('kpi.csatHint', { count: data.csat.responses })}
            />
            <StatTile
              icon={<ShieldCheckIcon />}
              label={t('kpi.compliance')}
              value={
                kpis.compliance === null
                  ? '—'
                  : format.number(kpis.compliance, { style: 'percent', maximumFractionDigits: 1 })
              }
              hint={t('kpi.complianceHint')}
              tone={kpis.compliance !== null && kpis.compliance >= 0.9 ? 'success' : undefined}
              className="col-span-2 lg:col-span-1"
            />
          </div>

          <ChartFrame
            title={t('volume.title')}
            description={t('volume.description', { days })}
            busy={isFetching}
            legend={<LineLegend series={series} />}
            chart={
              data.volume.length ? (
                <LineChart
                  labels={data.volume.map((v) => v.date)}
                  series={series}
                  formatLabel={(d) => dayLabel(d)}
                  ariaLabel={t('volume.aria', { days })}
                />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">{t('noData')}</p>
              )
            }
            table={
              <DataTableView
                head={[t('date'), t('created'), t('resolved')]}
                rows={data.volume.map((v) => [
                  dayLabel(v.date, { dateStyle: 'medium' }),
                  v.created,
                  v.resolved,
                ])}
              />
            }
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartFrame
              title={t('byPriority.title')}
              description={t('byPriority.description')}
              busy={isFetching}
              chart={
                <HBars
                  ariaLabel={t('byPriority.title')}
                  items={[1, 2, 3, 4].map((p) => ({
                    key: String(p),
                    label: tt(`priority.${p}`),
                    value: data.open.byPriority.find((x) => x.priority === p)?.count ?? 0,
                    href: `/itsm?type=__all__&priority=${p}`,
                  }))}
                />
              }
              table={
                <DataTableView
                  head={[t('priority'), t('count')]}
                  rows={[1, 2, 3, 4].map((p) => [
                    tt(`priority.${p}`),
                    data.open.byPriority.find((x) => x.priority === p)?.count ?? 0,
                  ])}
                />
              }
            />
            <ChartFrame
              title={t('backlog.title')}
              description={t('backlog.description')}
              busy={isFetching}
              chart={
                <Columns
                  ariaLabel={t('backlog.title')}
                  items={BUCKETS.map((b) => ({
                    key: b,
                    label: t(`backlog.${b}`),
                    value: data.backlogAge.find((x) => x.bucket === b)?.count ?? 0,
                  }))}
                />
              }
              table={
                <DataTableView
                  head={[t('backlog.age'), t('count')]}
                  rows={BUCKETS.map((b) => [
                    t(`backlog.${b}`),
                    data.backlogAge.find((x) => x.bucket === b)?.count ?? 0,
                  ])}
                />
              }
            />
            <ChartFrame
              title={t('categories.title')}
              description={t('categories.description', { days })}
              busy={isFetching}
              chart={
                data.topCategories.length ? (
                  <HBars
                    ariaLabel={t('categories.title')}
                    items={data.topCategories.map((c) => ({
                      key: c.category.id,
                      label: categoryLabel(c.category),
                      hint: categoryLabel(c.category) ?? undefined,
                      value: c.count,
                      href: `/itsm?type=__all__&status=any&categoryId=${c.category.id}`,
                    }))}
                  />
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t('noData')}</p>
                )
              }
              table={
                <DataTableView
                  head={[t('category'), t('count')]}
                  rows={data.topCategories.map((c) => [categoryLabel(c.category) ?? '—', c.count])}
                />
              }
            />
            <ChartFrame
              title={t('mttr.title')}
              description={t('mttr.description', { days })}
              busy={isFetching}
              chart={
                <HBars
                  ariaLabel={t('mttr.title')}
                  formatValue={(v) => (v ? hours(v) : '—')}
                  items={[1, 2, 3, 4].map((p) => ({
                    key: String(p),
                    label: tt(`priority.${p}`),
                    value: data.mttrHours.find((x) => x.priority === p)?.hours ?? 0,
                  }))}
                />
              }
              table={
                <DataTableView
                  head={[t('priority'), t('mttr.hours'), t('mttr.resolved')]}
                  rows={[1, 2, 3, 4].map((p) => {
                    const m = data.mttrHours.find((x) => x.priority === p);
                    return [tt(`priority.${p}`), m ? hours(m.hours) : '—', m?.count ?? 0];
                  })}
                />
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
