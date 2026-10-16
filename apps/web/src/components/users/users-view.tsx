'use client';

import type { UserSummary } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable, type DataTableColumn, DataTableSummary, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar } from '@isbp/ui/filter-bar';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { SearchXIcon, UserPlusIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { AttributeFilters } from '@/components/fields/attribute-filters';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { useDepartments } from '@/components/pickers/use-departments';
import { RelativeTime } from '@/components/relative-time';
import { SourceBadge, UserStatusBadge } from '@/components/status-badge';
import { useApiQuery } from '@/lib/api';
import { UserFormSheet } from './user-form';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';

const ALL = '__all__';
const STATUSES = ['active', 'pending', 'suspended', 'offboarded'] as const;
const SOURCES = ['local', 'oidc', 'saml', 'ldap'] as const;

/** These parameters only change client-owned filters/forms; no server navigation is needed. */
function replaceQuery(next: URLSearchParams) {
  const href = `/admin/users${next.size ? `?${next}` : ''}`;
  if (href !== window.location.pathname + window.location.search) window.history.replaceState(null, '', href);
}

export function UsersView() {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const router = useRouter();
  const sp = useSearchParams();
  const [state, set] = useListState({ pageSize: 25 });
  const canCreate = useCan('core.users.create');
  const { byId: departments } = useDepartments();
  // Custom-field filters are repeatable (`attr=key:value`), so they are read from the URL directly.
  const attr = sp.getAll('attr');
  const setAttr = (pairs: string[]) => {
    const next = new URLSearchParams(window.location.search);
    next.delete('attr');
    next.delete('page');
    pairs.forEach((p) => next.append('attr', p));
    replaceQuery(next);
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
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<UserSummary>>('/users', query);
  const filtered = Boolean(state.q || state.status || state.authSource || state.departmentId || attr.length);

  const columns = useMemo<DataTableColumn<UserSummary>[]>(
    () => [
      {
        id: 'person',
        header: t('columns.person'),
        meta: { sortKey: 'displayName', wrap: true },
        cell: ({ row }) => (
          <HStack gap={3} vAlign="center">
            <UserAvatar name={row.original.displayName} src={row.original.avatarUrl} />
            <StackItem size="fill">
              <VStack>
                <Link
                  href={`/admin/users/${row.original.id}`}
                  color="primary"
                  weight="medium"
                  maxLines={1}
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.original.displayName}
                </Link>
                <Text type="supporting" maxLines={1}>
                  {row.original.email}
                </Text>
                <DataTableSummary>{row.original.department?.name}</DataTableSummary>
              </VStack>
            </StackItem>
          </HStack>
        ),
      },
      {
        id: 'department',
        header: t('columns.department'),
        meta: { sortKey: 'department', priority: 2, className: 'text-muted-foreground' },
        cell: ({ row }) => row.original.department?.name ?? '—',
      },
      {
        id: 'jobTitle',
        header: t('columns.jobTitle'),
        meta: {
          priority: 3,
          className: 'max-w-56 truncate text-muted-foreground',
        },
        cell: ({ row }) => row.original.jobTitle ?? '—',
      },
      {
        id: 'status',
        header: t('columns.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <UserStatusBadge status={row.original.status} quiet />,
      },
      {
        id: 'source',
        header: t('columns.source'),
        meta: { priority: 3 },
        cell: ({ row }) => <SourceBadge source={row.original.authSource} />,
      },
      {
        id: 'lastLogin',
        header: t('columns.lastLogin'),
        meta: { sortKey: 'lastLoginAt', priority: 3, className: 'text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.lastLoginAt} />,
      },
    ],
    [t],
  );

  const createOpen = sp.get('create') === '1';
  const setCreateOpen = (open: boolean) => {
    const next = new URLSearchParams(window.location.search);
    if (open) next.set('create', '1');
    else next.delete('create');
    replaceQuery(next);
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate && (
            <Button
              label={t('add')}
              variant="primary"
              icon={<Icon icon={UserPlusIcon} />}
              onClick={() => setCreateOpen(true)}
            />
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
        getRowId={(u) => u.id}
        onRowClick={(u) => router.push(`/admin/users/${u.id}`)}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <FilterBar
            search={
              <SearchInput
                value={state.q ?? ''}
                onChange={(q) => set({ q })}
                placeholder={t('searchPlaceholder')}
                className="sm:w-80"
              />
            }
            filters={[
              {
                id: 'status',
                label: t('filters.status'),
                primary: true,
                value: state.status ? tc(`status_values.${state.status}`) : undefined,
                onClear: () => set({ status: undefined }),
                control: (
                  <Selector
                    label={t('filters.status')}
                    isLabelHidden
                    width={160}
                    value={(state.status as string) ?? ALL}
                    onChange={(v) => set({ status: v === ALL ? undefined : v })}
                    options={[
                      { value: ALL, label: t('filters.allStatuses') },
                      ...STATUSES.map((s) => ({ value: s, label: tc(`status_values.${s}`) })),
                    ]}
                  />
                ),
              },
              {
                id: 'source',
                label: t('filters.source'),
                primary: true,
                value: state.authSource ? tc(`source_values.${state.authSource}`) : undefined,
                onClear: () => set({ authSource: undefined }),
                control: (
                  <Selector
                    label={t('filters.source')}
                    isLabelHidden
                    width={160}
                    value={(state.authSource as string) ?? ALL}
                    onChange={(v) => set({ authSource: v === ALL ? undefined : v })}
                    options={[
                      { value: ALL, label: t('filters.allSources') },
                      ...SOURCES.map((s) => ({ value: s, label: tc(`source_values.${s}`) })),
                    ]}
                  />
                ),
              },
              {
                id: 'department',
                label: t('filters.department'),
                value: state.departmentId
                  ? (departments.get(String(state.departmentId))?.name ?? t('filters.department'))
                  : undefined,
                onClear: () => set({ departmentId: undefined, subtree: undefined }),
                control: (
                  <DepartmentSelect
                    value={(state.departmentId as string) ?? null}
                    onChange={(departmentId) =>
                      set({ departmentId: departmentId ?? undefined, subtree: undefined })
                    }
                    noneLabel={t('filters.allDepartments')}
                    aria-label={t('filters.department')}
                  />
                ),
              },
            ]}
            actions={<AttributeFilters entityType="core.user" value={attr} onChange={setAttr} />}
            onClearAll={
              filtered
                ? () => {
                    const next = new URLSearchParams(window.location.search);
                    ['q', 'status', 'authSource', 'departmentId', 'subtree', 'attr', 'page'].forEach((k) =>
                      next.delete(k),
                    );
                    replaceQuery(next);
                  }
                : undefined
            }
          />
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
