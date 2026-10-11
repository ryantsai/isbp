'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
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
import { ContractSections } from '../sections';

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
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Vendor>>(
    allowed ? '/itam/vendors' : null,
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
    },
  );
  const currency = settings?.currency ?? 'TWD';
  const columns = useMemo<DataTableColumn<Vendor>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-64' },
        cell: ({ row }) => (
          <Link
            color="primary"
            weight="medium"
            maxLines={1}
            onClick={(e) => {
              e.stopPropagation();
              set({ vendor: row.original.id });
            }}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'contact',
        header: t('vendors.contact'),
        meta: { className: 'hidden max-w-56 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <VStack>
            <Text maxLines={1}>{row.original.contactName ?? '—'}</Text>
            {row.original.contactEmail && (
              <Text type="supporting" maxLines={1}>
                {row.original.contactEmail}
              </Text>
            )}
          </VStack>
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
            <Badge
              variant="success"
              label={t('vendors.active')}
              icon={<Icon icon={CircleCheckIcon} size="xsm" />}
            />
          ) : (
            <Badge
              variant="neutral"
              label={t('vendors.inactive')}
              icon={<Icon icon={CircleMinusIcon} size="xsm" />}
            />
          ),
      },
    ],
    [t, money, currency, set],
  );

  if (!allowed) return <EmptyState icon={<BuildingIcon />} title={t('vendors.noAccess')} />;

  return (
    <>
      <PageHeader
        title={t('contracts.title')}
        description={t('vendors.description')}
        actions={
          canEdit && (
            <Button
              label={t('vendors.new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(true)}
            />
          )
        }
      />
      <ContractSections />
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
        error={error}
        onRetry={() => refetch()}
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
                <Button
                  label={t('vendors.new')}
                  variant="primary"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => setCreating(true)}
                />
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
