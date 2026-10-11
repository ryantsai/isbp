'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { PlusIcon, RocketIcon } from 'lucide-react';
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
            weight="medium"
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
        cell: ({ row }) => row.original.name ?? <Text color="secondary">—</Text>,
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
            <Text size="xsm" color="secondary">
              —
            </Text>
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
          <Selector
            label={t('fields.status')}
            isLabelHidden
            width={192}
            value={status ?? ALL}
            onChange={(v) => set({ rstatus: v === ALL ? undefined : v })}
            options={[
              { value: ALL, label: t('releases.allStatuses') },
              { value: 'planned,in_progress,ready', label: t('releases.open') },
              ...RELEASE_STATUSES.map((st) => ({ value: st, label: t(`releaseStatus.${st}`) })),
            ]}
          />
          {onNew && (
            <Button
              label={t('app.newRelease')}
              variant="primary"
              size="sm"
              icon={<Icon icon={PlusIcon} />}
              className="ml-auto"
              onClick={onNew}
            />
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
