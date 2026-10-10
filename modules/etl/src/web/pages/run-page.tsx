'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { RunCounts, RunLayout, RunLog, RunProblemBanner } from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { BanIcon, CalendarClockIcon, PlayIcon, WorkflowIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { RunDetail, RunDto } from '../../contracts';
import { RunStatusBadge } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, pipelineHref, runHref, useDuration } from '../lib';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

/**
 * One pipeline run, in the same layout as a scheduled job's run: why it failed in plain words (with the
 * connection to fix and "Run again"), the row counters, the log, and the details aside. Live while it runs.
 */
export default function RunPage({ params }: WebPageProps) {
  const t = useTranslations('etl');
  const format = useFormatter();
  const duration = useDuration();
  const router = useRouter();
  const [live, setLive] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const {
    data: run,
    isLoading,
    error,
    refetch,
  } = useApiQuery<RunDetail>(`/etl/pipelines/${params.id}/runs/${params.runId}`, undefined, {
    refetchInterval: live ? 1_500 : undefined,
  });
  const active = run ? run.status === 'queued' || run.status === 'running' : true;
  useEffect(() => setLive(active), [active]);
  const cancel = useApiMutation(
    (api, r: RunDetail) => api.post<RunDetail>(`/etl/pipelines/${r.pipelineId}/runs/${r.id}/cancel`, {}),
    {
      invalidate: INVALIDATE,
      success: t('run.cancelRequested'),
      onSuccess: () => setCancelling(false),
    },
  );
  const again = useApiMutation((api, id: string) => api.post<RunDto>(`/etl/pipelines/${id}/run`, {}), {
    invalidate: INVALIDATE,
    success: t('pipeline.queued'),
    onSuccess: (r) => router.push(runHref(r.pipelineId, r.id)),
  });
  const lines = useMemo(
    () => (run?.log ?? []).map((l, i) => ({ key: i, at: String(l.at), level: l.level, message: l.message })),
    [run?.log],
  );

  if (isLoading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !run) return <ErrorState error={error} kind="page" onRetry={() => refetch()} />;

  const failed = run.status === 'failed';
  const runAgain = run.viewer.canRun && !active && (
    <Button onClick={() => again.mutate(run.pipelineId)} loading={again.isPending}>
      <PlayIcon /> {t('run.runAgain')}
    </Button>
  );
  const started = run.startedAt ?? run.createdAt;

  return (
    <div>
      <DetailHeader
        back={{ href: pipelineHref(run.pipelineId), label: run.pipeline.name }}
        icon={<WorkflowIcon />}
        reference={
          <>
            {run.trigger === 'manual' && run.triggeredBy
              ? t('runs.manualBy', { name: run.triggeredBy.name })
              : t(`runTrigger.${run.trigger}`)}
            {' · '}
            <DateTime date={started} />
          </>
        }
        title={t('run.title', { name: run.pipeline.name })}
        status={
          <span aria-live="polite" className="inline-flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            {run.cancelRequested && active && (
              <span className="text-sm text-muted-foreground">{t('run.stopping')}</span>
            )}
          </span>
        }
        primaryAction={!failed ? runAgain : undefined}
        actions={
          run.viewer.canRun && active
            ? [
                {
                  label: t('run.cancel'),
                  icon: <BanIcon />,
                  disabled: run.cancelRequested,
                  onSelect: () => setCancelling(true),
                },
              ]
            : []
        }
      />

      <RunLayout
        aside={
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                {t('run.details')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Field label={t('runs.when')}>
                  <DateTime date={started} />
                </Field>
                <Field label={t('runs.trigger')}>
                  <span className="flex flex-col gap-0.5">
                    <span>{t(`runTrigger.${run.trigger}`)}</span>
                    {run.triggeredBy && (
                      <span className="text-xs text-muted-foreground">{run.triggeredBy.name}</span>
                    )}
                    {run.jobRun && (
                      <Link
                        href={`/scheduler/runs/${run.jobRun.runId}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <CalendarClockIcon className="size-3" aria-hidden /> {t('run.jobRun')}
                      </Link>
                    )}
                  </span>
                </Field>
                <Field label={t('runs.duration')}>
                  {run.durationMs === null ? (active ? t('run.inProgress') : null) : duration(run.durationMs)}
                </Field>
                {(run.watermarkFrom || run.watermarkTo) && (
                  <Field label={t('run.watermarkLabel')}>
                    {t('run.watermarkRange', { from: run.watermarkFrom ?? '—', to: run.watermarkTo ?? '—' })}
                  </Field>
                )}
              </dl>
            </CardContent>
          </Card>
        }
      >
        {failed && (
          <RunProblemBanner problem={run.problem} error={run.error} actions={runAgain || undefined} />
        )}
        <RunCounts
          label={t('run.progress')}
          items={[
            { key: 'rowsRead', label: t('run.tiles.rowsRead'), value: format.number(run.rowsRead) },
            { key: 'rowsWritten', label: t('run.tiles.rowsWritten'), value: format.number(run.rowsWritten) },
            {
              key: 'rowsRejected',
              label: t('run.tiles.rowsRejected'),
              value: format.number(run.rowsRejected),
              tone: run.rowsRejected > 0 ? 'warning' : 'default',
            },
          ]}
        />
        <RunLog lines={lines} live={active} fileName={`pipeline-run-${run.id}.log`} />
      </RunLayout>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('run.cancelTitle')}
        description={t('run.cancelBody')}
        confirmLabel={t('run.cancel')}
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(run)}
      />
    </div>
  );
}
