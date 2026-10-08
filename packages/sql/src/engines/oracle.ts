import oracledb from 'oracledb';
import { dialectFor } from '../dialect';
import { type BoundStatement, bindStatement, type OracleBind } from '../params';
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
  normalizeValue,
  type RawResult,
  type RunOptions,
  type Session,
  type TxMode,
} from './driver';

// Thin mode (pure JavaScript). LOBs are fetched as strings/buffers so results are plain JSON.
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

type Meta = { name: string; dbTypeName?: string };
const columnsOf = (meta: readonly Meta[] | undefined): SqlColumn[] =>
  (meta ?? []).map((m) => ({ name: m.name, type: (m.dbTypeName ?? 'unknown').toLowerCase() }));

/** Oracle has no boolean before 23ai and binds dates as TIMESTAMP: normalise. */
export function oracleBind(b: OracleBind): oracledb.BindParameter {
  let val: unknown = b.val;
  if (typeof val === 'boolean') val = val ? 1 : 0;
  if (typeof val === 'bigint') val = val.toString();
  if (b.type === 'date' && typeof val === 'string') val = new Date(`${val}T00:00:00Z`);
  if (b.type === 'decimal' && val !== null) val = String(val);
  return { val, dir: oracledb.BIND_IN };
}

const bindsOf = (stmt: BoundStatement) => {
  if (stmt.engine !== 'oracle') throw new Error('statement bound for another engine');
  return Object.fromEntries(Object.entries(stmt.binds).map(([k, b]) => [k, oracleBind(b)]));
};

async function drain(rs: oracledb.ResultSet<Record<string, unknown>>, max: number) {
  try {
    return await rs.getRows(max);
  } finally {
    await rs.close();
  }
}

export function oracleDriver(config: ConnectionConfig): EngineDriver {
  const tls = config.options?.tls ?? 'off';
  const address = `${config.host}:${config.port ?? 1521}/${config.database ?? ''}`;
  let pool: Promise<oracledb.Pool> | null = null;
  const getPool = () => {
    pool ??= oracledb
      .createPool({
        user: config.user,
        password: config.password ?? undefined,
        connectString: tls === 'off' ? address : `tcps://${address}`,
        poolMin: 0,
        poolMax: config.poolMax ?? 5,
        poolIncrement: 1,
        poolTimeout: 60,
        connectTimeout: Math.ceil((config.connectTimeoutMs ?? 15_000) / 1_000),
      })
      .catch((err: unknown) => {
        pool = null;
        throw err;
      });
    return pool;
  };

  async function open(tx: TxMode): Promise<Session> {
    const conn = await (await getPool()).getConnection();
    let broken = false;
    const autoCommit = tx === 'none';
    try {
      if (tx === 'read') await conn.execute('SET TRANSACTION READ ONLY');
    } catch (err) {
      await conn.close({ drop: true }).catch(() => undefined);
      throw err;
    }
    const guard = <T>(promise: Promise<T>, opts: { timeoutMs: number; signal?: AbortSignal }) => {
      conn.callTimeout = opts.timeoutMs;
      return abortable(promise, {
        timeoutMs: opts.timeoutMs + 2_000,
        signal: opts.signal,
        onAbort: () => {
          broken = true;
          void conn.break().catch(() => undefined);
        },
      });
    };

    const run = async (stmt: BoundStatement, opts: RunOptions): Promise<RawResult> => {
      const result = await guard(
        conn.execute<Record<string, unknown>>(stmt.text, bindsOf(stmt), {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: opts.maxRows + 1,
          autoCommit,
        }),
        opts,
      );
      const columns = columnsOf(result.metaData as Meta[] | undefined);
      const rows = result.rows ?? [];
      return {
        columns,
        rows: rows.slice(0, opts.maxRows).map((r) => normalizeRow(r, columns)),
        truncated: rows.length > opts.maxRows,
        affected: result.metaData ? null : (result.rowsAffected ?? null),
      };
    };

    return {
      run,
      async *stream(stmt, opts): AsyncGenerator<StreamBatch> {
        const result = await guard(
          conn.execute<Record<string, unknown>>(stmt.text, bindsOf(stmt), {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            resultSet: true,
            fetchArraySize: opts.batchSize,
            autoCommit,
          }),
          opts,
        );
        const rs = result.resultSet!;
        const columns = columnsOf(result.metaData as Meta[] | undefined);
        try {
          for (;;) {
            const rows = await guard(rs.getRows(opts.batchSize), opts);
            if (rows.length) yield { columns, rows: rows.map((r) => normalizeRow(r, columns)) };
            if (rows.length < opts.batchSize) break;
          }
        } finally {
          await rs.close().catch(() => (broken = true));
        }
      },
      async runMany(text, rows, opts) {
        if (!rows.length) return 0;
        const result = await guard(
          conn.executeMany(text, rows as oracledb.BindParameters[], { autoCommit, batchErrors: false }),
          opts,
        );
        return result.rowsAffected ?? rows.length;
      },
      async call(proc, args, opts) {
        const { text, binds, outputs, cursor } = oracleCall(proc, args);
        const result = await guard(
          conn.execute<Record<string, unknown>>(text, binds, {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit,
          }),
          opts,
        );
        const outBinds = (result.outBinds ?? {}) as Record<string, unknown>;
        let columns: SqlColumn[] = [];
        let rows: Record<string, unknown>[] = [];
        let truncated = false;
        if (cursor) {
          const rs = outBinds[cursor] as oracledb.ResultSet<Record<string, unknown>> | undefined;
          if (rs) {
            columns = columnsOf(rs.metaData as Meta[] | undefined);
            const fetched = await guard(drain(rs, opts.maxRows + 1), opts);
            truncated = fetched.length > opts.maxRows;
            rows = fetched.slice(0, opts.maxRows).map((r) => normalizeRow(r, columns));
          }
        }
        return {
          columns,
          rows,
          truncated,
          affected: null,
          outputs: Object.fromEntries(outputs.map((o) => [o.param, normalizeValue(outBinds[o.bind])])),
        };
      },
      async close(commit) {
        try {
          if (tx !== 'none' && !broken) {
            if (commit) await conn.commit();
            else await conn.rollback();
          } else if (tx !== 'none' && commit) throw new Error('Transaction was interrupted');
        } finally {
          // An interrupted statement can keep running until the server notices the break, and the driver
          // queues close() behind it: drop the connection without waiting so the caller isn't held up.
          if (broken) void conn.close({ drop: true }).catch(() => undefined);
          else await conn.close().catch(() => undefined);
        }
      },
    };
  }

  return {
    open,
    async catalog({ timeoutMs }) {
      const session = await open('none');
      const opts = { maxRows: CATALOG_LIMIT, timeoutMs };
      const q = (sql: string) => session.run(bindStatement('oracle', sql), opts).then((r) => r.rows);
      const userSchemas = `SELECT username FROM all_users WHERE oracle_maintained = 'N'`;
      try {
        const [schemaRow] = await q(`SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS S FROM dual`);
        const columns = await q(`
          SELECT c.owner AS "schema", c.table_name AS "table",
                 CASE o.object_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS "kind",
                 c.column_name AS "column", c.data_type AS "type",
                 CASE c.nullable WHEN 'Y' THEN 1 ELSE 0 END AS "nullable"
            FROM all_tab_columns c
            JOIN all_objects o ON o.owner = c.owner AND o.object_name = c.table_name AND o.object_type IN ('TABLE', 'VIEW')
           WHERE c.owner IN (${userSchemas})
           ORDER BY c.owner, c.table_name, c.column_id
           FETCH FIRST ${CATALOG_LIMIT} ROWS ONLY`);
        const keys = await q(`
          SELECT cc.owner AS "schema", cc.table_name AS "table", cc.column_name AS "column"
            FROM all_cons_columns cc
            JOIN all_constraints k ON k.owner = cc.owner AND k.constraint_name = cc.constraint_name
           WHERE k.constraint_type IN ('P', 'U') AND cc.owner IN (${userSchemas})`);
        const routines = await q(`
          SELECT p.owner AS "schema", p.object_name AS "name", LOWER(p.object_type) AS "kind",
                 (SELECT LOWER(r.data_type) FROM all_arguments r
                   WHERE r.owner = p.owner AND r.object_name = p.object_name AND r.package_name IS NULL
                     AND r.position = 0 AND ROWNUM = 1) AS "returns",
                 a.argument_name AS "param", a.data_type AS "type",
                 CASE a.in_out WHEN 'OUT' THEN 'out' WHEN 'IN/OUT' THEN 'inout' ELSE 'in' END AS "mode"
            FROM all_procedures p
            LEFT JOIN all_arguments a
              ON a.owner = p.owner AND a.object_name = p.object_name AND a.package_name IS NULL
             AND a.position > 0 AND a.data_level = 0
           WHERE p.object_type IN ('PROCEDURE', 'FUNCTION') AND p.owner IN (${userSchemas})
           ORDER BY p.owner, p.object_name, a.position
           FETCH FIRST ${CATALOG_LIMIT} ROWS ONLY`);
        return buildCatalog(
          String(schemaRow?.S ?? config.user.toUpperCase()),
          columns.map((c) => ({ ...c, nullable: Number(c.nullable) === 1 })) as unknown as CatalogColumnRow[],
          keys as unknown as CatalogKeyRow[],
          routines as unknown as CatalogRoutineRow[],
        );
      } finally {
        await session.close(true);
      }
    },
    async version() {
      const conn = await (await getPool()).getConnection();
      try {
        return `Oracle ${conn.oracleServerVersionString}`;
      } finally {
        await conn.close();
      }
    },
    async close() {
      const p = pool;
      pool = null;
      if (p) await (await p).close(5).catch(() => undefined);
    },
  };
}

/**
 * `BEGIN schema.proc(a => :b1, c => :o1); END;` (or `:ret := fn(…)`) with OUT binds; a REF CURSOR result
 * (OUT parameter or function return) is fetched as the rows.
 */
export function oracleCall(proc: CatalogProcedure, args: Record<string, SqlValue | undefined>) {
  const d = dialectFor('oracle');
  const name = d.qualified(proc.schema, proc.name);
  const binds: Record<string, oracledb.BindParameter> = {};
  const outputs: { param: string; bind: string }[] = [];
  let cursor: string | null = null;
  const list = proc.parameters.map((p, i) => {
    const bind = `p${i + 1}`;
    if (p.direction === 'in') {
      binds[bind] = oracleBind({ val: (args[p.name] ?? null) as never, type: null });
    } else {
      const isCursor = p.type === 'ref cursor';
      binds[bind] = isCursor
        ? { dir: oracledb.BIND_OUT, type: oracledb.CURSOR }
        : {
            dir: p.direction === 'inout' ? oracledb.BIND_INOUT : oracledb.BIND_OUT,
            type: /number|integer|float/.test(p.type) ? oracledb.NUMBER : oracledb.STRING,
            maxSize: 32_767,
            ...(p.direction === 'inout' ? { val: args[p.name] ?? null } : {}),
          };
      if (isCursor) cursor ??= bind;
      else outputs.push({ param: p.name, bind });
    }
    return `${d.quote(p.name)} => :${bind}`;
  });
  let text: string;
  if (proc.kind === 'function') {
    const isCursor = proc.returns === 'ref cursor';
    binds.ret = isCursor
      ? { dir: oracledb.BIND_OUT, type: oracledb.CURSOR }
      : { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32_767 };
    if (isCursor) cursor = 'ret';
    else outputs.push({ param: 'result', bind: 'ret' });
    text = `BEGIN :ret := ${name}(${list.join(', ')}); END;`;
  } else {
    text = `BEGIN ${name}(${list.join(', ')}); END;`;
  }
  return { text, binds, outputs, cursor };
}
