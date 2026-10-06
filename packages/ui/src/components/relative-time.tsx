'use client';

import { useFormatter, useNow, useTranslations } from 'next-intl';

/** "3 minutes ago" with the absolute timestamp in a tooltip (title) and <time> semantics. */
export function RelativeTime({
  date,
  className,
}: {
  date: string | Date | null | undefined;
  className?: string;
}) {
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const t = useTranslations('common');
  if (!date) return <span className={className ?? 'text-muted-foreground'}>{t('never')}</span>;
  const d = typeof date === 'string' ? new Date(date) : date;
  return (
    <time
      dateTime={d.toISOString()}
      title={format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })}
      className={className}
    >
      {/* A just-created record can be a little "in the future" of a stale client clock: show it as now. */}
      {format.relativeTime(d, d > now && d.getTime() - now.getTime() < 5 * 60_000 ? d : now)}
    </time>
  );
}

export function DateTime({
  date,
  className,
}: {
  date: string | Date | null | undefined;
  className?: string;
}) {
  const format = useFormatter();
  const t = useTranslations('common');
  if (!date) return <span className={className ?? 'text-muted-foreground'}>{t('never')}</span>;
  const d = typeof date === 'string' ? new Date(date) : date;
  return (
    <time dateTime={d.toISOString()} className={className}>
      {format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  );
}
