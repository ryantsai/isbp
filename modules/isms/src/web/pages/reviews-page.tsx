'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Segmented } from '@isbp/ui/segmented';
import { ListChecksIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
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
  const canManage = useCan('isms.reviews.manage');
  const canRead = useCan('isms.reviews.read');
  const canSignOff = useCan('isms.reviews.signoff');
  // Reviewers who only take part see their reviews without status tabs or the "Only mine" switch.
  const readsAll = canManage || canRead || canSignOff;
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const mine = state.mine === 'true';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ReviewListItem>>('/isms/reviews', {
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
        meta: { sortKey: 'number', priority: 2 },
        cell: ({ row }) => (
          <Text type="code" color="secondary">
            {row.original.reference}
          </Text>
        ),
      },
      {
        id: 'target',
        header: t('fields.target'),
        meta: { sortKey: 'target', className: 'max-w-64' },
        cell: ({ row }) => (
          <Link href={reviewHref(row.original.reference)} onClick={(e) => e.stopPropagation()}>
            <Text weight="medium" maxLines={1}>
              {row.original.target}
            </Text>
          </Link>
        ),
      },
      {
        id: 'reviewer',
        header: t('fields.reviewer'),
        meta: { priority: 2, className: 'max-w-44' },
        cell: ({ row }) => <Text maxLines={1}>{row.original.reviewer?.displayName ?? '—'}</Text>,
      },
      {
        id: 'status',
        header: t('fields.status'),
        cell: ({ row }) => <ReviewStatusBadge status={row.original.status} overdue={row.original.overdue} />,
      },
      {
        id: 'progress',
        header: t('fields.progress'),
        meta: { priority: 2, className: 'w-48' },
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
          priority: 2,
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
      error={error}
      onRetry={() => refetch()}
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
          {readsAll && (
            <Switch
              label={t('reviews.onlyMine')}
              value={mine}
              onChange={(v) => set({ mine: v ? 'true' : undefined })}
            />
          )}
        </>
      }
      empty={
        state.q || mine ? (
          <EmptyState variant="filtered" onClearFilters={() => set({ q: undefined, mine: undefined })} />
        ) : canManage ? (
          <EmptyState
            icon={<ListChecksIcon />}
            title={t('reviews.empty.title')}
            description={t('reviews.empty.description')}
            action={
              <Button
                label={t('reviews.new')}
                variant="primary"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => setCreating(true)}
              />
            }
          />
        ) : (
          <EmptyState
            icon={<ListChecksIcon />}
            title={t('reviews.empty.participantTitle')}
            description={t('reviews.empty.participant')}
          />
        )
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
            <Button
              label={t('reviews.new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(true)}
            />
          )
        }
      />
      <VStack gap={4}>
        {readsAll && (
          <Segmented
            label={t('fields.status')}
            value={view}
            onChange={(v) => set({ view: v === 'all' ? undefined : v })}
            options={VIEWS.map((v) => ({
              value: v,
              label: v === 'all' ? t('reviews.all') : t(`reviewStatus.${v}`),
            }))}
          />
        )}
        {table}
      </VStack>
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
