'use client';

import type { Page } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  AlarmClockOffIcon,
  ArrowRightIcon,
  InboxIcon,
  LifeBuoyIcon,
  type LucideIcon,
  UserCheckIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { TicketListItem } from '../../contracts';
import { PriorityBadge, SlaChip } from '../components/badges';
import { ticketHref } from '../lib';
import { mostUrgent } from '../logic';
import type { QueueCounts } from '../types';

const SUMMARY: { view: string; count: keyof QueueCounts; icon: LucideIcon; alert?: boolean }[] = [
  { view: 'assigned', count: 'assigned', icon: UserCheckIcon },
  { view: 'unassigned', count: 'unassigned', icon: InboxIcon },
  { view: 'attention', count: 'attention', icon: AlarmClockOffIcon, alert: true },
];

/**
 * "Your work" card on the home dashboard (`core.dashboard.work`): the queues that need the agent and their most
 * urgent tickets. Renders nothing when nothing waits (Home shows only what needs the person).
 */
export default function DashboardWorkCard() {
  const t = useTranslations('itsm.dashboardCard');
  const tq = useTranslations('itsm.desk.queues');
  const counts = useApiQuery<QueueCounts>('/itsm/queues', undefined, { refetchInterval: 60_000 });
  const now = useNow({ updateInterval: 60_000 });
  const mine = useApiQuery<Page<TicketListItem>>('/itsm/tickets', {
    view: 'assigned',
    status: 'open',
    sort: 'priority',
    pageSize: 50,
  });
  const urgent = useMemo(() => mostUrgent(mine.data?.items ?? [], now).slice(0, 3), [mine.data, now]);
  const c = counts.data;
  if (c && !c.assigned && !c.unassigned && !c.attention) return null;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoyIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/itsm">
              {t('open')}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="grid grid-cols-3 gap-2" aria-label={t('queues')}>
          {SUMMARY.map((q) => {
            const value = counts.data?.[q.count];
            const hot = q.alert && (value ?? 0) > 0;
            const Icon = q.icon;
            return (
              <li key={q.view} className="min-w-0">
                {/* Label on top with the full tile width, so the queues fit side by side in a half-width card. */}
                <Link
                  href={`/itsm?view=${q.view}`}
                  className={cn(
                    'flex h-full flex-col justify-between gap-1 rounded-lg border px-3 py-2 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    hot && 'border-destructive/30 bg-destructive/5',
                  )}
                >
                  <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {tq(q.view)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Icon
                      className={cn('size-3.5 shrink-0 text-muted-foreground', hot && 'text-destructive')}
                      aria-hidden
                    />
                    {value === undefined ? (
                      <Skeleton className="h-6 w-8" />
                    ) : (
                      <span className={cn('text-lg font-semibold', hot && 'text-destructive')}>{value}</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {/* min-w-0: long (nowrap) titles truncate instead of widening the card at 375 px. */}
        <div className="grid min-w-0 gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">{t('mostUrgent')}</h3>
          {mine.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !urgent.length ? (
            <p className="py-3 text-sm text-muted-foreground">{t('nothingAssigned')}</p>
          ) : (
            <ul className="min-w-0 divide-y">
              {urgent.map((r) => (
                <li key={r.id}>
                  <Link
                    href={ticketHref(r.reference)}
                    className="flex items-center gap-3 py-2.5 text-sm outline-none hover:underline focus-visible:underline"
                  >
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.reference}</span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <PriorityBadge priority={r.priority} />
                    <SlaChip sla={r.sla} className="hidden sm:inline-flex" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
