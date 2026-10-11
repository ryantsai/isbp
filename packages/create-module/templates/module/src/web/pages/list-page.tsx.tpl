'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { InboxIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { Item } from '../../contracts';
import { ItemFormDialog } from '../item-form';

/** A status is icon + text, never colour alone; here the text is the chip. Map each status once. */
const STATUS_VARIANT = { draft: 'neutral', active: 'success', archived: 'neutral' } as const;

export default function ListPage() {
  const t = useTranslations('__ID__');
  const router = useRouter();
  const canManage = useCan('__ID__.items.manage');
  const [state, set] = useListState();
  const [creating, setCreating] = useState(false);
  const { data, isLoading, isFetching } = useApiQuery<Page<Item>>('/__ID__/items', { page: state.page, pageSize: state.pageSize, sort: state.sort, q: state.q });

  const columns = useMemo<DataTableColumn<Item>[]>(
    () => [
      {
        id: 'title',
        header: t('fields.title'),
        meta: { sortKey: 'title' },
        cell: ({ row }) => (
          <Link href={`/__ID__/${row.original.id}`} onClick={(e) => e.stopPropagation()}>
            {row.original.title}
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]} label={t(`status.${row.original.status}`)} />,
      },
      {
        id: 'owner',
        header: t('fields.owner'),
        cell: ({ row }) => <Text color="secondary">{row.original.owner?.displayName ?? '—'}</Text>,
      },
      {
        id: 'updatedAt',
        header: t('fields.updated'),
        meta: { sortKey: 'updatedAt' },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
    ],
    [t],
  );

  return (
    <>
      <PageHeader
        title={t('meta.name')}
        description={t('meta.description')}
        actions={
          canManage && (
            <Button label={t('createTitle')} variant="primary" icon={<Icon icon={PlusIcon} />} onClick={() => setCreating(true)} />
          )
        }
      />
      <DataTable
        label={t('meta.name')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(i) => i.id}
        onRowClick={(i) => router.push(`/__ID__/${i.id}`)}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={<SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={t('search')} />}
        empty={<EmptyState icon={<InboxIcon />} title={t('empty')} />}
      />
      <ItemFormDialog open={creating} onOpenChange={setCreating} onSaved={(i) => router.push(`/__ID__/${i.id}`)} />
    </>
  );
}
