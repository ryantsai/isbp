'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
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
  const glyph = readiness.ready ? CircleCheckIcon : readiness.passed ? ListChecksIcon : CircleDashedIcon;
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)}
      title={t('summaryTitle', { passed: readiness.passed, total: readiness.total })}
    >
      <Icon icon={glyph} size="xsm" color={readiness.ready ? 'success' : 'secondary'} />
      <Text size="xsm" weight="medium" color={readiness.ready ? 'primary' : 'secondary'}>
        {readiness.ready ? t('ready') : t('progress', { passed: readiness.passed, total: readiness.total })}
      </Text>
    </span>
  );
}

/** The best linked change (status chip), or "No change". */
export function LinkedChangeChip({ changes }: { changes: ChangeInfo[] }) {
  const t = useTranslations('alm.changes');
  const best = changes[0];
  if (!best)
    return (
      <Text size="xsm" color="secondary">
        {t('none')}
      </Text>
    );
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <ChangeStatusChip reference={best.reference} status={best.status} />
      {changes.length > 1 && (
        <Text size="xsm" color="secondary">
          +{changes.length - 1}
        </Text>
      )}
    </span>
  );
}

/** A calendar date (`YYYY-MM-DD`) formatted without time-zone drift. */
export function PlannedDate({ date, className }: { date: string | null; className?: string }) {
  const format = useFormatter();
  if (!date)
    return (
      <Text color="secondary" className={className}>
        —
      </Text>
    );
  return (
    <time dateTime={date} className={className}>
      {format.dateTime(dateOnly(date), { dateStyle: 'medium', timeZone: 'UTC' })}
    </time>
  );
}
