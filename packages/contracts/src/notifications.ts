import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id, localeSchema } from './common';

export const notificationSchema = z.object({
  id,
  type: z.string(),
  moduleId: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  href: z.string().nullable(),
  actorName: z.string().nullable(),
  readAt: dateTime.nullable(),
  createdAt: dateTime,
});
export type Notification = z.input<typeof notificationSchema>;

export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  unread: z.number().int(),
});
export type NotificationPage = z.input<typeof notificationPageSchema>;

export const notificationQuerySchema = listQuerySchema.extend({ unread: z.stringbool().optional() });

export const markReadSchema = z
  .object({ ids: z.array(id).max(200).optional(), all: z.boolean().optional() })
  .refine((v) => v.all || v.ids?.length, 'Pass ids or all');

export const badgesSchema = z.object({ approvals: z.number().int(), notifications: z.number().int() });
export type Badges = z.input<typeof badgesSchema>;

export const notificationPreferenceSchema = z.object({
  type: z.string(),
  moduleId: z.string(),
  mandatory: z.boolean(),
  defaults: z.object({ inApp: z.boolean(), email: z.boolean() }),
  inApp: z.boolean(),
  email: z.boolean(),
});
export type NotificationPreference = z.input<typeof notificationPreferenceSchema>;

export const notificationPreferencesSchema = z.object({
  emailAvailable: z.boolean(),
  items: z.array(notificationPreferenceSchema),
});
export type NotificationPreferences = z.input<typeof notificationPreferencesSchema>;

export const updateNotificationPreferencesSchema = z.object({
  items: z.array(z.object({ type: z.string().max(150), inApp: z.boolean(), email: z.boolean() })).max(200),
});

/* ───────────── admin: channels, email, delivery log ───────────── */

export const channelTypeSchema = z.enum(['teams', 'slack', 'webhook']);
export type ChannelTypeValue = z.infer<typeof channelTypeSchema>;

/** Notification type patterns, e.g. `core.access-request.*`, `announcements.*`, `*`. */
export const typePatternSchema = z
  .string()
  .max(150)
  .regex(/^(\*|[a-z][a-z0-9-]*)(\.(\*|[a-z][a-z0-9_-]*)){0,2}$/, 'Use module.entity.verb with optional *');

export const notificationChannelSchema = z.object({
  id,
  name: z.string(),
  type: channelTypeSchema,
  enabled: z.boolean(),
  host: z.string(),
  locale: z.string(),
  types: z.array(z.string()),
  lastDeliveryAt: dateTime.nullable(),
  lastError: z.string().nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type NotificationChannel = z.input<typeof notificationChannelSchema>;

export const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: channelTypeSchema,
  url: z.url().max(2000),
  locale: localeSchema.default('en'),
  types: z.array(typePatternSchema).min(1).max(50),
  enabled: z.boolean().default(true),
});
export type CreateChannelInput = z.input<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  /** Omit to keep the stored (secret) URL. */
  url: z.url().max(2000).optional(),
  locale: localeSchema.optional(),
  types: z.array(typePatternSchema).min(1).max(50).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateChannelInput = z.input<typeof updateChannelSchema>;

/** Generic webhooks get a signing secret, shown once. */
export const createdChannelSchema = notificationChannelSchema.extend({
  signingSecret: z.string().nullable(),
});

export const deliveryStatusSchema = z.enum(['pending', 'sent', 'failed', 'skipped']);
export const deliverySchema = z.object({
  id,
  channel: z.enum(['email', 'teams', 'slack', 'webhook']),
  type: z.string(),
  recipient: z.string(),
  title: z.string(),
  status: deliveryStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: dateTime,
  sentAt: dateTime.nullable(),
});
export type Delivery = z.input<typeof deliverySchema>;

export const deliveryQuerySchema = listQuerySchema.extend({
  status: deliveryStatusSchema.optional(),
  channel: z.enum(['email', 'teams', 'slack', 'webhook']).optional(),
  channelId: id.optional(),
});

export const emailSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string(),
  port: z.number().int(),
  secure: z.boolean(),
  username: z.string(),
  passwordSet: z.boolean(),
  from: z.string(),
  /** Enabled and complete enough to send. */
  available: z.boolean(),
});
export type EmailSettings = z.input<typeof emailSettingsSchema>;

export const updateEmailSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().trim().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().trim().max(320).optional(),
  /** Omit to keep, empty string to clear. */
  password: z.string().max(500).optional(),
  from: z.string().trim().max(320).optional(),
});
export type UpdateEmailSettingsInput = z.input<typeof updateEmailSettingsSchema>;

export const testEmailSchema = z.object({ to: z.email().max(320) });
