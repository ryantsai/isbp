'use client';

import { type LocalizedText, localize } from '@isbp/sdk';
import { useApiQuery } from '@isbp/ui/query';
import { useFormatter, useLocale } from 'next-intl';
import { useCallback } from 'react';
import type { LookupItem, Taxonomy } from '../contracts';

export const assetHref = (number: string) => `/isms/assets/${number}`;
export const stocktakeHref = (reference: string) => `/isms/stocktakes/${reference}`;
export const accountHref = (reference: string) => `/isms/accounts/${reference}`;
export const reviewHref = (reference: string) => `/isms/reviews/${reference}`;

/** Every list and detail of the module (mutations refresh them all). */
export const INVALIDATE = ['/isms'];

/** Download URL of an API route (with the list's filters). */
export function apiUrl(path: string, query: Record<string, string | number | undefined | null> = {}) {
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return `/api/v1${path}${qs ? `?${qs}` : ''}`;
}

export function useTaxonomy(enabled = true) {
  return useApiQuery<Taxonomy>(enabled ? '/isms/taxonomy' : null);
}

export function useGroups(enabled = true) {
  return useApiQuery<{ items: LookupItem[] }>(enabled ? '/isms/lookups/groups' : null);
}

/** Text admins wrote per language, in the viewer's language. */
export function useLocalized() {
  const locale = useLocale();
  return useCallback((text: LocalizedText | null | undefined) => localize(text ?? null, locale), [locale]);
}

/** A calendar date (`YYYY-MM-DD`) in the viewer's language. */
export function useDay() {
  const format = useFormatter();
  return useCallback(
    (date: string | null | undefined) =>
      date ? format.dateTime(new Date(`${date}T00:00:00Z`), { timeZone: 'UTC', dateStyle: 'medium' }) : '—',
    [format],
  );
}

/** Today in the viewer's time zone (`YYYY-MM-DD`). */
export function todayLocal(timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Reads a text file the person picked (CSV), with the encoding detected from a BOM (UTF-8 otherwise). */
export async function readTextFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Spreadsheets in Taiwan often save CSV as Big5.
    return new TextDecoder('big5').decode(buffer);
  }
}
