import { z } from 'zod';
import { ErrorCodes, HttpError } from './http';

/**
 * Why a run failed (a scheduled job, a pipeline, a sync), as a kind the UI explains in the reader's language with
 * one next step — "The server of the connection CRM (MySQL) couldn't be found · Open connection" — instead of the
 * driver's text. The raw error stays on the run for "Technical details".
 */
export const RUN_PROBLEM_KINDS = [
  'db_host_not_found',
  'db_refused',
  'db_unreachable',
  'db_login',
  'db_timeout',
  'db_permission',
  'db_object_missing',
  'db_sql',
  'db_data',
  'db_constraint',
  'db_read_only',
  'db_other',
  'connection_disabled',
  'http_status',
  'http_unreachable',
  'http_timeout',
  'blocked',
  'timeout',
  'cancelled',
  'lost',
  'script_exit',
  'sandbox_unavailable',
  'remote_auth',
  'remote_rejected',
  'remote_rate_limited',
  'not_found',
  'invalid',
  'other',
] as const;
export type RunProblemKind = (typeof RUN_PROBLEM_KINDS)[number];

export const runProblemSchema = z.object({
  kind: z.enum(RUN_PROBLEM_KINDS),
  /** ICU values for the explanation: `host`, `status`, `expected`, `seconds`, `code`. */
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  /**
   * What to fix: a database connection (Administration → Database connections, the default) or, with `href`, another
   * page (an integration's connection).
   */
  connection: z.object({ id: z.string(), name: z.string(), href: z.string().nullish() }).nullish(),
});
export type RunProblem = z.infer<typeof runProblemSchema>;

export interface RunProblemHints {
  /** The database connection the work used (a SQL job's, the pipeline's source or target). */
  connection?: RunProblem['connection'];
  /** The host an HTTP call went to. */
  host?: string | null;
}

const DB_KIND: Record<string, RunProblemKind> = {
  auth: 'db_login',
  timeout: 'db_timeout',
  cancelled: 'cancelled',
  syntax: 'db_sql',
  permission: 'db_permission',
  constraint: 'db_constraint',
  not_found: 'db_object_missing',
  read_only: 'db_read_only',
  parameter: 'invalid',
};

/** Driver codes of the connect phase, by what they mean for the person fixing it. */
function connectKind(code: string | null | undefined): RunProblemKind {
  if (!code) return 'db_unreachable';
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) return 'db_host_not_found';
  if (/^(ECONNREFUSED|NJS-503|ORA-12541)$/.test(code)) return 'db_refused';
  return 'db_unreachable';
}

const hostIn = (text: string) =>
  /(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED)\s+\[?([\w.:-]+?)\]?(?::\d+)?(?:\s|$|\))/.exec(text)?.[1];

const isProblem = (v: unknown): v is RunProblem => runProblemSchema.safeParse(v).success;

const only = (params: Record<string, string | number | null | undefined>) =>
  Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as Record<string, string | number>;

/**
 * The problem behind an error a task, pipeline or sync threw. Errors that already carry one (`details.problem` of an
 * `HttpError`, e.g. a pipeline run's, or a `problem` property) keep it; database, HTTP, sandbox and remote-system errors map by code.
 */
export function runProblemOf(err: unknown, hints: RunProblemHints = {}): RunProblem {
  const connection = hints.connection ?? null;
  const own = (err as { problem?: unknown } | null)?.problem;
  if (isProblem(own)) return own;
  if (err instanceof HttpError) {
    const d = (err.details ?? {}) as Record<string, unknown>;
    if (isProblem(d.problem)) return d.problem;
    switch (err.code) {
      case ErrorCodes.DATABASE_ERROR: {
        const kind = typeof d.kind === 'string' ? d.kind : 'other';
        const dbCode = typeof d.dbCode === 'string' ? d.dbCode : null;
        const message = typeof d.message === 'string' ? d.message : err.message;
        const k =
          kind === 'connect'
            ? connectKind(dbCode)
            : (DB_KIND[kind] ?? (dbCode && /^22/.test(dbCode) ? 'db_data' : 'db_other'));
        return { kind: k, params: only({ host: hostIn(message), code: dbCode }), connection };
      }
      case ErrorCodes.CONNECTION_DISABLED:
        return { kind: 'connection_disabled', params: {}, connection };
      case ErrorCodes.TARGET_BLOCKED:
      case ErrorCodes.INSECURE_HTTP:
        return { kind: 'blocked', params: only({ host: hints.host }), connection: null };
      case ErrorCodes.UPSTREAM_FAILED: {
        const reason = typeof d.reason === 'string' ? d.reason : 'network';
        if (reason === 'cancelled') return { kind: 'cancelled', params: {}, connection: null };
        return {
          kind: reason === 'timeout' ? 'http_timeout' : 'http_unreachable',
          params: only({
            host: hints.host ?? hostIn(err.message),
            code: typeof d.code === 'string' ? d.code : null,
          }),
          connection: null,
        };
      }
      case ErrorCodes.SANDBOX_UNAVAILABLE:
        return { kind: 'sandbox_unavailable', params: {}, connection: null };
      case ErrorCodes.REMOTE_AUTH_FAILED:
        return { kind: 'remote_auth', params: {}, connection };
      case ErrorCodes.REMOTE_REJECTED:
        return { kind: 'remote_rejected', params: {}, connection };
      case ErrorCodes.REMOTE_RATE_LIMITED:
        return { kind: 'remote_rate_limited', params: {}, connection };
      case ErrorCodes.NOT_FOUND:
        return { kind: 'not_found', params: {}, connection: null };
      case ErrorCodes.VALIDATION_FAILED:
        return { kind: 'invalid', params: {}, connection: null };
      default:
        return { kind: 'other', params: {}, connection };
    }
  }
  if (err instanceof Error && err.name === 'TimeoutError') return runProblemFromText(err.message, hints);
  return runProblemFromText(err instanceof Error ? err.message : String(err ?? ''), hints);
}

/**
 * The problem behind a stored error text (runs recorded before problems were kept, or plain errors): the
 * engines' own phrases and the drivers' codes. `other` when nothing is recognised.
 */
export function runProblemFromText(text: string | null | undefined, hints: RunProblemHints = {}): RunProblem {
  const s = String(text ?? '');
  const connection = hints.connection ?? null;
  let m: RegExpExecArray | null;
  if ((m = /Unexpected status (\d{3}) \(expected ([^)]+)\)/.exec(s)))
    return {
      kind: 'http_status',
      params: only({ status: Number(m[1]), expected: m[2], host: hints.host }),
      connection: null,
    };
  if ((m = /No response within (\d+) s/.exec(s)))
    return {
      kind: 'http_timeout',
      params: only({ seconds: Number(m[1]), host: hints.host }),
      connection: null,
    };
  if ((m = /(?:Timed out after|ran longer than) (\d+) s/.exec(s)))
    return { kind: 'timeout', params: { seconds: Number(m[1]) }, connection: null };
  if (/^Cancel+ed\b|Cancelled by a person|Cancelled before it started|stopped by Scheduled Jobs/i.test(s))
    return { kind: 'cancelled', params: {}, connection: null };
  if (/no heartbeat|stopped responding|taken over/i.test(s))
    return { kind: 'lost', params: {}, connection: null };
  if ((m = /exited with code (\S+)/.exec(s)))
    return { kind: 'script_exit', params: { code: m[1]! }, connection: null };
  if (/blocked address range|not allowed/i.test(s))
    return { kind: 'blocked', params: only({ host: hints.host }), connection: null };
  const http = /upstream|\(network\)|^network:|^timeout:/i.test(s);
  if (http)
    return {
      kind: /timeout/i.test(s) ? 'http_timeout' : 'http_unreachable',
      params: only({ host: hints.host ?? hostIn(s) }),
      connection: null,
    };
  if (/\b(ENOTFOUND|EAI_AGAIN)\b/.test(s))
    return { kind: 'db_host_not_found', params: only({ host: hostIn(s) }), connection };
  if (/\bECONNREFUSED\b/.test(s))
    return { kind: 'db_refused', params: only({ host: hostIn(s) }), connection };
  if (/\b(ETIMEDOUT|EHOSTUNREACH|ECONNRESET|ESOCKET)\b/.test(s))
    return { kind: 'db_unreachable', params: {}, connection };
  if (
    /\b(28P01|28000|18456|ORA-01017|ER_ACCESS_DENIED_ERROR)\b|password authentication failed|login failed/i.test(
      s,
    )
  )
    return { kind: 'db_login', params: {}, connection };
  if (/\b(57014|ORA-01013)\b|statement timeout/i.test(s))
    return { kind: 'db_timeout', params: {}, connection };
  if (/\b(42501|ORA-01031)\b|permission denied/i.test(s))
    return { kind: 'db_permission', params: {}, connection };
  if (/\b(42P01|42883|ORA-00942)\b|does not exist/i.test(s))
    return { kind: 'db_object_missing', params: {}, connection };
  if (/\b(42601|ORA-00933|ER_PARSE_ERROR)\b|syntax error/i.test(s))
    return { kind: 'db_sql', params: {}, connection };
  if (/\b22\d{3}\b/.test(s)) return { kind: 'db_data', params: {}, connection };
  if (/\b23\d{3}\b|duplicate key|violates/i.test(s)) return { kind: 'db_constraint', params: {}, connection };
  if (/DATABASE_ERROR/.test(s)) return { kind: 'db_other', params: {}, connection };
  if (/REMOTE_AUTH_FAILED|refused the connection's credentials/i.test(s))
    return { kind: 'remote_auth', params: {}, connection };
  if (/RATE_LIMITED/.test(s)) return { kind: 'remote_rate_limited', params: {}, connection };
  if (/not found/i.test(s)) return { kind: 'not_found', params: {}, connection: null };
  if (/VALIDATION_FAILED/.test(s)) return { kind: 'invalid', params: {}, connection: null };
  return { kind: 'other', params: {}, connection };
}
