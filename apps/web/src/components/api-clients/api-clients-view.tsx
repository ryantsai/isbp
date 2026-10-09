'use client';

import type { ApiClient, CreatedSecret } from '@isbp/contracts';
import { ApiError, useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { GlobeIcon, LockIcon, PlugIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useNow, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { ClientFormDialog } from './client-form-dialog';
import { ClientStatusBadge, secretState } from './client-parts';
import { SecretRevealDialog } from './secret-reveal-dialog';

/** Applications a client can query: "All applications" or up to two names and "+N". */
export function ClientAppsCell({ client }: { client: ApiClient }) {
  const t = useTranslations('applications.clients');
  if (client.allApplications)
    return (
      <Badge variant="info">
        <GlobeIcon aria-hidden />
        {t('allApplications')}
      </Badge>
    );
  if (!client.applications.length)
    return <span className="text-muted-foreground">{t('noApplications')}</span>;
  const shown = client.applications.slice(0, 2);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((a) => (
        <Badge key={a.id} variant="outline" className="font-normal">
          {a.name}
        </Badge>
      ))}
      {client.applications.length > shown.length && (
        <span className="text-xs text-muted-foreground">+{client.applications.length - shown.length}</span>
      )}
    </span>
  );
}

/** `/admin/api-clients`: service principals for the Role Query API (client-side search over a small list). */
export function ApiClientsView() {
  const t = useTranslations('applications.clients');
  const router = useRouter();
  const sp = useSearchParams();
  const canManage = useCan('core.api-clients.manage');
  const now = useNow({ updateInterval: 60_000 });
  const [state, set] = useListState({ pageSize: 25 });
  const [created, setCreated] = useState<CreatedSecret | null>(null);
  const { data, isLoading, isFetching, refetch, error } = useApiQuery<{ items: ApiClient[] }>(
    canManage ? '/api-clients' : null,
  );

  const createOpen = canManage && sp.get('create') === '1';
  const setCreateOpen = (open: boolean) => {
    const next = new URLSearchParams(sp.toString());
    if (open) next.set('create', '1');
    else next.delete('create');
    router.replace(`/admin/api-clients${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  const needle = (state.q ?? '').trim().toLowerCase();
  const all = data?.items ?? [];
  const rows = all.filter(
    (c) =>
      !needle ||
      [c.name, c.clientId, c.description ?? '', ...c.applications.map((a) => a.name)].some((s) =>
        s.toLowerCase().includes(needle),
      ),
  );
  const page = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  const nowMs = now.getTime();

  const columns = useMemo<DataTableColumn<ApiClient>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.client'),
        cell: ({ row }) => (
          <Link
            href={`/admin/api-clients/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-lg ${row.original.revokedAt ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}
              aria-hidden
            >
              <PlugIcon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium hover:underline">{row.original.name}</span>
              <code className="block truncate font-mono text-xs text-muted-foreground">
                {row.original.clientId}
              </code>
            </span>
          </Link>
        ),
      },
      {
        id: 'applications',
        header: t('columns.applications'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <ClientAppsCell client={row.original} />,
      },
      {
        id: 'permissions',
        header: t('columns.permissions'),
        meta: {
          className: 'hidden text-right tabular-nums lg:table-cell',
          headerClassName: 'hidden text-right lg:table-cell',
        },
        cell: ({ row }) => (
          <span className={row.original.permissions.length ? undefined : 'text-muted-foreground'}>
            {row.original.permissions.length}
          </span>
        ),
      },
      {
        id: 'secrets',
        header: t('columns.secrets'),
        meta: {
          className: 'hidden text-right tabular-nums sm:table-cell',
          headerClassName: 'hidden text-right sm:table-cell',
        },
        cell: ({ row }) => {
          const n = row.original.secrets.filter((s) => secretState(s, nowMs) === 'active').length;
          return <span className={n ? undefined : 'text-muted-foreground'}>{n}</span>;
        },
      },
      {
        id: 'lastUsed',
        header: t('columns.lastUsed'),
        meta: {
          className: 'hidden whitespace-nowrap text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => (
          <span className="block">
            <RelativeTime date={row.original.lastUsedAt} />
            {row.original.lastUsedIp && (
              <code className="block font-mono text-xs">{row.original.lastUsedIp}</code>
            )}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <ClientStatusBadge client={row.original} />,
      },
    ],
    [t, nowMs],
  );

  if (!canManage || (error instanceof ApiError && error.status === 403)) {
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
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> {t('create')}
          </Button>
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
        onRowClick={(c) => router.push(`/admin/api-clients/${c.id}`)}
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
              icon={<PlugIcon />}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  <PlusIcon /> {t('create')}
                </Button>
              }
            />
          )
        }
      />
      <ClientFormDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setCreated} />
      <SecretRevealDialog
        created={created}
        onDone={() => {
          const id = created?.client.id;
          setCreated(null);
          if (id) router.push(`/admin/api-clients/${id}`);
        }}
      />
    </>
  );
}
