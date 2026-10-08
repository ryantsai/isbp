'use client';

import type { Page } from '@isbp/sdk';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  DiamondIcon,
  FolderKanbanIcon,
  LayoutGridIcon,
  PlusIcon,
  SearchXIcon,
  TableIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { PERMISSIONS, type ProjectSummary } from '../../contracts';
import {
  HealthBadge,
  KeyBadge,
  ProgressBar,
  ProjectStatusBadge,
  VisibilityBadge,
} from '../components/badges';
import { NewProjectDialog } from '../components/project-form';
import { WorkloadGrid } from '../components/workload-grid';
import { dateValue, localToday, projectHref } from '../lib';

const FILTERS = ['all', 'mine', 'active', 'proposed', 'completed'] as const;
type Filter = (typeof FILTERS)[number];
type Layout = 'cards' | 'table' | 'workload';
const CARD_PAGE = 24;

/** "in 3 weeks" / "3 days overdue" for a target date. */
function TargetDate({ project, today }: { project: ProjectSummary; today: string }) {
  const t = useTranslations('projects.portfolio');
  const format = useFormatter();
  const now = useNow({ updateInterval: 3_600_000 });
  if (!project.targetDate) return <span className="text-xs text-muted-foreground">{t('noTarget')}</span>;
  const live = project.status !== 'completed' && project.status !== 'cancelled';
  const late = live && project.targetDate < today;
  const date = dateValue(project.targetDate);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs whitespace-nowrap',
        late ? 'font-medium text-destructive' : 'text-muted-foreground',
      )}
      title={format.dateTime(date, { dateStyle: 'medium' })}
    >
      {late ? (
        <CircleAlertIcon className="size-3.5" aria-hidden />
      ) : (
        <CalendarIcon className="size-3.5" aria-hidden />
      )}
      {late
        ? t('targetPassed', { when: format.relativeTime(date, now) })
        : live
          ? t('targetIn', { when: format.relativeTime(date, now) })
          : format.dateTime(date, { dateStyle: 'medium' })}
    </span>
  );
}

function ProjectCard({ project, today }: { project: ProjectSummary; today: string }) {
  const t = useTranslations('projects.portfolio');
  const format = useFormatter();
  return (
    <Card className="group relative h-full min-w-0 gap-4 transition-shadow hover:shadow-md">
      <CardHeader className="gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <KeyBadge projectKey={project.key} />
          <VisibilityBadge visibility={project.visibility} />
          <span className="ml-auto">
            <ProjectStatusBadge status={project.status} />
          </span>
        </div>
        <h2 className="text-base leading-snug font-semibold">
          <Link
            href={projectHref(project.key)}
            className="outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:underline focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {project.name}
          </Link>
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          <HealthBadge health={project.health} />
          {project.healthNote && project.health !== 'on_track' && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{project.healthNote}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {t('tasksDone', { done: project.doneTasks, total: project.totalTasks })}
          </span>
          <span className="font-medium tabular-nums">{project.progress}%</span>
        </div>
        <ProgressBar
          value={project.progress}
          tone={project.status === 'completed' ? 'success' : 'primary'}
          label={t('progressLabel', {
            name: project.name,
            done: project.doneTasks,
            total: project.totalTasks,
          })}
        />
        {project.overdueCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
            <CircleAlertIcon className="size-3.5" aria-hidden />
            {t('overdueTasks', { count: project.overdueCount })}
          </span>
        )}
      </CardContent>
      <CardFooter className="mt-auto items-start gap-3 border-t pt-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <TargetDate project={project} today={today} />
          {project.nextMilestone && (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <DiamondIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {project.nextMilestone.dueDate
                  ? t('nextMilestone', {
                      name: project.nextMilestone.name,
                      date: format.dateTime(dateValue(project.nextMilestone.dueDate), {
                        month: 'short',
                        day: 'numeric',
                      }),
                    })
                  : project.nextMilestone.name}
              </span>
            </span>
          )}
        </div>
        {project.owner && (
          <span className="shrink-0" title={project.owner.displayName}>
            <UserAvatar
              name={project.owner.displayName}
              src={project.owner.avatarUrl}
              className="size-6 text-[10px]"
            />
            <span className="sr-only">{t('ownedBy', { name: project.owner.displayName })}</span>
          </span>
        )}
      </CardFooter>
    </Card>
  );
}

function LayoutToggle({
  value,
  onChange,
  options,
}: {
  value: Layout;
  onChange: (v: Layout) => void;
  options: { value: Layout; label: string; icon: ReactNode }[];
}) {
  const t = useTranslations('projects.portfolio');
  return (
    <div
      role="group"
      aria-label={t('layout')}
      className="inline-flex rounded-md border bg-background p-0.5 shadow-xs"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5',
            value === o.value && 'bg-secondary text-foreground',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The project portfolio: cards (or a table), filters, search and "New project". */
export default function PortfolioPage() {
  const t = useTranslations('projects.portfolio');
  const router = useRouter();
  const { user } = usePlatform();
  const today = localToday(user.timezone);
  const mayCreate = useCan(PERMISSIONS.create);
  const isAdmin = useCan(PERMISSIONS.admin);
  const mayReadAll = useCan(PERMISSIONS.portfolio);
  const canCreate = mayCreate || isAdmin;
  const seesAll = mayReadAll || isAdmin;
  const [state, set] = useListState({ pageSize: CARD_PAGE });
  const [creating, setCreating] = useState(false);
  const archivedId = useId();
  const filter: Filter = FILTERS.includes(state.filter as Filter) ? (state.filter as Filter) : 'all';
  const layout: Layout =
    state.layout === 'table'
      ? 'table'
      : state.layout === 'workload' && (canCreate || seesAll)
        ? 'workload'
        : 'cards';
  const archived = state.archived === 'true';
  const { data, isLoading, isFetching } = useApiQuery<Page<ProjectSummary>>(
    layout === 'workload' ? null : '/projects/projects',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
      mine: filter === 'mine' ? 'true' : undefined,
      status: filter === 'active' || filter === 'proposed' || filter === 'completed' ? filter : undefined,
      archived: archived ? 'true' : undefined,
    },
  );
  const filtered = Boolean(state.q) || filter !== 'all' || archived;

  const columns = useMemo<DataTableColumn<ProjectSummary>[]>(
    () => [
      {
        id: 'key',
        header: t('columns.key'),
        size: 90,
        meta: { sortKey: 'key' },
        cell: ({ row }) => <KeyBadge projectKey={row.original.key} />,
      },
      {
        id: 'name',
        header: t('columns.name'),
        meta: { sortKey: 'name', className: 'max-w-72' },
        cell: ({ row }) => (
          <Link
            href={projectHref(row.original.key)}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium outline-none hover:underline focus-visible:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <ProjectStatusBadge status={row.original.status} />,
      },
      {
        id: 'health',
        header: t('columns.health'),
        meta: { sortKey: 'health' },
        cell: ({ row }) => <HealthBadge health={row.original.health} plain />,
      },
      {
        id: 'progress',
        header: t('columns.progress'),
        meta: { className: 'hidden w-44 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="grid gap-1">
            <ProgressBar
              value={row.original.progress}
              label={t('progressLabel', {
                name: row.original.name,
                done: row.original.doneTasks,
                total: row.original.totalTasks,
              })}
            />
            <span className="text-xs text-muted-foreground">
              {t('tasksDone', { done: row.original.doneTasks, total: row.original.totalTasks })}
            </span>
          </span>
        ),
      },
      {
        id: 'target',
        header: t('columns.target'),
        meta: {
          sortKey: 'targetDate',
          className: 'hidden lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => <TargetDate project={row.original} today={today} />,
      },
      {
        id: 'owner',
        header: t('columns.owner'),
        meta: { className: 'hidden max-w-44 xl:table-cell', headerClassName: 'hidden xl:table-cell' },
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
            '—'
          ),
      },
    ],
    [t, today],
  );

  const empty = (
    <EmptyState
      icon={filtered ? <SearchXIcon /> : <FolderKanbanIcon />}
      title={filtered ? t('emptyFiltered') : t('empty')}
      description={filtered ? undefined : t('emptyHint')}
      action={
        !filtered && canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> {t('new')}
          </Button>
        ) : undefined
      }
    />
  );

  const total = data?.total ?? 0;
  const from = total ? (state.page - 1) * state.pageSize + 1 : 0;
  const to = Math.min(total, state.page * state.pageSize);

  const content =
    layout === 'workload' ? (
      <WorkloadGrid path="/projects/workload" />
    ) : layout === 'table' ? (
      <DataTable
        label={t('title')}
        columns={columns}
        data={data?.items ?? []}
        total={total}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(p) => p.id}
        onRowClick={(p) => router.push(projectHref(p.key))}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        empty={empty}
      />
    ) : isLoading && !data ? (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-60 rounded-xl" />
        ))}
      </div>
    ) : !data?.items.length ? (
      <div className="rounded-xl border border-dashed">{empty}</div>
    ) : (
      <div className="grid gap-4">
        <Stagger
          key={`${filter}:${state.page}:${state.q ?? ''}`}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {data.items.map((p) => (
            <StaggerItem key={p.id} className="min-w-0">
              <ProjectCard project={p} today={today} />
            </StaggerItem>
          ))}
        </Stagger>
        {total > state.pageSize && (
          <nav
            className="flex items-center justify-end gap-3 text-sm text-muted-foreground"
            aria-label={t('pagination')}
          >
            <span aria-live="polite">{t('showing', { from, to, total })}</span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('previous')}
              disabled={state.page <= 1}
              onClick={() => set({ page: state.page - 1 })}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('next')}
              disabled={to >= total}
              onClick={() => set({ page: state.page + 1 })}
            >
              <ChevronRightIcon />
            </Button>
          </nav>
        )}
      </div>
    );

  const layouts: { value: Layout; label: string; icon: ReactNode }[] = [
    { value: 'cards', label: t('cards'), icon: <LayoutGridIcon aria-hidden /> },
    { value: 'table', label: t('table'), icon: <TableIcon aria-hidden /> },
    ...(canCreate || seesAll
      ? [{ value: 'workload' as const, label: t('workload'), icon: <UsersIcon aria-hidden /> }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('new')}
            </Button>
          )
        }
      />
      <Tabs
        value={layout === 'workload' ? 'all' : filter}
        onValueChange={(v) =>
          set({
            filter: v === 'all' ? undefined : v,
            layout: layout === 'workload' ? undefined : state.layout,
          })
        }
        className="min-w-0 gap-4"
      >
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <TabsList aria-label={t('filtersLabel')}>
            {FILTERS.map((f) => (
              <TabsTrigger key={f} value={f} disabled={layout === 'workload'}>
                {t(`filters.${f}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {layout !== 'workload' && (
              <>
                <SearchInput
                  value={state.q ?? ''}
                  onChange={(q) => set({ q })}
                  placeholder={t('search')}
                  className="sm:w-60"
                />
                <div className="flex items-center gap-2 px-1">
                  <Switch
                    id={archivedId}
                    checked={archived}
                    onCheckedChange={(on) => set({ archived: on ? 'true' : undefined })}
                  />
                  <Label htmlFor={archivedId} className="text-sm font-normal">
                    {t('archived')}
                  </Label>
                </div>
              </>
            )}
            <LayoutToggle
              value={layout}
              options={layouts}
              onChange={(v) =>
                set({ layout: v === 'cards' ? undefined : v, pageSize: v === 'table' ? 25 : CARD_PAGE })
              }
            />
          </div>
        </div>
        {/* Each tab only filters the same portfolio. */}
        {FILTERS.map((f) => (
          <TabsContent key={f} value={f} className="min-w-0">
            {f === (layout === 'workload' ? 'all' : filter) ? content : null}
          </TabsContent>
        ))}
      </Tabs>
      <p className="sr-only" aria-live="polite">
        {data && layout !== 'workload' ? t('liveCount', { count: data.total }) : ''}
      </p>
      {canCreate && (
        <NewProjectDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(p) => router.push(projectHref(p.key))}
        />
      )}
    </>
  );
}
