'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { pixel, proportional, Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import type { AiUsageReport } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import {
  ActivityIcon,
  BanIcon,
  BotIcon,
  ChartColumnIcon,
  CircleCheckIcon,
  CircleXIcon,
  CoinsIcon,
  EyeOffIcon,
  HashIcon,
  KeyRoundIcon,
  SettingsIcon,
  ShieldMinusIcon,
  TableIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { DateTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { USAGE_PATH, modelLabel, useUsd } from './ai-meta';
import { DailyChart, type Measure } from './cost-chart';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

export function UsagePanel() {
  const t = useTranslations('ai.usage');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const raw = Number(sp.get('days'));
  const days: Range = (RANGES as readonly number[]).includes(raw) ? (raw as Range) : 30;
  const { data, isPlaceholderData } = useApiQuery<AiUsageReport>(USAGE_PATH, { days });

  const setDays = (d: Range) => {
    const next = new URLSearchParams(sp.toString());
    if (d === 30) next.delete('days');
    else next.set('days', String(d));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-5">
      <SegmentedControl label={t('range')} value={String(days)} onChange={(v) => setDays(Number(v) as Range)}>
        {RANGES.map((d) => (
          <SegmentedControlItem key={d} value={String(d)} label={t('days', { count: d })} />
        ))}
      </SegmentedControl>
      {!data ? (
        <UsageSkeleton />
      ) : (
        // Refetching for another range keeps the previous numbers, dimmed, instead of flashing.
        <div
          className={cn('space-y-5 transition-opacity', isPlaceholderData && 'opacity-60')}
          aria-busy={isPlaceholderData || undefined}
        >
          <Kpis report={data} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <DailyCard report={data} className="xl:col-span-2" />
            <ByModel report={data} />
          </div>
          <ByFeature report={data} />
          <RecentCalls report={data} />
        </div>
      )}
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

/* ───────────────────────────── KPIs ───────────────────────────── */

function Kpis({ report }: { report: AiUsageReport }) {
  const t = useTranslations('ai.usage.kpi');
  const format = useFormatter();
  const usd = useUsd();
  const n = (v: number) => format.number(v);
  const compact = (v: number) => format.number(v, { notation: v >= 10_000 ? 'compact' : 'standard' });
  const x = report.totals;
  return (
    <Stagger className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi icon={<ActivityIcon />} label={t('calls')} value={n(x.calls)} hint={t('callsHint')} />
      <Kpi
        icon={<HashIcon />}
        label={t('tokens')}
        value={compact(x.inputTokens + x.outputTokens)}
        hint={t('tokensHint', { input: compact(x.inputTokens), output: compact(x.outputTokens) })}
      />
      <Kpi icon={<CoinsIcon />} label={t('cost')} value={usd(x.costUsd)} hint={t('costHint')} />
      <Kpi icon={<EyeOffIcon />} label={t('masked')} value={n(x.masked)} hint={t('maskedHint')} />
      <Kpi
        icon={<ShieldMinusIcon />}
        label={t('errors')}
        value={n(x.errors + x.blocked)}
        hint={t('errorsHint', { errors: x.errors, blocked: x.blocked })}
        tone={x.errors + x.blocked > 0 ? 'warning' : 'default'}
      />
      <Kpi icon={<WrenchIcon />} label={t('toolCalls')} value={n(x.toolCalls)} hint={t('toolCallsHint')} />
    </Stagger>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <StaggerItem className="min-w-0">
      <StatTile icon={icon} label={label} value={value} hint={hint} tone={tone} className="h-full" />
    </StaggerItem>
  );
}

/* ───────────────────────────── daily chart ───────────────────────────── */

function DailyCard({ report, className }: { report: AiUsageReport; className?: string }) {
  const t = useTranslations('ai.usage.chart');
  // Builtin mode costs nothing: show calls first so the chart isn't a flat line.
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasCalls = report.daily.some((d) => d.calls > 0);
  const effective: Measure = measure ?? (report.totals.costUsd > 0 ? 'cost' : 'calls');

  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader>
        <CardTitle>{effective === 'cost' ? t('titleCost') : t('titleCalls')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button
            label={view === 'chart' ? t('showTable') : t('showChart')}
            variant="ghost"
            size="sm"
            icon={<Icon icon={view === 'chart' ? TableIcon : ChartColumnIcon} />}
            onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {view === 'chart' && (
          <SegmentedControl label={t('measure')} value={effective} onChange={(v) => setMeasure(v as Measure)}>
            <SegmentedControlItem value="cost" label={t('cost')} />
            <SegmentedControlItem value="calls" label={t('calls')} />
          </SegmentedControl>
        )}
        {hasCalls || view === 'table' ? (
          <DailyChart data={report.daily} measure={effective} view={view} />
        ) : (
          <EmptyState icon={<ChartColumnIcon />} title={t('empty')} className="py-10" />
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── tables ───────────────────────────── */

function useProviderLabel() {
  const t = useTranslations('ai.usage.providers');
  return (p: string) =>
    p === 'anthropic' || p === 'openai-compatible' || p === 'builtin' || p === 'tools'
      ? t(p === 'openai-compatible' ? 'openaiCompatible' : p)
      : p;
}

function useModuleName() {
  const t = useTranslations();
  return (id: string) => {
    const key = `${id}.meta.name`;
    return t.has(key) ? t(key) : id;
  };
}

function TableCard({
  title,
  description,
  empty,
  isEmpty,
  className,
  children,
}: {
  title: string;
  description?: string;
  empty: string;
  isEmpty: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className={isEmpty ? undefined : 'px-0'}>
        {isEmpty ? (
          <Text as="p" display="block" color="secondary" justify="center">
            {empty}
          </Text>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function ByFeature({ report }: { report: AiUsageReport }) {
  const t = useTranslations('ai.usage.byFeature');
  const format = useFormatter();
  const usd = useUsd();
  const moduleName = useModuleName();
  return (
    <TableCard
      title={t('title')}
      description={t('description')}
      empty={t('empty')}
      isEmpty={!report.byFeature.length}
    >
      <Table
        aria-label={t('title')}
        density="compact"
        idKey={(r) => `${r.moduleId}/${r.feature}`}
        data={report.byFeature}
        columns={[
          {
            key: 'module',
            header: t('module'),
            width: proportional(1, { minWidth: 120 }),
            renderCell: (r) => moduleName(r.moduleId),
          },
          {
            key: 'feature',
            header: t('feature'),
            width: proportional(1, { minWidth: 140 }),
            renderCell: (r) => <Text type="code">{r.feature}</Text>,
          },
          {
            key: 'calls',
            header: t('calls'),
            align: 'end',
            width: pixel(80),
            renderCell: (r) => format.number(r.calls),
          },
          {
            key: 'tokens',
            header: t('tokens'),
            align: 'end',
            width: proportional(1, { minWidth: 120 }),
            renderCell: (r) =>
              t('tokensValue', {
                input: format.number(r.inputTokens),
                output: format.number(r.outputTokens),
              }),
          },
          {
            key: 'cost',
            header: t('cost'),
            align: 'end',
            width: pixel(88),
            renderCell: (r) => usd(r.costUsd),
          },
          {
            key: 'latency',
            header: t('latency'),
            align: 'end',
            width: pixel(112),
            renderCell: (r) => (r.avgLatencyMs == null ? '—' : t('ms', { ms: r.avgLatencyMs })),
          },
          {
            key: 'errors',
            header: t('errors'),
            align: 'end',
            width: pixel(80),
            renderCell: (r) =>
              r.errors > 0 ? (
                <HStack gap={1} hAlign="end" vAlign="center">
                  <Icon icon={CircleXIcon} color="error" size="xsm" />
                  {format.number(r.errors)}
                </HStack>
              ) : (
                0
              ),
          },
        ]}
      />
    </TableCard>
  );
}

function ByModel({ report }: { report: AiUsageReport }) {
  const t = useTranslations('ai.usage.byModel');
  const format = useFormatter();
  const usd = useUsd();
  const provider = useProviderLabel();
  return (
    <TableCard title={t('title')} empty={t('empty')} isEmpty={!report.byModel.length}>
      <Table
        aria-label={t('title')}
        density="compact"
        idKey={(r) => `${r.provider}/${r.model ?? ''}`}
        data={report.byModel}
        columns={[
          {
            key: 'model',
            header: t('model'),
            width: proportional(2, { minWidth: 120 }),
            renderCell: (r) => (
              <>
                <Text as="div" display="block" weight="medium">
                  {r.model ? modelLabel(r.model) : '—'}
                </Text>
                <Text as="div" display="block" type="supporting" color="secondary">
                  {provider(r.provider)}
                </Text>
              </>
            ),
          },
          {
            key: 'calls',
            header: t('calls'),
            align: 'end',
            width: pixel(72),
            renderCell: (r) => format.number(r.calls),
          },
          {
            key: 'cost',
            header: t('cost'),
            align: 'end',
            width: pixel(88),
            renderCell: (r) => usd(r.costUsd),
          },
        ]}
      />
    </TableCard>
  );
}

function StatusBadge({ status }: { status: AiUsageReport['recent'][number]['status'] }) {
  const t = useTranslations('ai.usage.recent.statuses');
  switch (status) {
    case 'ok':
      return <Badge variant="success" label={t('ok')} icon={<Icon icon={CircleCheckIcon} size="xsm" />} />;
    case 'error':
      return <Badge variant="error" label={t('error')} icon={<Icon icon={CircleXIcon} size="xsm" />} />;
    case 'blocked':
      return <Badge variant="warning" label={t('blocked')} icon={<Icon icon={BanIcon} size="xsm" />} />;
    default:
      return <Badge variant="warning" label={t('refused')} icon={<Icon icon={BanIcon} size="xsm" />} />;
  }
}

function Principal({ principal }: { principal: AiUsageReport['recent'][number]['principal'] }) {
  const t = useTranslations('ai.usage.recent.principals');
  const icon =
    principal.type === 'ai_agent'
      ? BotIcon
      : principal.type === 'user'
        ? UserIcon
        : principal.type === 'service'
          ? KeyRoundIcon
          : SettingsIcon;
  const fallback =
    principal.type === 'system' ? t('system') : principal.type === 'service' ? t('service') : t('unknown');
  return (
    <HStack gap={1.5} vAlign="center">
      <Icon icon={icon} color={principal.type === 'ai_agent' ? 'accent' : 'secondary'} size="xsm" />
      {principal.name ?? fallback}
      {principal.type === 'ai_agent' && <span className="sr-only">{t('agent')}</span>}
    </HStack>
  );
}

function RecentCalls({ report }: { report: AiUsageReport }) {
  const t = useTranslations('ai.usage.recent');
  const format = useFormatter();
  const usd = useUsd();
  return (
    <TableCard
      title={t('title')}
      description={t('description')}
      empty={t('empty')}
      isEmpty={!report.recent.length}
    >
      <Table
        aria-label={t('title')}
        density="compact"
        idKey="id"
        data={report.recent}
        columns={[
          {
            key: 'time',
            header: t('time'),
            width: proportional(1, { minWidth: 180 }),
            renderCell: (r) => (
              <Text color="secondary">
                <DateTime date={r.createdAt} />
              </Text>
            ),
          },
          {
            key: 'feature',
            header: t('feature'),
            width: proportional(1, { minWidth: 150 }),
            renderCell: (r) => (
              <>
                <Text as="div" display="block" type="code">
                  {r.feature}
                </Text>
                <Text as="div" display="block" type="supporting" color="secondary">
                  {t(`kinds.${r.kind}`)}
                  {r.masked > 0 && ` · ${t('masked', { count: r.masked })}`}
                </Text>
              </>
            ),
          },
          {
            key: 'principal',
            header: t('principal'),
            width: proportional(1, { minWidth: 130 }),
            renderCell: (r) => <Principal principal={r.principal} />,
          },
          {
            key: 'model',
            header: t('model'),
            width: proportional(1, { minWidth: 120 }),
            renderCell: (r) => (r.model ? modelLabel(r.model) : '—'),
          },
          {
            key: 'tokens',
            header: t('tokens'),
            align: 'end',
            width: proportional(1, { minWidth: 120 }),
            renderCell: (r) =>
              r.kind === 'tool'
                ? '—'
                : t('tokensValue', {
                    input: format.number(r.inputTokens),
                    output: format.number(r.outputTokens),
                  }),
          },
          {
            key: 'cost',
            header: t('cost'),
            align: 'end',
            width: pixel(88),
            renderCell: (r) => usd(r.costUsd),
          },
          {
            key: 'latency',
            header: t('latency'),
            align: 'end',
            width: pixel(112),
            renderCell: (r) => (r.latencyMs == null ? '—' : t('ms', { ms: r.latencyMs })),
          },
          {
            key: 'status',
            header: t('status'),
            width: proportional(1, { minWidth: 120 }),
            renderCell: (r) => (
              <VStack gap={0.5}>
                <StatusBadge status={r.status} />
                {r.error && (
                  <Text type="code" color="secondary" maxLines={1}>
                    {r.error}
                  </Text>
                )}
              </VStack>
            ),
          },
        ]}
      />
    </TableCard>
  );
}
