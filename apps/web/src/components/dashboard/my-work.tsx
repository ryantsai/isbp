'use client';

import type { ApprovalItem, MyRequest } from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { AnimatedNumber, FadeIn } from '@isbp/ui/motion';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, ClipboardListIcon, ListChecksIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useNow, useTranslations } from 'next-intl';
import { useApiQuery } from '@/lib/api';
import { useBadges } from '../shell/live';
import { RequestStatus, requestHref } from '../requests/request-status';
import { DueBadge } from '../workflows/status-badges';

/** "Your work": approvals waiting for you and your open requests — for everyone, admins or not. */
export function MyWork() {
  const t = useTranslations('dashboard.myWork');
  const locale = useLocale();
  const now = useNow({ updateInterval: 60_000 });
  const badges = useBadges();
  const approvals = useApiQuery<Page<ApprovalItem>>('/me/approvals', { pageSize: 3 });
  const requests = useApiQuery<Page<MyRequest>>('/me/requests', { status: 'open', pageSize: 3 });

  return (
    <FadeIn className="grid gap-4 lg:grid-cols-2">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecksIcon className="size-4 text-primary" aria-hidden />
            {t('approvals')}
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
              <AnimatedNumber value={badges.approvals} />
            </span>
          </CardTitle>
          <CardDescription>{t('approvalsHint')}</CardDescription>
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href="/approvals">
                {t('open')}
                <ArrowRightIcon />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {approvals.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !approvals.data?.items.length ? (
            <p className="py-4 text-sm text-muted-foreground">{t('noApprovals')}</p>
          ) : (
            <ul className="divide-y">
              {approvals.data.items.map((a) => (
                <li key={a.task.id}>
                  <Link
                    href="/approvals"
                    className="flex items-center gap-3 py-2.5 text-sm outline-none hover:underline focus-visible:underline"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {localize(a.instance.subject.label, locale)}
                    </span>
                    <DueBadge dueAt={a.task.dueAt} now={now} />
                    <RelativeTime
                      date={a.task.createdAt}
                      className="hidden shrink-0 text-xs text-muted-foreground sm:block"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardListIcon className="size-4 text-primary" aria-hidden />
            {t('requests')}
          </CardTitle>
          <CardDescription>{t('requestsHint')}</CardDescription>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link href="/requests">
                <PlusIcon />
                {t('newRequest')}
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {requests.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !requests.data?.items.length ? (
            <p className="py-4 text-sm text-muted-foreground">{t('noRequests')}</p>
          ) : (
            <ul className="divide-y">
              {requests.data.items.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <Link
                    href={requestHref(r)}
                    className="flex items-center gap-3 py-2.5 text-sm outline-none hover:underline focus-visible:underline"
                  >
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.reference}</span>
                    <span className="min-w-0 flex-1 truncate">{localize(r.title, locale)}</span>
                    <RequestStatus r={r} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </FadeIn>
  );
}
