'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { CircleCheckIcon, CircleXIcon, GitPullRequestIcon, ListChecksIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Readiness, ReleaseDetail } from '../contracts';
import { ChangeLine } from './changes';
import { PolicyExplanation, useRaiseChangeHref } from './deployment-dialog';

/**
 * The readiness checklist: an authorized change linked (with its reference and status), tested in test or
 * staging, release notes written, no failed production deployment — and what the change policy says.
 */
export function ReadinessCard({ release }: { release: ReleaseDetail }) {
  const t = useTranslations('alm.readiness');
  const reduce = useReducedMotion();
  const raise = useRaiseChangeHref();
  const { data } = useApiQuery<Readiness>(`/alm/releases/${release.id}/readiness`);
  const done = release.status === 'released' || release.status === 'cancelled';
  const raiseHref = raise(release.application, release);

  const detail = (key: Readiness['checks'][number]['key'], ok: boolean) => {
    if (!data) return null;
    if (key === 'change')
      return data.change ? (
        <ChangeLine change={data.change} className="mt-1" />
      ) : (
        <span className="text-muted-foreground">{t('details.noChange')}</span>
      );
    if (key === 'tested')
      return ok ? t('details.testedIn', { environments: data.testedIn.join(', ') }) : t('details.notTested');
    if (key === 'notes') return ok ? t('details.notesWritten') : t('details.noNotes');
    return ok ? t('details.noFailures') : t('details.failures', { count: data.failedInProduction });
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecksIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {!data
            ? '…'
            : data.ready
              ? t('allPass')
              : t('progressLong', { passed: data.passed, total: data.total })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {!data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={data.total}
              aria-valuenow={data.passed}
              aria-label={t('progressLong', { passed: data.passed, total: data.total })}
            >
              <motion.div
                className={cn('h-full rounded-full', data.ready ? 'bg-success' : 'bg-primary')}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${(data.passed / data.total) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <ul className="grid gap-3">
              {data.checks.map((c) => (
                <li key={c.key} className="flex min-w-0 gap-2.5">
                  {c.ok ? (
                    <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                    <span className="font-medium">
                      <span className="sr-only">{c.ok ? t('passed') : t('notPassed')}: </span>
                      {t(`checks.${c.key}`)}
                    </span>
                    <div className="min-w-0 text-muted-foreground">{detail(c.key, c.ok)}</div>
                  </div>
                </li>
              ))}
            </ul>
            {!data.changes.length && !done && (
              <Button variant="outline" size="sm" asChild className="w-fit">
                <Link href={raiseHref}>
                  <GitPullRequestIcon /> {t('raiseChange')}
                </Link>
              </Button>
            )}
            {data.changes.length > 1 && (
              <div className="grid gap-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">{t('allChanges')}</p>
                <ul className="grid gap-3">
                  {data.changes.map((c) => (
                    <li key={c.id}>
                      <ChangeLine change={c} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!done && data.policy.production && (
              <div className="grid gap-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">{t('policyNow')}</p>
                <PolicyExplanation
                  decision={data.policy.production}
                  check={{
                    environment: { id: '', name: '', kind: 'production' },
                    changes: data.changes,
                    requireChange: data.policy.requireChange,
                    enforceWindow: data.policy.enforceWindow,
                    namedNotFound: false,
                  }}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
