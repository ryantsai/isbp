'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { useListState } from '@isbp/ui/data-table';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon } from 'lucide-react';
import { useFormatter, useNow, useTimeZone, useTranslations } from 'next-intl';
import { type AppSummary, RELEASE_STATUSES, type ReleaseSummary } from '../../contracts';
import { RELEASE_META, ReleaseStatusBadge } from '../badges';
import { appHref, dateOnly, isoToday, releaseHref } from '../lib';
import { LinkedChangeChip, ReadinessSummary } from '../release-bits';
import { AlmTabs } from '../section-tabs';

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
          <Link href={releaseHref(r.application.code, r.version)} weight="medium">
            <Text type="code">
              {r.application.code} {r.version}
            </Text>
          </Link>
          {r.name && (
            <Text color="secondary" maxLines={1}>
              {r.name}
            </Text>
          )}
        </span>
        <Link href={appHref(r.application.code)} size="xsm" color="secondary">
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

/** Releases grouped by week (Monday first); runs of empty weeks fold into one line ("Nov 2 – 15: nothing planned"). */
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
  const blocks: ({ kind: 'week'; week: string } | { kind: 'empty'; from: string; to: string })[] = [];
  for (const w of weeks) {
    const last = blocks.at(-1);
    if (byWeek.has(w)) blocks.push({ kind: 'week', week: w });
    else if (last?.kind === 'empty') last.to = addDays(w, 6);
    else blocks.push({ kind: 'empty', from: w, to: addDays(w, 6) });
  }
  const range = (a: string, b: string) =>
    format.dateTimeRange(dateOnly(a), dateOnly(b), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <div className="grid gap-4">
      {blocks.map((b) => {
        if (b.kind === 'empty')
          return (
            <p
              key={`empty-${b.from}`}
              className="rounded-xl border border-dashed px-4 py-2 text-sm text-muted-foreground"
            >
              {t('nothingPlannedRange', { range: range(b.from, b.to) })}
            </p>
          );
        const list = byWeek.get(b.week) ?? [];
        const headingId = `alm-week-${b.week}`;
        return (
          <section
            key={b.week}
            aria-labelledby={headingId}
            className="overflow-hidden rounded-xl border bg-card"
          >
            <h2
              id={headingId}
              className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm font-semibold"
            >
              <span>{t('weekOf', { range: range(b.week, addDays(b.week, 6)) })}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t('count', { count: list.length })}
              </span>
            </h2>
            <ul className="divide-y">
              {list.map((r) => (
                <ReleaseRow key={r.id} r={r} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
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
    <div className="overflow-hidden rounded-xl border bg-card">
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
                    return (
                      <li key={r.id} className="min-w-0">
                        <Link
                          href={releaseHref(r.application.code, r.version)}
                          tooltip={`${r.application.name} ${r.version} · ${t(`releaseStatus.${r.status}`)}`}
                          size="xsm"
                        >
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <Icon icon={RELEASE_META[r.status].icon} size="xsm" />
                            <span className="truncate font-mono">
                              {r.application.code} {r.version}
                            </span>
                            <span className="sr-only">{t(`releaseStatus.${r.status}`)}</span>
                          </span>
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
      <PageHeader title={t('inventory.title')} description={t('calendar.description')} />
      <AlmTabs />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          <div className="flex items-center gap-1">
            <IconButton
              label={t('calendar.previous')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={ChevronLeftIcon} />}
              onClick={() => step(-1)}
            />
            <Button
              label={t('calendar.today')}
              variant="secondary"
              size="sm"
              onClick={() => set({ from: undefined, month: undefined })}
            />
            <IconButton
              label={t('calendar.next')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={ChevronRightIcon} />}
              onClick={() => step(1)}
            />
          </div>
          <p className={cn('min-w-0 text-sm font-medium', isFetching && 'opacity-60')} aria-live="polite">
            {label}
          </p>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <Selector
              label={t('calendar.application')}
              isLabelHidden
              width={208}
              hasSearch={(apps.data?.items.length ?? 0) > 8}
              value={application ?? ALL}
              onChange={(v) => set({ app: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('calendar.allApplications') },
                ...(apps.data?.items ?? []).map((a) => ({ value: a.code, label: a.name })),
              ]}
            />
            <Selector
              label={t('fields.status')}
              isLabelHidden
              width={176}
              value={status}
              onChange={(v) => set({ status: v === OPEN ? undefined : v })}
              options={[
                { value: OPEN, label: t('releases.open') },
                { value: ALL, label: t('releases.allStatuses') },
                ...RELEASE_STATUSES.map((s) => ({ value: s, label: t(`releaseStatus.${s}`) })),
              ]}
            />
            <Switch
              label={t('calendar.mine')}
              value={mine}
              onChange={(v) => set({ mine: v ? 'true' : undefined })}
            />
          </div>
        </div>

        <SegmentedControl
          label={t('calendar.view')}
          value={view}
          onChange={(v) => set({ view: v === 'agenda' ? undefined : v })}
        >
          <SegmentedControlItem value="agenda" label={t('calendar.agenda')} icon={<Icon icon={ListIcon} />} />
          <SegmentedControlItem
            value="month"
            label={t('calendar.month')}
            icon={<Icon icon={CalendarDaysIcon} />}
          />
        </SegmentedControl>
        {body}
      </div>
    </>
  );
}
