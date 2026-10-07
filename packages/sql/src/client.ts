import { batchRows, cell, type Dialect, dialectFor } from './dialect';
import type { EngineDriver, Session } from './engines/driver';
import { mssqlDriver } from './engines/mssql';
import { mysqlDriver } from './engines/mysql';
import { oracleBind, oracleDriver } from './engines/oracle';
import { postgresDriver } from './engines/postgres';
import { SqlError, toSqlError } from './errors';
import { bindStatement } from './params';
import type {
  Catalog,
  CatalogProcedure,
  ConnectionConfig,
  DbEngine,
  ExecOptions,
  ServerInfo,
  SqlResult,
  SqlScalar,
  SqlValue,
  StreamBatch,
  StreamOptions,
  TableWriter,
  WriterOptions,
} from './types';

const DRIVERS: Record<DbEngine, (c: ConnectionConfig) => EngineDriver> = {
  postgres: postgresDriver,
  mssql: mssqlDriver,
  mysql: mysqlDriver,
  oracle: oracleDriver,
};

export const DEFAULT_MAX_ROWS = 1_000;
export const DEFAULT_TIMEOUT_MS = 30_000;

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    throw toSqlError(err);
  }
};

function scalar(value: unknown): SqlScalar {
  if (value === undefined || value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value instanceof Date
  )
    return value;
  return JSON.stringify(value);
}

/**
 * One external database (a pool per process). Every value is bound by the driver: statements take
 * `:name` placeholders and there is no API that splices values into SQL text.
 */
export class SqlClient {
  readonly engine: DbEngine;
  readonly dialect: Dialect;
  private readonly driver: EngineDriver;

  constructor(readonly config: ConnectionConfig) {
    this.engine = config.engine;
    this.dialect = dialectFor(config.engine);
    this.driver = DRIVERS[config.engine](config);
  }

  private txFor(readOnly: boolean | undefined) {
    return readOnly && this.dialect.readOnly ? 'read' : 'none';
  }

  /** Runs one statement and returns up to `maxRows` rows. */
  query(sql: string, opts: ExecOptions = {}): Promise<SqlResult> {
    return wrap(async () => {
      const stmt = bindStatement(this.engine, sql, opts.params, opts.types);
      const started = performance.now();
      const session = await this.driver.open(this.txFor(opts.readOnly));
      let ok = false;
      try {
        const raw = await session.run(stmt, {
          maxRows: opts.maxRows ?? DEFAULT_MAX_ROWS,
          timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal: opts.signal,
        });
        ok = true;
        return { ...raw, durationMs: Math.round(performance.now() - started) };
      } finally {
        await session.close(ok).catch(() => undefined);
      }
    });
  }

  /** Calls a procedure or function from the catalog with named arguments. */
  call(
    proc: CatalogProcedure,
    args: Record<string, SqlValue | undefined>,
    opts: Omit<ExecOptions, 'params' | 'types'> = {},
  ): Promise<SqlResult> {
    return wrap(async () => {
      const started = performance.now();
      const session = await this.driver.open(this.txFor(opts.readOnly));
      let ok = false;
      try {
        const raw = await session.call(proc, args, {
          maxRows: opts.maxRows ?? DEFAULT_MAX_ROWS,
          timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal: opts.signal,
        });
        ok = true;
        return { ...raw, durationMs: Math.round(performance.now() - started) };
      } finally {
        await session.close(ok).catch(() => undefined);
      }
    });
  }

  /** Reads a large result in batches (server-side cursor); stop iterating to abandon it. */
  async *stream(sql: string, opts: StreamOptions = {}): AsyncGenerator<StreamBatch> {
    let session: Session;
    try {
      session = await this.driver.open(this.txFor(opts.readOnly));
    } catch (err) {
      throw toSqlError(err);
    }
    let ok = false;
    try {
      const stmt = bindStatement(this.engine, sql, opts.params, opts.types);
      for await (const batch of session.stream(stmt, {
        batchSize: opts.batchSize ?? 500,
        timeoutMs: opts.timeoutMs ?? 10 * 60_000,
        signal: opts.signal,
      }))
        yield batch;
      ok = true;
    } catch (err) {
      throw toSqlError(err);
    } finally {
      await session.close(ok).catch(() => undefined);
    }
  }

  /**
   * Opens a load into a catalog table inside one transaction: `insert`, `upsert` on `keys`, or `replace`
   * (delete everything, then insert). Nothing is visible to others until `commit()`.
   */
  writer(table: { schema?: string | null; name: string }, opts: WriterOptions): Promise<TableWriter> {
    return wrap(async () => {
      const { columns, mode } = opts;
      const keys = opts.keys ?? [];
      if (!columns.length) throw new SqlError('parameter', 'No columns to write');
      if (mode === 'upsert' && !keys.length) throw new SqlError('parameter', 'Upsert needs key columns');
      for (const k of keys)
        if (!columns.includes(k)) throw new SqlError('parameter', `Key column ${k} is not written`);
      const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
      const target = this.dialect.qualified(table.schema, table.name);
      const session = await this.driver.open('write');
      let closed = false;
      const run = (sql: string, values: Record<string, SqlScalar> = {}) =>
        session.run(bindStatement(this.engine, sql, values), { maxRows: 1, timeoutMs, signal: opts.signal });
      try {
        if (mode === 'replace') await run(this.dialect.deleteAll(target));
      } catch (err) {
        closed = true;
        await session.close(false).catch(() => undefined);
        throw err;
      }
      const perStatement = batchRows(this.dialect, columns.length);
      const engine = this.engine;
      const dialect = this.dialect;
      return {
        write: (rows) =>
          wrap(async () => {
            if (closed) throw new SqlError('other', 'Writer is closed');
            let written = 0;
            if (engine === 'oracle') {
              const one = Object.fromEntries(columns.map((_, c) => [cell(c, 0).slice(1), null]));
              const { text } = bindStatement(
                'oracle',
                dialect.writeStatement(target, columns, 1, mode, keys),
                one,
              );
              for (let i = 0; i < rows.length; i += 1_000) {
                const chunk = rows
                  .slice(i, i + 1_000)
                  .map((row) =>
                    Object.fromEntries(
                      columns.map((c, idx) => [
                        `b${idx + 1}`,
                        oracleBind({ val: scalar(row[c]), type: null }).val,
                      ]),
                    ),
                  );
                await session.runMany!(text, chunk, { timeoutMs, signal: opts.signal });
                written += chunk.length;
              }
              return written;
            }
            for (let i = 0; i < rows.length; i += perStatement) {
              const chunk = rows.slice(i, i + perStatement);
              const values: Record<string, SqlScalar> = {};
              chunk.forEach((row, r) =>
                columns.forEach((c, idx) => (values[cell(idx, r).slice(1)] = scalar(row[c]))),
              );
              await run(dialect.writeStatement(target, columns, chunk.length, mode, keys), values);
              written += chunk.length;
            }
            return written;
          }),
        commit: () =>
          wrap(async () => {
            if (closed) return;
            closed = true;
            await session.close(true);
          }),
        rollback: async () => {
          if (closed) return;
          closed = true;
          await session.close(false).catch(() => undefined);
        },
      };
    });
  }

  catalog(timeoutMs = 60_000): Promise<Catalog> {
    return wrap(() => this.driver.catalog({ timeoutMs }));
  }

  /** Connects and reads the server version. */
  test(): Promise<ServerInfo> {
    return wrap(async () => {
      const started = performance.now();
      const version = await this.driver.version();
      return {
        version: version.split('\n')[0]!.slice(0, 300),
        latencyMs: Math.round(performance.now() - started),
      };
    });
  }

  close(): Promise<void> {
    return this.driver.close().catch(() => undefined);
  }
}
