'use client';

import type { UserSummary } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import type { ColumnDef } from '@tanstack/react-table';
import { SearchXIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { AttributeFilters } from '@/components/fields/attribute-filters';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { RelativeTime } from '@/components/relative-time';
import { SourceBadge, UserStatusBadge } from '@/components/status-badge';
import { useApiQuery } from '@/lib/api';
import { UserFormSheet } from './user-form';

const ALL = '__all__';

export function UsersView() {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const router = useRouter();
  const sp = useSearchParams();
  const [state, set] = useListState({ pageSize: 25 });
  const canCreate = useCan('core.users.create');
  // Custom-field filters are repeatable (`attr=key:value`), so they are read from the URL directly.
  const attr = sp.getAll('attr');
  const setAttr = (pairs: string[]) => {
    const next = new URLSearchParams(sp.toString());
    next.delete('attr');
    next.delete('page');
    pairs.forEach((p) => next.append('attr', p));
    router.replace(`/admin/users${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  const query = {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    status: state.status as string | undefined,
    authSource: state.authSource as string | undefined,
    departmentId: state.departmentId as string | undefined,
    subtree: state.departmentId ? (state.subtree as string | undefined) : undefined,
    attr,
  };
  const { data, isLoading, isFetching } = useApiQuery<Page<UserSummary>>('/users', query);
  const filtered = Boolean(state.q || state.status || state.authSource || state.departmentId || attr.length);

  const columns = useMemo<ColumnDef<UserSummary, unknown>[]>(
    () => [
      {
        id: 'person',
        header: t('columns.person'),
        meta: { sortKey: 'displayName' },
        cell: ({ row }) => (
          <Link
            href={`/admin/users/${row.original.id}`}
            className="flex items-center gap-3 outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <UserAvatar name={row.original.displayName} src={row.original.avatarUrl} />
            <div className="min-w-0">
              <div className="truncate font-medium hover:underline">{row.original.displayName}</div>
              <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
            </div>
          </Link>
        ),
      },
      {
        id: 'department',
        header: t('columns.department'),
        meta: { sortKey: 'department', className: 'text-muted-foreground' },
        cell: ({ row }) => row.original.department?.name ?? '—',
      },
      {
        id: 'jobTitle',
        header: t('columns.jobTitle'),
        meta: {
          className: 'hidden max-w-56 truncate text-muted-foreground xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => row.original.jobTitle ?? '—',
      },
      {
        id: 'status',
        header: t('columns.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <UserStatusBadge status={row.original.status} />,
      },
      {
        id: 'source',
        header: t('columns.source'),
        cell: ({ row }) => <SourceBadge source={row.original.authSource} />,
      },
      {
        id: 'lastLogin',
        header: t('columns.lastLogin'),
        meta: { sortKey: 'lastLoginAt', className: 'text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.lastLoginAt} />,
      },
    ],
    [t],
  );

  const createOpen = sp.get('create') === '1';
  const setCreateOpen = (open: boolean) => {
    const next = new URLSearchParams(sp.toString());
    if (open) next.set('create', '1');
    else next.delete('create');
    router.replace(`/admin/users${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlusIcon /> {t('add')}
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
        getRowId={(u) => u.id}
        onRowClick={(u) => router.push(`/admin/users/${u.id}`)}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <>
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('searchPlaceholder')}
              className="sm:w-80"
            />
            <Select
              value={(state.status as string) ?? ALL}
              onValueChange={(v) => set({ status: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="w-40" aria-label={t('filters.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
                {(['active', 'pending', 'suspended', 'offboarded'] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {tc(`status_values.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={(state.authSource as string) ?? ALL}
              onValueChange={(v) => set({ authSource: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="w-40" aria-label={t('filters.source')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.allSources')}</SelectItem>
                {(['local', 'oidc', 'saml', 'ldap'] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {tc(`source_values.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DepartmentSelect
              value={(state.departmentId as string) ?? null}
              onChange={(departmentId) =>
                set({ departmentId: departmentId ?? undefined, subtree: undefined })
              }
              noneLabel={t('filters.allDepartments')}
              className="w-52"
              aria-label={t('filters.department')}
            />
            <AttributeFilters entityType="core.user" value={attr} onChange={setAttr} />
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = new URLSearchParams(sp.toString());
                  ['q', 'status', 'authSource', 'departmentId', 'subtree', 'attr', 'page'].forEach((k) =>
                    next.delete(k),
                  );
                  router.replace(`/admin/users${next.size ? `?${next}` : ''}`, { scroll: false });
                }}
              >
                {tc('clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={<SearchXIcon />}
            title={t('empty.title')}
            description={filtered ? t('empty.description') : undefined}
          />
        }
      />
      {canCreate && <UserFormSheet open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}
