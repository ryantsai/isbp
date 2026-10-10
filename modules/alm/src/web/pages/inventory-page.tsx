'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar } from '@isbp/ui/filter-bar';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { AppWindowIcon, CircleCheckIcon, CircleXIcon, PlusIcon, RocketIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import { type AppStage, type AppSummary, CRITICALITIES, type Dashboard, HOSTINGS } from '../../contracts';
import { AppFormDialog } from '../app-form-dialog';
import { CriticalityBadge, DeploymentStatusText, HostingLabel, StageBadge } from '../badges';
import { appHref } from '../lib';
import { AlmTabs } from '../section-tabs';

const ALL = '__all__';
const VIEWS = ['all', 'production', 'development', 'sunset', 'mine'] as const;
type View = (typeof VIEWS)[number];
const VIEW_STAGES: Partial<Record<View, string>> = {
  production: 'production',
  development: 'development',
  sunset: 'sunsetting,retired',
};
const FILTER_KEYS = ['q', 'criticality', 'hosting'] as const;

function FilterSelect({
  value,
  onChange,
  allLabel,
  label,
  children,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allLabel: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className="w-full sm:w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

/** Two figures: delivery in the last week and what is coming (stage counts are on the tabs below). */
function SummaryStrip({ data }: { data: Dashboard | undefined }) {
  const t = useTranslations('alm');
  if (!data)
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label={t('inventory.summary')}>
      <StatTile
        icon={data.week.failed > 0 ? <CircleXIcon /> : <CircleCheckIcon />}
        tone={data.week.failed > 0 ? 'destructive' : 'success'}
        label={t('inventory.deploymentsWeek')}
        value={data.week.total}
        hint={t('inventory.deploymentsWeekHint', {
          succeeded: data.week.succeeded,
          failed: data.week.failed,
        })}
      />
      <StatTile
        icon={<RocketIcon />}
        label={t('inventory.upcoming')}
        value={data.upcoming.length}
        hint={t('inventory.upcomingHint')}
        href="/alm/releases"
      />
    </div>
  );
}

export default function InventoryPage() {
  const t = useTranslations('alm');
  const router = useRouter();
  const canManage = useCan('alm.apps.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const stage = str('stage');

  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<AppSummary>>('/alm/applications', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    stage: stage ?? VIEW_STAGES[view],
    owner: view === 'mine' ? 'me' : undefined,
    criticality: str('criticality'),
    hosting: str('hosting'),
  });
  const filtered = FILTER_KEYS.some((k) => str(k)) || Boolean(stage);
  const dashboard = useApiQuery<Dashboard>('/alm/dashboard');
  const byStage = dashboard.data?.byStage;
  /** How many applications each stage tab holds. */
  const viewCount = (v: View): number | null => {
    if (!byStage) return null;
    if (v === 'all') return dashboard.data!.total;
    if (v === 'mine') return null;
    return (VIEW_STAGES[v] ?? '').split(',').reduce((n, st) => n + (byStage[st as AppStage] ?? 0), 0);
  };

  const columns = useMemo<DataTableColumn<AppSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-72', wrap: true },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Link
              href={appHref(row.original.code)}
              onClick={(e) => e.stopPropagation()}
              className="font-medium wrap-anywhere outline-none hover:underline focus-visible:underline"
            >
              {row.original.name}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>
          </div>
        ),
      },
      {
        id: 'stage',
        header: t('fields.stage'),
        meta: { sortKey: 'stage' },
        cell: ({ row }) => <StageBadge stage={row.original.stage} />,
      },
      {
        id: 'criticality',
        header: t('fields.criticality'),
        meta: { sortKey: 'criticality', priority: 2 },
        cell: ({ row }) => <CriticalityBadge criticality={row.original.criticality} />,
      },
      {
        id: 'hosting',
        header: t('fields.hosting'),
        meta: { sortKey: 'hosting', priority: 3 },
        cell: ({ row }) => <HostingLabel hosting={row.original.hosting} />,
      },
      {
        id: 'technicalOwner',
        header: t('fields.technicalOwner'),
        meta: { className: 'max-w-44', priority: 3 },
        cell: ({ row }) =>
          row.original.technicalOwner ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar
                name={row.original.technicalOwner.displayName}
                src={row.original.technicalOwner.avatarUrl}
                className="size-6 text-[10px]"
              />
              <span className="truncate">{row.original.technicalOwner.displayName}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'team',
        header: t('fields.team'),
        meta: { className: 'max-w-40 truncate text-muted-foreground', priority: 3 },
        cell: ({ row }) => row.original.team?.name ?? '—',
      },
      {
        id: 'production',
        header: t('fields.productionVersion'),
        meta: { className: 'font-mono text-xs', priority: 3 },
        cell: ({ row }) => row.original.productionVersion ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'lastDeployment',
        header: t('fields.lastDeployment'),
        meta: { priority: 2 },
        cell: ({ row }) => {
          const d = row.original.lastDeployment;
          if (!d) return <span className="text-muted-foreground">{t('inventory.neverDeployed')}</span>;
          return (
            <span className="flex min-w-0 flex-col gap-0.5 text-xs">
              <span className="flex flex-wrap items-center gap-x-1.5">
                <DeploymentStatusText status={d.status} />
                <span className="text-muted-foreground">
                  {d.environment.name} · <span className="font-mono">{d.version}</span>
                </span>
              </span>
              <RelativeTime date={d.at} className="text-muted-foreground" />
            </span>
          );
        },
      },
    ],
    [t],
  );

  const table = (
    <DataTable
      label={t('inventory.title')}
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
      onRowClick={(a) => router.push(appHref(a.code))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <FilterBar
          search={
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('inventory.search')}
              className="sm:w-72"
            />
          }
          filters={[
            {
              id: 'criticality',
              label: t('fields.criticality'),
              primary: true,
              value: str('criticality') ? t(`criticality.${str('criticality')}`) : undefined,
              onClear: () => set({ criticality: undefined }),
              control: (
                <FilterSelect
                  value={str('criticality')}
                  onChange={(v) => set({ criticality: v })}
                  label={t('fields.criticality')}
                  allLabel={t('inventory.allCriticalities')}
                >
                  {CRITICALITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`criticality.${c}`)}
                    </SelectItem>
                  ))}
                </FilterSelect>
              ),
            },
            {
              id: 'hosting',
              label: t('fields.hosting'),
              primary: true,
              value: str('hosting') ? t(`hosting.${str('hosting')}`) : undefined,
              onClear: () => set({ hosting: undefined }),
              control: (
                <FilterSelect
                  value={str('hosting')}
                  onChange={(v) => set({ hosting: v })}
                  label={t('fields.hosting')}
                  allLabel={t('inventory.allHosting')}
                >
                  {HOSTINGS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {t(`hosting.${h}`)}
                    </SelectItem>
                  ))}
                </FilterSelect>
              ),
            },
            ...(stage
              ? [
                  {
                    id: 'stage',
                    label: t('fields.stage'),
                    value: stage
                      .split(',')
                      .map((st) => t(`stage.${st}`))
                      .join(', '),
                    onClear: () => set({ stage: undefined }),
                    control: (
                      <span className="text-sm text-muted-foreground">
                        {stage
                          .split(',')
                          .map((st) => t(`stage.${st}`))
                          .join(', ')}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
          onClearAll={() =>
            set({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])), stage: undefined })
          }
        />
      }
      empty={
        filtered ? (
          <EmptyState
            variant="filtered"
            onClearFilters={() =>
              set({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])), stage: undefined })
            }
          />
        ) : (
          <EmptyState
            icon={<AppWindowIcon />}
            title={view === 'mine' ? t('inventory.emptyMine') : t('inventory.empty')}
            description={t('inventory.emptyHint')}
            action={
              canManage && (
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon /> {t('inventory.new')}
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
        title={t('inventory.title')}
        description={t('inventory.description')}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('inventory.new')}
            </Button>
          )
        }
      />
      <AlmTabs />
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <SummaryStrip data={dashboard.data} />
        <Tabs
          value={view}
          onValueChange={(v) => set({ view: v === 'all' ? undefined : v, stage: undefined })}
        >
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`inventory.views.${v}`)}
                {viewCount(v) !== null && (
                  <Badge variant="muted" className="px-1.5 tabular-nums">
                    {viewCount(v)}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* Each tab only filters the same list; every tab still has its panel. */}
          {VIEWS.map((v) => (
            <TabsContent key={v} value={v} className="min-w-0">
              {v === view && table}
            </TabsContent>
          ))}
        </Tabs>
      </div>
      <p className="sr-only" aria-live="polite">
        {data ? t('inventory.liveCount', { count: data.total }) : ''}
      </p>
      {canManage && (
        <AppFormDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={(a) => router.push(appHref(a.code))}
        />
      )}
    </>
  );
}
