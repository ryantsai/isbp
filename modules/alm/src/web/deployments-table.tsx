'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { BotIcon, HistoryIcon, ShieldAlertIcon, TriangleAlertIcon, UserIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { DEPLOYMENT_STATUSES, type Deployment, type Environment } from '../contracts';
import { DeploymentStatusText, ENV_ICON } from './badges';
import { releaseHref, useDuration } from './lib';

const ALL = '__all__';

/** Deployment history (server-paged, filters in the URL). */
export function DeploymentsTable({
  application,
  release,
  environments,
}: {
  /** Application code. */
  application: string;
  release?: string;
  environments: Environment[];
}) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const duration = useDuration();
  const [state, set] = useListState({ pageSize: 25 });
  const envFilter = (state.env as string | undefined) || undefined;
  const statusFilter = (state.status as string | undefined) || undefined;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Deployment>>('/alm/deployments', {
    application,
    release,
    environment: envFilter,
    status: statusFilter,
    sort: state.sort ?? '-startedAt',
    page: state.page,
    pageSize: state.pageSize,
  });

  const columns = useMemo<DataTableColumn<Deployment>[]>(
    () => [
      {
        id: 'environment',
        header: t('fields.environment'),
        meta: { className: 'max-w-40' },
        cell: ({ row }) => {
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon icon={ENV_ICON[row.original.environment.kind]} size="xsm" color="secondary" />
              <span className="truncate">{row.original.environment.name}</span>
            </span>
          );
        },
      },
      {
        id: 'version',
        header: t('fields.version'),
        meta: { sortKey: 'version', className: 'font-mono text-xs' },
        cell: ({ row }) =>
          row.original.release ? (
            <Link href={releaseHref(row.original.application.code, row.original.version)}>
              {row.original.version}
            </Link>
          ) : (
            row.original.version
          ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => (
          <span className="flex flex-col gap-1">
            <DeploymentStatusText status={row.original.status} className="text-xs" />
            {row.original.overrideReason && (
              <Tooltip content={row.original.overrideReason}>
                <span className="w-fit">
                  <Badge
                    variant="error"
                    label={t('deployments.overridden')}
                    icon={<Icon icon={ShieldAlertIcon} size="xsm" />}
                  />
                </span>
              </Tooltip>
            )}
            {row.original.policyWarning && (
              <span className="w-fit">
                <Badge
                  variant="warning"
                  label={t('deployments.outsideWindow')}
                  icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                />
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'actor',
        header: t('fields.actor'),
        meta: { className: 'max-w-44', priority: 3 },
        cell: ({ row }) => {
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon icon={row.original.source === 'api' ? BotIcon : UserIcon} size="xsm" color="secondary" />
              <span className="truncate">{row.original.actor.name}</span>
              <span className="sr-only">({t(`source.${row.original.source}`)})</span>
            </span>
          );
        },
      },
      {
        id: 'change',
        header: t('fields.change'),
        meta: { className: 'font-mono text-xs', priority: 2 },
        cell: ({ row }) => {
          const c = row.original.change;
          if (!c) return <span className="text-muted-foreground">—</span>;
          return c.id ? <Link href={`/itsm/tickets/${c.reference}`}>{c.reference}</Link> : c.reference;
        },
      },
      {
        id: 'startedAt',
        header: t('fields.started'),
        meta: { sortKey: 'startedAt', className: 'whitespace-nowrap text-xs' },
        cell: ({ row }) => (
          <span className="flex flex-col">
            <RelativeTime date={row.original.startedAt} />
          </span>
        ),
      },
      {
        id: 'duration',
        header: t('fields.duration'),
        meta: { className: 'text-xs tabular-nums', priority: 3 },
        cell: ({ row }) =>
          row.original.status === 'in_progress' ? (
            <span className="text-muted-foreground">{t('deployments.running')}</span>
          ) : (
            duration(row.original.durationSeconds)
          ),
      },
    ],
    [t, duration],
  );

  const filtered = Boolean(envFilter || statusFilter);
  return (
    <DataTable
      label={t('deployments.label')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort ?? '-startedAt'}
      loading={isLoading}
      fetching={isFetching}
      error={error}
      onRetry={() => refetch()}
      getRowId={(d) => d.id}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        // Nothing deployed yet: no filters to offer.
        !filtered && data && data.total === 0 ? undefined : (
          <>
            <Selector
              label={t('fields.environment')}
              isLabelHidden
              width={192}
              value={envFilter ?? ALL}
              onChange={(v) => set({ env: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('deployments.allEnvironments') },
                ...environments.map((e) => ({ value: e.id, label: e.name })),
              ]}
            />
            <Selector
              label={t('fields.status')}
              isLabelHidden
              width={176}
              value={statusFilter ?? ALL}
              onChange={(v) => set({ status: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('deployments.allStatuses') },
                { value: 'failed,rolled_back', label: t('deployments.failures') },
                ...DEPLOYMENT_STATUSES.map((st) => ({ value: st, label: t(`deploymentStatus.${st}`) })),
              ]}
            />
            {filtered && (
              <Button
                label={tc('clearFilters')}
                variant="ghost"
                size="sm"
                onClick={() => set({ env: undefined, status: undefined })}
              />
            )}
          </>
        )
      }
      empty={
        <EmptyState
          icon={<HistoryIcon />}
          title={t('deployments.empty')}
          description={filtered ? t('deployments.emptyFiltered') : t('deployments.emptyHint')}
        />
      }
    />
  );
}
