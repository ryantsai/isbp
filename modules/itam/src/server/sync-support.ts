/**
 * Plumbing for this module's sync adapters (Phase 5, `ctx.sync`): the module context a sync write runs in,
 * the authority it writes with, update-order cursors and the error shapes the Integrations Hub expects.
 * Adapters call the module's own services, so validation, history, audit, events, notifications and
 * workflows behave as they do in the UI.
 */
import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  PermissionSet,
  type SyncSource,
  type SyncWriteOptions,
} from '@isbp/sdk/server';
import { type AnyColumn, and, asc, gte, inArray, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';

/** Where a sync write came from, as the record's history keeps it ("via ServiceDesk Plus #1234"). */
export interface SyncVia {
  connectionId: string;
  /** The connection's name, e.g. "Contoso ServiceDesk Plus". */
  connection: string;
  /** `<module>.<type>` of the connector. */
  connector: string;
  /** The remote record's reference, e.g. "#1234". */
  ref: string;
  url: string | null;
}

const VIA = Symbol('itam.sync.via');

/** The source of the sync write `ctx` runs (null outside sync writes). */
export function viaOf(ctx: ModuleContext): SyncVia | null {
  return (ctx as { [VIA]?: SyncVia })[VIA] ?? null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function toVia(s: SyncSource): SyncVia {
  return {
    connectionId: s.connectionId,
    connection: clip(s.connectionName, 200),
    connector: s.connector,
    ref: clip(s.remoteRef, 100),
    url: s.remoteUrl && /^https?:\/\//i.test(s.remoteUrl) ? s.remoteUrl.slice(0, 1000) : null,
  };
}

/**
 * Runs one sync write: in a savepoint of the hub's transaction (a refused write leaves nothing behind and
 * the hub's transaction stays usable), with a module context whose reads and writes all go through that
 * transaction and whose audit rows name the hub's agent and carry `metadata.source`.
 */
export function inSyncWrite<T>(
  ctx: ModuleContext,
  opts: SyncWriteOptions,
  fn: (bound: ModuleContext) => Promise<T>,
): Promise<T> {
  return opts.tx.transaction(async (sp) => {
    const tx = sp as unknown as Db;
    const bound: ModuleContext & { [VIA]: SyncVia } = {
      ...ctx,
      db: tx,
      transaction: <R>(run: (t: Db) => Promise<R>) => run(tx),
      audit: {
        record: (entry, o = {}) =>
          ctx.audit.record(
            { ...entry, metadata: { ...entry.metadata, source: opts.source } },
            { tx: o.tx ?? tx, principal: o.principal ?? opts.auth.principal },
          ),
        diff: ctx.audit.diff.bind(ctx.audit),
      },
      [VIA]: toVia(opts.source),
    };
    return fn(bound);
  });
}

/**
 * The authority a sync write runs with: the hub's agent (its name lands in the history) holding the module
 * permissions the entity's `.sync` permission stands for. The kernel checked `.sync` before the adapter ran.
 */
export function writerAuth(auth: AuthContext, permissions: readonly string[]): AuthContext {
  const set = new PermissionSet(permissions.map((p) => ({ p, s: 'g' as const })));
  return {
    ...auth,
    permissions: set,
    can: (p, r) => set.can(p, r),
    require(p, r) {
      if (!set.can(p, r)) throw httpErrors.forbidden();
    },
    reach: (p) => set.reach(p),
  };
}

/* ───────────────────────────── errors ───────────────────────────── */

export interface Issue {
  path: string;
  message: string;
}

export const invalidValues = (issues: Issue[], message = 'Invalid values') =>
  new HttpError(422, ErrorCodes.VALIDATION_FAILED, message, { issues });

/** A status the module only reaches through an approval: a sync can't open a path round it. */
export const approvalRequired = (from: string, to: string, message: string) =>
  new HttpError(409, ErrorCodes.INVALID_TRANSITION, message, { from, to, reason: 'approval_required' });

export const noTransition = (from: string, to: string, allowed: readonly string[], what = 'The record') =>
  new HttpError(409, ErrorCodes.INVALID_TRANSITION, `${what} can't move from ${from} to ${to}`, {
    from,
    to,
    allowed,
  });

/** The sync key of a module field path (`change.plannedEnd` → `plannedEnd`). */
function keyOf(keys: Record<string, string>, path: string[]): string {
  const dotted = path.join('.');
  const last = path[path.length - 1] ?? '';
  return keys[dotted] ?? keys[last] ?? keys[path[0] ?? ''] ?? (last || dotted);
}

/**
 * The module refuses bad input with 400 and the REST API's field names; a sync write reports it as 422
 * with the sync field keys (`keys`: module field → sync key).
 */
export async function syncErrors<T>(keys: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof HttpError) || err.statusCode !== 400) throw err;
    const d = (err.details ?? {}) as { issues?: { path?: unknown; message?: unknown }[]; fields?: unknown };
    const key = (p: unknown) => keyOf(keys, Array.isArray(p) ? p.map(String) : String(p ?? '').split('.'));
    const issues: Issue[] = [
      ...(d.issues ?? []).map((i) => ({ path: key(i.path), message: String(i.message ?? err.message) })),
      ...Object.entries((d.fields ?? {}) as Record<string, unknown>).map(([f, m]) => ({
        path: key(f),
        message: String(m),
      })),
    ];
    throw new HttpError(
      422,
      err.code === ErrorCodes.BAD_REQUEST ? ErrorCodes.VALIDATION_FAILED : err.code,
      err.message,
      { ...d, issues: issues.length ? issues : [{ path: '', message: err.message }] },
    );
  }
}

/** Parses with the module's own input schema; issues come back with the sync field keys. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  keys: Record<string, string>,
): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw invalidValues(
    r.error.issues.map((i) => ({ path: keyOf(keys, i.path.map(String)), message: i.message })),
  );
}

/** People named in user fields must exist and be active. */
export async function assertActiveUsers(db: Db, entries: [key: string, id: unknown][]) {
  const named = entries.filter((e): e is [string, string] => typeof e[1] === 'string');
  if (!named.length) return;
  const rows = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(
      inArray(
        users.id,
        named.map(([, id]) => id),
      ),
    );
  const active = new Set(rows.filter((r) => r.status === 'active').map((r) => r.id));
  const issues = named
    .filter(([, id]) => !active.has(id))
    .map(([path]) => ({ path, message: 'unknown or inactive person' }));
  if (issues.length) throw invalidValues(issues);
}

/** Shortest path through a state machine (without `from`), or null when `to` is out of reach. */
export function statusPath<S extends string>(next: (s: S) => readonly S[], from: S, to: S): S[] | null {
  if (from === to) return [];
  const prev = new Map<S, S>([[from, from]]);
  const queue: S[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of next(cur)) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const path: S[] = [n];
        for (let p = cur; p !== from; p = prev.get(p)!) path.unshift(p);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/* ───────────────────────────── update-order paging ───────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** `updated_at` as text to the microsecond (a JS Date would round it and repeat rows across pages). */
export const cursorAt = (column: AnyColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function decodeCursor(value: string): { at: string; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown[];
    if (typeof at === 'string' && !Number.isNaN(Date.parse(at)) && isUuid(id)) return { at, id };
  } catch {
    // fall through
  }
  throw invalidValues([{ path: 'after', message: 'invalid cursor' }], 'Invalid cursor');
}

/** Rows changed since `since` and after the cursor, in update order (`updated_at`, then id). */
export function pageWhere(
  updatedAt: AnyColumn,
  id: AnyColumn,
  opts: { since?: string | null; after?: string | null },
): SQL | undefined {
  if (opts.since && Number.isNaN(Date.parse(opts.since)))
    throw invalidValues([{ path: 'since', message: 'expected an ISO date-time' }]);
  const c = opts.after ? decodeCursor(opts.after) : null;
  return and(
    opts.since ? gte(updatedAt, new Date(opts.since)) : undefined,
    c ? sql`(${updatedAt}, ${id}) > (${c.at}::timestamptz, ${c.id}::uuid)` : undefined,
  );
}

export const pageOrder = (updatedAt: AnyColumn, id: AnyColumn) => [asc(updatedAt), asc(id)];

export const pageLimit = (limit: number) => Math.min(Math.max(Math.trunc(limit) || 1, 1), 500);

/** Splits `limit + 1` fetched rows into the page and the next cursor. */
export function pageOf<R extends { id: string; cursorAt: string }>(
  rows: R[],
  limit: number,
): { rows: R[]; next: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    next:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify([last.cursorAt, last.id])).toString('base64url')
        : null,
  };
}

/** The same text for every locale (people's and groups' names). */
export const literal = (text: string) => ({ en: text, 'zh-TW': text, 'ja-JP': text });

/** Case-insensitive exact match for `ilike` (escapes `%`, `_` and `\`). */
export const exactLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
