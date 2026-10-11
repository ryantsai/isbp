'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { KeyRoundIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { LICENSE_TYPES, type LicenseListItem } from '../../contracts';
import { ComplianceBadge } from '../badges';
import { LicenseFormDialog } from '../license-form-dialog';
import { licenseHref, useDay, useItamSettings, useMoney, useVendors } from '../lib';
import { UsageMeter } from '../meters';
import { SoftwareSections } from '../sections';
import { QuickViews } from './quick-views';

const ALL = '__all__';
/** Quick views → compliance states. */
const VIEWS = {
  all: undefined,
  attention: 'over_deployed,expired',
  expiring: 'expiring',
  under_used: 'under_used',
} as const;
type View = keyof typeof VIEWS;
const VIEW_KEYS = Object.keys(VIEWS) as View[];

/** Software licences: entitlement vs usage, compliance, renewal and cost. */
export default function SoftwarePage() {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const router = useRouter();
  const money = useMoney();
  const day = useDay();
  const settings = useItamSettings();
  const canManage = useCan('itam.software.manage');
  const canContracts = useCan('itam.contracts.read');
  const canConfig = useCan('itam.config.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = VIEW_KEYS.includes(state.view as View) ? (state.view as View) : 'all';
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { vendors } = useVendors(canContracts || canConfig);

  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<LicenseListItem>>(
    '/itam/licenses',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
      compliance: VIEWS[view],
      type: str('type'),
      vendor: str('vendor'),
    },
  );
  const filtered = Boolean(state.q || str('type') || str('vendor'));

  const columns = useMemo<DataTableColumn<LicenseListItem>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.reference'),
        size: 100,
        meta: {
          sortKey: 'number',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => (
          <Text type="code" size="xsm" color="secondary">
            {row.original.reference}
          </Text>
        ),
      },
      {
        id: 'product',
        header: t('fields.product'),
        meta: { sortKey: 'product', className: 'max-w-64' },
        cell: ({ row }) => (
          <VStack>
            <Link
              href={licenseHref(row.original)}
              color="primary"
              weight="medium"
              maxLines={1}
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.product}
            </Link>
            {row.original.publisher && (
              <Text type="supporting" maxLines={1}>
                {row.original.publisher}
              </Text>
            )}
          </VStack>
        ),
      },
      {
        id: 'type',
        header: t('fields.licenseType'),
        meta: {
          sortKey: 'type',
          className: 'hidden text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => t(`licenseType.${row.original.licenseType}`),
      },
      {
        id: 'usage',
        header: t('fields.usage'),
        size: 160,
        meta: { sortKey: 'usage', className: 'min-w-32' },
        cell: ({ row }) => (
          <UsageMeter
            used={row.original.used}
            quantity={row.original.quantity}
            underUsedPercent={settings.underUsedPercent}
          />
        ),
      },
      {
        id: 'compliance',
        header: t('fields.compliance'),
        meta: { sortKey: 'compliance' },
        cell: ({ row }) => <ComplianceBadge state={row.original.complianceState} />,
      },
      {
        id: 'endDate',
        header: t('fields.endDate'),
        meta: {
          sortKey: 'endDate',
          className: 'hidden whitespace-nowrap lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) =>
          row.original.endDate ? (
            day(row.original.endDate)
          ) : (
            <Text color="secondary">{t('software.perpetual')}</Text>
          ),
      },
      {
        id: 'annualCost',
        header: t('fields.annualCost'),
        meta: {
          className: 'hidden text-right whitespace-nowrap tabular-nums xl:table-cell',
          headerClassName: 'hidden text-right xl:table-cell',
        },
        cell: ({ row }) => money(row.original.annualCost, row.original.currency),
      },
    ],
    [t, day, money, settings.underUsedPercent],
  );

  const table = (
    <DataTable
      key={view}
      label={t('software.title')}
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
      getRowId={(l) => l.id}
      onRowClick={(l) => router.push(licenseHref(l))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('software.search')}
            className="sm:w-64"
          />
          <Selector
            label={t('fields.licenseType')}
            isLabelHidden
            width={176}
            value={str('type') ?? ALL}
            onChange={(v) => set({ type: v === ALL ? undefined : v })}
            options={[
              { value: ALL, label: t('software.allTypes') },
              ...LICENSE_TYPES.map((x) => ({ value: x, label: t(`licenseType.${x}`) })),
            ]}
          />
          {vendors.length > 0 && (
            <Selector
              label={t('fields.vendor')}
              isLabelHidden
              width={192}
              value={str('vendor') ?? ALL}
              onChange={(v) => set({ vendor: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('hardware.filters.allVendors') },
                ...vendors.map((v) => ({ value: v.id, label: v.name })),
              ]}
            />
          )}
          {filtered && (
            <Button
              label={tc('clearFilters')}
              variant="ghost"
              size="sm"
              onClick={() => set({ q: undefined, type: undefined, vendor: undefined })}
            />
          )}
        </>
      }
      empty={
        <EmptyState
          icon={filtered ? <SearchXIcon /> : <KeyRoundIcon />}
          title={t('software.empty.title')}
          description={filtered || view !== 'all' ? t('software.empty.filtered') : t('software.empty.none')}
        />
      }
    />
  );

  return (
    <>
      <PageHeader
        title={t('nav.software')}
        description={t('software.description')}
        actions={
          canManage && (
            <Button
              label={t('software.new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(true)}
            />
          )
        }
      />
      <SoftwareSections />
      <VStack gap={4}>
        <QuickViews
          label={tc('filters')}
          value={view}
          onChange={(v) => set({ view: v === 'all' ? undefined : v })}
          options={VIEW_KEYS.map((v) => ({ value: v, label: t(`software.views.${v}`) }))}
        />
        {table}
      </VStack>
      <p className="sr-only" aria-live="polite">
        {data ? t('software.liveCount', { count: data.total }) : ''}
      </p>
      {canManage && (
        <LicenseFormDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={(l) => router.push(licenseHref(l))}
        />
      )}
    </>
  );
}
