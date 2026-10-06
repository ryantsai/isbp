'use client';

import type { WorkflowInstance, WorkflowNames } from '@isbp/contracts';
import { type ApproverRule, conditionFacts, walkSteps, type WorkflowGraph } from '@isbp/sdk';
import type { FactOption } from '@isbp/ui/condition-builder';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useFactLabel } from './use-fact-label';

/** Fact labels (and known enum values) for the conditions a graph uses. */
export function useGraphFacts(graph: WorkflowGraph): FactOption[] {
  const label = useFactLabel();
  const tv = useTranslations('workflows.factValues');
  return useMemo(() => {
    const paths = new Set<string>();
    const addRule = (r: ApproverRule) => {
      if (r.type === 'fact') paths.add(r.fact);
      if ('fallback' in r && r.fallback) addRule(r.fallback);
    };
    for (const { step } of walkSteps(graph.steps)) {
      conditionFacts(step.when).forEach((p) => paths.add(p));
      if (step.type === 'condition')
        step.branches.forEach((b) => conditionFacts(b.when).forEach((p) => paths.add(p)));
      if (step.type === 'approval') [...step.approvers, ...(step.sla?.escalateTo ?? [])].forEach(addRule);
      if (step.type === 'notify') step.recipients.forEach(addRule);
    }
    return [...paths].map((path) => {
      const base = path.replaceAll('.', '_');
      const values = tv.has(base) ? Object.keys(tv.raw(base) as Record<string, string>) : [];
      return {
        path,
        label: label(path),
        type: 'string' as const,
        options: values.length ? values.map((v) => ({ value: v, label: tv(`${base}.${v}`) })) : undefined,
      };
    });
  }, [graph, label, tv]);
}

/** Step states of an instance for the diagram: decisions, who is asked, skipped reasons. */
export function instanceRuntime(instance: Pick<WorkflowInstance, 'graph' | 'state' | 'tasks' | 'status'>) {
  const runtime: Record<string, StepRuntime> = {};
  const chosen: Record<string, string> = {};
  for (const { step } of walkSteps(instance.graph.steps)) {
    const st = instance.state.steps[step.id];
    if (st?.branch) chosen[step.id] = st.branch;
    const tasks = instance.tasks.filter((t) => t.stepId === step.id);
    const status = st?.status ?? 'waiting';
    runtime[step.id] = {
      status: status === 'active' && instance.status !== 'running' ? 'skipped' : status,
      reason: st?.reason,
      people: tasks
        .filter((t) => t.status !== 'delegated')
        .map((t) => ({ name: t.assignee.displayName, avatarUrl: t.assignee.avatarUrl, status: t.status })),
    };
  }
  return { runtime, chosen };
}

export function InstanceProgress({
  instance,
  className,
}: {
  instance: Pick<WorkflowInstance, 'graph' | 'state' | 'tasks' | 'status'> & { names: WorkflowNames };
  className?: string;
}) {
  const facts = useGraphFacts(instance.graph);
  const { runtime, chosen } = useMemo(() => instanceRuntime(instance), [instance]);
  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/20 py-4 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:16px_16px]">
      <WorkflowDiagram
        graph={instance.graph}
        names={{ ...instance.names, facts }}
        runtime={runtime}
        chosen={chosen}
        outcome={instance.status}
        className={className}
      />
    </div>
  );
}
