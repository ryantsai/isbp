'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, DataTableSummary, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { type FilterDef, FilterBar } from '@isbp/ui/filter-bar';
import { PageHeader } from '@isbp/ui/page-header';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { NetworkIcon, PlusIcon, ShapesIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import {
  CI_CRITICALITIES,
  CI_ENVIRONMENTS,
  CI_STATUSES,
  CI_VIEWS,
  type CiCriticality,
  type CiEnvironment,
  type CiStatus,
  type CiSummary,
  type CiView,
} from '../../contracts';
import { ClassLabel, ClassName, CiStatusBadge, CriticalityBadge, EnvironmentBadge } from '../badges';
import { CiFormDialog } from '../ci-form-dialog';
import { ClassIcon } from '../class-icon';
import { ciHref, useClasses, useLookup } from '../data';

const ALL = '__all__';
const VIEWS = ['all', ...(Object.keys(CI_VIEWS) as CiView[])] as const;
type Tab = (typeof VIEWS)[number];
const FILTER_KEYS = ['q', 'class', 'status', 'environment', 'criticality', 'owner', 'supportGroup'] as const;

/** A URL-backed filter select with an "all" option. */
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
      <SelectTrigger className={className ?? 'w-full sm:w-44'} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

export default function CiListPage() {
  const t = useTranslations('cmdb');
  const router = useRouter();
  const canManage = useCan('cmdb.cis.manage');
  const canClasses = useCan('cmdb.classes.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const tab: Tab = VIEWS.includes(state.view as Tab) ? (state.view as Tab) : 'all';
  const str = (k: string) => (state[k] as string | undefined) || undefined;

  const { options: classes } = useClasses();
  const groups = useLookup('groups');
  const ownerId = str('owner');
  const people = usePeople(ownerId ? [ownerId] : []);
  const owner = ownerId ? (people.get(ownerId) ?? null) : null;

  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<CiSummary>>('/cmdb/cis', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    view: tab === 'all' ? undefined : tab,
    class: str('class'),
    status: str('status'),
    environment: str('environment'),
    criticality: str('criticality'),
    owner: ownerId,
    supportGroup: str('supportGroup'),
  });
  const filtered = FILTER_KEYS.some((k) => str(k));
  const clearAll = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])));

  const columns = useMemo<DataTableColumn<CiSummary>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.number'),
        size: 104,
        meta: { sortKey: 'number', priority: 2, className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => row.original.reference,
      },
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-64' },
        cell: ({ row }) => (
          <>
            <Link
              href={ciHref(row.original)}
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.name}
            </Link>
            {/* Narrow tables: what the hidden columns would say. */}
            <DataTableSummary>
              <span className="font-mono">{row.original.reference}</span>
              <span aria-hidden>·</span>
              <ClassName cls={row.original.class} />
              <span aria-hidden>·</span>
              <CriticalityBadge criticality={row.original.criticality} className="text-xs" />
            </DataTableSummary>
          </>
        ),
      },
      {
        id: 'class',
        header: t('fields.class'),
        meta: { sortKey: 'class', priority: 2, className: 'max-w-48 text-muted-foreground' },
        cell: ({ row }) => <ClassLabel cls={row.original.class} />,
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <CiStatusBadge status={row.original.status} />,
      },
      {
        id: 'criticality',
        header: t('fields.criticality'),
        meta: { sortKey: 'criticality', priority: 2 },
        cell: ({ row }) => <CriticalityBadge criticality={row.original.criticality} />,
      },
      {
        id: 'owner',
        header: t('fields.owner'),
        meta: { priority: 2, className: 'max-w-48' },
        cell: ({ row }) =>
          row.original.owner ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar
                name={row.original.owner.displayName}
                src={row.original.owner.avatarUrl}
                className="size-6 text-[10px]"
              />
              <span className="truncate">{row.original.owner.displayName}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        // Mostly "Production": only on wide tables.
        id: 'environment',
        header: t('fields.environment'),
        meta: { sortKey: 'environment', priority: 3, className: 'text-muted-foreground' },
        cell: ({ row }) => <EnvironmentBadge environment={row.original.environment} />,
      },
      {
        id: 'supportGroup',
        header: t('fields.supportGroup'),
        meta: { priority: 3, className: 'max-w-44 truncate text-muted-foreground' },
        cell: ({ row }) => row.original.supportGroup?.name ?? '—',
      },
    ],
    [t],
  );

  const classLabel = classes.find((c) => c.value === str('class'))?.label;
  const groupLabel = groups.items.find((g) => g.id === str('supportGroup'))?.name;
  // Search, the tabs and Status stay in view; the rest sit under "Filters".
  const filters: FilterDef[] = [
    {
      id: 'status',
      label: t('fields.status'),
      primary: true,
      value: str('status') ? t(`status.${str('status') as CiStatus}`) : undefined,
      onClear: () => set({ status: undefined }),
      control: (
        <FilterSelect
          value={str('status')}
          onChange={(v) => set({ status: v })}
          label={t('fields.status')}
          allLabel={t('list.filters.allStatuses')}
        >
          {CI_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`status.${s}`)}
            </SelectItem>
          ))}
        </FilterSelect>
      ),
    },
    {
      id: 'class',
      label: t('fields.class'),
      value: str('class') ? (classLabel ?? str('class')) : undefined,
      onClear: () => set({ class: undefined }),
      control: (
        <FilterSelect
          value={str('class')}
          onChange={(v) => set({ class: v })}
          label={t('fields.class')}
          allLabel={t('list.filters.allClasses')}
        >
          {classes.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              <ClassIcon name={c.icon} className="size-4 text-muted-foreground" />
              {c.label}
            </SelectItem>
          ))}
        </FilterSelect>
      ),
    },
    {
      id: 'criticality',
      label: t('fields.criticality'),
      value: str('criticality') ? t(`criticality.${str('criticality') as CiCriticality}`) : undefined,
      onClear: () => set({ criticality: undefined }),
      control: (
        <FilterSelect
          value={str('criticality')}
          onChange={(v) => set({ criticality: v })}
          label={t('fields.criticality')}
          allLabel={t('list.filters.allCriticalities')}
        >
          {CI_CRITICALITIES.map((c) => (
            <SelectItem key={c} value={c}>
              {t(`criticality.${c}`)}
            </SelectItem>
          ))}
        </FilterSelect>
      ),
    },
    {
      id: 'environment',
      label: t('fields.environment'),
      value: str('environment') ? t(`environment.${str('environment') as CiEnvironment}`) : undefined,
      onClear: () => set({ environment: undefined }),
      control: (
        <FilterSelect
          value={str('environment')}
          onChange={(v) => set({ environment: v })}
          label={t('fields.environment')}
          allLabel={t('list.filters.allEnvironments')}
        >
          {CI_ENVIRONMENTS.map((e) => (
            <SelectItem key={e} value={e}>
              {t(`environment.${e}`)}
            </SelectItem>
          ))}
        </FilterSelect>
      ),
    },
    {
      id: 'supportGroup',
      label: t('fields.supportGroup'),
      value: str('supportGroup') ? (groupLabel ?? '…') : undefined,
      onClear: () => set({ supportGroup: undefined }),
      control: (
        <FilterSelect
          value={str('supportGroup')}
          onChange={(v) => set({ supportGroup: v })}
          label={t('fields.supportGroup')}
          allLabel={t('list.filters.allGroups')}
        >
          {groups.items.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </FilterSelect>
      ),
    },
    {
      id: 'owner',
      label: t('fields.owner'),
      value: ownerId ? (owner?.displayName ?? '…') : undefined,
      onClear: () => set({ owner: undefined }),
      control: (
        <PersonPicker
          value={owner}
          onChange={(p) => set({ owner: p?.id })}
          placeholder={t('list.filters.anyOwner')}
          aria-label={t('fields.owner')}
        />
      ),
    },
  ];

  const table = (
    <DataTable
      label={t('list.title')}
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
      onRowClick={(c) => router.push(ciHref(c))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <FilterBar
          search={
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('list.search')}
              className="sm:w-72"
            />
          }
          filters={filters}
          onClearAll={clearAll}
        />
      }
      empty={
        filtered ? (
          <EmptyState variant="filtered" onClearFilters={clearAll} />
        ) : (
          <EmptyState
            icon={<NetworkIcon />}
            title={t('list.empty.title')}
            description={canManage ? t('list.empty.none') : t('list.empty.noneReader')}
            action={
              canManage && (
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon /> {t('list.new')}
                </Button>
              )
            }
          />
        )
      }
    />
  );

  return (
    <>
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          <>
            {canClasses && (
              <Button variant="outline" asChild>
                <Link href="/cmdb/classes">
                  <ShapesIcon /> {t('list.classes')}
                </Link>
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('list.new')}
              </Button>
            )}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => set({ view: v === 'all' ? undefined : v })} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`list.views.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {/* Each tab only filters the same list; Radix renders the active panel's content. */}
        {VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {table}
          </TabsContent>
        ))}
      </Tabs>
      <p className="sr-only" aria-live="polite">
        {data ? t('list.liveCount', { count: data.total }) : ''}
      </p>
      {canManage && (
        <CiFormDialog
          open={creating}
          onOpenChange={setCreating}
          defaultClass={tab === 'all' ? undefined : CI_VIEWS[tab][0]}
          onSaved={(ci) => router.push(ciHref(ci))}
        />
      )}
    </>
  );
}
