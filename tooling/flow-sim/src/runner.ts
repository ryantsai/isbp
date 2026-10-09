/**
 * Runs the flows: each iteration runs every selected flow once, in a seeded random order; `concurrency` flow runs are
 * in flight at once, across iterations. A flow run gets its own random generator and its own pool members.
 */
import { runScope, type RunScope } from './context';
import { createContext, type FlowDefinition, FlowError, type RequestExcerpt } from './flow';
import { createForms } from './forms';
import type { PersonaDirectory } from './personas';
import { hashSeed, Rand } from './rand';
import type { Recorder } from './recorder';
import { failureSignature } from './signature';
import { createApprovals } from './workflows';

export interface FlowRunResult {
  flow: string;
  iteration: number;
  ok: boolean;
  /** Milliseconds since the run started. */
  startedAt: number;
  ms: number;
  tags: string[];
  personas: Record<string, string>;
  error?: {
    signature: string;
    message: string;
    step: string | null;
    request: RequestExcerpt | null;
    details: unknown;
    stack: string | null;
    trail: string[];
  };
}

export interface RunOptions {
  flows: FlowDefinition[];
  iterations: number;
  concurrency: number;
  seed: number;
  runToken: string;
  flowTimeoutMs: number;
  directory: PersonaDirectory;
  recorder: Recorder;
  signal: AbortSignal;
  onResult?: (r: FlowRunResult, done: number, total: number) => void;
}

export interface RunOutcome {
  results: FlowRunResult[];
  wallMs: number;
  /** Per iteration: from its first flow's start to its last flow's end. */
  iterationSpans: { iteration: number; ms: number }[];
  aborted: boolean;
}

/** Three base-36 characters per flow name, for unique suffixes. */
const flowTag = (name: string) => hashSeed(name).toString(36).padStart(3, '0').slice(-3);

class FlowTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new FlowTimeout(`the flow did not finish within ${ms / 1000} s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function runFlows(opts: RunOptions): Promise<RunOutcome> {
  const tasks: { iteration: number; flow: FlowDefinition }[] = [];
  for (let i = 1; i <= opts.iterations; i++)
    for (const flow of new Rand(hashSeed(opts.seed, 'order', i)).shuffle(opts.flows))
      tasks.push({ iteration: i, flow });

  const results: FlowRunResult[] = [];
  const spans = new Map<number, { start: number; end: number }>();
  const started = Date.now();
  let next = 0;

  const runOne = async (iteration: number, flow: FlowDefinition): Promise<FlowRunResult> => {
    const rand = new Rand(
      hashSeed(opts.seed, iteration, flow.name),
      `${opts.runToken}-${iteration.toString(36)}-${flowTag(flow.name)}`,
    );
    const picks = new Map<string, string>();
    const resolve = (persona: string) => {
      const members = opts.directory.members(persona);
      if (members.length === 1) return members[0]!;
      let chosen = picks.get(persona);
      if (!chosen) {
        chosen = rand.fork(`persona:${persona}`).pick(members);
        picks.set(persona, chosen);
      }
      return chosen;
    };
    const tags = new Set<string>();
    const ctx = createContext({
      flow: flow.name,
      iteration,
      runToken: opts.runToken,
      rand,
      recorder: opts.recorder,
      resolve,
      client: (name) => opts.directory.client(name),
      info: (name) => opts.directory.info(name),
      personaOf: (id) => opts.directory.nameOf(id),
      tags,
      approvals: createApprovals,
      forms: createForms,
    });
    const scope: RunScope = {
      flow: flow.name,
      iteration,
      steps: [],
      trail: [],
      progress: { lastStep: null },
    };
    const t0 = Date.now();
    const base = { flow: flow.name, iteration, startedAt: t0 - started };
    try {
      await runScope.run(scope, () => withTimeout(flow.run(ctx), flow.timeoutMs ?? opts.flowTimeoutMs));
      return { ...base, ok: true, ms: Date.now() - t0, tags: [...tags], personas: Object.fromEntries(picks) };
    } catch (err) {
      const e = err as Error & { simStep?: string };
      const step =
        err instanceof FlowError
          ? err.step
          : err instanceof FlowTimeout
            ? scope.progress.lastStep
            : (e.simStep ?? scope.progress.lastStep);
      const message = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        ok: false,
        ms: Date.now() - t0,
        tags: [...tags],
        personas: Object.fromEntries(picks),
        error: {
          signature: failureSignature(flow.name, step, message, opts.runToken),
          message,
          step,
          request: err instanceof FlowError ? err.request : null,
          details: err instanceof FlowError ? err.details : undefined,
          stack:
            err instanceof FlowError || err instanceof FlowTimeout
              ? null
              : (e.stack?.split('\n').slice(0, 8).join('\n') ?? null),
          trail: [...scope.trail],
        },
      };
    }
  };

  const worker = async () => {
    while (!opts.signal.aborted) {
      const index = next++;
      const task = tasks[index];
      if (!task) return;
      const t0 = Date.now() - started;
      const result = await runOne(task.iteration, task.flow);
      results.push(result);
      const span = spans.get(task.iteration) ?? { start: t0, end: 0 };
      span.start = Math.min(span.start, t0);
      span.end = Math.max(span.end, Date.now() - started);
      spans.set(task.iteration, span);
      opts.onResult?.(result, results.length, tasks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  return {
    results,
    wallMs: Date.now() - started,
    iterationSpans: [...spans.entries()]
      .sort(([a], [b]) => a - b)
      .map(([iteration, s]) => ({ iteration, ms: s.end - s.start })),
    aborted: opts.signal.aborted,
  };
}
