'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { ReportingPeriodDto } from '../../contracts';
import { dateValue } from '../lib';

/** A reporting period as people say it: "Week 42 · Oct 12 – 18", "Oct 2026". */
export function usePeriodLabel() {
  const format = useFormatter();
  const t = useTranslations('projects.period');
  return (period: Pick<ReportingPeriodDto, 'key' | 'cadence' | 'start' | 'end'>) => {
    if (period.cadence === 'monthly')
      return format.dateTime(dateValue(period.start), { year: 'numeric', month: 'long' });
    const range = format.dateTimeRange(dateValue(period.start), dateValue(period.end), {
      month: 'short',
      day: 'numeric',
    });
    return period.cadence === 'biweekly'
      ? t('biweekly', { range })
      : t('weekly', { week: Number(period.key.slice(-2)), range });
  };
}

/** When an update is due: "Due Fri, Oct 16". */
export function useDueLabel() {
  const format = useFormatter();
  const t = useTranslations('projects.period');
  return (due: string) =>
    t('due', { date: format.dateTime(dateValue(due), { weekday: 'short', month: 'short', day: 'numeric' }) });
}
