'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { KeyRoundIcon, SearchXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { GRANT_VIEW_STATUSES, type Grant, RISKS, type ServerOption } from '../contracts';
import { GrantStatusBadge, RiskBadge } from './badges';
import { GrantSheet } from './grant-sheet';
import { useDate, useLocalized } from './lib';

const ALL = '__all__';

/** One toolbar filter: "all" first (the cleared state), then the choices. */
export function FilterSelect({
  value,
  onChange,
  label,
  allLabel,
  options,
  width = 176,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  label: string;
  allLabel: string;
  options: readonly { value: string; label: string }[];
  width?: number;
}) {
  return (
    <Selector
      label={label}
      isLabelHidden
      width={width}
      value={value ?? ALL}
      onChange={(v) => onChange(v === ALL ? undefined : v)}
      options={[{ value: ALL, label: allLabel }, ...options]}
    />
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
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Grant>>('/dbaccess/grants', {
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
          <VStack className="min-w-0">
            <Text weight="medium" maxLines={1}>
              {row.original.grantee?.displayName ?? t('unknownPerson')}
            </Text>
            <Text type="code" color="secondary" maxLines={1}>
              {row.original.accountName ?? '—'}
            </Text>
          </VStack>
        ),
      },
      {
        id: 'role',
        header: t('role'),
        meta: { sortKey: 'role', className: 'max-w-56' },
        cell: ({ row }) => (
          <VStack className="min-w-0">
            <Text maxLines={1}>{l(row.original.role.name)}</Text>
            <Text type="supporting" maxLines={1}>
              {row.original.server.displayName}
            </Text>
          </VStack>
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
            <Text color="secondary">{t('permanent')}</Text>
          ),
      },
      {
        id: 'source',
        header: t('source'),
        meta: { className: 'hidden xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) =>
          row.original.source === 'request' ? (
            <Text type="code">{row.original.request?.reference ?? '—'}</Text>
          ) : (
            <Badge variant="neutral" label={t(`sources.${row.original.source}`)} />
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
        error={error}
        onRetry={() => refetch()}
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
              options={[
                { value: 'live', label: t('live') },
                ...GRANT_VIEW_STATUSES.map((s) => ({ value: s, label: ts(s) })),
                { value: 'ended', label: t('ended') },
              ]}
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
              value={str('risk')}
              onChange={(v) => set({ risk: v })}
              label={t('risk')}
              allLabel={t('allRisks')}
              width={144}
              options={RISKS.map((r) => ({ value: r, label: tr(r) }))}
            />
            {filtered && (
              <Button
                label={tc('clearFilters')}
                variant="ghost"
                size="sm"
                onClick={() => set({ q: undefined, server: undefined, risk: undefined, status: undefined })}
              />
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
