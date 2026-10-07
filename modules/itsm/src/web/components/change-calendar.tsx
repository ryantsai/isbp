'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CalendarDaysIcon,
  CalendarRangeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
  ServerIcon,
  SirenIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTimeZone, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { ticketHref } from '../lib';
import { DAY, dayIn, keyOf, monthGrid, msOf, shiftMonth } from '../logic';
import type { CalendarItem, ChangeType } from '../types';
import { ChangeTypeBadge, changeTypeDot, PersonChip, RiskBadge, TicketStatusBadge } from './badges';

const TYPE_BAR: Record<ChangeType, string> = {
  standard: 'border-l-success',
  normal: 'border-l-info',
  emergency: 'border-l-destructive',
};

function Pill({ item }: { item: CalendarItem }) {
  const t = useTranslations('itsm');
  return (
    <Link
      href={ticketHref(item.reference)}
      title={`${item.reference} · ${item.title}`}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-sm border border-l-[3px] bg-card px-1.5 py-0.5 text-[11px] leading-tight shadow-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        TYPE_BAR[item.changeType],
        item.status === 'cancelled' && 'text-muted-foreground line-through',
      )}
    >
      {item.changeType === 'emergency' && (
        <SirenIcon className="size-3 shrink-0 text-destructive" aria-hidden />
      )}
      <span className="sr-only">{t(`changeType.${item.changeType}`)}: </span>
      <span className="truncate">{item.title}</span>
      {item.hasConflict && (
        <>
          <TriangleAlertIcon className="ml-auto size-3 shrink-0 text-warning-foreground" aria-hidden />
          <span className="sr-only">{t('changes.calendar.conflict')}</span>
        </>
      )}
    </Link>
  );
}

/** The month view: one bar per change on each day of its planned window. */
function MonthGrid({ month, items, timeZone }: { month: string; items: CalendarItem[]; timeZone: string }) {
  const t = useTranslations('itsm.changes.calendar');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const today = dayIn(now, timeZone);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const from = msOf(dayIn(new Date(it.plannedStart), timeZone));
      // A window ending exactly at midnight doesn't occupy the next day.
      const to = msOf(dayIn(new Date(new Date(it.plannedEnd).getTime() - 1), timeZone));
      for (let ms = from; ms <= Math.max(from, to) && ms - from < 62 * DAY; ms += DAY) {
        const key = keyOf(ms);
        map.set(key, [...(map.get(key) ?? []), it]);
      }
    }
    return map;
  }, [items, timeZone]);
  const weekday = (i: number) =>
    format.dateTime(new Date(Date.UTC(2024, 0, 1 + i)), { weekday: 'short', timeZone: 'UTC' });
  const longDay = (key: string) =>
    format.dateTime(new Date(msOf(key)), { dateStyle: 'full', timeZone: 'UTC' });

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <table className="w-full min-w-[44rem] table-fixed border-collapse text-sm">
        <caption className="sr-only">
          {t('caption', {
            month: format.dateTime(new Date(msOf(`${month}-01`)), {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }),
          })}
        </caption>
        <thead>
          <tr className="border-b bg-muted/40">
            {Array.from({ length: 7 }, (_, i) => (
              <th
                key={i}
                scope="col"
                className="px-2 py-2 text-left text-xs font-medium text-muted-foreground"
              >
                {weekday(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.key} className="border-b last:border-b-0">
              {week.map((d) => {
                const list = byDay.get(d.key) ?? [];
                const isToday = d.key === today;
                return (
                  <td
                    key={d.key}
                    className={cn(
                      'h-28 border-r p-1.5 align-top last:border-r-0',
                      !d.inMonth && 'bg-muted/30',
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <time
                        dateTime={d.key}
                        className={cn(
                          'grid size-6 place-items-center rounded-full text-xs tabular-nums',
                          isToday && 'bg-primary font-semibold text-primary-foreground',
                          !isToday && !d.inMonth && 'text-muted-foreground',
                        )}
                      >
                        <span aria-hidden>{d.day}</span>
                        <span className="sr-only">
                          {longDay(d.key)}
                          {isToday && ` (${t('today')})`}
                        </span>
                      </time>
                    </div>
                    {list.length > 0 && (
                      <ul className="grid gap-1" aria-label={t('changesOn', { day: longDay(d.key) })}>
                        {list.slice(0, 3).map((it) => (
                          <li key={it.id} className="min-w-0">
                            <Pill item={it} />
                          </li>
                        ))}
                        {list.length > 3 && (
                          <li className="px-1 text-[11px] text-muted-foreground">
                            {t('more', { count: list.length - 3 })}
                          </li>
                        )}
                      </ul>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The accessible list alternative (and the only view on narrow screens). */
function Agenda({ items, timeZone }: { items: CalendarItem[]; timeZone: string }) {
  const t = useTranslations('itsm.changes.calendar');
  const format = useFormatter();
  const groups = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of [...items].sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))) {
      const key = dayIn(new Date(it.plannedStart), timeZone);
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return [...map.entries()];
  }, [items, timeZone]);
  if (!groups.length)
    return (
      <EmptyState
        icon={<CalendarDaysIcon />}
        title={t('empty')}
        className="rounded-xl border border-dashed"
      />
    );
  return (
    <div className="grid gap-5">
      {groups.map(([day, list]) => (
        <section key={day} aria-labelledby={`agenda-${day}`} className="grid gap-2">
          <h3 id={`agenda-${day}`} className="text-sm font-semibold">
            {format.dateTime(new Date(msOf(day)), { dateStyle: 'full', timeZone: 'UTC' })}
          </h3>
          <ul className="grid gap-2">
            {list.map((it) => (
              <li key={it.id}>
                <Link
                  href={ticketHref(it.reference)}
                  className="grid gap-2 rounded-xl border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:grid-cols-[9rem_minmax(0,1fr)]"
                >
                  <span className="flex items-start gap-2 text-sm text-muted-foreground tabular-nums">
                    <span
                      className={cn('mt-1.5 size-2 shrink-0 rounded-full', changeTypeDot(it.changeType))}
                      aria-hidden
                    />
                    {format.dateTimeRange(new Date(it.plannedStart), new Date(it.plannedEnd), {
                      hour: '2-digit',
                      minute: '2-digit',
                      ...(dayIn(new Date(it.plannedStart), timeZone) !==
                      dayIn(new Date(it.plannedEnd), timeZone)
                        ? { month: 'short', day: 'numeric' }
                        : {}),
                    })}
                  </span>
                  <span className="grid min-w-0 gap-1.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs font-medium">{it.reference}</span>
                      <span className="min-w-0 truncate font-medium">{it.title}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ChangeTypeBadge type={it.changeType} />
                      <RiskBadge risk={it.risk} />
                      <TicketStatusBadge status={it.status} />
                      {it.hasConflict && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                          <TriangleAlertIcon className="size-3" aria-hidden />
                          {t('conflict')}
                        </span>
                      )}
                    </span>
                    {(it.cis.length > 0 || it.assignee) && (
                      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {it.cis.length > 0 && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <ServerIcon className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{it.cis.map((c) => c.name).join(', ')}</span>
                          </span>
                        )}
                        {it.assignee && <PersonChip person={it.assignee} className="text-xs" />}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The change calendar: month grid (wide screens) or agenda, with month navigation. */
export function ChangeCalendar({
  month,
  onMonthChange,
  display,
  onDisplayChange,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  display: 'month' | 'agenda';
  onDisplayChange: (d: 'month' | 'agenda') => void;
}) {
  const t = useTranslations('itsm.changes.calendar');
  const tt = useTranslations('itsm');
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow();
  // Query a day of margin on both sides; items are bucketed by day in the viewer's time zone.
  const weeks = monthGrid(month);
  const from = new Date(msOf(weeks[0]![0]!.key) - DAY).toISOString();
  const to = new Date(msOf(weeks.at(-1)![6]!.key) + 2 * DAY).toISOString();
  const { data, isLoading, isFetching, error } = useApiQuery<{ items: CalendarItem[] }>(
    '/itsm/changes/calendar',
    {
      from,
      to,
    },
  );
  const items = data?.items ?? [];
  const inMonth = items.filter((it) => {
    const s = dayIn(new Date(it.plannedStart), timeZone);
    const e = dayIn(new Date(it.plannedEnd), timeZone);
    return s.slice(0, 7) <= month && e.slice(0, 7) >= month;
  });
  const label = format.dateTime(new Date(msOf(`${month}-01`)), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const thisMonth = dayIn(now, timeZone).slice(0, 7);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            aria-label={t('previous')}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            aria-label={t('next')}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <h2 className="min-w-36 text-lg font-semibold" aria-live="polite">
          {label}
        </h2>
        {month !== thisMonth && (
          <Button variant="ghost" size="sm" onClick={() => onMonthChange(thisMonth)}>
            {t('today')}
          </Button>
        )}
        <div
          className="ml-auto hidden items-center gap-1 rounded-lg border p-0.5 md:flex"
          role="group"
          aria-label={t('display')}
        >
          <Button
            variant={display === 'month' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={display === 'month'}
            onClick={() => onDisplayChange('month')}
          >
            <CalendarRangeIcon />
            {t('month')}
          </Button>
          <Button
            variant={display === 'agenda' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={display === 'agenda'}
            onClick={() => onDisplayChange('agenda')}
          >
            <ListIcon />
            {t('agenda')}
          </Button>
        </div>
      </div>
      <ul
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-label={t('legend')}
      >
        {(['standard', 'normal', 'emergency'] as const).map((ct) => (
          <li key={ct} className="inline-flex items-center gap-1.5">
            <span className={cn('h-3 w-1 rounded-sm', changeTypeDot(ct))} aria-hidden />
            {tt(`changeType.${ct}`)}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <TriangleAlertIcon className="size-3.5 text-warning-foreground" aria-hidden />
          {t('conflict')}
        </li>
      </ul>
      {isLoading ? (
        <Skeleton className="h-[32rem] w-full rounded-xl" />
      ) : error ? (
        <EmptyState
          icon={<CalendarDaysIcon />}
          title={t('loadFailed')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <div
          className={cn('transition-opacity', isFetching && 'opacity-60')}
          aria-busy={isFetching || undefined}
        >
          <div className={cn(display === 'month' ? 'hidden md:block' : 'hidden')}>
            <MonthGrid month={month} items={items} timeZone={timeZone} />
          </div>
          <div className={cn(display === 'month' && 'md:hidden')}>
            <Agenda items={inMonth} timeZone={timeZone} />
          </div>
        </div>
      )}
    </div>
  );
}
