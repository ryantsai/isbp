'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRightIcon, ClipboardCheckIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type MySummary, REVIEW_STATUSES, type Review } from '../../contracts';
import { ReviewStatusBadge } from '../badges';
import { useDay } from '../lib';
import { ReviewProgress } from '../review-progress';
import { ReviewFormDialog } from '../review-form-dialog';

const VIEWS = ['all', ...REVIEW_STATUSES] as const;
type View = (typeof VIEWS)[number];

export default function ReviewsPage() {
  const t = useTranslations('dbaccess.reviews');
  const tp = useTranslations('dbaccess.policy');
  const tc = useTranslations('common');
  const router = useRouter();
  const day = useDay();
  const canManage = useCan('dbaccess.reviews.manage');
  const [creating, setCreating] = useState(false);
  const [state, set] = useListState({ pageSize: 25 });
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const summary = useApiQuery<MySummary>('/dbaccess/me/summary');
  const { data, isLoading, isFetching } = useApiQuery<Page<Review>>('/dbaccess/reviews', {
    page: state.page,
    pageSize: state.pageSize,
    status: view === 'all' ? undefined : view,
    q: state.q,
  });
  const awaiting = summary.data?.reviews ?? [];

  const columns = useMemo<ColumnDef<Review, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('name'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => (
          <span className="grid min-w-0">
            <Link
              href={`/dbaccess/reviews/${row.original.id}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.name}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">{row.original.reference}</span>
          </span>
        ),
      },
      {
        id: 'status',
        header: t('status'),
        cell: ({ row }) => <ReviewStatusBadge status={row.original.status} />,
      },
      {
        id: 'due',
        header: t('due'),
        meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) => day(row.original.dueOn),
      },
      {
        id: 'policy',
        header: t('policy'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => <span className="text-sm">{tp(row.original.policy)}</span>,
      },
      {
        id: 'progress',
        header: t('progress'),
        meta: { className: 'hidden w-64 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <ReviewProgress totals={row.original.totals} />,
      },
    ],
    [t, tp, day],
  );

  const table = (
    <DataTable
      label={t('title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      loading={isLoading}
      fetching={isFetching}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/dbaccess/reviews/${r.id}`)}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      empty={
        <EmptyState
          icon={<ClipboardCheckIcon />}
          title={t('empty')}
          description={canManage ? t('emptyHintManager') : t('emptyHint')}
          action={
            canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('new')}
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
        title={t('title')}
        description={t('description')}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('new')}
            </Button>
          )
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-6">
        {awaiting.length > 0 && (
          <section aria-labelledby="dbaccess-awaiting" className="grid gap-3">
            <h2 id="dbaccess-awaiting" className="text-lg font-semibold">
              {t('awaiting')}
            </h2>
            <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {awaiting.map((r) => (
                <StaggerItem key={r.id} className="min-w-0">
                  <Link
                    href={`/dbaccess/reviews/${r.id}?view=mine`}
                    className="flex h-full min-w-0 items-center gap-3 rounded-xl border bg-card p-4 shadow-xs outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <ClipboardCheckIcon className="size-5 shrink-0 text-primary" aria-hidden />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {t('awaitingCount', { count: r.pending, due: day(r.dueOn) })}
                      </span>
                    </span>
                    <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
          </section>
        )}
        <Tabs
          value={view}
          onValueChange={(v) => set({ view: v === 'all' ? undefined : v })}
          className="min-w-0"
        >
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {v === 'all' ? tc('all') : t(`views.${v}`)}
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
      </div>
      {canManage && (
        <ReviewFormDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(r) => router.push(`/dbaccess/reviews/${r.id}`)}
        />
      )}
    </>
  );
}
