'use client';

import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, ShieldCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Dashboard } from '../../contracts';
import { ReviewStatusBadge } from '../badges';
import { reviewHref, stocktakeHref, useDay } from '../lib';

/**
 * The home card for the people who run information security: assets by value, stocktakes and account reviews in
 * progress. People who only take part (their checks, reviews and passwords to change) find those on My work, so they
 * get no card here. Nothing to show: no card.
 */
export default function IsmsDashboardCard() {
  const readsAssets = useCan('isms.assets.read');
  const runsStocktakes = useCan('isms.stocktakes.manage');
  const readsReviews = useCan('isms.reviews.read');
  const runsReviews = useCan('isms.reviews.manage');
  if (!readsAssets && !runsStocktakes && !readsReviews && !runsReviews) return null;
  return <IsmsOverviewCard />;
}

function IsmsOverviewCard() {
  const t = useTranslations('isms.dashboard');
  const day = useDay();
  const { data, isLoading } = useApiQuery<Dashboard>('/isms/dashboard');
  if (isLoading)
    return (
      <Card className="min-w-0">
        <CardContent>
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  if (!data) return null;
  const empty = !data.assets?.total && !data.stocktakes.length && !data.reviews.length;
  if (empty) return null;
  const max = Math.max(1, ...(data.assets?.byValue.map((v) => v.count) ?? [1]));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon aria-hidden className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href={data.assets ? '/isms' : '/isms/stocktakes'}>
              {t('open')}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {data.assets && data.assets.total > 0 && (
          <section aria-labelledby="isms-dash-value" className="space-y-1.5">
            <h3 id="isms-dash-value" className="text-xs font-semibold text-muted-foreground">
              {t('byValue', { total: data.assets.total })}
            </h3>
            <table className="w-full text-xs">
              <caption className="sr-only">{t('byValueCaption')}</caption>
              <tbody>
                {[...data.assets.byValue].reverse().map((v) => (
                  <tr key={v.value}>
                    <th scope="row" className="w-16 py-0.5 pr-2 text-left font-normal text-muted-foreground">
                      {t('value', { value: v.value })}
                    </th>
                    <td className="py-0.5">
                      <div
                        className="h-2 rounded-full bg-primary/70"
                        style={{ width: `${(v.count / max) * 100}%`, minWidth: v.count ? 4 : 0 }}
                        aria-hidden
                      />
                    </td>
                    <td className="w-10 py-0.5 pl-2 text-right tabular-nums">{v.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {data.stocktakes.length > 0 && (
          <section aria-labelledby="isms-dash-st" className="space-y-1">
            <h3 id="isms-dash-st" className="text-xs font-semibold text-muted-foreground">
              {t('stocktakes')}
            </h3>
            <ul className="divide-y">
              {data.stocktakes.map((s) => (
                <li key={s.id} className="flex min-w-0 items-center gap-2 py-1.5">
                  <Link href={stocktakeHref(s.reference)} className="min-w-0 flex-1 truncate hover:underline">
                    {s.name}
                  </Link>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t('percent', { percent: s.percent })}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{day(s.dueOn)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.reviews.length > 0 && (
          <section aria-labelledby="isms-dash-rv" className="space-y-1">
            <h3 id="isms-dash-rv" className="text-xs font-semibold text-muted-foreground">
              {t('reviews')}
            </h3>
            <ul className="divide-y">
              {data.reviews.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-2 py-1.5">
                  <Link href={reviewHref(r.reference)} className="min-w-0 flex-1 truncate hover:underline">
                    {r.target}
                  </Link>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t('percent', { percent: r.percent })}
                  </span>
                  <ReviewStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
