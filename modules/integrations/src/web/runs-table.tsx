'use client';

import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, type ListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { HistoryIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
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
  const status = RUN_STATUSES.includes(state.status as RunStatus) ? (state.status as RunStatus) : undefined;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<RunSummary>>(
    '/integrations/runs',
    { connectionId, profileId, status, page: state.page, pageSize: state.pageSize },
    { refetchInterval: 5_000 },
  );

  const columns = useMemo<DataTableColumn<RunSummary>[]>(
    () => [
      {
        id: 'run',
        header: t('run'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => (
          <VStack gap={0.5} className="min-w-0">
            <Link
              href={runHref(row.original.id)}
              onClick={(e) => e.stopPropagation()}
              weight="medium"
              maxLines={1}
            >
              {row.original.profile.name}
            </Link>
            <HStack gap={2} wrap="wrap" vAlign="center">
              <KindLabel kind={row.original.kind} />
              <span aria-hidden>·</span>
              <TriggerLabel trigger={row.original.trigger} />
            </HStack>
          </VStack>
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
            <Text type="supporting">
              {t('countsLine', {
                read: format.number(c.read),
                written: format.number(c.created + c.updated + c.remoteCreated + c.pushed),
                conflicts: format.number(c.conflicts),
                errors: format.number(c.errors),
              })}
            </Text>
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
      error={error}
      onRetry={() => refetch()}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(runHref(r.id))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      toolbar={
        <Selector
          label={tc('status')}
          isLabelHidden
          width={176}
          options={[
            { value: ALL, label: t('allStatuses') },
            ...RUN_STATUSES.map((s) => ({ value: s, label: ts(s) })),
          ]}
          value={status ?? ALL}
          onChange={(v) => set({ status: v === ALL ? undefined : v })}
        />
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
