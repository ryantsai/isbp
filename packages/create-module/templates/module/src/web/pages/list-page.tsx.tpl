'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { InboxIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { Item } from '../../contracts';
import { ItemFormDialog } from '../item-form';

const STATUS_VARIANT = { draft: 'muted', active: 'success', archived: 'secondary' } as const;

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
          <Link href={`/__ID__/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.original.title}
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{t(`status.${row.original.status}`)}</Badge>,
      },
      { id: 'owner', header: t('fields.owner'), meta: { className: 'text-muted-foreground' }, cell: ({ row }) => row.original.owner?.displayName ?? '—' },
      {
        id: 'updatedAt',
        header: t('fields.updated'),
        meta: { sortKey: 'updatedAt', className: 'text-muted-foreground' },
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
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('createTitle')}
            </Button>
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
