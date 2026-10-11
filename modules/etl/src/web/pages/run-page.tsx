'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import type { WebPageProps } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { RunCounts, RunLayout, RunLog, RunProblemBanner } from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { BanIcon, CalendarClockIcon, PlayIcon, WorkflowIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { RunDetail, RunDto } from '../../contracts';
import { RunStatusBadge } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, pipelineHref, runHref, useDuration } from '../lib';

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
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </VStack>
    );
  if (error || !run) return <ErrorState error={error} kind="page" onRetry={() => refetch()} />;

  const failed = run.status === 'failed';
  const runAgain = run.viewer.canRun && !active && (
    <Button
      label={t('run.runAgain')}
      variant="primary"
      icon={<Icon icon={PlayIcon} />}
      isLoading={again.isPending}
      onClick={() => again.mutate(run.pipelineId)}
    />
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
          <HStack gap={2} wrap="wrap" vAlign="center" aria-live="polite">
            <RunStatusBadge status={run.status} />
            {run.cancelRequested && active && <Text color="secondary">{t('run.stopping')}</Text>}
          </HStack>
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
              <MetadataList label={{ position: 'start', width: 136 }}>
                <MetadataListItem label={t('runs.when')}>
                  <DateTime date={started} />
                </MetadataListItem>
                <MetadataListItem label={t('runs.trigger')}>
                  <VStack gap={0.5}>
                    <span>{t(`runTrigger.${run.trigger}`)}</span>
                    {run.triggeredBy && <Text type="supporting">{run.triggeredBy.name}</Text>}
                    {run.jobRun && (
                      <HStack gap={1} vAlign="center">
                        <Icon icon={CalendarClockIcon} color="secondary" />
                        <Link href={`/scheduler/runs/${run.jobRun.runId}`}>{t('run.jobRun')}</Link>
                      </HStack>
                    )}
                  </VStack>
                </MetadataListItem>
                <MetadataListItem label={t('runs.duration')}>
                  {run.durationMs === null ? (active ? t('run.inProgress') : '—') : duration(run.durationMs)}
                </MetadataListItem>
                {(run.watermarkFrom || run.watermarkTo) && (
                  <MetadataListItem label={t('run.watermarkLabel')}>
                    {t('run.watermarkRange', { from: run.watermarkFrom ?? '—', to: run.watermarkTo ?? '—' })}
                  </MetadataListItem>
                )}
              </MetadataList>
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
