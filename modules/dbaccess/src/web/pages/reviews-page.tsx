'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Segmented } from '@isbp/ui/segmented';
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
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Review>>('/dbaccess/reviews', {
    page: state.page,
    pageSize: state.pageSize,
    status: view === 'all' ? undefined : view,
    q: state.q,
  });
  const awaiting = summary.data?.reviews ?? [];

  const columns = useMemo<DataTableColumn<Review>[]>(
    () => [
      {
        id: 'name',
        header: t('name'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => (
          <VStack className="min-w-0">
            <Link
              href={`/dbaccess/reviews/${row.original.reference}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.name}
            </Link>
            <Text type="code" color="secondary">
              {row.original.reference}
            </Text>
          </VStack>
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
        cell: ({ row }) => <Text>{tp(row.original.policy)}</Text>,
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
      error={error}
      onRetry={() => refetch()}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/dbaccess/reviews/${r.reference}`)}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      empty={
        <EmptyState
          icon={<ClipboardCheckIcon />}
          title={t('empty')}
          description={canManage ? t('emptyHintManager') : t('emptyHint')}
          action={
            canManage && (
              <Button
                label={t('new')}
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
        title={t('title')}
        description={t('description')}
        actions={
          canManage && (
            <Button
              label={t('new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(true)}
            />
          )
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-4">
        {awaiting.length > 0 && (
          <section aria-labelledby="dbaccess-awaiting" className="grid gap-3">
            <h2 id="dbaccess-awaiting" className="text-lg font-semibold">
              {t('awaiting')}
            </h2>
            <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {awaiting.map((r) => (
                <StaggerItem key={r.id} className="min-w-0">
                  <Link
                    href={`/dbaccess/reviews/${r.reference}?view=mine`}
                    className="flex h-full min-w-0 items-center gap-3 rounded-xl border bg-card p-4 outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
        <VStack gap={3} className="min-w-0">
          {/* The views only filter the same list, so they are a segmented control, not tabs. */}
          <Segmented
            label={t('title')}
            value={view}
            onChange={(v) => set({ view: v === 'all' ? undefined : v })}
            options={VIEWS.map((v) => ({ value: v, label: v === 'all' ? tc('all') : t(`views.${v}`) }))}
          />
          {table}
        </VStack>
      </div>
      {canManage && (
        <ReviewFormDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(r) => router.push(`/dbaccess/reviews/${r.reference}`)}
        />
      )}
    </>
  );
}
