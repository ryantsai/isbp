'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
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
import {
  type MyStocktakeItem,
  STOCKTAKE_STATUSES,
  type Stocktake,
  type StocktakeItem,
} from '../../contracts';
import { ProgressBar, StocktakeStatusBadge } from '../badges';
import { stocktakeHref, useDay } from '../lib';
import { NewStocktakeSheet, RecordItemDialog } from '../stocktake-dialogs';

const VIEWS = ['all', ...STOCKTAKE_STATUSES] as const;
type View = (typeof VIEWS)[number];

/** Items waiting for the viewer in open stocktakes, each with a "Record" button. */
function MyItems() {
  const t = useTranslations('isms');
  const day = useDay();
  const { data } = useApiQuery<{ items: MyStocktakeItem[] }>('/isms/stocktake-items/mine');
  const [item, setItem] = useState<MyStocktakeItem | null>(null);
  if (!data?.items.length) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('stocktakes.mine')}</CardTitle>
        <CardDescription>{t('stocktakes.mineDescription', { count: data.items.length })}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.items.slice(0, 10).map((i) => (
            <li key={i.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{i.snapshot.number}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{i.snapshot.name}</span>
              <Link
                href={stocktakeHref(i.stocktake.reference)}
                className="text-xs text-muted-foreground hover:underline"
              >
                {i.stocktake.reference} · {t('stocktakes.dueOn', { date: day(i.stocktake.dueOn) })}
              </Link>
              <Button size="sm" variant="outline" onClick={() => setItem(i)}>
                {t('record.open')}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
      <RecordItemDialog
        stocktake={item?.stocktake.reference ?? ''}
        item={item as StocktakeItem | null}
        onOpenChange={(o) => !o && setItem(null)}
      />
    </Card>
  );
}

/** Stocktakes: campaigns with their progress, and the items waiting for you. */
export default function StocktakesPage() {
  const t = useTranslations('isms');
  const router = useRouter();
  const day = useDay();
  const canManage = useCan('isms.stocktakes.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const { data, isLoading, isFetching } = useApiQuery<Page<Stocktake>>('/isms/stocktakes', {
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
        <EmptyState
          icon={<ClipboardCheckIcon />}
          title={t('stocktakes.empty.title')}
          description={t('stocktakes.empty.description')}
          action={
            canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('stocktakes.new')}
              </Button>
            )
          }
        />
      }
    />
  );
  return (
    <div className="space-y-6">
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
      <Tabs value={view} onValueChange={(v) => set({ view: v === 'all' ? undefined : v })} className="gap-4">
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
