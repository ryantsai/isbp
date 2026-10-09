'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { FileTextIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { CONTRACT_KINDS, CONTRACT_VIEWS, type ContractListItem, type ContractView } from '../../contracts';
import { ContractStatusBadge } from '../badges';
import { ContractFormDialog } from '../contract-dialogs';
import { contractHref, useDay, useMoney, useVendors } from '../lib';
import { RenewsIn } from '../renews-in';
import { ContractSections } from '../sections';

const ALL = '__all__';

/** Contracts: terms, renewals and cost, with quick tabs for what needs attention. */
export default function ContractsPage() {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const router = useRouter();
  const money = useMoney();
  const day = useDay();
  const canManage = useCan('itam.contracts.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: ContractView = CONTRACT_VIEWS.includes(state.view as ContractView)
    ? (state.view as ContractView)
    : 'active';
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { vendors } = useVendors();

  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ContractListItem>>(
    '/itam/contracts',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
      view,
      kind: str('kind'),
      vendor: str('vendor'),
    },
  );
  const filtered = Boolean(state.q || str('kind') || str('vendor'));

  const columns = useMemo<DataTableColumn<ContractListItem>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.reference'),
        size: 100,
        meta: {
          sortKey: 'number',
          className: 'hidden font-mono text-xs text-muted-foreground sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => row.original.reference,
      },
      {
        id: 'title',
        header: t('fields.title'),
        meta: { sortKey: 'title', className: 'max-w-72' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={contractHref(row.original)}
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.title}
            </Link>
            <span className="block truncate text-xs text-muted-foreground md:hidden">
              {row.original.vendor?.name}
            </span>
          </div>
        ),
      },
      {
        id: 'vendor',
        header: t('fields.vendor'),
        meta: {
          className: 'hidden max-w-44 truncate md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.vendor?.name ?? '—',
      },
      {
        id: 'kind',
        header: t('fields.kind'),
        meta: {
          sortKey: 'kind',
          className: 'hidden text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => t(`contractKind.${row.original.kind}`),
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <ContractStatusBadge status={row.original.status} />,
      },
      {
        id: 'endDate',
        header: t('fields.endDate'),
        meta: {
          sortKey: 'endDate',
          className: 'hidden whitespace-nowrap sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => (
          <div className="grid">
            <span>{day(row.original.endDate)}</span>
            <span className="text-xs">
              <RenewsIn c={row.original} />
            </span>
          </div>
        ),
      },
      {
        id: 'cost',
        header: t('fields.annualCost'),
        meta: {
          sortKey: 'cost',
          className: 'hidden text-right whitespace-nowrap tabular-nums xl:table-cell',
          headerClassName: 'hidden text-right xl:table-cell',
        },
        cell: ({ row }) => money(row.original.annualCost, row.original.currency),
      },
    ],
    [t, day, money],
  );

  const table = (
    <DataTable
      label={t('contracts.title')}
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
      getRowId={(c) => c.id}
      onRowClick={(c) => router.push(contractHref(c))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('contracts.search')}
            className="sm:w-64"
          />
          <Select value={str('kind') ?? ALL} onValueChange={(v) => set({ kind: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-full sm:w-44" aria-label={t('fields.kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('contracts.allKinds')}</SelectItem>
              {CONTRACT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`contractKind.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={str('vendor') ?? ALL}
            onValueChange={(v) => set({ vendor: v === ALL ? undefined : v })}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label={t('fields.vendor')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('hardware.filters.allVendors')}</SelectItem>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ q: undefined, kind: undefined, vendor: undefined })}
            >
              {tc('clearFilters')}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={filtered ? <SearchXIcon /> : <FileTextIcon />}
          title={t('contracts.empty.title')}
          description={filtered ? t('contracts.empty.filtered') : t(`contracts.empty.${view}`)}
          action={
            !filtered &&
            canManage &&
            view === 'all' && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('contracts.new')}
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
        title={t('contracts.title')}
        description={t('contracts.description')}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('contracts.new')}
            </Button>
          )
        }
      />
      <ContractSections />
      <Tabs
        value={view}
        onValueChange={(v) => set({ view: v === 'active' ? undefined : v })}
        className="gap-4"
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {CONTRACT_VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`contracts.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {CONTRACT_VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {view === v && table}
          </TabsContent>
        ))}
      </Tabs>
      <p className="sr-only" aria-live="polite">
        {data ? t('contracts.liveCount', { count: data.total }) : ''}
      </p>
      {canManage && (
        <ContractFormDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={(c) => router.push(contractHref(c))}
        />
      )}
    </>
  );
}
