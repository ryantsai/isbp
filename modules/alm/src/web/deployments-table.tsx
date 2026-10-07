'use client';

import type { Page } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import type { ColumnDef } from '@tanstack/react-table';
import { BotIcon, HistoryIcon, ShieldAlertIcon, TriangleAlertIcon, UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { DEPLOYMENT_STATUSES, type Deployment, type Environment } from '../contracts';
import { DeploymentStatusText, ENV_ICON, TONE } from './badges';
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
  const { data, isLoading, isFetching } = useApiQuery<Page<Deployment>>('/alm/deployments', {
    application,
    release,
    environment: envFilter,
    status: statusFilter,
    sort: state.sort ?? '-startedAt',
    page: state.page,
    pageSize: state.pageSize,
  });

  const columns = useMemo<ColumnDef<Deployment, unknown>[]>(
    () => [
      {
        id: 'environment',
        header: t('fields.environment'),
        meta: { className: 'max-w-40' },
        cell: ({ row }) => {
          const Icon = ENV_ICON[row.original.environment.kind];
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
            <Link
              href={releaseHref(row.original.application.code, row.original.version)}
              className="hover:underline focus-visible:underline focus-visible:outline-none"
            >
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
              <span
                className={cn(
                  'inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
                  TONE.destructive,
                )}
                title={row.original.overrideReason}
              >
                <ShieldAlertIcon className="size-3" aria-hidden />
                {t('deployments.overridden')}
              </span>
            )}
            {row.original.policyWarning && (
              <span
                className={cn(
                  'inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
                  TONE.warning,
                )}
              >
                <TriangleAlertIcon className="size-3" aria-hidden />
                {t('deployments.outsideWindow')}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'actor',
        header: t('fields.actor'),
        meta: { className: 'hidden max-w-44 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => {
          const Icon = row.original.source === 'api' ? BotIcon : UserIcon;
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{row.original.actor.name}</span>
              <span className="sr-only">({t(`source.${row.original.source}`)})</span>
            </span>
          );
        },
      },
      {
        id: 'change',
        header: t('fields.change'),
        meta: {
          className: 'hidden font-mono text-xs lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => {
          const c = row.original.change;
          if (!c) return <span className="text-muted-foreground">—</span>;
          return c.id ? (
            <Link
              href={`/itsm/tickets/${c.reference}`}
              className="text-primary hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {c.reference}
            </Link>
          ) : (
            c.reference
          );
        },
      },
      {
        id: 'startedAt',
        header: t('fields.started'),
        meta: { sortKey: 'startedAt', className: 'whitespace-nowrap text-xs' },
        cell: ({ row }) => (
          <span className="flex flex-col">
            <RelativeTime date={row.original.startedAt} />
            <DateTime date={row.original.startedAt} className="hidden text-muted-foreground xl:inline" />
          </span>
        ),
      },
      {
        id: 'duration',
        header: t('fields.duration'),
        meta: {
          className: 'hidden text-xs tabular-nums sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
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
      getRowId={(d) => d.id}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <Select value={envFilter ?? ALL} onValueChange={(v) => set({ env: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-full sm:w-48" aria-label={t('fields.environment')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('deployments.allEnvironments')}</SelectItem>
              {environments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter ?? ALL}
            onValueChange={(v) => set({ status: v === ALL ? undefined : v })}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label={t('fields.status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('deployments.allStatuses')}</SelectItem>
              <SelectItem value="failed,rolled_back">{t('deployments.failures')}</SelectItem>
              {DEPLOYMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`deploymentStatus.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => set({ env: undefined, status: undefined })}>
              {tc('clearFilters')}
            </Button>
          )}
        </>
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
