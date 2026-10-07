'use client';

import type { Page } from '@isbp/sdk';
import { usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import type { ColumnDef } from '@tanstack/react-table';
import { ListTodoIcon, SearchXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { type ProjectDetail, TASK_PRIORITIES, TASK_STATUSES, type TaskListItem } from '../../contracts';
import { DueDate, PriorityLabel, TaskStatusBadge, TaskTypeIcon } from '../components/badges';
import { localToday, useSearchParam } from '../lib';
import { TaskFilters, useTaskFilters } from './task-filters';

const ALL = '__all__';

/** All tasks of the project, paged and sorted on the server; filters live in the URL. */
export function ListTab({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.list');
  const tf = useTranslations('projects.fields');
  const ts = useTranslations('projects.taskStatus');
  const tp = useTranslations('projects.priority');
  const tfl = useTranslations('projects.filters');
  const { user } = usePlatform();
  const today = localToday(user.timezone);
  const { state, set, str, query } = useTaskFilters();
  const [, openTask] = useSearchParam('task');
  const { data, isLoading, isFetching } = useApiQuery<Page<TaskListItem>>('/projects/tasks', {
    project: project.key,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort ?? 'reference',
    status: str('status'),
    priority: str('priority'),
    ...query,
  });
  const filtered = Object.values(query).some(Boolean) || Boolean(str('status') || str('priority'));

  const columns = useMemo<ColumnDef<TaskListItem, unknown>[]>(
    () => [
      {
        id: 'reference',
        header: tf('reference'),
        size: 100,
        meta: { sortKey: 'reference', className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <TaskTypeIcon type={row.original.type} />
            {row.original.reference}
          </span>
        ),
      },
      {
        id: 'title',
        header: tf('title'),
        meta: { sortKey: 'title', className: 'max-w-80' },
        cell: ({ row }) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openTask(row.original.reference);
            }}
            className="block max-w-full truncate text-left font-medium outline-none hover:underline focus-visible:underline"
          >
            {row.original.title}
          </button>
        ),
      },
      {
        id: 'status',
        header: tf('status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <TaskStatusBadge status={row.original.status} />,
      },
      {
        id: 'priority',
        header: tf('priority'),
        meta: {
          sortKey: 'priority',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <PriorityLabel priority={row.original.priority} />,
      },
      {
        id: 'assignee',
        header: tf('assignee'),
        meta: {
          sortKey: 'assignee',
          className: 'hidden max-w-44 md:table-cell',
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
            <span className="text-muted-foreground">{tf('unassigned')}</span>
          ),
      },
      {
        id: 'due',
        header: tf('dueDate'),
        meta: { sortKey: 'due' },
        cell: ({ row }) =>
          row.original.dueDate ? (
            <DueDate date={row.original.dueDate} status={row.original.status} today={today} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'milestone',
        header: tf('milestone'),
        meta: {
          className: 'hidden max-w-40 truncate text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => row.original.milestone?.name ?? '—',
      },
      {
        id: 'updated',
        header: tf('updated'),
        meta: {
          sortKey: 'updated',
          className: 'hidden text-muted-foreground xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
    ],
    [tf, today, openTask],
  );

  return (
    <div className="grid min-w-0 gap-4">
      <TaskFilters project={project}>
        <Select
          value={str('status') ?? ALL}
          onValueChange={(v) => set({ status: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label={tf('status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tfl('allStatuses')}</SelectItem>
            <SelectItem value="open">{tfl('open')}</SelectItem>
            <SelectItem value="closed">{tfl('closed')}</SelectItem>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ts(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={str('priority') ?? ALL}
          onValueChange={(v) => set({ priority: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-36" aria-label={tf('priority')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tfl('allPriorities')}</SelectItem>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {tp(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TaskFilters>
      <DataTable
        label={t('label', { project: project.name })}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort ?? 'reference'}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(r) => r.id}
        onRowClick={(r) => openTask(r.reference)}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        empty={
          <EmptyState
            icon={filtered ? <SearchXIcon /> : <ListTodoIcon />}
            title={filtered ? t('emptyFiltered') : t('empty')}
          />
        }
      />
    </div>
  );
}
