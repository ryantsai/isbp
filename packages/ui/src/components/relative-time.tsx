'use client';

import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useNow, useTranslations } from 'next-intl';

/**
 * "3 minutes ago" as a `<time>`; hovering (or focusing) it shows the full date and time. It takes the text style of
 * its surroundings.
 */
export function RelativeTime({
  date,
  className,
}: {
  date: string | Date | null | undefined;
  className?: string;
}) {
  const now = useNow({ updateInterval: 60_000 });
  const t = useTranslations('common');
  if (!date) {
    return (
      <Text color={className ? 'inherit' : 'secondary'} className={className}>
        {t('never')}
      </Text>
    );
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  // A just-created record can be a little "in the future" of a stale client clock: show it as now.
  const shown = d > now && d.getTime() - now.getTime() < 5 * 60_000 ? now : d;
  return (
    <Timestamp
      value={shown.toISOString()}
      format="relative"
      type="inherit"
      color="inherit"
      isLive
      className={className}
    />
  );
}

/** An absolute date and time ("Oct 11, 2026, 3:30 PM") in the viewer's zone, for detail pages. */
export function DateTime({
  date,
  className,
}: {
  date: string | Date | null | undefined;
  className?: string;
}) {
  const t = useTranslations('common');
  if (!date) {
    return (
      <Text color={className ? 'inherit' : 'secondary'} className={className}>
        {t('never')}
      </Text>
    );
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  return (
    <Timestamp
      value={d.toISOString()}
      format="date_time"
      type="inherit"
      color="inherit"
      hasTooltip={false}
      className={className}
    />
  );
}
