import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import { index, pgSchema, text, uuid, varchar } from 'drizzle-orm/pg-core';

/** All tables of this module live in the `__SCHEMA__` Postgres schema. */
export const __CAMEL__Schema = pgSchema('__SCHEMA__');

export const items = __CAMEL__Schema.table(
  'items',
  {
    id: id(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).$type<'draft' | 'active' | 'archived'>().notNull().default('draft'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('items_status_idx').on(t.status), index('items_owner_idx').on(t.ownerId), index('items_created_idx').on(t.createdAt)],
);
