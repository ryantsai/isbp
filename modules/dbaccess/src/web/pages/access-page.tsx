'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { SearchXIcon, UserRoundXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import type { InventoryAccount, ServerOption, Unmanaged } from '../../contracts';
import { EngineLabel } from '../badges';
import { FilterSelect, GrantsTable } from '../grants-table';
import { UnmanagedList } from '../unmanaged';

const TABS = ['grants', 'accounts', 'unmanaged'] as const;
type Tab = (typeof TABS)[number];

function AccountsTable({ servers }: { servers: ServerOption[] }) {
  const t = useTranslations('dbaccess.accounts');
  const tc = useTranslations('common');
  const [state, set] = useListState({ pageSize: 25 });
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<InventoryAccount>>(
    '/dbaccess/accounts',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      q: state.q,
      serverId: str('server'),
      orphan: str('orphan'),
    },
  );
  const filtered = Boolean(state.q || str('server') || str('orphan'));
  const columns = useMemo<DataTableColumn<InventoryAccount>[]>(
    () => [
      {
        id: 'name',
        header: t('account'),
        meta: { sortKey: 'name', className: 'max-w-56' },
        cell: ({ row }) => (
          <VStack className="min-w-0">
            <Text type="code" maxLines={1}>
              {row.original.name}
            </Text>
            <Text type="supporting" maxLines={1}>
              {row.original.kind ?? ''}
            </Text>
          </VStack>
        ),
      },
      {
        id: 'server',
        header: t('server'),
        meta: { sortKey: 'server', className: 'max-w-48' },
        cell: ({ row }) => (
          <VStack className="min-w-0">
            <Text maxLines={1}>{row.original.server.displayName}</Text>
            <EngineLabel engine={row.original.server.engine} />
          </VStack>
        ),
      },
      {
        id: 'person',
        header: t('person'),
        meta: { className: 'max-w-44' },
        cell: ({ row }) =>
          row.original.orphan ? (
            <Badge variant="warning" label={t('orphan')} icon={<Icon icon={UserRoundXIcon} size="xsm" />} />
          ) : (
            <Text maxLines={1}>{row.original.person?.displayName ?? t('service')}</Text>
          ),
      },
      {
        id: 'state',
        header: t('state'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <HStack gap={1} wrap="wrap">
            <Badge variant="neutral" label={row.original.enabled ? t('enabled') : t('disabled')} />
            {row.original.managed && <Badge variant="info" label={t('managed')} />}
          </HStack>
        ),
      },
      {
        id: 'roles',
        header: t('roles'),
        meta: { className: 'hidden max-w-64 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <Text type="code" color="secondary" maxLines={1}>
            {row.original.roles.join(', ') || '—'}
          </Text>
        ),
      },
      {
        id: 'lastLoginAt',
        header: t('lastLogin'),
        meta: {
          sortKey: 'lastLoginAt',
          className: 'hidden xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.lastLoginAt} className="text-sm" />,
      },
    ],
    [t],
  );
  return (
    <DataTable
      label={t('table')}
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
      getRowId={(a) => `${a.server.id}|${a.name}`}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('search')}
            className="sm:w-64"
          />
          <FilterSelect
            value={str('server')}
            onChange={(v) => set({ server: v })}
            label={t('server')}
            allLabel={t('allServers')}
            width={208}
            options={servers.map((s) => ({ value: s.id, label: s.displayName }))}
          />
          <FilterSelect
            value={str('orphan')}
            onChange={(v) => set({ orphan: v })}
            label={t('person')}
            allLabel={t('allAccounts')}
            options={[
              { value: 'true', label: t('orphansOnly') },
              { value: 'false', label: t('matchedOnly') },
            ]}
          />
          {filtered && (
            <Button
              label={tc('clearFilters')}
              variant="ghost"
              size="sm"
              onClick={() => set({ q: undefined, server: undefined, orphan: undefined })}
            />
          )}
        </>
      }
      empty={<EmptyState icon={<SearchXIcon />} title={t('empty')} description={t('emptyHint')} />}
    />
  );
}

/** Access (DBAs, auditors): every grant, the accounts on the servers, and access no grant explains. */
export default function AccessPage() {
  const t = useTranslations('dbaccess.access');
  const [state, set] = useListState();
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'grants';
  const servers = useApiQuery<{ items: ServerOption[] }>('/dbaccess/lookups/servers');
  const unmanaged = useApiQuery<{ items: Unmanaged[] }>('/dbaccess/unmanaged', { serverId: undefined });
  const list = servers.data?.items ?? [];
  const panelId = useId();
  const unmanagedCount = unmanaged.data?.items.length ?? 0;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <VStack gap={3} className="min-w-0">
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) =>
            // Each tab keeps its own filters: switching starts from a clean list.
            set({
              tab: v === 'grants' ? undefined : v,
              q: undefined,
              server: undefined,
              risk: undefined,
              status: undefined,
              orphan: undefined,
              sort: undefined,
            })
          }
          hasDivider
        >
          <Tab value="grants" label={t('tabs.grants')} panelId={panelId} />
          <Tab value="accounts" label={t('tabs.accounts')} panelId={panelId} />
          <Tab
            value="unmanaged"
            label={t('tabs.unmanaged')}
            panelId={panelId}
            endContent={unmanagedCount > 0 ? <Badge variant="warning" label={unmanagedCount} /> : undefined}
          />
        </TabList>
        <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)} className="min-w-0">
          {tab === 'grants' && <GrantsTable servers={list} />}
          {tab === 'accounts' && <AccountsTable servers={list} />}
          {tab === 'unmanaged' && (
            <VStack gap={3} className="min-w-0">
              <Text color="secondary">{t('unmanagedHint')}</Text>
              <UnmanagedList />
            </VStack>
          )}
        </div>
      </VStack>
    </>
  );
}
