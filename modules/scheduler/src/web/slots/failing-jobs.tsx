'use client';

import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { problemOf, useRunProblemText } from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, CalendarClockIcon, CircleXIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Attention } from '../../contracts';
import { jobHref, runHref } from '../lib';

/** "Failing jobs" on the home dashboard (`core.dashboard.work`), for people who read Scheduled jobs. */
export default function FailingJobsCard() {
  const t = useTranslations('scheduler.attention');
  const problemText = useRunProblemText();
  const { data } = useApiQuery<Attention>('/scheduler/attention', undefined, { refetchInterval: 120_000 });
  // Home shows only what needs the person: nothing failing, no card.
  if (data && data.items.length === 0) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClockIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/scheduler">
              {t('open')}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <p className="mb-2 text-sm">{t('count', { count: data.failingJobs })}</p>
            <ul className="divide-y" aria-label={t('title')}>
              {data.items.map((i) => (
                <li key={i.job.id} className="flex min-w-0 items-start justify-between gap-3 py-2 text-sm">
                  <span className="flex min-w-0 items-start gap-2">
                    <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                    <span className="grid min-w-0 gap-0.5">
                      <Link href={jobHref(i.job.id)} className="truncate font-medium hover:underline">
                        {i.job.name}
                      </Link>
                      {(i.problem || i.error) && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {problemText(problemOf(i.problem, i.error)!).title}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-destructive">{t('streak', { count: i.streak })}</span>
                    {i.at && i.runId && (
                      <Link href={runHref(i.runId)} className="hover:underline">
                        <RelativeTime date={i.at} />
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
