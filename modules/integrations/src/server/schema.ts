import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import type { FieldMapping } from '../contracts';
import type { Snapshot } from '../merge';
import type {
  ConflictPolicy,
  ConflictStatus,
  Direction,
  FieldType,
  FilterCondition,
  Health,
  Label,
  LinkOrigin,
  LinkState,
  LogEntry,
  RunCounts,
  RunKind,
  RunStatus,
  RunTrigger,
} from '../model';

/**
 * All tables of the hub live in the `integrations` Postgres schema. Remote ids exist only here: data modules
 * keep none, so a record can be linked to several systems and unlinking touches nothing else.
 */
export const integrationsSchema = pgSchema('integrations');

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const connections = integrationsSchema.table(
  'connections',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    /** `<module>.<type>` of the connector. */
    type: varchar('type', { length: 100 }).notNull(),
    /** Non-secret settings, as the connector's `config` schema parsed them. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** The secrets object, JSON, sealed with `ctx.secrets` (never returned). */
    secretsSealed: text('secrets_sealed'),
    /** Keys of the stored secrets (what the API may say about them). */
    secretKeys: text('secret_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** SHA-256 (hex) of the webhook secret; the secret itself is shown once. */
    webhookSecretHash: varchar('webhook_secret_hash', { length: 64 }),
    webhookRotatedAt: ts('webhook_rotated_at'),
    enabled: boolean('enabled').notNull().default(true),
    /**
     * The explicit "Allow insecure HTTP" switch (on-premises servers without TLS). Off: the connector's HTTP
     * client refuses `http://` (except loopback) with 422 `INSECURE_HTTP`.
     */
    allowInsecureHttp: boolean('allow_insecure_http').notNull().default(false),
    health: varchar('health', { length: 16 }).$type<Health>().notNull().default('unknown'),
    healthMessage: text('health_message'),
    /** Who/where the last successful test signed in ("Contoso portal as svc-isbp"). */
    account: varchar('account', { length: 300 }),
    lastCheckedAt: ts('last_checked_at'),
    /** Integration admins were told it is failing (reset when it works again). */
    failingNotifiedAt: ts('failing_notified_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('connections_name_uq').on(sql`lower(${t.name})`),
    index('connections_type_idx').on(t.type),
    check('connections_health_ck', sql`${t.health} in ('unknown', 'ok', 'failing')`),
  ],
);

export const profiles = integrationsSchema.table(
  'profiles',
  {
    id: id(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    /** The connector's object type (`request`, `work-item`). */
    objectType: varchar('object_type', { length: 64 }).notNull(),
    remoteScope: varchar('remote_scope', { length: 300 }),
    remoteScopeName: varchar('remote_scope_name', { length: 300 }),
    /** `<module>.<entity>` of the sync adapter. */
    entity: varchar('entity', { length: 100 }).notNull(),
    containerId: varchar('container_id', { length: 200 }),
    containerLabel: varchar('container_label', { length: 300 }),
    direction: varchar('direction', { length: 8 }).$type<Direction>().notNull().default('pull'),
    createLocal: boolean('create_local').notNull().default(true),
    createRemote: boolean('create_remote').notNull().default(false),
    matchRule: jsonb('match_rule').$type<{ local: string; remote: string } | null>(),
    pushFilter: jsonb('push_filter').$type<FilterCondition[]>().notNull().default([]),
    mappings: jsonb('mappings').$type<FieldMapping[]>().notNull().default([]),
    conflictPolicy: varchar('conflict_policy', { length: 8 })
      .$type<ConflictPolicy>()
      .notNull()
      .default('manual'),
    comments: boolean('comments').notNull().default(false),
    intervalMinutes: integer('interval_minutes').notNull().default(15),
    enabled: boolean('enabled').notNull().default(true),
    /** The change feed's opaque cursor: advanced only past fully handled records. */
    cursor: text('cursor'),
    /** When the minute tick starts the next scheduled pull. */
    nextRunAt: ts('next_run_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('profiles_connection_idx').on(t.connectionId),
    index('profiles_entity_idx').on(t.entity),
    index('profiles_due_idx')
      .on(t.nextRunAt)
      .where(sql`${t.enabled} and ${t.intervalMinutes} > 0`),
    check('profiles_direction_ck', sql`${t.direction} in ('pull', 'push', 'both')`),
    check('profiles_policy_ck', sql`${t.conflictPolicy} in ('manual', 'remote', 'local', 'newest')`),
  ],
);

export const links = integrationsSchema.table(
  'links',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    entity: varchar('entity', { length: 100 }).notNull(),
    /** Null while creating the local record failed (the run retries it). */
    localId: varchar('local_id', { length: 200 }),
    localRef: varchar('local_ref', { length: 100 }),
    localTitle: varchar('local_title', { length: 500 }),
    remoteId: varchar('remote_id', { length: 200 }).notNull(),
    remoteRef: varchar('remote_ref', { length: 200 }),
    remoteTitle: varchar('remote_title', { length: 500 }),
    remoteUrl: text('remote_url'),
    remoteVersion: varchar('remote_version', { length: 200 }),
    remoteUpdatedAt: ts('remote_updated_at'),
    origin: varchar('origin', { length: 8 }).$type<LinkOrigin>().notNull(),
    /** The last agreed value of every mapped field, in local and remote form. */
    snapshot: jsonb('snapshot').$type<Snapshot>().notNull().default({}),
    state: varchar('state', { length: 12 }).$type<LinkState>().notNull().default('ok'),
    lastError: jsonb('last_error').$type<{ code: string; message: string; details?: unknown } | null>(),
    lastSyncedAt: ts('last_synced_at'),
    /** Bumped on every change: commits check it (optimistic concurrency between pull, push and people). */
    rev: integer('rev').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('links_profile_remote_uq').on(t.profileId, t.remoteId),
    uniqueIndex('links_profile_local_uq').on(t.profileId, t.localId),
    index('links_record_idx').on(t.entity, t.localId),
    index('links_connection_state_idx').on(t.connectionId, t.state),
    index('links_profile_state_idx').on(t.profileId, t.state),
    index('links_connection_remote_idx').on(t.connectionId, t.entity, t.remoteId),
    index('links_synced_idx').on(t.connectionId, t.lastSyncedAt),
    check('links_state_ck', sql`${t.state} in ('ok', 'conflict', 'error', 'orphaned')`),
  ],
);

export const commentLinks = integrationsSchema.table(
  'comment_links',
  {
    id: id(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    localId: varchar('local_id', { length: 200 }).notNull(),
    remoteId: varchar('remote_id', { length: 200 }).notNull(),
    /** Where the comment was written first. */
    origin: varchar('origin', { length: 8 }).$type<'local' | 'remote'>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('comment_links_local_uq').on(t.linkId, t.localId),
    uniqueIndex('comment_links_remote_uq').on(t.linkId, t.remoteId),
  ],
);

export const runs = integrationsSchema.table(
  'runs',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 12 }).$type<RunKind>().notNull(),
    trigger: varchar('trigger', { length: 12 }).$type<RunTrigger>().notNull(),
    status: varchar('status', { length: 12 }).$type<RunStatus>().notNull().default('queued'),
    /** What the run works on: webhook items, link ids. */
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    counts: jsonb('counts').$type<RunCounts>().notNull(),
    log: jsonb('log').$type<LogEntry[]>().notNull().default([]),
    logDropped: integer('log_dropped').notNull().default(0),
    error: text('error'),
    errorCode: varchar('error_code', { length: 64 }),
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
    /** A rate-limited run continues then. */
    resumeAt: ts('resume_at'),
    startedAt: ts('started_at'),
    heartbeatAt: ts('heartbeat_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('runs_profile_created_idx').on(t.profileId, t.createdAt),
    index('runs_connection_created_idx').on(t.connectionId, t.createdAt),
    index('runs_created_idx').on(t.createdAt),
    index('runs_active_idx')
      .on(t.status)
      .where(sql`${t.status} in ('queued', 'running', 'waiting')`),
    /** One pull or export per profile at a time. */
    uniqueIndex('runs_one_sync_uq')
      .on(t.profileId)
      .where(sql`${t.status} in ('queued', 'running', 'waiting') and ${t.kind} in ('pull', 'export')`),
    check(
      'runs_status_ck',
      sql`${t.status} in ('queued', 'running', 'waiting', 'succeeded', 'partial', 'failed')`,
    ),
  ],
);

/** Local changes waiting to be pushed (batched per profile by the `push` job). */
export const pendingPushes = integrationsSchema.table(
  'pending_pushes',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    localId: varchar('local_id', { length: 200 }).notNull(),
    kind: varchar('kind', { length: 8 }).$type<'record' | 'comment'>().notNull(),
    queuedAt: ts('queued_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pending_pushes_uq').on(t.profileId, t.localId, t.kind),
    index('pending_pushes_queued_idx').on(t.queuedAt),
  ],
);

export interface ConflictFieldRow {
  field: string;
  remoteField: string;
  label: Label;
  type: FieldType;
  base: unknown;
  local: unknown;
  /** The remote value in ISBP's form (what choosing "remote" writes). */
  remote: unknown;
}

export const conflicts = integrationsSchema.table(
  'conflicts',
  {
    id: id(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    entity: varchar('entity', { length: 100 }).notNull(),
    localId: varchar('local_id', { length: 200 }).notNull(),
    remoteRef: varchar('remote_ref', { length: 200 }),
    status: varchar('status', { length: 12 }).$type<ConflictStatus>().notNull().default('open'),
    fields: jsonb('fields').$type<ConflictFieldRow[]>().notNull(),
    choices: jsonb('choices').$type<Record<string, 'local' | 'remote'> | null>(),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('conflicts_open_uq')
      .on(t.linkId)
      .where(sql`${t.status} = 'open'`),
    index('conflicts_connection_status_idx').on(t.connectionId, t.status, t.createdAt),
    index('conflicts_profile_status_idx').on(t.profileId, t.status),
    index('conflicts_status_created_idx').on(t.status, t.createdAt),
    check('conflicts_status_ck', sql`${t.status} in ('open', 'resolved', 'dismissed')`),
  ],
);
