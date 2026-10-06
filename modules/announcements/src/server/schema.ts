import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import { sql } from 'drizzle-orm';
import { boolean, index, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/** All tables of this module live in the `announcements` Postgres schema. */
export const announcementsSchema = pgSchema('announcements');

export const posts = announcementsSchema.table(
  'posts',
  {
    id: id(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull().default(''),
    severity: varchar('severity', { length: 20 })
      .$type<'info' | 'maintenance' | 'incident'>()
      .notNull()
      .default('info'),
    status: varchar('status', { length: 20 })
      .$type<'draft' | 'published' | 'archived'>()
      .notNull()
      .default('draft'),
    pinned: boolean('pinned').notNull().default(false),
    /** Optional window, e.g. a maintenance slot. Published posts are archived automatically after `ends_at`. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('posts_feed_idx').on(t.status, t.pinned, t.publishedAt),
    index('posts_ends_idx')
      .on(t.endsAt)
      .where(sql`${t.status} = 'published'`),
    index('posts_author_idx').on(t.authorId),
  ],
);
