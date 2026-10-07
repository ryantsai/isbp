'use client';

import { cn } from '@isbp/ui';
import { CircleCheckIcon, CircleDashedIcon, ListChecksIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ChangeInfo, ReleaseSummary } from '../contracts';
import { ChangeStatusChip } from './badges';
import { dateOnly } from './lib';

/** "3/4 ready" with an icon; all four checks → a success tone. */
export function ReadinessSummary({
  readiness,
  className,
}: {
  readiness: ReleaseSummary['readiness'];
  className?: string;
}) {
  const t = useTranslations('alm.readiness');
  const Icon = readiness.ready ? CircleCheckIcon : readiness.passed ? ListChecksIcon : CircleDashedIcon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap',
        readiness.ready ? 'text-success' : 'text-muted-foreground',
        className,
      )}
      title={t('summaryTitle', { passed: readiness.passed, total: readiness.total })}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {readiness.ready ? t('ready') : t('progress', { passed: readiness.passed, total: readiness.total })}
    </span>
  );
}

/** The best linked change (status chip), or "No change". */
export function LinkedChangeChip({ changes }: { changes: ChangeInfo[] }) {
  const t = useTranslations('alm.changes');
  const best = changes[0];
  if (!best) return <span className="text-xs text-muted-foreground">{t('none')}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <ChangeStatusChip reference={best.reference} status={best.status} />
      {changes.length > 1 && <span className="text-xs text-muted-foreground">+{changes.length - 1}</span>}
    </span>
  );
}

/** A calendar date (`YYYY-MM-DD`) formatted without time-zone drift. */
export function PlannedDate({ date, className }: { date: string | null; className?: string }) {
  const format = useFormatter();
  if (!date) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <time dateTime={date} className={className}>
      {format.dateTime(dateOnly(date), { dateStyle: 'medium', timeZone: 'UTC' })}
    </time>
  );
}
