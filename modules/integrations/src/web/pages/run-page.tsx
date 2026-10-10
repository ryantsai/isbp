'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import {
  problemOfError,
  RunCounts,
  RunLayout,
  RunLog,
  type RunLogLine,
  RunProblemBanner,
} from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { CircleXIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { COUNT_KEYS, isActiveRun, LIMITS, type RunDetail } from '../../contracts';
import { KindLabel, RunStatusBadge, TriggerLabel } from '../badges';
import { connectionHref, profileHref, useLabel } from '../lib';

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

/** A sync run: status, counts and its log (followed live while it runs). */
export default function RunPage({ params }: WebPageProps) {
  const t = useTranslations('integrations.run');
  const tn = useTranslations('integrations.counts');
  const label = useLabel();
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
      <div className="space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !run) return <ErrorState error={error} kind="page" />;
  const when = format.dateTime(new Date(run.startedAt ?? run.createdAt), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const problems = run.log.filter((l) => l.level === 'error');
  // Field labels in the reader's language ("Updated INC-00042 from #1234: Title, Due date").
  const text = (l: (typeof run.log)[number]) =>
    l.ref?.fields?.length ? `${l.message}: ${l.ref.fields.map((f) => label(f)).join(', ')}` : l.message;
  const lines: RunLogLine[] = [
    ...run.log.slice(0, run.logDropped ? LIMITS.logHead : run.log.length).map((l, i) => ({
      key: i,
      at: l.at,
      level: l.level,
      message: text(l),
    })),
    ...(run.logDropped
      ? [
          {
            key: 'dropped',
            at: run.log[LIMITS.logHead]?.at ?? run.createdAt,
            level: 'info' as const,
            message: t('dropped', { count: run.logDropped }),
          },
          ...run.log.slice(LIMITS.logHead).map((l, i) => ({
            key: i + LIMITS.logHead,
            at: l.at,
            level: l.level,
            message: text(l),
          })),
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <DetailHeader
        className="pb-0"
        back={{ href: `${connectionHref(run.connection.id)}?tab=runs`, label: run.connection.name }}
        reference={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <KindLabel kind={run.kind} />
            <span aria-hidden>·</span>
            <TriggerLabel trigger={run.trigger} />
          </span>
        }
        title={t('title', { profile: run.profile.name, when })}
        status={
          <span className="inline-flex flex-wrap items-center gap-2" role="status" aria-live="polite">
            <RunStatusBadge status={run.status} />
            {run.status === 'waiting' && run.resumeAt && (
              <span className="text-sm text-muted-foreground">
                {t('resumes')} <DateTime date={run.resumeAt} />
              </span>
            )}
          </span>
        }
      />

      <RunLayout
        aside={
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('details')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Field label={t('profile')}>
                  <Link
                    href={profileHref(run.connection.id, run.profile.id)}
                    className="text-primary hover:underline"
                  >
                    {run.profile.name}
                  </Link>
                </Field>
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
        }
      >
        {run.error && (
          <RunProblemBanner
            problem={problemOfError(
              { status: 422, code: run.errorCode ?? 'INVALID_STATE', message: run.error },
              {
                id: run.connection.id,
                name: run.connection.name,
                href: connectionHref(run.connection.id),
              },
            )}
            error={run.error}
          />
        )}
        <RunCounts
          label={t('counts')}
          // The main counters always; the rest only when something happened.
          items={COUNT_KEYS.filter(
            (k) => ['read', 'created', 'updated', 'pushed', 'errors'].includes(k) || run.counts[k] > 0,
          ).map((k) => ({
            key: k,
            label: tn(k),
            value: format.number(run.counts[k]),
            tone:
              k === 'errors' && run.counts.errors > 0
                ? 'destructive'
                : k === 'conflicts' && run.counts.conflicts > 0
                  ? 'warning'
                  : 'default',
          }))}
        />
        {problems.length > 0 && (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleXIcon className="size-4 text-destructive" aria-hidden />
                {t('problems', { count: problems.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {problems.slice(0, 20).map((p, i) => (
                  <li key={`${p.at}-${i}`} className="grid min-w-0 gap-0.5 py-2 text-sm">
                    {(p.ref?.local || p.ref?.remote) && (
                      <span className="flex flex-wrap items-center gap-x-2 font-medium">
                        {p.ref?.local && <span>{p.ref.local}</span>}
                        {p.ref?.remote && (
                          <span className="font-mono text-xs text-muted-foreground">{p.ref.remote}</span>
                        )}
                        <Link
                          href={`${connectionHref(run.connection.id)}?tab=links&q=${encodeURIComponent(p.ref.remote ?? p.ref.local ?? '')}`}
                          className="text-xs font-normal text-primary hover:underline"
                        >
                          {t('openLink')}
                        </Link>
                      </span>
                    )}
                    <span className="wrap-anywhere text-muted-foreground">{text(p)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        <RunLog lines={lines} live={live} fileName={`sync-run-${run.id}.log`} />
      </RunLayout>
    </div>
  );
}
