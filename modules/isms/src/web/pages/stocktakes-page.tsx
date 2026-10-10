'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ClipboardCheckIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
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
    <section aria-labelledby="isms-my-items" className="grid min-w-0 gap-2">
      <div>
        <h2 id="isms-my-items" className="text-base font-semibold">
          {t('stocktakes.mine')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('stocktakes.mineDescription', { count: data.items.length })}
        </p>
      </div>
      <StocktakeItemList
        label={t('stocktakes.mine')}
        items={data.items.slice(0, 10)}
        stocktakeOf={(i) => i.stocktake?.reference ?? ''}
        selectable
      />
    </section>
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
        meta: { sortKey: 'number', className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => row.original.reference,
      },
      {
        id: 'name',
        header: t('fields.stocktakeName'),
        meta: { sortKey: 'name', className: 'max-w-64' },
        cell: ({ row }) => (
          <Link
            href={stocktakeHref(row.original.reference)}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium outline-none hover:underline focus-visible:underline"
          >
            {row.original.name}
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
        meta: { className: 'hidden w-48 md:table-cell', headerClassName: 'hidden md:table-cell' },
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
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => day(row.original.dueOn),
      },
      {
        id: 'mine',
        header: t('stocktakes.forYou'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
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
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('stocktakes.new')}
              </Button>
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
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('stocktakes.new')}
            </Button>
          )
        }
      />
      <MyItems />
      {!readsAll ? (
        table
      ) : (
        <Tabs
          value={view}
          onValueChange={(v) => set({ view: v === 'all' ? undefined : v })}
          className="gap-4"
        >
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {v === 'all' ? t('stocktakes.all') : t(`stocktakeStatus.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {VIEWS.map((v) => (
            <TabsContent key={v} value={v} className="min-w-0">
              {view === v && table}
            </TabsContent>
          ))}
        </Tabs>
      )}
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
