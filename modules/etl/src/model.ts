/**
 * Data APIs & ETL vocabulary and its pure rules (no I/O): shared by the API, the pages, the AI tools and the
 * unit tests. The request schema of an endpoint version, the pipeline column transforms, CSV rendering, the
 * version diff and the OpenAPI document are built here, so the test console, the invocation route and the
 * docs tab can never disagree. Browser-safe: only `@isbp/sql/params` from the SQL package.
 */
import { PARAM_NAME_RE } from '@isbp/sql/params';
import { z } from 'zod';

/* ───────────────────────────── enums ───────────────────────────── */

export const ENDPOINT_METHODS = ['GET', 'POST'] as const;
export type EndpointMethod = (typeof ENDPOINT_METHODS)[number];

/** `query`: SQL with `:params`; `procedure`: a stored procedure or function from the catalog. */
export const ENDPOINT_KINDS = ['query', 'procedure'] as const;
export type EndpointKind = (typeof ENDPOINT_KINDS)[number];

/** `rows`: an array; `single`: the first row (404 when there is none). */
export const RESPONSE_SHAPES = ['rows', 'single'] as const;
export type ResponseShape = (typeof RESPONSE_SHAPES)[number];

export const PARAM_TYPES = [
  'string',
  'integer',
  'decimal',
  'number',
  'boolean',
  'date',
  'datetime',
  'uuid',
] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

/** A frozen version: callers may use it, it answers with a `Deprecation` header, or it is gone (410). */
export const VERSION_STATUSES = ['published', 'deprecated', 'retired'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/** An endpoint as a whole: never published, callable, only deprecated versions left, or all retired. */
export const ENDPOINT_STATUSES = ['draft', 'published', 'deprecated', 'retired'] as const;
export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

export const WRITE_MODES = ['insert', 'upsert', 'replace'] as const;
export type WriteModeValue = (typeof WRITE_MODES)[number];

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running'];

export const RUN_TRIGGERS = ['manual', 'schedule'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const TRANSFORM_KINDS = ['none', 'trim', 'upper', 'lower', 'cast', 'default', 'constant'] as const;
export type TransformKind = (typeof TRANSFORM_KINDS)[number];

export const CAST_TYPES = ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime'] as const;
export type CastType = (typeof CAST_TYPES)[number];

export const CALL_PERIODS = ['24h', '7d', '30d'] as const;
export type CallPeriod = (typeof CALL_PERIODS)[number];
export const STATS_PERIODS = ['24h', '7d'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export const PERIOD_HOURS: Record<CallPeriod, number> = { '24h': 24, '7d': 168, '30d': 720 };

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const ENDPOINT_TONE: Record<EndpointStatus, Tone> = {
  draft: 'neutral',
  published: 'success',
  deprecated: 'warning',
  retired: 'neutral',
};

export const RUN_TONE: Record<RunStatus, Tone> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

/* ───────────────────────────── limits ───────────────────────────── */

/** `customers-by-region`: lower-case words joined by single dashes, 2–64 characters. */
export const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 2;
export const SLUG_MAX = 64;
export { PARAM_NAME_RE };

export const MAX_PARAMS = 50;
export const MAX_LIST_ITEMS = 1_000;
/** Strings without a `maxLength` are still capped (defence against huge query strings). */
export const DEFAULT_MAX_STRING = 4_000;
/** Responses larger than this are not cached. */
export const MAX_CACHE_BYTES = 1_000_000;
/** Pipeline run logs keep this many lines (the newest are dropped once full, with a note). */
export const MAX_RUN_LOG_LINES = 500;
/** Shown in logs instead of a sensitive parameter's value. */
export const MASK = '•••';
export const WATERMARK_PARAM = 'watermark';

/* ───────────────────────────── definitions ───────────────────────────── */

/** A typed endpoint parameter. Values that come from URLs (defaults, examples, enum members) are strings. */
export interface ParamDef {
  name: string;
  type: ParamType;
  /** Accepts several values (`IN (:ids)`): repeated query keys, comma-separated, or a JSON array. */
  list: boolean;
  required: boolean;
  default: string | null;
  min: number | null;
  max: number | null;
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
  enum: string[] | null;
  description: string | null;
  example: string | null;
  /** Masked as "•••" in execution logs. */
  sensitive: boolean;
  /** Procedure kind: the routine's argument this parameter feeds (default: the same name). */
  target: string | null;
}

export interface ProcedureDef {
  schema: string;
  name: string;
  kind: 'procedure' | 'function';
  returns: string | null;
  parameters: { name: string; type: string; direction: 'in' | 'out' | 'inout' }[];
}

/** What a version freezes: everything that decides how a call executes and what it returns. */
export interface EndpointDefinition {
  method: EndpointMethod;
  connectionId: string;
  kind: EndpointKind;
  sql: string;
  procedure: ProcedureDef | null;
  params: ParamDef[];
  allowsWrites: boolean;
  responseShape: ResponseShape;
  maxRows: number;
  timeoutMs: number;
  cacheTtlSeconds: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export function newParam(name: string, type: ParamType = 'string'): ParamDef {
  return {
    name,
    type,
    list: false,
    required: true,
    default: null,
    min: null,
    max: null,
    minLength: null,
    maxLength: null,
    pattern: null,
    enum: null,
    description: null,
    example: null,
    sensitive: false,
    target: null,
  };
}

/** Parameters for a routine's IN arguments (procedure kind), typed from the catalog. */
export function paramsForProcedure(proc: Pick<ProcedureDef, 'parameters'>): ParamDef[] {
  return proc.parameters
    .filter((p) => p.direction !== 'out' && p.name)
    .map((p) => ({ ...newParam(p.name, paramTypeFor(p.type)), target: p.name }));
}

/** The argument a parameter feeds (procedure kind) or the `:name` it binds (query kind). */
export const paramTarget = (p: Pick<ParamDef, 'name' | 'target'>) => p.target || p.name;

/** Parameters the SQL uses but are not defined, and defined ones it no longer uses. */
export function paramDrift(defined: readonly string[], used: readonly string[]) {
  const d = new Set(defined);
  const u = new Set(used);
  return { missing: used.filter((n) => !d.has(n)), unused: defined.filter((n) => !u.has(n)) };
}

/** A sensible parameter type for a catalog column/argument type (`varchar`, `int4`, `numeric`, …). */
export function paramTypeFor(dbType: string): ParamType {
  const t = dbType.toLowerCase();
  if (/^(uuid|uniqueidentifier)$/.test(t)) return 'uuid';
  if (/^(bool|boolean|bit)$/.test(t)) return 'boolean';
  if (/^(date)$/.test(t)) return 'date';
  if (/(timestamp|datetime|smalldatetime|datetimeoffset)/.test(t)) return 'datetime';
  if (/^(int|int2|int4|int8|integer|smallint|bigint|tinyint|mediumint|serial|bigserial)\b/.test(t))
    return 'integer';
  if (/^(numeric|decimal|money|smallmoney|number)\b/.test(t)) return 'decimal';
  if (/^(real|float|float4|float8|double|double precision|binary_float|binary_double)\b/.test(t))
    return 'number';
  return 'string';
}

/* ───────────────────────────── request schema ───────────────────────────── */

/** A bound value: scalars, or arrays for list parameters. */
export type ParamValue = string | number | boolean | null | (string | number | boolean)[];

export interface ParamIssue {
  path: string;
  message: string;
}

const INTEGER_RE = /^-?\d{1,15}$/;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const NUMBER_RE = /^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const BOOL_TRUE = new Set(['true', '1', 'yes']);
const BOOL_FALSE = new Set(['false', '0', 'no']);

/** Compiles a parameter's pattern (unicode); invalid patterns are refused when the endpoint is saved. */
export function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'u');
  } catch {
    return null;
  }
}

function scalarSchema(p: ParamDef): z.ZodType<string | number | boolean> {
  const bounded = (s: z.ZodNumber) => {
    let out = s;
    if (p.min !== null) out = out.min(p.min);
    if (p.max !== null) out = out.max(p.max);
    return out;
  };
  let schema: z.ZodType<string | number | boolean>;
  switch (p.type) {
    case 'string': {
      let s = z.string().max(p.maxLength ?? DEFAULT_MAX_STRING);
      if (p.minLength !== null) s = s.min(p.minLength);
      const re = p.pattern ? compilePattern(p.pattern) : null;
      if (re) s = s.regex(re, `Must match ${p.pattern}`);
      schema = s;
      break;
    }
    case 'uuid':
      schema = z.uuid();
      break;
    case 'integer':
      schema = z
        .union([
          z.number(),
          z
            .string()
            .trim()
            .regex(INTEGER_RE, 'Expected an integer')
            .transform((v) => Number(v)),
        ])
        .pipe(bounded(z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)));
      break;
    case 'number':
      schema = z
        .union([
          z.number(),
          z
            .string()
            .trim()
            .regex(NUMBER_RE, 'Expected a number')
            .transform((v) => Number(v)),
        ])
        .pipe(bounded(z.number()));
      break;
    case 'decimal':
      schema = z
        .union([
          z.number().transform((v) => String(v)),
          z.string().trim().regex(DECIMAL_RE, 'Expected a decimal number'),
        ])
        .pipe(
          z.string().refine(
            (v) => {
              const n = Number(v);
              return (p.min === null || n >= p.min) && (p.max === null || n <= p.max);
            },
            `Must be between ${p.min ?? '-∞'} and ${p.max ?? '∞'}`,
          ),
        );
      break;
    case 'boolean':
      schema = z.union([
        z.boolean(),
        z
          .string()
          .trim()
          .toLowerCase()
          .refine((v) => BOOL_TRUE.has(v) || BOOL_FALSE.has(v), 'Expected true or false')
          .transform((v) => BOOL_TRUE.has(v)),
      ]);
      break;
    case 'date':
      schema = z.iso.date();
      break;
    case 'datetime':
      schema = z.iso.datetime({ offset: true, local: true });
      break;
  }
  if (p.enum?.length) {
    const allowed = new Set(p.enum);
    schema = schema.refine((v) => allowed.has(String(v)), `Must be one of: ${p.enum.join(', ')}`);
  }
  return schema;
}

/** The raw value a caller sent, shaped for the parameter: lists split, single values unwrapped. */
function shape(raw: unknown, p: ParamDef): unknown {
  if (raw === undefined || raw === null) return undefined;
  if (p.list) {
    if (Array.isArray(raw))
      return raw.flatMap((v) => (typeof v === 'string' ? v.split(',') : [v])).filter((v) => v !== '');
    if (typeof raw === 'string')
      return raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    return [raw];
  }
  if (Array.isArray(raw) && raw.length === 1) return raw[0];
  if (raw === '') return undefined;
  return raw;
}

/**
 * Builds the request schema of one endpoint version from its parameter definitions: every parameter is
 * typed and constrained, lists accept repeated keys or comma-separated values, missing optional
 * parameters take their default (or `null`), and unknown parameters are refused.
 */
export function buildRequestSchema(params: readonly ParamDef[]) {
  const shapeOf: Record<string, z.ZodType> = {};
  for (const p of params) {
    const scalar = scalarSchema(p);
    const value = p.list
      ? z
          .array(scalar)
          .min(p.required ? 1 : 0)
          .max(MAX_LIST_ITEMS)
      : scalar;
    const fallback = p.default === null ? undefined : shape(p.default, p);
    shapeOf[p.name] = z.preprocess(
      (raw) => {
        const v = shape(raw, p);
        if (v === undefined || (Array.isArray(v) && v.length === 0))
          return fallback ?? (p.required ? v : null);
        return v;
      },
      p.required ? value : value.nullable(),
    );
  }
  return z.strictObject(shapeOf);
}

export type ParseResult =
  { success: true; data: Record<string, ParamValue> } | { success: false; issues: ParamIssue[] };

/** Validates a caller's parameters (query string or JSON body) against a version's definitions. */
export function parseParams(params: readonly ParamDef[], input: Record<string, unknown>): ParseResult {
  const result = buildRequestSchema(params).safeParse(input ?? {});
  if (result.success) return { success: true, data: result.data as Record<string, ParamValue> };
  const issues: ParamIssue[] = [];
  for (const i of result.error.issues) {
    if (i.code === 'unrecognized_keys') {
      for (const key of i.keys) issues.push({ path: key, message: 'Unknown parameter' });
      continue;
    }
    const path = i.path.map(String).join('.');
    const missing = i.code === 'invalid_type' && i.input === undefined;
    issues.push({ path: path || '(root)', message: missing ? 'Required' : i.message });
  }
  return { success: false, issues };
}

/** Parameter values for logs: sensitive ones masked. */
export function maskParams(
  values: Record<string, unknown>,
  params: readonly Pick<ParamDef, 'name' | 'sensitive'>[],
): Record<string, unknown> {
  const sensitive = new Set(params.filter((p) => p.sensitive).map((p) => p.name));
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, sensitive.has(k) && v !== null && v !== undefined ? MASK : v]),
  );
}

/** JSON with object keys sorted (cache keys, definition hashes): equal values serialize identically. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    return v;
  };
  return JSON.stringify(norm(value)) ?? 'null';
}

/** A value for docs and the test console: the example, the default, the first allowed value, or a typed sample. */
export function sampleValue(p: ParamDef): string {
  if (p.example) return p.example;
  if (p.default) return p.default;
  if (p.enum?.length) return p.enum[0]!;
  switch (p.type) {
    case 'integer':
      return String(p.min ?? 1);
    case 'decimal':
      return '10.50';
    case 'number':
      return '1.5';
    case 'boolean':
      return 'true';
    case 'date':
      return '2026-01-31';
    case 'datetime':
      return '2026-01-31T09:00:00Z';
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000';
    default:
      return 'value';
  }
}

/* ───────────────────────────── responses ───────────────────────────── */

const CSV_NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * One CSV cell (RFC 4180): quoted when it holds a quote, comma or line break (or edge whitespace). Text that
 * a spreadsheet would run as a formula (`= + - @`, tab, carriage return) is prefixed with `'`; plain numbers
 * like `-12.50` are left alone.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s) && !CSV_NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** JSON Schema of a result column from the engine's type name (values are normalised for JSON by the kernel). */
export function jsonSchemaFor(dbType: string): Record<string, unknown> {
  const t = dbType.toLowerCase();
  if (/^(int2|int4|integer|int|smallint|tinyint|mediumint|serial)$/.test(t)) return { type: 'integer' };
  if (/^(int8|bigint|bigserial)$/.test(t)) return { type: 'string', format: 'int64' };
  if (/^(numeric|decimal|money|smallmoney|number)/.test(t)) return { type: 'string', format: 'decimal' };
  if (/^(float4|float8|real|float|double|double precision|binary_float|binary_double)/.test(t))
    return { type: 'number' };
  if (/^(bool|boolean|bit)$/.test(t)) return { type: 'boolean' };
  if (t === 'date') return { type: 'string', format: 'date' };
  if (/(timestamp|datetime|smalldatetime|datetimeoffset)/.test(t))
    return { type: 'string', format: 'date-time' };
  if (/^(uuid|uniqueidentifier)$/.test(t)) return { type: 'string', format: 'uuid' };
  if (/^(json|jsonb)$/.test(t)) return {};
  if (/^(bytea|binary|varbinary|blob|longblob|image|raw)/.test(t))
    return { type: 'string', contentEncoding: 'base64' };
  return { type: 'string' };
}

/** A plausible value of a result column for example responses. */
export function sampleCell(dbType: string, name: string): unknown {
  const s = jsonSchemaFor(dbType);
  if (s.type === 'integer') return 42;
  if (s.type === 'number') return 4.2;
  if (s.type === 'boolean') return true;
  if (s.format === 'date') return '2026-01-31';
  if (s.format === 'date-time') return '2026-01-31T09:00:00.000Z';
  if (s.format === 'decimal') return '1250.00';
  if (s.format === 'int64') return '42';
  if (s.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
  return name;
}

export function exampleResponse(
  columns: readonly ColumnInfo[],
  shape: ResponseShape,
  version: number,
): Record<string, unknown> {
  const row = Object.fromEntries(columns.map((c) => [c.name, sampleCell(c.type, c.name)]));
  return {
    data: shape === 'single' ? row : [row],
    meta: { rows: 1, truncated: false, version, durationMs: 12, cached: false },
  };
}

/* ───────────────────────────── version diff ───────────────────────────── */

export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

/** Line diff (longest common subsequence); fine for SQL and parameter lists. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: 'remove', text: a[i++]! });
    else out.push({ kind: 'add', text: b[j++]! });
  }
  while (i < n) out.push({ kind: 'remove', text: a[i++]! });
  while (j < m) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

/** One line per parameter, stable order, for the version diff. */
export function paramLines(params: readonly ParamDef[]): string {
  return params
    .map((p) => {
      const bits = [`${p.name}: ${p.type}${p.list ? '[]' : ''}`, p.required ? 'required' : 'optional'];
      if (p.default !== null) bits.push(`default=${p.default}`);
      if (p.min !== null) bits.push(`min=${p.min}`);
      if (p.max !== null) bits.push(`max=${p.max}`);
      if (p.minLength !== null) bits.push(`minLength=${p.minLength}`);
      if (p.maxLength !== null) bits.push(`maxLength=${p.maxLength}`);
      if (p.pattern) bits.push(`pattern=${p.pattern}`);
      if (p.enum?.length) bits.push(`enum=${p.enum.join('|')}`);
      if (p.sensitive) bits.push('sensitive');
      if (p.target && p.target !== p.name) bits.push(`→ ${p.target}`);
      return bits.join(' ');
    })
    .join('\n');
}

/** The statement a definition runs, as text: its SQL, or the routine it calls. */
export function statementText(def: Pick<EndpointDefinition, 'kind' | 'sql' | 'procedure'>): string {
  if (def.kind === 'query') return def.sql;
  if (!def.procedure) return '';
  const p = def.procedure;
  const args = p.parameters.filter((a) => a.direction !== 'out').map((a) => a.name);
  return `${p.kind === 'function' ? 'SELECT * FROM' : 'CALL'} ${p.schema}.${p.name}(${args.join(', ')})`;
}

/** Settings of a definition that are not SQL or parameters, one per line (for the diff). */
export function settingLines(def: EndpointDefinition): string {
  return [
    `method: ${def.method}`,
    `connection: ${def.connectionId}`,
    `response: ${def.responseShape}`,
    `maxRows: ${def.maxRows}`,
    `timeoutMs: ${def.timeoutMs}`,
    `cacheTtlSeconds: ${def.cacheTtlSeconds}`,
    `allowsWrites: ${def.allowsWrites}`,
  ].join('\n');
}

/* ───────────────────────────── pipelines ───────────────────────────── */

export const TRANSFORM_RE =
  /^(none|trim|upper|lower|cast:(string|integer|decimal|boolean|date|datetime)|default:[\s\S]{0,500}|constant:[\s\S]{0,500})$/;

export interface ParsedTransform {
  kind: TransformKind;
  /** Cast type, or the default/constant value. */
  arg: string | null;
}

export function parseTransform(transform: string): ParsedTransform {
  const idx = transform.indexOf(':');
  const kind = (idx === -1 ? transform : transform.slice(0, idx)) as TransformKind;
  if (!TRANSFORM_KINDS.includes(kind)) return { kind: 'none', arg: null };
  return { kind, arg: idx === -1 ? null : transform.slice(idx + 1) };
}

export function formatTransform(kind: TransformKind, arg?: string | null): string {
  if (kind === 'cast') return `cast:${arg || 'string'}`;
  if (kind === 'default' || kind === 'constant') return `${kind}:${arg ?? ''}`;
  return kind;
}

export interface ColumnMapping {
  source: string;
  target: string;
  transform: string;
}

export type TransformResult = { ok: true; value: unknown } | { ok: false; reason: string };

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function castValue(value: unknown, type: CastType): TransformResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  const fail = (what: string): TransformResult => ({
    ok: false,
    reason: `Cannot cast ${JSON.stringify(value).slice(0, 60)} to ${what}`,
  });
  switch (type) {
    case 'string':
      return { ok: true, value: typeof value === 'object' ? JSON.stringify(value) : String(value) };
    case 'integer': {
      if (typeof value === 'boolean') return { ok: true, value: value ? 1 : 0 };
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (
        String(value).trim() === '' ||
        !Number.isFinite(n) ||
        !Number.isInteger(n) ||
        !Number.isSafeInteger(n)
      )
        return fail('integer');
      return { ok: true, value: n };
    }
    case 'decimal': {
      if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value: String(value) };
      const s = String(value).trim();
      return DECIMAL_RE.test(s) ? { ok: true, value: s } : fail('decimal');
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      if (typeof value === 'number' && (value === 0 || value === 1)) return { ok: true, value: value === 1 };
      const s = String(value).trim().toLowerCase();
      if (BOOL_TRUE.has(s) || s === 'y' || s === 't') return { ok: true, value: true };
      if (BOOL_FALSE.has(s) || s === 'n' || s === 'f') return { ok: true, value: false };
      return fail('boolean');
    }
    case 'date': {
      const s = value instanceof Date ? value.toISOString() : String(value).trim();
      const m = ISO_DATE_PREFIX.exec(s);
      if (m) {
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        if (d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]))
          return { ok: true, value: `${m[1]}-${m[2]}-${m[3]}` };
        return fail('date');
      }
      const t = Date.parse(s);
      return Number.isNaN(t) ? fail('date') : { ok: true, value: new Date(t).toISOString().slice(0, 10) };
    }
    case 'datetime': {
      const t = value instanceof Date ? value.getTime() : Date.parse(String(value).trim());
      return Number.isNaN(t) ? fail('date-time') : { ok: true, value: new Date(t).toISOString() };
    }
  }
}

/** Applies one column transform. There is no user code: only these fixed operations. */
export function applyTransform(value: unknown, transform: string): TransformResult {
  const { kind, arg } = parseTransform(transform);
  switch (kind) {
    case 'none':
      return { ok: true, value: value ?? null };
    case 'trim':
      return { ok: true, value: typeof value === 'string' ? value.trim() : (value ?? null) };
    case 'upper':
      return { ok: true, value: typeof value === 'string' ? value.toUpperCase() : (value ?? null) };
    case 'lower':
      return { ok: true, value: typeof value === 'string' ? value.toLowerCase() : (value ?? null) };
    case 'cast':
      return CAST_TYPES.includes(arg as CastType)
        ? castValue(value, arg as CastType)
        : { ok: false, reason: `Unknown cast ${arg}` };
    case 'default':
      return { ok: true, value: value === null || value === undefined || value === '' ? arg : value };
    case 'constant':
      return { ok: true, value: arg };
  }
}

export type RowResult =
  { ok: true; row: Record<string, unknown> } | { ok: false; column: string; reason: string };

/**
 * Maps one source row onto the target columns. A row is rejected when a transform fails or a key column
 * (upsert) ends up empty.
 */
export function transformRow(
  source: Record<string, unknown>,
  mappings: readonly ColumnMapping[],
  keys: readonly string[] = [],
): RowResult {
  const row: Record<string, unknown> = {};
  for (const m of mappings) {
    const r = applyTransform(source[m.source], m.transform);
    if (!r.ok) return { ok: false, column: m.target, reason: r.reason };
    row[m.target] = r.value;
  }
  for (const k of keys)
    if (row[k] === null || row[k] === undefined || row[k] === '')
      return { ok: false, column: k, reason: `Key column ${k} is empty` };
  return { ok: true, row };
}

/** Problems with a pipeline's target and mapping, checked against the target table's columns. */
export function mappingIssues(
  input: { mode: WriteModeValue; keys: readonly string[]; mappings: readonly ColumnMapping[] },
  tableColumns: readonly string[] | null,
): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (tableColumns === null) {
    issues.push({ path: 'target.table', message: 'The table does not exist in the target catalog' });
    return issues;
  }
  const columns = new Set(tableColumns);
  const seen = new Set<string>();
  input.mappings.forEach((m, i) => {
    if (!columns.has(m.target))
      issues.push({ path: `mappings.${i}.target`, message: `Column ${m.target} is not in the target table` });
    if (seen.has(m.target))
      issues.push({ path: `mappings.${i}.target`, message: `Column ${m.target} is mapped twice` });
    seen.add(m.target);
    if (!TRANSFORM_RE.test(m.transform))
      issues.push({ path: `mappings.${i}.transform`, message: 'Unknown transform' });
  });
  if (!input.mappings.length) issues.push({ path: 'mappings', message: 'Map at least one column' });
  if (input.mode === 'upsert' && !input.keys.length)
    issues.push({ path: 'target.keys', message: 'Upsert needs key columns' });
  input.keys.forEach((k, i) => {
    if (!columns.has(k))
      issues.push({ path: `target.keys.${i}`, message: `Key column ${k} is not in the target table` });
    else if (!seen.has(k))
      issues.push({ path: `target.keys.${i}`, message: `Key column ${k} is not mapped` });
  });
  return issues;
}

/** Orders watermarks: numbers numerically, dates/times chronologically, anything else as text. */
export function compareWatermark(a: unknown, b: unknown): number {
  const sa = String(a);
  const sb = String(b);
  const na = Number(sa);
  const nb = Number(sb);
  if (sa.trim() !== '' && sb.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  const da = Date.parse(sa);
  const db = Date.parse(sb);
  if (!Number.isNaN(da) && !Number.isNaN(db) && da !== db) return da - db;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** The greater of a running watermark and a row's value (nulls ignored). */
export function maxWatermark(current: string | null, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return current;
  const v = value instanceof Date ? value.toISOString() : String(value);
  if (current === null) return v;
  return compareWatermark(v, current) > 0 ? v : current;
}

/* ───────────────────────────── status & stats ───────────────────────────── */

/** An endpoint's overall status from its versions' statuses. */
export function endpointStatusOf(versions: readonly VersionStatus[]): EndpointStatus {
  if (!versions.length) return 'draft';
  if (versions.includes('published')) return 'published';
  if (versions.includes('deprecated')) return 'deprecated';
  return 'retired';
}

/** The version `/data/<slug>` serves: the newest published one, else the newest deprecated one. */
export function latestCallable<T extends { version: number; status: VersionStatus }>(
  versions: readonly T[],
): T | null {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  return (
    sorted.find((v) => v.status === 'published') ?? sorted.find((v) => v.status === 'deprecated') ?? null
  );
}

/** Allowed version transitions. */
export const VERSION_TRANSITIONS: Record<'deprecate' | 'retire' | 'restore', readonly VersionStatus[]> = {
  deprecate: ['published'],
  retire: ['published', 'deprecated'],
  restore: ['deprecated', 'retired'],
};

export function errorRate(calls: number, errors: number): number {
  return calls ? errors / calls : 0;
}

/** HTTP statuses that count as errors in the execution log. */
export const isErrorStatus = (status: number) => status >= 400;

/* ───────────────────────────── OpenAPI ───────────────────────────── */

export interface OpenApiVersion {
  version: number;
  status: VersionStatus;
  definition: EndpointDefinition;
  columns: ColumnInfo[];
}

export interface OpenApiEndpoint {
  slug: string;
  name: string;
  description: string | null;
  /** Non-retired versions, any order. */
  versions: OpenApiVersion[];
}

export const DATA_PATH = '/api/v1/etl/data';

function paramSchema(p: ParamDef): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  switch (p.type) {
    case 'integer':
      s.type = 'integer';
      break;
    case 'number':
      s.type = 'number';
      break;
    case 'boolean':
      s.type = 'boolean';
      break;
    case 'decimal':
      s.type = 'string';
      s.format = 'decimal';
      s.pattern = DECIMAL_RE.source;
      break;
    case 'date':
      s.type = 'string';
      s.format = 'date';
      break;
    case 'datetime':
      s.type = 'string';
      s.format = 'date-time';
      break;
    case 'uuid':
      s.type = 'string';
      s.format = 'uuid';
      break;
    default:
      s.type = 'string';
  }
  const numeric = p.type === 'integer' || p.type === 'number';
  if (p.min !== null && numeric) s.minimum = p.min;
  if (p.max !== null && numeric) s.maximum = p.max;
  if (p.type === 'string') {
    if (p.minLength !== null) s.minLength = p.minLength;
    s.maxLength = p.maxLength ?? DEFAULT_MAX_STRING;
    if (p.pattern) s.pattern = p.pattern;
  }
  const typed = (v: string): unknown =>
    p.type === 'integer' || p.type === 'number'
      ? Number(v)
      : p.type === 'boolean'
        ? BOOL_TRUE.has(v.toLowerCase())
        : v;
  if (p.enum?.length) s.enum = p.enum.map(typed);
  if (p.default !== null && !p.list) s.default = typed(p.default);
  if (p.description) s.description = p.description;
  const item = s;
  if (p.list) {
    const list: Record<string, unknown> = { type: 'array', items: item, maxItems: MAX_LIST_ITEMS };
    if (p.default !== null) list.default = p.default.split(',').map((v) => typed(v.trim()));
    return list;
  }
  return item;
}

function rowSchema(columns: readonly ColumnInfo[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      columns.map((c) => {
        const s = jsonSchemaFor(c.type);
        return [c.name, s.type ? { ...s, type: [s.type, 'null'] } : s];
      }),
    ),
  };
}

function operation(e: OpenApiEndpoint, v: OpenApiVersion, latest: number, pinned: boolean) {
  const def = v.definition;
  const op: Record<string, unknown> = {
    operationId: pinned ? `${e.slug}_v${v.version}` : e.slug,
    summary: pinned ? `${e.name} (v${v.version})` : e.name,
    tags: [e.name],
    ...(e.description ? { description: e.description } : {}),
    ...(v.status === 'deprecated' ? { deprecated: true } : {}),
  };
  if (def.method === 'GET') {
    op.parameters = def.params.map((p) => ({
      name: p.name,
      in: 'query',
      required: p.required && p.default === null,
      ...(p.description ? { description: p.description } : {}),
      schema: paramSchema(p),
      ...(p.list ? { style: 'form', explode: true } : {}),
      example: p.list ? sampleValue(p).split(',') : sampleValue(p),
    }));
  } else {
    op.requestBody = {
      required: def.params.some((p) => p.required && p.default === null),
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: Object.fromEntries(def.params.map((p) => [p.name, paramSchema(p)])),
            required: def.params.filter((p) => p.required && p.default === null).map((p) => p.name),
          },
        },
      },
    };
  }
  const row = rowSchema(v.columns);
  op.responses = {
    200: {
      description: def.responseShape === 'single' ? 'The first row' : 'Rows',
      ...(v.status === 'deprecated'
        ? {
            headers: {
              Deprecation: { schema: { type: 'string' }, description: 'This version is deprecated' },
              Link: { schema: { type: 'string' }, description: `The latest version: v${latest}` },
            },
          }
        : {}),
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              data: def.responseShape === 'single' ? row : { type: 'array', items: row },
              meta: { $ref: '#/components/schemas/Meta' },
            },
          },
          example: exampleResponse(v.columns, def.responseShape, v.version),
        },
        'text/csv': { schema: { type: 'string' } },
      },
    },
    400: { $ref: '#/components/responses/Error' },
    401: { $ref: '#/components/responses/Error' },
    403: { $ref: '#/components/responses/Error' },
    ...(def.responseShape === 'single' ? { 404: { $ref: '#/components/responses/Error' } } : {}),
    410: { $ref: '#/components/responses/Error' },
    422: { $ref: '#/components/responses/Error' },
    429: { $ref: '#/components/responses/Error' },
  };
  return op;
}

/** OpenAPI 3.1 document of the published (non-retired) versions of the given endpoints. */
export function buildOpenApi(
  endpoints: readonly OpenApiEndpoint[],
  info: { title: string; version: string },
) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of [...endpoints].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const versions = e.versions.filter((v) => v.status !== 'retired').sort((a, b) => a.version - b.version);
    if (!versions.length) continue;
    const latest = versions[versions.length - 1]!;
    paths[`${DATA_PATH}/${e.slug}`] = {
      [latest.definition.method.toLowerCase()]: operation(e, latest, latest.version, false),
    };
    for (const v of versions)
      paths[`${DATA_PATH}/${e.slug}/v${v.version}`] = {
        [v.definition.method.toLowerCase()]: operation(e, v, latest.version, true),
      };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description:
        'Data APIs published from parameterized SQL and stored procedures. Authenticate with an API key or an OAuth client-credentials token (`Authorization: Bearer …`). Send `Accept: text/csv` for CSV.',
    },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }, { oauth2: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'An API key of an API client' },
        oauth2: {
          type: 'oauth2',
          flows: { clientCredentials: { tokenUrl: '/api/v1/oauth/token', scopes: { api: 'Platform API' } } },
        },
      },
      schemas: {
        Meta: {
          type: 'object',
          properties: {
            rows: { type: 'integer' },
            truncated: { type: 'boolean' },
            version: { type: 'integer' },
            durationMs: { type: 'integer' },
            cached: { type: 'boolean' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
                requestId: { type: 'string' },
              },
              required: ['code', 'message'],
            },
          },
        },
      },
      responses: {
        Error: {
          description: 'An error (`error.code` is stable)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  };
}

/* ───────────────────────────── links ───────────────────────────── */

export const endpointHref = (slug: string) => `/etl/endpoints/${encodeURIComponent(slug)}`;
export const pipelineHref = (id: string) => `/etl/pipelines/${id}`;
export const runHref = (pipelineId: string, runId: string) => `/etl/pipelines/${pipelineId}/runs/${runId}`;
export const dataUrl = (slug: string, version?: number) =>
  `${DATA_PATH}/${slug}${version === undefined ? '' : `/v${version}`}`;
