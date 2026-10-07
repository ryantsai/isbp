'use client';

import { usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { CalendarClockIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import type { z } from 'zod';
import type { upsertCalendarSchema, WorkingHours } from '../../contracts';
import { INVALIDATE } from '../lib';
import type { CalendarDto } from '../types';
import { DeleteButton } from './shared';

type CalendarInput = z.input<typeof upsertCalendarSchema>;
type Range = { start: string; end: string };

/** Monday-first display order of the 0 = Sunday … 6 = Saturday storage. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const OFFICE: WorkingHours = {
  days: [[], ...Array.from({ length: 5 }, () => [{ start: '09:00', end: '18:00' }]), []],
};

function useTimeZones() {
  return useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['UTC', 'Asia/Taipei', 'Asia/Tokyo', 'Europe/London', 'America/New_York'];
    }
  }, []);
}

/** Per weekday: closed, or up to four start–end ranges. */
function WeeklyHours({ value, onChange }: { value: WorkingHours; onChange: (v: WorkingHours) => void }) {
  const t = useTranslations('itsm.settingsPage.calendars');
  const format = useFormatter();
  const dayName = (d: number) =>
    // 2024-01-07 was a Sunday.
    format.dateTime(new Date(Date.UTC(2024, 0, 7 + d)), { weekday: 'long', timeZone: 'UTC' });
  const setDay = (d: number, ranges: Range[]) =>
    onChange({ days: value.days.map((r, i) => (i === d ? ranges : r)) as WorkingHours['days'] });
  return (
    <ul className="grid divide-y rounded-lg border">
      {DAY_ORDER.map((d) => {
        const ranges = value.days[d] ?? [];
        const open = ranges.length > 0;
        const name = dayName(d);
        return (
          <li key={d} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
            <div className="flex items-center gap-2">
              <Switch
                checked={open}
                onCheckedChange={(on) => setDay(d, on ? [{ start: '09:00', end: '18:00' }] : [])}
                aria-label={t('openOn', { day: name })}
              />
              <span className="text-sm font-medium">{name}</span>
            </div>
            {open ? (
              <div className="grid gap-2">
                {ranges.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      type="time"
                      value={r.start}
                      onChange={(e) =>
                        setDay(
                          d,
                          ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                        )
                      }
                      aria-label={t('from', { day: name })}
                      className={cn('h-8 w-28', r.end <= r.start && 'border-destructive')}
                    />
                    <span className="text-sm text-muted-foreground" aria-hidden>
                      –
                    </span>
                    <Input
                      type="time"
                      value={r.end}
                      onChange={(e) =>
                        setDay(
                          d,
                          ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                        )
                      }
                      aria-label={t('to', { day: name })}
                      aria-invalid={r.end <= r.start || undefined}
                      className="h-8 w-28"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('removeRange', { day: name })}
                      onClick={() =>
                        setDay(
                          d,
                          ranges.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
                {ranges.length < 4 && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto w-fit p-0"
                    onClick={() => setDay(d, [...ranges, { start: '13:00', end: '17:00' }])}
                  >
                    <PlusIcon />
                    {t('addRange')}
                  </Button>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground sm:pt-0.5">{t('closed')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CalendarSheet({
  calendar,
  open,
  onOpenChange,
}: {
  calendar: CalendarDto | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('itsm.settingsPage.calendars');
  const tc = useTranslations('common');
  const id = useId();
  const { user } = usePlatform();
  const zones = useTimeZones();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [hours, setHours] = useState<WorkingHours>(OFFICE);
  const [holidays, setHolidays] = useState<{ date: string; name: string }[]>([]);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(calendar?.name ?? '');
    setTimezone(calendar?.timezone ?? user.timezone ?? 'UTC');
    setAlwaysOpen(calendar?.alwaysOpen ?? false);
    setHours(calendar?.hours ?? OFFICE);
    setHolidays(calendar?.holidays ?? []);
    setTouched(false);
  }, [open, calendar, user.timezone]);
  const save = useApiMutation(
    (api, body: CalendarInput) =>
      calendar
        ? api.patch<CalendarDto>(`/itsm/calendars/${calendar.id}`, body)
        : api.post<CalendarDto>('/itsm/calendars', body),
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: () => onOpenChange(false) },
  );
  const remove = useApiMutation((api) => api.delete(`/itsm/calendars/${calendar!.id}`), {
    invalidate: INVALIDATE,
    success: tc('deleted'),
    onSuccess: () => onOpenChange(false),
  });
  const badRange = !alwaysOpen && hours.days.some((d) => d.some((r) => r.end <= r.start));
  const badHoliday = holidays.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h.date) || !h.name.trim());
  const errors = { name: !name.trim(), range: badRange, holiday: badHoliday };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <form
          noValidate
          className="flex h-full flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (Object.values(errors).some(Boolean)) return;
            save.mutate({
              name: name.trim(),
              timezone,
              alwaysOpen,
              hours,
              holidays: holidays
                .map((h) => ({ date: h.date, name: h.name.trim() }))
                .sort((a, b) => a.date.localeCompare(b.date)),
            });
          }}
        >
          <SheetHeader>
            <SheetTitle>{calendar ? t('editTitle') : t('createTitle')}</SheetTitle>
            <SheetDescription>{t('sheetHint')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-6">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>{t('name')}</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={touched && errors.name ? true : undefined}
                aria-describedby={touched && errors.name ? `${id}-name-error` : undefined}
              />
              {touched && errors.name && (
                <p id={`${id}-name-error`} className="text-sm text-destructive">
                  {t('nameRequired')}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-tz`}>{t('timezone')}</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id={`${id}-tz`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(zones.includes(timezone) ? zones : [timezone, ...zones]).map((z) => (
                    <SelectItem key={z} value={z}>
                      {z.replaceAll('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <Label htmlFor={`${id}-247`} className="flex-col items-start gap-0.5">
                <span>{t('alwaysOpen')}</span>
                <span className="text-xs font-normal text-muted-foreground">{t('alwaysOpenHint')}</span>
              </Label>
              <Switch id={`${id}-247`} checked={alwaysOpen} onCheckedChange={setAlwaysOpen} />
            </div>
            {!alwaysOpen && (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t('hours')}</legend>
                <WeeklyHours value={hours} onChange={setHours} />
                {touched && errors.range && <p className="text-sm text-destructive">{t('rangeInvalid')}</p>}
              </fieldset>
            )}
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('holidays')}</legend>
              {holidays.length ? (
                <ul className="grid gap-2">
                  {holidays.map((h, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <Input
                        type="date"
                        value={h.date}
                        onChange={(e) =>
                          setHolidays(holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))
                        }
                        aria-label={t('holidayDate', { n: i + 1 })}
                        className="h-8 w-40"
                      />
                      <Input
                        value={h.name}
                        onChange={(e) =>
                          setHolidays(holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                        }
                        aria-label={t('holidayName', { n: i + 1 })}
                        placeholder={t('holidayNamePlaceholder')}
                        className="h-8 min-w-0 flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('removeHoliday', { n: i + 1 })}
                        onClick={() => setHolidays(holidays.filter((_, j) => j !== i))}
                      >
                        <Trash2Icon />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noHolidays')}</p>
              )}
              {touched && errors.holiday && <p className="text-sm text-destructive">{t('holidayInvalid')}</p>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setHolidays([...holidays, { date: '', name: '' }])}
              >
                <PlusIcon />
                {t('addHoliday')}
              </Button>
            </fieldset>
          </SheetBody>
          <SheetFooter>
            {calendar && (
              <DeleteButton
                title={t('deleteTitle')}
                description={
                  calendar.policyCount ? t('deleteInUse', { count: calendar.policyCount }) : t('deleteBody')
                }
                onConfirm={() => remove.mutate(undefined)}
                pending={remove.isPending}
              />
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {tc('save')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Business calendars (time zone, working hours, holidays) that SLA policies count time on. */
export function CalendarsTab() {
  const t = useTranslations('itsm.settingsPage.calendars');
  const tc = useTranslations('common');
  const { data, isLoading } = useApiQuery<{ items: CalendarDto[] }>('/itsm/calendars');
  const [editing, setEditing] = useState<CalendarDto | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (c: CalendarDto | null) => {
    setEditing(c);
    setOpen(true);
  };
  const summary = (c: CalendarDto) => {
    if (c.alwaysOpen) return t('alwaysOpen');
    const openDays = c.hours.days.filter((d) => d.length).length;
    const first = c.hours.days.find((d) => d.length)?.[0];
    return first ? t('summary', { days: openDays, start: first.start, end: first.end }) : t('closedAllWeek');
  };

  return (
    <section className="grid gap-4" aria-labelledby="itsm-calendars-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="itsm-calendars-title" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button onClick={() => edit(null)}>
          <PlusIcon />
          {t('new')}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : !data?.items.length ? (
        <EmptyState
          icon={<CalendarClockIcon />}
          title={t('empty')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.items.map((c, i) => (
            <motion.li
              key={c.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className="flex min-w-0 items-start justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs"
            >
              <div className="grid min-w-0 gap-1">
                <h3 className="flex flex-wrap items-center gap-2 font-medium">
                  {c.name}
                  {c.alwaysOpen && <Badge variant="info">24×7</Badge>}
                </h3>
                <p className="truncate text-sm text-muted-foreground">{c.timezone.replaceAll('_', ' ')}</p>
                <p className="text-sm">{summary(c)}</p>
                <p className="text-xs text-muted-foreground">
                  {t('holidayCount', { count: c.holidays.length })}
                  {' · '}
                  {t('usedBy', { count: c.policyCount })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => edit(c)}
                aria-label={`${tc('edit')} ${c.name}`}
              >
                <PencilIcon />
              </Button>
            </motion.li>
          ))}
        </ul>
      )}
      <CalendarSheet calendar={editing} open={open} onOpenChange={setOpen} />
    </section>
  );
}
