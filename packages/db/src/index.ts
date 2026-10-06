import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export * from './migrator';

export type Database = ReturnType<typeof createDb>['db'];

export interface DbOptions {
  /** Max pool size per process (default 10). */
  max?: number;
  applicationName?: string;
  statementTimeoutMs?: number;
}

export function createDb(connectionString: string, options: DbOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'isbp',
    statement_timeout: options.statementTimeoutMs ?? 30_000,
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle({ client: pool });
  return { pool, db };
}

export { pg };
