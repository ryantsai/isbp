'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { LaptopIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import { ASSET_CATEGORIES, type AssetListItem, HARDWARE_VIEWS, type HardwareView } from '../../contracts';
import { AssetFormDialog } from '../asset-form-dialog';
import { AssetStatusBadge, CategoryIcon, CategoryLabel, WarrantyEnd, WipeBadge } from '../badges';
import { assetHref, modelLabel, useModels, useVendors } from '../lib';
import { QuickViews } from './quick-views';

const ALL = '__all__';
const VIEWS = ['all', ...(Object.keys(HARDWARE_VIEWS) as HardwareView[])] as const;
type Tab = (typeof VIEWS)[number];
const FILTER_KEYS = ['q', 'category', 'warranty', 'wipe', 'location', 'assignee', 'model', 'vendor'] as const;

/** One toolbar filter: "all" first (the cleared state), then the choices. */
function FilterSelect({
  value,
  onChange,
  allLabel,
  label,
  width = 160,
  options,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allLabel: string;
  label: string;
  width?: number;
  options: readonly { value: string; label: string; icon?: ReactNode }[];
}) {
  return (
    <Selector
      label={label}
      isLabelHidden
      width={width}
      value={value ?? ALL}
      onChange={(v) => onChange(v === ALL ? undefined : v)}
      options={[{ value: ALL, label: allLabel }, ...options]}
    />
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

  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<AssetListItem>>('/itam/assets', {
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
        meta: { sortKey: 'number' },
        cell: ({ row }) => (
          <Text type="code" size="xsm" color="secondary">
            {row.original.tag}
          </Text>
        ),
      },
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-56' },
        cell: ({ row }) => (
          <HStack gap={2} vAlign="center">
            <CategoryIcon category={row.original.category} color="secondary" className="sm:hidden" label />
            <StackItem size="fill">
              <Link
                href={assetHref(row.original)}
                color="primary"
                weight="medium"
                maxLines={1}
                onClick={(e) => e.stopPropagation()}
              >
                {row.original.name}
              </Link>
            </StackItem>
          </HStack>
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
            <Text maxLines={1}>{modelLabel(row.original.model)}</Text>
          ) : (
            <Text color="secondary">—</Text>
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
            <HStack gap={2} vAlign="center">
              <UserAvatar
                name={row.original.assignee.displayName}
                src={row.original.assignee.avatarUrl}
                className="size-6 text-[10px]"
              />
              <StackItem size="fill">
                <Text maxLines={1}>{row.original.assignee.displayName}</Text>
              </StackItem>
            </HStack>
          ) : (
            <Text color="secondary">—</Text>
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
            <VStack gap={1} hAlign="start">
              <WarrantyEnd date={row.original.warrantyEnd} state={row.original.warrantyState} />
              <WipeBadge state={row.original.wipeState} date={row.original.wipeDue} />
            </VStack>
          ) : (
            <WarrantyEnd date={row.original.warrantyEnd} state={row.original.warrantyState} />
          ),
      },
    ],
    [t],
  );

  const table = (
    <DataTable
      key={tab}
      label={t('hardware.title')}
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
            options={ASSET_CATEGORIES.map((c) => ({
              value: c,
              label: t(`category.${c}`),
              icon: <CategoryIcon category={c} />,
            }))}
          />
          <FilterSelect
            value={str('warranty')}
            onChange={(v) => set({ warranty: v })}
            label={t('fields.warrantyEnd')}
            allLabel={t('hardware.filters.anyWarranty')}
            options={[
              { value: 'expiring', label: t('hardware.filters.warrantyExpiring') },
              { value: 'expired', label: t('hardware.filters.warrantyExpired') },
            ]}
          />
          <FilterSelect
            value={str('wipe')}
            onChange={(v) => set({ wipe: v })}
            label={t('hardware.filters.wipe')}
            allLabel={t('hardware.filters.anyWipe')}
            options={[
              { value: 'pending', label: t('hardware.filters.wipePending') },
              { value: 'due', label: t('hardware.filters.wipeDue') },
              { value: 'overdue', label: t('hardware.filters.wipeOverdue') },
            ]}
          />
          <FilterSelect
            value={str('location')}
            onChange={(v) => set({ location: v })}
            label={t('fields.location')}
            allLabel={t('hardware.filters.allLocations')}
            width={192}
            options={(locations?.items ?? []).map((l) => ({ value: l, label: l }))}
          />
          <FilterSelect
            value={str('model')}
            onChange={(v) => set({ model: v })}
            label={t('fields.model')}
            allLabel={t('hardware.filters.allModels')}
            width={208}
            options={models.map((m) => ({ value: m.id, label: modelLabel(m) }))}
          />
          {canVendors && (
            <FilterSelect
              value={str('vendor')}
              onChange={(v) => set({ vendor: v })}
              label={t('fields.vendor')}
              allLabel={t('hardware.filters.allVendors')}
              width={192}
              options={vendors.map((v) => ({ value: v.id, label: v.name }))}
            />
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
              label={tc('clearFilters')}
              variant="ghost"
              size="sm"
              onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
            />
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
              <Button
                label={t('hardware.new')}
                variant="primary"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => setCreating(true)}
              />
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
            <Button
              label={t('hardware.new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(true)}
            />
          )
        }
      />
      <VStack gap={4}>
        <QuickViews
          label={tc('filters')}
          value={tab}
          onChange={(v) => set({ view: v === 'all' ? undefined : v })}
          options={VIEWS.map((v) => ({ value: v, label: t(`hardware.views.${v}`) }))}
        />
        {table}
      </VStack>
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
