'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { type CronDescription, describeCron, type TriggerOut } from '../contracts';

/** Weekday names in the viewer's language (0 = Sunday). */
function weekdays(locale: string, days: number[]): string {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  // 2023-01-01 was a Sunday.
  const names = days.map((d) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d))));
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/** "Every 15 minutes", "Daily at 07:00", "Sundays at 03:00" — or the expression itself. */
export function useCronText() {
  const t = useTranslations('scheduler.cron');
  const locale = useLocale();
  return useCallback(
    (expr: string, d: CronDescription = describeCron(expr)) => {
      switch (d.kind) {
        case 'everyMinute':
          return t('everyMinute');
        case 'everyMinutes':
          return t('everyMinutes', { n: d.n });
        case 'hourly':
          return t('hourly', { minute: String(d.minute).padStart(2, '0') });
        case 'everyHours':
          return t('everyHours', { n: d.n, minute: String(d.minute).padStart(2, '0') });
        case 'daily':
          return t('daily', { time: d.time });
        case 'weekdays':
          return t('weekdays', { time: d.time });
        case 'weekly':
          return t('weekly', { days: weekdays(locale, d.days), time: d.time });
        case 'monthly':
          return t('monthly', { day: d.day, time: d.time });
        default:
          return t('custom', { cron: expr });
      }
    },
    [t, locale],
  );
}

/** One line describing a job's trigger. */
export function useTriggerText() {
  const t = useTranslations('scheduler.trigger');
  const cronText = useCronText();
  const locale = useLocale();
  return useCallback(
    (trigger: TriggerOut, opts: { timezone?: boolean } = {}) => {
      switch (trigger.kind) {
        case 'cron': {
          const text = cronText(trigger.cron ?? '');
          return opts.timezone === false ? text : t('withZone', { text, zone: trigger.timezone });
        }
        case 'interval': {
          const m = trigger.intervalMinutes ?? 0;
          return m >= 60 && m % 60 === 0 ? t('everyHours', { n: m / 60 }) : t('everyMinutes', { n: m });
        }
        case 'after': {
          let jobs = trigger.upstream.map((u) => u.name).join(', ');
          try {
            jobs = new Intl.ListFormat(locale, {
              type: trigger.mode === 'any' ? 'disjunction' : 'conjunction',
            }).format(trigger.upstream.map((u) => u.name));
          } catch {
            /* keep the comma list */
          }
          return t('after', { jobs, mode: trigger.mode ?? 'all' });
        }
        default:
          return t('manual');
      }
    },
    [t, cronText, locale],
  );
}
