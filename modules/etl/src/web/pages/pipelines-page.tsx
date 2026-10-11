'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { ArrowRightIcon, CirclePauseIcon, PlusIcon, SearchXIcon, WorkflowIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import type { PipelineSummary, RunStatus } from '../../contracts';
import { ConnectionLabel, RunStatusBadge, ToneBadge } from '../badges';
import { pipelineHref } from '../lib';

const VIEWS = ['all', 'failed', 'running', 'disabled'] as const;
type View = (typeof VIEWS)[number];

/** ETL pipelines with their source → target and the latest run. */
export default function PipelinesPage() {
  const t = useTranslations('etl');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const panelId = useId();
  const canManage = useCan('etl.pipelines.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<PipelineSummary>>(
    '/etl/pipelines',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
      status: view === 'failed' || view === 'running' ? (view as RunStatus) : undefined,
      enabled: view === 'disabled' ? 'false' : undefined,
    },
  );
  const viewLabel = (v: View) => (v === 'all' ? tc('all') : t(`pipelines.views.${v}`));

  const columns = useMemo<DataTableColumn<PipelineSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-72', wrap: true },
        cell: ({ row }) => (
          <VStack gap={0.5} className="min-w-0">
            <Link href={pipelineHref(row.original.id)} onClick={(e) => e.stopPropagation()} weight="medium">
              {row.original.name}
            </Link>
            {!row.original.enabled && (
              <div>
                <ToneBadge tone="muted" icon={CirclePauseIcon} label={t('pipelines.disabled')} />
              </div>
            )}
          </VStack>
        ),
      },
      {
        id: 'flow',
        header: t('pipelines.flow'),
        meta: { className: 'max-w-96', priority: 2 },
        cell: ({ row }) => (
          <HStack gap={1.5} wrap="wrap" vAlign="center" className="min-w-0">
            <ConnectionLabel connection={row.original.source} className="max-w-56" />
            <Icon icon={ArrowRightIcon} color="secondary" />
            <span className="sr-only">{t('pipelines.into')}</span>
            <Text type="code" maxLines={1}>
              {row.original.targetTable}
            </Text>
          </HStack>
        ),
      },
      {
        id: 'mode',
        header: t('fields.mode'),
        meta: { priority: 3 },
        cell: ({ row }) =>
          `${t(`writeMode.${row.original.mode}`)}${row.original.incremental ? ` · ${t('pipelines.incremental')}` : ''}`,
      },
      {
        id: 'lastRun',
        header: t('pipelines.lastRun'),
        meta: { className: 'whitespace-normal' },
        cell: ({ row }) => {
          const r = row.original.lastRun;
          if (!r) return <Text color="secondary">{t('pipelines.never')}</Text>;
          return (
            <VStack gap={0.5} className="min-w-0">
              <div>
                <RunStatusBadge status={r.status} />
              </div>
              <Text type="supporting">
                <RelativeTime date={r.startedAt ?? r.createdAt} />
                {r.status === 'succeeded' &&
                  ` · ${t('pipelines.written', { n: format.number(r.rowsWritten) })}`}
              </Text>
            </VStack>
          );
        },
      },
      {
        id: 'owner',
        header: t('fields.owner'),
        meta: { className: 'max-w-44', priority: 3 },
        cell: ({ row }) =>
          row.original.owner ? (
            <HStack gap={2} vAlign="center" className="min-w-0">
              <UserAvatar
                name={row.original.owner.displayName}
                src={row.original.owner.avatarUrl}
                className="size-6 text-[10px]"
              />
              <Text maxLines={1}>{row.original.owner.displayName}</Text>
            </HStack>
          ) : (
            <Text color="secondary">—</Text>
          ),
      },
    ],
    [t, format],
  );

  const table = (
    <DataTable
      label={t('pipelines.title')}
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
      getRowId={(p) => p.id}
      onRowClick={(p) => router.push(pipelineHref(p.id))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <SearchInput
          value={state.q ?? ''}
          onChange={(q) => set({ q })}
          placeholder={t('pipelines.search')}
          className="sm:w-72"
        />
      }
      empty={
        <EmptyState
          icon={state.q ? <SearchXIcon /> : <WorkflowIcon />}
          title={state.q || view !== 'all' ? t('pipelines.emptyFiltered') : t('pipelines.empty')}
          description={t('pipelines.emptyHint')}
          action={
            canManage &&
            !state.q && (
              <Button
                label={t('pipelines.new')}
                variant="primary"
                icon={<Icon icon={PlusIcon} />}
                href="/etl/pipelines/new"
              />
            )
          }
        />
      }
    />
  );

  return (
    <>
      <PageHeader
        title={t('pipelines.title')}
        description={t('pipelines.description')}
        actions={
          canManage && (
            <Button
              label={t('pipelines.new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              href="/etl/pipelines/new"
            />
          )
        }
      />
      <VStack gap={3}>
        <TabList
          role="tablist"
          value={view}
          onChange={(v) => set({ view: v === 'all' ? undefined : v })}
          hasDivider
        >
          {VIEWS.map((v) => (
            <Tab key={v} value={v} label={viewLabel(v)} panelId={panelId} />
          ))}
        </TabList>
        {/* The tabs only filter the same list; the one panel holds it. */}
        <div role="tabpanel" id={panelId} aria-label={viewLabel(view)} className="min-w-0">
          {table}
        </div>
      </VStack>
      <p className="sr-only" aria-live="polite">
        {data ? t('pipelines.liveCount', { count: data.total }) : ''}
      </p>
    </>
  );
}
