'use client';

import { HStack } from '@astryxdesign/core/Layout';
import type { Page } from '@isbp/sdk';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, RocketIcon } from 'lucide-react';
import Link from 'next/link';
import { useNow, useTimeZone, useTranslations } from 'next-intl';
import type { AppSummary, ReleaseSummary } from '../../contracts';
import { ReleaseStatusBadge } from '../badges';
import { isoToday, releaseHref } from '../lib';
import { PlannedDate, ReadinessSummary } from '../release-bits';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/** "Your work" on the home dashboard: the next releases of applications you own or deliver. */
export default function DashboardReleases() {
  const t = useTranslations('alm.dashboardCard');
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow();
  const owned = useApiQuery<Page<AppSummary>>('/alm/applications', { owner: 'me', pageSize: 1 });
  const has = (owned.data?.total ?? 0) > 0;
  const releases = useApiQuery<{ items: ReleaseSummary[] }>(has ? '/alm/releases' : null, {
    from: isoToday(timeZone, -1, now),
    to: isoToday(timeZone, 21, now),
    status: 'planned,in_progress,ready',
    mine: 'true',
  });
  if (!has) return null;
  const items = (releases.data?.items ?? []).slice(0, 5);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={RocketIcon} color="accent" />
            {t('title')}
          </HStack>
        </CardTitle>
        <CardDescription>{t('description', { count: owned.data!.total })}</CardDescription>
        <CardAction>
          <Button
            label={t('open')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href="/alm/releases?mine=true"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {releases.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !items.length ? (
          <p className="py-3 text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <ul className="divide-y">
            {items.map((r) => (
              <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <Link
                  href={releaseHref(r.application.code, r.version)}
                  className="min-w-0 flex-1 truncate font-medium outline-none hover:underline focus-visible:underline"
                >
                  {r.application.name} <span className="font-mono">{r.version}</span>
                </Link>
                <PlannedDate date={r.plannedDate} className="text-xs text-muted-foreground" />
                <ReleaseStatusBadge status={r.status} />
                <ReadinessSummary readiness={r.readiness} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
