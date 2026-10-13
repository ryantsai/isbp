'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar } from '@isbp/ui/filter-bar';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { NotebookTextIcon, PlusIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { MeetingSummary } from '../../contracts';
import { MeetingStatusBadge, meetingHref, VisibilityBadge } from '../lib';
import { MeetingSheet } from '../meeting-sheet';
import { MeetingsTabs } from '../section-tabs';

/** Meetings: mine (organised or attended) or every one I may see; "New meeting" (`?create=1`, `&link=` a record). */
export default function MeetingsPage() {
  const t = useTranslations('meetings.list');
  const router = useRouter();
  const search = useSearchParams();
  const [state, set] = useListState({ sort: '-startsAt' });
  const scope = state.scope === 'all' ? 'all' : 'mine';
  const q = useApiQuery<Page<MeetingSummary>>('/meetings/meetings', {
    page: state.page,
    pageSize: state.pageSize,
    q: (state.q as string | undefined) || undefined,
    mine: scope === 'mine' ? 'true' : 'false',
  });
  const creating = search.get('create') === '1';
  const link = search.get('link');
  const setCreating = (open: boolean) =>
    set({ create: open ? '1' : undefined, link: open ? (link ?? undefined) : undefined });

  const columns = useMemo<DataTableColumn<MeetingSummary>[]>(
    () => [
      {
        id: 'title',
        header: t('columns.meeting'),
        meta: { wrap: true, className: 'max-w-96' },
        cell: ({ row }) => (
          <VStack gap={0} className="min-w-0">
            <Link
              href={meetingHref(row.original.reference)}
              onClick={(e) => e.stopPropagation()}
              weight="medium"
            >
              {row.original.title}
            </Link>
            <Text type="code" color="secondary">
              {row.original.reference}
            </Text>
          </VStack>
        ),
      },
      {
        id: 'startsAt',
        header: t('columns.when'),
        meta: { sortKey: 'startsAt' },
        cell: ({ row }) => <DateTime date={row.original.startsAt} />,
      },
      {
        id: 'organizer',
        header: t('columns.organizer'),
        meta: { priority: 2 },
        cell: ({ row }) => row.original.organizer?.displayName ?? '—',
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => (
          <span className="inline-flex flex-wrap gap-1">
            <MeetingStatusBadge status={row.original.status} />
            <VisibilityBadge visibility={row.original.visibility} />
          </span>
        ),
      },
      {
        id: 'items',
        header: t('columns.items'),
        meta: { priority: 2 },
        cell: ({ row }) => t('itemCount', { open: row.original.items.open, total: row.original.items.total }),
      },
    ],
    [t],
  );
  const filtered = Boolean(state.q);

  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button
            label={t('new')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setCreating(true)}
          />
        }
      />
      <MeetingsTabs />
      <SegmentedControl
        label={t('show')}
        value={scope}
        onChange={(v) => set({ scope: v === 'all' ? 'all' : undefined, page: 1 })}
      >
        <SegmentedControlItem value="mine" label={t('mine')} />
        <SegmentedControlItem value="all" label={t('all')} />
      </SegmentedControl>
      <DataTable
        label={t('title')}
        columns={columns}
        data={q.data?.items ?? []}
        total={q.data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort as string | undefined}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        getRowId={(m) => m.reference}
        onRowClick={(m) => router.push(meetingHref(m.reference))}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <FilterBar
            search={
              <SearchInput
                value={(state.q as string | undefined) ?? ''}
                onChange={(v) => set({ q: v || undefined, page: 1 })}
                placeholder={t('search')}
                className="sm:w-72"
              />
            }
          />
        }
        empty={
          filtered ? (
            <EmptyState variant="filtered" onClearFilters={() => set({ q: undefined })} />
          ) : (
            <EmptyState
              icon={<NotebookTextIcon />}
              title={t('empty')}
              description={t('emptyHint')}
              action={<Button label={t('new')} variant="primary" onClick={() => setCreating(true)} />}
            />
          )
        }
      />
      <MeetingSheet
        open={creating}
        onOpenChange={setCreating}
        meeting={null}
        defaultLink={link}
        onSaved={(m) => router.push(meetingHref(m.reference))}
      />
    </div>
  );
}
