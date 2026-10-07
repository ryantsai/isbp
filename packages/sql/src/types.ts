export const DB_ENGINES = ['mssql', 'postgres', 'mysql', 'oracle'] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

/** A value that can be bound to a `:name` parameter. Arrays bind list parameters (`IN (:ids)`). */
export type SqlScalar = string | number | boolean | bigint | Date | null;
export type SqlValue = SqlScalar | readonly SqlScalar[];

/** Declared type of a parameter; decides how the driver binds it. Untyped values are inferred. */
export const SQL_PARAM_TYPES = [
  'string',
  'integer',
  'decimal',
  'number',
  'boolean',
  'date',
  'datetime',
  'uuid',
] as const;
export type SqlParamType = (typeof SQL_PARAM_TYPES)[number];

export interface ConnectionConfig {
  engine: DbEngine;
  host: string;
  port?: number | null;
  /** Database name; Oracle: service name. */
  database?: string | null;
  user: string;
  password?: string | null;
  options?: ConnectionOptions;
  /** Pool size per process (default 5). */
  poolMax?: number;
  connectTimeoutMs?: number;
  /** Shown in the server's session list (`application_name`, `appName`, `program`). */
  applicationName?: string;
}

export interface ConnectionOptions {
  /** TLS. SQL Server: `encrypt`; PostgreSQL/MySQL: `require` or `verify` (verify the certificate). */
  tls?: 'off' | 'require' | 'verify';
  /** PEM CA bundle used with `verify`. */
  ca?: string | null;
  /** SQL Server named instance. */
  instanceName?: string | null;
  /** SQL Server NTLM domain (Windows authentication with a service account). */
  domain?: string | null;
}

export interface SqlColumn {
  name: string;
  /** Engine type name, lower case (`varchar`, `int4`, `nvarchar`, `number`, …). */
  type: string;
}

export type SqlRow = Record<string, unknown>;

export interface SqlResult {
  columns: SqlColumn[];
  rows: SqlRow[];
  /** More rows existed than `maxRows`. */
  truncated: boolean;
  /** Rows changed by a write statement, when the driver reports it. */
  affected: number | null;
  /** OUT parameters of a procedure call. */
  outputs?: Record<string, unknown>;
  durationMs: number;
}

export interface ExecOptions {
  params?: Record<string, SqlValue | undefined>;
  types?: Record<string, SqlParamType | undefined>;
  /** Default 1000. Rows beyond it are not fetched (`truncated: true`). */
  maxRows?: number;
  /** Default 30 s. The statement is cancelled on the server when it fires. */
  timeoutMs?: number;
  /** Run in a read-only transaction (PostgreSQL, MySQL, Oracle; SQL Server relies on permissions). */
  readOnly?: boolean;
  signal?: AbortSignal;
}

export interface StreamOptions extends Omit<ExecOptions, 'maxRows'> {
  /** Rows per batch (default 500). */
  batchSize?: number;
}

export interface StreamBatch {
  columns: SqlColumn[];
  rows: SqlRow[];
}

export interface ProcedureRef {
  schema?: string | null;
  name: string;
}

export interface CatalogColumn {
  name: string;
  type: string;
  nullable: boolean;
  /** Part of the primary key or a unique key. */
  key: boolean;
}

export interface CatalogTable {
  schema: string;
  name: string;
  kind: 'table' | 'view';
  columns: CatalogColumn[];
}

export interface CatalogParameter {
  name: string;
  type: string;
  direction: 'in' | 'out' | 'inout';
}

export interface CatalogProcedure {
  schema: string;
  name: string;
  kind: 'procedure' | 'function';
  /** A function's return type (lower case; `table` for table-valued functions, `ref cursor` in Oracle). */
  returns: string | null;
  parameters: CatalogParameter[];
}

export interface Catalog {
  /** Default schema of the connection's user (`dbo`, `public`, the Oracle user, the MySQL database). */
  defaultSchema: string;
  schemas: string[];
  tables: CatalogTable[];
  procedures: CatalogProcedure[];
  /** Introspection was capped (very large databases). */
  truncated: boolean;
}

export type WriteMode = 'insert' | 'upsert' | 'replace';

export interface WriterOptions {
  columns: string[];
  mode: WriteMode;
  /** Key columns for `upsert`. */
  keys?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** An open load into one table, inside one transaction. */
export interface TableWriter {
  /** Writes rows (keyed by column name); returns how many were written. */
  write(rows: readonly SqlRow[]): Promise<number>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface ServerInfo {
  version: string;
  latencyMs: number;
}
