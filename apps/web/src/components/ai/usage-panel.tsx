'use client';

import type { AiUsageReport } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
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
import { Segmented } from '@/components/roles/segmented';
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
    <div className="space-y-6">
      <Segmented
        label={t('range')}
        value={String(days) as `${Range}`}
        onChange={(v) => setDays(Number(v) as Range)}
        options={RANGES.map((d) => ({ value: String(d) as `${Range}`, label: t('days', { count: d }) }))}
        className="w-fit"
      />
      {!data ? (
        <UsageSkeleton />
      ) : (
        // Refetching for another range keeps the previous numbers, dimmed, instead of flashing.
        <div
          className={cn('space-y-6 transition-opacity', isPlaceholderData && 'opacity-60')}
          aria-busy={isPlaceholderData || undefined}
        >
          <Kpis report={data} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
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
    <div className="space-y-6">
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
        tone={x.errors + x.blocked > 0 ? 'warning' : 'primary'}
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
  tone = 'primary',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: 'primary' | 'warning';
}) {
  return (
    <StaggerItem className="min-w-0">
      <Card className="h-full gap-2 py-4">
        <CardContent className="space-y-1 px-4">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm text-muted-foreground">{label}</p>
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-3.5',
                tone === 'warning' ? 'bg-warning/15 text-warning-foreground' : 'bg-primary/10 text-primary',
              )}
              aria-hidden
            >
              {icon}
            </span>
          </div>
          <p className="truncate text-xl font-semibold tracking-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
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
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}
          >
            {view === 'chart' ? <TableIcon aria-hidden /> : <ChartColumnIcon aria-hidden />}
            {view === 'chart' ? t('showTable') : t('showChart')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {view === 'chart' && (
          <Segmented
            label={t('measure')}
            value={effective}
            onChange={setMeasure}
            options={[
              { value: 'cost', label: t('cost') },
              { value: 'calls', label: t('calls') },
            ]}
            className="w-fit"
          />
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

function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <TableCell className={cn('text-right tabular-nums', className)}>{children}</TableCell>;
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
        {isEmpty ? <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p> : children}
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">{t('module')}</TableHead>
            <TableHead>{t('feature')}</TableHead>
            <TableHead className="text-right">{t('calls')}</TableHead>
            <TableHead className="text-right">{t('tokens')}</TableHead>
            <TableHead className="text-right">{t('cost')}</TableHead>
            <TableHead className="text-right">{t('latency')}</TableHead>
            <TableHead className="pr-5 text-right">{t('errors')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.byFeature.map((r) => (
            <TableRow key={`${r.moduleId}/${r.feature}`}>
              <TableCell className="pl-5">{moduleName(r.moduleId)}</TableCell>
              <TableCell>
                <code className="font-mono text-xs">{r.feature}</code>
              </TableCell>
              <Num>{format.number(r.calls)}</Num>
              <Num>
                {t('tokensValue', {
                  input: format.number(r.inputTokens),
                  output: format.number(r.outputTokens),
                })}
              </Num>
              <Num>{usd(r.costUsd)}</Num>
              <Num>{r.avgLatencyMs == null ? '—' : t('ms', { ms: r.avgLatencyMs })}</Num>
              <Num className={cn('pr-5', r.errors > 0 && 'text-destructive')}>
                {r.errors > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <CircleXIcon className="size-3.5" aria-hidden />
                    {format.number(r.errors)}
                  </span>
                ) : (
                  0
                )}
              </Num>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">{t('model')}</TableHead>
            <TableHead className="text-right">{t('calls')}</TableHead>
            <TableHead className="pr-5 text-right">{t('cost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.byModel.map((r) => (
            <TableRow key={`${r.provider}/${r.model ?? ''}`}>
              <TableCell className="pl-5">
                <span className="block font-medium">{r.model ? modelLabel(r.model) : '—'}</span>
                <span className="block text-xs text-muted-foreground">{provider(r.provider)}</span>
              </TableCell>
              <Num>{format.number(r.calls)}</Num>
              <Num className="pr-5">{usd(r.costUsd)}</Num>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

function StatusBadge({ status }: { status: AiUsageReport['recent'][number]['status'] }) {
  const t = useTranslations('ai.usage.recent.statuses');
  switch (status) {
    case 'ok':
      return (
        <Badge variant="success">
          <CircleCheckIcon aria-hidden /> {t('ok')}
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="destructive">
          <CircleXIcon aria-hidden /> {t('error')}
        </Badge>
      );
    case 'blocked':
      return (
        <Badge variant="warning">
          <BanIcon aria-hidden /> {t('blocked')}
        </Badge>
      );
    default:
      return (
        <Badge variant="warning">
          <BanIcon aria-hidden /> {t('refused')}
        </Badge>
      );
  }
}

function Principal({ principal }: { principal: AiUsageReport['recent'][number]['principal'] }) {
  const t = useTranslations('ai.usage.recent.principals');
  const icon =
    principal.type === 'ai_agent' ? (
      <BotIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
    ) : principal.type === 'user' ? (
      <UserIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    ) : principal.type === 'service' ? (
      <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    ) : (
      <SettingsIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    );
  const fallback =
    principal.type === 'system' ? t('system') : principal.type === 'service' ? t('service') : t('unknown');
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {principal.name ?? fallback}
      {principal.type === 'ai_agent' && <span className="sr-only">{t('agent')}</span>}
    </span>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">{t('time')}</TableHead>
            <TableHead>{t('feature')}</TableHead>
            <TableHead>{t('principal')}</TableHead>
            <TableHead>{t('model')}</TableHead>
            <TableHead className="text-right">{t('tokens')}</TableHead>
            <TableHead className="text-right">{t('cost')}</TableHead>
            <TableHead className="text-right">{t('latency')}</TableHead>
            <TableHead className="pr-5">{t('status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.recent.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="pl-5 text-muted-foreground">
                <DateTime date={r.createdAt} />
              </TableCell>
              <TableCell>
                <code className="block font-mono text-xs">{r.feature}</code>
                <span className="text-xs text-muted-foreground">
                  {t(`kinds.${r.kind}`)}
                  {r.masked > 0 && ` · ${t('masked', { count: r.masked })}`}
                </span>
              </TableCell>
              <TableCell>
                <Principal principal={r.principal} />
              </TableCell>
              <TableCell>{r.model ? modelLabel(r.model) : '—'}</TableCell>
              <Num>
                {r.kind === 'tool'
                  ? '—'
                  : t('tokensValue', {
                      input: format.number(r.inputTokens),
                      output: format.number(r.outputTokens),
                    })}
              </Num>
              <Num>{usd(r.costUsd)}</Num>
              <Num>{r.latencyMs == null ? '—' : t('ms', { ms: r.latencyMs })}</Num>
              <TableCell className="pr-5">
                <StatusBadge status={r.status} />
                {r.error && (
                  <span
                    className="mt-0.5 block max-w-56 truncate font-mono text-[11px] text-muted-foreground"
                    title={r.error}
                  >
                    {r.error}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
