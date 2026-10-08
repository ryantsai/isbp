import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import type { AiMessage, AiToolCall } from '@isbp/sdk/server';
import { sql } from 'drizzle-orm';
import {
  bigint,
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
  AiMode,
  ChangeSetStatus,
  CheckResult,
  Confirmation,
  ItemOp,
  ObjectSnapshot,
  PageContext,
} from '../contracts';

/** All tables of this module live in the `assistant` Postgres schema. */
export const assistantSchema = pgSchema('assistant');

/** Change set numbers (`CS-00042`). */
export const changeSetNumberSeq = assistantSchema.sequence('change_set_number_seq', { startWith: 1 });

export interface LastError {
  code: string;
  message: string;
  details?: unknown;
  at: string;
}

/**
 * Drafts of configuration changes. Created by a person (panel, template) or an API client (MCP); applied in one
 * transaction by a person who holds every kind's apply permission, or by the approver of its review.
 */
export const changeSets = assistantSchema.table(
  'change_sets',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('assistant.change_set_number_seq')`),
    title: varchar('title', { length: 200 }).notNull(),
    summary: text('summary').notNull().default(''),
    status: varchar('status', { length: 20 }).$type<ChangeSetStatus>().notNull().default('draft'),
    /** A person, or an API client (`created_by_type = 'service'`, `created_by_id` = the client's id). */
    createdByType: varchar('created_by_type', { length: 10 }).$type<'user' | 'service'>().notNull(),
    createdById: uuid('created_by_id'),
    createdByName: varchar('created_by_name', { length: 200 }).notNull(),
    conversationId: uuid('conversation_id'),
    /** The review (workflow instance), while one runs or after it decided. */
    workflowInstanceId: uuid('workflow_instance_id'),
    reviewRequestedAt: timestamp('review_requested_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    appliedById: uuid('applied_by_id').references(() => users.id, { onDelete: 'set null' }),
    appliedByName: varchar('applied_by_name', { length: 200 }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    rolledBackById: uuid('rolled_back_by_id').references(() => users.id, { onDelete: 'set null' }),
    rolledBackByName: varchar('rolled_back_by_name', { length: 200 }),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
    lastError: jsonb('last_error').$type<LastError>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('change_sets_number_uq').on(t.number),
    index('change_sets_creator_idx').on(t.createdById, t.updatedAt.desc()),
    index('change_sets_status_idx').on(t.status, t.updatedAt.desc()),
    index('change_sets_instance_idx').on(t.workflowInstanceId),
  ],
);

/** One proposed change: a kind, an operation, the target and the value, with its latest dry run. */
export const changeSetItems = assistantSchema.table(
  'change_set_items',
  {
    id: id(),
    changeSetId: uuid('change_set_id')
      .notNull()
      .references(() => changeSets.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** Name other items reference with `"$ref:<ref>"`. */
    ref: varchar('ref', { length: 40 }),
    kind: varchar('kind', { length: 100 }).notNull(),
    op: varchar('op', { length: 10 }).$type<ItemOp>().notNull(),
    targetId: varchar('target_id', { length: 200 }),
    label: varchar('label', { length: 200 }).notNull(),
    value: jsonb('value').$type<unknown>(),
    note: text('note'),
    /** Version of the target when proposed (or refreshed); applying refuses when it moved. */
    baseVersion: varchar('base_version', { length: 64 }),
    check: jsonb('check').$type<CheckResult>(),
    appliedId: varchar('applied_id', { length: 200 }),
    before: jsonb('before').$type<ObjectSnapshot>(),
    after: jsonb('after').$type<ObjectSnapshot>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('change_set_items_position_uq').on(t.changeSetId, t.position),
    uniqueIndex('change_set_items_ref_uq')
      .on(t.changeSetId, t.ref)
      .where(sql`${t.ref} is not null`),
  ],
);

/** A conversation with the assistant; it builds at most one open change set at a time. */
export const conversations = assistantSchema.table(
  'conversations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull().default(''),
    changeSetId: uuid('change_set_id').references(() => changeSets.id, { onDelete: 'set null' }),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assistant_conversations_user_idx').on(t.userId, t.updatedAt.desc())],
);

/**
 * Turns, stored so they convert back to `AiMessage[]` (assistant turns keep the provider's native content, tool turns
 * the call they answer). User turns keep the page the person was on.
 */
export const messages = assistantSchema.table(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: varchar('role', { length: 10 }).$type<'user' | 'assistant' | 'tool'>().notNull(),
    content: text('content').notNull().default(''),
    page: jsonb('page').$type<PageContext>(),
    native: jsonb('native').$type<NonNullable<AiMessage['native']>>(),
    toolCalls: jsonb('tool_calls').$type<AiToolCall[]>(),
    toolCallId: varchar('tool_call_id', { length: 200 }),
    toolName: varchar('tool_name', { length: 150 }),
    /** A destructive tool call waiting for (or decided by) the person: tool turns only. */
    confirmation: jsonb('confirmation').$type<Confirmation>(),
    isError: boolean('is_error').notNull().default(false),
    mode: varchar('mode', { length: 10 }).$type<AiMode>(),
    model: varchar('model', { length: 150 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('assistant_messages_conversation_seq_uq').on(t.conversationId, t.seq)],
);

export type ChangeSetRow = typeof changeSets.$inferSelect;
export type ChangeSetItemRow = typeof changeSetItems.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
