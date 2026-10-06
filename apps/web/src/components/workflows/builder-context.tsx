'use client';

import type { FactOption } from '@isbp/ui/condition-builder';
import type { DiagramNames } from '@isbp/ui/workflow-diagram';
import { createContext, use } from 'react';

export interface BuilderContextValue {
  /** Facts the trigger provides (conditions, "person from a field"). */
  facts: FactOption[];
  /** Display names for groups/roles/people referenced by the graph. */
  names: Required<Omit<DiagramNames, 'facts'>>;
  roles: { key: string; name: string }[];
  remember: (kind: 'groups' | 'roles' | 'users', key: string, name: string) => void;
  readOnly: boolean;
}

export const BuilderContext = createContext<BuilderContextValue | null>(null);

export function useBuilder(): BuilderContextValue {
  const v = use(BuilderContext);
  if (!v) throw new Error('useBuilder() outside the workflow builder');
  return v;
}
