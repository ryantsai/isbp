import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { core, createdAt, updatedAt } from './core';

/** Installed modules and their runtime enabled flag. */
export const modules = core.table('modules', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  version: varchar('version', { length: 32 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  system: boolean('system').notNull().default(false),
  /** Last synced (serialized) manifest — what the admin UI shows. */
  manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
  installedAt: createdAt(),
  updatedAt: updatedAt(),
  enabledChangedAt: timestamp('enabled_changed_at', { withTimezone: true }),
  enabledChangedBy: uuid('enabled_changed_by'),
});

export const moduleSettings = core.table(
  'module_settings',
  {
    moduleId: varchar('module_id', { length: 64 })
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 200 }).notNull(),
    value: jsonb('value').$type<unknown>(),
    updatedBy: uuid('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.moduleId, t.key] })],
);

/**
 * Append-only audit trail. UPDATE/DELETE/TRUNCATE are rejected by a trigger (see migration
 * `0002_audit_immutable`). `hash` is SHA-256 over the canonical row for tamper evidence.
 * No foreign keys on purpose: history must outlive the entities it describes.
 */
export const auditLogs = core.table(
  'audit_logs',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid('event_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: varchar('actor_type', { length: 20 }).notNull(),
    actorId: uuid('actor_id'),
    actorName: varchar('actor_name', { length: 200 }),
    onBehalfOfId: uuid('on_behalf_of_id'),
    action: varchar('action', { length: 200 }).notNull(),
    category: varchar('category', { length: 20 }).notNull().default('data'),
    moduleId: varchar('module_id', { length: 64 }),
    entityType: varchar('entity_type', { length: 100 }),
    entityId: varchar('entity_id', { length: 200 }),
    entityLabel: varchar('entity_label', { length: 300 }),
    changes: jsonb('changes').$type<Record<string, [unknown, unknown]>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    outcome: varchar('outcome', { length: 20 }).notNull().default('success'),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 64 }),
    traceId: varchar('trace_id', { length: 64 }),
    hash: varchar('hash', { length: 64 }).notNull(),
  },
  (t) => [
    uniqueIndex('audit_logs_event_uq').on(t.eventId),
    index('audit_logs_occurred_idx').on(t.occurredAt.desc()),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorId, t.occurredAt.desc()),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_module_idx').on(t.moduleId),
  ],
);

/** Transactional outbox: rows are inserted with the business change and relayed by the worker. */
export const outboxEvents = core.table(
  'outbox_events',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid('event_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    moduleId: varchar('module_id', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    actor: jsonb('actor').$type<Record<string, unknown> | null>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('outbox_events_event_uq').on(t.eventId),
    index('outbox_events_pending_idx')
      .on(t.seq)
      .where(sql`${t.dispatchedAt} is null`),
  ],
);
