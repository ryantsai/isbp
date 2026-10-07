'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedNumber, FadeIn, Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CoinsIcon,
  MessagesSquareIcon,
  MessageCircleIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TicketCheckIcon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useMemo } from 'react';
import type { Conversation, Overview } from '../../contracts';
import { DailyChart } from '../insights/daily-chart';
import { ModeBadge } from '../shared';

const PERIODS = ['7', '30', '90'] as const;
const ALL = '__all__';

const pct = (n: number) => `${Math.round(n)}%`;

function Kpi({
  icon,
  label,
  value,
  format,
  hint,
  empty,
}: {
  icon: ReactNode;
  label: string;
  value: number | null;
  format?: (n: number) => string;
  hint?: string;
  empty: string;
}) {
  return (
    <StaggerItem>
      <Card className="h-full gap-3 py-4">
        <CardContent className="flex items-start justify-between gap-3 px-4">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tracking-tight">
              {value === null ? (
                <span className="text-muted-foreground">{empty}</span>
              ) : (
                <AnimatedNumber value={value} format={format} />
              )}
            </p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
            {icon}
          </span>
        </CardContent>
      </Card>
    </StaggerItem>
  );
}

function Outcome({ c }: { c: Conversation }) {
  const t = useTranslations('helpdesk-ai');
  if (c.status === 'escalated')
    return (
      <Badge variant="info">
        <TicketCheckIcon aria-hidden />{' '}
        {c.ticketRef ? t('outcome.escalatedTo', { reference: c.ticketRef }) : t('outcome.escalated')}
      </Badge>
    );
  if (c.deflected)
    return (
      <Badge variant="success">
        <CircleCheckIcon aria-hidden /> {t('outcome.deflected')}
      </Badge>
    );
  return (
    <Badge variant="muted">
      <MessageCircleIcon aria-hidden /> {t('outcome.open')}
    </Badge>
  );
}

/** Accuracy, deflection and cost of Helpdesk AI, plus recent conversations for review. */
export default function InsightsPage() {
  const t = useTranslations('helpdesk-ai');
  const format = useFormatter();
  const router = useRouter();
  const canConfigure = useCan('core.ai.manage');
  const [state, set] = useListState({ pageSize: 10 });
  const days = PERIODS.includes(String(state.days) as (typeof PERIODS)[number]) ? Number(state.days) : 30;
  const status = typeof state.status === 'string' ? state.status : undefined;
  const { data, isLoading, isFetching } = useApiQuery<Overview>('/helpdesk-ai/insights/overview', { days });
  const list = useApiQuery<Page<Conversation>>('/helpdesk-ai/conversations', {
    scope: 'all',
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    sort: state.sort,
    status,
  });

  const money = useMemo(
    () => (n: number) =>
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: n > 0 && n < 1 ? 4 : 2,
      }).format(n),
    [],
  );

  const columns = useMemo<ColumnDef<Conversation, unknown>[]>(
    () => [
      {
        id: 'title',
        header: t('table.conversation'),
        meta: { sortKey: 'title', className: 'max-w-80' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            {row.original.user && (
              <UserAvatar
                name={row.original.user.displayName}
                src={row.original.user.avatarUrl}
                className="size-7"
              />
            )}
            <div className="min-w-0">
              <Link
                href={`/helpdesk-ai/conversations/${row.original.id}`}
                onClick={(e) => e.stopPropagation()}
                className="block truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {row.original.title || t('history.untitled')}
              </Link>
              <span className="block truncate text-xs text-muted-foreground">
                {row.original.user?.displayName}
              </span>
            </div>
          </div>
        ),
      },
      {
        id: 'outcome',
        header: t('table.outcome'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <Outcome c={row.original} />,
      },
      {
        id: 'language',
        header: t('table.language'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="text-muted-foreground">{t(`language.${row.original.locale}`)}</span>
        ),
      },
      {
        id: 'messages',
        header: t('table.messages'),
        meta: {
          className: 'hidden text-right tabular-nums sm:table-cell',
          headerClassName: 'hidden text-right sm:table-cell',
        },
        cell: ({ row }) => row.original.messageCount,
      },
      {
        id: 'updatedAt',
        header: t('table.updated'),
        meta: { sortKey: 'updatedAt', className: 'whitespace-nowrap text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
    ],
    [t],
  );

  const tri = data?.triage;
  const conv = data?.conversations;
  const maxStatus = tri
    ? Math.max(1, tri.applied, tri.partiallyApplied, tri.autoApplied, tri.dismissed, tri.pending)
    : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('insights.title')}
        description={t('insights.description')}
        actions={
          <>
            <Select value={String(days)} onValueChange={(v) => set({ days: v === '30' ? undefined : v })}>
              <SelectTrigger className="w-40" aria-label={t('insights.period')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t('insights.lastDays', { days: Number(p) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canConfigure && (
              <Button variant="outline" asChild>
                <Link href="/admin/ai">
                  <SettingsIcon /> {t('insights.configure')}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
          <Skeleton className="h-72 rounded-xl sm:col-span-2 xl:col-span-4" />
        </div>
      ) : (
        <div
          className={isFetching ? 'space-y-6 opacity-70 transition-opacity' : 'space-y-6 transition-opacity'}
        >
          <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={<WandSparklesIcon />}
              label={t('kpi.acceptance')}
              value={tri!.acceptanceRate === null ? null : tri!.acceptanceRate * 100}
              format={pct}
              empty="—"
              hint={t('kpi.acceptanceHint', {
                accepted: tri!.applied + tri!.partiallyApplied + tri!.autoApplied,
                decided: tri!.applied + tri!.partiallyApplied + tri!.autoApplied + tri!.dismissed,
              })}
            />
            <Kpi
              icon={<ShieldCheckIcon />}
              label={t('kpi.deflection')}
              value={conv!.deflectionRate === null ? null : conv!.deflectionRate * 100}
              format={pct}
              empty="—"
              hint={t('kpi.deflectionHint', { deflected: conv!.deflected, escalated: conv!.escalated })}
            />
            <Kpi
              icon={<MessagesSquareIcon />}
              label={t('kpi.conversations')}
              value={conv!.total}
              empty="—"
              hint={t('kpi.conversationsHint', { open: conv!.open })}
            />
            <Kpi
              icon={<CoinsIcon />}
              label={t('kpi.cost')}
              value={data.usage.costUsd}
              format={money}
              empty="—"
              hint={t('kpi.costHint', { calls: data.usage.calls })}
            />
          </Stagger>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <FadeIn delay={0.05} className="min-w-0 xl:col-span-2">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{t('chart.title')}</CardTitle>
                  <CardDescription>{t('chart.description', { days })}</CardDescription>
                </CardHeader>
                <CardContent>
                  <DailyChart data={data.daily} />
                </CardContent>
              </Card>
            </FadeIn>

            <FadeIn delay={0.1} className="min-w-0">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{t('config.title')}</CardTitle>
                  <CardDescription>{t('config.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-3 text-sm">
                    <ConfigRow label={t('config.mode')}>
                      <ModeBadge ai={data.ai} />
                    </ConfigRow>
                    <ConfigRow label={t('config.embeddings')}>
                      <span className="truncate font-mono text-xs">{data.ai.embeddings}</span>
                    </ConfigRow>
                    <ConfigRow label={t('config.vectorStore')}>
                      {t(`config.store.${data.ai.vectorStore === 'pgvector' ? 'pgvector' : 'portable'}`)}
                    </ConfigRow>
                    <ConfigRow label={t('config.triage')}>
                      <OnOff on={data.settings.triageEnabled} />
                    </ConfigRow>
                    <ConfigRow label={t('config.autoTriage')}>
                      {data.settings.autoTriage ? (
                        <span className="flex items-center gap-1.5">
                          <OnOff on />
                          <span className="text-muted-foreground">
                            {t('config.threshold', {
                              percent: Math.round(data.settings.autoTriageThreshold * 100),
                            })}
                          </span>
                        </span>
                      ) : (
                        <OnOff on={false} />
                      )}
                    </ConfigRow>
                    <ConfigRow label={t('config.virtualAgent')}>
                      <OnOff on={data.settings.virtualAgentEnabled} />
                    </ConfigRow>
                    <ConfigRow label={t('config.replies')}>
                      <OnOff on={data.settings.suggestReplies} />
                    </ConfigRow>
                  </dl>
                  {canConfigure && (
                    <Button variant="link" className="mt-3 h-auto px-0" asChild>
                      <Link href="/admin/ai">{t('insights.configure')} →</Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            </FadeIn>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn delay={0.12} className="min-w-0">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{t('breakdown.title')}</CardTitle>
                  <CardDescription>
                    {t('breakdown.description', { total: tri!.suggestions })}
                    {tri!.averageConfidence !== null &&
                      ` ${t('breakdown.confidence', { percent: Math.round(tri!.averageConfidence * 100) })}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5">
                    {(
                      [
                        ['applied', tri!.applied, CheckIcon],
                        ['partially_applied', tri!.partiallyApplied, CheckIcon],
                        ['auto_applied', tri!.autoApplied, WandSparklesIcon],
                        ['dismissed', tri!.dismissed, XIcon],
                        ['suggested', tri!.pending, CircleDashedIcon],
                      ] as const
                    ).map(([key, n, Icon]) => (
                      <li
                        key={key}
                        className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{t(`insightStatus.${key}`)}</span>
                        </span>
                        <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span
                            className="block h-full rounded-full bg-chart-1 transition-[width] duration-500"
                            style={{ width: `${(n / maxStatus) * 100}%` }}
                          />
                        </span>
                        <span className="w-8 text-right font-medium tabular-nums">{format.number(n)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs text-muted-foreground">
                    {t('breakdown.kbDrafts', { count: data.kbDrafts })}
                  </p>
                </CardContent>
              </Card>
            </FadeIn>

            <FadeIn delay={0.15} className="min-w-0">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{t('usage.title')}</CardTitle>
                  <CardDescription>{t('usage.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.usage.byFeature.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th scope="col" className="py-2 pr-3 text-left font-medium">
                              {t('usage.feature')}
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              {t('usage.calls')}
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              {t('usage.tokens')}
                            </th>
                            <th scope="col" className="py-2 pl-3 text-right font-medium">
                              {t('usage.cost')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.usage.byFeature.map((f) => {
                            const key = `features.${f.feature.replace('helpdesk-ai.', '').replace('-', '_')}`;
                            return (
                              <tr key={f.feature} className="border-b last:border-0">
                                <th scope="row" className="py-2 pr-3 text-left font-normal">
                                  {t.has(key) ? t(key) : f.feature}
                                  {f.errors > 0 && (
                                    <span className="ml-1.5 text-xs text-destructive">
                                      {t('usage.errors', { count: f.errors })}
                                    </span>
                                  )}
                                </th>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {format.number(f.calls)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {format.number(f.inputTokens + f.outputTokens, { notation: 'compact' })}
                                </td>
                                <td className="py-2 pl-3 text-right tabular-nums">{money(f.costUsd)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState
                      icon={<CoinsIcon />}
                      title={t('usage.none')}
                      description={data.ai.mode === 'builtin' ? t('usage.noneBuiltin') : undefined}
                      className="py-8"
                    />
                  )}
                </CardContent>
              </Card>
            </FadeIn>
          </div>
        </div>
      )}

      <FadeIn delay={0.18}>
        <section aria-labelledby="hai-recent" className="space-y-3">
          <div className="space-y-1">
            <h2 id="hai-recent" className="text-lg font-semibold tracking-tight">
              {t('table.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('table.description')}</p>
          </div>
          <DataTable
            label={t('table.title')}
            columns={columns}
            data={list.data?.items ?? []}
            total={list.data?.total ?? 0}
            page={state.page}
            pageSize={state.pageSize}
            sort={state.sort}
            loading={list.isLoading}
            fetching={list.isFetching}
            onPageChange={(page) => set({ page })}
            onPageSizeChange={(pageSize) => set({ pageSize })}
            onSortChange={(sort) => set({ sort })}
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(`/helpdesk-ai/conversations/${r.id}`)}
            toolbar={
              <>
                <SearchInput
                  value={state.q ?? ''}
                  onChange={(q) => set({ q })}
                  placeholder={t('table.search')}
                  className="w-full sm:w-64"
                />
                <Select
                  value={status ?? ALL}
                  onValueChange={(v) => set({ status: v === ALL ? undefined : v })}
                >
                  <SelectTrigger className="w-full sm:w-44" aria-label={t('table.outcome')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('table.allOutcomes')}</SelectItem>
                    <SelectItem value="open">{t('outcome.open')}</SelectItem>
                    <SelectItem value="resolved">{t('outcome.deflected')}</SelectItem>
                    <SelectItem value="escalated">{t('outcome.escalated')}</SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
            empty={<EmptyState icon={<MessagesSquareIcon />} title={t('table.empty')} />}
          />
        </section>
      </FadeIn>
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 justify-end">{children}</dd>
    </div>
  );
}

function OnOff({ on }: { on: boolean }) {
  const t = useTranslations('helpdesk-ai');
  return on ? (
    <Badge variant="success">
      <CheckIcon aria-hidden /> {t('config.on')}
    </Badge>
  ) : (
    <Badge variant="muted">
      <XIcon aria-hidden /> {t('config.off')}
    </Badge>
  );
}
