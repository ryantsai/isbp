'use client';

import type { DbTestResult } from '@isbp/contracts';
import { ApiError, useCan } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import type { ColumnDef } from '@tanstack/react-table';
import {
  DatabaseIcon,
  LockIcon,
  MoreHorizontalIcon,
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
import { toast } from 'sonner';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { CatalogSheet } from './catalog-sheet';
import { ConnectionFormSheet, DB_INVALIDATE } from './connection-form-sheet';
import { ConnectionStatus, type DbConnection, EngineBadge, PurposeBadges } from './parts';

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
  const { data, isLoading, isFetching, error } = useApiQuery<{ items: DbConnection[] }>(
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

  const columns = useMemo<ColumnDef<DbConnection, unknown>[]>(
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('actions.more', { name: row.original.name })}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {canManage && (
                <DropdownMenuItem onSelect={() => test.mutate(row.original)}>
                  <PlugZapIcon /> {t('actions.test')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setParam('catalog', row.original.id)}>
                <TableIcon /> {t('actions.catalog')}
              </DropdownMenuItem>
              {canManage && (
                <>
                  <DropdownMenuItem onSelect={() => setParam('edit', row.original.id)}>
                    <PencilIcon /> {t('actions.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row.original)}>
                    <Trash2Icon /> {t('actions.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
            <Button onClick={() => setParam('create', '1')}>
              <PlusIcon /> {t('add')}
            </Button>
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
                  <Button variant="outline" onClick={() => setParam('create', '1')}>
                    <PlusIcon /> {t('add')}
                  </Button>
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
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.title', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('delete.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting);
              }}
            >
              {t('delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
