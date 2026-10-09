'use client';

import type { Group } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { LockIcon, PlusIcon, SearchXIcon, UsersRoundIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { SourceBadge } from '@/components/status-badge';
import { useApiQuery } from '@/lib/api';
import { GroupFormDialog } from './group-form';

const ALL = '__all__';
const SOURCES = ['local', 'ldap', 'oidc', 'saml', 'system'] as const;

export function SystemBadge() {
  const t = useTranslations('groups');
  return (
    <Badge variant="muted">
      <LockIcon aria-hidden />
      {t('systemBadge')}
    </Badge>
  );
}

export function GroupsView() {
  const t = useTranslations('groups');
  const tc = useTranslations('common');
  const router = useRouter();
  const sp = useSearchParams();
  const [state, set] = useListState({ pageSize: 25 });
  const canCreate = useCan('core.groups.manage');
  const query = {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    source: state.source as string | undefined,
  };
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Group>>('/groups', query);
  const filtered = Boolean(state.q || state.source);

  const columns = useMemo<DataTableColumn<Group>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.name'),
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <Link
            href={`/admin/groups/${row.original.id}`}
            className="flex items-center gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
              aria-hidden
            >
              <UsersRoundIcon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium hover:underline">{row.original.name}</span>
                {row.original.isSystem && <SystemBadge />}
              </span>
              <code className="block truncate font-mono text-xs text-muted-foreground">
                {row.original.key}
              </code>
            </span>
          </Link>
        ),
      },
      {
        id: 'description',
        header: t('columns.description'),
        meta: {
          className: 'hidden text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) =>
          row.original.description ? (
            <span className="block max-w-xs truncate xl:max-w-md" title={row.original.description}>
              {row.original.description}
            </span>
          ) : (
            '—'
          ),
      },
      {
        id: 'source',
        header: t('columns.source'),
        meta: {
          sortKey: 'source',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <SourceBadge source={row.original.source} />,
      },
      {
        id: 'members',
        header: t('columns.members'),
        meta: { className: 'text-right tabular-nums', headerClassName: 'text-right' },
        cell: ({ row }) => row.original.memberCount.toLocaleString(),
      },
      {
        id: 'roles',
        header: t('columns.roles'),
        meta: {
          className: 'hidden text-right tabular-nums md:table-cell',
          headerClassName: 'hidden text-right md:table-cell',
        },
        cell: ({ row }) => (
          <span className={row.original.roleCount ? undefined : 'text-muted-foreground'}>
            {row.original.roleCount}
          </span>
        ),
      },
    ],
    [t],
  );

  const createOpen = sp.get('create') === '1';
  const setCreateOpen = (open: boolean) => {
    const next = new URLSearchParams(sp.toString());
    if (open) next.set('create', '1');
    else next.delete('create');
    router.replace(`/admin/groups${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  const empty =
    filtered || !canCreate ? (
      <EmptyState
        icon={<SearchXIcon />}
        title={t('empty.title')}
        description={filtered ? t('empty.description') : undefined}
      />
    ) : (
      <EmptyState
        icon={<UsersRoundIcon />}
        title={t('empty.firstTitle')}
        description={t('empty.firstDescription')}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon /> {t('add')}
          </Button>
        }
      />
    );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon /> {t('add')}
            </Button>
          )
        }
      />
      <DataTable
        label={t('title')}
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
        onRowClick={(g) => router.push(`/admin/groups/${g.id}`)}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <>
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('searchPlaceholder')}
              clearLabel={t('clearSearch')}
              className="sm:w-80"
            />
            <Select
              value={(state.source as string) ?? ALL}
              onValueChange={(v) => set({ source: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label={t('filters.source')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.allSources')}</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {tc(`source_values.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => set({ q: undefined, source: undefined })}>
                {tc('clearFilters')}
              </Button>
            )}
          </>
        }
        empty={empty}
      />
      {canCreate && <GroupFormDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}
