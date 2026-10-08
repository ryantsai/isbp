'use client';

import type { Page } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { HistoryIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useMemo } from 'react';
import { RUN_STATUSES, RUN_TRIGGERS, type RunSummary, type RunView } from '../contracts';
import { RunStatusBadge, RunTriggerLabel } from './badges';
import { jobHref, runHref, useDurationMs } from './lib';

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
  const tc = useTranslations('common');
  const format = useFormatter();
  const duration = useDurationMs();
  const router = useRouter();
  const [state, set] = useListState({ pageSize: 25 });
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { data, isLoading, isFetching } = useApiQuery<Page<RunSummary>>(
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
              meta: { sortKey: 'job', className: 'max-w-56' },
              cell: ({ row }) => (
                <Link
                  href={jobHref(row.original.job.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="block truncate font-medium outline-none hover:underline focus-visible:underline"
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
        meta: { sortKey: 'scheduledFor', className: 'whitespace-nowrap' },
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
        id: 'trigger',
        header: t('runs.trigger'),
        meta: { className: 'hidden text-xs md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <RunTriggerLabel trigger={row.original.trigger} />,
      },
      {
        id: 'durationMs',
        header: t('runs.duration'),
        meta: {
          sortKey: 'durationMs',
          className: 'hidden text-xs tabular-nums sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => duration(row.original.durationMs),
      },
      {
        id: 'attempt',
        header: t('runs.attempts'),
        meta: {
          className: 'hidden text-xs tabular-nums lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) =>
          row.original.maxAttempts > 1
            ? t('runs.attemptOf', { attempt: row.original.attempt, max: row.original.maxAttempts })
            : '—',
      },
      {
        id: 'summary',
        header: t('runs.summary'),
        meta: {
          className: 'hidden max-w-80 text-xs xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => (
          <span
            className={
              row.original.error ? 'line-clamp-2 text-destructive' : 'line-clamp-2 text-muted-foreground'
            }
          >
            {row.original.error ?? row.original.summary ?? '—'}
          </span>
        ),
      },
    ],
    [t, format, duration, jobId],
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
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(runHref(r.id))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          {!jobId && (
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('runs.search')}
              className="sm:w-64"
            />
          )}
          {(!view || view === 'all') && (
            <FilterSelect
              value={str('status')}
              onChange={(v) => set({ status: v })}
              label={t('runs.status')}
              allLabel={t('runs.allStatuses')}
            >
              {RUN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`runStatus.${s}`)}
                </SelectItem>
              ))}
            </FilterSelect>
          )}
          <FilterSelect
            value={str('trigger')}
            onChange={(v) => set({ trigger: v })}
            label={t('runs.trigger')}
            allLabel={t('runs.allTriggers')}
          >
            {RUN_TRIGGERS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`runTrigger.${s}`)}
              </SelectItem>
            ))}
          </FilterSelect>
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
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
            >
              {tc('clearFilters')}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={filtered ? <SearchXIcon /> : <HistoryIcon />}
          title={t('runs.empty')}
          description={filtered ? t('runs.emptyFiltered') : t('runs.emptyHint')}
        />
      }
    />
  );
}
