import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import type { LocalizedText } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { ArticleAudience, ArticleLocale, ArticleSource, ArticleStatus } from '../contracts';

/** All tables of this module live in the `knowledge` Postgres schema. */
export const knowledgeSchema = pgSchema('knowledge');

/** Article numbers (`KB-00042`). */
export const articleNumberSeq = knowledgeSchema.sequence('article_number_seq', { startWith: 1 });

export const categories = knowledgeSchema.table(
  'categories',
  {
    id: id(),
    key: varchar('key', { length: 64 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<LocalizedText>(),
    /** lucide icon name (kebab-case). */
    icon: varchar('icon', { length: 64 }).notNull().default('book-open'),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_key_uq').on(t.key), index('categories_parent_idx').on(t.parentId)],
);

export const articles = knowledgeSchema.table(
  'articles',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('knowledge.article_number_seq')`),
    title: varchar('title', { length: 300 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull().default(''),
    /** Markdown. */
    body: text('body').notNull().default(''),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    locale: varchar('locale', { length: 10 }).$type<ArticleLocale>().notNull().default('en'),
    /** Articles that translate each other share it; it defaults to the article's own id. */
    translationGroupId: uuid('translation_group_id').notNull(),
    audience: varchar('audience', { length: 20 }).$type<ArticleAudience>().notNull().default('everyone'),
    status: varchar('status', { length: 20 }).$type<ArticleStatus>().notNull().default('draft'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** Latest published version (0 = never published). */
    publishedVersion: integer('published_version').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** When the owner should check the article is still accurate. */
    reviewAt: date('review_at', { mode: 'string' }),
    /** Last "review due" reminder (reset when the review date changes). */
    reviewNotifiedAt: timestamp('review_notified_at', { withTimezone: true }),
    views: integer('views').notNull().default(0),
    helpfulCount: integer('helpful_count').notNull().default(0),
    notHelpfulCount: integer('not_helpful_count').notNull().default(0),
    /** Where a generated draft came from, e.g. `{ type: 'itsm.ticket', id, reference: 'INC-00042' }`. */
    source: jsonb('source').$type<ArticleSource>(),
    /** Running `knowledge.publish` review workflow while `in_review`. */
    reviewInstanceId: uuid('review_instance_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('articles_number_uq').on(t.number),
    index('articles_status_category_idx').on(t.status, t.categoryId),
    index('articles_locale_idx').on(t.locale),
    index('articles_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('articles_summary_trgm_idx').using('gin', t.summary.op('gin_trgm_ops')),
    index('articles_owner_idx').on(t.ownerId),
    index('articles_translation_group_idx').on(t.translationGroupId),
    index('articles_status_updated_idx').on(t.status, t.updatedAt),
    // Update order across statuses (the sync adapter pages by `updated_at`, then id).
    index('articles_updated_idx').on(t.updatedAt, t.id),
    index('articles_status_views_idx').on(t.status, t.views),
    index('articles_review_idx')
      .on(t.reviewAt)
      .where(sql`${t.status} = 'published'`),
  ],
);

/** Every publish snapshots the article (title, summary, body) as a numbered version. */
export const articleVersions = knowledgeSchema.table(
  'article_versions',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull().default(''),
    body: text('body').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.version] })],
);

/** One vote per reader per article; voting again updates it. Counts live on `articles`. */
export const feedback = knowledgeSchema.table(
  'feedback',
  {
    id: id(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    helpful: boolean('helpful').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('feedback_article_user_uq').on(t.articleId, t.userId),
    index('feedback_article_created_idx').on(t.articleId, t.createdAt),
  ],
);

/** Last day each reader opened an article, so `views` counts at most once per reader per day. */
export const articleReads = knowledgeSchema.table(
  'article_reads',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedOn: date('viewed_on', { mode: 'string' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.userId] })],
);
