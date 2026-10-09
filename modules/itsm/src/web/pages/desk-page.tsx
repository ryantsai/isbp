'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar, type FilterDef } from '@isbp/ui/filter-bar';
import { AnimatedNumber } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  AlarmClockOffIcon,
  InboxIcon,
  LayersIcon,
  type LucideIcon,
  PlusIcon,
  SearchXIcon,
  SirenIcon,
  UserCheckIcon,
  UsersIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DESK_TYPES, type TicketListItem, type TicketStatus, type TicketType } from '../../contracts';
import { NewTicketDialog } from '../components/new-ticket-dialog';
import { CategorySelect, GroupSelect } from '../components/pickers';
import { type TicketColumn, useTicketColumns } from '../components/ticket-columns';
import { ticketHref, useCategoryLabel, useCategories, useGroups } from '../lib';
import { statusesOf } from '../statuses';
import type { QueueCounts } from '../types';

const ALL = '__all__';

type QueueId = 'assigned' | 'groups' | 'unassigned' | 'all' | 'attention' | 'major' | 'breached' | 'at_risk';

/** `sort`: the order the queue opens in (what that queue is for). `hidden`: still opened by older links. */
const QUEUES: {
  id: QueueId;
  icon: LucideIcon;
  count: keyof QueueCounts;
  query: Record<string, string>;
  sort: string;
  alert?: boolean;
  hidden?: boolean;
}[] = [
  { id: 'assigned', icon: UserCheckIcon, count: 'assigned', query: { view: 'assigned' }, sort: 'slaDue' },
  { id: 'groups', icon: UsersIcon, count: 'groups', query: { view: 'groups' }, sort: '-updatedAt' },
  {
    id: 'unassigned',
    icon: InboxIcon,
    count: 'unassigned',
    query: { view: 'unassigned' },
    sort: '-createdAt',
  },
  { id: 'all', icon: LayersIcon, count: 'open', query: { view: 'all' }, sort: '-updatedAt' },
  {
    id: 'attention',
    icon: AlarmClockOffIcon,
    count: 'attention',
    query: { view: 'all', sla: 'attention' },
    sort: 'slaDue',
    alert: true,
  },
  {
    id: 'major',
    icon: SirenIcon,
    count: 'majorOpen',
    query: { view: 'all', major: 'true' },
    sort: '-createdAt',
    alert: true,
  },
  {
    id: 'breached',
    icon: AlarmClockOffIcon,
    count: 'breached',
    query: { view: 'all', sla: 'breached' },
    sort: 'slaDue',
    hidden: true,
  },
  {
    id: 'at_risk',
    icon: AlarmClockOffIcon,
    count: 'atRisk',
    query: { view: 'all', sla: 'at_risk' },
    sort: 'slaDue',
    hidden: true,
  },
];

const TYPES: TicketType[] = ['incident', 'service_request', 'problem', 'change'];
/** "Incidents & requests" (the default) or every type. */
const DESK = 'desk';
/** The orders a queue can be read in (`sort` value → label key). */
const SORTS: Record<string, string> = {
  '-createdAt': 'newest',
  createdAt: 'oldest',
  slaDue: 'urgent',
  '-updatedAt': 'updated',
};
const COLUMNS: TicketColumn[] = ['ticket', 'status', 'priority', 'sla', 'owner', 'updated'];

function QueueRail({
  active,
  counts,
  onSelect,
}: {
  active: QueueId;
  counts: QueueCounts | undefined;
  onSelect: (q: QueueId) => void;
}) {
  const t = useTranslations('itsm.desk.queues');
  return (
    <nav aria-label={t('label')} className="hidden lg:block">
      <h2 className="mb-2 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('label')}
      </h2>
      <ul className="grid gap-0.5">
        {QUEUES.filter((q) => !q.hidden || q.id === active).map((q) => {
          const count = counts?.[q.count];
          const Icon = q.icon;
          const isActive = active === q.id;
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => onSelect(q.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
                  isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t(q.id)}</span>
                {count === undefined ? (
                  counts ? null : (
                    <Skeleton className="h-4 w-5" />
                  )
                ) : (
                  <span
                    className={cn(
                      'min-w-6 rounded-md px-1.5 text-center text-xs tabular-nums',
                      q.alert && count > 0
                        ? 'bg-destructive/10 font-medium text-destructive dark:bg-destructive/20'
                        : 'text-muted-foreground',
                    )}
                  >
                    {/* Live counts (refetched every minute) tick to their new value. */}
                    <AnimatedNumber value={count} />
                    <span className="sr-only"> {t('tickets', { count })}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The agent workspace: queues of incidents and service requests on the left (problems and changes have their own
 * pages), the queue as a table on the right — search, type and priority up front, the rest behind "Filters".
 */
export default function DeskPage() {
  const t = useTranslations('itsm');
  const tc = useTranslations('common');
  const router = useRouter();
  const canProblems = useCan('itsm.problems.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const categoryLabel = useCategoryLabel();
  const { categories } = useCategories();
  const { groups } = useGroups();
  const queue = (QUEUES.some((q) => q.id === state.view) ? state.view : 'all') as QueueId;
  const def = QUEUES.find((q) => q.id === queue)!;
  const typeParam = state.type as string | undefined;
  const type = (TYPES as string[]).includes(String(typeParam)) ? (typeParam as TicketType) : undefined;
  const allTypes = typeParam === ALL;
  const status = (state.status as string | undefined) ?? 'open';
  const assigneeId = state.assigneeId as string | undefined;
  const sort = (state.sort as string | undefined) ?? def.sort;

  const { data: counts } = useApiQuery<QueueCounts>('/itsm/queues', undefined, { refetchInterval: 60_000 });
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<TicketListItem>>(
    '/itsm/tickets',
    {
      ...def.query,
      type,
      types: !type && !allTypes ? DESK_TYPES.join(',') : undefined,
      status: status === 'any' ? undefined : status,
      priority: state.priority as string | undefined,
      groupId: state.groupId as string | undefined,
      assigneeId,
      categoryId: state.categoryId as string | undefined,
      ciId: state.ciId as string | undefined,
      q: state.q,
      sort,
      page: state.page,
      pageSize: state.pageSize,
    },
    { refetchInterval: 60_000 },
  );
  const people = usePeople([assigneeId]);
  const columns = useTicketColumns(COLUMNS);
  const filtered = Boolean(
    state.q ||
    typeParam ||
    state.status ||
    state.priority ||
    state.groupId ||
    assigneeId ||
    state.categoryId ||
    state.ciId,
  );
  const category = categories.find((c) => c.id === state.categoryId);
  const typeValue = type ?? (allTypes ? ALL : DESK);

  const filters: FilterDef[] = [
    {
      id: 'type',
      label: t('filters.type'),
      primary: true,
      value:
        typeValue === DESK ? undefined : typeValue === ALL ? t('filters.allTypes') : t(`typesPlural.${type}`),
      onClear: () => set({ type: undefined, status: undefined }),
      control: (
        <Select
          value={typeValue}
          onValueChange={(v) => set({ type: v === DESK ? undefined : v, status: undefined })}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('filters.type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DESK}>{t('filters.deskTypes')}</SelectItem>
            <SelectItem value={ALL}>{t('filters.allTypes')}</SelectItem>
            <SelectSeparator />
            {TYPES.map((ty) => (
              <SelectItem key={ty} value={ty}>
                {t(`typesPlural.${ty}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: 'priority',
      label: t('filters.priority'),
      primary: true,
      value: state.priority ? t(`priority.${state.priority}`) : undefined,
      onClear: () => set({ priority: undefined }),
      control: (
        <Select
          value={(state.priority as string | undefined) ?? ALL}
          onValueChange={(v) => set({ priority: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-36" aria-label={t('filters.priority')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.anyPriority')}</SelectItem>
            {['1', '2', '3', '4'].map((p) => (
              <SelectItem key={p} value={p}>
                {t(`priority.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: 'status',
      label: t('filters.status'),
      value: state.status
        ? status === 'done'
          ? t('filters.done')
          : status === 'any'
            ? t('filters.anyStatus')
            : t.has(`status.${status}`)
              ? t(`status.${status}`)
              : status
        : undefined,
      onClear: () => set({ status: undefined }),
      control: (
        <Select value={status} onValueChange={(v) => set({ status: v === 'open' ? undefined : v })}>
          <SelectTrigger className="w-full" aria-label={t('filters.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t('filters.open')}</SelectItem>
            <SelectItem value="done">{t('filters.done')}</SelectItem>
            <SelectItem value="any">{t('filters.anyStatus')}</SelectItem>
            <SelectSeparator />
            {statusesOf(type).map((s: TicketStatus) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: 'group',
      label: t('filters.group'),
      value: state.groupId ? (groups.find((g) => g.id === state.groupId)?.name ?? '…') : undefined,
      onClear: () => set({ groupId: undefined }),
      control: (
        <GroupSelect
          value={(state.groupId as string | undefined) ?? null}
          onChange={(groupId) => set({ groupId: groupId ?? undefined })}
          noneLabel={t('filters.anyGroup')}
          aria-label={t('filters.group')}
        />
      ),
    },
    {
      id: 'assignee',
      label: t('filters.assignee'),
      value: assigneeId ? (people.get(assigneeId)?.displayName ?? '…') : undefined,
      onClear: () => set({ assigneeId: undefined }),
      control: (
        <PersonPicker
          value={assigneeId ? (people.get(assigneeId) ?? { id: assigneeId, displayName: '…' }) : null}
          onChange={(p) => set({ assigneeId: p?.id })}
          placeholder={t('filters.anyAssignee')}
          aria-label={t('filters.assignee')}
          className="w-full"
        />
      ),
    },
    {
      id: 'category',
      label: t('filters.category'),
      value: category ? (categoryLabel(category) ?? undefined) : undefined,
      onClear: () => set({ categoryId: undefined }),
      control: (
        <CategorySelect
          type={type}
          value={(state.categoryId as string | undefined) ?? null}
          onChange={(categoryId) => set({ categoryId: categoryId ?? undefined })}
          noneLabel={t('filters.anyCategory')}
          aria-label={t('filters.category')}
        />
      ),
    },
  ];

  // Opened from a CI's page ("View all"): shown as a removable filter.
  if (state.ciId)
    filters.push({
      id: 'ci',
      label: t('filters.ci'),
      value: t('filters.ciSet'),
      onClear: () => set({ ciId: undefined }),
      control: <span className="text-sm text-muted-foreground">{t('filters.ciSet')}</span>,
    });

  return (
    <>
      <PageHeader
        title={t('desk.title')}
        description={t('desk.description')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> {t('desk.new')}
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <QueueRail
          active={queue}
          counts={counts}
          onSelect={(q) => set({ view: q === 'all' ? undefined : q, sort: undefined })}
        />
        <div className="grid min-w-0 gap-3">
          <div className="lg:hidden">
            <Select
              value={queue}
              onValueChange={(q) => set({ view: q === 'all' ? undefined : q, sort: undefined })}
            >
              <SelectTrigger className="w-full" aria-label={t('desk.queues.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUEUES.filter((q) => !q.hidden || q.id === queue).map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {t(`desk.queues.${q.id}`)}
                    {counts?.[q.count] !== undefined && (
                      <span className="text-muted-foreground tabular-nums"> · {counts[q.count]}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <h2 className="sr-only" aria-live="polite">
            {t(`desk.queues.${queue}`)}
          </h2>
          <DataTable
            label={t(`desk.queues.${queue}`)}
            columns={columns}
            data={data?.items ?? []}
            total={data?.total ?? 0}
            page={state.page}
            pageSize={state.pageSize}
            sort={sort}
            loading={isLoading}
            fetching={isFetching}
            error={error}
            onRetry={() => refetch()}
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(ticketHref(r.reference))}
            onPageChange={(page) => set({ page })}
            onPageSizeChange={(pageSize) => set({ pageSize })}
            onSortChange={(s) => set({ sort: s })}
            toolbar={
              <FilterBar
                search={
                  <SearchInput
                    value={state.q ?? ''}
                    onChange={(q) => set({ q })}
                    placeholder={t('filters.search')}
                    className="sm:w-64"
                  />
                }
                filters={filters}
                onClearAll={() =>
                  set({
                    q: undefined,
                    type: undefined,
                    status: undefined,
                    priority: undefined,
                    groupId: undefined,
                    assigneeId: undefined,
                    categoryId: undefined,
                    ciId: undefined,
                  })
                }
                actions={
                  <Select value={sort} onValueChange={(s) => set({ sort: s === def.sort ? undefined : s })}>
                    <SelectTrigger className="w-auto" aria-label={t('filters.sort')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SORTS[sort] ? null : <SelectItem value={sort}>{t('filters.sortCustom')}</SelectItem>}
                      {Object.entries(SORTS).map(([value, key]) => (
                        <SelectItem key={value} value={value}>
                          {t(`filters.sorts.${key}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            }
            empty={
              <EmptyState
                icon={filtered ? <SearchXIcon /> : <InboxIcon />}
                title={filtered ? t('desk.empty.filtered') : t(`desk.empty.${queue}`)}
                description={filtered ? t('desk.empty.filteredHint') : undefined}
                action={
                  filtered ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        set({
                          q: undefined,
                          type: undefined,
                          status: undefined,
                          priority: undefined,
                          groupId: undefined,
                          assigneeId: undefined,
                          categoryId: undefined,
                          ciId: undefined,
                        })
                      }
                    >
                      {tc('clearFilters')}
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </div>
      </div>
      <NewTicketDialog
        open={creating}
        onOpenChange={setCreating}
        types={canProblems ? ['incident', 'service_request', 'problem'] : ['incident', 'service_request']}
      />
    </>
  );
}
