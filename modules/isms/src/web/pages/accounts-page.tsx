'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Segmented } from '@isbp/ui/segmented';
import { KeyRoundIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ACCOUNT_VIEWS, type SharedAccountListItem } from '../../contracts';
import { AccountFormSheet, PasswordChangedDialog } from '../account-dialogs';
import { PasswordDueBadge, SharedAccountStatusBadge } from '../badges';
import { accountHref, useDay } from '../lib';

type View = (typeof ACCOUNT_VIEWS)[number];

/** Shared accounts: custodians, members, passwords to change and reviews due. */
export default function AccountsPage() {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const router = useRouter();
  const day = useDay();
  const canManage = useCan('isms.accounts.manage');
  const canRead = useCan('isms.accounts.read');
  // Custodians and members only see their accounts: no "Only mine" switch or status tabs for them.
  const readsAll = canManage || canRead;
  const { user } = usePlatform();
  const [recording, setRecording] = useState<SharedAccountListItem | null>(null);
  const [state, set] = useListState({ pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const view: View = ACCOUNT_VIEWS.includes(state.view as View) ? (state.view as View) : 'active';
  const mine = state.mine === 'true';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<SharedAccountListItem>>(
    '/isms/accounts',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
      view,
      mine: mine ? 'true' : undefined,
    },
  );
  const columns = useMemo<DataTableColumn<SharedAccountListItem>[]>(
    () => [
      {
        id: 'accountName',
        header: t('fields.accountName'),
        meta: { sortKey: 'accountName', className: 'max-w-56' },
        cell: ({ row }) => (
          <Link href={accountHref(row.original.reference)} onClick={(e) => e.stopPropagation()}>
            <Text type="code" weight="medium" maxLines={1}>
              {row.original.accountName}
            </Text>
          </Link>
        ),
      },
      {
        id: 'targetSystem',
        header: t('fields.targetSystem'),
        meta: {
          sortKey: 'targetSystem',
          priority: 2,
          className: 'max-w-56',
        },
        cell: ({ row }) => <Text maxLines={1}>{row.original.targetSystem ?? '—'}</Text>,
      },
      {
        id: 'custodian',
        header: t('fields.custodian'),
        meta: { priority: 2, className: 'max-w-44' },
        cell: ({ row }) => <Text maxLines={1}>{row.original.custodian?.displayName ?? '—'}</Text>,
      },
      {
        id: 'members',
        header: t('fields.members'),
        meta: { priority: 3, className: 'tabular-nums' },
        cell: ({ row }) => row.original.memberCount,
      },
      {
        id: 'lastPasswordChangeOn',
        header: t('fields.lastPasswordChangeOn'),
        meta: {
          sortKey: 'lastPasswordChangeOn',
          priority: 2,
        },
        cell: ({ row }) => day(row.original.lastPasswordChangeOn),
      },
      {
        id: 'nextReviewOn',
        header: t('fields.nextReviewOn'),
        meta: {
          sortKey: 'nextReviewOn',
          priority: 3,
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
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { priority: 2 },
        cell: ({ row }) =>
          row.original.status === 'active' &&
          row.original.passwordChange.due &&
          (canManage || row.original.custodian?.id === user.id) ? (
            <Button
              label={t('accounts.recordChange')}
              aria-label={t('accounts.recordChangeFor', { account: row.original.accountName })}
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setRecording(row.original);
              }}
            />
          ) : null,
      },
    ],
    [t, tc, day, canManage, user.id],
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
      error={error}
      onRetry={() => refetch()}
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
          {readsAll && (
            <Switch
              label={t('accounts.onlyMine')}
              value={mine}
              onChange={(v) => set({ mine: v ? 'true' : undefined })}
            />
          )}
        </>
      }
      empty={
        state.q || mine ? (
          <EmptyState variant="filtered" onClearFilters={() => set({ q: undefined, mine: undefined })} />
        ) : !readsAll ? (
          <EmptyState
            icon={<KeyRoundIcon />}
            title={t('accounts.empty.participantTitle')}
            description={t('accounts.empty.participant')}
          />
        ) : (
          <EmptyState
            icon={<KeyRoundIcon />}
            title={t('accounts.empty.title')}
            description={t(`accounts.empty.${view}`)}
            action={
              canManage &&
              view === 'active' && (
                <Button
                  label={t('accounts.new')}
                  variant="primary"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => setCreating(true)}
                />
              )
            }
          />
        )
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
            <Button
              label={t('accounts.new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(true)}
            />
          )
        }
      />
      <VStack gap={4}>
        {readsAll && (
          <Segmented
            label={t('fields.status')}
            value={view}
            onChange={(v) => set({ view: v === 'active' ? undefined : v })}
            options={ACCOUNT_VIEWS.map((v) => ({ value: v, label: t(`accounts.views.${v}`) }))}
          />
        )}
        {table}
      </VStack>
      {recording && (
        <PasswordChangedDialog account={recording} open onOpenChange={(o) => !o && setRecording(null)} />
      )}
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
