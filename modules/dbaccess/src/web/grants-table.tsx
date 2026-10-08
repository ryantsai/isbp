'use client';

import type { Page } from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { KeyRoundIcon, SearchXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import { GRANT_VIEW_STATUSES, type Grant, RISKS, type ServerOption } from '../contracts';
import { GrantStatusBadge, RiskBadge } from './badges';
import { GrantSheet } from './grant-sheet';
import { useDate, useLocalized } from './lib';

const ALL = '__all__';

export function FilterSelect({
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

/**
 * Grants as a filterable list (state in the URL); a row opens the grant sheet with its actions. `owned` lists
 * only the grants of roles the viewer owns (role owners see nothing else, whatever they ask for).
 */
export function GrantsTable({ servers, owned = false }: { servers: ServerOption[]; owned?: boolean }) {
  const t = useTranslations('dbaccess.access');
  const tm = useTranslations('dbaccess.mine.owned');
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
    owned: owned ? 'true' : undefined,
  });
  const filtered = Boolean(state.q || str('server') || str('risk') || str('status'));
  const columns = useMemo<DataTableColumn<Grant>[]>(
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
        label={owned ? tm('table') : t('grantsTable')}
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
          owned && !filtered ? (
            <EmptyState icon={<KeyRoundIcon />} title={tm('empty')} description={tm('emptyHint')} />
          ) : (
            <EmptyState
              icon={filtered ? <SearchXIcon /> : <KeyRoundIcon />}
              title={t('empty')}
              description={t('emptyHint')}
            />
          )
        }
      />
      <GrantSheet grantId={open} onClose={() => setOpen(null)} />
    </>
  );
}
