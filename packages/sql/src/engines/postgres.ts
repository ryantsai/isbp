import pg from 'pg';
import Cursor from 'pg-cursor';
import { dialectFor } from '../dialect';
import { type BoundStatement, bindStatement } from '../params';
import type { CatalogProcedure, ConnectionConfig, SqlColumn, SqlValue, StreamBatch } from '../types';
import {
  abortable,
  buildCatalog,
  CATALOG_LIMIT,
  type CatalogColumnRow,
  type CatalogKeyRow,
  type CatalogRoutineRow,
  type EngineDriver,
  normalizeRow,
  type RawResult,
  type RunOptions,
  type Session,
  type TxMode,
} from './driver';

const TYPE_NAMES = new Map<number, string>(
  Object.entries(pg.types.builtins).map(([name, oid]) => [oid as number, name.toLowerCase()]),
);
/** Dates and times stay strings (no time-zone shifting); numerics and int8 are strings already. */
const RAW = new Set([1082, 1083, 1114, 1266]);
const typeParser = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') =>
    RAW.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format),
} as unknown as typeof pg.types;

type Field = { name: string; dataTypeID: number };
const columnsOf = (fields: readonly Field[] | undefined): SqlColumn[] =>
  (fields ?? []).map((f) => ({ name: f.name, type: TYPE_NAMES.get(f.dataTypeID) ?? `oid:${f.dataTypeID}` }));

function readCursor(
  cursor: Cursor,
  n: number,
): Promise<{ rows: Record<string, unknown>[]; result: pg.QueryResult }> {
  return new Promise((resolve, reject) => {
    cursor.read(n, (err, rows, result) => (err ? reject(err) : resolve({ rows, result })));
  });
}

export function postgresDriver(config: ConnectionConfig): EngineDriver {
  const tls = config.options?.tls ?? 'off';
  const pool = new pg.Pool({
    host: config.host,
    port: config.port ?? 5432,
    database: config.database ?? undefined,
    user: config.user,
    password: config.password ?? undefined,
    max: config.poolMax ?? 5,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: config.connectTimeoutMs ?? 10_000,
    application_name: config.applicationName ?? 'isbp',
    ssl:
      tls === 'off'
        ? false
        : { rejectUnauthorized: tls === 'verify', ...(config.options?.ca ? { ca: config.options.ca } : {}) },
    types: typeParser,
  });
  pool.on('error', () => undefined); // idle client errors surface on the next checkout

  const cancel = (pid: number | undefined) => {
    if (pid) void pool.query('SELECT pg_cancel_backend($1)', [pid]).catch(() => undefined);
  };

  async function open(tx: TxMode): Promise<Session> {
    const client = await pool.connect();
    const pid = (client as unknown as { processID?: number }).processID;
    let broken = false;
    try {
      if (tx === 'read') await client.query('BEGIN READ ONLY');
      if (tx === 'write') await client.query('BEGIN');
    } catch (err) {
      client.release(true);
      throw err;
    }

    const timed = async <T>(
      timeoutMs: number,
      signal: AbortSignal | undefined,
      fn: () => Promise<T>,
    ): Promise<T> => {
      await client.query(
        `SET ${tx === 'none' ? '' : 'LOCAL '}statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`,
      );
      try {
        return await abortable(fn(), { timeoutMs: timeoutMs + 2_000, signal, onAbort: () => cancel(pid) });
      } catch (err) {
        broken = broken || (err as { code?: string }).code === 'ECANCEL';
        throw err;
      } finally {
        if (tx === 'none') await client.query('RESET statement_timeout').catch(() => (broken = true));
      }
    };

    const run = async (stmt: BoundStatement, opts: RunOptions): Promise<RawResult> => {
      if (stmt.engine !== 'postgres') throw new Error('statement bound for another engine');
      return timed(opts.timeoutMs, opts.signal, async () => {
        const cursor = client.query(new Cursor(stmt.text, stmt.values as unknown[]));
        try {
          const { rows, result } = await readCursor(cursor, opts.maxRows + 1);
          const columns = columnsOf(result.fields as Field[]);
          const isRead = !result.command || result.command === 'SELECT' || columns.length > 0;
          return {
            columns,
            rows: rows.slice(0, opts.maxRows).map((r) => normalizeRow(r, columns)),
            truncated: rows.length > opts.maxRows,
            affected: isRead ? null : (result.rowCount ?? null),
          };
        } finally {
          await new Promise<void>((resolve) => cursor.close(() => resolve()));
        }
      });
    };

    return {
      run,
      async *stream(stmt, opts): AsyncGenerator<StreamBatch> {
        if (stmt.engine !== 'postgres') throw new Error('statement bound for another engine');
        await client.query(
          `SET ${tx === 'none' ? '' : 'LOCAL '}statement_timeout = ${Math.max(1, opts.timeoutMs)}`,
        );
        const cursor = client.query(new Cursor(stmt.text, stmt.values as unknown[]));
        try {
          for (;;) {
            const { rows, result } = await abortable(readCursor(cursor, opts.batchSize), {
              timeoutMs: opts.timeoutMs + 2_000,
              signal: opts.signal,
              onAbort: () => cancel(pid),
            });
            const columns = columnsOf(result.fields as Field[]);
            if (rows.length) yield { columns, rows: rows.map((r) => normalizeRow(r, columns)) };
            if (rows.length < opts.batchSize) break;
          }
        } finally {
          await new Promise<void>((resolve) => cursor.close(() => resolve()));
          if (tx === 'none') await client.query('RESET statement_timeout').catch(() => (broken = true));
        }
      },
      async call(proc, args, opts) {
        return run(postgresCall(proc, args), opts);
      },
      async close(commit) {
        try {
          if (tx !== 'none') await client.query(commit && !broken ? 'COMMIT' : 'ROLLBACK');
        } catch (err) {
          broken = true;
          if (commit) throw err;
        } finally {
          client.release(broken);
        }
      },
    };
  }

  return {
    open,
    async catalog({ timeoutMs }) {
      const session = await open('read');
      const opts = { maxRows: CATALOG_LIMIT, timeoutMs };
      const q = (sql: string) => session.run(bindStatement('postgres', sql), opts).then((r) => r.rows);
      try {
        const [schemaRow] = await q('SELECT current_schema() AS s');
        const columns = await q(`
          SELECT c.table_schema AS schema, c.table_name AS "table",
                 CASE WHEN t.table_type = 'VIEW' THEN 'view' ELSE 'table' END AS kind,
                 c.column_name AS "column",
                 CASE WHEN c.data_type IN ('USER-DEFINED', 'ARRAY') THEN c.udt_name ELSE c.data_type END AS type,
                 c.is_nullable = 'YES' AS nullable
            FROM information_schema.columns c
            JOIN information_schema.tables t USING (table_schema, table_name)
           WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE 'pg\\_%'
           ORDER BY 1, 2, c.ordinal_position
           LIMIT ${CATALOG_LIMIT}`);
        const keys = await q(`
          SELECT n.nspname AS schema, t.relname AS "table", a.attname AS "column"
            FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
           WHERE (i.indisprimary OR i.indisunique) AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
        const routines = await q(`
          SELECT r.routine_schema AS schema, r.routine_name AS name, lower(r.routine_type) AS kind,
                 lower(r.data_type) AS returns,
                 p.parameter_name AS param, p.data_type AS type,
                 CASE p.parameter_mode WHEN 'OUT' THEN 'out' WHEN 'INOUT' THEN 'inout' ELSE 'in' END AS mode
            FROM information_schema.routines r
            LEFT JOIN information_schema.parameters p
              ON p.specific_schema = r.specific_schema AND p.specific_name = r.specific_name
           WHERE r.routine_schema NOT IN ('pg_catalog', 'information_schema')
             AND r.routine_type IN ('FUNCTION', 'PROCEDURE')
             AND r.data_type IS DISTINCT FROM 'trigger'
           ORDER BY 1, 2, r.specific_name, p.ordinal_position
           LIMIT ${CATALOG_LIMIT}`);
        return buildCatalog(
          String(schemaRow?.s ?? 'public'),
          columns as unknown as CatalogColumnRow[],
          keys as unknown as CatalogKeyRow[],
          routines as unknown as CatalogRoutineRow[],
        );
      } finally {
        await session.close(true);
      }
    },
    async version() {
      const r = await pool.query(dialectFor('postgres').versionQuery);
      return String((r.rows[0] as { version?: string } | undefined)?.version ?? '');
    },
    async close() {
      await pool.end();
    },
  };
}

/** `SELECT * FROM fn(a => :a)` or `CALL proc(a => :a)`; arguments bound by name, OUT parameters omitted. */
export function postgresCall(
  proc: CatalogProcedure,
  args: Record<string, SqlValue | undefined>,
): BoundStatement {
  const d = dialectFor('postgres');
  const name = d.qualified(proc.schema, proc.name);
  const inputs = proc.parameters.filter((p) => p.direction !== 'out' && p.name);
  const values: Record<string, SqlValue> = {};
  const list = inputs.map((p, i) => {
    values[`a${i}`] = args[p.name] ?? null;
    return `${d.quote(p.name)} => :a${i}`;
  });
  const outs = proc.kind === 'procedure' ? proc.parameters.filter((p) => p.direction !== 'in') : [];
  // CALL needs a placeholder (NULL) for OUT arguments.
  const callArgs =
    proc.kind === 'procedure'
      ? [...list, ...outs.filter((p) => p.direction === 'out').map((p) => `${d.quote(p.name)} => NULL`)]
      : list;
  const sql =
    proc.kind === 'function'
      ? `SELECT * FROM ${name}(${callArgs.join(', ')})`
      : `CALL ${name}(${callArgs.join(', ')})`;
  return bindStatement('postgres', sql, values);
}
