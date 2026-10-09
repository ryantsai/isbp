import { AsyncLocalStorage } from 'node:async_hooks';

/** Where the code that is running belongs: which flow run and which (nested) step. */
export interface RunScope {
  flow: string;
  iteration: number;
  steps: string[];
  /** The run's recent `ctx.log` lines and requests, attached to its failure. */
  trail: string[];
  /** The innermost step entered last (shared by the run's nested scopes): where a timed-out run was. */
  progress: { lastStep: string | null };
}

export const runScope = new AsyncLocalStorage<RunScope>();

export function currentScope(): RunScope | undefined {
  return runScope.getStore();
}

/** `submit › approve as manager` (nested steps), or null outside a step. */
export function currentStep(): string | null {
  const steps = runScope.getStore()?.steps;
  return steps?.length ? steps.join(' › ') : null;
}

const TRAIL = 40;

export function addTrail(line: string) {
  const scope = runScope.getStore();
  if (!scope) return;
  scope.trail.push(line);
  if (scope.trail.length > TRAIL) scope.trail.splice(0, scope.trail.length - TRAIL);
}
