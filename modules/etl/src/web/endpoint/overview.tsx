'use client';

import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { ErrorState } from '@isbp/ui/empty-state';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import { ActivityIcon, DatabaseZapIcon, GaugeIcon, PercentIcon, ScrollTextIcon, ZapIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { EndpointDetail, EndpointStats, StatsPeriod } from '../../contracts';
import { ConnectionLabel, MethodBadge } from '../badges';
import { CallBars, ChartFrame, DataTableView, Legend } from '../charts';
import { dataUrl, useDuration } from '../lib';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function PeriodSwitch({ value, onChange }: { value: StatsPeriod; onChange: (p: StatsPeriod) => void }) {
  const t = useTranslations('etl.stats');
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5" role="group" aria-label={t('period')}>
      {(['24h', '7d'] as const).map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={p === value}
          onClick={() => onChange(p)}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-secondary-foreground"
        >
          {t(`periods.${p}`)}
        </button>
      ))}
    </div>
  );
}

/** Calls, error rate and p95 latency over 24 hours or 7 days, with a chart and its table twin. */
export function EndpointStatsCard({
  endpoint,
  period,
  onPeriod,
}: {
  endpoint: EndpointDetail;
  period: StatsPeriod;
  onPeriod: (p: StatsPeriod) => void;
}) {
  const t = useTranslations('etl.stats');
  const format = useFormatter();
  const duration = useDuration();
  const stats = useApiQuery<EndpointStats>(`/etl/endpoints/${endpoint.id}/stats`, { period });
  const data = stats.data;
  const label = (at: string) =>
    period === '24h'
      ? format.dateTime(new Date(at), { hour: 'numeric', minute: '2-digit' })
      : format.dateTime(new Date(at), { month: 'short', day: 'numeric' });
  if (stats.error && !data)
    return <ErrorState error={stats.error} onRetry={() => stats.refetch()} kind="section" />;
  return (
    <div className="grid min-w-0 gap-4">
      {!data ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" role="group" aria-label={t('summary')}>
          <StatTile icon={<ActivityIcon />} label={t('tiles.calls')} value={data.calls} />
          <StatTile
            icon={<PercentIcon />}
            tone={data.errors > 0 ? 'destructive' : 'default'}
            label={t('tiles.errorRate')}
            value={format.number(data.errorRate, { style: 'percent', maximumFractionDigits: 1 })}
            hint={t('errorsHint', { count: data.errors })}
            href={data.errors > 0 ? `/etl/logs?endpoint=${endpoint.id}&status=error` : undefined}
          />
          <StatTile
            icon={<GaugeIcon />}
            label={t('tiles.p95')}
            value={duration(data.p95Ms)}
            hint={t('avgHint', { avg: duration(data.avgMs) })}
          />
          <StatTile icon={<ZapIcon />} label={t('tiles.cacheHits')} value={data.cacheHits} />
        </div>
      )}
      <ChartFrame
        title={t('chartTitle')}
        description={t(`chartDescription.${period}`)}
        actions={<PeriodSwitch value={period} onChange={onPeriod} />}
        legend={
          <Legend
            items={[
              { key: 'ok', label: t('ok'), className: 'bg-chart-5' },
              { key: 'errors', label: t('errors'), className: 'bg-destructive' },
            ]}
          />
        }
        chart={
          data ? (
            <CallBars buckets={data.series} label={label} ariaLabel={t('chartTitle')} />
          ) : (
            <Skeleton className="h-36 w-full" />
          )
        }
        table={
          <DataTableView
            caption={t('chartTitle')}
            head={[t('bucket'), t('tiles.calls'), t('errors'), t('tiles.p95')]}
            rows={(data?.series ?? []).map((b) => ({
              key: b.at,
              cells: [label(b.at), format.number(b.calls), format.number(b.errors), duration(b.p95Ms)],
            }))}
          />
        }
      />
    </div>
  );
}

/** Where the API lives, who may call it and how it behaves. */
export function EndpointDetailsCard({ endpoint }: { endpoint: EndpointDetail }) {
  const t = useTranslations('etl');
  const latest = endpoint.versions.find((v) => v.version === endpoint.latestVersion);
  const def = latest?.definition ?? endpoint.draft;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseZapIcon className="size-4 text-primary" aria-hidden />
          {t('endpoint.details')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          <Field label={t('fields.url')}>
            <span className="flex min-w-0 items-center gap-2">
              <MethodBadge method={def.method} />
              <code className="truncate font-mono text-xs">{dataUrl(endpoint.slug)}</code>
            </span>
          </Field>
          <Field label={t('fields.connection')}>
            <ConnectionLabel connection={endpoint.connection} />
          </Field>
          <Field label={t('fields.kind')}>
            {def.kind === 'procedure' && def.procedure
              ? `${t('kind.procedure')} · ${def.procedure.schema}.${def.procedure.name}`
              : t('kind.query')}
          </Field>
          <Field label={t('fields.access')}>
            {[
              endpoint.allowUsers ? t('endpoint.peopleAllowed') : t('endpoint.peopleNotAllowed'),
              t('endpoint.clientsAllowed', { count: endpoint.allowedClients.length }),
            ].join(' · ')}
          </Field>
          <Field label={t('fields.rateLimit')}>
            {t('endpoint.perMinute', { n: endpoint.effectiveRateLimit })}
          </Field>
          <Field label={t('fields.cache')}>
            {def.cacheTtlSeconds
              ? t('endpoint.cacheFor', { s: def.cacheTtlSeconds })
              : t('endpoint.cacheOff')}
          </Field>
          <Field label={t('fields.maxRows')}>{def.maxRows}</Field>
        </dl>
        <Button variant="outline" size="sm" asChild className="mt-3">
          <Link href={`/etl/logs?endpoint=${endpoint.id}`}>
            <ScrollTextIcon /> {t('endpoint.viewCalls')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
