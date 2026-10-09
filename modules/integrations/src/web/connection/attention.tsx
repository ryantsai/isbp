'use client';

import type { Page } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { CircleCheckIcon, GitCompareArrowsIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { ConflictSummary, Connection, Link as LinkDto, Profile } from '../../contracts';
import { RunStatusText } from '../badges';
import { ResolveDialog } from '../conflicts';
import { connectionHref, profileHref, runHref } from '../lib';
import { LocalCell, RemoteCell } from '../links-table';

const SHOWN = 5;

/**
 * What needs a person on this connection, first: open conflicts (resolve them here), records that failed to sync
 * (with why and both sides), and sync rules whose last run failed. "Nothing needs attention" when all is well.
 */
export function NeedsAttention({ c }: { c: Connection }) {
  const t = useTranslations('integrations.attention');
  const errorText = useErrorText();
  const id = useId();
  const [conflict, setConflict] = useState<string | null>(null);
  const conflicts = useApiQuery<Page<ConflictSummary>>('/integrations/conflicts', {
    connectionId: c.id,
    status: 'open',
    pageSize: SHOWN,
  });
  const failed = useApiQuery<Page<LinkDto>>('/integrations/links', {
    connectionId: c.id,
    state: 'error',
    pageSize: SHOWN,
  });
  const rules = useApiQuery<{ items: Profile[] }>('/integrations/profiles', { connectionId: c.id });
  const failedRules = (rules.data?.items ?? []).filter(
    (p) => p.lastRun && (p.lastRun.status === 'failed' || p.lastRun.status === 'partial'),
  );
  const loading = conflicts.isLoading || failed.isLoading || rules.isLoading;
  const error = conflicts.error ?? failed.error ?? rules.error;
  const nConflicts = conflicts.data?.total ?? 0;
  const nFailed = failed.data?.total ?? 0;
  const nothing = !loading && !error && nConflicts === 0 && nFailed === 0 && failedRules.length === 0;

  return (
    <Card className="min-w-0" role="region" aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id} className="flex items-center gap-2">
          {nothing ? (
            <CircleCheckIcon className="size-4 text-success" aria-hidden />
          ) : (
            <TriangleAlertIcon className="size-4 text-warning-foreground" aria-hidden />
          )}
          {t('title')}
        </CardTitle>
        <CardDescription>{nothing ? t('nothing') : t('description')}</CardDescription>
      </CardHeader>
      {!nothing && (
        <CardContent className="grid min-w-0 gap-5">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : error ? (
            <ErrorState
              compact
              error={error}
              onRetry={() => {
                void conflicts.refetch();
                void failed.refetch();
                void rules.refetch();
              }}
            />
          ) : (
            <>
              {nConflicts > 0 && (
                <section className="grid min-w-0 gap-2" aria-labelledby={`${id}-conflicts`}>
                  <h3 id={`${id}-conflicts`} className="text-sm font-medium">
                    {t('conflicts', { count: nConflicts })}
                  </h3>
                  <AnimatedList className="divide-y rounded-lg border">
                    {(conflicts.data?.items ?? []).map((x) => (
                      <AnimatedItem
                        key={x.id}
                        className="flex min-w-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="grid min-w-0 gap-0.5 text-sm">
                          <LocalCell local={x.local} />
                          <span className="text-xs text-muted-foreground">
                            {t('fieldsChanged', { fields: x.fields.join(', ') })} ·{' '}
                            <RelativeTime date={x.createdAt} />
                          </span>
                        </span>
                        <Button
                          size="sm"
                          onClick={() => setConflict(x.id)}
                          aria-label={t('resolveFor', { ref: x.remoteRef ?? x.local?.title ?? '' })}
                          className="shrink-0"
                        >
                          <GitCompareArrowsIcon /> {t('resolve')}
                        </Button>
                      </AnimatedItem>
                    ))}
                  </AnimatedList>
                  {nConflicts > SHOWN && (
                    <Link
                      href={`${connectionHref(c.id)}?tab=conflicts`}
                      className="text-sm text-primary hover:underline"
                    >
                      {t('allConflicts', { count: nConflicts })}
                    </Link>
                  )}
                </section>
              )}
              {nFailed > 0 && (
                <section className="grid min-w-0 gap-2" aria-labelledby={`${id}-failed`}>
                  <h3 id={`${id}-failed`} className="text-sm font-medium">
                    {t('failed', { count: nFailed })}
                  </h3>
                  <ul className="divide-y rounded-lg border">
                    {(failed.data?.items ?? []).map((l) => (
                      <li key={l.id} className="grid min-w-0 gap-1 px-3 py-2 text-sm">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                          <LocalCell local={l.local} />
                          <RemoteCell remoteRef={l.remoteRef} remoteUrl={l.remoteUrl} />
                        </span>
                        {l.lastError && (
                          <span className="text-xs wrap-anywhere text-destructive">
                            {errorText(new ApiError(422, l.lastError.code, l.lastError.message))}
                            {l.lastError.message && (
                              <span className="block text-muted-foreground">{l.lastError.message}</span>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {nFailed > SHOWN && (
                    <Link
                      href={`${connectionHref(c.id)}?tab=links&state=error`}
                      className="text-sm text-primary hover:underline"
                    >
                      {t('allFailed', { count: nFailed })}
                    </Link>
                  )}
                </section>
              )}
              {failedRules.length > 0 && (
                <section className="grid min-w-0 gap-2" aria-labelledby={`${id}-rules`}>
                  <h3 id={`${id}-rules`} className="text-sm font-medium">
                    {t('rules')}
                  </h3>
                  <ul className="divide-y rounded-lg border">
                    {failedRules.map((p) => (
                      <li
                        key={p.id}
                        className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <Link href={profileHref(c.id, p.id)} className="min-w-0 font-medium hover:underline">
                          {p.name}
                        </Link>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <RunStatusText status={p.lastRun!.status} />
                          {(p.lastRun!.finishedAt ?? p.lastRun!.startedAt) && (
                            <RelativeTime date={(p.lastRun!.finishedAt ?? p.lastRun!.startedAt)!} />
                          )}
                          <Link href={runHref(p.lastRun!.id)} className="text-primary hover:underline">
                            {t('viewRun')}
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </CardContent>
      )}
      <ResolveDialog conflictId={conflict} onOpenChange={(o) => !o && setConflict(null)} />
    </Card>
  );
}
