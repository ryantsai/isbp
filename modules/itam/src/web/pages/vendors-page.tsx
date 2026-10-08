'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { BuildingIcon, CircleCheckIcon, CircleMinusIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { ItamSettings, Vendor } from '../../contracts';
import { useMoney } from '../lib';
import { VendorFormDialog, VendorSheet } from '../vendor-dialogs';

/** Vendors: who we buy from, what we have with them and what it costs per year. */
export default function VendorsPage() {
  const t = useTranslations('itam');
  const money = useMoney();
  const canEdit = useCan('itam.config.manage');
  const canRead = useCan('itam.contracts.read');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const { data: settings } = useApiQuery<ItamSettings>('/itam/settings');
  const allowed = canEdit || canRead;
  const { data, isLoading, isFetching } = useApiQuery<Page<Vendor>>(allowed ? '/itam/vendors' : null, {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
  });
  const currency = settings?.currency ?? 'TWD';
  const columns = useMemo<DataTableColumn<Vendor>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-64' },
        cell: ({ row }) => (
          <button
            type="button"
            className="block max-w-full truncate text-left font-medium outline-none hover:underline focus-visible:underline"
            onClick={(e) => {
              e.stopPropagation();
              set({ vendor: row.original.id });
            }}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        id: 'contact',
        header: t('vendors.contact'),
        meta: { className: 'hidden max-w-56 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate">{row.original.contactName ?? '—'}</span>
            {row.original.contactEmail && (
              <span className="block truncate text-xs text-muted-foreground">
                {row.original.contactEmail}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'counts',
        header: t('vendors.records'),
        meta: {
          className: 'hidden whitespace-nowrap text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) =>
          t('vendors.counts', {
            contracts: row.original.counts.contracts,
            licenses: row.original.counts.licenses,
            assets: row.original.counts.assets,
          }),
      },
      {
        id: 'spend',
        header: t('vendors.annualSpend'),
        meta: {
          sortKey: 'spend',
          className: 'text-right whitespace-nowrap tabular-nums',
          headerClassName: 'text-right',
        },
        cell: ({ row }) => money(row.original.annualSpend, currency),
      },
      {
        id: 'active',
        header: t('vendors.status'),
        meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="success">
              <CircleCheckIcon aria-hidden /> {t('vendors.active')}
            </Badge>
          ) : (
            <Badge variant="muted">
              <CircleMinusIcon aria-hidden /> {t('vendors.inactive')}
            </Badge>
          ),
      },
    ],
    [t, money, currency, set],
  );

  if (!allowed) return <EmptyState icon={<BuildingIcon />} title={t('vendors.noAccess')} />;

  return (
    <>
      <PageHeader
        title={t('vendors.title')}
        description={t('vendors.description')}
        actions={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('vendors.new')}
            </Button>
          )
        }
      />
      <DataTable
        label={t('vendors.title')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(v) => v.id}
        onRowClick={(v) => set({ vendor: v.id })}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('vendors.search')}
            className="sm:w-72"
          />
        }
        empty={
          <EmptyState
            icon={state.q ? <SearchXIcon /> : <BuildingIcon />}
            title={t('vendors.empty')}
            action={
              !state.q &&
              canEdit && (
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon /> {t('vendors.new')}
                </Button>
              )
            }
          />
        }
      />
      <VendorSheet
        vendorId={(state.vendor as string | undefined) ?? null}
        onOpenChange={(open) => !open && set({ vendor: undefined })}
        canEdit={canEdit}
      />
      {canEdit && (
        <VendorFormDialog open={creating} onOpenChange={setCreating} onSaved={(v) => set({ vendor: v.id })} />
      )}
    </>
  );
}
