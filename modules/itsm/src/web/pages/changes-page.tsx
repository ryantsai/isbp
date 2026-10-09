'use client';

import { parseRecordRef } from '@isbp/sdk';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
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
import {
  CalendarDaysIcon,
  CalendarRangeIcon,
  GitCompareArrowsIcon,
  ListIcon,
  type LucideIcon,
  PlusIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useNow, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import { NEW_CHANGE_PERMISSION, type TicketListItem } from '../../contracts';
import { ChangeCalendar } from '../components/change-calendar';
import { NewChangeDialog } from '../components/new-change-dialog';
import { type TicketColumn, useTicketColumns } from '../components/ticket-columns';
import { ticketHref } from '../lib';
import { statusesOf } from '../statuses';

const COLUMNS: TicketColumn[] = ['ticket', 'status', 'changeType', 'risk', 'window', 'owner'];
type View = 'month' | 'agenda' | 'list';

function ChangeList() {
  const t = useTranslations('itsm');
  const router = useRouter();
  const [state, set] = useListState({ pageSize: 25 });
  const status = (state.status as string | undefined) ?? 'open';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<TicketListItem>>('/itsm/tickets', {
    type: 'change',
    view: 'all',
    status: status === 'any' ? undefined : status,
    q: state.q,
    sort: state.sort ?? 'plannedStart',
    page: state.page,
    pageSize: state.pageSize,
  });
  const columns = useTicketColumns(COLUMNS);
  return (
    <DataTable
      label={t('changes.listLabel')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort ?? 'plannedStart'}
      loading={isLoading}
      fetching={isFetching}
      error={error}
      onRetry={() => refetch()}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(ticketHref(r.reference))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={t('changes.search')} />
          <Select value={status} onValueChange={(v) => set({ status: v === 'open' ? undefined : v })}>
            <SelectTrigger className="w-full sm:w-52" aria-label={t('filters.status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t('filters.open')}</SelectItem>
              <SelectItem value="done">{t('filters.done')}</SelectItem>
              <SelectItem value="any">{t('filters.anyStatus')}</SelectItem>
              <SelectSeparator />
              {statusesOf('change').map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
      empty={<EmptyState icon={<GitCompareArrowsIcon />} title={t('changes.empty')} />}
    />
  );
}

/** Changes in one view switch: the month grid, the agenda, or the list. */
export default function ChangesPage() {
  const t = useTranslations('itsm.changes');
  const canManage = useCan(NEW_CHANGE_PERMISSION);
  const [state, set] = useListState();
  const [creating, setCreating] = useState(false);
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow();
  // `?tab=list` and `?display=agenda` are older links to the same views.
  const view: View =
    state.view === 'list' || state.tab === 'list'
      ? 'list'
      : state.view === 'agenda' || state.display === 'agenda'
        ? 'agenda'
        : 'month';
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .format(now)
    .slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(String(state.month)) ? String(state.month) : thisMonth;
  // `?new=1&title=…&link=<type>:<id>[&start=…&end=…]` opens the form prefilled (e.g. from a release in ALM).
  const prefill =
    canManage && state.new === '1'
      ? {
          title: String(state.title ?? '').slice(0, 200),
          link: parseRecordRef(String(state.link ?? '')),
          start: typeof state.start === 'string' ? state.start : null,
          end: typeof state.end === 'string' ? state.end : null,
        }
      : null;
  const views: { id: View; icon: LucideIcon; wide?: boolean }[] = [
    { id: 'month', icon: CalendarRangeIcon, wide: true },
    { id: 'agenda', icon: CalendarDaysIcon },
    { id: 'list', icon: ListIcon },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('new')}
            </Button>
          )
        }
      />
      <div
        className="mb-4 inline-flex items-center gap-1 rounded-lg border p-0.5"
        role="group"
        aria-label={t('views.label')}
      >
        {views.map((v) => {
          const Icon = v.icon;
          return (
            <Button
              key={v.id}
              variant={view === v.id ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={view === v.id}
              className={cn(v.wide && 'hidden md:inline-flex')}
              onClick={() =>
                set({
                  view: v.id === 'month' ? undefined : v.id,
                  tab: undefined,
                  display: undefined,
                  page: undefined,
                })
              }
            >
              <Icon aria-hidden />
              {t(`views.${v.id}`)}
            </Button>
          );
        })}
      </div>
      {view === 'list' ? (
        <ChangeList />
      ) : (
        <ChangeCalendar
          month={month}
          onMonthChange={(m) => set({ month: m === thisMonth ? undefined : m })}
          display={view}
        />
      )}
      {canManage && (
        <NewChangeDialog
          open={creating || !!prefill}
          prefill={prefill}
          onOpenChange={(o) => {
            setCreating(o);
            if (!o && prefill)
              set({ new: undefined, title: undefined, link: undefined, start: undefined, end: undefined });
          }}
        />
      )}
    </>
  );
}
