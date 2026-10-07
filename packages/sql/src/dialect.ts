import { SqlError } from './errors';
import type { DbEngine, WriteMode } from './types';

/**
 * Identifier quoting and statement builders per engine. Identifiers passed here come from the
 * connection's catalog (never free text); quoting is defence in depth. Values are always placeholders.
 */
export interface Dialect {
  engine: DbEngine;
  quote(identifier: string): string;
  qualified(schema: string | null | undefined, name: string): string;
  /** Max bound parameters in one statement. */
  maxParams: number;
  /** Max rows in one multi-row VALUES list. */
  maxRowsPerStatement: number;
  /**
   * Multi-row insert/upsert for `rows` rows, with `:c<col>_<row>` placeholders (bound via `bindStatement`).
   * Oracle uses one-row statements with `executeMany` instead (`rows` must be 1).
   */
  writeStatement(table: string, columns: string[], rows: number, mode: WriteMode, keys: string[]): string;
  deleteAll(table: string): string;
  /** Statements that wrap a read-only transaction, or null when the engine has none. */
  readOnly: { begin: string; end: string } | null;
  versionQuery: string;
}

// eslint-disable-next-line no-control-regex -- identifiers must not contain control characters
const CONTROL = /[\u0000-\u001f]/;

function checkIdent(name: string) {
  if (!name || name.length > 128 || CONTROL.test(name))
    throw new SqlError('parameter', `Invalid identifier: ${JSON.stringify(name)}`);
}

const doubleQuote = (name: string) => {
  checkIdent(name);
  return `"${name.replaceAll('"', '""')}"`;
};

/** Placeholder for column `c` in row `r` (names are positional, so any column name is safe). */
export const cell = (c: number, r: number) => `:c${c}_${r}`;

function valuesList(columns: string[], rows: number, from = 0): string {
  const out: string[] = [];
  for (let r = from; r < from + rows; r++) out.push(`(${columns.map((_, c) => cell(c, r)).join(', ')})`);
  return out.join(', ');
}

function nonKey(columns: string[], keys: string[]) {
  const k = new Set(keys);
  return columns.filter((c) => !k.has(c));
}

const postgres: Dialect = {
  engine: 'postgres',
  quote: doubleQuote,
  qualified: (schema, name) => (schema ? `${doubleQuote(schema)}.${doubleQuote(name)}` : doubleQuote(name)),
  maxParams: 65_000,
  maxRowsPerStatement: 5_000,
  writeStatement(table, columns, rows, mode, keys) {
    const cols = columns.map(doubleQuote).join(', ');
    let sql = `INSERT INTO ${table} (${cols}) VALUES ${valuesList(columns, rows)}`;
    if (mode === 'upsert') {
      const updates = nonKey(columns, keys);
      sql += ` ON CONFLICT (${keys.map(doubleQuote).join(', ')}) `;
      sql += updates.length
        ? `DO UPDATE SET ${updates.map((c) => `${doubleQuote(c)} = EXCLUDED.${doubleQuote(c)}`).join(', ')}`
        : 'DO NOTHING';
    }
    return sql;
  },
  deleteAll: (table) => `DELETE FROM ${table}`,
  readOnly: { begin: 'BEGIN READ ONLY', end: 'COMMIT' },
  versionQuery: 'SELECT version() AS version',
};

const mssqlQuote = (name: string) => {
  checkIdent(name);
  return `[${name.replaceAll(']', ']]')}]`;
};

const mssql: Dialect = {
  engine: 'mssql',
  quote: mssqlQuote,
  qualified: (schema, name) => (schema ? `${mssqlQuote(schema)}.${mssqlQuote(name)}` : mssqlQuote(name)),
  maxParams: 2_000,
  maxRowsPerStatement: 1_000,
  writeStatement(table, columns, rows, mode, keys) {
    const cols = columns.map(mssqlQuote).join(', ');
    if (mode !== 'upsert') return `INSERT INTO ${table} (${cols}) VALUES ${valuesList(columns, rows)}`;
    const on = keys.map((k) => `tgt.${mssqlQuote(k)} = src.${mssqlQuote(k)}`).join(' AND ');
    const updates = nonKey(columns, keys);
    let sql = `MERGE INTO ${table} WITH (HOLDLOCK) AS tgt USING (VALUES ${valuesList(columns, rows)}) AS src (${cols}) ON ${on}`;
    if (updates.length)
      sql += ` WHEN MATCHED THEN UPDATE SET ${updates.map((c) => `tgt.${mssqlQuote(c)} = src.${mssqlQuote(c)}`).join(', ')}`;
    sql += ` WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${columns.map((c) => `src.${mssqlQuote(c)}`).join(', ')});`;
    return sql;
  },
  deleteAll: (table) => `DELETE FROM ${table}`,
  readOnly: null,
  versionQuery:
    "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) + ' ' + CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS version",
};

const mysqlQuote = (name: string) => {
  checkIdent(name);
  return `\`${name.replaceAll('`', '``')}\``;
};

const mysql: Dialect = {
  engine: 'mysql',
  quote: mysqlQuote,
  qualified: (schema, name) => (schema ? `${mysqlQuote(schema)}.${mysqlQuote(name)}` : mysqlQuote(name)),
  maxParams: 60_000,
  maxRowsPerStatement: 5_000,
  writeStatement(table, columns, rows, mode, keys) {
    const cols = columns.map(mysqlQuote).join(', ');
    let sql = `INSERT INTO ${table} (${cols}) VALUES ${valuesList(columns, rows)}`;
    if (mode === 'upsert') {
      const updates = nonKey(columns, keys);
      const set = (updates.length ? updates : keys.slice(0, 1))
        .map((c) => `${mysqlQuote(c)} = new_row.${mysqlQuote(c)}`)
        .join(', ');
      sql = `INSERT INTO ${table} (${cols}) VALUES ${valuesList(columns, rows)} AS new_row ON DUPLICATE KEY UPDATE ${set}`;
    }
    return sql;
  },
  deleteAll: (table) => `DELETE FROM ${table}`,
  readOnly: { begin: 'START TRANSACTION READ ONLY', end: 'COMMIT' },
  versionQuery: 'SELECT VERSION() AS version',
};

const oracleQuote = (name: string) => {
  checkIdent(name);
  if (name.includes('"')) throw new SqlError('parameter', `Invalid Oracle identifier: ${name}`);
  return `"${name}"`;
};

const oracle: Dialect = {
  engine: 'oracle',
  quote: oracleQuote,
  qualified: (schema, name) => (schema ? `${oracleQuote(schema)}.${oracleQuote(name)}` : oracleQuote(name)),
  maxParams: 60_000,
  maxRowsPerStatement: 1,
  writeStatement(table, columns, rows, mode, keys) {
    if (rows !== 1) throw new SqlError('parameter', 'Oracle writes bind one row per statement (executeMany)');
    const cols = columns.map(oracleQuote).join(', ');
    if (mode !== 'upsert')
      return `INSERT INTO ${table} (${cols}) VALUES (${columns.map((_, c) => cell(c, 0)).join(', ')})`;
    const src = columns.map((c, i) => `${cell(i, 0)} AS ${oracleQuote(c)}`).join(', ');
    const on = keys.map((k) => `tgt.${oracleQuote(k)} = src.${oracleQuote(k)}`).join(' AND ');
    const updates = nonKey(columns, keys);
    let sql = `MERGE INTO ${table} tgt USING (SELECT ${src} FROM dual) src ON (${on})`;
    if (updates.length)
      sql += ` WHEN MATCHED THEN UPDATE SET ${updates.map((c) => `tgt.${oracleQuote(c)} = src.${oracleQuote(c)}`).join(', ')}`;
    sql += ` WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${columns.map((c) => `src.${oracleQuote(c)}`).join(', ')})`;
    return sql;
  },
  deleteAll: (table) => `DELETE FROM ${table}`,
  readOnly: { begin: 'SET TRANSACTION READ ONLY', end: 'COMMIT' },
  versionQuery: 'SELECT banner_full AS version FROM v$version WHERE ROWNUM = 1',
};

export const DIALECTS: Record<DbEngine, Dialect> = { postgres, mssql, mysql, oracle };

export const dialectFor = (engine: DbEngine) => DIALECTS[engine];

/** Rows per write statement for this many columns, within the engine's parameter and row limits. */
export function batchRows(dialect: Dialect, columnCount: number, requested = 500): number {
  const byParams = Math.max(1, Math.floor(dialect.maxParams / Math.max(1, columnCount)));
  return Math.max(1, Math.min(requested, byParams, dialect.maxRowsPerStatement));
}
