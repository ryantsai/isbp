'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { LaptopIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import { ASSET_CATEGORIES, type AssetListItem, HARDWARE_VIEWS, type HardwareView } from '../../contracts';
import { AssetFormDialog } from '../asset-form-dialog';
import { AssetStatusBadge, CategoryIcon, CategoryLabel, WarrantyEnd, WipeBadge } from '../badges';
import { assetHref, modelLabel, useModels, useVendors } from '../lib';

const ALL = '__all__';
const VIEWS = ['all', ...(Object.keys(HARDWARE_VIEWS) as HardwareView[])] as const;
type Tab = (typeof VIEWS)[number];
const FILTER_KEYS = ['q', 'category', 'warranty', 'wipe', 'location', 'assignee', 'model', 'vendor'] as const;

function FilterSelect({
  value,
  onChange,
  allLabel,
  label,
  className,
  children,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allLabel: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={className ?? 'w-full sm:w-40'} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

/** Hardware: every device through its lifecycle, with quick tabs and filters kept in the URL. */
export default function HardwarePage() {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const router = useRouter();
  const canManage = useCan('itam.hardware.manage');
  const canReadContracts = useCan('itam.contracts.read');
  const canConfig = useCan('itam.config.manage');
  const canVendors = canReadContracts || canConfig;
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const tab: Tab = VIEWS.includes(state.view as Tab) ? (state.view as Tab) : 'all';
  const str = (k: string) => (state[k] as string | undefined) || undefined;

  const { models } = useModels();
  const { vendors } = useVendors(canVendors);
  const { data: locations } = useApiQuery<{ items: string[] }>('/itam/lookups/locations');
  const assigneeId = str('assignee');
  const people = usePeople(assigneeId ? [assigneeId] : []);
  const assignee = assigneeId ? (people.get(assigneeId) ?? null) : null;

  const { data, isLoading, isFetching } = useApiQuery<Page<AssetListItem>>('/itam/assets', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    view: tab === 'all' ? undefined : tab,
    category: str('category'),
    warranty: str('warranty'),
    wipe: str('wipe'),
    location: str('location'),
    assignee: assigneeId,
    model: str('model'),
    vendor: str('vendor'),
  });
  const filtered = FILTER_KEYS.some((k) => str(k));

  const columns = useMemo<DataTableColumn<AssetListItem>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.tag'),
        size: 104,
        meta: { sortKey: 'number', className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => row.original.tag,
      },
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-56' },
        cell: ({ row }) => (
          <Link
            href={assetHref(row.original)}
            onClick={(e) => e.stopPropagation()}
            className="flex min-w-0 items-center gap-2 font-medium outline-none hover:underline focus-visible:underline"
          >
            <CategoryIcon
              category={row.original.category}
              className="text-muted-foreground sm:hidden"
              label
            />
            <span className="truncate">{row.original.name}</span>
          </Link>
        ),
      },
      {
        id: 'category',
        header: t('fields.category'),
        meta: {
          sortKey: 'category',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <CategoryLabel category={row.original.category} />,
      },
      {
        id: 'model',
        header: t('fields.model'),
        meta: { className: 'hidden max-w-52 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) =>
          row.original.model ? (
            <span className="block truncate">{modelLabel(row.original.model)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <AssetStatusBadge status={row.original.status} />,
      },
      {
        id: 'assignee',
        header: t('fields.assignedTo'),
        meta: {
          sortKey: 'assignee',
          className: 'hidden max-w-48 md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) =>
          row.original.assignee ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar
                name={row.original.assignee.displayName}
                src={row.original.assignee.avatarUrl}
                className="size-6 text-[10px]"
              />
              <span className="truncate">{row.original.assignee.displayName}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'location',
        header: t('fields.location'),
        meta: {
          sortKey: 'location',
          className: 'hidden max-w-44 truncate text-muted-foreground xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => row.original.location ?? '—',
      },
      {
        id: 'warrantyEnd',
        header: t('fields.warrantyEnd'),
        meta: {
          sortKey: 'warrantyEnd',
          className: 'hidden max-w-52 lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) =>
          row.original.wipeState === 'due' || row.original.wipeState === 'overdue' ? (
            <div className="grid min-w-0 justify-items-start gap-1">
              <WarrantyEnd date={row.original.warrantyEnd} state={row.original.warrantyState} />
              <WipeBadge state={row.original.wipeState} date={row.original.wipeDue} />
            </div>
          ) : (
            <WarrantyEnd date={row.original.warrantyEnd} state={row.original.warrantyState} />
          ),
      },
    ],
    [t],
  );

  const table = (
    <DataTable
      label={t('hardware.title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      loading={isLoading}
      fetching={isFetching}
      getRowId={(a) => a.id}
      onRowClick={(a) => router.push(assetHref(a))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('hardware.search')}
            className="sm:w-64"
          />
          <FilterSelect
            value={str('category')}
            onChange={(v) => set({ category: v })}
            label={t('fields.category')}
            allLabel={t('hardware.filters.allCategories')}
          >
            {ASSET_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                <CategoryIcon category={c} className="text-muted-foreground" />
                {t(`category.${c}`)}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={str('warranty')}
            onChange={(v) => set({ warranty: v })}
            label={t('fields.warrantyEnd')}
            allLabel={t('hardware.filters.anyWarranty')}
          >
            <SelectItem value="expiring">{t('hardware.filters.warrantyExpiring')}</SelectItem>
            <SelectItem value="expired">{t('hardware.filters.warrantyExpired')}</SelectItem>
          </FilterSelect>
          <FilterSelect
            value={str('wipe')}
            onChange={(v) => set({ wipe: v })}
            label={t('hardware.filters.wipe')}
            allLabel={t('hardware.filters.anyWipe')}
          >
            <SelectItem value="pending">{t('hardware.filters.wipePending')}</SelectItem>
            <SelectItem value="due">{t('hardware.filters.wipeDue')}</SelectItem>
            <SelectItem value="overdue">{t('hardware.filters.wipeOverdue')}</SelectItem>
          </FilterSelect>
          <FilterSelect
            value={str('location')}
            onChange={(v) => set({ location: v })}
            label={t('fields.location')}
            allLabel={t('hardware.filters.allLocations')}
            className="w-full sm:w-48"
          >
            {(locations?.items ?? []).map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={str('model')}
            onChange={(v) => set({ model: v })}
            label={t('fields.model')}
            allLabel={t('hardware.filters.allModels')}
            className="w-full sm:w-52"
          >
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {modelLabel(m)}
              </SelectItem>
            ))}
          </FilterSelect>
          {canVendors && (
            <FilterSelect
              value={str('vendor')}
              onChange={(v) => set({ vendor: v })}
              label={t('fields.vendor')}
              allLabel={t('hardware.filters.allVendors')}
              className="w-full sm:w-48"
            >
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </FilterSelect>
          )}
          <div className="w-full sm:w-52">
            <PersonPicker
              value={assignee}
              onChange={(p) => set({ assignee: p?.id })}
              placeholder={t('hardware.filters.anyone')}
              aria-label={t('fields.assignedTo')}
            />
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
            >
              {tc('clearFilters')}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={filtered ? <SearchXIcon /> : <LaptopIcon />}
          title={t('hardware.empty.title')}
          description={filtered ? t('hardware.empty.filtered') : t('hardware.empty.none')}
          action={
            !filtered &&
            canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('hardware.new')}
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
        title={t('hardware.title')}
        description={t('hardware.description')}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('hardware.new')}
            </Button>
          )
        }
      />
      <Tabs value={tab} onValueChange={(v) => set({ view: v === 'all' ? undefined : v })} className="gap-4">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`hardware.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Each tab only filters the same list; every tab still owns a panel (aria-controls). */}
        {VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {tab === v && table}
          </TabsContent>
        ))}
      </Tabs>
      <p className="sr-only" aria-live="polite">
        {data ? t('hardware.liveCount', { count: data.total }) : ''}
      </p>
      {canManage && (
        <AssetFormDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={(a) => router.push(assetHref(a))}
        />
      )}
    </>
  );
}
