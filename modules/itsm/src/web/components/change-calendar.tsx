'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { NavProgress, useReducedMotion } from '@isbp/ui/motion';
import { useApiInfiniteQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  LoaderCircleIcon,
  type LucideIcon,
  ServerIcon,
  TriangleAlertIcon,
  ZapIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useFormatter, useNow, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ticketHref } from '../lib';
import { DAY, dayIn, keyOf, monthGrid, msOf, shiftMonth } from '../logic';
import type { CalendarItem, CalendarPage } from '../types';
import { CHANGE_TYPE_ICON, ChangeTypeBadge, PersonChip, RiskBadge, TicketStatusBadge } from './badges';

/** How a change's chip looks, by where it stands (never colour alone: outline style + icon + text for screen readers). */
type Stage = 'notSubmitted' | 'waiting' | 'scheduled' | 'done' | 'cancelled';
export function stageOf(status: CalendarItem['status']): Stage {
  if (status === 'draft' || status === 'assessment' || status === 'rejected') return 'notSubmitted';
  if (status === 'authorization') return 'waiting';
  if (status === 'scheduled' || status === 'implementing') return 'scheduled';
  if (status === 'cancelled') return 'cancelled';
  return 'done';
}

const STAGE_ICON: Partial<Record<Stage, LucideIcon>> = {
  waiting: ClockIcon,
  done: CheckIcon,
};

const STAGE_CLASS: Record<Stage, string> = {
  notSubmitted: 'border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground',
  waiting: 'border-info/40 bg-info/8',
  scheduled: 'border-primary/30 bg-primary/10 font-medium',
  done: 'border-border bg-muted/50 text-muted-foreground',
  cancelled: 'border-dashed bg-transparent text-muted-foreground line-through',
};

function Pill({ item, timeZone }: { item: CalendarItem; timeZone: string }) {
  const t = useTranslations('itsm');
  const format = useFormatter();
  const stage = stageOf(item.status);
  const Icon = STAGE_ICON[stage];
  return (
    <Link
      href={ticketHref(item.reference)}
      title={`${item.reference} · ${item.title}`}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] leading-tight transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none',
        STAGE_CLASS[stage],
      )}
    >
      {Icon && <Icon className="size-3 shrink-0" aria-hidden />}
      {item.changeType === 'emergency' && <ZapIcon className="size-3 shrink-0" aria-hidden />}
      <span className="shrink-0 tabular-nums">
        {format.dateTime(new Date(item.plannedStart), { hour: '2-digit', minute: '2-digit', timeZone })}
      </span>
      <span className="sr-only">
        {t(`changeType.${item.changeType}`)}, {t(`changes.calendar.stage.${stage}`)}:{' '}
      </span>
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
    <div className="overflow-x-auto rounded-xl border bg-card">
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
                            <Pill item={it} timeZone={timeZone} />
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
  const tt = useTranslations('itsm');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
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
                  className="grid gap-2 rounded-xl border bg-card p-3 transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:grid-cols-[9rem_minmax(0,1fr)]"
                >
                  <span className="flex items-start gap-2 text-sm text-muted-foreground tabular-nums">
                    {(() => {
                      const Icon = CHANGE_TYPE_ICON[it.changeType];
                      return <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />;
                    })()}
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
                      <TicketStatusBadge status={it.status} />
                      <ChangeTypeBadge type={it.changeType} />
                      <RiskBadge risk={it.risk} />
                      {stageOf(it.status) === 'notSubmitted' &&
                        new Date(it.plannedStart).getTime() < now.getTime() &&
                        it.changeType !== 'emergency' && (
                          <StatusBadge
                            tone="warning"
                            icon={TriangleAlertIcon}
                            label={tt('changePlan.windowPassed')}
                          />
                        )}
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

/** The month view fetches at most this many pages (200 changes each) by itself; the agenda's "Show more" goes on. */
const AUTO_PAGES = 10;

/**
 * The agenda's "Show more". Focus stays on the button while more pages follow; when the last page is in, the button
 * goes, so focus moves to the status line instead of falling back to the top of the page.
 */
function ShowMore({
  more,
  loading,
  count,
  onMore,
}: {
  more: boolean;
  loading: boolean;
  count: number;
  onMore: () => Promise<{ hasNextPage: boolean }>;
}) {
  const t = useTranslations('itsm.changes.calendar');
  const doneRef = useRef<HTMLParagraphElement>(null);
  return (
    <div className="mt-4 grid justify-items-center gap-2">
      {more && (
        <Button
          variant="outline"
          aria-disabled={loading || undefined}
          onClick={async () => {
            if (loading) return;
            const next = await onMore();
            if (!next.hasNextPage) doneRef.current?.focus();
          }}
        >
          {loading && (
            <LoaderCircleIcon
              className="animate-spin motion-reduce:animate-[spin_2s_linear_infinite]"
              aria-hidden
            />
          )}
          {t('showMore')}
        </Button>
      )}
      <p
        ref={doneRef}
        role="status"
        tabIndex={-1}
        className="text-sm text-muted-foreground focus:outline-none"
      >
        {!more && count > 0 && t('allShown', { count })}
      </p>
    </div>
  );
}

/** The change calendar: month grid (wide screens) or agenda, with month navigation. */
export function ChangeCalendar({
  month,
  onMonthChange,
  display,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  display: 'month' | 'agenda';
}) {
  const t = useTranslations('itsm.changes.calendar');
  const tt = useTranslations('itsm');
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow();
  const reduce = useReducedMotion();
  // The grid slides 8 px in the direction of travel when the month changes.
  const [shown, setShown] = useState(month);
  const [direction, setDirection] = useState(0);
  if (shown !== month) {
    setDirection(month > shown ? 1 : -1);
    setShown(month);
  }
  // Query a day of margin on both sides; items are bucketed by day in the viewer's time zone.
  const weeks = monthGrid(month);
  const from = new Date(msOf(weeks[0]![0]!.key) - DAY).toISOString();
  const to = new Date(msOf(weeks.at(-1)![6]!.key) + 2 * DAY).toISOString();
  const tc = useTranslations('common');
  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    isPlaceholderData,
    hasNextPage,
    error,
    refetch,
    fetchNextPage,
  } = useApiInfiniteQuery<CalendarPage>('/itsm/changes/calendar', { from, to });
  const pageCount = data?.pages.length ?? 0;
  const items = useMemo(() => (data?.pages ?? []).flatMap((p) => p.items), [data]);
  // While the previous month's pages stay on screen, the next pages of this one aren't known yet.
  const more = hasNextPage && !isPlaceholderData;
  // The month grid needs every change of its window, so the month view fetches the following pages by itself, up to
  // AUTO_PAGES. Past that, or after a failed page, the agenda's "Show more" loads the rest.
  const autoLoading = display === 'month' && more && !error && pageCount < AUTO_PAGES;
  useEffect(() => {
    if (autoLoading && !isFetchingNextPage) void fetchNextPage();
  }, [autoLoading, isFetchingNextPage, fetchNextPage]);
  const capped = display === 'month' && more && pageCount >= AUTO_PAGES;
  const failed = Boolean(error) && pageCount > 0;
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
      </div>
      <ul
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
        aria-label={t('legend')}
      >
        {(['notSubmitted', 'waiting', 'scheduled', 'done'] as const).map((stage) => {
          const Icon = STAGE_ICON[stage];
          return (
            <li key={stage} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex h-4 w-6 items-center justify-center rounded-sm border',
                  STAGE_CLASS[stage],
                )}
                aria-hidden
              >
                {Icon && <Icon className="size-3" />}
              </span>
              {t(`stage.${stage}`)}
            </li>
          );
        })}
        <li className="inline-flex items-center gap-1.5">
          <ZapIcon className="size-3.5" aria-hidden />
          {tt('changeType.emergency')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <TriangleAlertIcon className="size-3.5 text-warning-foreground" aria-hidden />
          {t('conflict')}
        </li>
      </ul>
      {isLoading ? (
        <Skeleton className="h-[32rem] w-full rounded-xl" />
      ) : error && !pageCount ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <div className="relative overflow-hidden" aria-busy={isFetching || undefined}>
          {/* Always mounted, so the loading message is announced when it appears. */}
          <div role="status" className="text-sm text-muted-foreground">
            {isFetchingNextPage && (
              <p className="mb-2 inline-flex items-center gap-2">
                <LoaderCircleIcon
                  className="size-3.5 animate-spin motion-reduce:animate-[spin_2s_linear_infinite]"
                  aria-hidden
                />
                {t('loadingMore')}
              </p>
            )}
          </div>
          {capped && (
            <p className="mb-2 text-sm text-muted-foreground">{t('capped', { count: items.length })}</p>
          )}
          {failed && (
            <div role="alert" className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{t('partialFailed')}</span>
              <Button variant="outline" size="sm" onClick={() => void fetchNextPage()}>
                {tc('retry')}
              </Button>
            </div>
          )}
          <NavProgress active={isFetching} />
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={month}
              custom={direction}
              initial={reduce ? false : { opacity: 0, x: 8 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: -8 * direction }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className={cn(display === 'month' ? 'hidden md:block' : 'hidden')}>
                <MonthGrid month={month} items={items} timeZone={timeZone} />
              </div>
              <div className={cn(display === 'month' && 'md:hidden')}>
                <Agenda items={inMonth} timeZone={timeZone} />
                {!autoLoading && !isPlaceholderData && (more || pageCount > 1) && (
                  <ShowMore
                    more={more}
                    loading={isFetchingNextPage}
                    count={inMonth.length}
                    onMore={() => fetchNextPage()}
                  />
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
