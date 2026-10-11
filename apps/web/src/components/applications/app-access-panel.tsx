'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type { Application, Role, RoleAssignment } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { SearchInput } from '@isbp/ui/search-input';
import { toast } from '@isbp/ui/toast';
import {
  HandIcon,
  type LucideIcon,
  RefreshCwIcon,
  SearchXIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  UserCogIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RelativeTime } from '@/components/relative-time';
import { ExpiryCell, PrincipalCell, ScopeBadge } from '@/components/roles/assignment-parts';
import { useAccessErrorText } from '@/components/roles/role-utils';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { AppGrantDialog } from './app-grant-dialog';
import { APP_INVALIDATE } from './app-parts';

const ALL = '__all__';

const SOURCE_ICON: Record<string, LucideIcon> = {
  request: HandIcon,
  manual: UserCogIcon,
  sync: RefreshCwIcon,
};

/** How the grant was made: a request, by an administrator, or by directory sync — icon + text. */
export function GrantSourceBadge({ source }: { source: string }) {
  const tc = useTranslations('common.source_values');
  const icon = SOURCE_ICON[source];
  return (
    <Badge
      variant={source === 'request' ? 'info' : 'neutral'}
      label={tc.has(source) ? tc(source) : source}
      icon={icon ? <Icon icon={icon} size="xsm" /> : undefined}
    />
  );
}

/** People with access: every grant of the app's roles (server-paged), filterable by role. */
export function AppAccessPanel({ app }: { app: Application }) {
  const t = useTranslations('applications.access');
  const tr = useTranslations('roles.assignments');
  const tc = useTranslations('common');
  const canManage = useCan('core.applications.manage', { recordType: 'application', recordId: app.id });
  const [state, set] = useListState({ pageSize: 25 });
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<RoleAssignment | null>(null);
  const roleId = state.roleId as string | undefined;

  const roles = useApiQuery<{ items: Role[] }>(`/applications/${app.id}/roles`);
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<RoleAssignment>>(
    `/applications/${app.id}/assignments`,
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort ?? '-grantedAt',
      q: state.q,
      roleId,
    },
  );
  const filtered = Boolean(state.q || roleId);

  const columns = useMemo<DataTableColumn<RoleAssignment>[]>(
    () => [
      {
        id: 'principal',
        header: tr('columns.principal'),
        cell: ({ row }) => <PrincipalCell principal={row.original.principal} />,
      },
      {
        id: 'role',
        header: tr('columns.role'),
        meta: { sortKey: 'role' },
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block font-medium whitespace-nowrap">{row.original.role.name}</span>
            <code className="block font-mono text-xs text-muted-foreground">{row.original.role.key}</code>
          </span>
        ),
      },
      {
        id: 'scope',
        header: tr('columns.scope'),
        meta: { className: 'max-w-56' },
        cell: ({ row }) => <ScopeBadge assignment={row.original} />,
      },
      {
        id: 'expires',
        header: tr('columns.expires'),
        meta: { sortKey: 'expiresAt', className: 'whitespace-nowrap' },
        cell: ({ row }) => <ExpiryCell expiresAt={row.original.expiresAt} expired={row.original.expired} />,
      },
      {
        id: 'source',
        header: t('columns.source'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <GrantSourceBadge source={row.original.source} />,
      },
      {
        id: 'grantedBy',
        header: t('columns.granted'),
        meta: {
          sortKey: 'grantedAt',
          className: 'hidden text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => {
          const a = row.original;
          return (
            <span className="block min-w-0" title={a.reason ?? undefined}>
              <span className="block whitespace-nowrap">
                {a.grantedBy ? (
                  <Link href={`/admin/users/${a.grantedBy.id}`} className="text-foreground hover:underline">
                    {a.grantedBy.displayName}
                  </Link>
                ) : (
                  tc('system')
                )}
                {' · '}
                <RelativeTime date={a.grantedAt} />
              </span>
              {a.reason && <span className="block max-w-64 truncate text-xs">{a.reason}</span>}
            </span>
          );
        },
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{tc('actions')}</span>,
              size: 48,
              meta: { className: 'text-right' },
              cell: ({ row }) => {
                const a = row.original;
                return (
                  <Tooltip content={tr('revoke')}>
                    <IconButton
                      label={tr('revokeLabel', { role: a.role.name, name: a.principal.name })}
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={ShieldOffIcon} />}
                      onClick={() => setRevoking(a)}
                    />
                  </Tooltip>
                );
              },
            } satisfies DataTableColumn<RoleAssignment>,
          ]
        : []),
    ],
    [t, tr, tc, canManage],
  );

  const allRoles = roles.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <UsersIcon className="size-4 shrink-0" aria-hidden />
          {t('summary', { members: app.counts.members, grants: data?.total ?? 0 })}
        </p>
        {canManage && (
          <Button
            label={t('grant')}
            variant="primary"
            icon={<Icon icon={ShieldCheckIcon} />}
            onClick={() => setGranting(true)}
            className="shrink-0"
          />
        )}
      </div>
      <DataTable
        label={t('label', { app: app.name })}
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
        getRowId={(a) => a.id}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <>
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={tr('searchPlaceholder')}
              className="sm:w-72"
            />
            <Selector
              label={tr('filters.role')}
              isLabelHidden
              width={208}
              value={roleId ?? ALL}
              onChange={(v) => set({ roleId: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: tr('filters.allRoles') },
                ...(allRoles.length > 0 ? [{ type: 'divider' as const }] : []),
                ...allRoles.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
            {filtered && (
              <Button
                label={tc('clearFilters')}
                variant="ghost"
                size="sm"
                onClick={() => set({ q: undefined, roleId: undefined })}
              />
            )}
          </>
        }
        empty={
          <EmptyState
            icon={<SearchXIcon />}
            title={filtered ? tr('empty.filtered') : t('empty.title')}
            description={filtered ? tr('empty.filteredHint') : t('empty.description')}
            action={
              !filtered &&
              canManage && (
                <Button
                  label={t('grant')}
                  variant="secondary"
                  icon={<Icon icon={ShieldCheckIcon} />}
                  onClick={() => setGranting(true)}
                />
              )
            }
          />
        }
      />
      {canManage && (
        <>
          <AppGrantDialog app={app} open={granting} onOpenChange={setGranting} roleId={roleId} />
          <AppRevokeDialog app={app} assignment={revoking} onOpenChange={(o) => !o && setRevoking(null)} />
        </>
      )}
    </div>
  );
}

/** Confirm + `DELETE /applications/:id/assignments/:assignmentId`. */
function AppRevokeDialog({
  app,
  assignment,
  onOpenChange,
}: {
  app: Application;
  assignment: RoleAssignment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('roles.revoke');
  const accessError = useAccessErrorText();
  const [last, setLast] = useState(assignment);
  if (assignment && assignment !== last) setLast(assignment);
  const shown = assignment ?? last;
  const role = shown?.role.name ?? '';
  const name = shown?.principal.name ?? '';
  const m = useApiMutation((api, id: string) => api.delete(`/applications/${app.id}/assignments/${id}`), {
    invalidate: APP_INVALIDATE,
    success: t('done', { role, name }),
    onSuccess: () => onOpenChange(false),
    silent: true,
  });
  return (
    <ConfirmDialog
      open={assignment !== null}
      onOpenChange={onOpenChange}
      title={t('title', { role, name })}
      description={
        shown?.principal.type === 'group' ? t('bodyGroup', { role, name }) : t('body', { role, name })
      }
      confirmLabel={t('confirm')}
      destructive
      loading={m.isPending}
      onConfirm={() =>
        assignment && m.mutate(assignment.id, { onError: (err) => toast.error(accessError(err)) })
      }
    >
      {shown && shown.scopeType !== 'global' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('scope')} <ScopeBadge assignment={shown} />
        </div>
      )}
    </ConfirmDialog>
  );
}
