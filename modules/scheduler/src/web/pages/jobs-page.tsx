'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable, type DataTableColumn, DataTableSummary, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar } from '@isbp/ui/filter-bar';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { CalendarClockIcon, PlusIcon, UsersIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { type JobSummary, type JobView, TRIGGER_KINDS } from '../../contracts';
import { JobStateBadge, RunStatusText, TaskIcon, TRIGGER_ICON } from '../badges';
import { jobHref, runHref, useRunResult, useTaskTypes, useTypeName } from '../lib';
import { FilterSelect } from '../runs-table';
import { SchedulerHeader } from '../section-header';
import { useTriggerText } from '../trigger-text';

const VIEWS: JobView[] = ['all', 'failing', 'running', 'disabled', 'mine'];
const FILTER_KEYS = ['q', 'type', 'trigger'] as const;

export default function JobsPage() {
  const t = useTranslations('scheduler');
  const router = useRouter();
  const canCreate = useCan('scheduler.jobs.create');
  const triggerText = useTriggerText();
  const typeName = useTypeName();
  const runResult = useRunResult();
  const { items: types } = useTaskTypes(true);
  const [state, set] = useListState({ pageSize: 25 });
  const view: JobView = VIEWS.includes(state.view as JobView) ? (state.view as JobView) : 'all';
  const panelId = useId();
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<JobSummary>>(
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
        meta: { sortKey: 'name', wrap: true },
        cell: ({ row }) => {
          const j = row.original;
          return (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={jobHref(j.id)} onClick={(e) => e.stopPropagation()} weight="medium">
                  {j.name}
                </Link>
                {/* Enabled is the normal case: only the exceptions get a badge. */}
                {!j.enabled && <JobStateBadge enabled={j.enabled} disabledReason={j.disabledReason} />}
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">{j.reference}</span>
              <DataTableSummary>
                <span className="text-xs text-muted-foreground">{triggerText(j.trigger)}</span>
              </DataTableSummary>
            </div>
          );
        },
      },
      {
        id: 'lastRunAt',
        header: t('fields.lastRun'),
        meta: { sortKey: 'lastRunAt', className: 'max-w-64 whitespace-normal' },
        cell: ({ row }) => {
          const r = row.original.lastRun;
          if (!r) return <span className="text-xs text-muted-foreground">{t('jobs.neverRun')}</span>;
          const result = runResult(r);
          return (
            <span className="flex min-w-0 flex-col gap-0.5 text-xs">
              <span className="flex flex-wrap items-center gap-x-2">
                <Link href={runHref(r.id)} onClick={(e) => e.stopPropagation()} size="xsm">
                  <RunStatusText status={r.status} />
                </Link>
                <RelativeTime
                  date={r.finishedAt ?? r.startedAt ?? r.scheduledFor}
                  className="text-muted-foreground"
                />
              </span>
              {result.failed && <span className="line-clamp-2 text-muted-foreground">{result.text}</span>}
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
        id: 'nextRunAt',
        header: t('fields.schedule'),
        meta: { sortKey: 'nextRunAt', className: 'max-w-60', priority: 2 },
        cell: ({ row }) => {
          const j = row.original;
          return (
            <span className="flex min-w-0 flex-col text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon icon={TRIGGER_ICON[j.trigger.kind]} size="xsm" color="secondary" />
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
        id: 'task',
        header: t('fields.task'),
        meta: { className: 'max-w-64', priority: 3 },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <TaskIcon icon={row.original.task.icon} color="secondary" />
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
        id: 'owner',
        header: t('fields.owner'),
        meta: { className: 'max-w-44', priority: 3 },
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
                  <Icon icon={UsersIcon} size="xsm" color="secondary" />
                  <span className="truncate">{ownerGroup.name}</span>
                </span>
              )}
            </span>
          );
        },
      },
    ],
    [t, triggerText, typeName, runResult],
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
      error={error}
      onRetry={() => refetch()}
      getRowId={(j) => j.id}
      onRowClick={(j) => router.push(jobHref(j.id))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <FilterBar
          search={
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('jobs.search')}
              className="sm:w-72"
            />
          }
          filters={[
            {
              id: 'type',
              label: t('fields.taskType'),
              primary: true,
              value: str('type')
                ? typeName(types.find((ty) => ty.type === str('type'))?.name, str('type')!)
                : undefined,
              onClear: () => set({ type: undefined }),
              control: (
                <FilterSelect
                  value={str('type')}
                  onChange={(v) => set({ type: v })}
                  label={t('fields.taskType')}
                  allLabel={t('jobs.allTypes')}
                  width={192}
                  options={types.map((ty) => ({ value: ty.type, label: typeName(ty.name, ty.type) }))}
                />
              ),
            },
            {
              id: 'trigger',
              label: t('fields.trigger'),
              primary: true,
              value: str('trigger') ? t(`triggerKind.${str('trigger')}`) : undefined,
              onClear: () => set({ trigger: undefined }),
              control: (
                <FilterSelect
                  value={str('trigger')}
                  onChange={(v) => set({ trigger: v })}
                  label={t('fields.trigger')}
                  allLabel={t('jobs.allTriggers')}
                  options={TRIGGER_KINDS.map((k) => ({ value: k, label: t(`triggerKind.${k}`) }))}
                />
              ),
            },
          ]}
          onClearAll={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
        />
      }
      empty={
        filtered ? (
          <EmptyState
            variant="filtered"
            onClearFilters={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
          />
        ) : (
          <EmptyState
            icon={<CalendarClockIcon />}
            title={t(`jobs.empty.${view}`)}
            description={t('jobs.emptyHint')}
            action={
              view === 'all' &&
              canCreate && (
                <Button
                  label={t('jobs.new')}
                  variant="primary"
                  icon={<Icon icon={PlusIcon} />}
                  href="/scheduler/jobs/new"
                />
              )
            }
          />
        )
      }
    />
  );

  return (
    <>
      <SchedulerHeader description={t('jobs.description')} />
      <TabList role="tablist" value={view} onChange={(v) => set({ view: v === 'all' ? undefined : v })}>
        {VIEWS.map((v) => (
          <Tab key={v} value={v} label={t(`jobs.views.${v}`)} panelId={panelId} />
        ))}
      </TabList>
      {/* Each tab only filters the same list, so one panel serves them all. */}
      <div role="tabpanel" id={panelId} aria-label={t(`jobs.views.${view}`)} className="min-w-0">
        {table}
      </div>
      <p className="sr-only" aria-live="polite">
        {data ? t('jobs.liveCount', { count: data.total }) : ''}
      </p>
    </>
  );
}
