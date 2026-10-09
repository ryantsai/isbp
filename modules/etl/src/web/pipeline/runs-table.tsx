'use client';

import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { problemOf, useRunProblemText } from '@isbp/ui/run-detail';
import { HistoryIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { RunDto } from '../../contracts';
import { cn } from '@isbp/ui';
import { RunStatusBadge, TONE } from '../badges';
import { runHref, useDuration } from '../lib';

/** Runs of a pipeline, newest first; polls while one is queued or running. */
export function RunsTable({
  pipelineId,
  pageSize = 10,
  status,
}: {
  pipelineId: string;
  pageSize?: number;
  /** Only runs with this status (the "Failed" tile links to them). */
  status?: string;
}) {
  const t = useTranslations('etl');
  const format = useFormatter();
  const duration = useDuration();
  const router = useRouter();
  const problemText = useRunProblemText();
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<RunDto>>(
    `/etl/pipelines/${pipelineId}/runs`,
    { page, pageSize, status },
    { refetchInterval: live ? 2_000 : undefined },
  );
  const active = Boolean(data?.items.some((r) => r.status === 'queued' || r.status === 'running'));
  useEffect(() => setLive(active), [active]);

  const columns = useMemo<DataTableColumn<RunDto>[]>(
    () => [
      {
        id: 'when',
        header: t('runs.when'),
        cell: ({ row }) => (
          <Link
            href={runHref(pipelineId, row.original.id)}
            onClick={(e) => e.stopPropagation()}
            className="outline-none hover:underline focus-visible:underline"
          >
            <RelativeTime date={row.original.startedAt ?? row.original.createdAt} />
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        cell: ({ row }) => <RunStatusBadge status={row.original.status} />,
      },
      {
        id: 'trigger',
        header: t('runs.trigger'),
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.trigger === 'manual' && row.original.triggeredBy
            ? t('runs.manualBy', { name: row.original.triggeredBy.name })
            : t(`runTrigger.${row.original.trigger}`),
      },
      {
        id: 'rows',
        header: t('runs.rows'),
        meta: { className: 'tabular-nums', priority: 2 },
        cell: ({ row }) => (
          <span className="text-xs">
            {t('runs.rowCounts', {
              read: format.number(row.original.rowsRead),
              written: format.number(row.original.rowsWritten),
            })}
            {row.original.rowsRejected > 0 && (
              <span className={cn('ml-1 rounded px-1', TONE.warning)}>
                {t('runs.rejected', { n: format.number(row.original.rowsRejected) })}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'duration',
        header: t('runs.duration'),
        meta: { className: 'tabular-nums', priority: 3 },
        cell: ({ row }) => duration(row.original.durationMs),
      },
      {
        id: 'error',
        header: t('runs.error'),
        meta: { className: 'max-w-72 text-xs', priority: 2 },
        cell: ({ row }) => {
          const p =
            row.original.status === 'failed' ? problemOf(row.original.problem, row.original.error) : null;
          return p ? <span className="line-clamp-2">{problemText(p).title}</span> : '—';
        },
      },
    ],
    [t, format, duration, pipelineId, problemText],
  );

  return (
    <DataTable
      label={t('runs.title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={page}
      pageSize={pageSize}
      loading={isLoading}
      fetching={isFetching}
      error={error}
      onRetry={() => refetch()}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(runHref(pipelineId, r.id))}
      onPageChange={setPage}
      empty={<EmptyState icon={<HistoryIcon />} title={t('runs.empty')} description={t('runs.emptyHint')} />}
    />
  );
}
