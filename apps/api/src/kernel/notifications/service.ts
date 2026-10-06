import {
  type ChannelType,
  type NotificationPreferences,
  notificationChannels,
  notificationDeliveries,
  notifications,
  users,
  uuidv7,
} from '@isbp/db/schema';
import {
  type Db,
  type EventPublisher,
  matchPermission,
  type ModuleManifest,
  type NotificationService,
  type NotificationTypeDef,
  type NotifyInput,
} from '@isbp/sdk/server';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { Transporter } from 'nodemailer';
import type { Config } from '../../config';
import { currentPrincipal } from '../context';
import type { SecretBox } from '../crypto';
import type { ModuleRegistry } from '../modules';
import type { SettingsService } from '../settings';
import {
  type EmailSettings,
  type OutboundMessage,
  postWebhook,
  renderEmail,
  smtpTransport,
  type TransportFactory,
} from './channels';
import { renderNotification } from './render';

export const NOTIFY_CHANNEL = 'isbp:notifications';
export const NOTIFICATION_CREATED = 'core.notification.created';
const MAX_ATTEMPTS = 5;

export interface DeliveryEvent {
  /** Users with new in-app notifications (live update ping). */
  userIds: string[];
  deliveryIds: string[];
}

export interface ResolvedChannels {
  inApp: boolean;
  email: boolean;
}

/** Personal channels for one notification type: the user's choice, else the type's defaults. */
export function resolveChannels(
  def: NotificationTypeDef,
  pref: NotificationPreferences[string] | undefined,
  emailAvailable: boolean,
): ResolvedChannels {
  const defaults = def.defaultChannels ?? ['inApp'];
  let inApp = pref?.inApp ?? defaults.includes('inApp');
  let email = pref?.email ?? defaults.includes('email');
  if (def.mandatory) {
    inApp = true;
    email = email || defaults.includes('email');
  }
  return { inApp, email: email && emailAvailable };
}

interface Deps {
  db: Db;
  box: SecretBox;
  settings: SettingsService;
  registry: ModuleRegistry;
  redis: Redis;
  config: Config;
  logger: FastifyBaseLogger;
  /** Core's event publisher (bound after module contexts exist). */
  coreEvents: () => EventPublisher;
}

/**
 * Notifications for every module: in-app rows commit with the caller's transaction; email, Teams,
 * Slack and webhook deliveries are queued as rows and sent by the worker after commit.
 */
export class NotificationCenter {
  private transportFactory: TransportFactory = smtpTransport;
  private transport?: { key: string; transporter: Transporter };
  private typeIndex?: Map<string, { moduleId: string; def: NotificationTypeDef }>;

  constructor(private readonly deps: Deps) {}

  /** Tests swap SMTP for an in-memory transport. */
  useTransport(factory: TransportFactory) {
    this.transportFactory = factory;
    this.transport = undefined;
  }

  types() {
    if (!this.typeIndex) {
      this.typeIndex = new Map();
      for (const m of this.deps.registry.modules)
        for (const def of m.manifest.notifications ?? [])
          this.typeIndex.set(def.type, { moduleId: m.manifest.id, def });
    }
    return this.typeIndex;
  }

  forModule(manifest: ModuleManifest): NotificationService {
    return {
      notify: (input, opts) => this.notify(manifest.id, input, opts?.tx),
      broadcast: (input, opts) => this.notify(manifest.id, { ...input, recipients: [] }, opts?.tx),
    };
  }

  private coreManifest(): ModuleManifest {
    return this.deps.registry.get('core')!.manifest;
  }

  async emailSettings(): Promise<EmailSettings> {
    const v = await this.deps.settings.values(this.coreManifest());
    const str = (k: string) =>
      typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string).trim() : null;
    return {
      enabled: v['notifications.email.enabled'] === true,
      host: str('notifications.email.host'),
      port:
        typeof v['notifications.email.port'] === 'number' ? (v['notifications.email.port'] as number) : 587,
      secure: v['notifications.email.secure'] === true,
      username: str('notifications.email.username'),
      password: str('notifications.email.password'),
      from: str('notifications.email.from'),
    };
  }

  async emailAvailable(): Promise<boolean> {
    const s = await this.emailSettings();
    return s.enabled && Boolean(s.host && s.from);
  }

  async productName(): Promise<string> {
    const v = await this.deps.settings.values(this.coreManifest());
    return typeof v['branding.productName'] === 'string' && v['branding.productName']
      ? (v['branding.productName'] as string)
      : 'IS Big Platform';
  }

  absoluteUrl(href: string | null | undefined): string | null {
    if (!href) return null;
    if (/^https?:\/\//.test(href)) return href;
    return `${this.deps.config.PUBLIC_URL.replace(/\/$/, '')}${href.startsWith('/') ? '' : '/'}${href}`;
  }

  async notify(moduleId: string, input: NotifyInput, tx: Db = this.deps.db): Promise<void> {
    if (!input.type.startsWith(`${moduleId}.`))
      throw new Error(`Module "${moduleId}" cannot send foreign notification type "${input.type}"`);
    const entry = this.types().get(input.type);
    if (!entry) throw new Error(`Notification type "${input.type}" is not declared in a manifest`);

    const ids = [...new Set(input.recipients.filter((r): r is string => Boolean(r)))];
    const recipients = ids.length
      ? await tx
          .select({
            id: users.id,
            email: users.email,
            locale: users.locale,
            timezone: users.timezone,
            preferences: users.preferences,
          })
          .from(users)
          .where(and(inArray(users.id, ids), eq(users.status, 'active')))
      : [];
    const emailOk = recipients.length ? await this.emailAvailable() : false;
    const actor = currentPrincipal();
    const params = input.params ?? {};

    const rows: (typeof notifications.$inferInsert)[] = [];
    const deliveries: (typeof notificationDeliveries.$inferInsert)[] = [];
    for (const u of recipients) {
      const ch = resolveChannels(entry.def, u.preferences?.notifications?.[input.type], emailOk);
      if (!ch.inApp && !ch.email) continue;
      const { title, body } = await renderNotification(input.type, params, {
        locale: u.locale,
        timezone: u.timezone,
      });
      const id = uuidv7();
      rows.push({
        id,
        userId: u.id,
        type: input.type,
        moduleId,
        title,
        body,
        href: input.href ?? null,
        data: input.data ?? null,
        actorId: actor.type === 'user' ? actor.id : null,
        actorName: actor.type === 'user' ? actor.name : null,
        inApp: ch.inApp,
      });
      if (ch.email)
        deliveries.push({
          notificationId: id,
          channel: 'email',
          type: input.type,
          recipient: u.email,
          locale: u.locale,
          title,
          body,
          href: input.href ?? null,
        });
    }

    const channels = await tx
      .select({
        id: notificationChannels.id,
        name: notificationChannels.name,
        type: notificationChannels.type,
        locale: notificationChannels.locale,
        types: notificationChannels.types,
      })
      .from(notificationChannels)
      .where(eq(notificationChannels.enabled, true));
    for (const c of channels.filter((c) => c.types.some((p) => matchPermission(p, input.type)))) {
      const { title, body } = await renderNotification(input.type, params, { locale: c.locale });
      deliveries.push({
        channelId: c.id,
        channel: c.type,
        type: input.type,
        recipient: c.name.slice(0, 320),
        locale: c.locale,
        title,
        body,
        href: input.href ?? null,
      });
    }

    if (rows.length) await tx.insert(notifications).values(rows);
    const inserted = deliveries.length
      ? await tx
          .insert(notificationDeliveries)
          .values(deliveries)
          .returning({ id: notificationDeliveries.id })
      : [];
    if (!rows.length && !inserted.length) return;
    await this.deps.coreEvents().publish<DeliveryEvent>(
      NOTIFICATION_CREATED,
      {
        userIds: [...new Set(rows.filter((r) => r.inApp).map((r) => r.userId))],
        deliveryIds: inserted.map((d) => d.id),
      },
      { tx },
    );
  }

  /* ───────────── worker side ───────────── */

  private async mailer(): Promise<{ transporter: Transporter; settings: EmailSettings }> {
    const settings = await this.emailSettings();
    const key = JSON.stringify(settings);
    if (!this.transport || this.transport.key !== key)
      this.transport = { key, transporter: this.transportFactory(settings) };
    return { transporter: this.transport.transporter, settings };
  }

  async sendEmail(to: string, message: OutboundMessage): Promise<void> {
    const { transporter, settings } = await this.mailer();
    if (!settings.enabled || !settings.host || !settings.from) throw new Error('Email is not configured');
    const { html, text } = renderEmail(message, this.absoluteUrl('/settings#notifications'));
    await transporter.sendMail({ from: settings.from, to, subject: message.title, text, html });
  }

  async sendToChannel(
    channel: { type: ChannelType; secrets: string },
    message: OutboundMessage,
  ): Promise<void> {
    const target = this.deps.box.decryptJson(channel.secrets) as { url: string; signingSecret?: string };
    await postWebhook(channel.type, target, message, this.deps.config.allowPrivateWebhooks);
  }

  /** Handles `core.notification.created`: live-update ping, then every pending delivery. */
  async deliver(event: DeliveryEvent): Promise<void> {
    if (event.userIds.length)
      await this.deps.redis.publish(NOTIFY_CHANNEL, JSON.stringify({ userIds: event.userIds }));
    if (!event.deliveryIds.length) return;
    const db = this.deps.db;
    const pending = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          inArray(notificationDeliveries.id, event.deliveryIds),
          eq(notificationDeliveries.status, 'pending'),
        ),
      );
    if (!pending.length) return;
    const productName = await this.productName();
    const channelIds = [...new Set(pending.map((d) => d.channelId).filter((c): c is string => Boolean(c)))];
    const channels = channelIds.length
      ? await db.select().from(notificationChannels).where(inArray(notificationChannels.id, channelIds))
      : [];
    let retry = 0;
    for (const d of pending) {
      const message: OutboundMessage = {
        type: d.type,
        title: d.title,
        body: d.body,
        url: this.absoluteUrl(d.href),
        productName,
        locale: d.locale,
      };
      const channel = channels.find((c) => c.id === d.channelId);
      try {
        if (d.channel === 'email') await this.sendEmail(d.recipient, message);
        else if (!channel || !channel.enabled) {
          await db
            .update(notificationDeliveries)
            .set({ status: 'skipped' })
            .where(eq(notificationDeliveries.id, d.id));
          continue;
        } else await this.sendToChannel(channel, message);
        await db
          .update(notificationDeliveries)
          .set({ status: 'sent', sentAt: new Date(), attempts: d.attempts + 1, lastError: null })
          .where(eq(notificationDeliveries.id, d.id));
        if (channel)
          await db
            .update(notificationChannels)
            .set({ lastDeliveryAt: new Date(), lastError: null })
            .where(eq(notificationChannels.id, channel.id));
      } catch (err) {
        const attempts = d.attempts + 1;
        const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
        await db
          .update(notificationDeliveries)
          .set({ attempts, lastError, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' })
          .where(eq(notificationDeliveries.id, d.id));
        if (channel)
          await db
            .update(notificationChannels)
            .set({ lastError })
            .where(eq(notificationChannels.id, channel.id));
        this.deps.logger.warn(
          { delivery: d.id, channel: d.channel, attempts, err: lastError },
          'notification delivery failed',
        );
        if (attempts < MAX_ATTEMPTS) retry++;
      }
    }
    if (retry) throw new Error(`${retry} notification deliveries failed and will be retried`);
  }

  /** Deletes old notifications and delivery records. */
  async purge(retentionDays: number): Promise<{ notifications: number; deliveries: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const n = await this.deps.db
      .delete(notifications)
      .where(lt(notifications.createdAt, cutoff))
      .returning({ id: notifications.id });
    const d = await this.deps.db
      .delete(notificationDeliveries)
      .where(
        and(lt(notificationDeliveries.createdAt, cutoff), sql`${notificationDeliveries.status} <> 'pending'`),
      )
      .returning({ id: notificationDeliveries.id });
    return { notifications: n.length, deliveries: d.length };
  }
}
