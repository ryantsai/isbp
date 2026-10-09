'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { DatabaseZapIcon, FileJsonIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type EndpointStatus, type EndpointSummary, ENDPOINT_STATUSES } from '../../contracts';
import { ConnectionLabel, DraftBadge, EndpointStatusBadge, MethodBadge, TONE } from '../badges';
import { CreateEndpointDialog } from '../endpoint/create-dialog';
import { endpointHref } from '../lib';
import { DataApiTabs } from '../section-tabs';

const VIEWS = ['all', ...ENDPOINT_STATUSES] as const;
type View = (typeof VIEWS)[number];

/** Data APIs: every endpoint with its status, latest version, connection and traffic of the last day. */
export default function EndpointsPage() {
  const t = useTranslations('etl');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const canManage = useCan('etl.endpoints.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<EndpointSummary>>(
    '/etl/endpoints',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
      status: view === 'all' ? undefined : (view as EndpointStatus),
    },
  );

  const columns = useMemo<DataTableColumn<EndpointSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-72' },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <Link
              href={endpointHref(row.original.slug)}
              onClick={(e) => e.stopPropagation()}
              className="truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.name}
            </Link>
            <span className="truncate font-mono text-xs text-muted-foreground">/{row.original.slug}</span>
          </span>
        ),
      },
      {
        id: 'method',
        header: t('fields.method'),
        meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) => <MethodBadge method={row.original.method} />,
      },
      {
        id: 'status',
        header: t('fields.status'),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1">
            <EndpointStatusBadge status={row.original.status} />
            {row.original.latestVersion !== null && row.original.draftChanged && <DraftBadge />}
          </span>
        ),
      },
      {
        id: 'version',
        header: t('fields.version'),
        meta: {
          className: 'hidden md:table-cell font-mono text-xs',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => (row.original.latestVersion ? `v${row.original.latestVersion}` : '—'),
      },
      {
        id: 'connection',
        header: t('fields.connection'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => <ConnectionLabel connection={row.original.connection} className="max-w-56" />,
      },
      {
        id: 'calls',
        header: t('endpoints.calls24h'),
        meta: { className: 'hidden md:table-cell tabular-nums', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="flex items-baseline gap-2">
            <span>{format.number(row.original.calls24h)}</span>
            {row.original.errors24h > 0 && (
              <span className={cn('rounded px-1 text-xs', TONE.destructive)}>
                {t('endpoints.errors', { count: row.original.errors24h })}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'updatedAt',
        header: t('fields.updated'),
        meta: {
          sortKey: 'updatedAt',
          className: 'hidden xl:table-cell text-muted-foreground',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
    ],
    [t, format],
  );

  const table = (
    <DataTable
      label={t('endpoints.title')}
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
      getRowId={(e) => e.id}
      onRowClick={(e) => router.push(endpointHref(e.slug))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <SearchInput
          value={state.q ?? ''}
          onChange={(q) => set({ q })}
          placeholder={t('endpoints.search')}
          className="sm:w-72"
        />
      }
      empty={
        <EmptyState
          icon={state.q ? <SearchXIcon /> : <DatabaseZapIcon />}
          title={state.q || view !== 'all' ? t('endpoints.emptyFiltered') : t('endpoints.empty')}
          description={t('endpoints.emptyHint')}
          action={
            canManage &&
            !state.q && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('endpoints.new')}
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
        title={t('endpoints.title')}
        description={t('endpoints.description')}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href="/api/v1/etl/endpoints/openapi.json" download="data-apis.openapi.json">
                <FileJsonIcon /> {t('endpoints.openapi')}
              </a>
            </Button>
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('endpoints.new')}
              </Button>
            )}
          </>
        }
      />
      <DataApiTabs />
      <Tabs value={view} onValueChange={(v) => set({ view: v === 'all' ? undefined : v })}>
        <TabsList className="max-w-full overflow-x-auto">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {v === 'all' ? tc('all') : t(`endpointStatus.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Each tab only filters the same list; every tab still has its panel. */}
        {VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {v === view && table}
          </TabsContent>
        ))}
      </Tabs>
      <p className="sr-only" aria-live="polite">
        {data ? t('endpoints.liveCount', { count: data.total }) : ''}
      </p>
      {canManage && (
        <CreateEndpointDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(e) => router.push(`${endpointHref(e.slug)}?tab=definition`)}
        />
      )}
    </>
  );
}
