/**
 * The flow contract. A flow is one user journey through the product, written against the public API as the
 * people in it would do it; the runner runs it once per iteration with fresh random data:
 *
 * ```ts
 * export const raiseTicket = defineFlow({
 *   name: 'ticket-lifecycle',
 *   area: 'itsm',
 *   personas: ['employee', 'agent'],
 *   async run(ctx) {
 *     const me = ctx.as('employee');
 *     const t = await ctx.step('raise', async () =>
 *       ctx.expect.ok(await me.post('/itsm/tickets', { title: `Printer ${ctx.rand.suffix()}` })).body,
 *     );
 *     …
 *   },
 * });
 * ```
 */
import { isDeepStrictEqual } from 'node:util';
import type { ApiClient, ApiResponse, Json } from './client';
import { addTrail, currentStep, runScope } from './context';
import type { PersonaInfo } from './personas';
import type { Rand } from './rand';
import { excerpt, type Recorder } from './recorder';
import type { Approvals } from './workflows';
import type { Forms } from './forms';

export interface FlowDefinition {
  /** kebab-case, unique: `--flows access-request,ticket-lifecycle`. */
  name: string;
  /** The module or area it exercises (`core`, `itsm`, …): the file it lives in, `src/flows/<area>.ts`. */
  area: string;
  description?: string;
  /** Personas or pools it acts as (checked before the run starts). */
  personas: readonly string[];
  /** Fails the run when it takes longer (default 180 s). */
  timeoutMs?: number;
  run(ctx: FlowContext): Promise<void>;
}

const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function defineFlow(def: FlowDefinition): FlowDefinition {
  if (!NAME_RE.test(def.name)) throw new Error(`Flow name "${def.name}" must be kebab-case`);
  if (!def.personas.length) throw new Error(`Flow ${def.name} must declare the personas it uses`);
  return def;
}

export interface RequestExcerpt {
  method: string;
  path: string;
  status: number;
  body: string;
  requestId: string | null;
}

/** A failed check: where (flow, step), what, and the request and response that showed it. */
export class FlowError extends Error {
  readonly step: string | null;
  readonly request: RequestExcerpt | null;
  readonly details: unknown;

  constructor(message: string, opts: { response?: ApiResponse; details?: unknown } = {}) {
    super(message);
    this.name = 'FlowError';
    this.step = currentStep();
    this.request = opts.response ? requestExcerpt(opts.response) : null;
    this.details = opts.details;
  }
}

export function requestExcerpt(res: ApiResponse): RequestExcerpt {
  return {
    method: res.method,
    path: res.path,
    status: res.status,
    body: excerpt(res.body, 1_200),
    requestId: res.requestId,
  };
}

const isResponse = (v: unknown): v is ApiResponse =>
  typeof v === 'object' && v !== null && 'status' in v && 'body' in v && 'method' in v && 'path' in v;

const describe = (v: unknown) => excerpt(v, 300);

/** Checks that throw a {@link FlowError} carrying the step, the request and an excerpt of the response. */
export interface Expect {
  /** A 2xx response (returns it, for chaining: `ctx.expect.ok(await c.get(…)).body`). */
  ok<T>(res: ApiResponse<T>, message?: string): ApiResponse<T>;
  /** One of the statuses. */
  status<T>(res: ApiResponse<T>, expected: number | readonly number[], message?: string): ApiResponse<T>;
  /** An error response with this `error.code` (and status, when given). */
  code<T>(res: ApiResponse<T>, code: string, status?: number, message?: string): ApiResponse<T>;
  /** Deep equality. */
  equal<T>(actual: T, expected: T, message: string): void;
  /** A truthy value (returned, for chaining). */
  truthy<T>(value: T, message: string): NonNullable<T>;
  match(value: unknown, re: RegExp, message: string): void;
  /** The first item that matches (a predicate, or deep-equal to a value). */
  find<T>(items: readonly T[] | null | undefined, match: ((item: T) => boolean) | T, message: string): T;
  /**
   * Of responses to the same request sent at once (a double click, two people at the same time): exactly one 2xx and
   * the others refused with a 4xx (one of `refusedWith`, when given). Returns the one that went through.
   */
  oneOk<T>(
    responses: readonly ApiResponse<T>[],
    message: string,
    refusedWith?: readonly number[],
  ): ApiResponse<T>;
}

export const expect: Expect = {
  ok(res, message) {
    if (res.status < 200 || res.status >= 300)
      throw new FlowError(message ?? `expected 2xx from ${res.method} ${res.path}, got ${res.status}`, {
        response: res,
      });
    return res;
  },
  status(res, expected, message) {
    const list = typeof expected === 'number' ? [expected] : expected;
    if (!list.includes(res.status))
      throw new FlowError(
        message ?? `expected ${list.join('/')} from ${res.method} ${res.path}, got ${res.status}`,
        { response: res },
      );
    return res;
  },
  code(res, code, status, message) {
    const got = (res.body as Json)?.error?.code;
    if (got !== code || (status !== undefined && res.status !== status))
      throw new FlowError(
        message ??
          `expected ${status ?? 'an error'} ${code} from ${res.method} ${res.path}, got ${res.status} ${got ?? ''}`.trim(),
        { response: res },
      );
    return res;
  },
  equal(actual, expected, message) {
    if (!isDeepStrictEqual(actual, expected))
      throw new FlowError(`${message}: expected ${describe(expected)}, got ${describe(actual)}`);
  },
  truthy(value, message) {
    if (!value) throw new FlowError(`${message} (got ${describe(value)})`);
    return value as NonNullable<typeof value>;
  },
  match(value, re, message) {
    if (typeof value !== 'string' || !re.test(value))
      throw new FlowError(`${message}: ${describe(value)} does not match ${re}`);
  },
  find(items, match, message) {
    const test =
      typeof match === 'function'
        ? (match as (item: unknown) => boolean)
        : (item: unknown) => isDeepStrictEqual(item, match);
    const found = (items ?? []).find((i) => test(i));
    if (found === undefined)
      throw new FlowError(`${message} (among ${items?.length ?? 0} items: ${describe(items?.slice(0, 5))})`);
    return found;
  },
  oneOk(responses, message, refusedWith) {
    const ok = responses.filter((r) => r.status >= 200 && r.status < 300);
    const refused = responses.filter((r) => r.status >= 400 && r.status < 500);
    const allowed = refused.every((r) => !refusedWith || refusedWith.includes(r.status));
    if (ok.length !== 1 || refused.length !== responses.length - 1 || !allowed)
      throw new FlowError(
        `${message}: expected one success and ${responses.length - 1} refusal(s), got ${responses
          .map((r) => r.status)
          .join(', ')}`,
        {
          response: ok[1] ?? responses.find((r) => r.status >= 500) ?? refused[0] ?? responses[0],
          details: responses.map((r) => ({ status: r.status, body: excerpt(r.body, 300) })),
        },
      );
    return ok[0]!;
  },
};

export interface EventuallyOptions {
  /** Default 30 s. */
  timeoutMs?: number;
  /** Default 250 ms. */
  intervalMs?: number;
  /** What is awaited, for the failure and the report's wait times ("the grant", "the change"). */
  label?: string;
}

export interface FlowContext {
  readonly flow: string;
  readonly iteration: number;
  readonly rand: Rand;
  /**
   * The run's token, in every name and key a flow of this run creates. Another flow of the run may delete such a record
   * at any time, so a flow that picks shared records (a support group, a configuration item) skips the run's own.
   */
  readonly runToken: string;
  /**
   * The API as a persona: `ctx.as('admin')`, or a pool (`ctx.as('employee')`) — the same pool member for the whole
   * run. Requests return `{ status, body }` and never throw.
   */
  as(persona: string): ApiClient;
  /** Who a persona (or the run's pool member) is: id, username, display name. */
  user(persona: string): PersonaInfo;
  /** The persona name of a user id (null when the user isn't one of the simulator's personas). */
  personaOf(userId: string): string | null;
  /** Names a part of the flow: failures say which step they happened in. Steps nest. */
  step<T>(label: string, fn: () => Promise<T>): Promise<T>;
  readonly expect: Expect;
  /**
   * Polls `fn` until `check` accepts its value (background work: event handlers, workflow completions, process
   * actions). Returns the accepted value; throws a FlowError with the last value when it times out.
   */
  eventually<T>(fn: () => Promise<T>, check: (value: T) => boolean, opts?: EventuallyOptions): Promise<T>;
  /** Approval workflows: decide as a persona, approve until done. */
  readonly approvals: Approvals;
  /** Request forms: random valid answers from a published form's schema. */
  readonly forms: Forms;
  /** Counts a variant the run took (`ctx.tag('rejected')`): the report shows the counts per flow. */
  tag(name: string): void;
  /** A line for the failure report (the last lines of a failed run are kept). */
  log(message: string): void;
  fail(message: string, details?: unknown): never;
}

export interface ContextDeps {
  flow: string;
  iteration: number;
  runToken: string;
  rand: Rand;
  recorder: Recorder;
  resolve: (persona: string) => string;
  client: (persona: string) => ApiClient;
  info: (persona: string) => PersonaInfo;
  personaOf: (userId: string) => string | null;
  tags: Set<string>;
  approvals: (ctx: FlowContext) => Approvals;
  forms: (ctx: FlowContext) => Forms;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createContext(d: ContextDeps): FlowContext {
  const ctx: FlowContext = {
    flow: d.flow,
    iteration: d.iteration,
    runToken: d.runToken,
    rand: d.rand,
    as: (persona) => d.client(d.resolve(persona)),
    user: (persona) => d.info(d.resolve(persona)),
    personaOf: d.personaOf,
    async step(label, fn) {
      const scope = runScope.getStore();
      if (!scope) return fn();
      const steps = [...scope.steps, label];
      const path = steps.join(' › ');
      scope.progress.lastStep = path;
      addTrail(`— ${path}`);
      try {
        return await runScope.run({ ...scope, steps }, fn);
      } catch (err) {
        // Unexpected errors (a TypeError reading a body) keep the innermost step they happened in.
        if (err && typeof err === 'object' && !(err instanceof FlowError) && !('simStep' in err))
          Object.assign(err, { simStep: path });
        throw err;
      }
    },
    expect,
    async eventually(fn, check, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? 30_000;
      const interval = opts.intervalMs ?? 250;
      const label = opts.label ?? currentStep() ?? 'eventually';
      const started = Date.now();
      let last: Awaited<ReturnType<typeof fn>>;
      for (;;) {
        last = await fn();
        let accepted = false;
        try {
          accepted = check(last);
        } catch {
          accepted = false;
        }
        if (accepted) {
          d.recorder.recordWait({ flow: d.flow, label, ms: Date.now() - started, ok: true });
          return last;
        }
        if (Date.now() - started > timeoutMs) break;
        await sleep(interval);
      }
      d.recorder.recordWait({ flow: d.flow, label, ms: Date.now() - started, ok: false });
      throw new FlowError(`timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${label}`, {
        ...(isResponse(last) ? { response: last } : { details: excerpt(last, 1_200) }),
      });
    },
    approvals: undefined as unknown as Approvals,
    forms: undefined as unknown as Forms,
    tag: (name) => void d.tags.add(name),
    log: (message) => addTrail(message),
    fail(message, details) {
      throw new FlowError(message, { details });
    },
  };
  Object.assign(ctx, { approvals: d.approvals(ctx), forms: d.forms(ctx) });
  return ctx;
}
