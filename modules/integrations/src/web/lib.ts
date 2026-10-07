'use client';

import { ApiError } from '@isbp/sdk/web';
import { useApiQuery } from '@isbp/ui/query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Catalogue, ConnectorInfoDto, EntityInfoDto, Label } from '../contracts';

export { conflictsHref, connectionHref, newProfileHref, profileHref, runHref, webhookPath } from '../model';

/** Cache prefixes every hub mutation invalidates (record panels show our links too). */
export const INVALIDATE = ['/integrations/', '/records/'];

const EMPTY: Catalogue = { connectors: [], entities: [] };

/** Connector types and sync entities (with whether the viewer may set up profiles for each). */
export function useCatalogue() {
  const { data, isLoading } = useApiQuery<Catalogue>('/integrations/connectors');
  const value = data ?? EMPTY;
  const connectors = useMemo(
    () => new Map<string, ConnectorInfoDto>(value.connectors.map((c) => [c.type, c])),
    [value],
  );
  const entities = useMemo(
    () => new Map<string, EntityInfoDto>(value.entities.map((e) => [e.entity, e])),
    [value],
  );
  return { ...value, connectors, entities, list: value, isLoading };
}

/**
 * A catalogue label: an i18n key of the owning module (`itsm.sync.fields.title`), text per locale, or plain
 * text (remote systems' own names).
 */
export function useLabel() {
  const t = useTranslations();
  const locale = useLocale();
  return useCallback(
    (label: Label | null | undefined, fallback = ''): string => {
      if (!label) return fallback;
      if (typeof label === 'string')
        return /^[a-z][\w-]*\.[\w.-]+$/.test(label) && t.has(label) ? t(label) : label;
      return label[locale] ?? label.en ?? Object.values(label)[0] ?? fallback;
    },
    [t, locale],
  );
}

/** The error code of an API error (for hints next to the translated message). */
export const errorCode = (err: unknown): string | null => (err instanceof ApiError ? err.code : null);

/** `VALIDATION_FAILED` issues of an API error, keyed by path. */
export function issuesOf(
  err: unknown,
): { path: string; message: string; code?: string; params?: Record<string, string> }[] {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_FAILED') return [];
  return ((err.details as { issues?: unknown[] } | undefined)?.issues ?? []) as {
    path: string;
    message: string;
    code?: string;
    params?: Record<string, string>;
  }[];
}

export function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}

/** The site's origin, for the full webhook URL (empty during server rendering). */
export function useOrigin() {
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** A value for previews and conflicts: text as is, lists joined, objects as compact JSON. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(', ');
  return JSON.stringify(v);
}
