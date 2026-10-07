'use client';

import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { AlarmClockIcon, ArrowRightIcon, ClipboardCheckIcon, DatabaseIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MySummary } from '../../contracts';
import { useDate, useDay, useLocalized } from '../lib';

/**
 * `core.dashboard.work`: "Reviews awaiting you" for reviewers and "Access expiring soon" for grantees.
 * Renders nothing when there is neither.
 */
export default function DatabaseAccessWork() {
  const t = useTranslations('dbaccess.dashboard');
  const l = useLocalized();
  const day = useDay();
  const date = useDate();
  const { data } = useApiQuery<MySummary>('/dbaccess/me/summary', undefined, { refetchInterval: 120_000 });
  if (!data || (!data.reviews.length && !data.expiring.length)) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {t('description', { reviews: data.reviews.length, expiring: data.expiring.length })}
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dbaccess">
              {t('open')}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {data.reviews.length > 0 && (
          <section aria-label={t('reviews')} className="grid gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{t('reviews')}</h3>
            <ul className="divide-y">
              {data.reviews.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/dbaccess/reviews/${r.id}?view=mine`}
                    className="flex min-w-0 items-center gap-3 py-2 text-sm outline-none hover:underline focus-visible:underline"
                  >
                    <ClipboardCheckIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t('pending', { count: r.pending, due: day(r.dueOn) })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.expiring.length > 0 && (
          <section aria-label={t('expiring')} className="grid gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{t('expiring')}</h3>
            <ul className="divide-y">
              {data.expiring.map((g) => (
                <li key={g.id} className="flex min-w-0 items-center gap-3 py-2 text-sm">
                  <AlarmClockIcon className="size-4 shrink-0 text-warning-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {l(g.role.name)} · {g.server.displayName}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('ends', { date: date(g.expiresAt) })}
                  </span>
                  {g.viewer.canExtend && (
                    <Link
                      href={`/dbaccess/request?extend=${g.id}`}
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      {t('extend')}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
