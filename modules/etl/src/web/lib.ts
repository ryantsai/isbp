'use client';

import { useApiQuery } from '@isbp/ui/query';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { CatalogDto, DbConnectionSummary } from '@isbp/contracts';

export { dataUrl, endpointHref, pipelineHref, runHref } from '../model';

/** The deep link Scheduled Jobs pre-fills a new job from (type, name and config). */
export const scheduleHref = (p: { id: string; name: string }) =>
  `/scheduler/jobs/new?type=etl.pipeline&name=${encodeURIComponent(p.name)}&config=${encodeURIComponent(
    JSON.stringify({ pipelineId: p.id }),
  )}`;

/** Cache prefixes every mutation invalidates (record panels resolve our records too). */
export const INVALIDATE = ['/etl/', '/records/'];

const EMPTY_CONNECTIONS: DbConnectionSummary[] = [];

/**
 * Data connections for pickers. Endpoint editors use `/etl/connections` (endpoints.manage), pipeline
 * editors `/etl/pipelines/connections` (pipelines.manage).
 */
export function useConnections(scope: 'endpoints' | 'pipelines', enabled = true) {
  const path = scope === 'endpoints' ? '/etl/connections' : '/etl/pipelines/connections';
  const q = useApiQuery<{ items: DbConnectionSummary[] }>(enabled ? path : null);
  return { items: q.data?.items ?? EMPTY_CONNECTIONS, isLoading: q.isLoading };
}

/** The catalog of a connection (tables, views, routines) for autocompletion and pickers. */
export function useCatalog(scope: 'endpoints' | 'pipelines', connectionId: string | null | undefined) {
  const base = scope === 'endpoints' ? '/etl/connections' : '/etl/pipelines/connections';
  return useApiQuery<CatalogDto>(connectionId ? `${base}/${connectionId}/catalog` : null);
}

/** `{ "schema.table": [columns] }` for the SQL editor's autocompletion. */
export function sqlSchemaOf(catalog: CatalogDto | undefined): Record<string, string[]> | undefined {
  if (!catalog) return undefined;
  const out: Record<string, string[]> = {};
  for (const t of catalog.tables) {
    const columns = t.columns.map((c) => c.name);
    out[`${t.schema}.${t.name}`] = columns;
    if (t.schema === catalog.defaultSchema) out[t.name] = columns;
  }
  return out;
}

export function useDebounced<T>(value: T, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}

/** "12 ms", "3.4 s", "2 min 5 s". */
export function useDuration() {
  const t = useTranslations('etl.duration');
  const format = useFormatter();
  return useCallback(
    (ms: number | null | undefined) => {
      if (ms === null || ms === undefined) return '—';
      if (ms < 1_000) return t('ms', { n: format.number(Math.round(ms)) });
      if (ms < 60_000) return t('seconds', { n: format.number(ms / 1_000, { maximumFractionDigits: 1 }) });
      const minutes = Math.floor(ms / 60_000);
      return t('minutes', { m: minutes, s: Math.round((ms % 60_000) / 1_000) });
    },
    [t, format],
  );
}

/** Absolute API URL for docs and curl examples (the browser's origin; the API is served under it). */
export function useOrigin() {
  const [origin, setOrigin] = useState('https://isbp.example.com');
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** Copies text and reports whether it worked (clipboard may be unavailable over plain HTTP). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
