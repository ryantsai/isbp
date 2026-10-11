'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Delegation } from '@isbp/contracts';
import { ApiError, usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CalendarClockIcon,
  CalendarOffIcon,
  CircleCheckIcon,
  PlaneTakeoffIcon,
  PlusIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useNow, useTimeZone, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateTimeInput, type ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';

const PATH = '/me/delegations';
/** Read at validation time (not during render). */
const currentTime = () => Date.now();
const QUICK_DAYS = [1, 3, 7, 14] as const;

/* ───────── `datetime-local` values in the profile's time zone (not the browser's) ───────── */

function zonedParts(d: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;
}

/** `YYYY-MM-DDTHH:mm` for an instant, as a wall clock in `timeZone`. */
export function toZonedInput(d: Date, timeZone: string) {
  const p = zonedParts(d, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The instant a `datetime-local` value denotes in `timeZone` (DST-safe), or null. */
export function fromZonedInput(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (instant: number) => {
    const p = zonedParts(new Date(instant), timeZone);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - instant;
  };
  let t = wall - offset(wall);
  t = wall - offset(t);
  return Number.isNaN(t) ? null : new Date(t);
}

/* ───────── card ───────── */

/** Approval delegation while away: new approval tasks go to a colleague for a period. */
export function OutOfOfficeCard() {
  const t = useTranslations('settings.outOfOffice');
  const format = useFormatter();
  const { data, isLoading } = useApiQuery<{ items: Delegation[] }>(PATH);
  const [formOpen, setFormOpen] = useState(false);
  const [ending, setEnding] = useState<Delegation | null>(null);
  const items = data?.items ?? [];

  const remove = useApiMutation((api, id: string) => api.delete(`${PATH}/${id}`), {
    invalidate: [PATH],
    success: () => (ending?.active ? t('ended') : t('removed')),
    onSuccess: () => setEnding(null),
  });

  const period = (d: Delegation) =>
    format.dateTimeRange(new Date(d.startsAt), new Date(d.endsAt), {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  return (
    <Card id="out-of-office" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {!formOpen && (
          <CardAction>
            <Button
              label={t('add')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setFormOpen(true)}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <Banner status="info" title={t('explainer')} collapsible={false} />

        <AnimatePresence initial={false}>
          {formOpen && (
            <motion.div
              key="form"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <DelegationForm onDone={() => setFormOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        ) : items.length === 0 ? (
          !formOpen && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarOffIcon className="size-4" aria-hidden /> {t('none')}
            </p>
          )
        ) : (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('listTitle')}</h3>
            <ul className="divide-y rounded-lg border">
              <AnimatePresence initial={false}>
                {items.map((d) => (
                  <motion.li
                    key={d.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
                    className="flex flex-wrap items-center gap-3 px-3 py-3 sm:flex-nowrap"
                  >
                    <UserAvatar
                      name={d.delegate.displayName}
                      src={d.delegate.avatarUrl}
                      className="size-9 text-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{t('goesTo', { name: d.delegate.displayName })}</span>
                        {d.active ? (
                          <Badge
                            variant="success"
                            label={t('active')}
                            icon={<Icon icon={CircleCheckIcon} size="xsm" />}
                          />
                        ) : (
                          <Badge
                            variant="info"
                            label={t('scheduled')}
                            icon={<Icon icon={CalendarClockIcon} size="xsm" />}
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{period(d)}</p>
                      {d.reason && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{d.reason}</p>
                      )}
                    </div>
                    <Button
                      label={d.active ? t('end') : t('remove')}
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setEnding(d)}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={Boolean(ending)}
        onOpenChange={(o) => !o && setEnding(null)}
        title={ending?.active ? t('endTitle') : t('removeTitle')}
        description={
          ending
            ? ending.active
              ? t('endBody', { name: ending.delegate.displayName })
              : t('removeBody', { name: ending.delegate.displayName, period: period(ending) })
            : undefined
        }
        confirmLabel={ending?.active ? t('end') : t('remove')}
        destructive
        loading={remove.isPending}
        onConfirm={() => ending && remove.mutate(ending.id)}
      />
    </Card>
  );
}

/* ───────── form ───────── */

function DelegationForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('settings.outOfOffice');
  const tc = useTranslations('common');
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow({ updateInterval: 60_000 });
  const { user } = usePlatform();
  const errorText = useErrorText();

  const schema = useMemo(
    () =>
      z
        .object({
          delegate: z.custom<PersonOption | null>(),
          from: z.string(),
          until: z.string(),
          reason: z.string().trim().max(300, t('validation.reason')),
        })
        .superRefine((v, ctx) => {
          if (!v.delegate)
            ctx.addIssue({ code: 'custom', path: ['delegate'], message: t('validation.delegate') });
          const from = fromZonedInput(v.from, timeZone);
          const until = fromZonedInput(v.until, timeZone);
          if (!from) ctx.addIssue({ code: 'custom', path: ['from'], message: t('validation.date') });
          if (!until) ctx.addIssue({ code: 'custom', path: ['until'], message: t('validation.date') });
          else if (from && until <= from)
            ctx.addIssue({ code: 'custom', path: ['until'], message: t('validation.afterStart') });
          else if (until.getTime() <= currentTime())
            ctx.addIssue({ code: 'custom', path: ['until'], message: t('validation.future') });
        }),
    [t, timeZone],
  );
  type Values = z.input<typeof schema>;

  const [defaults] = useState<Values>(() => {
    // Next full hour → a week later.
    const start = new Date(Math.ceil((now.getTime() + 60_000) / 3_600_000) * 3_600_000);
    return {
      delegate: null,
      from: toZonedInput(start, timeZone),
      until: toZonedInput(new Date(start.getTime() + 7 * 86_400_000), timeZone),
      reason: '',
    };
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  const from = useWatch({ control: form.control, name: 'from' });
  const until = useWatch({ control: form.control, name: 'until' });

  const create = useApiMutation(
    (api, v: { delegateId: string; startsAt: string; endsAt: string; reason: string | null }) =>
      api.post<{ id: string }>(PATH, v),
    { invalidate: [PATH], success: t('created'), onSuccess: onDone, silent: true },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        delegateId: v.delegate!.id,
        startsAt: fromZonedInput(v.from, timeZone)!.toISOString(),
        endsAt: fromZonedInput(v.until, timeZone)!.toISOString(),
        reason: v.reason.trim() || null,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_DELEGATE') {
        form.setError('delegate', { message: t('errors.invalidDelegate') }, { shouldFocus: true });
        return;
      }
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('root', { message: t('errors.overlap') });
        return;
      }
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues = (err.details as { issues?: { path: string }[] } | undefined)?.issues ?? [];
        if (issues.some((i) => i.path === 'endsAt')) {
          form.setError('until', { message: t('validation.future') });
          return;
        }
        if (applyServerErrors(err, form.setError as never)) return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  const startDate = fromZonedInput(from, timeZone);
  const untilDate = fromZonedInput(until, timeZone);
  const days =
    startDate && untilDate ? Math.round((untilDate.getTime() - startDate.getTime()) / 86_400_000) : null;
  const setDuration = (n: number) => {
    if (!startDate) return;
    form.setValue('until', toZonedInput(new Date(startDate.getTime() + n * 86_400_000), timeZone), {
      shouldValidate: form.formState.isSubmitted,
      shouldDirty: true,
    });
  };

  const delegateId = useId();

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        noValidate
        className="space-y-4 rounded-lg border bg-muted/20 p-4"
        aria-label={t('formTitle')}
      >
        <HStack gap={2} vAlign="center">
          <Icon icon={PlaneTakeoffIcon} color="secondary" />
          <Text weight="medium">{t('formTitle')}</Text>
        </HStack>
        <FormLayout defaultOptionality="required">
          <FormField
            control={form.control}
            name="delegate"
            render={({ field, fieldState }) => (
              <Field
                label={t('delegate')}
                inputID={delegateId}
                description={t('delegateHint')}
                status={fieldStatus(fieldState)}
              >
                <PersonPicker
                  id={delegateId}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  excludeIds={[user.id]}
                  placeholder={t('delegatePlaceholder')}
                  invalid={Boolean(fieldState.error)}
                />
              </Field>
            )}
          />
          <Grid columns={{ minWidth: 220 }} gap={4}>
            <FormField
              control={form.control}
              name="from"
              render={({ field, fieldState }) => (
                <DateTimeInput
                  label={t('from')}
                  value={(field.value || undefined) as ISODateTimeString | undefined}
                  onChange={(v) => field.onChange(v ?? '')}
                  status={fieldStatus(fieldState)}
                />
              )}
            />
            <FormField
              control={form.control}
              name="until"
              render={({ field, fieldState }) => (
                <DateTimeInput
                  label={t('until')}
                  min={(from || undefined) as ISODateTimeString | undefined}
                  value={(field.value || undefined) as ISODateTimeString | undefined}
                  onChange={(v) => field.onChange(v ?? '')}
                  status={fieldStatus(fieldState)}
                />
              )}
            />
          </Grid>
        </FormLayout>
        <HStack gap={1.5} wrap="wrap" vAlign="center" role="group" aria-label={t('quick.label')}>
          <Text type="supporting" color="secondary">
            {t('quick.label')}
          </Text>
          {QUICK_DAYS.map((n) => (
            <ToggleButton
              key={n}
              label={t('quick.days', { count: n })}
              size="sm"
              isPressed={days === n}
              onPressedChange={() => setDuration(n)}
            />
          ))}
        </HStack>
        <Text type="supporting" color="secondary">
          {t('timeZone', { zone: timeZone.replaceAll('_', ' ') })}
        </Text>
        <FormLayout defaultOptionality="required">
          <FormField
            control={form.control}
            name="reason"
            render={({ field, fieldState }) => (
              <TextInput
                label={t('reason')}
                isOptional
                description={t('reasonHint')}
                placeholder={t('reasonPlaceholder')}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                status={fieldStatus(fieldState)}
              />
            )}
          />
        </FormLayout>
        {form.formState.errors.root && (
          <Banner
            status="error"
            title={String(form.formState.errors.root.message ?? '')}
            collapsible={false}
          />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button label={tc('cancel')} variant="ghost" type="button" onClick={onDone} />
          <Button label={t('save')} variant="primary" isLoading={create.isPending} type="submit" />
        </div>
      </form>
    </Form>
  );
}
