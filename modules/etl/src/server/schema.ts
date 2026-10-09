import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import type { RunProblem } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ColumnInfo,
  ColumnMapping,
  EndpointDefinition,
  RunStatus,
  RunTrigger,
  VersionStatus,
  WriteModeValue,
} from '../model';

/**
 * Tables of the `etl` Postgres schema. Connections live in the kernel (`core.db_connections`); rows keep their
 * id without a foreign key, so a deleted connection leaves the endpoint or pipeline flagged "connection
 * missing" (`core.db-connection.deleted`) instead of silently changing it.
 */
export const etlSchema = pgSchema('etl');

export type RunLogEntry = { at: string; level: 'info' | 'warn' | 'error'; message: string };
export type StaticValue = string | number | boolean | null;

/** A Data API. The draft is edited freely; versions freeze it. Access and rate limit are not versioned. */
export const endpoints = etlSchema.table(
  'endpoints',
  {
    id: id(),
    /** URL segment of `/api/v1/etl/data/<slug>`; fixed once a version is published. */
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    /** The draft's connection (also inside `draft`), for filters and the connection-deleted handler. */
    connectionId: uuid('connection_id').notNull(),
    draft: jsonb('draft').$type<EndpointDefinition>().notNull(),
    /** Hash of the draft definition at its last successful test; publishing needs it to match. */
    draftTestedHash: varchar('draft_tested_hash', { length: 64 }),
    draftTestedAt: timestamp('draft_tested_at', { withTimezone: true }),
    draftColumns: jsonb('draft_columns').$type<ColumnInfo[]>(),
    /** Signed-in people with `etl.endpoints.invoke` (globally or on this endpoint) may call it. */
    allowUsers: boolean('allow_users').notNull().default(true),
    /** `core.api_clients.id` values allowed to call it (they also need `etl.endpoints.invoke`). */
    allowedClients: uuid('allowed_clients')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Per caller and minute; null = the module setting. */
    rateLimitPerMinute: integer('rate_limit_per_minute'),
    latestVersion: integer('latest_version'),
    connectionMissing: boolean('connection_missing').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('endpoints_slug_uq').on(t.slug),
    index('endpoints_name_idx').on(t.name),
    index('endpoints_connection_idx').on(t.connectionId),
    index('endpoints_updated_idx').on(t.updatedAt),
  ],
);

/** An immutable published version: the definition, the result columns captured by its test, a note. */
export const endpointVersions = etlSchema.table(
  'endpoint_versions',
  {
    id: id(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<EndpointDefinition>().notNull(),
    connectionId: uuid('connection_id').notNull(),
    columns: jsonb('columns').$type<ColumnInfo[]>().notNull(),
    note: text('note'),
    status: varchar('status', { length: 16 }).$type<VersionStatus>().notNull().default('published'),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('endpoint_versions_uq').on(t.endpointId, t.version),
    index('endpoint_versions_connection_idx').on(t.connectionId),
  ],
);

/** Execution log of Data API calls (kept `logRetentionDays`). Sensitive parameters are masked. */
export const calls = etlSchema.table(
  'calls',
  {
    id: id(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    version: integer('version'),
    callerType: varchar('caller_type', { length: 8 }).$type<'user' | 'client'>().notNull(),
    userId: uuid('user_id'),
    clientId: uuid('client_id'),
    callerName: varchar('caller_name', { length: 200 }).notNull(),
    status: integer('status').notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    /** The full error (database code and message) — never returned to API clients. */
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms').notNull().default(0),
    rows: integer('rows'),
    cached: boolean('cached').notNull().default(false),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('calls_endpoint_created_idx').on(t.endpointId, t.createdAt.desc()),
    index('calls_created_idx').on(t.createdAt.desc()),
    index('calls_user_idx')
      .on(t.userId)
      .where(sql`${t.userId} is not null`),
    index('calls_client_idx')
      .on(t.clientId)
      .where(sql`${t.clientId} is not null`),
  ],
);

/** An ETL pipeline: source SQL on one connection → a catalog table on another, with column mapping. */
export const pipelines = etlSchema.table(
  'pipelines',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(true),
    sourceConnectionId: uuid('source_connection_id').notNull(),
    sourceSql: text('source_sql').notNull(),
    sourceParams: jsonb('source_params').$type<Record<string, StaticValue>>().notNull().default({}),
    /** Incremental mode: the result column feeding the next `:watermark`, and the first run's value. */
    watermarkColumn: varchar('watermark_column', { length: 128 }),
    watermarkInitial: varchar('watermark_initial', { length: 200 }),
    /** Highest watermark of the last successful run. */
    watermark: varchar('watermark', { length: 200 }),
    targetConnectionId: uuid('target_connection_id').notNull(),
    targetSchema: varchar('target_schema', { length: 128 }),
    targetTable: varchar('target_table', { length: 128 }).notNull(),
    mode: varchar('mode', { length: 16 }).$type<WriteModeValue>().notNull().default('insert'),
    keyColumns: text('key_columns')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    mappings: jsonb('mappings').$type<ColumnMapping[]>().notNull().default([]),
    batchSize: integer('batch_size').notNull().default(500),
    connectionMissing: boolean('connection_missing').notNull().default(false),
    lastRunId: uuid('last_run_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pipelines_name_uq').on(t.name),
    index('pipelines_source_idx').on(t.sourceConnectionId),
    index('pipelines_target_idx').on(t.targetConnectionId),
  ],
);

/** One run of a pipeline (manual or from Scheduled Jobs), with progress counters and a capped log. */
export const pipelineRuns = etlSchema.table(
  'pipeline_runs',
  {
    id: id(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    trigger: varchar('trigger', { length: 16 }).$type<RunTrigger>().notNull(),
    status: varchar('status', { length: 16 }).$type<RunStatus>().notNull().default('queued'),
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
    /** Scheduled Jobs run id (trigger `schedule`). */
    taskRunId: varchar('task_run_id', { length: 64 }),
    /** Scheduled Jobs job id (trigger `schedule`): the pipeline page links to the job that runs it. */
    taskJobId: varchar('task_job_id', { length: 64 }),
    rowsRead: integer('rows_read').notNull().default(0),
    rowsWritten: integer('rows_written').notNull().default(0),
    rowsRejected: integer('rows_rejected').notNull().default(0),
    watermarkFrom: varchar('watermark_from', { length: 200 }),
    watermarkTo: varchar('watermark_to', { length: 200 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    /** Last sign of life of a running run (a crashed worker leaves it stale). */
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    error: text('error'),
    /** Why it failed, as a kind the UI explains in the reader's language (`error` keeps the raw text). */
    problem: jsonb('problem').$type<RunProblem>(),
    log: jsonb('log').$type<RunLogEntry[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    index('pipeline_runs_pipeline_created_idx').on(t.pipelineId, t.createdAt.desc()),
    index('pipeline_runs_status_idx').on(t.status),
    index('pipeline_runs_created_idx').on(t.createdAt.desc()),
  ],
);
