'use client';

import { cn } from '@isbp/ui';
import { CalendarClockIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { ChangeInfo } from '../contracts';
import { ChangeStatusChip } from './badges';

/** "Oct 12, 19:00 – 21:00" — a change's planned window. */
export function useWindowText() {
  const format = useFormatter();
  return (c: Pick<ChangeInfo, 'plannedStart' | 'plannedEnd'>) =>
    c.plannedStart && c.plannedEnd
      ? format.dateTimeRange(new Date(c.plannedStart), new Date(c.plannedEnd), {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
}

/** One ITSM change: reference (linked to ITSM), title, status chip and planned window. */
export function ChangeLine({ change, className }: { change: ChangeInfo; className?: string }) {
  const t = useTranslations('alm.changes');
  const windowText = useWindowText();
  const w = windowText(change);
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={change.href}
          className="font-mono text-xs font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {change.reference}
        </Link>
        <ChangeStatusChip status={change.status} />
      </div>
      <p className="truncate text-sm">{change.title}</p>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden />
        {w ? (
          <>
            <span>{w}</span>
            {change.authorized && (
              <span className={change.inWindow ? 'text-success' : 'text-warning-foreground'}>
                · {change.inWindow ? t('inWindow') : t('outsideWindow')}
              </span>
            )}
          </>
        ) : (
          t('noWindow')
        )}
      </p>
    </div>
  );
}
