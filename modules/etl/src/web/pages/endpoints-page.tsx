'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { DownloadButton } from '@isbp/ui/download-button';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { StatusBadge } from '@isbp/ui/status';
import { DatabaseZapIcon, FileJsonIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { type EndpointStatus, type EndpointSummary, ENDPOINT_STATUSES } from '../../contracts';
import { ConnectionLabel, DraftBadge, EndpointStatusBadge, MethodBadge } from '../badges';
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
  const panelId = useId();
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
  const viewLabel = (v: View) => (v === 'all' ? tc('all') : t(`endpointStatus.${v}`));

  const columns = useMemo<DataTableColumn<EndpointSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-72' },
        cell: ({ row }) => (
          <VStack gap={0} className="min-w-0">
            <Link
              href={endpointHref(row.original.slug)}
              onClick={(e) => e.stopPropagation()}
              weight="medium"
              maxLines={1}
            >
              {row.original.name}
            </Link>
            <Text type="code" color="secondary" maxLines={1}>
              /{row.original.slug}
            </Text>
          </VStack>
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
          <HStack gap={1} wrap="wrap" vAlign="center">
            <EndpointStatusBadge status={row.original.status} />
            {row.original.latestVersion !== null && row.original.draftChanged && <DraftBadge />}
          </HStack>
        ),
      },
      {
        id: 'version',
        header: t('fields.version'),
        meta: {
          className: 'hidden md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => (
          <Text type="code">{row.original.latestVersion ? `v${row.original.latestVersion}` : '—'}</Text>
        ),
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
          <HStack gap={2} vAlign="center">
            <span>{format.number(row.original.calls24h)}</span>
            {row.original.errors24h > 0 && (
              <StatusBadge
                tone="destructive"
                label={t('endpoints.errors', { count: row.original.errors24h })}
              />
            )}
          </HStack>
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
              <Button
                label={t('endpoints.new')}
                variant="primary"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => setCreating(true)}
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
        title={t('endpoints.title')}
        description={t('endpoints.description')}
        actions={
          <>
            <DownloadButton
              label={t('endpoints.openapi')}
              variant="secondary"
              icon={<Icon icon={FileJsonIcon} />}
              href="/api/v1/etl/endpoints/openapi.json"
              download="data-apis.openapi.json"
            />
            {canManage && (
              <Button
                label={t('endpoints.new')}
                variant="primary"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => setCreating(true)}
              />
            )}
          </>
        }
      />
      <DataApiTabs />
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
