import { SqlError } from './errors';
import type { DbEngine, SqlParamType, SqlScalar, SqlValue } from './types';

/** A piece of SQL text, or a `:name` placeholder. */
export type SqlToken = { text: string } | { param: string };

/** Lexical segment: code, a literal (string, quoted identifier, dollar quote), a comment, or a placeholder. */
export interface SqlSegment {
  kind: 'code' | 'literal' | 'comment' | 'param';
  text: string;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT = /[A-Za-z0-9_]/;
export const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const Q_CLOSE: Record<string, string> = { '[': ']', '(': ')', '{': '}', '<': '>' };

/**
 * Splits SQL into segments. Strings, quoted identifiers, comments, dollar quotes, Oracle q-quotes,
 * PostgreSQL `::` casts and PL/SQL `:=` are never placeholders; `:name` elsewhere is.
 */
export function scan(sql: string, engine: DbEngine): SqlSegment[] {
  const out: SqlSegment[] = [];
  const n = sql.length;
  let i = 0;
  const push = (kind: SqlSegment['kind'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind !== 'param') last.text += text;
    else out.push({ kind, text });
  };
  /** Index after the closing `end`; doubled quotes and (optionally) backslashes escape. */
  const closing = (end: string, from: number, backslash = false): number => {
    let j = from;
    while (j < n) {
      const c = sql[j]!;
      if (backslash && c === '\\') {
        j += 2;
        continue;
      }
      if (c === end) {
        if (sql[j + 1] === end) {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j++;
    }
    return n;
  };
  const take = (kind: SqlSegment['kind'], stop: number) => {
    push(kind, sql.slice(i, stop));
    i = stop;
  };

  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    const prev = sql[i - 1] ?? '';
    if ((c === '-' && next === '-') || (c === '#' && engine === 'mysql')) {
      const end = sql.indexOf('\n', i);
      take('comment', end === -1 ? n : end);
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      take('comment', end === -1 ? n : end + 2);
    } else if ((c === 'q' || c === 'Q') && next === "'" && engine === 'oracle' && !IDENT.test(prev)) {
      const open = sql[i + 2] ?? '';
      const end = sql.indexOf(`${Q_CLOSE[open] ?? open}'`, i + 3);
      take('literal', end === -1 ? n : end + 2);
    } else if (c === "'") {
      const backslash =
        engine === 'mysql' ||
        (engine === 'postgres' && (prev === 'E' || prev === 'e') && !IDENT.test(sql[i - 2] ?? ''));
      take('literal', closing("'", i + 1, backslash));
    } else if (c === '"') {
      take('literal', closing('"', i + 1, engine === 'mysql'));
    } else if (c === '`' && engine === 'mysql') {
      take('literal', closing('`', i + 1));
    } else if (c === '[' && engine === 'mssql') {
      take('literal', closing(']', i + 1));
    } else if (
      c === '$' &&
      engine === 'postgres' &&
      !IDENT.test(prev) &&
      /^\$([A-Za-z_]\w*)?\$/.test(sql.slice(i, i + 65))
    ) {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 65))![0];
      const end = sql.indexOf(tag, i + tag.length);
      take('literal', end === -1 ? n : end + tag.length);
    } else if (c === ':' && next === ':') {
      take('code', i + 2); // PostgreSQL cast
    } else if (c === ':' && next && IDENT_START.test(next) && !IDENT.test(prev)) {
      let j = i + 1;
      while (j < n && IDENT.test(sql[j]!)) j++;
      push('param', sql.slice(i + 1, j));
      i = j;
    } else {
      take('code', i + 1);
    }
  }
  return out;
}

/** Text and placeholders only (comments and literals are kept as text). */
export function tokenize(sql: string, engine: DbEngine): SqlToken[] {
  const tokens: SqlToken[] = [];
  for (const s of scan(sql, engine)) {
    if (s.kind === 'param') tokens.push({ param: s.text });
    else {
      const last = tokens[tokens.length - 1];
      if (last && 'text' in last) last.text += s.text;
      else tokens.push({ text: s.text });
    }
  }
  return tokens;
}

/** Distinct parameter names in order of first use. */
export function parameterNames(sql: string, engine: DbEngine): string[] {
  const seen = new Set<string>();
  for (const s of scan(sql, engine)) if (s.kind === 'param') seen.add(s.text);
  return [...seen];
}

const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|upsert|truncate|drop|alter|create|grant|revoke|exec|execute|call|into|commit|rollback)\b/gi;

/**
 * Statement keywords that change data or schema, found outside strings and comments ("query" endpoints
 * that contain them need an explicit "allows writes"). A lint, not a security boundary: read-only
 * connections and transactions are the boundary.
 */
export function writeKeywords(sql: string, engine: DbEngine): string[] {
  const found = new Set<string>();
  for (const s of scan(sql, engine)) {
    if (s.kind !== 'code') continue;
    for (const m of s.text.matchAll(WRITE_KEYWORDS)) found.add(m[1]!.toUpperCase());
  }
  return [...found];
}

/** Number of statements (top-level `;` outside literals and comments, ignoring a trailing one). */
export function statementCount(sql: string, engine: DbEngine): number {
  let count = 1;
  const code = scan(sql, engine)
    .filter((s) => s.kind === 'code' || s.kind === 'param')
    .map((s) => (s.kind === 'param' ? ' ' : s.text))
    .join('');
  const trimmed = code.trim().replace(/;\s*$/, '');
  for (const ch of trimmed) if (ch === ';') count++;
  return count;
}

export interface MssqlBind {
  name: string;
  type: SqlParamType | null;
  value: SqlScalar;
}

export interface OracleBind {
  val: SqlScalar;
  type: SqlParamType | null;
}

export type BoundStatement =
  | { engine: 'postgres'; text: string; values: SqlScalar[]; types: (SqlParamType | null)[] }
  | { engine: 'mysql'; text: string; values: SqlScalar[]; types: (SqlParamType | null)[] }
  | { engine: 'mssql'; text: string; binds: MssqlBind[] }
  | { engine: 'oracle'; text: string; binds: Record<string, OracleBind> };

/** Bind `:name` placeholders to driver placeholders; values never enter the SQL text. */
export function bindStatement(
  engine: DbEngine,
  sql: string,
  values: Record<string, SqlValue | undefined> = {},
  types: Record<string, SqlParamType | undefined> = {},
): BoundStatement {
  const tokens = tokenize(sql, engine);
  let text = '';
  const positional: SqlScalar[] = [];
  const positionalTypes: (SqlParamType | null)[] = [];
  const mssql: MssqlBind[] = [];
  const oracle: Record<string, OracleBind> = {};
  // A parameter used twice binds once (PostgreSQL `$n` and SQL Server `@name` can repeat).
  const pgIndex = new Map<string, number>();
  const mssqlNames = new Set<string>();
  const oracleNames = new Map<string, string>();

  const placeholder = (name: string, key: string, value: SqlScalar, type: SqlParamType | null): string => {
    switch (engine) {
      case 'postgres': {
        let idx = pgIndex.get(key);
        if (idx === undefined) {
          positional.push(value);
          positionalTypes.push(type);
          idx = positional.length;
          pgIndex.set(key, idx);
        }
        return `$${idx}`;
      }
      case 'mysql':
        positional.push(value);
        positionalTypes.push(type);
        return '?';
      case 'mssql': {
        const bindName = `p_${key}`;
        if (!mssqlNames.has(bindName)) {
          mssqlNames.add(bindName);
          mssql.push({ name: bindName, type, value });
        }
        return `@${bindName}`;
      }
      case 'oracle': {
        // Oracle forbids reserved words as bind names: use b<n>.
        let bindName = oracleNames.get(key);
        if (!bindName) {
          bindName = `b${oracleNames.size + 1}`;
          oracleNames.set(key, bindName);
          oracle[bindName] = { val: value, type };
        }
        return `:${bindName}`;
      }
    }
  };

  for (const t of tokens) {
    if ('text' in t) {
      text += t.text;
      continue;
    }
    const name = t.param;
    if (!PARAM_NAME_RE.test(name)) throw new SqlError('parameter', `Invalid parameter name :${name}`);
    if (!(name in values) || values[name] === undefined)
      throw new SqlError('parameter', `No value for parameter :${name}`);
    const value = values[name]!;
    const type = types[name] ?? null;
    if (Array.isArray(value)) {
      const list = value as readonly SqlScalar[];
      if (list.length > 1_000) throw new SqlError('parameter', `Too many values for :${name} (max 1000)`);
      if (!list.length) {
        text += 'NULL';
        continue;
      }
      text += list.map((v, i) => placeholder(name, `${name}_${i}`, coerce(v, type), type)).join(', ');
    } else {
      text += placeholder(name, name, coerce(value as SqlScalar, type), type);
    }
  }
  switch (engine) {
    case 'postgres':
    case 'mysql':
      return { engine, text, values: positional, types: positionalTypes };
    case 'mssql':
      return { engine, text, binds: mssql };
    case 'oracle':
      return { engine, text, binds: oracle };
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalises a value for its declared type (dates from ISO strings, booleans from 'true'/'1'). */
export function coerce(value: SqlScalar, type: SqlParamType | null): SqlScalar {
  if (value === null || type === null) return value;
  switch (type) {
    case 'string':
    case 'uuid':
      return typeof value === 'string' ? value : String(value);
    case 'integer':
      if (typeof value === 'bigint') return value;
      if (typeof value === 'number' && Number.isInteger(value)) return value;
      if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        const n = Number(value);
        return Number.isSafeInteger(n) ? n : BigInt(value.trim());
      }
      throw new SqlError('parameter', `Not an integer: ${String(value)}`);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new SqlError('parameter', `Not a number: ${String(value)}`);
      return n;
    }
    case 'decimal':
      if (typeof value === 'number' || typeof value === 'bigint') return String(value);
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
      throw new SqlError('parameter', `Not a decimal: ${String(value)}`);
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === '1' || value === 'true') return true;
      if (value === 0 || value === '0' || value === 'false') return false;
      throw new SqlError('parameter', `Not a boolean: ${String(value)}`);
    case 'date':
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      if (typeof value === 'string' && ISO_DATE.test(value)) return value;
      throw new SqlError('parameter', `Not a date (YYYY-MM-DD): ${String(value)}`);
    case 'datetime': {
      const d = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new SqlError('parameter', `Not a date-time: ${String(value)}`);
      return d;
    }
  }
  return value;
}
