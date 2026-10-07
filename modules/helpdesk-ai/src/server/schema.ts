import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import type { AiMessage, AiToolCall } from '@isbp/sdk/server';
import {
  boolean,
  doublePrecision,
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
  Citation,
  ConversationStatus,
  InsightFeedbackRecord,
  InsightKind,
  InsightStatus,
  TicketProposal,
} from '../contracts';

/** All tables of this module live in the `helpdesk_ai` Postgres schema. */
export const helpdeskAiSchema = pgSchema('helpdesk_ai');

/**
 * What the AI produced for a ticket (triage suggestion, cached summary, generated KB draft) and what the
 * agents did with it. Tickets belong to ITSM, so `ticket_id` has no foreign key. One row per ticket and
 * kind: re-running replaces it.
 */
export const insights = helpdeskAiSchema.table(
  'insights',
  {
    id: id(),
    ticketId: uuid('ticket_id').notNull(),
    ticketRef: varchar('ticket_ref', { length: 40 }).notNull(),
    kind: varchar('kind', { length: 20 }).$type<InsightKind>().notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    confidence: doublePrecision('confidence'),
    mode: varchar('mode', { length: 10 }).$type<AiMode>().notNull(),
    model: varchar('model', { length: 150 }),
    status: varchar('status', { length: 20 }).$type<InsightStatus>().notNull().default('suggested'),
    feedback: jsonb('feedback').$type<InsightFeedbackRecord>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('insights_ticket_kind_uq').on(t.ticketId, t.kind),
    index('insights_kind_created_idx').on(t.kind, t.createdAt),
  ],
);

/** A virtual-agent conversation ("Ask IT"). */
export const conversations = helpdeskAiSchema.table(
  'conversations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull().default(''),
    locale: varchar('locale', { length: 10 }).notNull().default('en'),
    status: varchar('status', { length: 20 }).$type<ConversationStatus>().notNull().default('open'),
    /** The ticket raised from the conversation (after the user confirmed the proposal). */
    ticketId: uuid('ticket_id'),
    ticketRef: varchar('ticket_ref', { length: 40 }),
    /** "That solved it": answered without a ticket. */
    deflected: boolean('deflected').notNull().default(false),
    /** Mode of the latest answer. */
    mode: varchar('mode', { length: 10 }).$type<AiMode>().notNull().default('builtin'),
    messageCount: integer('message_count').notNull().default(0),
    /** When it was resolved or escalated. */
    outcomeAt: timestamp('outcome_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userId, t.updatedAt.desc()),
    index('conversations_created_idx').on(t.createdAt),
    index('conversations_status_idx').on(t.status, t.updatedAt.desc()),
  ],
);

/**
 * Conversation turns, stored so they convert back to `AiMessage[]`: assistant turns keep the provider's
 * native content (append-only replay on the same model), tool turns keep the call they answer.
 */
export const messages = helpdeskAiSchema.table(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Order within the conversation. */
    seq: integer('seq').notNull(),
    role: varchar('role', { length: 10 }).$type<'user' | 'assistant' | 'tool'>().notNull(),
    content: text('content').notNull().default(''),
    citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
    /** Ticket proposal shown with this answer. */
    proposal: jsonb('proposal').$type<TicketProposal>(),
    native: jsonb('native').$type<NonNullable<AiMessage['native']>>(),
    toolCalls: jsonb('tool_calls').$type<AiToolCall[]>(),
    /** Tool turns: the call this result answers. */
    toolCallId: varchar('tool_call_id', { length: 200 }),
    isError: boolean('is_error').notNull().default(false),
    mode: varchar('mode', { length: 10 }).$type<AiMode>(),
    model: varchar('model', { length: 150 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('messages_conversation_seq_uq').on(t.conversationId, t.seq)],
);

export type InsightRow = typeof insights.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
