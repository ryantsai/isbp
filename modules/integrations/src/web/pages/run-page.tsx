'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { FadeIn } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { ArrowLeftIcon, FileQuestionIcon, ScrollTextIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { COUNT_KEYS, isActiveRun, type LogEntryDto, LIMITS, type RunDetail } from '../../contracts';
import { KindLabel, LOG_LEVEL, RunStatusBadge, TEXT_TONE, TriggerLabel } from '../badges';
import { connectionHref } from '../lib';

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

/** The run's log; it grows while the run is going (the page polls). */
function RunLog({ entries, dropped, live }: { entries: LogEntryDto[]; dropped: number; live: boolean }) {
  const t = useTranslations('integrations.run');
  const format = useFormatter();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [entries.length, follow]);
  const line = (l: LogEntryDto, i: number) => {
    const meta = LOG_LEVEL[l.level];
    const Icon = meta.icon;
    return (
      <li
        key={`${l.at}-${i}`}
        className={cn(
          'grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 px-4 py-0.5 hover:bg-accent/40',
          l.level === 'error' && 'bg-destructive/5',
        )}
      >
        <time dateTime={l.at} className="text-muted-foreground tabular-nums select-none">
          {format.dateTime(new Date(l.at), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </time>
        <span
          className={cn('inline-flex w-16 items-center gap-1 font-sans font-medium', TEXT_TONE[meta.tone])}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {t(`level.${l.level}`)}
        </span>
        <span className="whitespace-pre-wrap wrap-anywhere">{l.message}</span>
      </li>
    );
  };
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ScrollTextIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <h2 id={`${id}-title`} className="font-semibold">
            {t('log')}
          </h2>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {live ? t('live', { count: entries.length }) : t('lines', { count: entries.length })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={`${id}-follow`} checked={follow} onCheckedChange={setFollow} />
          <Label htmlFor={`${id}-follow`} className="text-sm font-normal">
            {t('follow')}
          </Label>
        </div>
      </div>
      <div
        ref={box}
        role="log"
        aria-live="off"
        aria-label={t('log')}
        tabIndex={0}
        className="max-h-[32rem] min-h-40 overflow-auto bg-muted/30 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center font-sans text-sm text-muted-foreground">
            {live ? t('waiting') : t('empty')}
          </p>
        ) : (
          <ol className="min-w-0">
            {entries.slice(0, dropped ? LIMITS.logHead : entries.length).map(line)}
            {dropped > 0 && (
              <li className="px-4 py-1 font-sans text-muted-foreground italic">
                {t('dropped', { count: dropped })}
              </li>
            )}
            {dropped > 0 && entries.slice(LIMITS.logHead).map((l, i) => line(l, i + LIMITS.logHead))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** A sync run: status, counts and its log (followed live while it runs). */
export default function RunPage({ params }: WebPageProps) {
  const t = useTranslations('integrations.run');
  const tn = useTranslations('integrations.counts');
  const te = useTranslations('errors');
  const format = useFormatter();
  const id = params.id ?? '';
  const [active, setActive] = useState(true);
  const {
    data: run,
    isLoading,
    error,
  } = useApiQuery<RunDetail>(`/integrations/runs/${id}`, undefined, {
    refetchInterval: active ? 1_500 : undefined,
  });
  const live = run ? isActiveRun(run.status) : true;
  useEffect(() => setActive(live), [live]);

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !run) return <EmptyState icon={<FileQuestionIcon />} title={t('notFound')} />;
  const when = format.dateTime(new Date(run.startedAt ?? run.createdAt), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href={`${connectionHref(run.connection.id)}?tab=runs`}>
          <ArrowLeftIcon /> {run.connection.name}
        </Link>
      </Button>
      <FadeIn y={4} className="min-w-0 space-y-1.5">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <KindLabel kind={run.kind} />
          <span aria-hidden>·</span>
          <TriggerLabel trigger={run.trigger} />
        </p>
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
          {t('title', { profile: run.profile.name, when })}
        </h1>
        <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
          <RunStatusBadge status={run.status} />
          {run.status === 'waiting' && run.resumeAt && (
            <span className="text-sm text-muted-foreground">
              {t('resumes')} <DateTime date={run.resumeAt} />
            </span>
          )}
        </div>
      </FadeIn>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 gap-6 lg:col-span-2">
          {run.error && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm wrap-anywhere text-destructive dark:bg-destructive/10"
            >
              <p className="font-medium">
                {run.errorCode && te.has(run.errorCode) ? te(run.errorCode) : t('error')}
              </p>
              <p>{run.error}</p>
              {run.errorCode === 'INSECURE_HTTP' && (
                <p className="mt-1 text-muted-foreground">
                  {t('insecureHint')}{' '}
                  <Link
                    href={connectionHref(run.connection.id)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {t('openConnection')}
                  </Link>
                </p>
              )}
            </div>
          )}
          <RunLog entries={run.log} dropped={run.logDropped} live={live} />
        </div>
        <div className="grid min-w-0 gap-6">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('counts')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3">
                {COUNT_KEYS.map((k) => (
                  <div key={k} className="min-w-0 rounded-lg border px-3 py-2">
                    <dt className="truncate text-xs text-muted-foreground">{tn(k)}</dt>
                    <dd
                      className={cn(
                        'text-lg font-semibold tabular-nums',
                        k === 'errors' && run.counts.errors > 0 && 'text-destructive',
                        k === 'conflicts' && run.counts.conflicts > 0 && 'text-warning-foreground',
                      )}
                    >
                      {format.number(run.counts[k])}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('details')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Field label={t('profile')}>{run.profile.name}</Field>
                <Field label={t('started')}>{run.startedAt ? <DateTime date={run.startedAt} /> : null}</Field>
                <Field label={t('finished')}>
                  {run.finishedAt ? <DateTime date={run.finishedAt} /> : null}
                </Field>
                <Field label={t('duration')}>
                  {run.durationMs !== null
                    ? t('seconds', { s: format.number(Math.round(run.durationMs / 100) / 10) })
                    : null}
                </Field>
                <Field label={t('by')}>{run.triggeredBy?.displayName}</Field>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
