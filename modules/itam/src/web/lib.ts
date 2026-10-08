'use client';

import type { Page } from '@isbp/sdk';
import { useApiQuery } from '@isbp/ui/query';
import { useFormatter, useLocale } from 'next-intl';
import { useCallback, useMemo } from 'react';
import type { ItamSettings, Model, Vendor } from '../contracts';

/** Cache prefix every Assets mutation invalidates (lists, details, dashboard, slots). */
export const INVALIDATE = ['/itam/', '/records/'];

export const assetHref = (a: { tag: string }) => `/itam/hardware/${a.tag}`;
export const licenseHref = (l: { reference: string }) => `/itam/software/${l.reference}`;
export const contractHref = (c: { reference: string }) => `/itam/contracts/${c.reference}`;

/**
 * Money in the record's currency, formatted for the viewer's locale. Whole amounts drop the decimals
 * (`NT$52,000`); `compact` gives `NT$3.5M` / `$345萬` for KPI tiles.
 */
export function useMoney() {
  const locale = useLocale();
  return useCallback(
    (amount: number | null | undefined, currency: string, opts: { compact?: boolean } = {}) => {
      if (amount === null || amount === undefined) return '—';
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          trailingZeroDisplay: 'stripIfInteger',
          ...(opts.compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
        }).format(amount);
      } catch {
        return `${currency} ${amount.toLocaleString(locale)}`;
      }
    },
    [locale],
  );
}

/** A calendar date (`YYYY-MM-DD`) in the viewer's locale, without time-zone shifts. */
export function useDay() {
  const format = useFormatter();
  return useCallback(
    (date: string | null | undefined, style: 'medium' | 'short' = 'medium') =>
      date
        ? format.dateTime(new Date(`${date}T00:00:00Z`), {
            timeZone: 'UTC',
            ...(style === 'medium' ? { dateStyle: 'medium' } : { month: 'short', day: 'numeric' }),
          })
        : '—',
    [format],
  );
}

const EMPTY_SETTINGS: ItamSettings = {
  currency: 'TWD',
  warrantyDays: 30,
  underUsedPercent: 60,
  wipeMonths: 2,
  wipeRemindDays: 7,
  canEditSettings: false,
};

export function useItamSettings() {
  const { data } = useApiQuery<ItamSettings>('/itam/settings');
  return data ?? EMPTY_SETTINGS;
}

const EMPTY_VENDORS: Vendor[] = [];
const EMPTY_MODELS: Model[] = [];

/** Active vendors for pickers and filters (`null` path when the viewer can't read them). */
export function useVendors(enabled = true) {
  const { data, isLoading } = useApiQuery<Page<Vendor>>(enabled ? '/itam/vendors' : null, {
    pageSize: 200,
  });
  return { vendors: data?.items ?? EMPTY_VENDORS, isLoading };
}

export function useModels(enabled = true) {
  const { data, isLoading } = useApiQuery<Page<Model>>(enabled ? '/itam/models' : null, { pageSize: 200 });
  return { models: data?.items ?? EMPTY_MODELS, isLoading };
}

const EMPTY_DEPARTMENTS: { id: string; name: string; code: string }[] = [];

export function useDepartments(enabled = true) {
  const { data } = useApiQuery<{ items: { id: string; name: string; code: string }[] }>(
    enabled ? '/itam/lookups/departments' : null,
  );
  return data?.items ?? EMPTY_DEPARTMENTS;
}

export const modelLabel = (m: { manufacturer: string; name: string } | null | undefined) =>
  m
    ? m.name.toLowerCase().startsWith(m.manufacturer.toLowerCase())
      ? m.name
      : `${m.manufacturer} ${m.name}`
    : '';

/** Stable map lookups for small lists. */
export function useById<T extends { id: string }>(items: readonly T[]) {
  return useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
}
