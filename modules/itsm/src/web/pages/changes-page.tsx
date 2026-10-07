'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { CalendarRangeIcon, GitCompareArrowsIcon, ListIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useNow, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { TicketListItem } from '../../contracts';
import { ChangeCalendar } from '../components/change-calendar';
import { NewChangeDialog } from '../components/new-change-dialog';
import { type TicketColumn, useTicketColumns } from '../components/ticket-columns';
import { ticketHref } from '../lib';
import { statusesOf } from '../statuses';

const COLUMNS: TicketColumn[] = ['reference', 'title', 'status', 'priority', 'window', 'assignee', 'updated'];
type Tab = 'calendar' | 'list';

function ChangeList() {
  const t = useTranslations('itsm');
  const router = useRouter();
  const [state, set] = useListState({ pageSize: 25 });
  const status = (state.status as string | undefined) ?? 'open';
  const { data, isLoading, isFetching } = useApiQuery<Page<TicketListItem>>('/itsm/tickets', {
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

/** Changes: the calendar (month grid or agenda) and the list. */
export default function ChangesPage() {
  const t = useTranslations('itsm.changes');
  const canManage = useCan('itsm.changes.manage');
  const [state, set] = useListState();
  const [creating, setCreating] = useState(false);
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow();
  const tab: Tab = state.tab === 'list' ? 'list' : 'calendar';
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .format(now)
    .slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(String(state.month)) ? String(state.month) : thisMonth;
  const display = state.display === 'agenda' ? 'agenda' : 'month';

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
      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'calendar' ? undefined : v })}>
        <TabsList>
          <TabsTrigger value="calendar">
            <CalendarRangeIcon aria-hidden />
            {t('tabs.calendar')}
          </TabsTrigger>
          <TabsTrigger value="list">
            <ListIcon aria-hidden />
            {t('tabs.list')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="calendar">
          {tab === 'calendar' && (
            <ChangeCalendar
              month={month}
              onMonthChange={(m) => set({ month: m === thisMonth ? undefined : m })}
              display={display}
              onDisplayChange={(d) => set({ display: d === 'month' ? undefined : d })}
            />
          )}
        </TabsContent>
        <TabsContent value="list">{tab === 'list' && <ChangeList />}</TabsContent>
      </Tabs>
      {canManage && <NewChangeDialog open={creating} onOpenChange={setCreating} />}
    </>
  );
}
