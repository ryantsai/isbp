import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { core, createdAt, id, updatedAt } from './core';
import { users } from './identity';

export type DbConnectionEngine = 'mssql' | 'postgres' | 'mysql' | 'oracle';
export type DbConnectionPurpose = 'data' | 'admin';

export interface DbConnectionOptions {
  tls?: 'off' | 'require' | 'verify';
  ca?: string | null;
  instanceName?: string | null;
  domain?: string | null;
}

/**
 * External databases the platform connects to (`ctx.databases`). The password is sealed with the master
 * key and never returned. `purposes` limit what modules may use a connection for: `data` (ETL, Data APIs,
 * SQL jobs) and `admin` (database account administration).
 */
export const dbConnections = core.table(
  'db_connections',
  {
    id: id(),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    engine: varchar('engine', { length: 16 }).$type<DbConnectionEngine>().notNull(),
    host: varchar('host', { length: 255 }).notNull(),
    port: integer('port'),
    database: varchar('database', { length: 128 }),
    username: varchar('username', { length: 128 }).notNull(),
    passwordSealed: text('password_sealed'),
    options: jsonb('options').$type<DbConnectionOptions>().notNull().default({}),
    purposes: text('purposes')
      .array()
      .$type<DbConnectionPurpose[]>()
      .notNull()
      .default(sql`'{data}'::text[]`),
    readOnly: boolean('read_only').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    poolMax: integer('pool_max').notNull().default(5),
    timeoutMs: integer('timeout_ms').notNull().default(30_000),
    maxRows: integer('max_rows').notNull().default(10_000),
    status: varchar('status', { length: 16 })
      .$type<'unknown' | 'ok' | 'error'>()
      .notNull()
      .default('unknown'),
    serverVersion: varchar('server_version', { length: 300 }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastLatencyMs: integer('last_latency_ms'),
    lastError: text('last_error'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('db_connections_key_uq').on(t.key),
    check('db_connections_engine_ck', sql`${t.engine} in ('mssql', 'postgres', 'mysql', 'oracle')`),
    check(
      'db_connections_purposes_ck',
      sql`${t.purposes} <@ array['data', 'admin']::text[] and cardinality(${t.purposes}) > 0`,
    ),
  ],
);
