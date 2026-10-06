'use client';

import type { FactOption } from '@isbp/ui/condition-builder';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

/** `request.durationDays` → "Duration (days)"; unknown paths are humanised (`data.estimatedCost` → "Estimated cost"). */
export function useFactLabel() {
  const t = useTranslations('workflows.facts');
  return useCallback(
    (path: string) => {
      const key = path.replaceAll('.', '_');
      if (t.has(key)) return t(key);
      const last = path.split('.').pop() ?? path;
      const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
      return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
    },
    [t],
  );
}

/** Fact options for builders and condition summaries, with translated labels and enum options. */
export function useFactOptions(
  facts: readonly { path: string; type: FactOption['type']; options?: string[] }[],
): FactOption[] {
  const label = useFactLabel();
  const tv = useTranslations('workflows.factValues');
  return useMemo(
    () =>
      facts.map((f) => {
        const base = f.path.replaceAll('.', '_');
        return {
          path: f.path,
          label: label(f.path),
          type: f.type,
          options: f.options?.map((v) => ({
            value: v,
            label: tv.has(`${base}.${v}`) ? tv(`${base}.${v}`) : v,
          })),
        };
      }),
    [facts, label, tv],
  );
}
