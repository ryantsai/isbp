'use client';

import type { FactDefInfo, RecordTypeInfo } from '@isbp/contracts';
import { useMemo } from 'react';
import { useApiQuery } from '@/lib/api';

/**
 * Record types the viewer may pick from, with their approval facts (`GET /records/types`); `all` lists every enabled
 * type (workflow builders describe what a form's fields hold, whoever picks them).
 */
export function useRecordTypes(opts: { enabled?: boolean; all?: boolean } = {}) {
  const { data, isLoading } = useApiQuery<{ items: RecordTypeInfo[] }>(
    opts.enabled === false ? null : '/records/types',
    opts.all ? { all: 'true' } : undefined,
  );
  return useMemo(() => ({ types: data?.items ?? [], loading: isLoading }), [data, isLoading]);
}

/**
 * The facts of the chosen record types, once per path (a field that accepts several types offers the facts of all
 * of them; a record of another type simply lacks the ones it doesn't have).
 */
export function factsOfTypes(types: readonly RecordTypeInfo[], wanted: readonly string[]): FactDefInfo[] {
  const out = new Map<string, FactDefInfo>();
  for (const t of types)
    if (wanted.includes(t.type)) for (const f of t.facts) if (!out.has(f.path)) out.set(f.path, f);
  return [...out.values()];
}
