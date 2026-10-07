import mssql from 'mssql';
import { dialectFor } from '../dialect';
import { type BoundStatement, bindStatement, type MssqlBind } from '../params';
import type { ConnectionConfig, SqlColumn, SqlParamType, StreamBatch } from '../types';
import {
  abortable,
  buildCatalog,
  CATALOG_LIMIT,
  type CatalogColumnRow,
  type CatalogKeyRow,
  type CatalogRoutineRow,
  type EngineDriver,
  normalizeRow,
  normalizeValue,
  type RawResult,
  type RunOptions,
  type Session,
  type TxMode,
} from './driver';

type SqlTypeArg = mssql.ISqlType | (() => mssql.ISqlType);

/** Driver type for a bound value: the declared type, else inferred from the JavaScript value. */
export function mssqlType(type: SqlParamType | null, value: unknown): SqlTypeArg {
  switch (type) {
    case 'integer':
      return mssql.BigInt;
    case 'number':
      return mssql.Float;
    case 'boolean':
      return mssql.Bit;
    case 'date':
      return mssql.Date;
    case 'datetime':
      return mssql.DateTimeOffset;
    case 'uuid':
      return mssql.UniqueIdentifier;
    case 'decimal':
    case 'string':
      return mssql.NVarChar(typeof value === 'string' && value.length > 4_000 ? mssql.MAX : 4_000);
  }
  if (typeof value === 'number')
    return Number.isInteger(value) ? (Math.abs(value) < 2 ** 31 ? mssql.Int : mssql.BigInt) : mssql.Float;
  if (typeof value === 'boolean') return mssql.Bit;
  if (value instanceof Date) return mssql.DateTimeOffset;
  return mssql.NVarChar(typeof value === 'string' && value.length > 4_000 ? mssql.MAX : 4_000);
}

function bindValue(b: MssqlBind): unknown {
  if (b.value === null) return null;
  if (typeof b.value === 'bigint') return b.value.toString();
  if (b.type === 'date' && typeof b.value === 'string') return new Date(`${b.value}T00:00:00Z`);
  if (b.type === 'decimal') return String(b.value);
  return b.value;
}

const OUTPUT_TYPES: Record<string, SqlTypeArg> = {
  int: mssql.Int,
  bigint: mssql.BigInt,
  smallint: mssql.SmallInt,
  tinyint: mssql.TinyInt,
  bit: mssql.Bit,
  float: mssql.Float,
  real: mssql.Real,
  money: mssql.Money,
  date: mssql.Date,
  datetime: mssql.DateTime,
  datetime2: mssql.DateTime2,
  datetimeoffset: mssql.DateTimeOffset,
  uniqueidentifier: mssql.UniqueIdentifier,
};

type ColumnMeta = { name: string; type?: unknown };
const typeName = (t: unknown): string => {
  const decl = (
    typeof t === 'function' ? (t as () => { declaration?: string })() : (t as { declaration?: string })
  )?.declaration;
  return decl ? decl.toLowerCase() : 'unknown';
};
const columnsOf = (meta: Record<string, ColumnMeta>): SqlColumn[] =>
  Object.values(meta)
    .sort((a, b) => ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0))
    .map((c) => ({ name: c.name, type: typeName(c.type) }));

export function mssqlDriver(config: ConnectionConfig): EngineDriver {
  const tls = config.options?.tls ?? 'require';
  const instanceName = config.options?.instanceName || undefined;
  const pool = new mssql.ConnectionPool({
    server: config.host,
    ...(instanceName ? {} : { port: config.port ?? 1433 }),
    database: config.database ?? undefined,
    user: config.user,
    password: config.password ?? undefined,
    domain: config.options?.domain || undefined,
    connectionTimeout: config.connectTimeoutMs ?? 15_000,
    requestTimeout: 0, // per request, through cancel()
    pool: { max: config.poolMax ?? 5, min: 0, idleTimeoutMillis: 60_000 },
    options: {
      encrypt: tls !== 'off',
      trustServerCertificate: tls === 'require',
      instanceName,
      appName: config.applicationName ?? 'isbp',
      useUTC: true,
      enableArithAbort: true,
    },
  });
  let connecting: Promise<mssql.ConnectionPool> | null = null;
  const ready = () => {
    connecting ??= pool.connect().catch((err: unknown) => {
      connecting = null;
      throw err;
    });
    return connecting;
  };

  async function open(tx: TxMode): Promise<Session> {
    await ready();
    // SQL Server has no read-only transactions: `read` relies on the login's permissions.
    const transaction = tx === 'write' ? new mssql.Transaction(pool) : null;
    if (transaction) await transaction.begin();
    const request = () => (transaction ? new mssql.Request(transaction) : new mssql.Request(pool));
    const withInputs = (req: mssql.Request, binds: MssqlBind[]) => {
      for (const b of binds) req.input(b.name, mssqlType(b.type, b.value), bindValue(b));
      return req;
    };

    const run = (stmt: BoundStatement, opts: RunOptions): Promise<RawResult> => {
      if (stmt.engine !== 'mssql') throw new Error('statement bound for another engine');
      const req = withInputs(request(), stmt.binds);
      req.stream = true;
      const work = new Promise<RawResult>((resolve, reject) => {
        let columns: SqlColumn[] | null = null;
        let sets = 0;
        const rows: Record<string, unknown>[] = [];
        let affected: number | null = null;
        let done = false;
        const finish = (truncated: boolean) => {
          if (done) return;
          done = true;
          const cols = columns ?? [];
          resolve({ columns: cols, rows: rows.map((r) => normalizeRow(r, cols)), truncated, affected });
        };
        req.on('recordset', (meta: Record<string, ColumnMeta>) => {
          sets++;
          if (sets === 1) columns = columnsOf(meta);
        });
        req.on('row', (row: Record<string, unknown>) => {
          if (sets !== 1 || done) return;
          if (rows.length < opts.maxRows) rows.push(row);
          else {
            finish(true);
            req.cancel();
          }
        });
        req.on('rowsaffected', (n: number) => (affected = (affected ?? 0) + n));
        req.on('error', (err: unknown) => {
          if (done) return;
          done = true;
          reject(err);
        });
        req.on('done', () => finish(false));
        void req.query(stmt.text);
      });
      return abortable(work, { timeoutMs: opts.timeoutMs, signal: opts.signal, onAbort: () => req.cancel() });
    };

    return {
      run,
      async *stream(stmt, opts): AsyncGenerator<StreamBatch> {
        if (stmt.engine !== 'mssql') throw new Error('statement bound for another engine');
        const req = withInputs(request(), stmt.binds);
        req.stream = true;
        let columns: SqlColumn[] = [];
        let sets = 0;
        let batch: Record<string, unknown>[] = [];
        const ready: StreamBatch[] = [];
        let finished = false;
        let failure: unknown = null;
        let wake: (() => void) | null = null;
        const notify = () => {
          wake?.();
          wake = null;
        };
        req.on('recordset', (meta: Record<string, ColumnMeta>) => {
          sets++;
          if (sets === 1) columns = columnsOf(meta);
        });
        req.on('row', (row: Record<string, unknown>) => {
          if (sets !== 1) return;
          batch.push(row);
          if (batch.length >= opts.batchSize) {
            ready.push({ columns, rows: batch.map((r) => normalizeRow(r, columns)) });
            batch = [];
            req.pause();
            notify();
          }
        });
        req.on('error', (err: unknown) => {
          failure = err;
          notify();
        });
        req.on('done', () => {
          if (batch.length) ready.push({ columns, rows: batch.map((r) => normalizeRow(r, columns)) });
          batch = [];
          finished = true;
          notify();
        });
        const timer = setTimeout(() => {
          failure = Object.assign(new Error(`Statement timed out after ${opts.timeoutMs} ms`), {
            code: 'ETIMEOUT',
          });
          req.cancel();
          notify();
        }, opts.timeoutMs);
        const onAbort = () => {
          failure = Object.assign(new Error('Statement cancelled'), { code: 'ECANCEL' });
          req.cancel();
          notify();
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        void req.query(stmt.text);
        try {
          for (;;) {
            if (failure) throw failure;
            const next = ready.shift();
            if (next) {
              yield next;
              req.resume();
              continue;
            }
            if (finished) break;
            await new Promise<void>((resolve) => (wake = resolve));
          }
        } finally {
          clearTimeout(timer);
          opts.signal?.removeEventListener('abort', onAbort);
          if (!finished) req.cancel();
        }
      },
      async call(proc, args, opts) {
        const name = dialectFor('mssql').qualified(proc.schema, proc.name);
        if (proc.kind === 'function') {
          const inputs = proc.parameters.filter((p) => p.direction === 'in');
          const values = Object.fromEntries(inputs.map((p, i) => [`a${i}`, args[p.name] ?? null]));
          const list = inputs.map((_, i) => `:a${i}`).join(', ');
          // Table-valued functions are selected from; scalar functions return one value.
          const sql =
            proc.returns === 'table'
              ? `SELECT * FROM ${name}(${list})`
              : `SELECT ${name}(${list}) AS [result]`;
          return run(bindStatement('mssql', sql, values), opts);
        }
        const req = request();
        for (const p of proc.parameters) {
          const value = args[p.name] ?? null;
          if (p.direction === 'in') req.input(p.name, mssqlType(null, value), value);
          else
            req.output(
              p.name,
              OUTPUT_TYPES[p.type] ?? mssql.NVarChar(mssql.MAX),
              p.direction === 'inout' ? value : undefined,
            );
        }
        const result = await abortable(req.execute(name), {
          timeoutMs: opts.timeoutMs,
          signal: opts.signal,
          onAbort: () => req.cancel(),
        });
        const set = result.recordset ?? [];
        const columns = set.columns ? columnsOf(set.columns as unknown as Record<string, ColumnMeta>) : [];
        return {
          columns,
          rows: set.slice(0, opts.maxRows).map((r: Record<string, unknown>) => normalizeRow(r, columns)),
          truncated: set.length > opts.maxRows,
          affected: result.rowsAffected?.reduce((a, b) => a + b, 0) ?? null,
          outputs: Object.fromEntries(
            Object.entries(result.output ?? {}).map(([k, v]) => [k, normalizeValue(v)]),
          ),
        };
      },
      async close(commit) {
        if (!transaction) return;
        if (commit) await transaction.commit();
        else await transaction.rollback().catch(() => undefined);
      },
    };
  }

  return {
    open,
    async catalog({ timeoutMs }) {
      const session = await open('none');
      const opts = { maxRows: CATALOG_LIMIT, timeoutMs };
      const q = (sql: string) => session.run(bindStatement('mssql', sql), opts).then((r) => r.rows);
      const [schemaRow] = await q('SELECT SCHEMA_NAME() AS s');
      const columns = await q(`
        SELECT TOP (${CATALOG_LIMIT}) c.TABLE_SCHEMA AS [schema], c.TABLE_NAME AS [table],
               CASE t.TABLE_TYPE WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind,
               c.COLUMN_NAME AS [column], c.DATA_TYPE AS type,
               CAST(CASE c.IS_NULLABLE WHEN 'YES' THEN 1 ELSE 0 END AS bit) AS nullable
          FROM INFORMATION_SCHEMA.COLUMNS c
          JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
         WHERE c.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
         ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`);
      const keys = await q(`
        SELECT k.TABLE_SCHEMA AS [schema], k.TABLE_NAME AS [table], k.COLUMN_NAME AS [column]
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
            ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
         WHERE tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')`);
      const routines = await q(`
        SELECT TOP (${CATALOG_LIMIT}) r.ROUTINE_SCHEMA AS [schema], r.ROUTINE_NAME AS name,
               LOWER(r.ROUTINE_TYPE) AS kind, LOWER(r.DATA_TYPE) AS [returns],
               p.PARAMETER_NAME AS param, p.DATA_TYPE AS type,
               CASE p.PARAMETER_MODE WHEN 'OUT' THEN 'out' WHEN 'INOUT' THEN 'inout' ELSE 'in' END AS mode
          FROM INFORMATION_SCHEMA.ROUTINES r
          LEFT JOIN INFORMATION_SCHEMA.PARAMETERS p
            ON p.SPECIFIC_SCHEMA = r.SPECIFIC_SCHEMA AND p.SPECIFIC_NAME = r.SPECIFIC_NAME AND p.ORDINAL_POSITION > 0
         WHERE r.ROUTINE_SCHEMA NOT IN ('sys')
         ORDER BY r.ROUTINE_SCHEMA, r.ROUTINE_NAME, p.ORDINAL_POSITION`);
      await session.close(true);
      return buildCatalog(
        String(schemaRow?.s ?? 'dbo'),
        columns.map((c) => ({ ...c, nullable: Boolean(c.nullable) })) as unknown as CatalogColumnRow[],
        keys as unknown as CatalogKeyRow[],
        routines as unknown as CatalogRoutineRow[],
      );
    },
    async version() {
      await ready();
      const r = await pool.request().query(dialectFor('mssql').versionQuery);
      return String((r.recordset[0] as { version?: string } | undefined)?.version ?? '');
    },
    async close() {
      await pool.close();
    },
  };
}
