import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { core, createdAt, id } from './core';
import { users } from './identity';

/**
 * Symmetric links between records of any modules (`ctx.records.link`), e.g. a project task ↔ an incident
 * or a release ↔ a change. Stored once with the ends in a canonical order (`a` < `b` by `type:id`), so
 * "links of X" looks at both columns. Ends are not foreign keys: modules own their tables, and
 * `ctx.records.forget` cleans up after a deleted record.
 */
export const recordLinks = core.table(
  'record_links',
  {
    id: id(),
    aType: varchar('a_type', { length: 120 }).notNull(),
    aId: varchar('a_id', { length: 64 }).notNull(),
    bType: varchar('b_type', { length: 120 }).notNull(),
    bId: varchar('b_id', { length: 64 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('record_links_pair_uq').on(t.aType, t.aId, t.bType, t.bId),
    index('record_links_b_idx').on(t.bType, t.bId),
    // Byte order ("C"), which matches JavaScript's string comparison for these ASCII keys.
    check(
      'record_links_order_ck',
      sql`(${t.aType} || ':' || ${t.aId}) collate "C" < (${t.bType} || ':' || ${t.bId}) collate "C"`,
    ),
  ],
);

/**
 * Attachments on records (`ctx.files`). The bytes live in the configured storage under `storage_key`
 * (never derived from the file name); rows are soft-deleted so the audit trail can still name them.
 */
export const files = core.table(
  'files',
  {
    id: id(),
    recordType: varchar('record_type', { length: 120 }).notNull(),
    recordId: varchar('record_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 150 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    storage: varchar('storage', { length: 16 }).$type<'local' | 's3'>().notNull(),
    storageKey: varchar('storage_key', { length: 200 }).notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('files_record_idx')
      .on(t.recordType, t.recordId, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export type FileTextStatus = 'pending' | 'done' | 'empty' | 'unsupported' | 'too_large' | 'failed';

/**
 * Text extracted from an attachment for search (Phase 10): Markdown per page, from the builtin readers (PDF text
 * layer, Office files, plain text) or a document-extraction service (OCR, layout, tables). One row per file; the
 * search index holds the chunks, only for records whose module indexes their attachments.
 */
export const fileTexts = core.table(
  'file_texts',
  {
    fileId: uuid('file_id')
      .primaryKey()
      .references(() => files.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).$type<FileTextStatus>().notNull(),
    /** What produced the text: `builtin:pdf`, `builtin:docx`, `docling`, `azure`, … */
    producer: varchar('producer', { length: 60 }),
    /** One Markdown string per page (slides and sheets count as pages). */
    pages: text('pages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    chars: integer('chars').notNull().default(0),
    error: varchar('error', { length: 300 }),
    attempts: integer('attempts').notNull().default(0),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('file_texts_status_idx').on(t.status)],
);
