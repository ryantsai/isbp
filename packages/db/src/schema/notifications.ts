import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { core, createdAt, id, updatedAt } from './core';
import { users } from './identity';

/** In-app notification, rendered at creation in the recipient's locale. */
export const notifications = core.table(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 150 }).notNull(),
    moduleId: varchar('module_id', { length: 64 }).notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    body: text('body'),
    href: varchar('href', { length: 500 }),
    data: jsonb('data').$type<Record<string, unknown>>(),
    actorId: uuid('actor_id'),
    actorName: varchar('actor_name', { length: 200 }),
    /** In-app visibility (false when the user turned in-app off and only email was wanted). */
    inApp: boolean('in_app').notNull().default(true),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt.desc()),
    index('notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null and ${t.inApp}`),
  ],
);

export type ChannelType = 'teams' | 'slack' | 'webhook';

/**
 * Organisation channels (Teams/Slack incoming webhooks, signed generic webhooks) subscribed to
 * notification types by pattern (`core.access-request.*`, `announcements.*`).
 * `secrets` is an AES-GCM envelope of `{ url, signingSecret? }` — webhook URLs are credentials.
 */
export const notificationChannels = core.table('notification_channels', {
  id: id(),
  name: varchar('name', { length: 200 }).notNull(),
  type: varchar('type', { length: 20 }).$type<ChannelType>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  secrets: text('secrets').notNull(),
  /** Host of the webhook (shown in the UI instead of the secret URL). */
  host: varchar('host', { length: 255 }).notNull(),
  locale: varchar('locale', { length: 10 }).notNull().default('en'),
  types: text('types')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type DeliveryChannel = 'email' | ChannelType;
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/** One row per outbound delivery — makes worker retries idempotent and gives admins a delivery log. */
export const notificationDeliveries = core.table(
  'notification_deliveries',
  {
    id: id(),
    notificationId: uuid('notification_id').references(() => notifications.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => notificationChannels.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 20 }).$type<DeliveryChannel>().notNull(),
    type: varchar('type', { length: 150 }).notNull(),
    /** Email address, or the channel name. */
    recipient: varchar('recipient', { length: 320 }).notNull(),
    locale: varchar('locale', { length: 10 }).notNull().default('en'),
    title: varchar('title', { length: 300 }).notNull(),
    body: text('body'),
    href: varchar('href', { length: 500 }),
    status: varchar('status', { length: 20 }).$type<DeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_deliveries_created_idx').on(t.createdAt.desc()),
    index('notification_deliveries_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    index('notification_deliveries_notification_idx').on(t.notificationId),
    index('notification_deliveries_channel_idx').on(t.channelId),
  ],
);
