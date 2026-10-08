'use client';

import type { Role, RoleAssignment } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { SearchInput } from '@isbp/ui/search-input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { Hint } from '@isbp/ui/tooltip';
import { SearchXIcon, ShieldOffIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { ExpiryCell, PrincipalCell, RevokeAssignmentDialog, ScopeBadge } from './assignment-parts';
import { useRoleText } from './role-utils';

const ALL = '__all__';

/** Assignments tab: every grant (server-paged), filterable by role and search, optionally incl. expired. */
export function AssignmentsTable() {
  const t = useTranslations('roles.assignments');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const roleText = useRoleText();
  const canAssign = useCan('core.roles.assign');
  const [state, set] = useListState({ pageSize: 25 });
  const [revoking, setRevoking] = useState<RoleAssignment | null>(null);
  const includeExpired = state.includeExpired === '1';
  const roleId = state.roleId as string | undefined;

  const roles = useApiQuery<{ items: Role[] }>('/roles');
  const { data, isLoading, isFetching } = useApiQuery<Page<RoleAssignment>>('/role-assignments', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    roleId,
    // The API coerces any string to `true`, so only send it when on.
    includeExpired: includeExpired ? true : undefined,
  });
  const filtered = Boolean(state.q || roleId || includeExpired);

  const columns = useMemo<DataTableColumn<RoleAssignment>[]>(
    () => [
      {
        id: 'principal',
        header: t('columns.principal'),
        cell: ({ row }) => <PrincipalCell principal={row.original.principal} />,
      },
      {
        id: 'role',
        header: t('columns.role'),
        meta: { sortKey: 'role' },
        cell: ({ row }) => (
          <Link
            href={`/admin/roles/${row.original.role.id}`}
            className="font-medium whitespace-nowrap hover:underline"
          >
            {roleText(row.original.role).name}
          </Link>
        ),
      },
      {
        id: 'scope',
        header: t('columns.scope'),
        meta: { className: 'max-w-56' },
        cell: ({ row }) => <ScopeBadge assignment={row.original} />,
      },
      {
        id: 'expires',
        header: t('columns.expires'),
        meta: { sortKey: 'expiresAt', className: 'whitespace-nowrap' },
        cell: ({ row }) => <ExpiryCell expiresAt={row.original.expiresAt} expired={row.original.expired} />,
      },
      {
        id: 'grantedBy',
        header: t('columns.grantedBy'),
        meta: {
          className: 'hidden text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => {
          const a = row.original;
          const source = tc.has(`source_values.${a.source}`) ? tc(`source_values.${a.source}`) : a.source;
          return (
            <span title={a.reason ?? undefined}>
              {a.grantedBy ? (
                <Link href={`/admin/users/${a.grantedBy.id}`} className="hover:underline">
                  {a.grantedBy.displayName}
                </Link>
              ) : (
                source
              )}
              {a.reason && <span className="block max-w-56 truncate text-xs">{a.reason}</span>}
            </span>
          );
        },
      },
      {
        id: 'grantedAt',
        header: t('columns.grantedAt'),
        meta: {
          sortKey: 'grantedAt',
          className: 'hidden whitespace-nowrap text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.grantedAt} />,
      },
      ...(canAssign
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{tc('actions')}</span>,
              size: 48,
              meta: { className: 'text-right' },
              cell: ({ row }) => {
                const a = row.original;
                const label = t('revokeLabel', { role: roleText(a.role).name, name: a.principal.name });
                return (
                  <Hint label={t('revoke')}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={label}
                      onClick={() => setRevoking(a)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <ShieldOffIcon />
                    </Button>
                  </Hint>
                );
              },
            } satisfies DataTableColumn<RoleAssignment>,
          ]
        : []),
    ],
    [t, tc, roleText, canAssign],
  );

  const allRoles = roles.data?.items ?? [];

  return (
    <>
      <DataTable
        label={t('label')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(a) => a.id}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <>
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('searchPlaceholder')}
              className="sm:w-72"
            />
            <Select value={roleId ?? ALL} onValueChange={(v) => set({ roleId: v === ALL ? undefined : v })}>
              <SelectTrigger className="w-52" aria-label={t('filters.role')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={ALL}>{t('filters.allRoles')}</SelectItem>
                <SelectSeparator />
                {[false, true].map((system) => {
                  const list = allRoles.filter((r) => r.isSystem === system);
                  if (!list.length) return null;
                  return (
                    <SelectGroup key={String(system)}>
                      <SelectLabel>{system ? tr('systemRoles') : tr('customRoles')}</SelectLabel>
                      {list.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {roleText(r).name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 px-1">
              <Switch
                id="assignments-expired"
                checked={includeExpired}
                onCheckedChange={(v) => set({ includeExpired: v ? '1' : undefined })}
              />
              <Label htmlFor="assignments-expired" className="font-normal">
                {t('filters.includeExpired')}
              </Label>
            </div>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => set({ q: undefined, roleId: undefined, includeExpired: undefined })}
              >
                {tc('clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={<SearchXIcon />}
            title={filtered ? t('empty.filtered') : t('empty.title')}
            description={filtered ? t('empty.filteredHint') : t('empty.description')}
          />
        }
      />
      <RevokeAssignmentDialog assignment={revoking} onOpenChange={(o) => !o && setRevoking(null)} />
    </>
  );
}
