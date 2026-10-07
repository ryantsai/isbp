'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import type { ColumnDef } from '@tanstack/react-table';
import { NetworkIcon, PlusIcon, SearchXIcon, ShapesIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import {
  CI_CRITICALITIES,
  CI_ENVIRONMENTS,
  CI_STATUSES,
  CI_VIEWS,
  type CiSummary,
  type CiView,
} from '../../contracts';
import { ClassLabel, CiStatusBadge, CriticalityBadge, EnvironmentBadge } from '../badges';
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

export default function CiListPage() {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
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

  const { data, isLoading, isFetching } = useApiQuery<Page<CiSummary>>('/cmdb/cis', {
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

  const columns = useMemo<ColumnDef<CiSummary, unknown>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.number'),
        size: 104,
        meta: { sortKey: 'number', className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => row.original.reference,
      },
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-64' },
        cell: ({ row }) => (
          <Link
            href={ciHref(row.original)}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium outline-none hover:underline focus-visible:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'class',
        header: t('fields.class'),
        meta: { sortKey: 'class', className: 'max-w-48 text-muted-foreground' },
        cell: ({ row }) => <ClassLabel cls={row.original.class} />,
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <CiStatusBadge status={row.original.status} />,
      },
      {
        id: 'environment',
        header: t('fields.environment'),
        meta: {
          sortKey: 'environment',
          className: 'hidden lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => <EnvironmentBadge environment={row.original.environment} />,
      },
      {
        id: 'criticality',
        header: t('fields.criticality'),
        meta: { sortKey: 'criticality' },
        cell: ({ row }) => <CriticalityBadge criticality={row.original.criticality} />,
      },
      {
        id: 'owner',
        header: t('fields.owner'),
        meta: { className: 'hidden max-w-48 md:table-cell', headerClassName: 'hidden md:table-cell' },
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
        id: 'supportGroup',
        header: t('fields.supportGroup'),
        meta: {
          className: 'hidden max-w-44 truncate text-muted-foreground xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => row.original.supportGroup?.name ?? '—',
      },
    ],
    [t],
  );

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
      getRowId={(c) => c.id}
      onRowClick={(c) => router.push(ciHref(c))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('list.search')}
            className="sm:w-72"
          />
          <FilterSelect
            value={str('class')}
            onChange={(v) => set({ class: v })}
            label={t('fields.class')}
            allLabel={t('list.filters.allClasses')}
            className="w-full sm:w-48"
          >
            {classes.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                <ClassIcon name={c.icon} className="size-4 text-muted-foreground" />
                {c.label}
              </SelectItem>
            ))}
          </FilterSelect>
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
          <FilterSelect
            value={str('supportGroup')}
            onChange={(v) => set({ supportGroup: v })}
            label={t('fields.supportGroup')}
            allLabel={t('list.filters.allGroups')}
            className="w-full sm:w-48"
          >
            {groups.items.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </FilterSelect>
          <div className="w-full sm:w-52">
            <PersonPicker
              value={owner}
              onChange={(p) => set({ owner: p?.id })}
              placeholder={t('list.filters.anyOwner')}
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
          icon={filtered ? <SearchXIcon /> : <NetworkIcon />}
          title={t('list.empty.title')}
          description={filtered ? t('list.empty.filtered') : t('list.empty.none')}
          action={
            !filtered &&
            canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('list.new')}
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
        <TabsList>
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`list.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
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
