import type { LocalizedText, ResourceScope } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { core, createdAt, id, updatedAt } from './core';
import { users } from './identity';

/**
 * One row per AI gateway call (chat, embedding batch or tool invocation): who, which feature, which
 * model, tokens, estimated cost and outcome. Append-only; feeds Administration → AI → Usage.
 */
export const aiUsage = core.table(
  'ai_usage',
  {
    id: id(),
    moduleId: varchar('module_id', { length: 64 }).notNull(),
    feature: varchar('feature', { length: 120 }).notNull(),
    kind: varchar('kind', { length: 20 }).$type<'chat' | 'embed' | 'tool' | 'rerank'>().notNull(),
    principalType: varchar('principal_type', { length: 20 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    principalName: varchar('principal_name', { length: 200 }),
    provider: varchar('provider', { length: 40 }).notNull(),
    model: varchar('model', { length: 150 }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms'),
    status: varchar('status', { length: 20 }).$type<'ok' | 'error' | 'refused' | 'blocked'>().notNull(),
    error: varchar('error', { length: 300 }),
    /** How many values masking replaced before the call left the platform. */
    masked: integer('masked').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_usage_created_idx').on(t.createdAt.desc()),
    index('ai_usage_feature_idx').on(t.feature, t.createdAt.desc()),
  ],
);

/**
 * The shared semantic index. Modules upsert documents (`knowledge.article`, `itsm.ticket`, …); the kernel
 * chunks and embeds them. The `embedding` column is added by a custom migration: `vector` (pgvector, HNSW)
 * when the extension is available, `real[]` otherwise — it is read and written with raw SQL only.
 * Every chunk carries the ACL its document had, so search can filter by the caller's permissions.
 */
export const aiChunks = core.table(
  'ai_chunks',
  {
    id: id(),
    sourceType: varchar('source_type', { length: 64 }).notNull(),
    sourceId: varchar('source_id', { length: 64 }).notNull(),
    chunkNo: integer('chunk_no').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    content: text('content').notNull(),
    locale: varchar('locale', { length: 10 }),
    href: varchar('href', { length: 500 }),
    aclPermission: varchar('acl_permission', { length: 150 }).notNull(),
    aclScope: jsonb('acl_scope').$type<ResourceScope>(),
    aclUsers: uuid('acl_users').array(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /** Embedding model that produced the vector (re-embedded when it changes). */
    model: varchar('model', { length: 150 }).notNull(),
    dims: integer('dims').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    /** Keyword-search terms of the chunk (title included), made by the app's tokenizer (`kernel/ai/terms.ts`). */
    terms: text('terms')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Terms of the title alone (a title match counts double). */
    titleTerms: text('title_terms')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Tokenizer version that made `terms`; older chunks are re-derived by the reindex job. */
    termsVersion: smallint('terms_version').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ai_chunks_source_uq').on(t.sourceType, t.sourceId, t.chunkNo),
    index('ai_chunks_type_idx').on(t.sourceType, t.model),
    index('ai_chunks_terms_idx').using('gin', t.terms),
    index('ai_chunks_terms_version_idx').on(t.termsVersion),
    index('ai_chunks_metadata_idx').using('gin', t.metadata),
  ],
);

export type PortalItemState = 'open' | 'closed';

/**
 * Request registry: module records listed under "My requests" (e.g. incidents someone reported),
 * maintained by modules through `ctx.portal.track()`.
 */
export const portalItems = core.table(
  'portal_items',
  {
    kind: varchar('kind', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    moduleId: varchar('module_id', { length: 64 }).notNull(),
    reference: varchar('reference', { length: 40 }).notNull(),
    title: jsonb('title').$type<string | LocalizedText>().notNull(),
    state: varchar('state', { length: 10 }).$type<PortalItemState>().notNull(),
    statusKey: varchar('status_key', { length: 150 }).notNull(),
    tone: varchar('tone', { length: 10 }),
    href: varchar('href', { length: 500 }).notNull(),
    icon: varchar('icon', { length: 64 }),
    people: uuid('people').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.entityId] }),
    index('portal_items_people_idx').using('gin', t.people),
  ],
);
