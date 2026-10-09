'use client';

import type { Page } from '@isbp/sdk';
import { ErrorState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, LifeBuoyIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TicketListItem } from '../../contracts';
import { PriorityBadge, TicketStatusBadge, TypeIcon } from '../components/badges';
import { ticketHref } from '../lib';

/** `cmdb.ci.related`: open tickets that affect the CI (agents with `itsm.tickets.read`). */
export default function CiRelatedTickets({ ci }: { ci: { id: string; number: number; name: string } }) {
  const t = useTranslations('itsm.ciRelated');
  const { data, isLoading, error, refetch } = useApiQuery<Page<TicketListItem>>('/itsm/tickets', {
    ciId: ci.id,
    status: 'open',
    pageSize: 5,
  });
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2" aria-labelledby={`itsm-ci-${ci.id}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`itsm-ci-${ci.id}`} className="flex items-center gap-2 text-sm font-semibold">
          <LifeBuoyIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
          {data && data.total > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
              {data.total}
            </span>
          )}
        </h3>
        {data && data.total > 5 && (
          <Link
            href={`/itsm?type=__all__&ciId=${ci.id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t('viewAll')}
            <ArrowRightIcon className="size-3" aria-hidden />
          </Link>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : error ? (
        <ErrorState compact error={error} onRetry={() => void refetch()} title={t('unavailable')} />
      ) : !data?.items.length ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="divide-y">
          {data.items.map((r) => (
            <li key={r.id}>
              <Link
                href={ticketHref(r.reference)}
                className="flex min-w-0 items-center gap-2 py-2 text-sm outline-none hover:underline focus-visible:underline"
              >
                <TypeIcon type={r.type} label className="text-muted-foreground" />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.reference}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <PriorityBadge priority={r.priority} />
                <TicketStatusBadge status={r.status} className="hidden sm:inline-flex" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
