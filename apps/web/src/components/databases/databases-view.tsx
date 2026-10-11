'use client';

import type { DbTestResult } from '@isbp/contracts';
import { ApiError, useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import {
  DatabaseIcon,
  LockIcon,
  PencilIcon,
  PlugZapIcon,
  PlusIcon,
  SearchXIcon,
  TableIcon,
  Trash2Icon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from '@isbp/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { CatalogSheet } from './catalog-sheet';
import { ConnectionFormSheet, DB_INVALIDATE } from './connection-form-sheet';
import { ConnectionStatus, type DbConnection, EngineBadge, PurposeBadges } from './parts';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';

/** `/admin/databases`: external database connections (Phase 4). The URL keeps which sheet is open. */
export function DatabasesView() {
  const t = useTranslations('databases');
  const tc = useTranslations('common');
  const router = useRouter();
  const sp = useSearchParams();
  const canRead = useCan('core.databases.read');
  const canManage = useCan('core.databases.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [deleting, setDeleting] = useState<DbConnection | null>(null);
  const { data, isLoading, isFetching, refetch, error } = useApiQuery<{ items: DbConnection[] }>(
    canRead ? '/databases' : null,
  );
  const all = useMemo(() => data?.items ?? [], [data]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    for (const k of ['create', 'edit', 'catalog']) next.delete(k);
    if (value) next.set(key, value);
    router.replace(`/admin/databases${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  const createOpen = canManage && sp.get('create') === '1';
  const editing = canManage ? (all.find((c) => c.id === sp.get('edit')) ?? null) : null;
  const browsing = all.find((c) => c.id === sp.get('catalog')) ?? null;

  const test = useApiMutation((api, c: DbConnection) => api.post<DbTestResult>(`/databases/${c.id}/test`), {
    invalidate: DB_INVALIDATE,
    onSuccess: (r, c) => {
      if (r.ok) toast.success(`${c.name}: ${t('test.ok', { ms: r.latencyMs ?? 0 })}`);
      else toast.error(`${c.name}: ${t('test.failed')}`, { description: r.error?.message });
    },
  });
  const remove = useApiMutation((api, c: DbConnection) => api.delete(`/databases/${c.id}`), {
    invalidate: DB_INVALIDATE,
    success: t('delete.done'),
    onSuccess: () => setDeleting(null),
  });

  const needle = (state.q ?? '').trim().toLowerCase();
  const rows = all.filter(
    (c) =>
      !needle ||
      [c.name, c.key, c.host, c.database ?? '', c.username, t(`engines.${c.engine}`)].some((s) =>
        s.toLowerCase().includes(needle),
      ),
  );
  const page = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

  const columns = useMemo<DataTableColumn<DbConnection>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.name'),
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-3">
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-lg ${row.original.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
              aria-hidden
            >
              <DatabaseIcon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{row.original.name}</span>
              <code className="block truncate font-mono text-xs text-muted-foreground">
                {row.original.key}
              </code>
            </span>
          </span>
        ),
      },
      {
        id: 'engine',
        header: t('columns.engine'),
        meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) => <EngineBadge engine={row.original.engine} />,
      },
      {
        id: 'server',
        header: t('columns.server'),
        meta: { className: 'hidden max-w-56 xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) => (
          <span className="block min-w-0">
            <code className="block truncate font-mono text-xs">
              {row.original.host}
              {row.original.port ? `:${row.original.port}` : ''}
            </code>
            {row.original.database && (
              <span className="block truncate text-xs text-muted-foreground">{row.original.database}</span>
            )}
          </span>
        ),
      },
      {
        id: 'purposes',
        header: t('columns.purposes'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <PurposeBadges purposes={row.original.purposes} readOnly={row.original.readOnly} />
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <ConnectionStatus connection={row.original} />,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { className: 'w-10 text-right', headerClassName: 'w-10' },
        cell: ({ row }) => (
          // The menu opens in a portal, but React events still bubble through it to the row, which would open the
          // connection: stop them here.
          <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
            <MoreMenu
              label={t('actions.more', { name: row.original.name })}
              placement="below"
              alignment="end"
              items={[
                ...(canManage
                  ? [
                      {
                        label: t('actions.test'),
                        icon: PlugZapIcon,
                        onClick: () => test.mutate(row.original),
                      },
                    ]
                  : []),
                {
                  label: t('actions.catalog'),
                  icon: TableIcon,
                  onClick: () => setParam('catalog', row.original.id),
                },
                ...(canManage
                  ? [
                      {
                        label: t('actions.edit'),
                        icon: PencilIcon,
                        onClick: () => setParam('edit', row.original.id),
                      },
                      { type: 'divider' as const },
                      {
                        label: t('actions.delete'),
                        icon: Trash2Icon,
                        variant: 'destructive' as const,
                        onClick: () => setDeleting(row.original),
                      },
                    ]
                  : []),
              ]}
            />
          </span>
        ),
      },
    ],
    // `setParam` and the mutations are stable enough for menu callbacks; the columns depend on labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc, canManage],
  );

  if (!canRead || (error instanceof ApiError && error.status === 403)) {
    return (
      <>
        <PageHeader title={t('title')} description={t('description')} />
        <EmptyState
          icon={<LockIcon />}
          title={t('forbidden.title')}
          description={t('forbidden.description')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManage && (
            <Button
              label={t('add')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setParam('create', '1')}
            />
          )
        }
      />
      <DataTable
        label={t('title')}
        columns={columns}
        data={page}
        total={rows.length}
        page={state.page}
        pageSize={state.pageSize}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
        getRowId={(c) => c.id}
        onRowClick={(c) => setParam(canManage ? 'edit' : 'catalog', c.id)}
        onPageChange={(p) => set({ page: p })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        toolbar={
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('search')}
            className="sm:w-72"
          />
        }
        empty={
          needle ? (
            <EmptyState icon={<SearchXIcon />} title={t('noMatch', { q: state.q ?? '' })} />
          ) : (
            <EmptyState
              icon={<DatabaseIcon />}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                canManage && (
                  <Button
                    label={t('add')}
                    variant="secondary"
                    icon={<Icon icon={PlusIcon} />}
                    onClick={() => setParam('create', '1')}
                  />
                )
              }
            />
          )
        }
      />
      <ConnectionFormSheet
        open={createOpen || Boolean(editing)}
        connection={editing ?? undefined}
        onOpenChange={(open) => !open && setParam('create', null)}
      />
      <CatalogSheet connection={browsing} onOpenChange={(open) => !open && setParam('catalog', null)} />
      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('delete.title', { name: deleting?.name ?? '' })}
        description={t('delete.description')}
        actionLabel={t('delete.confirm')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}
