import mysql from 'mysql2';
import { dialectFor } from '../dialect';
import { type BoundStatement, bindStatement } from '../params';
import type { ConnectionConfig, SqlColumn, SqlScalar, StreamBatch } from '../types';
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
  Object.entries(mysql.Types as unknown as Record<string, number>)
    .filter(([name, code]) => typeof code === 'number' && Number.isNaN(Number(name)))
    .map(([name, code]) => [code, name.toLowerCase()]),
);

type Field = { name: string; columnType?: number; type?: number };
const columnsOf = (fields: readonly Field[] | undefined): SqlColumn[] =>
  (fields ?? []).map((f) => {
    const code = f.columnType ?? f.type ?? -1;
    return { name: f.name, type: TYPE_NAMES.get(code) ?? `type:${code}` };
  });

/** MySQL binds booleans as 1/0 and dates as `YYYY-MM-DD HH:MM:SS.fff` (UTC). */
const mysqlValue = (v: SqlScalar): unknown => {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '');
  return v;
};

export function mysqlDriver(config: ConnectionConfig): EngineDriver {
  const tls = config.options?.tls ?? 'off';
  const pool = mysql.createPool({
    host: config.host,
    port: config.port ?? 3306,
    database: config.database ?? undefined,
    user: config.user,
    password: config.password ?? undefined,
    connectionLimit: config.poolMax ?? 5,
    connectTimeout: config.connectTimeoutMs ?? 10_000,
    maxIdle: 0,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    timezone: 'Z',
    multipleStatements: false,
    ssl:
      tls === 'off'
        ? undefined
        : { rejectUnauthorized: tls === 'verify', ...(config.options?.ca ? { ca: config.options.ca } : {}) },
    connectAttributes: { program_name: config.applicationName ?? 'isbp' },
  });

  const getConnection = () =>
    new Promise<mysql.PoolConnection>((resolve, reject) =>
      pool.getConnection((err, conn) => (err ? reject(err) : resolve(conn))),
    );
  const exec = (conn: mysql.PoolConnection, sql: string) =>
    new Promise<void>((resolve, reject) => conn.query(sql, (err) => (err ? reject(err) : resolve())));
  const kill = (threadId: number | null) => {
    if (!threadId) return;
    pool.query('KILL QUERY ?', [threadId], () => undefined);
  };

  async function open(tx: TxMode): Promise<Session> {
    const conn = await getConnection();
    let broken = false;
    try {
      if (tx === 'read') await exec(conn, 'START TRANSACTION READ ONLY');
      if (tx === 'write') await exec(conn, 'START TRANSACTION');
    } catch (err) {
      conn.destroy();
      throw err;
    }

    const run = (stmt: BoundStatement, opts: RunOptions): Promise<RawResult> => {
      if (stmt.engine !== 'mysql') throw new Error('statement bound for another engine');
      const work = new Promise<RawResult>((resolve, reject) => {
        let columns: SqlColumn[] | null = null;
        const rows: Record<string, unknown>[] = [];
        let affected: number | null = null;
        let done = false;
        let truncated = false;
        const q = conn.query({ sql: stmt.text, values: stmt.values.map(mysqlValue) });
        q.on('fields', (fields: unknown) => {
          if (!columns && fields) columns = columnsOf(fields as Field[]);
        });
        // Only the first result set is returned; CALL ends with a status packet (ResultSetHeader).
        q.on('result', (row: Record<string, unknown>, index?: number) => {
          if (done) return;
          if (row.constructor?.name === 'ResultSetHeader') {
            if (!columns) affected = Number(row.affectedRows);
            return;
          }
          if (index) return;
          if (rows.length < opts.maxRows) rows.push(row);
          else if (!truncated) {
            truncated = true;
            done = true;
            broken = true; // abandon the rest of the result: the connection can't be reused
            conn.pause();
            const cols = columns ?? [];
            resolve({ columns: cols, rows: rows.map((r) => normalizeRow(r, cols)), truncated, affected });
          }
        });
        q.on('error', (err: unknown) => {
          if (done) return;
          done = true;
          reject(err);
        });
        q.on('end', () => {
          if (done) return;
          done = true;
          const cols = columns ?? [];
          resolve({ columns: cols, rows: rows.map((r) => normalizeRow(r, cols)), truncated, affected });
        });
      });
      return abortable(work, {
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        onAbort: () => {
          broken = true;
          kill(conn.threadId);
        },
      }).catch((err: unknown) => {
        broken = true;
        throw err;
      });
    };

    return {
      run,
      async *stream(stmt, opts): AsyncGenerator<StreamBatch> {
        if (stmt.engine !== 'mysql') throw new Error('statement bound for another engine');
        const q = conn.query({ sql: stmt.text, values: stmt.values.map(mysqlValue) });
        let columns: SqlColumn[] = [];
        q.on('fields', (fields: unknown) => {
          if (!columns.length && fields) columns = columnsOf(fields as Field[]);
        });
        const readable = q.stream({ highWaterMark: opts.batchSize });
        const timer = setTimeout(() => {
          broken = true;
          kill(conn.threadId);
          readable.destroy(
            Object.assign(new Error(`Statement timed out after ${opts.timeoutMs} ms`), { code: 'ETIMEOUT' }),
          );
        }, opts.timeoutMs);
        const onAbort = () => {
          broken = true;
          kill(conn.threadId);
          readable.destroy(Object.assign(new Error('Statement cancelled'), { code: 'ECANCEL' }));
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        let batch: Record<string, unknown>[] = [];
        let complete = false;
        try {
          for await (const row of readable as AsyncIterable<Record<string, unknown>>) {
            batch.push(row);
            if (batch.length >= opts.batchSize) {
              yield { columns, rows: batch.map((r) => normalizeRow(r, columns)) };
              batch = [];
            }
          }
          if (batch.length) yield { columns, rows: batch.map((r) => normalizeRow(r, columns)) };
          complete = true;
        } finally {
          clearTimeout(timer);
          opts.signal?.removeEventListener('abort', onAbort);
          if (!complete) broken = true;
        }
      },
      async call(proc, args, opts) {
        const d = dialectFor('mysql');
        const inputs = proc.parameters.filter((p) => p.direction === 'in');
        const values = Object.fromEntries(inputs.map((p, i) => [`a${i}`, args[p.name] ?? null]));
        const list = inputs.map((_, i) => `:a${i}`).join(', ');
        const name = d.qualified(proc.schema, proc.name);
        // OUT parameters need session variables and multiple statements: only IN parameters are supported.
        const sql = proc.kind === 'function' ? `SELECT ${name}(${list}) AS result` : `CALL ${name}(${list})`;
        return run(bindStatement('mysql', sql, values), opts);
      },
      async close(commit) {
        try {
          if (tx !== 'none' && !broken) await exec(conn, commit ? 'COMMIT' : 'ROLLBACK');
          else if (tx !== 'none' && commit) throw new Error('Transaction was interrupted');
        } finally {
          if (broken) conn.destroy();
          else conn.release();
        }
      },
    };
  }

  return {
    open,
    async catalog({ timeoutMs }) {
      const session = await open('none');
      const opts = { maxRows: CATALOG_LIMIT, timeoutMs };
      const q = (sql: string) => session.run(bindStatement('mysql', sql), opts).then((r) => r.rows);
      try {
        const [schemaRow] = await q('SELECT DATABASE() AS s');
        const columns = await q(`
          SELECT c.TABLE_SCHEMA AS \`schema\`, c.TABLE_NAME AS \`table\`,
                 IF(t.TABLE_TYPE = 'VIEW', 'view', 'table') AS kind,
                 c.COLUMN_NAME AS \`column\`, c.DATA_TYPE AS type, c.IS_NULLABLE = 'YES' AS nullable
            FROM information_schema.COLUMNS c
            JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
           WHERE c.TABLE_SCHEMA = DATABASE()
           ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
           LIMIT ${CATALOG_LIMIT}`);
        const keys = await q(`
          SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`
            FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_KEY IN ('PRI', 'UNI')`);
        const routines = await q(`
          SELECT r.ROUTINE_SCHEMA AS \`schema\`, r.ROUTINE_NAME AS name, LOWER(r.ROUTINE_TYPE) AS kind,
                 LOWER(r.DATA_TYPE) AS \`returns\`, p.PARAMETER_NAME AS param, p.DATA_TYPE AS type,
                 CASE p.PARAMETER_MODE WHEN 'OUT' THEN 'out' WHEN 'INOUT' THEN 'inout' ELSE 'in' END AS mode
            FROM information_schema.ROUTINES r
            LEFT JOIN information_schema.PARAMETERS p
              ON p.SPECIFIC_SCHEMA = r.ROUTINE_SCHEMA AND p.SPECIFIC_NAME = r.SPECIFIC_NAME AND p.ORDINAL_POSITION > 0
           WHERE r.ROUTINE_SCHEMA = DATABASE()
           ORDER BY r.ROUTINE_NAME, p.ORDINAL_POSITION
           LIMIT ${CATALOG_LIMIT}`);
        return buildCatalog(
          String(schemaRow?.s ?? ''),
          columns.map((c) => ({
            ...c,
            nullable: Boolean(Number(c.nullable)),
          })) as unknown as CatalogColumnRow[],
          keys as unknown as CatalogKeyRow[],
          routines as unknown as CatalogRoutineRow[],
        );
      } finally {
        await session.close(true);
      }
    },
    async version() {
      const session = await open('none');
      try {
        const r = await session.run(bindStatement('mysql', dialectFor('mysql').versionQuery), {
          maxRows: 1,
          timeoutMs: 10_000,
        });
        return String(r.rows[0]?.version ?? '');
      } finally {
        await session.close(true);
      }
    },
    close: () => new Promise<void>((resolve) => pool.end(() => resolve())),
  };
}
