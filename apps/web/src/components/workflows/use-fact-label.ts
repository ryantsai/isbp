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

/** A fact as the API describes it (`FactDef`): label keys come from the module that declares it. */
export interface FactDefLike {
  path: string;
  type: FactOption['type'];
  options?: string[];
  /** i18n key of the name (module catalog). */
  label?: string;
  /** i18n key prefix of the values (`<valueLabels>.<value>`). */
  valueLabels?: string;
  ref?: 'user' | 'group';
}

/** Fact options for builders and condition summaries, with translated labels and enum options. */
export function useFactOptions(facts: readonly FactDefLike[]): FactOption[] {
  const label = useFactLabel();
  const tv = useTranslations('workflows.factValues');
  const root = useTranslations();
  return useMemo(
    () =>
      facts.map((f) => {
        const base = f.path.replaceAll('.', '_');
        const valueLabel = (v: string) => {
          const key = f.valueLabels ? `${f.valueLabels}.${v}` : null;
          if (key && root.has(key)) return root(key);
          return tv.has(`${base}.${v}`) ? tv(`${base}.${v}`) : v;
        };
        return {
          path: f.path,
          label: f.label && root.has(f.label) ? root(f.label) : label(f.path),
          type: f.type,
          options: f.options?.map((v) => ({ value: v, label: valueLabel(v) })),
          ...(f.ref ? { ref: f.ref } : {}),
        };
      }),
    [facts, label, tv, root],
  );
}
