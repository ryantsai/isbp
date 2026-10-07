'use client';

import type { Page } from '@isbp/sdk';
import { DataTable, type ListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import type { ColumnDef } from '@tanstack/react-table';
import { HistoryIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { RUN_STATUSES, type RunStatus, type RunSummary } from '../contracts';
import { KindLabel, RunStatusBadge, TriggerLabel } from './badges';
import { runHref } from './lib';

const ALL = '__all__';

/** Runs of a connection (or profile), newest first; active ones refresh themselves. */
export function RunsTable({
  connectionId,
  profileId,
  state,
  set,
}: {
  connectionId?: string;
  profileId?: string;
  state: ListState;
  set: (patch: Partial<ListState>) => void;
}) {
  const t = useTranslations('integrations.runs');
  const ts = useTranslations('integrations.runStatus');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const id = useId();
  const status = RUN_STATUSES.includes(state.status as RunStatus) ? (state.status as RunStatus) : undefined;
  const { data, isLoading, isFetching } = useApiQuery<Page<RunSummary>>(
    '/integrations/runs',
    { connectionId, profileId, status, page: state.page, pageSize: state.pageSize },
    { refetchInterval: 5_000 },
  );

  const columns = useMemo<ColumnDef<RunSummary, unknown>[]>(
    () => [
      {
        id: 'run',
        header: t('run'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={runHref(row.original.id)}
              onClick={(e) => e.stopPropagation()}
              className="truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.profile.name}
            </Link>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <KindLabel kind={row.original.kind} />
              <span aria-hidden>·</span>
              <TriggerLabel trigger={row.original.trigger} />
            </span>
          </span>
        ),
      },
      {
        id: 'status',
        header: tc('status'),
        cell: ({ row }) => <RunStatusBadge status={row.original.status} />,
      },
      {
        id: 'counts',
        header: t('changes'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => {
          const c = row.original.counts;
          return (
            <span className="text-xs text-muted-foreground">
              {t('countsLine', {
                read: format.number(c.read),
                written: format.number(c.created + c.updated + c.remoteCreated + c.pushed),
                conflicts: format.number(c.conflicts),
                errors: format.number(c.errors),
              })}
            </span>
          );
        },
      },
      {
        id: 'started',
        header: t('started'),
        cell: ({ row }) => <RelativeTime date={row.original.startedAt ?? row.original.createdAt} />,
      },
    ],
    [t, tc, format],
  );

  return (
    <DataTable
      label={t('title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      loading={isLoading}
      fetching={isFetching}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(runHref(r.id))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      toolbar={
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-status`} className="sr-only">
            {tc('status')}
          </label>
          <Select value={status ?? ALL} onValueChange={(v) => set({ status: v === ALL ? undefined : v })}>
            <SelectTrigger id={`${id}-status`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
              {RUN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ts(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      empty={
        <EmptyState
          icon={<HistoryIcon />}
          title={status ? t('emptyFiltered') : t('empty')}
          description={t('emptyHint')}
        />
      }
    />
  );
}
