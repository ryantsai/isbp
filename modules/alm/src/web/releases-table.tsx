'use client';

import type { Page } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { PlusIcon, RocketIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { RELEASE_STATUSES, type ReleaseSummary } from '../contracts';
import { ReleaseStatusBadge } from './badges';
import { releaseHref } from './lib';
import { LinkedChangeChip, PlannedDate, ReadinessSummary } from './release-bits';

const ALL = '__all__';

/** An application's releases: status, planned date, linked change status and readiness. */
export function ReleasesTable({ code, onNew }: { code: string; onNew?: () => void }) {
  const t = useTranslations('alm');
  const router = useRouter();
  const [state, set] = useListState({ pageSize: 25 });
  const status = (state.rstatus as string | undefined) || undefined;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ReleaseSummary>>(
    `/alm/applications/${code}/releases`,
    {
      status,
      sort: state.sort,
      page: state.page,
      pageSize: state.pageSize,
    },
  );

  const columns = useMemo<DataTableColumn<ReleaseSummary>[]>(
    () => [
      {
        id: 'version',
        header: t('fields.version'),
        meta: { sortKey: 'version', className: 'font-mono text-sm' },
        cell: ({ row }) => (
          <Link
            href={releaseHref(code, row.original.version)}
            onClick={(e) => e.stopPropagation()}
            className="font-medium hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {row.original.version}
          </Link>
        ),
      },
      {
        id: 'name',
        header: t('fields.releaseName'),
        meta: {
          className: 'hidden max-w-56 truncate md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <ReleaseStatusBadge status={row.original.status} />,
      },
      {
        id: 'plannedDate',
        header: t('fields.plannedDate'),
        meta: { sortKey: 'plannedDate', className: 'whitespace-nowrap text-sm' },
        cell: ({ row }) =>
          row.original.releasedAt ? (
            <span className="flex flex-col">
              <PlannedDate date={row.original.plannedDate} />
              <span className="text-xs text-muted-foreground">
                {t('releases.releasedAgo')} <RelativeTime date={row.original.releasedAt} />
              </span>
            </span>
          ) : (
            <PlannedDate date={row.original.plannedDate} />
          ),
      },
      {
        id: 'change',
        header: t('fields.change'),
        meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) => <LinkedChangeChip changes={row.original.changes} />,
      },
      {
        id: 'readiness',
        header: t('fields.readiness'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) =>
          row.original.status === 'released' || row.original.status === 'cancelled' ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <ReadinessSummary readiness={row.original.readiness} />
          ),
      },
    ],
    [t, code],
  );

  return (
    <DataTable
      label={t('releases.label')}
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
      onRowClick={(r) => router.push(releaseHref(code, r.version))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <Select value={status ?? ALL} onValueChange={(v) => set({ rstatus: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-full sm:w-48" aria-label={t('fields.status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('releases.allStatuses')}</SelectItem>
              <SelectItem value="planned,in_progress,ready">{t('releases.open')}</SelectItem>
              {RELEASE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`releaseStatus.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {onNew && (
            <Button size="sm" className="ml-auto" onClick={onNew}>
              <PlusIcon /> {t('app.newRelease')}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={<RocketIcon />}
          title={t('releases.empty')}
          description={status ? t('releases.emptyFiltered') : t('releases.emptyHint')}
        />
      }
    />
  );
}
