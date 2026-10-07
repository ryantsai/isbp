'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowLeftIcon,
  BanIcon,
  CircleAlertIcon,
  CircleXIcon,
  FileQuestionIcon,
  InfoIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { RunDetail } from '../../contracts';
import { RunStatusBadge, TONE } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, pipelineHref, useDuration } from '../lib';

const LEVEL = {
  info: { icon: InfoIcon, className: 'text-muted-foreground' },
  warn: { icon: TriangleAlertIcon, className: 'text-warning-foreground' },
  error: { icon: CircleXIcon, className: 'text-destructive' },
} as const;

/** One pipeline run: progress counters, watermark, the error and the log; live while it runs. */
export default function RunPage({ params }: WebPageProps) {
  const t = useTranslations('etl');
  const format = useFormatter();
  const duration = useDuration();
  const [live, setLive] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const {
    data: run,
    isLoading,
    error,
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

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !run) return <EmptyState icon={<FileQuestionIcon />} title={t('run.notFound')} />;

  const tiles = [
    { key: 'rowsRead', value: format.number(run.rowsRead) },
    { key: 'rowsWritten', value: format.number(run.rowsWritten) },
    { key: 'rowsRejected', value: format.number(run.rowsRejected) },
    {
      key: 'duration',
      value: run.durationMs === null ? (active ? t('run.inProgress') : '—') : duration(run.durationMs),
    },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href={pipelineHref(run.pipelineId)}>
          <ArrowLeftIcon /> {run.pipeline.name}
        </Link>
      </Button>
      <FadeIn y={4} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm text-muted-foreground">
            {run.trigger === 'manual' && run.triggeredBy
              ? t('runs.manualBy', { name: run.triggeredBy.name })
              : t(`runTrigger.${run.trigger}`)}
            {' · '}
            <DateTime date={run.startedAt ?? run.createdAt} />
          </p>
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
            {t('run.title', { name: run.pipeline.name })}
          </h1>
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <RunStatusBadge status={run.status} />
            {run.cancelRequested && active && (
              <span className="text-sm text-muted-foreground">{t('run.stopping')}</span>
            )}
          </div>
        </div>
        {run.viewer.canRun && active && (
          <Button variant="outline" onClick={() => setCancelling(true)} disabled={run.cancelRequested}>
            <BanIcon /> {t('run.cancel')}
          </Button>
        )}
      </FadeIn>

      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={t('run.progress')} aria-live="polite">
        {tiles.map((tile) => (
          <div key={tile.key} className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
            <dt className="truncate text-xs text-muted-foreground">{t(`run.tiles.${tile.key}`)}</dt>
            <dd className="mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums">{tile.value}</dd>
          </div>
        ))}
      </dl>

      {(run.watermarkFrom || run.watermarkTo) && (
        <p className="text-sm text-muted-foreground">
          {t('run.watermark', { from: run.watermarkFrom ?? '—', to: run.watermarkTo ?? '—' })}
        </p>
      )}
      {run.error && (
        <p
          role="alert"
          className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', TONE.destructive)}
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 wrap-anywhere">{run.error}</span>
        </p>
      )}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t('run.log')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {run.log.length === 0 ? (
            <p className="text-sm text-muted-foreground">{active ? t('run.waiting') : t('run.noLog')}</p>
          ) : (
            <ol
              tabIndex={0}
              aria-label={t('run.log')}
              className="max-h-[32rem] min-w-0 overflow-auto rounded-lg border bg-muted/20 p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {run.log.map((l, i) => {
                const m = LEVEL[l.level];
                return (
                  <li key={i} className="flex min-w-0 items-start gap-2 px-1 py-0.5">
                    <m.icon className={cn('mt-0.5 size-3.5 shrink-0', m.className)} aria-hidden />
                    <span className="sr-only">{t(`run.levels.${l.level}`)}</span>
                    <time dateTime={l.at} className="shrink-0 text-muted-foreground tabular-nums">
                      {format.dateTime(new Date(l.at), {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </time>
                    <span className="min-w-0 wrap-anywhere">{l.message}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

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
