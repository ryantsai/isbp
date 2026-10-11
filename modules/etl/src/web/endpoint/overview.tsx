'use client';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import { ActivityIcon, DatabaseZapIcon, GaugeIcon, PercentIcon, ScrollTextIcon, ZapIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { EndpointDetail, EndpointStats, StatsPeriod } from '../../contracts';
import { ConnectionLabel, MethodBadge } from '../badges';
import { CallBars, ChartFrame, DataTableView, Legend } from '../charts';
import { dataUrl, useDuration } from '../lib';

function PeriodSwitch({ value, onChange }: { value: StatsPeriod; onChange: (p: StatsPeriod) => void }) {
  const t = useTranslations('etl.stats');
  return (
    <ToggleButtonGroup
      label={t('period')}
      size="sm"
      value={value}
      onChange={(v) => {
        if (typeof v === 'string') onChange(v as StatsPeriod);
      }}
    >
      {(['24h', '7d'] as const).map((p) => (
        <ToggleButton key={p} value={p} label={t(`periods.${p}`)} />
      ))}
    </ToggleButtonGroup>
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
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={DatabaseZapIcon} color="accent" />
            {t('endpoint.details')}
          </HStack>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack gap={3} className="min-w-0">
          <MetadataList label={{ position: 'start', width: 136 }}>
            <MetadataListItem label={t('fields.url')}>
              <HStack gap={2} vAlign="center" className="min-w-0">
                <MethodBadge method={def.method} />
                <Text type="code" className="min-w-0 wrap-anywhere">
                  {dataUrl(endpoint.slug)}
                </Text>
              </HStack>
            </MetadataListItem>
            <MetadataListItem label={t('fields.connection')}>
              <ConnectionLabel connection={endpoint.connection} />
            </MetadataListItem>
            <MetadataListItem label={t('fields.kind')}>
              {def.kind === 'procedure' && def.procedure
                ? `${t('kind.procedure')} · ${def.procedure.schema}.${def.procedure.name}`
                : t('kind.query')}
            </MetadataListItem>
            <MetadataListItem label={t('fields.access')}>
              {[
                endpoint.allowUsers ? t('endpoint.peopleAllowed') : t('endpoint.peopleNotAllowed'),
                t('endpoint.clientsAllowed', { count: endpoint.allowedClients.length }),
              ].join(' · ')}
            </MetadataListItem>
            <MetadataListItem label={t('fields.rateLimit')}>
              {t('endpoint.perMinute', { n: endpoint.effectiveRateLimit })}
            </MetadataListItem>
            <MetadataListItem label={t('fields.cache')}>
              {def.cacheTtlSeconds
                ? t('endpoint.cacheFor', { s: def.cacheTtlSeconds })
                : t('endpoint.cacheOff')}
            </MetadataListItem>
            <MetadataListItem label={t('fields.maxRows')}>{def.maxRows}</MetadataListItem>
          </MetadataList>
          <div>
            <Button
              label={t('endpoint.viewCalls')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={ScrollTextIcon} />}
              href={`/etl/logs?endpoint=${endpoint.id}`}
            />
          </div>
        </VStack>
      </CardContent>
    </Card>
  );
}
