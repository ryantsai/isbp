/**
 * Integrations Hub domain rules that both the server and the browser use: enums, field-type compatibility,
 * push filters, the capped run log and paths. Pure: no I/O, no Node APIs.
 */

/* ───────────────────────────── enums ───────────────────────────── */

/** Field types of sync adapters and connectors (mirrors `SyncFieldType` in `@isbp/sdk/server`). */
export const FIELD_TYPES = [
  'string',
  'text',
  'markdown',
  'html',
  'number',
  'boolean',
  'date',
  'datetime',
  'choice',
  'tags',
  'user',
  'parent',
  'json',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Which way a profile syncs: remote → ISBP, ISBP → remote, or both. */
export const DIRECTIONS = ['pull', 'push', 'both'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Per mapping row (narrowed by the profile's direction). */
export const MAPPING_DIRECTIONS = ['both', 'pull', 'push'] as const;
export type MappingDirection = (typeof MAPPING_DIRECTIONS)[number];

/** What happens when both sides changed the same field to different values. */
export const CONFLICT_POLICIES = ['manual', 'remote', 'local', 'newest'] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

export const HEALTHS = ['unknown', 'ok', 'failing'] as const;
export type Health = (typeof HEALTHS)[number];

export const LINK_STATES = ['ok', 'conflict', 'error', 'orphaned'] as const;
export type LinkState = (typeof LINK_STATES)[number];

/** How a link came about: created in ISBP from a remote record, created remotely, or matched. */
export const LINK_ORIGINS = ['remote', 'local', 'matched'] as const;
export type LinkOrigin = (typeof LINK_ORIGINS)[number];

export const RUN_STATUSES = ['queued', 'running', 'waiting', 'succeeded', 'partial', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'waiting'];
export const FINAL_RUN_STATUSES: readonly RunStatus[] = ['succeeded', 'partial', 'failed'];

export const RUN_TRIGGERS = ['schedule', 'manual', 'webhook', 'event'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/**
 * `pull`: the change feed from the stored cursor. `push`: local changes (from events). `webhook`: records a
 * webhook named. `resync`: chosen links ("Sync now"). `export`: create unlinked local records remotely.
 */
export const RUN_KINDS = ['pull', 'push', 'webhook', 'resync', 'export'] as const;
export type RunKind = (typeof RUN_KINDS)[number];
/** Kinds that hold the profile (one at a time). */
export const EXCLUSIVE_RUN_KINDS: readonly RunKind[] = ['pull', 'export'];

export const CONFLICT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const COUNT_KEYS = [
  'read',
  'created',
  'updated',
  'pushed',
  'remoteCreated',
  'linked',
  'conflicts',
  'skipped',
  'errors',
] as const;
export type CountKey = (typeof COUNT_KEYS)[number];
export type RunCounts = Record<CountKey, number>;

export const emptyCounts = (): RunCounts => Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as RunCounts;

export const FILTER_OPS = ['eq', 'neq', 'in', 'contains', 'empty', 'not_empty'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const LIMITS = {
  /** Entries kept in a run's log (the first `logHead`, then the latest). */
  logEntries: 300,
  logHead: 100,
  /** Remote changes per page and per run. */
  pageSize: 50,
  maxPagesPerRun: 200,
  /** Items a dry run looks at. */
  previewItems: 10,
  mappings: 80,
  valueMap: 300,
  filters: 10,
  /** Webhook items accepted per call. */
  webhookItems: 200,
  /** Webhook calls per connection per minute. */
  webhookPerMinute: 120,
  /** Consecutive item errors before a run gives up. */
  consecutiveErrors: 25,
  intervalMinutes: 1_440,
} as const;

/* ───────────────────────────── field types ───────────────────────────── */

const TEXTUAL: readonly FieldType[] = ['string', 'text', 'markdown', 'html'];

/** Remote field types a local field of `local` type can be mapped to (the hub converts between them). */
export function compatibleTypes(local: FieldType): FieldType[] {
  switch (local) {
    case 'string':
    case 'text':
    case 'markdown':
    case 'html':
      return [...TEXTUAL, 'choice', 'number', 'date', 'datetime', 'user', 'tags', 'json'];
    case 'choice':
      return ['choice', 'string', 'text'];
    case 'tags':
      return ['tags', 'string', 'text'];
    case 'date':
    case 'datetime':
      return ['date', 'datetime', 'string'];
    case 'number':
      return ['number', 'string'];
    case 'boolean':
      return ['boolean', 'string'];
    case 'user':
      return ['user', 'string'];
    case 'parent':
      return ['parent'];
    case 'json':
      return ['json', 'string', 'text'];
  }
}

export function isCompatible(local: FieldType, remote: FieldType): boolean {
  return compatibleTypes(local).includes(remote);
}

export const isTextual = (t: FieldType) => TEXTUAL.includes(t);

/** Value map rows that apply when values come into ISBP (`pull`) or go out (`push`). */
export function rowsFor<T extends { direction?: MappingDirection }>(
  rows: readonly T[] | undefined,
  way: 'pull' | 'push',
): T[] {
  return (rows ?? []).filter((r) => (r.direction ?? 'both') === 'both' || r.direction === way);
}

/** Empty: null, undefined, blank strings and empty lists. */
export function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/* ───────────────────────────── push filter ───────────────────────────── */

export interface FilterCondition {
  field: string;
  op: FilterOp;
  value?: string | string[] | null;
}

const lower = (v: unknown) =>
  typeof v === 'string' ? v.trim().toLowerCase() : String(v ?? '').toLowerCase();

/** Whether a local record's values pass every condition (no conditions: everything passes). */
export function matchesFilter(
  conditions: readonly FilterCondition[],
  values: Record<string, unknown>,
): boolean {
  return conditions.every((c) => {
    const v = values[c.field];
    const wanted = Array.isArray(c.value) ? c.value.map(lower) : [lower(c.value)];
    const actual = Array.isArray(v) ? v.map(lower) : [lower(v)];
    switch (c.op) {
      case 'empty':
        return isEmpty(v);
      case 'not_empty':
        return !isEmpty(v);
      case 'eq':
        return !isEmpty(v) && actual.length === 1 && actual[0] === wanted[0];
      case 'neq':
        return isEmpty(v) || !(actual.length === 1 && actual[0] === wanted[0]);
      case 'in':
        return actual.some((a) => wanted.includes(a));
      case 'contains':
        return Array.isArray(v)
          ? actual.some((a) => wanted.includes(a))
          : wanted.some((w) => w !== '' && (actual[0] ?? '').includes(w));
    }
  });
}

/* ───────────────────────────── run log ───────────────────────────── */

export interface LogRef {
  /** Remote reference ("#1234"). */
  remote?: string;
  /** Local reference or title. */
  local?: string;
  linkId?: string;
}

export interface LogEntry {
  at: string;
  level: LogLevel;
  message: string;
  ref?: LogRef;
}

/**
 * Appends to a capped log: the first `LIMITS.logHead` entries stay, then the latest ones; what falls out
 * in between is counted in `dropped`.
 */
export function appendCapped(
  log: LogEntry[],
  entry: LogEntry,
  dropped: number,
  max: number = LIMITS.logEntries,
  head: number = LIMITS.logHead,
): { log: LogEntry[]; dropped: number } {
  const next = [...log, entry];
  if (next.length <= max) return { log: next, dropped };
  next.splice(head, 1);
  return { log: next, dropped: dropped + 1 };
}

/* ───────────────────────────── labels and paths ───────────────────────────── */

/** A catalogue label: an i18n key of the owning module, or text per locale. */
export type Label = string | Record<string, string>;

export const connectionHref = (id: string) => `/integrations/connections/${id}`;
export const profileHref = (connectionId: string, profileId: string) =>
  `/integrations/connections/${connectionId}/profiles/${profileId}`;
export const newProfileHref = (connectionId: string) =>
  `/integrations/connections/${connectionId}/profiles/new`;
export const runHref = (id: string) => `/integrations/runs/${id}`;
export const conflictsHref = (connectionId?: string) =>
  connectionId ? `/integrations/connections/${connectionId}?tab=conflicts` : '/integrations/conflicts';
/** The public webhook endpoint of a connection (relative to the site). */
export const webhookPath = (connectionId: string) => `/api/v1/integrations/hooks/${connectionId}`;

/** Only http(s) URLs leave the hub as links (remote systems are not trusted). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export const isActiveRun = (s: RunStatus) => ACTIVE_RUN_STATUSES.includes(s);
