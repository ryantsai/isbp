/**
 * Pure scheduling rules shared by the API, the worker and the pages (browser-safe: no cron parser, no
 * database). Schedule arithmetic that needs a cron parser lives in `schedule.ts` (server only).
 */

/* ───────────────────────────── vocabulary ───────────────────────────── */

export const TRIGGER_KINDS = ['cron', 'interval', 'after', 'manual'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const AFTER_MODES = ['all', 'any'] as const;
export type AfterMode = (typeof AFTER_MODES)[number];

export const BACKOFFS = ['fixed', 'exponential'] as const;
export type Backoff = (typeof BACKOFFS)[number];

export const CONCURRENCY_POLICIES = ['skip', 'queue'] as const;
export type ConcurrencyPolicy = (typeof CONCURRENCY_POLICIES)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'retrying',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'skipped',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Statuses a run can still leave. */
export const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'running', 'retrying'];
export const FINAL_STATUSES: readonly RunStatus[] = [
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'skipped',
];
export const isActive = (s: RunStatus) => ACTIVE_STATUSES.includes(s);
export const isFailure = (s: RunStatus) => s === 'failed' || s === 'timed_out';

export const RUN_TRIGGERS = ['schedule', 'manual', 'dependency', 'retry'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** Why a run was skipped: the slot was missed (platform down) or the previous run was still going. */
export const SKIP_REASONS = ['missed', 'overlap'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const SCRIPT_LANGUAGES = ['python', 'node', 'powershell', 'shell'] as const;
export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

/** Built-in values a SQL job can bind to a `:parameter`. */
export const SQL_BUILTINS = ['scheduled_for', 'last_success_at', 'run_id'] as const;
export type SqlBuiltin = (typeof SQL_BUILTINS)[number];

/** Static parameter types (a subset of `@isbp/sql`'s, the ones a person types). */
export const SQL_PARAM_TYPES = [
  'string',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'uuid',
] as const;
export type SqlStaticType = (typeof SQL_PARAM_TYPES)[number];

/** The built-in task types (`<module>.<type>`). */
export const BUILTIN_TYPES = {
  http: 'scheduler.http',
  sql: 'scheduler.sql',
  script: 'scheduler.script',
} as const;
export const isBuiltin = (type: string) => Object.values(BUILTIN_TYPES).includes(type as never);

export const LOG_LIMITS = {
  /** Lines kept per run (all attempts together); the last one is the "truncated" marker. */
  lines: 5_000,
  /** UTF-8 bytes per line. */
  lineBytes: 4_096,
  flushMs: 1_000,
  flushLines: 50,
} as const;

export const LIMITS = {
  timeoutSeconds: { min: 1, max: 24 * 3_600, default: 3_600 },
  attempts: { min: 1, max: 10 },
  retryDelaySeconds: { min: 1, max: 3_600, default: 60 },
  /** Exponential backoff never waits longer than an hour. */
  maxBackoffSeconds: 3_600,
  intervalMinutes: { min: 1, max: 7 * 24 * 60 },
  autoDisable: { min: 0, max: 100 },
  upstreams: 20,
  /** A run whose heartbeat is older than this is "worker lost". */
  heartbeatLostMs: 2 * 60_000,
  heartbeatMs: 10_000,
} as const;

export const jobHref = (id: string) => `/scheduler/jobs/${id}`;
export const runHref = (id: string) => `/scheduler/runs/${id}`;
/** `JOB-00042`. */
export const jobReference = (n: number) => `JOB-${String(n).padStart(5, '0')}`;

/* ───────────────────────────── retries ───────────────────────────── */

/**
 * Seconds to wait before the next attempt after attempt `attempt` (1-based) failed: `fixed` waits the base
 * delay every time, `exponential` doubles it per attempt, capped at an hour.
 */
export function retryDelaySeconds(attempt: number, backoff: Backoff, baseSeconds: number): number {
  const base = Math.max(1, Math.round(baseSeconds));
  const delay = backoff === 'fixed' ? base : base * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, LIMITS.maxBackoffSeconds);
}

/* ───────────────────────────── HTTP expected status ───────────────────────────── */

/**
 * `200-299`, `200,201,204`, `2xx` or a mix (`2xx,304`). Returns the accepted ranges, or null when the
 * text is not a valid specification.
 */
export function parseExpectedStatus(spec: string): [number, number][] | null {
  const parts = spec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const ranges: [number, number][] = [];
  for (const p of parts) {
    let m: RegExpExecArray | null;
    if ((m = /^([1-5])xx$/i.exec(p))) {
      const base = Number(m[1]) * 100;
      ranges.push([base, base + 99]);
    } else if ((m = /^(\d{3})\s*-\s*(\d{3})$/.exec(p))) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < 100 || b > 599 || a > b) return null;
      ranges.push([a, b]);
    } else if (/^\d{3}$/.test(p)) {
      const n = Number(p);
      if (n < 100 || n > 599) return null;
      ranges.push([n, n]);
    } else return null;
  }
  return ranges;
}

export function statusMatches(spec: string, status: number): boolean {
  const ranges = parseExpectedStatus(spec);
  if (!ranges) return status >= 200 && status <= 299;
  return ranges.some(([a, b]) => status >= a && status <= b);
}

/* ───────────────────────────── dependencies ───────────────────────────── */

/**
 * Follows upstream edges (`job → the jobs it runs after`) from `start`; returns the cycle as a path
 * (`[start, …, start]`) when `start` can reach itself, else null.
 */
export function findCycle(upstreams: ReadonlyMap<string, readonly string[]>, start: string): string[] | null {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): string[] | null => {
    path.push(node);
    visiting.add(node);
    for (const next of upstreams.get(node) ?? []) {
      if (next === start) return [...path, start];
      if (done.has(next) || visiting.has(next)) continue;
      const found = visit(next);
      if (found) return found;
    }
    visiting.delete(node);
    done.add(node);
    path.pop();
    return null;
  };
  return visit(start);
}

/**
 * Whether an `after` job should start: `any` when one upstream succeeded since the job was last queued,
 * `all` when every upstream has.
 */
export function afterSatisfied(
  mode: AfterMode,
  upstreamSuccesses: readonly (Date | null)[],
  lastQueuedAt: Date | null,
): boolean {
  const fresh = (d: Date | null) =>
    d !== null && (lastQueuedAt === null || d.getTime() > lastQueuedAt.getTime());
  if (!upstreamSuccesses.length) return false;
  return mode === 'any' ? upstreamSuccesses.some(fresh) : upstreamSuccesses.every(fresh);
}

/* ───────────────────────────── logs ───────────────────────────── */

export interface LogLine {
  seq: number;
  at: Date;
  level: LogLevel;
  attempt: number;
  message: string;
}

export const TRUNCATED_MARKER = `… log truncated: a run keeps at most ${LOG_LIMITS.lines.toLocaleString('en')} lines`;

const encoder = new TextEncoder();

/** Cuts a line to `maxBytes` UTF-8 bytes (on a character boundary), marking the cut with `…`. */
export function truncateLine(line: string, maxBytes: number = LOG_LIMITS.lineBytes): string {
  if (line.length * 3 <= maxBytes || encoder.encode(line).length <= maxBytes) return line;
  let bytes = 0;
  let out = '';
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += ch;
  }
  return `${out}…`;
}

/** Replaces secret values (4+ characters) in a log line. */
export function maskSecrets(line: string, secrets: readonly string[]): string {
  let out = line;
  for (const s of secrets) if (s.length >= 4 && out.includes(s)) out = out.split(s).join('••••••');
  return out;
}

/**
 * Collects a run's log lines between flushes and applies the caps: lines are split on newlines, cut at 4 KB,
 * and a run keeps at most 5,000 lines across attempts (the last is the "truncated" marker).
 */
export class LogBuffer {
  private pending: LogLine[] = [];
  private count: number;
  private cut: boolean;

  constructor(
    alreadyWritten: number,
    private readonly attempt: number,
    private readonly secrets: readonly string[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.count = alreadyWritten;
    this.cut = alreadyWritten >= LOG_LIMITS.lines;
  }

  push(message: string, level: LogLevel = 'info') {
    for (const raw of String(message).replace(/\r\n?/g, '\n').split('\n')) {
      if (this.cut) return;
      const at = this.now();
      if (this.count >= LOG_LIMITS.lines - 1) {
        this.pending.push({
          seq: ++this.count,
          at,
          level: 'warn',
          attempt: this.attempt,
          message: TRUNCATED_MARKER,
        });
        this.cut = true;
        return;
      }
      this.pending.push({
        seq: ++this.count,
        at,
        level,
        attempt: this.attempt,
        message: truncateLine(maskSecrets(raw, this.secrets)),
      });
    }
  }

  /** Lines waiting to be written. */
  get size() {
    return this.pending.length;
  }

  /** Lines accepted so far (including earlier attempts). */
  get total() {
    return this.count;
  }

  get truncated() {
    return this.cut;
  }

  take(): LogLine[] {
    const lines = this.pending;
    this.pending = [];
    return lines;
  }
}

/* ───────────────────────────── cron descriptions ───────────────────────────── */

export type CronDescription =
  | { kind: 'everyMinute' }
  | { kind: 'everyMinutes'; n: number }
  | { kind: 'hourly'; minute: number }
  | { kind: 'everyHours'; n: number; minute: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'monthly'; day: number; time: string }
  | { kind: 'custom' };

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const isNum = (s: string, min: number, max: number) =>
  /^\d{1,2}$/.test(s) && Number(s) >= min && Number(s) <= max;

/** Day-of-week field as day numbers (0 = Sunday), or null when it isn't a plain list/range. */
function parseDays(field: string): number[] | null {
  const day = (s: string) => {
    const lower = s.toLowerCase();
    const named = DAY_NAMES.indexOf(lower);
    if (named >= 0) return named;
    if (/^[0-7]$/.test(s)) return Number(s) % 7;
    return null;
  };
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const range = part.split('-');
    if (range.length === 1) {
      const d = day(part);
      if (d === null) return null;
      out.add(d);
    } else if (range.length === 2) {
      const a = day(range[0]!);
      const b = range[1] === '7' ? 7 : day(range[1]!);
      if (a === null || b === null || a > b) return null;
      for (let d = a; d <= b; d++) out.add(d % 7);
    } else return null;
  }
  return [...out].sort((a, b) => a - b);
}

/** Number of whitespace-separated fields (a job's cron has exactly five). */
export const cronFieldCount = (expr: string) => expr.trim().split(/\s+/).filter(Boolean).length;

/**
 * A structured, translatable description of the common cron shapes ("every 15 minutes", "daily at 07:00",
 * "Sundays at 03:00"); anything else is `custom` and the page shows the next run times instead.
 */
export function describeCron(expr: string): CronDescription {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return { kind: 'custom' };
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
  const time = (h: string, m: string) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  if (mon !== '*') return { kind: 'custom' };
  if (dom === '*' && dow === '*') {
    if (min === '*' && hour === '*') return { kind: 'everyMinute' };
    let m: RegExpExecArray | null;
    if ((m = /^\*\/(\d{1,2})$/.exec(min)) && hour === '*') return { kind: 'everyMinutes', n: Number(m[1]) };
    if (isNum(min, 0, 59) && hour === '*') return { kind: 'hourly', minute: Number(min) };
    if (isNum(min, 0, 59) && (m = /^\*\/(\d{1,2})$/.exec(hour)))
      return { kind: 'everyHours', n: Number(m[1]), minute: Number(min) };
    if (isNum(min, 0, 59) && isNum(hour, 0, 23)) return { kind: 'daily', time: time(hour, min) };
    return { kind: 'custom' };
  }
  if (!isNum(min, 0, 59) || !isNum(hour, 0, 23)) return { kind: 'custom' };
  if (dom === '*') {
    const days = parseDays(dow);
    if (!days) return { kind: 'custom' };
    if (days.join(',') === '1,2,3,4,5') return { kind: 'weekdays', time: time(hour, min) };
    if (days.length === 7) return { kind: 'daily', time: time(hour, min) };
    return { kind: 'weekly', days, time: time(hour, min) };
  }
  if (dow === '*' && isNum(dom, 1, 31)) return { kind: 'monthly', day: Number(dom), time: time(hour, min) };
  return { kind: 'custom' };
}

/* ───────────────────────────── secrets in task configs ───────────────────────────── */

/**
 * A secret in a stored config is `{ sealed }` (sealed with the platform key). The API shows it as
 * `{ secret: true, set }`; sending that placeholder back keeps the stored value. A plain string is a new
 * value, sealed when the job is saved.
 */
export type SealedValue = { sealed: string };
export type SecretPlaceholder = { secret: true; set: boolean };
export type SecretValue = string | SealedValue | SecretPlaceholder;

export const isSealed = (v: unknown): v is SealedValue =>
  typeof v === 'object' && v !== null && typeof (v as SealedValue).sealed === 'string';
export const isPlaceholder = (v: unknown): v is SecretPlaceholder =>
  typeof v === 'object' && v !== null && (v as SecretPlaceholder).secret === true;

/** A value of a config that may hold a secret. `key` matches the same slot across edits. */
export interface SecretSlot {
  key: string;
  /** Config path for validation messages (`headers.1.value`). */
  path: string;
  value: unknown;
  /** The person marked it secret (auth values always are). */
  secret: boolean;
}

type Config = Record<string, unknown>;
type Pair = { name?: unknown; value?: unknown; secret?: unknown };

/**
 * Rebuilds `config` with each secret-capable value mapped by `fn` (built-in types only; module types have
 * no secrets here). Values `fn` returns `undefined` for are kept.
 */
export function mapSecretSlots(type: string, config: Config, fn: (slot: SecretSlot) => unknown): Config {
  const pairs = (field: 'headers' | 'env', prefix: string, caseless: boolean) => {
    const list = config[field];
    if (!Array.isArray(list)) return list;
    return list.map((raw: unknown, i) => {
      if (typeof raw !== 'object' || raw === null) return raw;
      const p = raw as Pair;
      const name = String(p.name ?? '');
      const mapped = fn({
        key: `${prefix}:${caseless ? name.toLowerCase() : name}`,
        path: `${field}.${i}.value`,
        value: p.value,
        secret: p.secret === true,
      });
      return mapped === undefined ? p : { ...p, value: mapped };
    });
  };
  if (type === BUILTIN_TYPES.http) {
    const out: Config = { ...config, headers: pairs('headers', 'header', true) };
    const auth = config.auth as Record<string, unknown> | undefined;
    if (auth && typeof auth === 'object') {
      const field =
        auth.type === 'basic'
          ? 'password'
          : auth.type === 'bearer'
            ? 'token'
            : auth.type === 'header'
              ? 'value'
              : null;
      if (field) {
        const key =
          auth.type === 'header'
            ? `auth:header:${String(auth.name ?? '').toLowerCase()}`
            : `auth:${String(auth.type)}`;
        const mapped = fn({ key, path: `auth.${field}`, value: auth[field], secret: true });
        out.auth = mapped === undefined ? auth : { ...auth, [field]: mapped };
      }
    }
    return out;
  }
  if (type === BUILTIN_TYPES.script) return { ...config, env: pairs('env', 'env', false) };
  return config;
}

/** The API view: secret values become `{ secret: true, set }` and are never returned. */
export function redactConfig(type: string, config: Config): Config {
  return mapSecretSlots(type, config, (s) =>
    s.secret || isSealed(s.value) || isPlaceholder(s.value)
      ? ({
          secret: true,
          set: isSealed(s.value) || (typeof s.value === 'string' && s.value !== ''),
        } as SecretPlaceholder)
      : undefined,
  );
}

/**
 * Resolves an edited config against the stored one: placeholders take the stored sealed value of the same
 * slot. Returns the paths that still need a value (a placeholder with nothing stored, or a value that
 * stopped being secret without being re-entered) and those that tried to pass a sealed value in.
 */
export function mergeSecrets(
  type: string,
  incoming: Config,
  stored: Config | null,
): { config: Config; missing: string[]; forged: string[] } {
  const existing = new Map<string, unknown>();
  if (stored) mapSecretSlots(type, stored, (s) => void existing.set(s.key, s.value));
  const missing: string[] = [];
  const forged: string[] = [];
  const config = mapSecretSlots(type, incoming, (s) => {
    if (isSealed(s.value)) {
      forged.push(s.path);
      return '';
    }
    if (!isPlaceholder(s.value)) return undefined;
    const prior = existing.get(s.key);
    if (s.secret && isSealed(prior)) return prior;
    if (s.secret && typeof prior === 'string' && prior) return prior;
    missing.push(s.path);
    return '';
  });
  return { config, missing, forged };
}

/** Seals plain values in secret slots (a slot that is no longer secret keeps its plain text). */
export function sealConfig(type: string, config: Config, seal: (plain: string) => string): Config {
  return mapSecretSlots(type, config, (s) =>
    s.secret && typeof s.value === 'string' ? ({ sealed: seal(s.value) } satisfies SealedValue) : undefined,
  );
}

/** Opens sealed values for a run; collects them so the run log can mask them. */
export function openConfig(
  type: string,
  config: Config,
  open: (sealed: string) => string,
): { config: Config; secrets: string[] } {
  const secrets: string[] = [];
  const opened = mapSecretSlots(type, config, (s) => {
    if (isSealed(s.value)) {
      const plain = open(s.value.sealed);
      secrets.push(plain);
      return plain;
    }
    if (isPlaceholder(s.value)) return '';
    if (s.secret && typeof s.value === 'string' && s.value) secrets.push(s.value);
    return undefined;
  });
  return { config: opened, secrets };
}

/** Plain text of a value from an opened config. */
export const plain = (v: unknown): string => (typeof v === 'string' ? v : '');

/* ───────────────────────────── editors ───────────────────────────── */

export interface SqlParamInput {
  name: string;
  source: 'static' | SqlBuiltin;
  type: SqlStaticType;
  value: string | null;
}

/**
 * One parameter definition per `:name` in the statement, in order of first use: existing definitions are
 * kept, new names default to the built-in of the same name (`:scheduled_for`) or a static string.
 */
export function syncParams(
  names: readonly string[],
  params: readonly Partial<SqlParamInput>[],
): SqlParamInput[] {
  return names.map((name) => {
    const found = params.find((p) => p.name === name);
    if (found)
      return {
        name,
        source: found.source ?? 'static',
        type: found.type ?? 'string',
        value: found.value ?? null,
      };
    const builtin = SQL_BUILTINS.find((b) => b === name);
    return builtin
      ? { name, source: builtin, type: builtin === 'run_id' ? 'uuid' : 'datetime', value: null }
      : { name, source: 'static', type: 'string', value: null };
  });
}

interface JsonSchemaLike {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchemaLike;
  default?: unknown;
}

const jsonType = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;

/**
 * Light checks of a module task type's config against its JSON Schema for the generic editor (required
 * properties, primitive types, enums). The server validates with the real schema on save.
 */
export function jsonSchemaProblems(
  value: unknown,
  schema: unknown,
): { path: string; problem: 'required' | 'type' | 'enum'; expected?: string }[] {
  const s = (schema ?? {}) as JsonSchemaLike;
  const out: { path: string; problem: 'required' | 'type' | 'enum'; expected?: string }[] = [];
  const check = (v: unknown, sch: JsonSchemaLike, path: string) => {
    if (sch.enum && !sch.enum.some((e) => e === v)) {
      out.push({ path, problem: 'enum', expected: sch.enum.map(String).join(', ') });
      return;
    }
    const types = sch.type ? (Array.isArray(sch.type) ? sch.type : [sch.type]) : [];
    if (types.length) {
      const actual = jsonType(v);
      const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
      if (!ok) {
        out.push({ path, problem: 'type', expected: types.join(' | ') });
        return;
      }
    }
    if (sch.properties && v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      for (const key of sch.required ?? [])
        if (obj[key] === undefined && sch.properties[key]?.default === undefined)
          out.push({ path: path ? `${path}.${key}` : key, problem: 'required' });
      for (const [key, sub] of Object.entries(sch.properties))
        if (obj[key] !== undefined) check(obj[key], sub, path ? `${path}.${key}` : key);
    }
  };
  check(value, s, '');
  return out;
}
