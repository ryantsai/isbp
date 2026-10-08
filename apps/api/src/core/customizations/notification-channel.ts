import { localeSchema, typePatternSchema, updateChannelSchema } from '@isbp/contracts';
import { locales } from '@isbp/i18n';
import { notificationChannels } from '@isbp/db/schema';
import {
  type CustomizationHandler,
  type CustomizationIssue,
  type Db,
  matchPermission,
} from '@isbp/sdk/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getKernel } from '../kernel-ref';
import { NotificationAdminService } from '../services/notifications';
import { catalogText, isUuid, matchesQuery } from './shared';

/**
 * Only what a channel receives. The webhook URL and signing secret never enter the value (strict: a `url` is
 * refused, not silently dropped); they are set in Administration → Notifications.
 */
const schema = z
  .object({
    name: updateChannelSchema.shape.name.unwrap().describe('Name shown in the delivery log'),
    locale: localeSchema.describe('Language of the messages posted to the channel'),
    types: z
      .array(typePatternSchema)
      .min(1)
      .max(50)
      .describe(
        'Notification types it receives: patterns such as core.access-request.*, announcements.* or *',
      ),
    enabled: z.boolean().describe('Whether notifications are posted to it'),
  })
  .strict();
export type ChannelValue = z.output<typeof schema>;

const CHANNEL_TYPES: Record<string, string> = {
  teams: 'Microsoft Teams channel',
  slack: 'Slack channel',
  webhook: 'Webhook',
};

async function findChannel(db: Db, id: string) {
  if (!isUuid(id)) return null;
  const [c] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, id));
  return c ?? null;
}

const notificationTypes = () => [...getKernel().notifications.types().keys()];

const INSTRUCTIONS = `A notification channel posts notifications to a Microsoft Teams or Slack channel or a webhook. Its address and signing secret are set by an administrator in Administration → Notifications and are never part of the value; channels are created there too. This kind changes what a channel receives: name, locale (the language of the messages: ${locales.join(', ')}), types and enabled.
types are notification type patterns: an exact type (core.access-request.approved), a wildcard over a module or entity (core.approval.*, itsm.*) or * for everything. Use types from reference.notificationTypes; every pattern must match at least one.`;

export const notificationChannelKind: CustomizationHandler<ChannelValue> = {
  schema,

  async guide() {
    const types = await Promise.all(
      [...getKernel().notifications.types().entries()].map(async ([type, { moduleId }]) => {
        const [, ...rest] = type.split('.');
        const key = `${moduleId}.notifications.${rest.join('_').replaceAll('-', '_')}.label`;
        const label = await catalogText(key);
        return { type, module: moduleId, label: label === key ? null : label };
      }),
    );
    return {
      instructions: INSTRUCTIONS,
      reference: { notificationTypes: types, locales },
      examples: [
        {
          description: 'Approvals and access-request outcomes in English, for a service desk Teams channel',
          value: {
            name: 'Service desk (Teams)',
            locale: 'en',
            types: ['core.approval.*', 'core.access-request.*'],
            enabled: true,
          },
        },
      ],
    };
  },

  async list({ q, limit }, ctx) {
    const rows = await ctx.db.select().from(notificationChannels).orderBy(asc(notificationChannels.name));
    return rows
      .filter((c) => matchesQuery(q, c.name, ...c.types))
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        label: c.name,
        description: `${CHANNEL_TYPES[c.type] ?? c.type}${c.enabled ? '' : ' (disabled)'}`,
        href: '/admin/notifications',
      }));
  },

  async get(id, ctx) {
    const c = await findChannel(ctx.db, id);
    if (!c) return null;
    return {
      id: c.id,
      label: c.name,
      description: CHANNEL_TYPES[c.type] ?? c.type,
      href: '/admin/notifications',
      value: {
        name: c.name,
        locale: localeSchema.catch('en').parse(c.locale),
        types: c.types,
        enabled: c.enabled,
      },
    };
  },

  async check(change, ctx) {
    if (change.op !== 'update') return [];
    const v = change.value!;
    const current = (await findChannel(ctx.db, change.id!))!;
    const known = notificationTypes();
    const issues: CustomizationIssue[] = [];
    // Only added patterns are checked: a channel may still list types of a module that was removed.
    v.types.forEach((p, i) => {
      if (!current.types.includes(p) && !known.some((t) => matchPermission(p, t)))
        issues.push({
          path: `types.${i}`,
          code: 'unknown_type',
          message: `"${p}" matches no notification type: use reference.notificationTypes`,
        });
    });
    return issues;
  },

  async apply(change, ctx) {
    if (change.op !== 'update') throw new Error(`core.notification-channel does not support ${change.op}`);
    const v = change.value!;
    const c = (await findChannel(ctx.db, change.id!))!;
    const same =
      c.name === v.name &&
      c.locale === v.locale &&
      c.enabled === v.enabled &&
      JSON.stringify(c.types) === JSON.stringify(v.types);
    // No `url`: the stored address stays, and nothing is resolved or contacted.
    if (!same)
      await new NotificationAdminService(ctx).updateChannel(c.id, {
        name: v.name,
        locale: v.locale,
        types: v.types,
        enabled: v.enabled,
      });
    return { id: c.id };
  },
};
