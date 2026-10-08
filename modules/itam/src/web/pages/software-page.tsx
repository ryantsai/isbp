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
import { KeyRoundIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { LICENSE_TYPES, type LicenseListItem } from '../../contracts';
import { ComplianceBadge } from '../badges';
import { LicenseFormDialog } from '../license-form-dialog';
import { licenseHref, useDay, useItamSettings, useMoney, useVendors } from '../lib';
import { UsageMeter } from '../meters';

const ALL = '__all__';
/** Quick tabs → compliance states. */
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

  const { data, isLoading, isFetching } = useApiQuery<Page<LicenseListItem>>('/itam/licenses', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    compliance: VIEWS[view],
    type: str('type'),
    vendor: str('vendor'),
  });
  const filtered = Boolean(state.q || str('type') || str('vendor'));

  const columns = useMemo<DataTableColumn<LicenseListItem>[]>(
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
        id: 'product',
        header: t('fields.product'),
        meta: { sortKey: 'product', className: 'max-w-64' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={licenseHref(row.original)}
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.product}
            </Link>
            {row.original.publisher && (
              <span className="block truncate text-xs text-muted-foreground">{row.original.publisher}</span>
            )}
          </div>
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
            <span className="text-muted-foreground">{t('software.perpetual')}</span>
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
      label={t('software.title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      loading={isLoading}
      fetching={isFetching}
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
          <Select value={str('type') ?? ALL} onValueChange={(v) => set({ type: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-full sm:w-44" aria-label={t('fields.licenseType')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('software.allTypes')}</SelectItem>
              {LICENSE_TYPES.map((x) => (
                <SelectItem key={x} value={x}>
                  {t(`licenseType.${x}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {vendors.length > 0 && (
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
          )}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ q: undefined, type: undefined, vendor: undefined })}
            >
              {tc('clearFilters')}
            </Button>
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
        title={t('software.title')}
        description={t('software.description')}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('software.new')}
            </Button>
          )
        }
      />
      <Tabs value={view} onValueChange={(v) => set({ view: v === 'all' ? undefined : v })} className="gap-4">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {VIEW_KEYS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`software.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {VIEW_KEYS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {view === v && table}
          </TabsContent>
        ))}
      </Tabs>
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
