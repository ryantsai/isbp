'use client';

import type { Page } from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import type { ColumnDef } from '@tanstack/react-table';
import { KeyRoundIcon, SearchXIcon, UserRoundXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import {
  GRANT_VIEW_STATUSES,
  type Grant,
  type InventoryAccount,
  RISKS,
  type ServerOption,
  type Unmanaged,
} from '../../contracts';
import { EngineLabel, GrantStatusBadge, RiskBadge } from '../badges';
import { GrantSheet } from '../grant-sheet';
import { useDate, useLocalized } from '../lib';
import { UnmanagedList } from '../unmanaged';

const ALL = '__all__';
const TABS = ['grants', 'accounts', 'unmanaged'] as const;
type Tab = (typeof TABS)[number];

function FilterSelect({
  value,
  onChange,
  label,
  allLabel,
  children,
  className = 'sm:w-44',
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  label: string;
  allLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={`w-full ${className}`} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

function GrantsTable({ servers }: { servers: ServerOption[] }) {
  const t = useTranslations('dbaccess.access');
  const ts = useTranslations('dbaccess.status');
  const tr = useTranslations('dbaccess.risk');
  const tc = useTranslations('common');
  const l = useLocalized();
  const date = useDate();
  const [state, set] = useListState({ pageSize: 25 });
  const [open, setOpen] = useState<string | null>(null);
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const status = str('status') ?? 'live';
  const { data, isLoading, isFetching } = useApiQuery<Page<Grant>>('/dbaccess/grants', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    status: status === 'all' ? undefined : status,
    serverId: str('server'),
    risk: str('risk'),
  });
  const filtered = Boolean(state.q || str('server') || str('risk') || str('status'));
  const columns = useMemo<ColumnDef<Grant, unknown>[]>(
    () => [
      {
        id: 'grantee',
        header: t('grantee'),
        meta: { sortKey: 'grantee', className: 'max-w-48' },
        cell: ({ row }) => (
          <span className="grid min-w-0">
            <span className="truncate font-medium">
              {row.original.grantee?.displayName ?? t('unknownPerson')}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {row.original.accountName ?? '—'}
            </span>
          </span>
        ),
      },
      {
        id: 'role',
        header: t('role'),
        meta: { sortKey: 'role', className: 'max-w-56' },
        cell: ({ row }) => (
          <span className="grid min-w-0">
            <span className="truncate">{l(row.original.role.name)}</span>
            <span className="truncate text-xs text-muted-foreground">{row.original.server.displayName}</span>
          </span>
        ),
      },
      {
        id: 'risk',
        header: t('risk'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <RiskBadge risk={row.original.role.risk} />,
      },
      {
        id: 'status',
        header: t('status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <GrantStatusBadge status={row.original.viewStatus} />,
      },
      {
        id: 'expiresAt',
        header: t('expires'),
        meta: {
          sortKey: 'expiresAt',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) =>
          row.original.expiresAt ? (
            date(row.original.expiresAt)
          ) : (
            <span className="text-muted-foreground">{t('permanent')}</span>
          ),
      },
      {
        id: 'source',
        header: t('source'),
        meta: { className: 'hidden xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) =>
          row.original.source === 'request' ? (
            <span className="font-mono text-xs">{row.original.request?.reference ?? '—'}</span>
          ) : (
            <Badge variant="outline">{t(`sources.${row.original.source}`)}</Badge>
          ),
      },
    ],
    [t, l, date],
  );
  return (
    <>
      <DataTable
        label={t('grantsTable')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(g) => g.id}
        onRowClick={(g) => setOpen(g.id)}
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
              value={status === 'all' ? undefined : status}
              onChange={(v) => set({ status: v ?? 'all' })}
              label={t('status')}
              allLabel={t('allStatuses')}
            >
              <SelectItem value="live">{t('live')}</SelectItem>
              {GRANT_VIEW_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ts(s)}
                </SelectItem>
              ))}
              <SelectItem value="ended">{t('ended')}</SelectItem>
            </FilterSelect>
            <FilterSelect
              value={str('server')}
              onChange={(v) => set({ server: v })}
              label={t('server')}
              allLabel={t('allServers')}
              className="sm:w-52"
            >
              {servers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.displayName}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect
              value={str('risk')}
              onChange={(v) => set({ risk: v })}
              label={t('risk')}
              allLabel={t('allRisks')}
              className="sm:w-36"
            >
              {RISKS.map((r) => (
                <SelectItem key={r} value={r}>
                  {tr(r)}
                </SelectItem>
              ))}
            </FilterSelect>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => set({ q: undefined, server: undefined, risk: undefined, status: undefined })}
              >
                {tc('clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={filtered ? <SearchXIcon /> : <KeyRoundIcon />}
            title={t('empty')}
            description={t('emptyHint')}
          />
        }
      />
      <GrantSheet grantId={open} onClose={() => setOpen(null)} />
    </>
  );
}

function AccountsTable({ servers }: { servers: ServerOption[] }) {
  const t = useTranslations('dbaccess.accounts');
  const tc = useTranslations('common');
  const [state, set] = useListState({ pageSize: 25 });
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { data, isLoading, isFetching } = useApiQuery<Page<InventoryAccount>>('/dbaccess/accounts', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    serverId: str('server'),
    orphan: str('orphan'),
  });
  const filtered = Boolean(state.q || str('server') || str('orphan'));
  const columns = useMemo<ColumnDef<InventoryAccount, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('account'),
        meta: { sortKey: 'name', className: 'max-w-56' },
        cell: ({ row }) => (
          <span className="grid min-w-0">
            <span className="truncate font-mono text-sm">{row.original.name}</span>
            <span className="truncate text-xs text-muted-foreground">{row.original.kind ?? ''}</span>
          </span>
        ),
      },
      {
        id: 'server',
        header: t('server'),
        meta: { sortKey: 'server', className: 'max-w-48' },
        cell: ({ row }) => (
          <span className="grid min-w-0">
            <span className="truncate">{row.original.server.displayName}</span>
            <EngineLabel engine={row.original.server.engine} />
          </span>
        ),
      },
      {
        id: 'person',
        header: t('person'),
        meta: { className: 'max-w-44' },
        cell: ({ row }) =>
          row.original.orphan ? (
            <Badge variant="warning">
              <UserRoundXIcon aria-hidden /> {t('orphan')}
            </Badge>
          ) : (
            <span className="truncate">{row.original.person?.displayName ?? t('service')}</span>
          ),
      },
      {
        id: 'state',
        header: t('state'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            <Badge variant={row.original.enabled ? 'secondary' : 'muted'}>
              {row.original.enabled ? t('enabled') : t('disabled')}
            </Badge>
            {row.original.managed && <Badge variant="info">{t('managed')}</Badge>}
          </span>
        ),
      },
      {
        id: 'roles',
        header: t('roles'),
        meta: { className: 'hidden max-w-64 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <span
            className="block truncate font-mono text-xs text-muted-foreground"
            title={row.original.roles.join(', ')}
          >
            {row.original.roles.join(', ') || '—'}
          </span>
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
            className="sm:w-52"
          >
            {servers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.displayName}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={str('orphan')}
            onChange={(v) => set({ orphan: v })}
            label={t('person')}
            allLabel={t('allAccounts')}
          >
            <SelectItem value="true">{t('orphansOnly')}</SelectItem>
            <SelectItem value="false">{t('matchedOnly')}</SelectItem>
          </FilterSelect>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ q: undefined, server: undefined, orphan: undefined })}
            >
              {tc('clearFilters')}
            </Button>
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
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs
        value={tab}
        onValueChange={(v) =>
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
        className="min-w-0"
      >
        <TabsList>
          <TabsTrigger value="grants">{t('tabs.grants')}</TabsTrigger>
          <TabsTrigger value="accounts">{t('tabs.accounts')}</TabsTrigger>
          <TabsTrigger value="unmanaged">
            {t('tabs.unmanaged')}
            {unmanaged.data && unmanaged.data.items.length > 0 && (
              <Badge variant="warning" className="ml-1">
                {unmanaged.data.items.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="grants" className="min-w-0">
          {tab === 'grants' && <GrantsTable servers={list} />}
        </TabsContent>
        <TabsContent value="accounts" className="min-w-0">
          {tab === 'accounts' && <AccountsTable servers={list} />}
        </TabsContent>
        <TabsContent value="unmanaged" className="grid min-w-0 gap-3">
          {tab === 'unmanaged' && (
            <>
              <p className="text-sm text-muted-foreground">{t('unmanagedHint')}</p>
              <UnmanagedList />
            </>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
