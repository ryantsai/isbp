'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { KeyRoundIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { ACCOUNT_VIEWS, type SharedAccountListItem } from '../../contracts';
import { AccountFormSheet } from '../account-dialogs';
import { PasswordDueBadge, SharedAccountStatusBadge } from '../badges';
import { accountHref, useDay } from '../lib';

type View = (typeof ACCOUNT_VIEWS)[number];

/** Shared accounts: custodians, members, passwords to change and reviews due. */
export default function AccountsPage() {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const router = useRouter();
  const day = useDay();
  const mineId = useId();
  const canManage = useCan('isms.accounts.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = ACCOUNT_VIEWS.includes(state.view as View) ? (state.view as View) : 'active';
  const mine = state.mine === 'true';
  const { data, isLoading, isFetching } = useApiQuery<Page<SharedAccountListItem>>('/isms/accounts', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    view,
    mine: mine ? 'true' : undefined,
  });
  const columns = useMemo<DataTableColumn<SharedAccountListItem>[]>(
    () => [
      {
        id: 'accountName',
        header: t('fields.accountName'),
        meta: { sortKey: 'accountName', className: 'max-w-56' },
        cell: ({ row }) => (
          <Link
            href={accountHref(row.original.reference)}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-mono text-sm font-medium outline-none hover:underline focus-visible:underline"
          >
            {row.original.accountName}
          </Link>
        ),
      },
      {
        id: 'targetSystem',
        header: t('fields.targetSystem'),
        meta: {
          sortKey: 'targetSystem',
          className: 'hidden max-w-56 sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <span className="block truncate">{row.original.targetSystem ?? '—'}</span>,
      },
      {
        id: 'custodian',
        header: t('fields.custodian'),
        meta: { className: 'hidden max-w-44 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="block truncate">{row.original.custodian?.displayName ?? '—'}</span>
        ),
      },
      {
        id: 'members',
        header: t('fields.members'),
        meta: { className: 'hidden tabular-nums lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => row.original.memberCount,
      },
      {
        id: 'lastPasswordChangeOn',
        header: t('fields.lastPasswordChangeOn'),
        meta: {
          sortKey: 'lastPasswordChangeOn',
          className: 'hidden lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => day(row.original.lastPasswordChangeOn),
      },
      {
        id: 'nextReviewOn',
        header: t('fields.nextReviewOn'),
        meta: {
          sortKey: 'nextReviewOn',
          className: 'hidden xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => day(row.original.nextReviewOn),
      },
      {
        id: 'status',
        header: t('fields.status'),
        cell: ({ row }) =>
          row.original.status === 'active' && row.original.passwordChange.due ? (
            <PasswordDueBadge />
          ) : (
            <SharedAccountStatusBadge status={row.original.status} />
          ),
      },
    ],
    [t, day],
  );
  const table = (
    <DataTable
      label={t('accounts.title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      loading={isLoading}
      fetching={isFetching}
      getRowId={(a) => a.id}
      onRowClick={(a) => router.push(accountHref(a.reference))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('accounts.search')}
            className="sm:w-64"
          />
          <div className="flex items-center gap-2">
            <Switch
              id={mineId}
              checked={mine}
              onCheckedChange={(v) => set({ mine: v ? 'true' : undefined })}
            />
            <label htmlFor={mineId} className="text-sm">
              {t('accounts.onlyMine')}
            </label>
          </div>
          {(state.q || mine) && (
            <Button variant="ghost" size="sm" onClick={() => set({ q: undefined, mine: undefined })}>
              {tc('clearFilters')}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={state.q ? <SearchXIcon /> : <KeyRoundIcon />}
          title={t('accounts.empty.title')}
          description={t(`accounts.empty.${view}`)}
          action={
            canManage &&
            view === 'active' && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('accounts.new')}
              </Button>
            )
          }
        />
      }
    />
  );
  return (
    <>
      <PageHeader
        title={t('accounts.title')}
        description={t('accounts.description')}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t('accounts.new')}
            </Button>
          )
        }
      />
      <Tabs
        value={view}
        onValueChange={(v) => set({ view: v === 'active' ? undefined : v })}
        className="gap-4"
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {ACCOUNT_VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`accounts.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {ACCOUNT_VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {view === v && table}
          </TabsContent>
        ))}
      </Tabs>
      {canManage && (
        <AccountFormSheet
          open={creating}
          onOpenChange={setCreating}
          onSaved={(a) => router.push(accountHref(a.reference))}
        />
      )}
    </>
  );
}
