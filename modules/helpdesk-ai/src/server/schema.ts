import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import type { AiMessage, AiToolCall } from '@isbp/sdk/server';
import { sql } from 'drizzle-orm';
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
  ChatImageRef,
  Citation,
  ConversationStatus,
  InsightFeedbackRecord,
  InsightKind,
  InsightStatus,
  PublishedAccess,
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

/**
 * Ask IT published outside the platform (§16.6): a chat link and a widget other websites embed, for signed-in
 * people or for anyone (then only public articles of the chosen categories, and no tickets).
 */
export const publishedChats = helpdeskAiSchema.table(
  'published_chats',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    /** The public part of the link (`/p/helpdesk-ai/chat/<token>`); a new one breaks old links and embeds. */
    token: varchar('token', { length: 64 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    access: varchar('access', { length: 20 }).$type<PublishedAccess>().notNull().default('signed_in'),
    /** Websites (origins) that may embed it; empty: it opens only as a link. */
    allowedOrigins: text('allowed_origins')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** For anyone: the knowledge categories it answers from (empty: every public article). */
    categoryIds: uuid('category_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Shown at the top of the chat (empty: "Ask IT"). */
    title: varchar('title', { length: 120 }).notNull().default(''),
    /** The greeting under the title (empty: the standard one). */
    welcome: text('welcome').notNull().default(''),
    /** How long a visitor's session lasts. */
    sessionMinutes: integer('session_minutes').notNull().default(240),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('published_chats_token_uq').on(t.token)],
);

/** A virtual-agent conversation ("Ask IT"). */
export const conversations = helpdeskAiSchema.table(
  'conversations',
  {
    id: id(),
    /** Null for a visitor of a chat published for anyone (`visitorId`). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** The published chat it was held in (null: in the platform). */
    channelId: uuid('channel_id').references(() => publishedChats.id, { onDelete: 'set null' }),
    /** The visitor's session identity in a chat published for anyone. */
    visitorId: varchar('visitor_id', { length: 64 }),
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
    index('conversations_channel_idx').on(t.channelId, t.createdAt),
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
    /** User turns: screenshots attached to the question (files on the conversation) and what they show. */
    images: jsonb('images').$type<ChatImageRef[]>(),
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
export type PublishedChatRow = typeof publishedChats.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
