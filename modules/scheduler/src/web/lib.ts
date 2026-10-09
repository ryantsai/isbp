'use client';

import type { RunProblem } from '@isbp/sdk';
import { useApiQuery } from '@isbp/ui/query';
import { problemOf, useResultText, useRunProblemText } from '@isbp/ui/run-detail';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobRef, LookupItem, TaskTypes } from '../contracts';

export { jobHref, runHref } from '../model';

/** Cache prefixes every Scheduled jobs mutation invalidates (record panels resolve our jobs too). */
export const INVALIDATE = ['/scheduler/', '/records/'];

const EMPTY_TYPES: TaskTypes = { items: [], sandbox: { runner: 'none', isolated: false, images: [] } };

/** Task types (the caller may create, or `all` enabled ones for filters) and the script runner. */
export function useTaskTypes(all = false) {
  const { data, isLoading } = useApiQuery<TaskTypes>(
    '/scheduler/task-types',
    all ? { all: true } : undefined,
  );
  const value = data ?? EMPTY_TYPES;
  const byType = useMemo(() => new Map(value.items.map((t) => [t.type, t])), [value]);
  return { ...value, byType, isLoading };
}

/** Translates a task type's name (an i18n key in its module's catalog), falling back to the type. */
export function useTypeName() {
  const t = useTranslations();
  return useCallback(
    (key: string | null | undefined, type: string) => (key && t.has(key) ? t(key) : type),
    [t],
  );
}

const EMPTY_LOOKUP: LookupItem[] = [];
const EMPTY_JOBS: JobRef[] = [];

export function useGroups() {
  const { data } = useApiQuery<{ items: LookupItem[] }>('/scheduler/lookups/groups');
  return data?.items ?? EMPTY_LOOKUP;
}

export function useJobOptions(q: string, enabled = true) {
  const { data, isFetching } = useApiQuery<{ items: JobRef[] }>(enabled ? '/scheduler/lookups/jobs' : null, {
    q: q || undefined,
  });
  return { items: data?.items ?? EMPTY_JOBS, isFetching };
}

export function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}

/** "850 ms", "12.4 s", "3 min 20 s", "1 h 5 min". */
export function useDurationMs() {
  const t = useTranslations('scheduler.duration');
  const format = useFormatter();
  return useCallback(
    (ms: number | null | undefined) => {
      if (ms === null || ms === undefined) return '—';
      if (ms < 1_000) return t('ms', { ms: Math.max(0, Math.round(ms)) });
      if (ms < 60_000) return t('s', { s: format.number(Math.round(ms / 100) / 10) });
      const s = Math.round(ms / 1_000);
      if (s < 3_600) return t('min', { m: Math.floor(s / 60), s: s % 60 });
      const m = Math.round(s / 60);
      return t('h', { h: Math.floor(m / 60), m: m % 60 });
    },
    [t, format],
  );
}

/** "every second" style seconds → "30 s", "5 min", "2 h". */
export function useSeconds() {
  const t = useTranslations('scheduler.duration');
  return useCallback(
    (seconds: number) => {
      if (seconds < 60) return t('seconds', { s: seconds });
      if (seconds < 3_600 || seconds % 3_600 !== 0) return t('minutes', { m: Math.round(seconds / 60) });
      return t('hours', { h: seconds / 3_600 });
    },
    [t],
  );
}

/** The browser's IANA time zones (UTC first). */
export function timeZones(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
      'timeZone',
    );
    if (zones?.length) return ['UTC', ...zones.filter((z) => z !== 'UTC')];
  } catch {
    /* older browsers */
  }
  return ['UTC', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'America/New_York'];
}

/** The viewer's own time zone (default for new cron jobs). */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * A run's result in the reader's language: why it failed (plain words), or what it did ("12 rows written") from the
 * key and values the task stored.
 */
export function useRunResult() {
  const resultText = useResultText();
  const problemText = useRunProblemText();
  return useCallback(
    (run: {
      status: string;
      summary: string | null;
      summaryParams?: Record<string, string | number> | null;
      error: string | null;
      problem?: RunProblem | null;
    }) => {
      if (run.error && (run.status === 'failed' || run.status === 'timed_out' || run.status === 'retrying')) {
        const p = problemOf(run.problem, run.error);
        if (p) return { text: problemText(p).title, failed: true };
      }
      return { text: resultText(run.summary, run.summaryParams), failed: false };
    },
    [resultText, problemText],
  );
}
