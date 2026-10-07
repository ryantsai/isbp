'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
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
  ClockAlertIcon,
  InboxIcon,
  LayersIcon,
  type LucideIcon,
  PlusIcon,
  SearchXIcon,
  SirenIcon,
  UserCheckIcon,
  UsersIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { TicketListItem, TicketStatus, TicketType } from '../../contracts';
import { ticketHref } from '../lib';
import { NewTicketDialog } from '../components/new-ticket-dialog';
import { CategorySelect, GroupSelect } from '../components/pickers';
import { type TicketColumn, useTicketColumns } from '../components/ticket-columns';
import { statusesOf } from '../statuses';
import type { QueueCounts } from '../types';

const ALL = '__all__';

type QueueId = 'assigned' | 'groups' | 'unassigned' | 'all' | 'breached' | 'at_risk' | 'major';

const QUEUES: {
  id: QueueId;
  icon: LucideIcon;
  count: keyof QueueCounts;
  query: Record<string, string>;
  alert?: boolean;
}[] = [
  { id: 'assigned', icon: UserCheckIcon, count: 'assigned', query: { view: 'assigned' } },
  { id: 'groups', icon: UsersIcon, count: 'groups', query: { view: 'groups' } },
  { id: 'unassigned', icon: InboxIcon, count: 'unassigned', query: { view: 'unassigned' } },
  { id: 'all', icon: LayersIcon, count: 'open', query: { view: 'all' } },
  {
    id: 'breached',
    icon: AlarmClockOffIcon,
    count: 'breached',
    query: { view: 'all', sla: 'breached' },
    alert: true,
  },
  {
    id: 'at_risk',
    icon: ClockAlertIcon,
    count: 'atRisk',
    query: { view: 'all', sla: 'at_risk' },
    alert: true,
  },
  { id: 'major', icon: SirenIcon, count: 'majorOpen', query: { view: 'all', major: 'true' }, alert: true },
];

const TYPES: TicketType[] = ['incident', 'service_request', 'problem', 'change'];
const COLUMNS: TicketColumn[] = [
  'reference',
  'title',
  'requester',
  'status',
  'priority',
  'sla',
  'assignee',
  'updated',
];

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
        {QUEUES.map((q, i) => {
          const count = counts?.[q.count];
          const Icon = q.icon;
          const isActive = active === q.id;
          return (
            <motion.li
              key={q.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                type="button"
                onClick={() => onSelect(q.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
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
                    {count}
                    <span className="sr-only"> {t('tickets', { count })}</span>
                  </span>
                )}
              </button>
            </motion.li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The agent workspace: queues on the left, a filterable ticket table on the right. */
export default function DeskPage() {
  const t = useTranslations('itsm');
  const tc = useTranslations('common');
  const router = useRouter();
  const canProblems = useCan('itsm.problems.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const queue = (QUEUES.some((q) => q.id === state.view) ? state.view : 'all') as QueueId;
  const preset = QUEUES.find((q) => q.id === queue)!.query;
  const type = (TYPES as string[]).includes(String(state.type)) ? (state.type as TicketType) : undefined;
  const status = (state.status as string | undefined) ?? 'open';
  const assigneeId = state.assigneeId as string | undefined;

  const { data: counts } = useApiQuery<QueueCounts>('/itsm/queues', undefined, { refetchInterval: 60_000 });
  const { data, isLoading, isFetching } = useApiQuery<Page<TicketListItem>>(
    '/itsm/tickets',
    {
      ...preset,
      type,
      status: status === 'any' ? undefined : status,
      priority: state.priority as string | undefined,
      groupId: state.groupId as string | undefined,
      assigneeId,
      categoryId: state.categoryId as string | undefined,
      ciId: state.ciId as string | undefined,
      q: state.q,
      sort: state.sort,
      page: state.page,
      pageSize: state.pageSize,
    },
    { refetchInterval: 60_000 },
  );
  const people = usePeople([assigneeId]);
  const columns = useTicketColumns(COLUMNS);
  const filtered = Boolean(
    state.q ||
    type ||
    state.status ||
    state.priority ||
    state.groupId ||
    assigneeId ||
    state.categoryId ||
    state.ciId,
  );

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
          onSelect={(q) => set({ view: q === 'all' ? undefined : q })}
        />
        <div className="grid min-w-0 gap-3">
          <div className="lg:hidden">
            <Select value={queue} onValueChange={(q) => set({ view: q === 'all' ? undefined : q })}>
              <SelectTrigger className="w-full" aria-label={t('desk.queues.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUEUES.map((q) => (
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
            sort={state.sort}
            loading={isLoading}
            fetching={isFetching}
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(ticketHref(r.reference))}
            onPageChange={(page) => set({ page })}
            onPageSizeChange={(pageSize) => set({ pageSize })}
            onSortChange={(sort) => set({ sort })}
            toolbar={
              <>
                <SearchInput
                  value={state.q ?? ''}
                  onChange={(q) => set({ q })}
                  placeholder={t('filters.search')}
                  className="sm:w-64"
                />
                <Select
                  value={type ?? ALL}
                  onValueChange={(v) => set({ type: v === ALL ? undefined : v, status: undefined })}
                >
                  <SelectTrigger className="w-full sm:w-40" aria-label={t('filters.type')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('filters.allTypes')}</SelectItem>
                    {TYPES.map((ty) => (
                      <SelectItem key={ty} value={ty}>
                        {t(`typesPlural.${ty}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={(v) => set({ status: v === 'open' ? undefined : v })}>
                  <SelectTrigger className="w-full sm:w-44" aria-label={t('filters.status')}>
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
                <GroupSelect
                  value={(state.groupId as string | undefined) ?? null}
                  onChange={(groupId) => set({ groupId: groupId ?? undefined })}
                  noneLabel={t('filters.anyGroup')}
                  aria-label={t('filters.group')}
                  className="sm:w-44"
                />
                <label htmlFor="itsm-assignee-filter" className="sr-only">
                  {t('filters.assignee')}
                </label>
                <PersonPicker
                  id="itsm-assignee-filter"
                  value={assigneeId ? (people.get(assigneeId) ?? { id: assigneeId, displayName: '…' }) : null}
                  onChange={(p) => set({ assigneeId: p?.id })}
                  placeholder={t('filters.anyAssignee')}
                  className="w-full sm:w-48"
                />
                <CategorySelect
                  type={type}
                  value={(state.categoryId as string | undefined) ?? null}
                  onChange={(categoryId) => set({ categoryId: categoryId ?? undefined })}
                  noneLabel={t('filters.anyCategory')}
                  aria-label={t('filters.category')}
                  className="sm:w-52"
                />
                {filtered && (
                  <Button
                    variant="ghost"
                    size="sm"
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
                )}
              </>
            }
            empty={
              <EmptyState
                icon={filtered ? <SearchXIcon /> : <InboxIcon />}
                title={filtered ? t('desk.empty.filtered') : t(`desk.empty.${queue}`)}
                description={filtered ? t('desk.empty.filteredHint') : undefined}
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
