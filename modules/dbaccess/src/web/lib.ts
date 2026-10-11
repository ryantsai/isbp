import type { ISODateString } from '@astryxdesign/core/Calendar';
import { type LocalizedText, localize } from '@isbp/sdk';
import { usePlatform } from '@isbp/sdk/web';
import { useFormatter, useLocale } from 'next-intl';
import { useCallback } from 'react';
import { todayIn } from '../model';

/** Every page refreshes everything of the module after a change. */
export const INVALIDATE = ['/dbaccess'];

export const requestHref = (reference: string) => `/dbaccess/requests/${reference}`;
export const reviewHref = (id: string) => `/dbaccess/reviews/${id}`;
export const serverHref = (id: string) => `/dbaccess/servers/${id}`;

/** Admin-written text (role names, descriptions) in the viewer's language. */
export function useLocalized() {
  const locale = useLocale();
  return useCallback((text: LocalizedText | null | undefined) => localize(text ?? null, locale), [locale]);
}

/** Today's calendar date in the viewer's time zone. */
export function useToday() {
  const { user } = usePlatform();
  return todayIn(user.timezone);
}

/** A calendar date (`YYYY-MM-DD`) formatted without time-zone drift. */
export function useDay() {
  const format = useFormatter();
  return useCallback(
    (iso: string | null | undefined) =>
      iso
        ? format.dateTime(new Date(`${iso.slice(0, 10)}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })
        : '',
    [format],
  );
}

/** An instant as a date in the viewer's zone. */
export function useDate() {
  const format = useFormatter();
  return useCallback(
    (d: string | Date | null | undefined) => (d ? format.dateTime(new Date(d), { dateStyle: 'medium' }) : ''),
    [format],
  );
}

/** A `YYYY-MM-DD` string as the Astryx date inputs' value (`undefined` when empty or malformed). */
export function asDay(value: string | null | undefined): ISODateString | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? (value as ISODateString) : undefined;
}
