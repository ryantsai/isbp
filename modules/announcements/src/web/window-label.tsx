'use client';

import { useFormatter } from 'next-intl';
import { CalendarClockIcon } from 'lucide-react';

/** "Sat, Oct 10, 22:00 – 02:00" style time window for maintenance slots. */
export function WindowLabel({ startsAt, endsAt }: { startsAt: string | null; endsAt: string | null }) {
  const format = useFormatter();
  if (!startsAt && !endsAt) return null;
  const opts = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  } as const;
  const text =
    startsAt && endsAt
      ? format.dateTimeRange(new Date(startsAt), new Date(endsAt), opts)
      : format.dateTime(new Date((startsAt ?? endsAt)!), opts);
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <CalendarClockIcon className="size-4" aria-hidden />
      {text}
    </span>
  );
}
