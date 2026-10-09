'use client';

import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar } from '@isbp/ui/filter-bar';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { HistoryIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useMemo } from 'react';
import { RUN_STATUSES, RUN_TRIGGERS, type RunSummary, type RunView } from '../contracts';
import { RunStatusBadge, RunTriggerLabel } from './badges';
import { jobHref, runHref, useDurationMs, useRunResult } from './lib';

const ALL = '__all__';
const HOURS = ['24', '168', '720'] as const;
const FILTER_KEYS = ['q', 'status', 'trigger', 'hours'] as const;

export function FilterSelect({
  value,
  onChange,
  allLabel,
  label,
  children,
  className,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allLabel: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={className ?? 'w-full sm:w-40'} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

/**
 * Run history (state in the URL): the Runs page (every job) and a job's Runs tab (`jobId`). Rows open the
 * run page with its live log.
 */
export function RunsTable({ jobId, view, label }: { jobId?: string; view?: RunView; label: string }) {
  const t = useTranslations('scheduler');
  const format = useFormatter();
  const duration = useDurationMs();
  const runResult = useRunResult();
  const router = useRouter();
  const [state, set] = useListState({ pageSize: 25 });
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<RunSummary>>(
    '/scheduler/runs',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: jobId ? undefined : state.q,
      jobId,
      view: view && view !== 'all' ? view : undefined,
      status: str('status'),
      trigger: str('trigger'),
      hours: str('hours'),
    },
    { refetchInterval: 15_000 },
  );
  const filtered = FILTER_KEYS.some((k) => str(k));

  const columns = useMemo<DataTableColumn<RunSummary>[]>(
    () => [
      ...(jobId
        ? []
        : [
            {
              id: 'job',
              header: t('runs.job'),
              meta: { sortKey: 'job', className: 'max-w-56', wrap: true },
              cell: ({ row }) => (
                <Link
                  href={jobHref(row.original.job.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="block font-medium wrap-anywhere outline-none hover:underline focus-visible:underline"
                >
                  {row.original.job.name}
                </Link>
              ),
            } satisfies DataTableColumn<RunSummary>,
          ]),
      {
        id: 'status',
        header: t('runs.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => (
          <Link
            href={runHref(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <RunStatusBadge status={row.original.status} skipReason={row.original.skipReason} />
            <span className="sr-only">{t('runs.open', { job: row.original.job.name })}</span>
          </Link>
        ),
      },
      {
        id: 'scheduledFor',
        header: t('runs.scheduledFor'),
        meta: { sortKey: 'scheduledFor', className: 'whitespace-nowrap', priority: 2 },
        cell: ({ row }) => (
          <span className="flex flex-col text-xs">
            <time dateTime={row.original.scheduledFor}>
              {format.dateTime(new Date(row.original.scheduledFor), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </time>
            <RelativeTime date={row.original.scheduledFor} className="text-muted-foreground" />
          </span>
        ),
      },
      {
        id: 'summary',
        header: t('runs.summary'),
        meta: { className: 'max-w-80 text-xs', priority: 2 },
        cell: ({ row }) => {
          const r = runResult(row.original);
          const attempts =
            row.original.attempt > 1
              ? t('runs.attemptOf', { attempt: row.original.attempt, max: row.original.maxAttempts })
              : null;
          return (
            <span className="flex flex-col gap-0.5">
              <span className={r.failed ? 'line-clamp-2' : 'line-clamp-2 text-muted-foreground'}>
                {r.text || '—'}
              </span>
              {attempts && <span className="text-muted-foreground">{attempts}</span>}
            </span>
          );
        },
      },
      {
        id: 'trigger',
        header: t('runs.trigger'),
        meta: { className: 'text-xs', priority: 3 },
        cell: ({ row }) => <RunTriggerLabel trigger={row.original.trigger} />,
      },
      {
        id: 'durationMs',
        header: t('runs.duration'),
        meta: { sortKey: 'durationMs', className: 'text-xs tabular-nums', priority: 3 },
        cell: ({ row }) => duration(row.original.durationMs),
      },
    ],
    [t, format, duration, jobId, runResult],
  );

  return (
    <DataTable
      label={label}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      loading={isLoading}
      fetching={isFetching}
      error={error}
      onRetry={() => refetch()}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(runHref(r.id))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <FilterBar
          search={
            !jobId && (
              <SearchInput
                value={state.q ?? ''}
                onChange={(q) => set({ q })}
                placeholder={t('runs.search')}
                className="sm:w-64"
              />
            )
          }
          filters={[
            ...(!view || view === 'all'
              ? [
                  {
                    id: 'status',
                    label: t('runs.status'),
                    primary: true,
                    value: str('status') ? t(`runStatus.${str('status')}`) : undefined,
                    onClear: () => set({ status: undefined }),
                    control: (
                      <FilterSelect
                        value={str('status')}
                        onChange={(v) => set({ status: v })}
                        label={t('runs.status')}
                        allLabel={t('runs.allStatuses')}
                      >
                        {RUN_STATUSES.map((st) => (
                          <SelectItem key={st} value={st}>
                            {t(`runStatus.${st}`)}
                          </SelectItem>
                        ))}
                      </FilterSelect>
                    ),
                  },
                ]
              : []),
            {
              id: 'hours',
              label: t('runs.period'),
              primary: true,
              value: str('hours') ? t(`runs.periods.h${str('hours')}`) : undefined,
              onClear: () => set({ hours: undefined }),
              control: (
                <FilterSelect
                  value={str('hours')}
                  onChange={(v) => set({ hours: v })}
                  label={t('runs.period')}
                  allLabel={t('runs.anyTime')}
                >
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {t(`runs.periods.h${h}`)}
                    </SelectItem>
                  ))}
                </FilterSelect>
              ),
            },
            {
              id: 'trigger',
              label: t('runs.trigger'),
              value: str('trigger') ? t(`runTrigger.${str('trigger')}`) : undefined,
              onClear: () => set({ trigger: undefined }),
              control: (
                <FilterSelect
                  value={str('trigger')}
                  onChange={(v) => set({ trigger: v })}
                  label={t('runs.trigger')}
                  allLabel={t('runs.allTriggers')}
                >
                  {RUN_TRIGGERS.map((tr) => (
                    <SelectItem key={tr} value={tr}>
                      {t(`runTrigger.${tr}`)}
                    </SelectItem>
                  ))}
                </FilterSelect>
              ),
            },
          ]}
          onClearAll={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
        />
      }
      empty={
        filtered ? (
          <EmptyState
            variant="filtered"
            onClearFilters={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
          />
        ) : (
          <EmptyState icon={<HistoryIcon />} title={t('runs.empty')} description={t('runs.emptyHint')} />
        )
      }
    />
  );
}
