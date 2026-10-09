/**
 * Helpers shared by the platform, automation and assistant flows (`platform.ts`, `automation.ts`, `assistant.ts`).
 */
import type { ApiClient, ApiResponse, Json } from '../client';
import type { FlowContext } from '../flow';

export const REQUEST_REF = /^REQ-\d{5,}$/;
/** Process-action run states that are final. */
export const SETTLED = ['succeeded', 'failed', 'skipped'];
/** Scheduler run states that are final. */
export const RUN_DONE = ['succeeded', 'failed', 'timed_out', 'cancelled', 'skipped'];
/** The integration stand-ins of the simulator's stack (`pnpm sim:stack`: :4110). */
export const MOCKS = (
  process.env.SIM_MOCKS_URL ?? `http://127.0.0.1:${process.env.SIM_MOCKS_PORT ?? '4110'}`
).replace(/\/+$/, '');

const EMPLOYEES = ['employee1', 'employee2', 'employee3', 'employee4'];

/** An employee other than the run's (`ctx.as('employee')`): a colleague with nothing to do with the request. */
export function colleague(ctx: FlowContext): string {
  const me = ctx.personaOf(ctx.user('employee').id);
  return ctx.rand.pick(EMPLOYEES.filter((e) => e !== me));
}

/** A day relative to today (UTC), `YYYY-MM-DD`. */
export const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** The persona's notifications matching `about`, once there are at least `min` of them (newest first). */
export async function noticesOf(
  ctx: FlowContext,
  persona: string,
  about: (n: Json) => boolean,
  label: string,
  min = 1,
): Promise<Json[]> {
  const seen = await ctx.eventually(
    () => ctx.as(persona).get('/me/notifications', { query: { pageSize: 100 } }),
    (r) => r.status === 200 && ((r.body?.items ?? []) as Json[]).filter(about).length >= min,
    { label },
  );
  return (seen.body.items as Json[]).filter(about);
}

/** A request once its process actions have all finished (and it reached `status`, when given). */
export async function settledRequest(
  ctx: FlowContext,
  client: ApiClient,
  submissionId: string,
  opts: { status?: string; count?: number; label?: string } = {},
): Promise<Json> {
  const done = await ctx.eventually(
    () => client.get(`/form-submissions/${submissionId}`),
    (r) =>
      r.status === 200 &&
      (!opts.status || r.body.status === opts.status) &&
      (r.body.actions as Json[]).length >= (opts.count ?? 0) &&
      (r.body.actions as Json[]).every((a) => SETTLED.includes(a.status)),
    { label: opts.label ?? 'the request’s process actions', timeoutMs: 60_000 },
  );
  return done.body;
}

/** A scheduler run once it has finished. */
export async function finishedRun(ctx: FlowContext, client: ApiClient, runId: string, label = 'the run') {
  return (
    await ctx.eventually(
      () => client.get(`/scheduler/runs/${runId}`),
      (r) => r.status === 200 && RUN_DONE.includes(r.body.status),
      { label, timeoutMs: 60_000 },
    )
  ).body as Json;
}

/** A refusal: a 4xx (one of `statuses`, when given), never a 5xx or a success. */
export function refused<T>(
  ctx: FlowContext,
  res: ApiResponse<T>,
  statuses: readonly number[],
  message: string,
): ApiResponse<T> {
  return ctx.expect.status(res, statuses, `${message}: expected ${statuses.join('/')}, got ${res.status}`);
}

/**
 * The integration stand-ins' test controls (`/_mock/…`): acting as someone in the outside system. Not the product,
 * so not recorded as the product's requests.
 */
export async function mock(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  try {
    const res = await fetch(`${MOCKS}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: Json = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    return { status: 0, body: { error: (err as Error).message } };
  }
}

/** The stack's build has no such route (it predates the feature): `404 Route … not found`. */
export const routeMissing = (res: ApiResponse) =>
  res.status === 404 && /^Route /.test(String((res.body as Json)?.error?.message ?? ''));

/** `{ en, zh-TW, ja-JP }` with the same text (names the flows give things). */
export const text3 = (s: string) => ({ en: s, 'zh-TW': s, 'ja-JP': s });
