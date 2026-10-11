'use client';

import type { Group } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { LockIcon, PlusIcon, SearchXIcon, UsersRoundIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { SourceBadge } from '@/components/status-badge';
import { useApiQuery } from '@/lib/api';
import { GroupFormDialog } from './group-form';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';

const ALL = '__all__';
const SOURCES = ['local', 'ldap', 'oidc', 'saml', 'system'] as const;

export function SystemBadge() {
  const t = useTranslations('groups');
  return <Badge variant="neutral" label={t('systemBadge')} icon={<Icon icon={LockIcon} size="xsm" />} />;
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
          <HStack gap={3} vAlign="center">
            <IconTile size="sm" aria-hidden>
              <UsersRoundIcon />
            </IconTile>
            <StackItem size="fill">
              <VStack hAlign="start">
                <HStack gap={2} vAlign="center">
                  <Link
                    href={`/admin/groups/${row.original.id}`}
                    color="primary"
                    weight="medium"
                    maxLines={1}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {row.original.name}
                  </Link>
                  {row.original.isSystem && <SystemBadge />}
                </HStack>
                <Code color="secondary">{row.original.key}</Code>
              </VStack>
            </StackItem>
          </HStack>
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
            <div className="max-w-xs xl:max-w-md">
              <Text maxLines={1}>{row.original.description}</Text>
            </div>
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
          <Button
            label={t('add')}
            variant="primary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setCreateOpen(true)}
          />
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
            <Button
              label={t('add')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
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
            <Selector
              label={t('filters.source')}
              isLabelHidden
              width={160}
              value={(state.source as string) ?? ALL}
              onChange={(v) => set({ source: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('filters.allSources') },
                ...SOURCES.map((s) => ({ value: s, label: tc(`source_values.${s}`) })),
              ]}
            />
            {filtered && (
              <Button
                label={tc('clearFilters')}
                variant="ghost"
                size="sm"
                onClick={() => set({ q: undefined, source: undefined })}
              />
            )}
          </>
        }
        empty={empty}
      />
      {canCreate && <GroupFormDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}
