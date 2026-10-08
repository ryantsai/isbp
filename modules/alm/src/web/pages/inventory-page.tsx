'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedNumber, Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  AppWindowIcon,
  CalendarRangeIcon,
  CircleCheckIcon,
  CircleXIcon,
  PlusIcon,
  RocketIcon,
  SearchXIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import {
  APP_STAGES,
  type AppStage,
  type AppSummary,
  CRITICALITIES,
  type Dashboard,
  HOSTINGS,
} from '../../contracts';
import { AppFormDialog } from '../app-form-dialog';
import {
  CriticalityBadge,
  DeploymentStatusText,
  HostingLabel,
  STAGE_META,
  StageBadge,
  TONE,
} from '../badges';
import { appHref } from '../lib';

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

/** Counts by stage, deployments in the last 7 days and releases coming up. */
function SummaryStrip({ onStage }: { onStage: (stage: AppStage) => void }) {
  const t = useTranslations('alm');
  const { data } = useApiQuery<Dashboard>('/alm/dashboard');
  if (!data)
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[4.5rem] rounded-xl" />
        ))}
      </div>
    );
  const tile = 'flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-left shadow-xs';
  return (
    <Stagger
      className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7"
      role="group"
      aria-label={t('inventory.summary')}
    >
      {APP_STAGES.map((stage) => {
        const Icon = STAGE_META[stage].icon;
        return (
          <StaggerItem key={stage} className="min-w-0">
            <button
              type="button"
              onClick={() => onStage(stage)}
              className={cn(
                tile,
                'w-full outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50',
              )}
            >
              <span className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
                <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
                <span className="line-clamp-2">{t(`stage.${stage}`)}</span>
              </span>
              <span className="text-2xl font-semibold tracking-tight">
                <AnimatedNumber value={data.byStage[stage] ?? 0} />
              </span>
            </button>
          </StaggerItem>
        );
      })}
      <StaggerItem className={cn(tile, 'min-w-0')}>
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {t('inventory.deploymentsWeek')}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1 text-lg font-semibold text-success">
            <CircleCheckIcon className="size-4" aria-hidden />
            <AnimatedNumber value={data.week.succeeded} />
            <span className="sr-only">{t('deploymentStatus.succeeded')}</span>
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-lg font-semibold',
              data.week.failed ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            <CircleXIcon className="size-4" aria-hidden />
            <AnimatedNumber value={data.week.failed} />
            <span className="sr-only">{t('inventory.failedOrRolledBack')}</span>
          </span>
        </span>
      </StaggerItem>
      <StaggerItem className="min-w-0">
        <Link
          href="/alm/releases"
          className={cn(
            tile,
            'h-full outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          )}
        >
          <span className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
            <RocketIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">{t('inventory.upcoming')}</span>
          </span>
          <span className="text-2xl font-semibold tracking-tight">
            <AnimatedNumber value={data.upcoming.length} />
          </span>
        </Link>
      </StaggerItem>
    </Stagger>
  );
}

export default function InventoryPage() {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const router = useRouter();
  const canManage = useCan('alm.apps.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const stage = str('stage');

  const { data, isLoading, isFetching } = useApiQuery<Page<AppSummary>>('/alm/applications', {
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

  const columns = useMemo<DataTableColumn<AppSummary>[]>(
    () => [
      {
        id: 'code',
        header: t('fields.code'),
        size: 120,
        meta: { sortKey: 'code', className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => row.original.code,
      },
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-64' },
        cell: ({ row }) => (
          <Link
            href={appHref(row.original.code)}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium outline-none hover:underline focus-visible:underline"
          >
            {row.original.name}
          </Link>
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
        meta: {
          sortKey: 'criticality',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <CriticalityBadge criticality={row.original.criticality} />,
      },
      {
        id: 'hosting',
        header: t('fields.hosting'),
        meta: {
          sortKey: 'hosting',
          className: 'hidden xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => <HostingLabel hosting={row.original.hosting} />,
      },
      {
        id: 'technicalOwner',
        header: t('fields.technicalOwner'),
        meta: { className: 'hidden max-w-44 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
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
        meta: {
          className: 'hidden max-w-40 truncate text-muted-foreground 2xl:table-cell',
          headerClassName: 'hidden 2xl:table-cell',
        },
        cell: ({ row }) => row.original.team?.name ?? '—',
      },
      {
        id: 'production',
        header: t('fields.productionVersion'),
        meta: {
          className: 'hidden font-mono text-xs md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.productionVersion ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'lastDeployment',
        header: t('fields.lastDeployment'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => {
          const d = row.original.lastDeployment;
          if (!d) return <span className="text-muted-foreground">{t('inventory.neverDeployed')}</span>;
          return (
            <span className="flex min-w-0 flex-col gap-0.5 text-xs">
              <DeploymentStatusText status={d.status} />
              <span className="truncate text-muted-foreground">
                {d.environment.name} · <span className="font-mono">{d.version}</span> ·{' '}
                <RelativeTime date={d.at} />
              </span>
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
      getRowId={(a) => a.id}
      onRowClick={(a) => router.push(appHref(a.code))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('inventory.search')}
            className="sm:w-72"
          />
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
          {stage && (
            <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs', TONE.primary)}>
              {t('inventory.stageFilter', {
                stages: stage
                  .split(',')
                  .map((s) => t(`stage.${s}`))
                  .join(', '),
              })}
            </span>
          )}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                set({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])), stage: undefined })
              }
            >
              {tc('clearFilters')}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={filtered ? <SearchXIcon /> : <AppWindowIcon />}
          title={view === 'mine' && !filtered ? t('inventory.emptyMine') : t('inventory.empty')}
          description={filtered ? t('inventory.emptyFiltered') : t('inventory.emptyHint')}
          action={
            !filtered &&
            canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('inventory.new')}
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
        title={t('inventory.title')}
        description={t('inventory.description')}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/alm/releases">
                <CalendarRangeIcon /> {t('calendar.title')}
              </Link>
            </Button>
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('inventory.new')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <SummaryStrip onStage={(s) => set({ view: undefined, stage: s })} />
        <Tabs
          value={view}
          onValueChange={(v) => set({ view: v === 'all' ? undefined : v, stage: undefined })}
        >
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`inventory.views.${v}`)}
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
