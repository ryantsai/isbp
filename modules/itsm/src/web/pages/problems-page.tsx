'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { BugIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { TicketListItem } from '../../contracts';
import { NewTicketDialog } from '../components/new-ticket-dialog';
import { CategorySelect } from '../components/pickers';
import { type TicketColumn, useTicketColumns } from '../components/ticket-columns';
import { ticketHref } from '../lib';

type View = 'open' | 'known' | 'done' | 'all';
const VIEWS: View[] = ['open', 'known', 'done', 'all'];
const STATUS: Record<View, string | undefined> = {
  open: 'open',
  known: 'known_error',
  done: 'done',
  all: undefined,
};
const COLUMNS: TicketColumn[] = [
  'reference',
  'title',
  'status',
  'priority',
  'category',
  'assignee',
  'updated',
];

/** Problems: root-cause investigations and known errors. */
export default function ProblemsPage() {
  const t = useTranslations('itsm.problems');
  const router = useRouter();
  const canManage = useCan('itsm.problems.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view = (VIEWS as string[]).includes(String(state.view)) ? (state.view as View) : 'open';
  const { data, isLoading, isFetching } = useApiQuery<Page<TicketListItem>>('/itsm/tickets', {
    type: 'problem',
    view: 'all',
    status: STATUS[view],
    categoryId: state.categoryId as string | undefined,
    q: state.q,
    sort: state.sort,
    page: state.page,
    pageSize: state.pageSize,
  });
  const columns = useTicketColumns(COLUMNS);

  const table = (
    <DataTable
      label={t(`views.${view}`)}
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
          <SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={t('search')} />
          <CategorySelect
            type="problem"
            value={(state.categoryId as string | undefined) ?? null}
            onChange={(categoryId) => set({ categoryId: categoryId ?? undefined })}
            noneLabel={t('anyCategory')}
            aria-label={t('category')}
            className="sm:w-56"
          />
        </>
      }
      empty={
        <EmptyState
          icon={state.q || state.categoryId ? <SearchXIcon /> : <BugIcon />}
          title={t(`empty.${view}`)}
        />
      }
    />
  );

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
      <Tabs value={view} onValueChange={(v) => set({ view: v === 'open' ? undefined : v })}>
        <TabsList aria-label={t('viewsLabel')}>
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {VIEWS.map((v) => (
          <TabsContent key={v} value={v}>
            {v === view ? table : null}
          </TabsContent>
        ))}
      </Tabs>
      {canManage && <NewTicketDialog open={creating} onOpenChange={setCreating} types={['problem']} />}
    </>
  );
}
