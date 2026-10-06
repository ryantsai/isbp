import {
  type ApprovalStep,
  type Branch,
  type ConditionStep,
  childBranches,
  type LocalizedText,
  newStepId,
  type NotifyStep,
  type ParallelStep,
  type StepType,
  type WorkflowGraph,
  type WorkflowStep,
} from '@isbp/sdk';
import type { SequenceRef } from '@isbp/ui/workflow-diagram';

/*
 * Immutable edits of a workflow graph for the builder. A sequence is addressed by `SequenceRef`
 * (the root, or one branch of a parallel/condition step).
 */

function mapSteps(steps: readonly WorkflowStep[], fn: (s: WorkflowStep) => WorkflowStep): WorkflowStep[] {
  return steps.map((s) => {
    const next = fn(s);
    if (next.type === 'parallel')
      return { ...next, branches: next.branches.map((b) => ({ ...b, steps: mapSteps(b.steps, fn) })) };
    if (next.type === 'condition')
      return {
        ...next,
        branches: next.branches.map((b) => ({ ...b, steps: mapSteps(b.steps, fn) })),
        otherwise: { ...next.otherwise, steps: mapSteps(next.otherwise.steps, fn) },
      };
    return next;
  });
}

function editBranch(
  step: WorkflowStep,
  branchId: string,
  fn: (steps: WorkflowStep[]) => WorkflowStep[],
): WorkflowStep {
  if (step.type === 'parallel')
    return {
      ...step,
      branches: step.branches.map((b) => (b.id === branchId ? { ...b, steps: fn(b.steps) } : b)),
    };
  if (step.type === 'condition') {
    if (step.otherwise.id === branchId)
      return { ...step, otherwise: { ...step.otherwise, steps: fn(step.otherwise.steps) } };
    return {
      ...step,
      branches: step.branches.map((b) => (b.id === branchId ? { ...b, steps: fn(b.steps) } : b)),
    };
  }
  return step;
}

/** Applies `fn` to the sequence at `ref`. */
export function editSequence(
  graph: WorkflowGraph,
  ref: SequenceRef,
  fn: (steps: WorkflowStep[]) => WorkflowStep[],
): WorkflowGraph {
  if (ref.kind === 'root') return { steps: fn([...graph.steps]) };
  return {
    steps: mapSteps(graph.steps, (s) =>
      s.id === ref.stepId ? editBranch(s, ref.branchId, (x) => fn([...x])) : s,
    ),
  };
}

export function getSequence(graph: WorkflowGraph, ref: SequenceRef): WorkflowStep[] {
  if (ref.kind === 'root') return graph.steps;
  let found: WorkflowStep[] = [];
  const visit = (steps: readonly WorkflowStep[]) => {
    for (const s of steps) {
      for (const b of childBranches(s)) {
        if (s.id === ref.stepId && b.id === ref.branchId) found = b.steps;
        visit(b.steps);
      }
    }
  };
  visit(graph.steps);
  return found;
}

export function insertStep(
  graph: WorkflowGraph,
  ref: SequenceRef,
  index: number,
  step: WorkflowStep,
): WorkflowGraph {
  return editSequence(graph, ref, (steps) => [...steps.slice(0, index), step, ...steps.slice(index)]);
}

export function moveStep(graph: WorkflowGraph, ref: SequenceRef, from: number, to: number): WorkflowGraph {
  return editSequence(graph, ref, (steps) => {
    if (to < 0 || to >= steps.length) return steps;
    const next = [...steps];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s!);
    return next;
  });
}

export function removeStep(graph: WorkflowGraph, stepId: string): WorkflowGraph {
  const strip = (steps: readonly WorkflowStep[]): WorkflowStep[] =>
    steps
      .filter((s) => s.id !== stepId)
      .map((s) => {
        if (s.type === 'parallel')
          return { ...s, branches: s.branches.map((b) => ({ ...b, steps: strip(b.steps) })) };
        if (s.type === 'condition')
          return {
            ...s,
            branches: s.branches.map((b) => ({ ...b, steps: strip(b.steps) })),
            otherwise: { ...s.otherwise, steps: strip(s.otherwise.steps) },
          };
        return s;
      });
  return { steps: strip(graph.steps) };
}

export function replaceStep(graph: WorkflowGraph, step: WorkflowStep): WorkflowGraph {
  return { steps: mapSteps(graph.steps, (s) => (s.id === step.id ? step : s)) };
}

/** Deep copy with fresh ids (steps and branches). */
export function cloneStep(step: WorkflowStep): WorkflowStep {
  const copy = structuredClone(step) as WorkflowStep;
  const renew = (s: WorkflowStep): WorkflowStep => {
    const id = newStepId();
    if (s.type === 'parallel')
      return {
        ...s,
        id,
        branches: s.branches.map((b) => ({ ...b, id: newStepId('b'), steps: b.steps.map(renew) })),
      };
    if (s.type === 'condition')
      return {
        ...s,
        id,
        branches: s.branches.map((b) => ({ ...b, id: newStepId('b'), steps: b.steps.map(renew) })),
        otherwise: { ...s.otherwise, id: newStepId('b'), steps: s.otherwise.steps.map(renew) },
      };
    return { ...s, id };
  };
  return renew(copy);
}

/** Where a step lives (its sequence and position). */
export function locate(graph: WorkflowGraph, stepId: string): { ref: SequenceRef; index: number } | null {
  let result: { ref: SequenceRef; index: number } | null = null;
  const visit = (steps: readonly WorkflowStep[], ref: SequenceRef) => {
    steps.forEach((s, index) => {
      if (s.id === stepId) result = { ref, index };
      for (const b of childBranches(s)) visit(b.steps, { kind: 'branch', stepId: s.id, branchId: b.id });
    });
  };
  visit(graph.steps, { kind: 'root' });
  return result;
}

export type StepNames = Record<StepType | 'branch' | 'otherwise' | 'yes', LocalizedText>;

/** A sensible new step of each type (names in the three languages come from the caller). */
export function newStep(type: StepType, names: StepNames): WorkflowStep {
  const id = newStepId();
  switch (type) {
    case 'approval':
      return {
        id,
        type,
        name: names.approval,
        approvers: [{ type: 'manager' }],
        mode: 'any',
        ifNoApprover: 'reject',
      } satisfies ApprovalStep;
    case 'notify':
      return { id, type, name: names.notify, recipients: [{ type: 'requester' }] } satisfies NotifyStep;
    case 'parallel':
      return {
        id,
        type,
        name: names.parallel,
        branches: [
          { id: newStepId('b'), name: { ...names.branch }, steps: [] },
          { id: newStepId('b'), name: { ...names.branch }, steps: [] },
        ],
      } satisfies ParallelStep;
    case 'condition':
      return {
        id,
        type,
        name: names.condition,
        branches: [{ id: newStepId('b'), name: names.yes, when: { all: [] }, steps: [] }],
        otherwise: { id: newStepId('b'), name: names.otherwise, steps: [] },
      } satisfies ConditionStep;
  }
}

export function newBranch(name: LocalizedText): Branch {
  return { id: newStepId('b'), name, steps: [] };
}
