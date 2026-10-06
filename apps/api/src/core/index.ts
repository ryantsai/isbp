import { departments, groups, identityProviders, roles, users } from '@isbp/db/schema';
import { type AuthContext, defineServerModule, type ModuleContext, type SearchHit } from '@isbp/sdk/server';
import { and, eq, ilike, isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { DeliveryEvent } from '../kernel/notifications/service';
import { moduleQueueName } from '../kernel/queues';
import { getKernel } from './kernel-ref';
import { coreManifest } from './manifest';
import { accessRoutes } from './routes/access';
import { applicationRoutes } from './routes/applications';
import { authRoutes } from './routes/auth';
import { directoryRoutes } from './routes/directory';
import { formRoutes } from './routes/forms';
import { notificationRoutes } from './routes/notifications';
import { meRoutes, userRoutes } from './routes/people';
import { platformRoutes } from './routes/platform';
import { requestRoutes } from './routes/requests';
import { workflowRoutes } from './routes/workflows';
import { AccessService } from './services/access';
import { AccessRequestService } from './services/access-requests';
import { ApiClientService, ApplicationService, RoleQueryService } from './services/applications';
import { DirectoryService } from './services/directory';
import { CustomFieldAdminService, FormService } from './services/forms';
import { IdpService } from './services/idp';
import { NotificationAdminService } from './services/notifications';
import { UserService } from './services/users';
import { ApprovalService, WorkflowAdminService } from './services/workflows';
import { likePattern, reachFilter } from './util';

async function searchCore(
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
): Promise<SearchHit[]> {
  const like = likePattern(query);
  const tasks: Promise<SearchHit[]>[] = [];
  if (auth.permissions.hasAny('core.users.read')) {
    tasks.push(
      ctx.db
        .select({ id: users.id, name: users.displayName, email: users.email, status: users.status })
        .from(users)
        .where(
          and(
            reachFilter(auth.reach('core.users.read'), users.departmentId, users.id, 'user'),
            or(ilike(users.displayName, like), ilike(users.email, like), ilike(users.username, like)),
          ),
        )
        .orderBy(users.displayName)
        .limit(limit)
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            type: 'user',
            title: r.name,
            subtitle: r.email,
            href: `/admin/users/${r.id}`,
            icon: 'user',
          })),
        ),
    );
  }
  if (auth.can('core.groups.read')) {
    tasks.push(
      ctx.db
        .select({ id: groups.id, name: groups.name, key: groups.key })
        .from(groups)
        .where(or(ilike(groups.name, like), ilike(groups.key, like)))
        .limit(limit)
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            type: 'group',
            title: r.name,
            subtitle: r.key,
            href: `/admin/groups/${r.id}`,
            icon: 'users-round',
          })),
        ),
    );
  }
  if (auth.can('core.roles.read')) {
    tasks.push(
      ctx.db
        .select({ id: roles.id, name: roles.name, key: roles.key })
        .from(roles)
        .where(or(ilike(roles.name, like), ilike(roles.key, like)))
        .limit(limit)
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            type: 'role',
            title: r.name,
            subtitle: r.key,
            href: `/admin/roles/${r.id}`,
            icon: 'shield-check',
          })),
        ),
    );
  }
  if (auth.can('core.departments.read')) {
    tasks.push(
      ctx.db
        .select({ id: departments.id, name: departments.name, code: departments.code })
        .from(departments)
        .where(or(ilike(departments.name, like), ilike(departments.code, like)))
        .limit(limit)
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            type: 'department',
            title: r.name,
            subtitle: r.code,
            href: `/admin/departments?focus=${r.id}`,
            icon: 'network',
          })),
        ),
    );
  }
  return (await Promise.all(tasks)).flat();
}

export const coreModule = defineServerModule(coreManifest, {
  routes: (app, ctx) => {
    const usersSvc = new UserService(ctx);
    const access = new AccessService(ctx);
    const directory = new DirectoryService(ctx);
    const idps = new IdpService(ctx);
    const forms = new FormService(ctx);
    authRoutes(app, ctx, idps);
    meRoutes(app, ctx, access);
    userRoutes(app, ctx, usersSvc, access);
    directoryRoutes(app, directory);
    accessRoutes(app, access);
    platformRoutes(app, ctx, idps);
    workflowRoutes(app, new WorkflowAdminService(ctx), new ApprovalService(ctx));
    requestRoutes(app, new AccessRequestService(ctx), forms);
    formRoutes(app, forms, new CustomFieldAdminService(ctx));
    notificationRoutes(app, new NotificationAdminService(ctx));
    applicationRoutes(
      app,
      ctx,
      new ApplicationService(ctx, access),
      new ApiClientService(ctx),
      new RoleQueryService(ctx),
      access,
    );
  },

  workflows: {
    'core.access-request': {
      onCompleted: (result, ctx) => new AccessRequestService(ctx).onWorkflowCompleted(result),
    },
    'core.form-submission': {
      onCompleted: (result, ctx) => new FormService(ctx).onWorkflowCompleted(result),
    },
  },

  events: {
    /** Delivers email, Teams, Slack and webhook notifications after the creating transaction commits. */
    'core.notification.created': async (event) => {
      await getKernel().notifications.deliver(event.payload as DeliveryEvent);
    },
  },

  jobs: {
    'workflow-timers': {
      description: 'Sends approval reminders and applies SLA breach policies (escalate, auto-decide)',
      schedule: { everyMs: 60_000 },
      handler: async () => getKernel().workflows.tick(),
    },
    'notify-expiring-access': {
      description: 'Tells people a few days before a time-bound role ends',
      schedule: { cron: '7 * * * *' },
      handler: async (_job, ctx) => ({ notified: await new AccessRequestService(ctx).notifyExpiring() }),
    },
    'purge-notifications': {
      description: 'Deletes notifications and delivery records older than the retention period',
      schedule: { cron: '41 3 * * *' },
      handler: async (_job, ctx) => {
        const days = Number((await ctx.settings.get<number>('notifications.retentionDays')) ?? 90) || 90;
        return getKernel().notifications.purge(days);
      },
    },
    'expire-role-assignments': {
      description: 'Removes time-bound role assignments once they expire',
      schedule: { everyMs: 5 * 60_000 },
      handler: async (_job, ctx) => ({ expired: await new AccessService(ctx).expireAssignments() }),
    },
    'purge-sessions': {
      description: 'Deletes sessions that ended more than 7 days ago',
      schedule: { cron: '17 * * * *' },
      handler: async () => ({ purged: await getKernel().sessions.purge() }),
    },
    'sync-directory': {
      description: 'Synchronises users and mapped groups from an LDAP directory',
      attempts: 2,
      timeoutMs: 15 * 60_000,
      handler: async (job, ctx) => new IdpService(ctx).syncDirectory((job.data as { idpId: string }).idpId),
    },
    'refresh-sync-schedules': {
      description: 'Re-creates per-provider directory sync schedules after a provider changes',
      handler: async (_job, ctx) => {
        const queue = getKernel().queues.get(moduleQueueName('core'));
        const wanted = await ctx.db
          .select({ id: identityProviders.id, cron: identityProviders.syncCron })
          .from(identityProviders)
          .where(
            and(
              eq(identityProviders.type, 'ldap'),
              eq(identityProviders.enabled, true),
              eq(identityProviders.syncEnabled, true),
              isNotNull(identityProviders.syncCron),
            ),
          );
        const keep = new Set<string>();
        for (const idp of wanted) {
          const id = `idp-sync-${idp.id}`;
          keep.add(id);
          await queue.upsertJobScheduler(
            id,
            { pattern: idp.cron! },
            { name: 'sync-directory', data: { idpId: idp.id } },
          );
        }
        for (const s of await queue.getJobSchedulers()) {
          if (s.key.startsWith('idp-sync-') && !keep.has(s.key)) await queue.removeJobScheduler(s.key);
        }
        return { schedules: keep.size };
      },
    },
  },

  search: searchCore,

  ai: {
    'core.find_users': async (input, ctx, auth) => {
      const { query, limit } = z.object({ query: z.string(), limit: z.number().default(10) }).parse(input);
      return new UserService(ctx).list({ q: query, page: 1, pageSize: limit }, auth);
    },
    'core.explain_access': async (input, ctx) => {
      const { userId } = z.object({ userId: z.uuid() }).parse(input);
      return new AccessService(ctx).effectivePermissions(userId);
    },
    'core.offboard_user': async (input, ctx, auth) => {
      const { userId, reason } = z.object({ userId: z.uuid(), reason: z.string() }).parse(input);
      return new UserService(ctx).offboard(
        userId,
        { reason, removeGroupMemberships: true, removeRoleAssignments: true },
        auth,
      );
    },
  },
});
