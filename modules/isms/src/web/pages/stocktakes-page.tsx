'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Segmented } from '@isbp/ui/segmented';
import { ClipboardCheckIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type MyStocktakeItem, STOCKTAKE_STATUSES, type Stocktake } from '../../contracts';
import { ProgressBar, StocktakeStatusBadge } from '../badges';
import { stocktakeHref, useDay } from '../lib';
import { NewStocktakeSheet } from '../stocktake-dialogs';
import { StocktakeItemList } from '../stocktake-items';

const VIEWS = ['all', ...STOCKTAKE_STATUSES] as const;
type View = (typeof VIEWS)[number];

/** Items waiting for the viewer in open stocktakes, answered right here ("It's right" / "Something's different…"). */
function MyItems() {
  const t = useTranslations('isms');
  const { data } = useApiQuery<{ items: MyStocktakeItem[] }>('/isms/stocktake-items/mine');
  if (!data?.items.length) return null;
  return (
    <VStack as="section" gap={2} aria-labelledby="isms-my-items">
      <VStack gap={0.5}>
        <Heading level={2} id="isms-my-items">
          {t('stocktakes.mine')}
        </Heading>
        <Text as="p" color="secondary">
          {t('stocktakes.mineDescription', { count: data.items.length })}
        </Text>
      </VStack>
      <StocktakeItemList
        label={t('stocktakes.mine')}
        items={data.items.slice(0, 10)}
        stocktakeOf={(i) => i.stocktake?.reference ?? ''}
        selectable
      />
    </VStack>
  );
}

/** Stocktakes: campaigns with their progress, and the items waiting for you. */
export default function StocktakesPage() {
  const t = useTranslations('isms');
  const router = useRouter();
  const day = useDay();
  const canManage = useCan('isms.stocktakes.manage');
  const readsAssets = useCan('isms.assets.read');
  const signsOff = useCan('isms.stocktakes.signoff');
  // People who only take part see their stocktakes without the status tabs.
  const readsAll = canManage || readsAssets || signsOff;
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Stocktake>>('/isms/stocktakes', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    status: view === 'all' ? undefined : view,
  });
  const columns = useMemo<DataTableColumn<Stocktake>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.reference'),
        size: 110,
        meta: { sortKey: 'number', priority: 2 },
        cell: ({ row }) => (
          <Text type="code" color="secondary">
            {row.original.reference}
          </Text>
        ),
      },
      {
        id: 'name',
        header: t('fields.stocktakeName'),
        meta: { sortKey: 'name', className: 'max-w-64' },
        cell: ({ row }) => (
          <Link href={stocktakeHref(row.original.reference)} onClick={(e) => e.stopPropagation()}>
            <Text weight="medium" maxLines={1}>
              {row.original.name}
            </Text>
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        cell: ({ row }) => (
          <StocktakeStatusBadge status={row.original.status} overdue={row.original.overdue} />
        ),
      },
      {
        id: 'progress',
        header: t('fields.progress'),
        meta: { priority: 2, className: 'w-48' },
        cell: ({ row }) => (
          <ProgressBar
            done={row.original.progress.done}
            total={row.original.progress.total}
            label={t('stocktakes.progressLabel', { name: row.original.name })}
          />
        ),
      },
      {
        id: 'dueOn',
        header: t('fields.dueOn'),
        meta: {
          sortKey: 'dueOn',
          priority: 2,
        },
        cell: ({ row }) => day(row.original.dueOn),
      },
      {
        id: 'mine',
        header: t('stocktakes.forYou'),
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.viewer.pendingForMe
            ? t('stocktakes.pendingForMe', { count: row.original.viewer.pendingForMe })
            : '—',
      },
    ],
    [t, day],
  );
  const table = (
    <DataTable
      label={t('stocktakes.title')}
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
      getRowId={(s) => s.id}
      onRowClick={(s) => router.push(stocktakeHref(s.reference))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <SearchInput
          value={state.q ?? ''}
          onChange={(q) => set({ q })}
          placeholder={t('stocktakes.search')}
          className="sm:w-64"
        />
      }
      empty={
        state.q ? (
          <EmptyState variant="filtered" onClearFilters={() => set({ q: undefined })} />
        ) : canManage ? (
          <EmptyState
            icon={<ClipboardCheckIcon />}
            title={t('stocktakes.empty.title')}
            description={t('stocktakes.empty.description')}
            action={
              <Button
                label={t('stocktakes.new')}
                variant="primary"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => setCreating(true)}
              />
            }
          />
        ) : (
          <EmptyState
            icon={<ClipboardCheckIcon />}
            title={t('stocktakes.empty.participantTitle')}
            description={t('stocktakes.empty.participant')}
          />
        )
      }
    />
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('stocktakes.title')}
        description={t('stocktakes.description')}
        actions={
          canManage && (
            <Button
              label={t('stocktakes.new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(true)}
            />
          )
        }
      />
      <MyItems />
      <VStack gap={4}>
        {readsAll && (
          <Segmented
            label={t('fields.status')}
            value={view}
            onChange={(v) => set({ view: v === 'all' ? undefined : v })}
            options={VIEWS.map((v) => ({
              value: v,
              label: v === 'all' ? t('stocktakes.all') : t(`stocktakeStatus.${v}`),
            }))}
          />
        )}
        {table}
      </VStack>
      {canManage && (
        <NewStocktakeSheet
          open={creating}
          onOpenChange={setCreating}
          onCreated={(s) => router.push(stocktakeHref(s.reference))}
        />
      )}
    </div>
  );
}
