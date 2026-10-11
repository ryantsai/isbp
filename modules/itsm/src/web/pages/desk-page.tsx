'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector, type SelectorOptionType } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar, type FilterDef } from '@isbp/ui/filter-bar';
import { AnimatedNumber } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
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
      <List
        density="compact"
        header={
          <Text as="span" type="label" color="secondary">
            {t('label')}
          </Text>
        }
      >
        {QUEUES.filter((q) => !q.hidden || q.id === active).map((q) => {
          const count = counts?.[q.count];
          return (
            <ListItem
              key={q.id}
              label={t(q.id)}
              startContent={<Icon icon={q.icon} />}
              isSelected={active === q.id}
              onClick={() => onSelect(q.id)}
              endContent={
                count === undefined ? (
                  counts ? null : (
                    <Skeleton className="h-4 w-5" />
                  )
                ) : (
                  <Badge
                    variant={q.alert && count > 0 ? 'error' : 'neutral'}
                    label={
                      <>
                        {/* Live counts (refetched every minute) tick to their new value. */}
                        <AnimatedNumber value={count} />
                        <span className="sr-only"> {t('tickets', { count })}</span>
                      </>
                    }
                  />
                )
              }
            />
          );
        })}
      </List>
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
  const clearAll = () =>
    set({
      q: undefined,
      type: undefined,
      status: undefined,
      priority: undefined,
      groupId: undefined,
      assigneeId: undefined,
      categoryId: undefined,
      ciId: undefined,
    });
  const typeValue = type ?? (allTypes ? ALL : DESK);

  const typeOptions: SelectorOptionType[] = [
    { value: DESK, label: t('filters.deskTypes') },
    { value: ALL, label: t('filters.allTypes') },
    { type: 'divider' },
    ...TYPES.map((ty) => ({ value: ty, label: t(`typesPlural.${ty}`) })),
  ];
  const priorityOptions = [
    { value: ALL, label: t('filters.anyPriority') },
    ...['1', '2', '3', '4'].map((p) => ({ value: p, label: t(`priority.${p}`) })),
  ];
  const statusOptions: SelectorOptionType[] = [
    { value: 'open', label: t('filters.open') },
    { value: 'done', label: t('filters.done') },
    { value: 'any', label: t('filters.anyStatus') },
    { type: 'divider' },
    ...statusesOf(type).map((st: TicketStatus) => ({ value: st, label: t(`status.${st}`) })),
  ];
  const sortOptions = [
    ...(SORTS[sort] ? [] : [{ value: sort, label: t('filters.sortCustom') }]),
    ...Object.entries(SORTS).map(([value, key]) => ({ value, label: t(`filters.sorts.${key}`) })),
  ];

  const queueOptions = QUEUES.filter((q) => !q.hidden || q.id === queue).map((q) => {
    const n = counts?.[q.count];
    return { value: q.id, label: `${t(`desk.queues.${q.id}`)}${n !== undefined ? ` · ${n}` : ''}` };
  });

  const filters: FilterDef[] = [
    {
      id: 'type',
      label: t('filters.type'),
      primary: true,
      value:
        typeValue === DESK ? undefined : typeValue === ALL ? t('filters.allTypes') : t(`typesPlural.${type}`),
      onClear: () => set({ type: undefined, status: undefined }),
      control: (
        <Selector
          label={t('filters.type')}
          isLabelHidden
          width={192}
          value={typeValue}
          onChange={(v) => set({ type: v === DESK ? undefined : v, status: undefined })}
          options={typeOptions}
        />
      ),
    },
    {
      id: 'priority',
      label: t('filters.priority'),
      primary: true,
      value: state.priority ? t(`priority.${state.priority}`) : undefined,
      onClear: () => set({ priority: undefined }),
      control: (
        <Selector
          label={t('filters.priority')}
          isLabelHidden
          width={144}
          value={(state.priority as string | undefined) ?? ALL}
          onChange={(v) => set({ priority: v === ALL ? undefined : v })}
          options={priorityOptions}
        />
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
        <Selector
          label={t('filters.status')}
          isLabelHidden
          width="100%"
          value={status}
          onChange={(v) => set({ status: v === 'open' ? undefined : v })}
          options={statusOptions}
        />
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
          width="100%"
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
          width="100%"
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
      control: <Text color="secondary">{t('filters.ciSet')}</Text>,
    });

  return (
    <>
      <PageHeader
        title={t('desk.title')}
        description={t('desk.description')}
        actions={
          <Button
            label={t('desk.new')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setCreating(true)}
          />
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <QueueRail
          active={queue}
          counts={counts}
          onSelect={(q) => set({ view: q === 'all' ? undefined : q, sort: undefined })}
        />
        <div className="grid min-w-0 gap-3">
          <div className="lg:hidden">
            <Selector
              label={t('desk.queues.label')}
              isLabelHidden
              width="100%"
              value={queue}
              onChange={(q) => set({ view: q === 'all' ? undefined : q, sort: undefined })}
              options={queueOptions}
            />
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
                onClearAll={clearAll}
                actions={
                  <Selector
                    label={t('filters.sort')}
                    isLabelHidden
                    value={sort}
                    onChange={(sv) => set({ sort: sv === def.sort ? undefined : sv })}
                    options={sortOptions}
                  />
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
                    <Button label={tc('clearFilters')} variant="secondary" onClick={clearAll} />
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
