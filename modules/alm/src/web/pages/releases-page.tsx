'use client';

import type { Page } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { Label } from '@isbp/ui/label';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTimeZone, useTranslations } from 'next-intl';
import { useId } from 'react';
import { type AppSummary, RELEASE_STATUSES, type ReleaseSummary } from '../../contracts';
import { RELEASE_META, ReleaseStatusBadge } from '../badges';
import { appHref, dateOnly, isoToday, releaseHref } from '../lib';
import { LinkedChangeChip, ReadinessSummary } from '../release-bits';

const ALL = '__all__';
const OPEN = 'planned,in_progress,ready';
const DAY = 86_400_000;
const WEEKS = 8;

/** `YYYY-MM-DD` arithmetic on calendar dates (UTC midnight, no time-zone drift). */
const addDays = (iso: string, days: number) =>
  new Date(dateOnly(iso).getTime() + days * DAY).toISOString().slice(0, 10);
const mondayOf = (iso: string) => addDays(iso, -((dateOnly(iso).getUTCDay() + 6) % 7));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function ReleaseRow({ r }: { r: ReleaseSummary }) {
  const format = useFormatter();
  return (
    <li className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <time
        dateTime={r.plannedDate ?? undefined}
        className="w-24 shrink-0 text-sm text-muted-foreground tabular-nums"
      >
        {r.plannedDate &&
          format.dateTime(dateOnly(r.plannedDate), {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          })}
      </time>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <Link
            href={releaseHref(r.application.code, r.version)}
            className="font-mono font-medium hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {r.application.code} {r.version}
          </Link>
          {r.name && <span className="truncate text-sm text-muted-foreground">{r.name}</span>}
        </span>
        <Link
          href={appHref(r.application.code)}
          className="w-fit truncate text-xs text-muted-foreground hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {r.application.name}
        </Link>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ReleaseStatusBadge status={r.status} />
        <LinkedChangeChip changes={r.changes} />
        {r.status !== 'released' && r.status !== 'cancelled' && <ReadinessSummary readiness={r.readiness} />}
      </div>
    </li>
  );
}

/** Releases grouped by week (Monday first). */
function Agenda({ items, from }: { items: ReleaseSummary[]; from: string }) {
  const t = useTranslations('alm.calendar');
  const format = useFormatter();
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(from, i * 7));
  const byWeek = new Map<string, ReleaseSummary[]>();
  for (const r of items) {
    if (!r.plannedDate) continue;
    const w = mondayOf(r.plannedDate);
    byWeek.set(w, [...(byWeek.get(w) ?? []), r]);
  }
  return (
    <Stagger className="grid gap-4">
      {weeks.map((w) => {
        const list = byWeek.get(w) ?? [];
        const headingId = `alm-week-${w}`;
        return (
          <StaggerItem key={w}>
            <section
              aria-labelledby={headingId}
              className="overflow-hidden rounded-xl border bg-card shadow-xs"
            >
              <h2
                id={headingId}
                className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm font-semibold"
              >
                <span>
                  {t('weekOf', {
                    range: format.dateTimeRange(dateOnly(w), dateOnly(addDays(w, 6)), {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    }),
                  })}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t('count', { count: list.length })}
                </span>
              </h2>
              {list.length ? (
                <ul className="divide-y">
                  {list.map((r) => (
                    <ReleaseRow key={r.id} r={r} />
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">{t('nothingPlanned')}</p>
              )}
            </section>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

/** A month grid (Monday first): each release as a chip with its status icon. */
function MonthGrid({ items, month }: { items: ReleaseSummary[]; month: string }) {
  const t = useTranslations('alm');
  const format = useFormatter();
  const first = `${month}-01`;
  const start = mondayOf(first);
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 10);
  const days: string[] = [];
  for (let d = start; d < next || days.length % 7; d = addDays(d, 1)) days.push(d);
  const byDay = new Map<string, ReleaseSummary[]>();
  for (const r of items)
    if (r.plannedDate) byDay.set(r.plannedDate, [...(byDay.get(r.plannedDate) ?? []), r]);
  const weekdays = days
    .slice(0, 7)
    .map((d) => format.dateTime(dateOnly(d), { weekday: 'short', timeZone: 'UTC' }));
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div
        className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground"
        aria-hidden
      >
        {weekdays.map((w) => (
          <span key={w} className="py-2">
            {w}
          </span>
        ))}
      </div>
      <ol className="grid grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          return (
            <li
              key={d}
              className={cn(
                'min-h-24 min-w-0 border-r border-b p-1 sm:p-1.5 [&:nth-child(7n)]:border-r-0',
                !inMonth && 'bg-muted/30',
              )}
            >
              <span className={cn('block text-xs', inMonth ? 'text-foreground' : 'text-muted-foreground')}>
                <span className="sr-only">
                  {format.dateTime(dateOnly(d), { dateStyle: 'full', timeZone: 'UTC' })}
                </span>
                <span aria-hidden>{Number(d.slice(8))}</span>
              </span>
              {list.length > 0 && (
                <ul className="mt-1 grid gap-1">
                  {list.map((r) => {
                    const Icon = RELEASE_META[r.status].icon;
                    return (
                      <li key={r.id} className="min-w-0">
                        <Link
                          href={releaseHref(r.application.code, r.version)}
                          className="flex min-w-0 items-center gap-1 rounded bg-primary/10 px-1 py-0.5 text-[11px] text-primary hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                          title={`${r.application.name} ${r.version} · ${t(`releaseStatus.${r.status}`)}`}
                        >
                          <Icon className="size-3 shrink-0" aria-hidden />
                          <span className="truncate font-mono">
                            {r.application.code} {r.version}
                          </span>
                          <span className="sr-only">{t(`releaseStatus.${r.status}`)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The cross-application release calendar: the coming weeks as an agenda, or a month grid. */
export default function ReleasesPage() {
  const t = useTranslations('alm');
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow();
  const ids = { mine: useId() };
  const [state, set] = useListState();
  const today = isoToday(timeZone, 0, now);
  const view = state.view === 'month' ? 'month' : 'agenda';
  const from = ISO_DATE.test(String(state.from)) ? mondayOf(String(state.from)) : mondayOf(today);
  const month = ISO_MONTH.test(String(state.month)) ? String(state.month) : today.slice(0, 7);
  const status = (state.status as string | undefined) ?? OPEN;
  const application = (state.app as string | undefined) || undefined;
  const mine = state.mine === 'true';

  const range =
    view === 'agenda'
      ? { from, to: addDays(from, WEEKS * 7 - 1) }
      : { from: mondayOf(`${month}-01`), to: addDays(mondayOf(`${month}-01`), 41) };
  const { data, isLoading, isFetching } = useApiQuery<{ items: ReleaseSummary[] }>('/alm/releases', {
    ...range,
    status: status === ALL ? undefined : status,
    application,
    mine: mine ? 'true' : undefined,
  });
  const apps = useApiQuery<Page<AppSummary>>('/alm/applications', { pageSize: 200, sort: 'name' });

  const shiftMonth = (by: number) => {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
    return d.toISOString().slice(0, 7);
  };
  const label =
    view === 'agenda'
      ? format.dateTimeRange(dateOnly(range.from), dateOnly(range.to), {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : format.dateTime(dateOnly(`${month}-01`), { year: 'numeric', month: 'long', timeZone: 'UTC' });
  const step = (by: -1 | 1) =>
    view === 'agenda' ? set({ from: addDays(from, by * WEEKS * 7) }) : set({ month: shiftMonth(by) });

  const body = isLoading ? (
    <Skeleton className="h-96 w-full rounded-xl" />
  ) : view === 'agenda' ? (
    <Agenda items={data?.items ?? []} from={from} />
  ) : (
    <MonthGrid items={data?.items ?? []} month={month} />
  );

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        description={t('calendar.description')}
        actions={
          <Button variant="outline" asChild>
            <Link href="/alm">{t('inventory.title')}</Link>
          </Button>
        }
      />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-xs">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => step(-1)}
              aria-label={t('calendar.previous')}
            >
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="sm" onClick={() => set({ from: undefined, month: undefined })}>
              {t('calendar.today')}
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => step(1)} aria-label={t('calendar.next')}>
              <ChevronRightIcon />
            </Button>
          </div>
          <p className={cn('min-w-0 text-sm font-medium', isFetching && 'opacity-60')} aria-live="polite">
            {label}
          </p>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <Select value={application ?? ALL} onValueChange={(v) => set({ app: v === ALL ? undefined : v })}>
              <SelectTrigger className="w-full sm:w-52" aria-label={t('calendar.application')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('calendar.allApplications')}</SelectItem>
                {(apps.data?.items ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.code}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => set({ status: v === OPEN ? undefined : v })}>
              <SelectTrigger className="w-full sm:w-44" aria-label={t('fields.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OPEN}>{t('releases.open')}</SelectItem>
                <SelectItem value={ALL}>{t('releases.allStatuses')}</SelectItem>
                {RELEASE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`releaseStatus.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id={ids.mine}
                checked={mine}
                onCheckedChange={(v) => set({ mine: v ? 'true' : undefined })}
              />
              <Label htmlFor={ids.mine} className="text-sm font-normal">
                {t('calendar.mine')}
              </Label>
            </div>
          </div>
        </div>

        <Tabs value={view} onValueChange={(v) => set({ view: v === 'agenda' ? undefined : v })}>
          <TabsList>
            <TabsTrigger value="agenda">
              <ListIcon aria-hidden />
              {t('calendar.agenda')}
            </TabsTrigger>
            <TabsTrigger value="month">
              <CalendarDaysIcon aria-hidden />
              {t('calendar.month')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="agenda" className="min-w-0">
            {view === 'agenda' && body}
          </TabsContent>
          <TabsContent value="month" className="min-w-0">
            {view === 'month' && body}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
