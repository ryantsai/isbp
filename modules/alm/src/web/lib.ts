'use client';

import type { ISODateString } from '@astryxdesign/core/Calendar';
import { useApiQuery } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { LookupItem } from '../contracts';

export { appHref, releaseHref } from '../model';

/** Cache prefixes every ALM mutation invalidates (record panels resolve our records too). */
export const INVALIDATE = ['/alm/', '/records/'];

const EMPTY: LookupItem[] = [];

/** Groups, departments or configuration items for pickers (served by ALM to its readers). */
export function useLookup(
  kind: 'groups' | 'departments' | 'cis',
  opts: { q?: string; ids?: string[]; enabled?: boolean } = {},
) {
  const query = useApiQuery<{ items: LookupItem[] }>(opts.enabled === false ? null : `/alm/lookups/${kind}`, {
    q: opts.q || undefined,
    ids: opts.ids?.length ? opts.ids : undefined,
  });
  return { items: query.data?.items ?? EMPTY, isLoading: query.isLoading, isFetching: query.isFetching };
}

export function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}

/** "45 s", "12 min", "1 h 5 min", "2 d 3 h". */
export function useDuration() {
  const t = useTranslations('alm.duration');
  return useCallback(
    (seconds: number | null | undefined) => {
      if (seconds === null || seconds === undefined) return '—';
      if (seconds < 60) return t('seconds', { s: Math.max(0, Math.round(seconds)) });
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return t('minutes', { m: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 48) return t('hours', { h: hours, m: minutes % 60 });
      return t('days', { d: Math.floor(hours / 24), h: hours % 24 });
    },
    [t],
  );
}

/** Hours as "36 min", "5.5 h" or "3.2 d" (DORA tiles). */
export function useHours() {
  const t = useTranslations('alm.duration');
  return useCallback(
    (hours: number | null | undefined) => {
      if (hours === null || hours === undefined) return '—';
      if (hours < 1) return t('minutes', { m: Math.round(hours * 60) });
      if (hours < 48) return t('hoursShort', { h: Math.round(hours * 10) / 10 });
      return t('daysShort', { d: Math.round((hours / 24) * 10) / 10 });
    },
    [t],
  );
}

/** Today as `YYYY-MM-DD` in a time zone. */
export function isoToday(timeZone: string, offsetDays = 0, now = new Date()) {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** A `YYYY-MM-DD` calendar date as a Date at UTC midnight (format it with `timeZone: 'UTC'`). */
export const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A `YYYY-MM-DD` string as the Astryx date inputs take it (anything else is no date). */
export function asDay(value: string | null | undefined): ISODateString | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? (value as ISODateString) : undefined;
}
