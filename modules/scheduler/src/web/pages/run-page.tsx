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
  CircleDotIcon,
  ExternalLinkIcon,
  FileQuestionIcon,
  FlagIcon,
  type LucideIcon,
  RotateCwIcon,
} from 'lucide-react';
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

/** Queued → started → (attempts) → finished. */
function Timeline({ run }: { run: RunDetail }) {
  const t = useTranslations('scheduler.run');
  const tr = useTranslations('scheduler');
  const duration = useDurationMs();
  const format = useFormatter();
  const steps: {
    key: string;
    icon: LucideIcon;
    tone: string;
    title: ReactNode;
    at: string | null;
    detail?: ReactNode;
  }[] = [
    {
      key: 'queued',
      icon: CircleDotIcon,
      tone: 'text-muted-foreground',
      title: t('queued'),
      at: run.queuedAt,
    },
  ];
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
          {a.error && <span className="block text-destructive">{a.error}</span>}
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
  return (
    <ol className="grid gap-0" aria-label={t('timeline')}>
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.key} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && (
              <span className="absolute top-6 bottom-0 left-3 w-px -translate-x-1/2 bg-border" aria-hidden />
            )}
            <span
              className={cn('grid size-6 place-items-center rounded-full border bg-card', s.tone)}
              aria-hidden
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium">{s.title}</p>
              {s.at && (
                <p className="text-xs text-muted-foreground">
                  <time dateTime={s.at}>
                    {format.dateTime(new Date(s.at), { dateStyle: 'medium', timeStyle: 'medium' })}
                  </time>
                </p>
              )}
              {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function RunPage({ params }: WebPageProps) {
  const t = useTranslations('scheduler');
  const format = useFormatter();
  const duration = useDurationMs();
  const typeName = useTypeName();
  const router = useRouter();
  const id = params.id ?? '';
  const path = `/scheduler/runs/${id}`;
  const [confirm, setConfirm] = useState(false);
  const {
    data: run,
    isLoading,
    error,
    refetch,
  } = useApiQuery<RunDetail>(path, undefined, {
    refetchInterval: 5_000,
  });
  const currentStatus = run?.status;

  // The live log reports status changes: refresh the header and timeline at once.
  const onStatus = useCallback(
    (status: RunStatus) => {
      if (status !== currentStatus) void refetch();
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

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !run) return <EmptyState icon={<FileQuestionIcon />} title={t('run.notFound')} />;

  const metrics = Object.entries(run.metrics);
  const when = format.dateTime(new Date(run.scheduledFor), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href={jobHref(run.job.id)}>
          <ArrowLeftIcon /> {run.job.name}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <TaskIcon icon={run.task.icon} className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span>{typeName(run.task.name, run.job.type)}</span>
              <span aria-hidden>·</span>
              <RunTriggerLabel trigger={run.trigger} />
            </p>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
              {t('run.title', { job: run.job.name, when })}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <RunStatusBadge status={run.status} skipReason={run.skipReason} />
              {run.maxAttempts > 1 && (
                <span className="text-sm text-muted-foreground">
                  {t('runs.attemptOf', { attempt: run.attempt, max: run.maxAttempts })}
                </span>
              )}
              {run.cancelRequested && isActive(run.status) && (
                <span className="text-sm text-muted-foreground">{t('run.cancelling')}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {run.viewer.canCancel && (
            <Button variant="outline" onClick={() => setConfirm(true)}>
              <BanIcon /> {t('run.cancel')}
            </Button>
          )}
          {run.viewer.canRetry && (
            <Button variant="outline" loading={retry.isPending} onClick={() => retry.mutate(undefined)}>
              <RotateCwIcon /> {t('run.runAgain')}
            </Button>
          )}
        </div>
      </FadeIn>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 gap-6 lg:col-span-2">
          {run.error && (
            <div
              role="status"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm wrap-anywhere text-destructive dark:bg-destructive/10"
            >
              <p className="font-medium">{t('run.error')}</p>
              <p>{run.error}</p>
            </div>
          )}
          <LogViewer key={run.id} runId={run.id} onStatus={onStatus} fileName={`run-${run.id}.log`} />
        </div>
        <div className="grid min-w-0 gap-6">
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
                <Field label={t('runs.summary')}>{run.summary}</Field>
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
          {metrics.length > 0 && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('run.metrics')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3">
                  {metrics.map(([k, v]) => (
                    <div key={k} className="min-w-0 rounded-lg border px-3 py-2">
                      <dt className="truncate text-xs text-muted-foreground">
                        {t.has(`metrics.${k}`) ? t(`metrics.${k}`) : k}
                      </dt>
                      <dd className="text-lg font-semibold tabular-nums">
                        {k === 'durationMs' ? duration(v) : format.number(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('run.timeline')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline run={run} />
            </CardContent>
          </Card>
        </div>
      </div>

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
