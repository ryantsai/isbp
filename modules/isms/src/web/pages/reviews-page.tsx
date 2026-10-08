'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ListChecksIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { REVIEW_STATUSES, type ReviewListItem } from '../../contracts';
import { ProgressBar, ReviewStatusBadge } from '../badges';
import { reviewHref, useDay } from '../lib';
import { NewReviewSheet } from '../review-dialogs';

const VIEWS = ['all', ...REVIEW_STATUSES] as const;
type View = (typeof VIEWS)[number];

/** Account reviews of any system: progress, reviewers, due dates. */
export default function ReviewsPage() {
  const t = useTranslations('isms');
  const router = useRouter();
  const day = useDay();
  const mineId = useId();
  const canManage = useCan('isms.reviews.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const mine = state.mine === 'true';
  const { data, isLoading, isFetching } = useApiQuery<Page<ReviewListItem>>('/isms/reviews', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    status: view === 'all' ? undefined : view,
    mine: mine ? 'true' : undefined,
  });
  const columns = useMemo<DataTableColumn<ReviewListItem>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.reference'),
        size: 110,
        meta: { sortKey: 'number', className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => row.original.reference,
      },
      {
        id: 'target',
        header: t('fields.target'),
        meta: { sortKey: 'target', className: 'max-w-64' },
        cell: ({ row }) => (
          <Link
            href={reviewHref(row.original.reference)}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium outline-none hover:underline focus-visible:underline"
          >
            {row.original.target}
          </Link>
        ),
      },
      {
        id: 'reviewer',
        header: t('fields.reviewer'),
        meta: { className: 'hidden max-w-44 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="block truncate">{row.original.reviewer?.displayName ?? '—'}</span>
        ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        cell: ({ row }) => <ReviewStatusBadge status={row.original.status} overdue={row.original.overdue} />,
      },
      {
        id: 'progress',
        header: t('fields.progress'),
        meta: { className: 'hidden w-48 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <ProgressBar
            done={row.original.progress.decided}
            total={row.original.progress.total}
            label={t('reviews.progressLabel', { target: row.original.target })}
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
    ],
    [t, day],
  );
  const table = (
    <DataTable
      label={t('reviews.title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      loading={isLoading}
      fetching={isFetching}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(reviewHref(r.reference))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('reviews.search')}
            className="sm:w-64"
          />
          <div className="flex items-center gap-2">
            <Switch
              id={mineId}
              checked={mine}
              onCheckedChange={(v) => set({ mine: v ? 'true' : undefined })}
            />
            <label htmlFor={mineId} className="text-sm">
              {t('reviews.onlyMine')}
            </label>
          </div>
        </>
      }
      empty={
        <EmptyState
          icon={<ListChecksIcon />}
          title={t('reviews.empty.title')}
          description={t('reviews.empty.description')}
          action={
            canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('reviews.new')}
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
        title={t('reviews.title')}
        description={t('reviews.description')}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('reviews.new')}
            </Button>
          )
        }
      />
      <Tabs value={view} onValueChange={(v) => set({ view: v === 'all' ? undefined : v })} className="gap-4">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {v === 'all' ? t('reviews.all') : t(`reviewStatus.${v}`)}
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
        <NewReviewSheet
          open={creating}
          onOpenChange={setCreating}
          onCreated={(r) => router.push(reviewHref(r.reference))}
        />
      )}
    </>
  );
}
