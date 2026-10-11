'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardFooter, CardHeader } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Meter } from '@isbp/ui/meter';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
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
import { useRouter } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { PERMISSIONS, type ProjectSummary } from '../../contracts';
import { KeyBadge, ProjectHealthBadge, ProjectStatusBadge, VisibilityBadge } from '../components/badges';
import { NewProjectDialog } from '../components/project-form';
import { WorkloadGrid } from '../components/workload-grid';
import { ProjectsTabs } from '../section-tabs';
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
  if (!project.targetDate) return <Text type="supporting">{t('noTarget')}</Text>;
  const live = project.status !== 'completed' && project.status !== 'cancelled';
  const late = live && project.targetDate < today;
  const date = dateValue(project.targetDate);
  const title = format.dateTime(date, { dateStyle: 'medium' });
  if (late)
    return (
      <span title={title}>
        <Badge
          variant="error"
          label={t('targetPassed', { when: format.relativeTime(date, now) })}
          icon={<Icon icon={CircleAlertIcon} size="xsm" />}
        />
      </span>
    );
  return (
    <span title={title}>
      <HStack as="span" gap={1} vAlign="center" className="whitespace-nowrap">
        <Icon icon={CalendarIcon} size="xsm" color="secondary" />
        <Text type="supporting">
          {live ? t('targetIn', { when: format.relativeTime(date, now) }) : title}
        </Text>
      </HStack>
    </span>
  );
}

function ProjectCard({ project, today }: { project: ProjectSummary; today: string }) {
  const t = useTranslations('projects.portfolio');
  const format = useFormatter();
  return (
    <Card interactive className="h-full min-w-0 gap-4">
      <CardHeader className="gap-2">
        <HStack gap={2} vAlign="center" wrap="wrap" className="min-w-0">
          <KeyBadge projectKey={project.key} />
          <VisibilityBadge visibility={project.visibility} />
          <span className="ml-auto">
            <ProjectStatusBadge status={project.status} />
          </span>
        </HStack>
        <Heading level={2}>
          <Link
            href={projectHref(project.key)}
            color="primary"
            className="after:absolute after:inset-0 after:rounded-xl after:content-['']"
          >
            {project.name}
          </Link>
        </Heading>
        <HStack gap={2} vAlign="center" className="min-w-0">
          <ProjectHealthBadge project={project} />
          {project.healthNote && project.health !== 'on_track' && (
            <span className="min-w-0 flex-1">
              <Text type="supporting" maxLines={1}>
                {project.healthNote}
              </Text>
            </span>
          )}
        </HStack>
      </CardHeader>
      <CardContent className="grid gap-2">
        <HStack gap={2} vAlign="center" hAlign="between">
          <Text type="supporting">
            {t('tasksDone', { done: project.doneTasks, total: project.totalTasks })}
          </Text>
          <Text weight="medium" hasTabularNumbers>
            {project.progress}%
          </Text>
        </HStack>
        <Meter
          kind="progress"
          size="sm"
          value={project.progress}
          tone={project.status === 'completed' ? 'success' : 'primary'}
          label={t('progressLabel', {
            name: project.name,
            done: project.doneTasks,
            total: project.totalTasks,
          })}
        />
        {project.overdueCount > 0 && (
          <span>
            <Badge
              variant="error"
              label={t('overdueTasks', { count: project.overdueCount })}
              icon={<Icon icon={CircleAlertIcon} size="xsm" />}
            />
          </span>
        )}
      </CardContent>
      <CardFooter className="mt-auto items-start gap-3 border-t pt-4">
        <VStack gap={1.5} className="min-w-0 flex-1">
          <TargetDate project={project} today={today} />
          {project.nextMilestone && (
            <HStack as="span" gap={1} vAlign="center" className="min-w-0">
              <Icon icon={DiamondIcon} size="xsm" color="secondary" />
              <Text type="supporting" maxLines={1}>
                {project.nextMilestone.dueDate
                  ? t('nextMilestone', {
                      name: project.nextMilestone.name,
                      date: format.dateTime(dateValue(project.nextMilestone.dueDate), {
                        month: 'short',
                        day: 'numeric',
                      }),
                    })
                  : project.nextMilestone.name}
              </Text>
            </HStack>
          )}
        </VStack>
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
  const filter: Filter = FILTERS.includes(state.filter as Filter) ? (state.filter as Filter) : 'all';
  const layout: Layout =
    state.layout === 'table'
      ? 'table'
      : state.layout === 'workload' && (canCreate || seesAll)
        ? 'workload'
        : 'cards';
  const archived = state.archived === 'true';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ProjectSummary>>(
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
  const changeFilter = (v: string) =>
    set({
      filter: v === 'all' ? undefined : v,
      layout: layout === 'workload' ? undefined : state.layout,
    });

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
          <span className="block truncate">
            <Link
              href={projectHref(row.original.key)}
              color="primary"
              weight="medium"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.name}
            </Link>
          </span>
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
        cell: ({ row }) => <ProjectHealthBadge project={row.original} plain />,
      },
      {
        id: 'progress',
        header: t('columns.progress'),
        meta: { className: 'hidden w-44 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <VStack gap={1}>
            <Meter
              kind="progress"
              size="sm"
              value={row.original.progress}
              label={t('progressLabel', {
                name: row.original.name,
                done: row.original.doneTasks,
                total: row.original.totalTasks,
              })}
            />
            <Text type="supporting">
              {t('tasksDone', { done: row.original.doneTasks, total: row.original.totalTasks })}
            </Text>
          </VStack>
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
            <HStack as="span" gap={2} vAlign="center" className="min-w-0">
              <UserAvatar
                name={row.original.owner.displayName}
                src={row.original.owner.avatarUrl}
                className="size-6 text-[10px]"
              />
              <span className="truncate">{row.original.owner.displayName}</span>
            </HStack>
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
          <Button
            label={t('new')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setCreating(true)}
          />
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
        error={error}
        onRetry={() => refetch()}
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
          <nav aria-label={t('pagination')}>
            <HStack gap={3} vAlign="center" hAlign="end">
              <Text type="supporting" aria-live="polite">
                {t('showing', { from, to, total })}
              </Text>
              <IconButton
                label={t('previous')}
                variant="secondary"
                size="sm"
                icon={<Icon icon={ChevronLeftIcon} />}
                isDisabled={state.page <= 1}
                onClick={() => set({ page: state.page - 1 })}
              />
              <IconButton
                label={t('next')}
                variant="secondary"
                size="sm"
                icon={<Icon icon={ChevronRightIcon} />}
                isDisabled={to >= total}
                onClick={() => set({ page: state.page + 1 })}
              />
            </HStack>
          </nav>
        )}
      </div>
    );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate && (
            <Button
              label={t('new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(true)}
            />
          )
        }
      />
      <ProjectsTabs />
      <div className="grid min-w-0 gap-4">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          {/* The filters only narrow the same portfolio: a segmented control (a dropdown on a phone), not tabs with panels. */}
          <div className="hidden sm:block">
            <SegmentedControl
              label={t('filtersLabel')}
              value={layout === 'workload' ? 'all' : filter}
              isDisabled={layout === 'workload'}
              onChange={changeFilter}
            >
              {FILTERS.map((f) => (
                <SegmentedControlItem key={f} value={f} label={t(`filters.${f}`)} />
              ))}
            </SegmentedControl>
          </div>
          <div className="sm:hidden">
            <Selector
              label={t('filtersLabel')}
              isLabelHidden
              isDisabled={layout === 'workload'}
              value={layout === 'workload' ? 'all' : filter}
              onChange={changeFilter}
              options={FILTERS.map((f) => ({ value: f, label: t(`filters.${f}`) }))}
            />
          </div>
          <HStack gap={2} vAlign="center" wrap="wrap" className="min-w-0">
            {layout !== 'workload' && (
              <>
                <SearchInput
                  value={state.q ?? ''}
                  onChange={(q) => set({ q })}
                  placeholder={t('search')}
                  className="sm:w-60"
                />
                <Switch
                  label={t('archived')}
                  value={archived}
                  onChange={(on) => set({ archived: on ? 'true' : undefined })}
                />
              </>
            )}
            <SegmentedControl
              label={t('layout')}
              size="sm"
              value={layout}
              onChange={(v) =>
                set({ layout: v === 'cards' ? undefined : v, pageSize: v === 'table' ? 25 : CARD_PAGE })
              }
            >
              <SegmentedControlItem
                value="cards"
                label={t('cards')}
                icon={<Icon icon={LayoutGridIcon} size="sm" />}
              />
              <SegmentedControlItem
                value="table"
                label={t('table')}
                icon={<Icon icon={TableIcon} size="sm" />}
              />
              {(canCreate || seesAll) && (
                <SegmentedControlItem
                  value="workload"
                  label={t('workload')}
                  icon={<Icon icon={UsersIcon} size="sm" />}
                />
              )}
            </SegmentedControl>
          </HStack>
        </div>
        <div className="min-w-0">{content}</div>
      </div>
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
