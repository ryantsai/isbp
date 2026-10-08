'use client';

import {
  FACT_PATH_RE,
  localize,
  STEP_FACTS_ROOT,
  stepsBefore,
  walkSteps,
  type WorkflowGraph,
} from '@isbp/sdk';
import type { FactOption } from '@isbp/ui/condition-builder';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { fieldType } from './field-facts';

/**
 * Facts of the fields approvers fill in (`ApprovalStep.fields`): `steps.<stepId>.<key>`, labelled "Step: Field".
 * `all` names them everywhere (diagram, simulator); `before(stepId)` is what a step can test — the fields of the
 * approval steps that come before it.
 */
export function useStepFacts(graph: WorkflowGraph) {
  const locale = useLocale();
  const t = useTranslations('workflows.builder');
  const all = useMemo(() => {
    const out: (FactOption & { stepId: string })[] = [];
    for (const { step } of walkSteps(graph.steps)) {
      if (step.type !== 'approval') continue;
      for (const f of step.fields ?? []) {
        const path = `${STEP_FACTS_ROOT}.${step.id}.${f.key}`;
        if (!FACT_PATH_RE.test(path)) continue;
        out.push({
          stepId: step.id,
          path,
          label: t('stepFact', {
            step: localize(step.name, locale) || step.id,
            field: localize(f.label, locale) || f.key,
          }),
          type: fieldType(f),
          ...(f.type === 'user' ? { ref: 'user' as const } : {}),
          options: f.options?.map((o) => ({ value: o.value, label: localize(o.label, locale) || o.value })),
        });
      }
    }
    return out;
  }, [graph, locale, t]);
  const before = useCallback(
    (stepId: string): FactOption[] => {
      const earlier = new Set(stepsBefore(graph, stepId).map((s) => s.id));
      return all.filter((f) => earlier.has(f.stepId));
    },
    [graph, all],
  );
  return { all, before };
}
