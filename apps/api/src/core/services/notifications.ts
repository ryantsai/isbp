import type {
  createChannelSchema,
  deliveryQuerySchema,
  notificationQuerySchema,
  updateChannelSchema,
  updateEmailSettingsSchema,
} from '@isbp/contracts';
import { notificationChannels, notificationDeliveries, notifications, users } from '@isbp/db/schema';
import { type AuthContext, ErrorCodes, HttpError, httpErrors, type ModuleContext } from '@isbp/sdk/server';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { randomToken } from '../../kernel/crypto';
import { assertWebhookTarget, WebhookTargetError } from '../../kernel/notifications/channels';
import { renderNotification } from '../../kernel/notifications/render';
import { resolveChannels } from '../../kernel/notifications/service';
import { getKernel } from '../kernel-ref';
import { pageOffset } from '../util';

type ChannelRow = typeof notificationChannels.$inferSelect;

const EMAIL_KEYS = {
  enabled: 'notifications.email.enabled',
  host: 'notifications.email.host',
  port: 'notifications.email.port',
  secure: 'notifications.email.secure',
  username: 'notifications.email.username',
  password: 'notifications.email.password',
  from: 'notifications.email.from',
} as const;

/** Personal inbox and preferences, plus organisation channels and the delivery log. */
export class NotificationAdminService {
  constructor(private readonly ctx: ModuleContext) {}

  private get center() {
    return getKernel().notifications;
  }

  private get db() {
    return this.ctx.db;
  }

  /* ───────────── inbox ───────────── */

  async unread(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.inApp, true), isNull(notifications.readAt)),
      );
    return row?.n ?? 0;
  }

  async list(userId: string, q: z.output<typeof notificationQuerySchema>) {
    const where = and(
      eq(notifications.userId, userId),
      eq(notifications.inApp, true),
      q.unread ? isNull(notifications.readAt) : undefined,
    );
    const [rows, [total], unread] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(notifications).where(where),
      this.unread(userId),
    ]);
    return {
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        moduleId: n.moduleId,
        title: n.title,
        body: n.body,
        href: n.href,
        actorName: n.actorName,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
      unread,
    };
  }

  async markRead(userId: string, input: { ids?: string[]; all?: boolean }) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          input.all ? undefined : inArray(notifications.id, input.ids ?? []),
        ),
      );
    return { unread: await this.unread(userId) };
  }

  async badges(userId: string) {
    const [approvals, unread] = await Promise.all([
      getKernel().workflows.pendingCount(userId),
      this.unread(userId),
    ]);
    return { approvals, notifications: unread };
  }

  /* ───────────── preferences ───────────── */

  async preferences(userId: string) {
    const [u] = await this.db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId));
    const emailAvailable = await this.center.emailAvailable();
    const prefs = u?.preferences.notifications ?? {};
    return {
      emailAvailable,
      items: [...this.center.types().entries()].map(([type, { moduleId, def }]) => {
        const defaults = resolveChannels(def, undefined, true);
        const current = resolveChannels(def, prefs[type], true);
        return {
          type,
          moduleId,
          mandatory: Boolean(def.mandatory),
          defaults,
          inApp: current.inApp,
          email: current.email,
        };
      }),
    };
  }

  async updatePreferences(userId: string, items: { type: string; inApp: boolean; email: boolean }[]) {
    const types = this.center.types();
    const [u] = await this.db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId));
    const next = { ...(u?.preferences.notifications ?? {}) };
    for (const item of items) {
      const def = types.get(item.type)?.def;
      if (!def) continue;
      next[item.type] = def.mandatory
        ? { inApp: true, email: item.email }
        : { inApp: item.inApp, email: item.email };
    }
    await this.db
      .update(users)
      .set({ preferences: sql`${users.preferences} || ${JSON.stringify({ notifications: next })}::jsonb` })
      .where(eq(users.id, userId));
    return this.preferences(userId);
  }

  /* ───────────── channels (admin) ───────────── */

  private channelDto(c: ChannelRow) {
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      enabled: c.enabled,
      host: c.host,
      locale: c.locale,
      types: c.types,
      lastDeliveryAt: c.lastDeliveryAt,
      lastError: c.lastError,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private async checkUrl(url: string) {
    try {
      return await assertWebhookTarget(url, getKernel().config.allowPrivateWebhooks);
    } catch (err) {
      if (err instanceof WebhookTargetError)
        throw new HttpError(400, ErrorCodes.WEBHOOK_TARGET_INVALID, err.message, {
          issues: [{ path: 'url', message: err.message, code: 'webhook' }],
        });
      throw new HttpError(400, ErrorCodes.WEBHOOK_TARGET_INVALID, 'The webhook host could not be resolved', {
        issues: [{ path: 'url', message: 'unresolvable', code: 'webhook' }],
      });
    }
  }

  async channels() {
    const rows = await this.db.select().from(notificationChannels).orderBy(notificationChannels.name);
    return rows.map((c) => this.channelDto(c));
  }

  private async findChannel(id: string) {
    const [c] = await this.db.select().from(notificationChannels).where(eq(notificationChannels.id, id));
    if (!c) throw httpErrors.notFound('Channel not found');
    return c;
  }

  async createChannel(input: z.output<typeof createChannelSchema>, auth: AuthContext) {
    const url = await this.checkUrl(input.url);
    const signingSecret = input.type === 'webhook' ? `whsec_${randomToken(24)}` : null;
    const box = getKernel().box;
    const row = await this.ctx.transaction(async (tx) => {
      const [c] = await tx
        .insert(notificationChannels)
        .values({
          name: input.name,
          type: input.type,
          enabled: input.enabled,
          locale: input.locale,
          types: input.types,
          host: url.host,
          secrets: box.encryptJson({ url: url.toString(), ...(signingSecret ? { signingSecret } : {}) }),
          createdBy: auth.user?.id ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.notification-channel.created',
          category: 'security',
          entityType: 'notification_channel',
          entityId: c!.id,
          entityLabel: c!.name,
          metadata: { type: input.type, host: url.host, types: input.types },
        },
        { tx },
      );
      return c!;
    });
    return { ...this.channelDto(row), signingSecret };
  }

  async updateChannel(id: string, input: z.output<typeof updateChannelSchema>) {
    const before = await this.findChannel(id);
    const box = getKernel().box;
    let secrets: string | undefined;
    let host: string | undefined;
    if (input.url) {
      const url = await this.checkUrl(input.url);
      const old = box.decryptJson(before.secrets);
      secrets = box.encryptJson({ ...old, url: url.toString() });
      host = url.host;
    }
    const patch = {
      name: input.name,
      locale: input.locale,
      types: input.types,
      enabled: input.enabled,
      secrets,
      host,
    };
    await this.ctx.transaction(async (tx) => {
      await tx.update(notificationChannels).set(patch).where(eq(notificationChannels.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.notification-channel.updated',
          category: 'security',
          entityType: 'notification_channel',
          entityId: id,
          entityLabel: input.name ?? before.name,
          changes: this.ctx.audit.diff(
            {
              name: before.name,
              locale: before.locale,
              types: before.types,
              enabled: before.enabled,
              host: before.host,
            },
            { name: input.name, locale: input.locale, types: input.types, enabled: input.enabled, host },
          ),
          metadata: { urlChanged: Boolean(input.url) },
        },
        { tx },
      );
    });
    return this.channelDto(await this.findChannel(id));
  }

  async deleteChannel(id: string) {
    const c = await this.findChannel(id);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(notificationChannels).where(eq(notificationChannels.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.notification-channel.deleted',
          category: 'security',
          entityType: 'notification_channel',
          entityId: id,
          entityLabel: c.name,
        },
        { tx },
      );
    });
  }

  private async testMessage(locale: string) {
    const { title, body } = await renderNotification('core.channel.test', {}, { locale });
    return {
      type: 'core.channel.test',
      title: title === 'core.channel.test' ? 'Test notification from IS Big Platform' : title,
      body,
      url: this.center.absoluteUrl('/admin/notifications'),
      productName: await this.center.productName(),
      locale,
    };
  }

  async testChannel(id: string) {
    const c = await this.findChannel(id);
    try {
      await this.center.sendToChannel(c, await this.testMessage(c.locale));
      await this.db
        .update(notificationChannels)
        .set({ lastDeliveryAt: new Date(), lastError: null })
        .where(eq(notificationChannels.id, id));
      return { ok: true as const };
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await this.db
        .update(notificationChannels)
        .set({ lastError: reason })
        .where(eq(notificationChannels.id, id));
      throw new HttpError(502, ErrorCodes.DELIVERY_FAILED, 'The channel did not accept the test message', {
        reason,
      });
    }
  }

  /* ───────────── email (admin) ───────────── */

  async emailSettings() {
    const s = await this.center.emailSettings();
    return {
      enabled: s.enabled,
      host: s.host ?? '',
      port: s.port,
      secure: s.secure,
      username: s.username ?? '',
      passwordSet: Boolean(s.password),
      from: s.from ?? '',
      available: s.enabled && Boolean(s.host && s.from),
    };
  }

  async updateEmailSettings(input: z.output<typeof updateEmailSettingsSchema>, auth: AuthContext) {
    const kernel = getKernel();
    const manifest = kernel.registry.get('core')!.manifest;
    const values: Record<string, unknown> = {};
    for (const [field, key] of Object.entries(EMAIL_KEYS)) {
      const v = input[field as keyof typeof input];
      if (v !== undefined) values[key] = v;
    }
    await this.ctx.transaction(async (tx) => {
      const changes = await kernel.settings.update(manifest, values, auth.user?.id ?? null, tx);
      await this.ctx.audit.record(
        {
          action: 'core.module.settings_updated',
          category: 'security',
          entityType: 'module',
          entityId: 'core',
          changes,
        },
        { tx },
      );
    });
    return this.emailSettings();
  }

  async testEmail(to: string) {
    if (!(await this.center.emailAvailable()))
      throw new HttpError(
        409,
        ErrorCodes.EMAIL_NOT_CONFIGURED,
        'Turn on email and set the server and sender first',
      );
    try {
      await this.center.sendEmail(to, await this.testMessage('en'));
      return { ok: true as const };
    } catch (err) {
      throw new HttpError(502, ErrorCodes.DELIVERY_FAILED, 'The mail server rejected the test message', {
        reason: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      });
    }
  }

  /* ───────────── delivery log ───────────── */

  async deliveries(q: z.output<typeof deliveryQuerySchema>) {
    const where = and(
      q.status ? eq(notificationDeliveries.status, q.status) : undefined,
      q.channel ? eq(notificationDeliveries.channel, q.channel) : undefined,
      q.channelId ? eq(notificationDeliveries.channelId, q.channelId) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(notificationDeliveries)
        .where(where)
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(notificationDeliveries).where(where),
    ]);
    return {
      items: rows.map((d) => ({
        id: d.id,
        channel: d.channel,
        type: d.type,
        recipient: d.recipient,
        title: d.title,
        status: d.status,
        attempts: d.attempts,
        lastError: d.lastError,
        createdAt: d.createdAt,
        sentAt: d.sentAt,
      })),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
