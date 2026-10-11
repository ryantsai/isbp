'use client';

import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar } from '@isbp/ui/filter-bar';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { HistoryIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { RUN_STATUSES, RUN_TRIGGERS, type RunSummary, type RunView } from '../contracts';
import { RunStatusBadge, RunTriggerLabel } from './badges';
import { jobHref, runHref, useDurationMs, useRunResult } from './lib';

const ALL = '__all__';
const HOURS = ['24', '168', '720'] as const;
const FILTER_KEYS = ['q', 'status', 'trigger', 'hours'] as const;

/** A list filter: one option per value plus "all" (`undefined`). */
export function FilterSelect({
  value,
  onChange,
  allLabel,
  label,
  options,
  width = 160,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allLabel: string;
  label: string;
  options: readonly { value: string; label: string }[];
  width?: number;
}) {
  return (
    <Selector
      label={label}
      isLabelHidden
      width={width}
      value={value ?? ALL}
      onChange={(v) => onChange(v === ALL ? undefined : v)}
      options={[{ value: ALL, label: allLabel }, ...options]}
    />
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
                  weight="medium"
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
          <Link href={runHref(row.original.id)} onClick={(e) => e.stopPropagation()}>
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
              <Text type="inherit" color={r.failed ? 'primary' : 'secondary'} maxLines={2}>
                {r.text || '—'}
              </Text>
              {attempts && (
                <Text type="inherit" color="secondary">
                  {attempts}
                </Text>
              )}
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
                        options={RUN_STATUSES.map((st) => ({ value: st, label: t(`runStatus.${st}`) }))}
                      />
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
                  options={HOURS.map((h) => ({ value: h, label: t(`runs.periods.h${h}`) }))}
                />
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
                  options={RUN_TRIGGERS.map((tr) => ({ value: tr, label: t(`runTrigger.${tr}`) }))}
                />
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
