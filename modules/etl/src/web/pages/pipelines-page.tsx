'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ArrowRightIcon, CirclePauseIcon, PlusIcon, SearchXIcon, WorkflowIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
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
  const canManage = useCan('etl.pipelines.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const { data, isLoading, isFetching } = useApiQuery<Page<PipelineSummary>>('/etl/pipelines', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    status: view === 'failed' || view === 'running' ? (view as RunStatus) : undefined,
    enabled: view === 'disabled' ? 'false' : undefined,
  });

  const columns = useMemo<DataTableColumn<PipelineSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-72' },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <Link
              href={pipelineHref(row.original.id)}
              onClick={(e) => e.stopPropagation()}
              className="truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.name}
            </Link>
            {!row.original.enabled && (
              <span className="mt-0.5">
                <ToneBadge tone="muted" icon={CirclePauseIcon} label={t('pipelines.disabled')} />
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'flow',
        header: t('pipelines.flow'),
        meta: { className: 'hidden max-w-96 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
            <ConnectionLabel connection={row.original.source} className="max-w-56" />
            <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('pipelines.into')}</span>
            <span className="truncate font-mono text-xs">{row.original.targetTable}</span>
          </span>
        ),
      },
      {
        id: 'mode',
        header: t('fields.mode'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) =>
          `${t(`writeMode.${row.original.mode}`)}${row.original.incremental ? ` · ${t('pipelines.incremental')}` : ''}`,
      },
      {
        id: 'lastRun',
        header: t('pipelines.lastRun'),
        cell: ({ row }) => {
          const r = row.original.lastRun;
          if (!r) return <span className="text-muted-foreground">{t('pipelines.never')}</span>;
          return (
            <span className="flex min-w-0 flex-col gap-0.5">
              <RunStatusBadge status={r.status} />
              <span className="text-xs text-muted-foreground">
                <RelativeTime date={r.startedAt ?? r.createdAt} />
                {r.status === 'succeeded' &&
                  ` · ${t('pipelines.written', { n: format.number(r.rowsWritten) })}`}
              </span>
            </span>
          );
        },
      },
      {
        id: 'owner',
        header: t('fields.owner'),
        meta: { className: 'hidden max-w-44 xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) =>
          row.original.owner ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar
                name={row.original.owner.displayName}
                src={row.original.owner.avatarUrl}
                className="size-6 text-[10px]"
              />
              <span className="truncate">{row.original.owner.displayName}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
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
              <Button asChild>
                <Link href="/etl/pipelines/new">
                  <PlusIcon /> {t('pipelines.new')}
                </Link>
              </Button>
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
            <Button asChild>
              <Link href="/etl/pipelines/new">
                <PlusIcon /> {t('pipelines.new')}
              </Link>
            </Button>
          )
        }
      />
      <Tabs value={view} onValueChange={(v) => set({ view: v === 'all' ? undefined : v })}>
        <TabsList className="max-w-full overflow-x-auto">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {v === 'all' ? tc('all') : t(`pipelines.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {v === view && table}
          </TabsContent>
        ))}
      </Tabs>
      <p className="sr-only" aria-live="polite">
        {data ? t('pipelines.liveCount', { count: data.total }) : ''}
      </p>
    </>
  );
}
