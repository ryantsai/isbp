'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { usePlatform } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { CalendarClockIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ComponentProps, useEffect, useId, useMemo, useState } from 'react';
import type { z } from 'zod';
import type { upsertCalendarSchema, WorkingHours } from '../../contracts';
import { INVALIDATE } from '../lib';
import type { CalendarDto } from '../types';
import { DeleteButton, SettingsSection } from './shared';

type CalendarInput = z.input<typeof upsertCalendarSchema>;
type Range = { start: string; end: string };
type ISOTime = NonNullable<ComponentProps<typeof TimeInput>['value']>;

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
  const setRange = (d: number, ranges: Range[], i: number, patch: Partial<Range>) =>
    setDay(
      d,
      ranges.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    );
  return (
    <VStack as="ul" gap={0}>
      {DAY_ORDER.map((d, index) => {
        const ranges = value.days[d] ?? [];
        const open = ranges.length > 0;
        const name = dayName(d);
        return (
          <VStack as="li" gap={0} key={d}>
            {index > 0 && <Divider />}
            <HStack gap={2} padding={2} wrap="wrap" vAlign="start">
              <HStack gap={2} vAlign="center" width={160}>
                <Switch
                  label={t('openOn', { day: name })}
                  isLabelHidden
                  value={open}
                  onChange={(on) => setDay(d, on ? [{ start: '09:00', end: '18:00' }] : [])}
                />
                <Text weight="medium">{name}</Text>
              </HStack>
              <StackItem size="fill">
                {open ? (
                  <VStack gap={2}>
                    {ranges.map((r, i) => {
                      const bad = r.end <= r.start;
                      return (
                        <HStack key={i} gap={2} wrap="wrap" vAlign="center">
                          <TimeInput
                            label={t('from', { day: name })}
                            isLabelHidden
                            hourFormat="24h"
                            value={r.start as ISOTime}
                            onChange={(v) => v && setRange(d, ranges, i, { start: v })}
                            status={bad ? { type: 'error' } : undefined}
                            width={120}
                          />
                          <Text color="secondary" aria-hidden>
                            –
                          </Text>
                          <TimeInput
                            label={t('to', { day: name })}
                            isLabelHidden
                            hourFormat="24h"
                            value={r.end as ISOTime}
                            onChange={(v) => v && setRange(d, ranges, i, { end: v })}
                            status={bad ? { type: 'error' } : undefined}
                            width={120}
                          />
                          <IconButton
                            label={t('removeRange', { day: name })}
                            variant="ghost"
                            size="sm"
                            icon={<Icon icon={XIcon} />}
                            onClick={() =>
                              setDay(
                                d,
                                ranges.filter((_, j) => j !== i),
                              )
                            }
                          />
                        </HStack>
                      );
                    })}
                    {ranges.length < 4 && (
                      <HStack>
                        <Button
                          label={t('addRange')}
                          variant="ghost"
                          size="sm"
                          icon={<Icon icon={PlusIcon} />}
                          onClick={() => setDay(d, [...ranges, { start: '13:00', end: '17:00' }])}
                        />
                      </HStack>
                    )}
                  </VStack>
                ) : (
                  <Text color="secondary">{t('closed')}</Text>
                )}
              </StackItem>
            </HStack>
          </VStack>
        );
      })}
    </VStack>
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
  const setHoliday = (i: number, patch: Partial<{ date: string; name: string }>) =>
    setHolidays(holidays.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const timezones = (zones.includes(timezone) ? zones : [timezone, ...zones]).map((z) => ({
    value: z,
    label: z.replaceAll('_', ' '),
  }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetForm
          noValidate
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
          <SheetBody className="pb-6">
            <FormLayout defaultOptionality="optional">
              <TextInput
                label={t('name')}
                isRequired
                value={name}
                onChange={setName}
                status={touched && errors.name ? { type: 'error', message: t('nameRequired') } : undefined}
              />
              <Selector
                label={t('timezone')}
                hasSearch
                options={timezones}
                value={timezone}
                onChange={setTimezone}
              />
              <Switch
                label={t('alwaysOpen')}
                description={t('alwaysOpenHint')}
                value={alwaysOpen}
                onChange={setAlwaysOpen}
              />
              {!alwaysOpen && (
                <Field
                  label={t('hours')}
                  isGroupLabel
                  labelID={`${id}-hours-label`}
                  inputID={`${id}-hours`}
                  status={touched && errors.range ? { type: 'error', message: t('rangeInvalid') } : undefined}
                  statusVariant="detached"
                >
                  <VStack role="group" aria-labelledby={`${id}-hours-label`} gap={0}>
                    <WeeklyHours value={hours} onChange={setHours} />
                  </VStack>
                </Field>
              )}
              <Field
                label={t('holidays')}
                isGroupLabel
                labelID={`${id}-holidays-label`}
                inputID={`${id}-holidays`}
                status={
                  touched && errors.holiday ? { type: 'error', message: t('holidayInvalid') } : undefined
                }
                statusVariant="detached"
              >
                <VStack gap={2} role="group" aria-labelledby={`${id}-holidays-label`}>
                  {holidays.length ? (
                    <VStack as="ul" gap={2}>
                      {holidays.map((h, i) => (
                        <HStack as="li" key={i} gap={2} wrap="wrap" vAlign="center">
                          <DateInput
                            label={t('holidayDate', { n: i + 1 })}
                            isLabelHidden
                            format="date"
                            value={(h.date || undefined) as ISODateString | undefined}
                            onChange={(v) => setHoliday(i, { date: v ?? '' })}
                            width={170}
                          />
                          <StackItem size="fill">
                            <TextInput
                              label={t('holidayName', { n: i + 1 })}
                              isLabelHidden
                              value={h.name}
                              onChange={(v) => setHoliday(i, { name: v })}
                              placeholder={t('holidayNamePlaceholder')}
                            />
                          </StackItem>
                          <IconButton
                            label={t('removeHoliday', { n: i + 1 })}
                            variant="ghost"
                            size="sm"
                            icon={<Icon icon={Trash2Icon} />}
                            onClick={() => setHolidays(holidays.filter((_, j) => j !== i))}
                          />
                        </HStack>
                      ))}
                    </VStack>
                  ) : (
                    <Text color="secondary">{t('noHolidays')}</Text>
                  )}
                  <HStack>
                    <Button
                      label={t('addHoliday')}
                      variant="secondary"
                      size="sm"
                      icon={<Icon icon={PlusIcon} />}
                      onClick={() => setHolidays([...holidays, { date: '', name: '' }])}
                    />
                  </HStack>
                </VStack>
              </Field>
            </FormLayout>
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
            <Button label={tc('cancel')} variant="secondary" onClick={() => onOpenChange(false)} />
            <Button label={tc('save')} variant="primary" isLoading={save.isPending} type="submit" />
          </SheetFooter>
        </SheetForm>
      </SheetContent>
    </Sheet>
  );
}

/** Business calendars (time zone, working hours, holidays) that SLA policies count time on. */
export function CalendarsTab() {
  const t = useTranslations('itsm.settingsPage.calendars');
  const ts = useTranslations('itsm.settingsPage');
  const { data, isLoading, error, refetch } = useApiQuery<{ items: CalendarDto[] }>('/itsm/calendars');
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
    <SettingsSection
      id="itsm-calendars-title"
      title={t('title')}
      description={t('description')}
      action={
        <Button
          label={t('new')}
          variant="primary"
          icon={<Icon icon={PlusIcon} />}
          onClick={() => edit(null)}
        />
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} kind="list" className="rounded-xl border" />
      ) : isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : !data?.items.length ? (
        <EmptyState
          icon={<CalendarClockIcon />}
          title={t('empty')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <Grid columns={{ minWidth: 300 }} gap={3}>
          {data.items.map((c) => (
            <Card key={c.id} className="h-full min-w-0">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {c.name}
                  {c.alwaysOpen && <Badge variant="info" label="24×7" />}
                </CardTitle>
                <CardDescription>{c.timezone.replaceAll('_', ' ')}</CardDescription>
                <CardAction>
                  <IconButton
                    label={ts('editItem', { name: c.name })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={PencilIcon} />}
                    onClick={() => edit(c)}
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                <VStack gap={1}>
                  <Text as="p">{summary(c)}</Text>
                  <Text as="p" type="supporting">
                    {t('holidayCount', { count: c.holidays.length })}
                    {' · '}
                    {t('usedBy', { count: c.policyCount })}
                  </Text>
                </VStack>
              </CardContent>
            </Card>
          ))}
        </Grid>
      )}
      <CalendarSheet calendar={editing} open={open} onOpenChange={setOpen} />
    </SettingsSection>
  );
}
