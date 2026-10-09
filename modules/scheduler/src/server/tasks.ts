/**
 * The built-in task types (`scheduler.http`, `scheduler.sql`, `scheduler.script`). They run through the
 * task-type registry like any module's type; the engine passes them their config with secrets opened.
 */
import {
  type DbConnectionInfo,
  ErrorCodes,
  HttpError,
  type ModuleContext,
  type RunProblem,
  runProblemOf,
  type SqlParamType,
  type SqlValue,
  type TaskContext,
  type TaskOutcome,
  type TaskTypeHandler,
} from '@isbp/sdk/server';
import { coerce, parameterNames, statementCount } from '@isbp/sql/params';
import type { HttpConfig, ScriptConfig, SqlConfig } from '../contracts';
import { plain, statusMatches } from '../model';

/** An error the engine records as `timed_out` rather than `failed`. */
export function timeoutError(message: string): Error {
  const err = new Error(message);
  err.name = 'TimeoutError';
  return err;
}

/** Attaches the explanation to an error (an `HttpError` keeps its code; others become `details.problem` holders). */
export function withProblem(err: unknown, problem: RunProblem): unknown {
  if (err instanceof HttpError)
    return new HttpError(err.statusCode, err.code, err.message, {
      ...((err.details as Record<string, unknown> | undefined) ?? {}),
      problem,
    });
  const e = err instanceof Error ? err : new Error(String(err));
  return Object.assign(e, { problem });
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
};

const invalid = (path: string, message: string) =>
  new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message }] });

/** `allowedHosts` setting: one host or `*.suffix` per line (commas and spaces also separate). */
export function parseHosts(text: unknown): string[] {
  return String(text ?? '')
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^(\*\.)?[a-z0-9.-]+$/.test(h));
}

/** `GET https://host/path` without the query string (it may carry tokens). */
export function describeUrl(method: string, url: string): string {
  try {
    const u = new URL(url);
    return `${method} ${u.origin}${u.pathname}`;
  } catch {
    return `${method} ${url.slice(0, 120)}`;
  }
}

const TEXTUAL =
  /^(text\/|application\/(json|xml|problem\+json|x-www-form-urlencoded|javascript)|.*\+json|.*\+xml)/i;

/** The first lines of a response body for the run log. */
function bodyPreview(body: Buffer, contentType: string | undefined, maxChars = 2_000): string[] {
  if (!body.length) return [];
  if (contentType && !TEXTUAL.test(contentType)) return [`(${body.length} bytes of ${contentType})`];
  const text = body.subarray(0, maxChars * 4).toString('utf8');
  const cut = text.length > maxChars || body.length > maxChars * 4;
  const lines = text.slice(0, maxChars).split('\n').slice(0, 20);
  if (cut || text.split('\n').length > 20) lines.push(`… (${body.length} bytes in total)`);
  return lines;
}

export const httpTask: TaskTypeHandler<HttpConfig> = {
  async describe(config) {
    return { label: describeUrl(config.method, config.url), href: null };
  },

  async run(config, task, ctx): Promise<TaskOutcome> {
    const allowHosts = parseHosts(await ctx.settings.get<string>('allowedHosts'));
    const headers: Record<string, string> = {};
    for (const h of config.headers) headers[h.name] = plain(h.value);
    const auth = config.auth;
    if (auth.type === 'basic')
      headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${plain(auth.password)}`).toString('base64')}`;
    else if (auth.type === 'bearer') headers.Authorization = `Bearer ${plain(auth.token)}`;
    else if (auth.type === 'header') headers[auth.name] = plain(auth.value);
    let body: string | undefined;
    if (config.bodyType !== 'none' && config.method !== 'GET' && config.method !== 'HEAD') {
      body = config.body;
      const hasType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
      if (!hasType)
        headers['Content-Type'] =
          config.bodyType === 'json' ? 'application/json' : 'text/plain; charset=utf-8';
    }

    task.log(describeUrl(config.method, config.url));
    const host = hostOf(config.url);
    let res;
    try {
      res = await ctx.http.request(config.url, {
        method: config.method,
        headers,
        body,
        timeoutMs: config.timeoutSeconds * 1_000,
        maxBytes: 64 * 1024,
        allowHosts,
        signal: task.signal,
      });
    } catch (err) {
      if (err instanceof HttpError && (err.details as { reason?: string } | undefined)?.reason === 'timeout')
        throw withProblem(timeoutError(`No response within ${config.timeoutSeconds} s`), {
          kind: 'http_timeout',
          params: { host, seconds: config.timeoutSeconds },
        });
      throw withProblem(err, runProblemOf(err, { host }));
    }
    const ok = statusMatches(config.expectedStatus, res.status);
    task.log(`HTTP ${res.status} in ${res.durationMs} ms (${res.body.length} bytes)`, ok ? 'info' : 'error');
    for (const line of bodyPreview(res.body, res.headers['content-type'])) task.log(line);
    if (!ok)
      throw new HttpError(
        422,
        ErrorCodes.UPSTREAM_FAILED,
        `Unexpected status ${res.status} (expected ${config.expectedStatus})`,
        {
          problem: {
            kind: 'http_status',
            params: { host, status: res.status, expected: config.expectedStatus },
          } satisfies RunProblem,
        },
      );
    return {
      summary: 'scheduler.results.http',
      summaryParams: { status: res.status, ms: res.durationMs },
      metrics: { status: res.status, durationMs: res.durationMs, bytes: res.body.length },
    };
  },
};

/** The connection behind a SQL job, checked for the `data` purpose. */
async function dataConnection(ctx: ModuleContext, id: string): Promise<DbConnectionInfo> {
  const conn = await ctx.databases.get(id);
  if (!conn) throw invalid('connectionId', 'This database connection does not exist');
  if (!conn.purposes.includes('data'))
    throw new HttpError(403, ErrorCodes.CONNECTION_PURPOSE, `Connection ${conn.name} is not for data use`, {
      purpose: 'data',
    });
  return conn;
}

/** Values and types for the statement's parameters (built-ins come from the run). */
export function sqlBindings(
  config: Pick<SqlConfig, 'params' | 'statement'>,
  engine: DbConnectionInfo['engine'],
  task: Pick<TaskContext, 'scheduledFor' | 'lastSuccessAt' | 'runId'>,
): { params: Record<string, SqlValue>; types: Record<string, SqlParamType> } {
  const used = new Set(parameterNames(config.statement, engine));
  const params: Record<string, SqlValue> = {};
  const types: Record<string, SqlParamType> = {};
  for (const p of config.params) {
    if (!used.has(p.name)) continue;
    switch (p.source) {
      case 'scheduled_for':
        params[p.name] = task.scheduledFor;
        types[p.name] = 'datetime';
        break;
      case 'last_success_at':
        params[p.name] = task.lastSuccessAt;
        types[p.name] = 'datetime';
        break;
      case 'run_id':
        params[p.name] = task.runId;
        types[p.name] = 'uuid';
        break;
      default:
        params[p.name] = p.value === null ? null : coerce(p.value, p.type);
        types[p.name] = p.type;
    }
  }
  return { params, types };
}

const firstLine = (sql: string) => {
  const line = sql.trim().split('\n')[0]!.trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

const cell = (v: unknown) => {
  if (v === null || v === undefined) return 'NULL';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
};

export const sqlTask: TaskTypeHandler<SqlConfig> = {
  async validate(config, ctx) {
    const conn = await dataConnection(ctx, config.connectionId);
    if (!conn.enabled)
      throw new HttpError(409, ErrorCodes.CONNECTION_DISABLED, `Connection ${conn.name} is disabled`);
    if (config.mode === 'execute' && conn.readOnly)
      throw new HttpError(409, ErrorCodes.CONNECTION_READ_ONLY, `Connection ${conn.name} is read-only`);
    if (statementCount(config.statement, conn.engine) !== 1)
      throw invalid('statement', 'A SQL job runs one statement');
    const defined = new Map(config.params.map((p, i) => [p.name, { p, i }]));
    for (const name of parameterNames(config.statement, conn.engine)) {
      const d = defined.get(name);
      if (!d) throw invalid('params', `Give :${name} a value`);
      if (d.p.source === 'static' && d.p.value !== null) {
        try {
          coerce(d.p.value, d.p.type);
        } catch (err) {
          throw invalid(`params.${d.i}.value`, err instanceof Error ? err.message : String(err));
        }
      }
    }
  },

  async describe(config, ctx) {
    const conn = await ctx.databases.get(config.connectionId);
    return { label: `${conn?.name ?? 'Unknown connection'}: ${firstLine(config.statement)}`, href: null };
  },

  async run(config, task, ctx): Promise<TaskOutcome> {
    const conn = await dataConnection(ctx, config.connectionId);
    const { params, types } = sqlBindings(config, conn.engine, task);
    task.log(`${config.mode === 'query' ? 'Query' : 'Execute'} on ${conn.name} (${conn.engine})`);
    for (const [name, value] of Object.entries(params))
      task.log(`:${name} = ${value instanceof Date ? value.toISOString() : cell(value)}`);
    const res = await ctx.databases
      .query(config.connectionId, config.statement, {
        purpose: 'data',
        params,
        types,
        readOnly: config.mode === 'query',
        maxRows: config.mode === 'query' ? conn.maxRows : 1,
        timeoutMs: task.timeoutMs,
        signal: task.signal,
      })
      .catch((err: unknown) => {
        // Name the connection, so the run page can say which one to fix and link to it.
        throw withProblem(err, runProblemOf(err, { connection: { id: conn.id, name: conn.name } }));
      });
    if (config.mode === 'execute') {
      const affected = res.affected ?? 0;
      task.log(`${affected} row(s) affected in ${res.durationMs} ms`);
      return {
        summary: 'scheduler.results.affected',
        summaryParams: { count: affected },
        metrics: { affected, durationMs: res.durationMs },
      };
    }
    const rows = res.rows.length;
    task.log(
      `${rows}${res.truncated ? '+' : ''} row(s) in ${res.durationMs} ms${res.truncated ? ' (capped by the connection)' : ''}`,
    );
    if (rows) {
      const cols = res.columns.map((c) => c.name);
      task.log(cols.join(' | '));
      for (const row of res.rows.slice(0, 10)) task.log(cols.map((c) => cell(row[c])).join(' | '));
      if (rows > 10) task.log(`… ${rows - 10} more row(s)`);
    }
    return {
      summary: res.truncated ? 'scheduler.results.rowsCapped' : 'scheduler.results.rows',
      summaryParams: { count: rows },
      metrics: { rows, durationMs: res.durationMs },
    };
  },
};

const LANGUAGE_LABEL: Record<ScriptConfig['language'], string> = {
  python: 'Python',
  node: 'Node.js',
  powershell: 'PowerShell',
  shell: 'Shell',
};

export const scriptTask: TaskTypeHandler<ScriptConfig> = {
  async validate(config, ctx) {
    const status = ctx.sandbox.status();
    if (!status.images.includes(config.image))
      throw invalid('image', `${config.image} is not one of the allowed images`);
  },

  async describe(config) {
    return { label: `${LANGUAGE_LABEL[config.language]} · ${config.image}`, href: null };
  },

  async run(config, task, ctx): Promise<TaskOutcome> {
    const status = ctx.sandbox.status();
    task.log(
      `${LANGUAGE_LABEL[config.language]} in ${config.image} on the ${status.runner} runner${status.isolated ? '' : ' (not sandboxed)'}`,
    );
    const env: Record<string, string> = {};
    for (const e of config.env) env[e.name] = plain(e.value);
    const res = await ctx.sandbox.run({
      image: config.image,
      language: config.language,
      script: config.script,
      env,
      timeoutMs: config.timeoutSeconds * 1_000,
      cpu: config.cpu,
      memoryMb: config.memoryMb,
      network: config.network,
      labels: { 'isbp-job': task.jobId, 'isbp-run': task.runId },
      signal: task.signal,
      onLog: (line, stream) => task.log(line, stream === 'stderr' ? 'warn' : 'info'),
    });
    if (res.cancelled) throw new Error('The script was stopped');
    if (res.timedOut)
      throw withProblem(timeoutError(`The script ran longer than ${config.timeoutSeconds} s`), {
        kind: 'timeout',
        params: { seconds: config.timeoutSeconds },
      });
    if (res.exitCode !== 0)
      throw withProblem(new Error(`The script exited with code ${res.exitCode ?? 'unknown'}`), {
        kind: 'script_exit',
        params: { code: String(res.exitCode ?? '?') },
      });
    task.log(`Exited with code 0 after ${res.durationMs} ms`);
    return {
      summary: 'scheduler.results.script',
      summaryParams: { ms: res.durationMs },
      metrics: { exitCode: 0, durationMs: res.durationMs },
    };
  },
};
