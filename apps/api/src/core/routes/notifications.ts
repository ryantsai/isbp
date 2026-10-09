import {
  badgesSchema,
  createChannelSchema,
  createdChannelSchema,
  deliveryQuerySchema,
  deliverySchema,
  emailSettingsSchema,
  markReadSchema,
  notificationChannelSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationQuerySchema,
  okSchema,
  testEmailSchema,
  updateChannelSchema,
  updateEmailSettingsSchema,
  updateNotificationPreferencesSchema,
} from '@isbp/contracts';
import { type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '../../kernel/sessions';
import { getKernel } from '../kernel-ref';
import type { NotificationAdminService } from '../services/notifications';

const idParams = z.object({ id: z.uuid() });
const HEARTBEAT_MS = 25_000;

export function notificationRoutes(app: ModuleRouter, svc: NotificationAdminService) {
  const tags = ['Notifications'];

  app.get(
    '/me/notifications',
    {
      schema: {
        tags,
        summary: 'My in-app notifications',
        querystring: notificationQuerySchema,
        response: { 200: notificationPageSchema },
      },
    },
    async (req) => svc.list(req.auth.user!.id, req.query),
  );

  app.post(
    '/me/notifications/read',
    {
      schema: {
        tags,
        summary: 'Mark notifications as read (ids, or all)',
        body: markReadSchema,
        response: { 200: z.object({ unread: z.number().int() }) },
      },
    },
    async (req) => svc.markRead(req.auth.user!.id, req.body),
  );

  app.get(
    '/me/badges',
    {
      schema: {
        tags,
        summary: 'Counters for the navigation (waiting on My work, pending approvals, unread notifications)',
        response: { 200: badgesSchema },
      },
    },
    async (req) => svc.badges(req.auth.user!.id, req.auth),
  );

  /**
   * Server-Sent Events: a `badges` event whenever something changes for me, a comment line every
   * 25 s to keep proxies from closing the connection, and the stream ends when the session does.
   */
  app.get(
    '/me/notifications/stream',
    { schema: { tags, summary: 'Live notification counters (text/event-stream)', hide: true } },
    async (req, reply) => {
      const kernel = getKernel();
      const userId = req.auth.user!.id;
      const auth = req.auth;
      const token = req.cookies[SESSION_COOKIE];
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      let closed = false;
      const send = async () => {
        if (closed) return;
        const badges = await svc.badges(userId, auth).catch(() => null);
        if (badges && !closed) res.write(`event: badges\ndata: ${JSON.stringify(badges)}\n\n`);
      };
      let pending: NodeJS.Timeout | undefined;
      const unsubscribe = await kernel.hub.subscribe(userId, () => {
        // Coalesce bursts (a workflow step notifying many people) into one update.
        clearTimeout(pending);
        pending = setTimeout(() => void send(), 150);
      });
      res.write('retry: 5000\n\n');
      await send();
      let beats = 0;
      const heartbeat = setInterval(() => {
        res.write(': ping\n\n');
        if (++beats % 4 === 0 && token)
          void kernel.sessions.validate(token).then((s) => {
            if (!s) res.end();
          });
      }, HEARTBEAT_MS);
      const close = () => {
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(pending);
        unsubscribe();
      };
      req.raw.on('close', close);
      res.on('close', close);
    },
  );

  app.get(
    '/me/notification-preferences',
    {
      schema: {
        tags,
        summary: 'My notification preferences per type and channel',
        response: { 200: notificationPreferencesSchema },
      },
    },
    async (req) => svc.preferences(req.auth.user!.id),
  );

  app.put(
    '/me/notification-preferences',
    {
      schema: {
        tags,
        summary: 'Update my notification preferences',
        body: updateNotificationPreferencesSchema,
        response: { 200: notificationPreferencesSchema },
      },
    },
    async (req) => svc.updatePreferences(req.auth.user!.id, req.body.items),
  );

  /* ───────────── admin ───────────── */

  const manage = { permission: 'core.notifications.manage' };

  app.get(
    '/notification-channels',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Teams, Slack and webhook channels',
        response: { 200: z.object({ items: z.array(notificationChannelSchema) }) },
      },
    },
    async () => ({ items: await svc.channels() }),
  );

  app.post(
    '/notification-channels',
    {
      config: manage,
      schema: {
        tags,
        summary:
          'Add a channel (the webhook URL is encrypted; generic webhooks get a signing secret, shown once)',
        body: createChannelSchema,
        response: { 201: createdChannelSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.createChannel(req.body, req.auth)),
  );

  app.patch(
    '/notification-channels/:id',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Edit a channel',
        params: idParams,
        body: updateChannelSchema,
        response: { 200: notificationChannelSchema },
      },
    },
    async (req) => svc.updateChannel(req.params.id, req.body),
  );

  app.delete(
    '/notification-channels/:id',
    {
      config: manage,
      schema: { tags, summary: 'Remove a channel', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await svc.deleteChannel(req.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/notification-channels/:id/test',
    {
      config: manage,
      schema: { tags, summary: 'Send a test message now', params: idParams, response: { 200: okSchema } },
    },
    async (req) => svc.testChannel(req.params.id),
  );

  app.get(
    '/notifications/email',
    {
      config: manage,
      schema: { tags, summary: 'Email (SMTP) settings', response: { 200: emailSettingsSchema } },
    },
    async () => svc.emailSettings(),
  );

  app.put(
    '/notifications/email',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Update email (SMTP) settings',
        body: updateEmailSettingsSchema,
        response: { 200: emailSettingsSchema },
      },
    },
    async (req) => svc.updateEmailSettings(req.body, req.auth),
  );

  app.post(
    '/notifications/email/test',
    {
      config: manage,
      schema: { tags, summary: 'Send a test email now', body: testEmailSchema, response: { 200: okSchema } },
    },
    async (req) => svc.testEmail(req.body.to),
  );

  app.get(
    '/notification-deliveries',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Delivery log (email and channels)',
        querystring: deliveryQuerySchema,
        response: { 200: pageSchema(deliverySchema) },
      },
    },
    async (req) => svc.deliveries(req.query),
  );
}
