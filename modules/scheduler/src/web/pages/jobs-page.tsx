'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { SelectItem } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { CalendarClockIcon, PlusIcon, SearchXIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { type JobSummary, type JobView, TRIGGER_KINDS } from '../../contracts';
import { JobStateBadge, RunStatusText, TaskIcon, TRIGGER_ICON } from '../badges';
import { jobHref, runHref, useTaskTypes, useTypeName } from '../lib';
import { FilterSelect } from '../runs-table';
import { useTriggerText } from '../trigger-text';

const VIEWS: JobView[] = ['all', 'failing', 'running', 'disabled', 'mine'];
const FILTER_KEYS = ['q', 'type', 'trigger'] as const;

export default function JobsPage() {
  const t = useTranslations('scheduler');
  const tc = useTranslations('common');
  const router = useRouter();
  const canCreate = useCan('scheduler.jobs.create');
  const triggerText = useTriggerText();
  const typeName = useTypeName();
  const { items: types } = useTaskTypes(true);
  const [state, set] = useListState({ pageSize: 25 });
  const view: JobView = VIEWS.includes(state.view as JobView) ? (state.view as JobView) : 'all';
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { data, isLoading, isFetching } = useApiQuery<Page<JobSummary>>(
    '/scheduler/jobs',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
      view: view === 'all' ? undefined : view,
      type: str('type'),
      trigger: str('trigger'),
    },
    { refetchInterval: 30_000 },
  );
  const filtered = FILTER_KEYS.some((k) => str(k));

  const columns = useMemo<DataTableColumn<JobSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-72' },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <Link
              href={jobHref(row.original.id)}
              onClick={(e) => e.stopPropagation()}
              className="truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.name}
            </Link>
            <span className="truncate font-mono text-xs text-muted-foreground">{row.original.reference}</span>
          </span>
        ),
      },
      {
        id: 'task',
        header: t('fields.task'),
        meta: { className: 'hidden max-w-72 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <TaskIcon icon={row.original.task.icon} className="text-muted-foreground" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium">
                {typeName(row.original.task.name, row.original.type)}
              </span>
              <span className="truncate text-xs text-muted-foreground">{row.original.task.label}</span>
            </span>
          </span>
        ),
      },
      {
        id: 'nextRunAt',
        header: t('fields.schedule'),
        meta: { sortKey: 'nextRunAt', className: 'max-w-60' },
        cell: ({ row }) => {
          const j = row.original;
          const Icon = TRIGGER_ICON[j.trigger.kind];
          return (
            <span className="flex min-w-0 flex-col text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{triggerText(j.trigger)}</span>
              </span>
              {j.enabled && j.nextRunAt && (
                <span className="truncate text-muted-foreground">
                  {t('jobs.next')} <RelativeTime date={j.nextRunAt} />
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'lastRunAt',
        header: t('fields.lastRun'),
        meta: {
          sortKey: 'lastRunAt',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => {
          const r = row.original.lastRun;
          if (!r) return <span className="text-xs text-muted-foreground">{t('jobs.neverRun')}</span>;
          return (
            <span className="flex min-w-0 flex-col gap-0.5 text-xs">
              <Link
                href={runHref(r.id)}
                onClick={(e) => e.stopPropagation()}
                className="w-fit rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <RunStatusText status={r.status} />
              </Link>
              <RelativeTime
                date={r.finishedAt ?? r.startedAt ?? r.scheduledFor}
                className="text-muted-foreground"
              />
              {row.original.failureStreak > 1 && (
                <span className="font-medium text-destructive">
                  {t('jobs.streak', { count: row.original.failureStreak })}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'owner',
        header: t('fields.owner'),
        meta: { className: 'hidden max-w-48 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => {
          const { owner, ownerGroup } = row.original;
          if (!owner && !ownerGroup) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="flex min-w-0 flex-col gap-0.5 text-xs">
              {owner && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <UserAvatar name={owner.displayName} src={owner.avatarUrl} className="size-5 text-[9px]" />
                  <span className="truncate">{owner.displayName}</span>
                </span>
              )}
              {ownerGroup && (
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <UsersIcon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{ownerGroup.name}</span>
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'enabled',
        header: t('fields.state'),
        meta: { className: 'hidden xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) => (
          <JobStateBadge enabled={row.original.enabled} disabledReason={row.original.disabledReason} />
        ),
      },
    ],
    [t, triggerText, typeName],
  );

  const table = (
    <DataTable
      label={t('jobs.title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      loading={isLoading}
      fetching={isFetching}
      getRowId={(j) => j.id}
      onRowClick={(j) => router.push(jobHref(j.id))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('jobs.search')}
            className="sm:w-72"
          />
          <FilterSelect
            value={str('type')}
            onChange={(v) => set({ type: v })}
            label={t('fields.taskType')}
            allLabel={t('jobs.allTypes')}
            className="w-full sm:w-48"
          >
            {types.map((ty) => (
              <SelectItem key={ty.type} value={ty.type}>
                {typeName(ty.name, ty.type)}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={str('trigger')}
            onChange={(v) => set({ trigger: v })}
            label={t('fields.trigger')}
            allLabel={t('jobs.allTriggers')}
          >
            {TRIGGER_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`triggerKind.${k}`)}
              </SelectItem>
            ))}
          </FilterSelect>
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
          icon={filtered ? <SearchXIcon /> : <CalendarClockIcon />}
          title={t(`jobs.empty.${view}`)}
          description={filtered ? t('jobs.emptyFiltered') : t('jobs.emptyHint')}
          action={
            !filtered &&
            view === 'all' &&
            canCreate && (
              <Button asChild>
                <Link href="/scheduler/jobs/new">
                  <PlusIcon /> {t('jobs.new')}
                </Link>
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
        title={t('jobs.title')}
        description={t('jobs.description')}
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/scheduler/jobs/new">
                <PlusIcon /> {t('jobs.new')}
              </Link>
            </Button>
          )
        }
      />
      <Tabs
        value={view}
        onValueChange={(v) => set({ view: v === 'all' ? undefined : v })}
        className="min-w-0"
      >
        <TabsList className="max-w-full overflow-x-auto">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`jobs.views.${v}`)}
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
      <p className="sr-only" aria-live="polite">
        {data ? t('jobs.liveCount', { count: data.total }) : ''}
      </p>
    </>
  );
}
