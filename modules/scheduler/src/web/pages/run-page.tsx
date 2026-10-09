'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import {
  RunCounts,
  RunLayout,
  RunProblemBanner,
  type RunStep,
  RunTimeline,
  useResultText,
} from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { BanIcon, CircleDotIcon, ExternalLinkIcon, FlagIcon, RotateCwIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import { isActive, type RunDetail, type RunStatus } from '../../contracts';
import { RUN_STATUS, RunStatusBadge, RunTriggerLabel, TaskIcon, TEXT_TONE } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, jobHref, runHref, useDurationMs, useTypeName } from '../lib';
import { LogViewer } from '../log-viewer';

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

/** Queued → started → (attempts) → finished. The reason is in the banner above, not repeated here. */
function useTimeline(run: RunDetail): RunStep[] {
  const t = useTranslations('scheduler.run');
  const tr = useTranslations('scheduler');
  const duration = useDurationMs();
  const steps: RunStep[] = [{ key: 'queued', icon: CircleDotIcon, title: t('queued'), at: run.queuedAt }];
  for (const a of run.attempts) {
    const meta = RUN_STATUS[a.status];
    steps.push({
      key: `attempt-${a.attempt}`,
      icon: meta.icon,
      tone: TEXT_TONE[meta.tone],
      title: run.maxAttempts > 1 || run.attempts.length > 1 ? t('attempt', { n: a.attempt }) : t('started'),
      at: a.startedAt,
      detail: (
        <>
          {tr(`runStatus.${a.status}`)}
          {a.durationMs !== null && <> · {duration(a.durationMs)}</>}
        </>
      ),
    });
  }
  if (run.status === 'retrying' && run.nextAttemptAt)
    steps.push({
      key: 'next',
      icon: RotateCwIcon,
      tone: 'text-warning-foreground',
      title: t('nextAttempt', { n: run.attempt }),
      at: run.nextAttemptAt,
    });
  if (run.finishedAt)
    steps.push({
      key: 'finished',
      icon: FlagIcon,
      tone: TEXT_TONE[RUN_STATUS[run.status].tone],
      title: t('finished'),
      at: run.finishedAt,
      detail: tr(`runStatus.${run.status}`),
    });
  return steps;
}

function RunView({ run, refetch }: { run: RunDetail; refetch: () => void }) {
  const t = useTranslations('scheduler');
  const format = useFormatter();
  const duration = useDurationMs();
  const typeName = useTypeName();
  const resultText = useResultText();
  const router = useRouter();
  const path = `/scheduler/runs/${run.id}`;
  const [confirm, setConfirm] = useState(false);
  const steps = useTimeline(run);
  const currentStatus = run.status;

  // The live log reports status changes: refresh the header and timeline at once.
  const onStatus = useCallback(
    (status: RunStatus) => {
      if (status !== currentStatus) refetch();
    },
    [currentStatus, refetch],
  );

  const cancel = useApiMutation((api) => api.post<RunDetail>(`${path}/cancel`), {
    invalidate: INVALIDATE,
    success: t('run.cancelRequested'),
    onSuccess: () => setConfirm(false),
  });
  const retry = useApiMutation((api) => api.post<RunDetail>(`${path}/retry`), {
    invalidate: INVALIDATE,
    success: t('run.retried'),
    onSuccess: (r) => router.push(runHref(r.id)),
  });

  const metrics = Object.entries(run.metrics);
  const when = format.dateTime(new Date(run.scheduledFor), { dateStyle: 'medium', timeStyle: 'short' });
  const failed = run.status === 'failed' || run.status === 'timed_out';
  const lastAttempt = run.attempts.at(-1);
  const runAgain = run.viewer.canRetry && (
    <Button loading={retry.isPending} onClick={() => retry.mutate(undefined)}>
      <RotateCwIcon /> {t('run.runAgain')}
    </Button>
  );

  return (
    <div>
      <DetailHeader
        back={{ href: jobHref(run.job.id), label: run.job.name }}
        icon={<TaskIcon icon={run.task.icon} />}
        reference={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <span>{typeName(run.task.name, run.job.type)}</span>
            <span aria-hidden>·</span>
            <RunTriggerLabel trigger={run.trigger} />
          </span>
        }
        title={t('run.title', { job: run.job.name, when })}
        status={
          <span aria-live="polite" className="inline-flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} skipReason={run.skipReason} />
            {run.attempt > 1 && (
              <span className="text-sm text-muted-foreground">
                {t('runs.attemptOf', { attempt: run.attempt, max: run.maxAttempts })}
              </span>
            )}
            {run.cancelRequested && isActive(run.status) && (
              <span className="text-sm text-muted-foreground">{t('run.cancelling')}</span>
            )}
          </span>
        }
        primaryAction={!failed ? runAgain : undefined}
        actions={
          run.viewer.canCancel
            ? [{ label: t('run.cancel'), icon: <BanIcon />, onSelect: () => setConfirm(true) }]
            : []
        }
      />

      <RunLayout
        aside={
          <>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('run.details')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label={t('runs.scheduledFor')}>
                    <DateTime date={run.scheduledFor} />
                  </Field>
                  <Field label={t('runs.trigger')}>
                    <span className="flex flex-col gap-0.5">
                      <RunTriggerLabel trigger={run.trigger} />
                      {run.triggeredBy && (
                        <span className="text-xs text-muted-foreground">{run.triggeredBy.displayName}</span>
                      )}
                      {run.upstreamRun && (
                        <Link
                          href={runHref(run.upstreamRun.id)}
                          className="text-xs text-primary hover:underline"
                        >
                          {t('run.after', { job: run.upstreamRun.job.name })}
                        </Link>
                      )}
                    </span>
                  </Field>
                  <Field label={t('runs.duration')}>
                    {run.durationMs !== null ? duration(run.durationMs) : null}
                  </Field>
                  {!failed && (
                    <Field label={t('runs.summary')}>
                      {run.summary ? resultText(run.summary, run.summaryParams) : null}
                    </Field>
                  )}
                  <Field label={t('fields.task')}>
                    <span className="flex flex-col gap-0.5">
                      <span>{run.task.label}</span>
                      {run.href && (
                        <Link
                          href={run.href}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLinkIcon className="size-3" aria-hidden /> {t('run.openResult')}
                        </Link>
                      )}
                    </span>
                  </Field>
                </dl>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('run.timeline')}</CardTitle>
              </CardHeader>
              <CardContent>
                <RunTimeline steps={steps} label={t('run.timeline')} />
              </CardContent>
            </Card>
          </>
        }
      >
        {(failed || run.status === 'retrying') && (
          <RunProblemBanner
            problem={run.problem ?? lastAttempt?.problem}
            error={run.error}
            retry={
              run.status === 'retrying' && run.nextAttemptAt
                ? { attempt: Math.max(1, run.attempt - 1), at: run.nextAttemptAt }
                : null
            }
            actions={failed ? runAgain : undefined}
            live={isActive(run.status)}
          />
        )}
        {metrics.length > 0 && (
          <RunCounts
            label={t('run.metrics')}
            items={metrics.map(([k, v]) => ({
              key: k,
              label: t.has(`metrics.${k}`) ? t(`metrics.${k}`) : k,
              value: k === 'durationMs' ? duration(v) : format.number(v),
            }))}
          />
        )}
        <LogViewer key={run.id} runId={run.id} onStatus={onStatus} fileName={`run-${run.id}.log`} />
      </RunLayout>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('run.cancelTitle')}
        description={t('run.cancelHint')}
        confirmLabel={t('run.cancel')}
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(undefined)}
      />
    </div>
  );
}

export default function RunPage({ params }: WebPageProps) {
  const id = params.id ?? '';
  const {
    data: run,
    isLoading,
    error,
    refetch,
  } = useApiQuery<RunDetail>(`/scheduler/runs/${id}`, undefined, {
    refetchInterval: 5_000,
  });
  const reload = useCallback(() => void refetch(), [refetch]);

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !run) return <ErrorState error={error} kind="page" onRetry={reload} />;
  return <RunView run={run} refetch={reload} />;
}
