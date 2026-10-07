import type { BoundStatement } from '../params';
import type {
  Catalog,
  CatalogProcedure,
  ConnectionConfig,
  SqlColumn,
  SqlRow,
  SqlValue,
  StreamBatch,
} from '../types';

export interface RunOptions {
  maxRows: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RawResult {
  columns: SqlColumn[];
  rows: SqlRow[];
  truncated: boolean;
  affected: number | null;
  outputs?: Record<string, unknown>;
}

export type TxMode = 'none' | 'read' | 'write';

/** One checked-out connection (or, for SQL Server outside a transaction, the pool). */
export interface Session {
  run(stmt: BoundStatement, opts: RunOptions): Promise<RawResult>;
  stream(
    stmt: BoundStatement,
    opts: Omit<RunOptions, 'maxRows'> & { batchSize: number },
  ): AsyncGenerator<StreamBatch>;
  /** Oracle only: one statement bound once per row (`executeMany`). */
  runMany?(text: string, rows: Record<string, unknown>[], opts: Omit<RunOptions, 'maxRows'>): Promise<number>;
  call(
    proc: CatalogProcedure,
    args: Record<string, SqlValue | undefined>,
    opts: RunOptions,
  ): Promise<RawResult>;
  /** Commits (or rolls back) an open transaction and releases the connection. */
  close(commit: boolean): Promise<void>;
}

export interface EngineDriver {
  open(tx: TxMode): Promise<Session>;
  catalog(opts: { timeoutMs: number }): Promise<Catalog>;
  version(): Promise<string>;
  close(): Promise<void>;
}

export type DriverFactory = (config: ConnectionConfig) => EngineDriver;

/** JSON-safe values: ISO dates, base64 binary, bigint as string. */
export function normalizeValue(value: unknown, type?: string): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return type === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return value;
}

export function normalizeRow(row: Record<string, unknown>, columns: readonly SqlColumn[]): SqlRow {
  const out: SqlRow = {};
  for (const c of columns) out[c.name] = normalizeValue(row[c.name], c.type);
  return out;
}

/** Rejects when `signal` aborts; `onAbort` cancels the statement on the server. */
export function abortable<T>(
  promise: Promise<T>,
  opts: { timeoutMs: number; signal?: AbortSignal; onAbort: () => void },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onSignal);
      fn();
    };
    const fail = (kind: 'timeout' | 'cancelled') => {
      try {
        opts.onAbort();
      } catch {
        /* best effort */
      }
      finish(() =>
        reject(
          Object.assign(
            new Error(
              kind === 'timeout' ? `Statement timed out after ${opts.timeoutMs} ms` : 'Statement cancelled',
            ),
            {
              code: kind === 'timeout' ? 'ETIMEOUT' : 'ECANCEL',
            },
          ),
        ),
      );
    };
    const onSignal = () => fail('cancelled');
    const timer = setTimeout(() => fail('timeout'), opts.timeoutMs);
    if (opts.signal?.aborted) return fail('cancelled');
    opts.signal?.addEventListener('abort', onSignal, { once: true });
    promise.then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    );
  });
}

export const groupBy = <T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> => {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
};

export const CATALOG_LIMIT = 20_000;

export interface CatalogColumnRow {
  schema: string;
  table: string;
  kind: 'table' | 'view';
  column: string;
  type: string;
  nullable: boolean;
}

export interface CatalogKeyRow {
  schema: string;
  table: string;
  column: string;
}

export interface CatalogRoutineRow {
  schema: string;
  name: string;
  kind: 'procedure' | 'function';
  returns?: string | null;
  /** `null` for a routine without parameters (or a function's return value). */
  param: string | null;
  type: string | null;
  mode: 'in' | 'out' | 'inout';
}

/** Assembles introspection rows (already ordered by position) into a `Catalog`. */
export function buildCatalog(
  defaultSchema: string,
  columns: readonly CatalogColumnRow[],
  keys: readonly CatalogKeyRow[],
  routines: readonly CatalogRoutineRow[],
): Catalog {
  const keySet = new Set(keys.map((k) => `${k.schema}\u0000${k.table}\u0000${k.column}`));
  const tables = [...groupBy(columns, (c) => `${c.schema}\u0000${c.table}`).values()].map((cols) => ({
    schema: cols[0]!.schema,
    name: cols[0]!.table,
    kind: cols[0]!.kind,
    columns: cols.map((c) => ({
      name: c.column,
      type: c.type.toLowerCase(),
      nullable: c.nullable,
      key: keySet.has(`${c.schema}\u0000${c.table}\u0000${c.column}`),
    })),
  }));
  const procedures = [...groupBy(routines, (r) => `${r.schema}\u0000${r.name}`).values()].map((rows) => ({
    schema: rows[0]!.schema,
    name: rows[0]!.name,
    kind: rows[0]!.kind,
    returns: rows[0]!.kind === 'function' ? (rows[0]!.returns?.toLowerCase() ?? null) : null,
    parameters: rows
      .filter((r) => r.param)
      .map((r) => ({
        name: r.param!.replace(/^@/, ''),
        type: (r.type ?? 'unknown').toLowerCase(),
        direction: r.mode,
      })),
  }));
  const schemas = [...new Set([...tables.map((t) => t.schema), ...procedures.map((p) => p.schema)])].sort();
  return {
    defaultSchema,
    schemas,
    tables,
    procedures,
    truncated: columns.length >= CATALOG_LIMIT || routines.length >= CATALOG_LIMIT,
  };
}
