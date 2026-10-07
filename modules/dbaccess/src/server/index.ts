import { defineServerModule, HttpError } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import migrations from '../../migrations';
import { syncTaskConfigSchema } from '../contracts';
import { manifest, PERMISSIONS, REQUEST_TRIGGER } from '../manifest';
import { aiTools } from './ai';
import { errorMessage } from './engine';
import { routes } from './routes';
import { servers } from './schema';
import { seed } from './seed';
import { services } from './services';

/**
 * Database access: requestable roles on SQL Server, Oracle and PostgreSQL servers, approval through the
 * `dbaccess.request` workflow, provisioning in the worker (verified, retried, audited), one-time credential
 * reveals, time-bound access, offboarding, access reviews and drift (unmanaged access, orphan accounts).
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  events: {
    /** Leavers lose every grant and their accounts are disabled. */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      await services(ctx).grants.offboard(userId);
    },
  },

  workflows: {
    [REQUEST_TRIGGER]: { onCompleted: (result, ctx) => services(ctx).requests.onCompleted(result) },
  },

  jobs: {
    provision: {
      description: 'Creates the account if needed, grants the role and verifies it (retries with backoff)',
      timeoutMs: 120_000,
      handler: async (job, ctx) => {
        const { grantId } = job.data as { grantId: string };
        return services(ctx).grants.provision(grantId, { log: (l) => void job.log(l) });
      },
    },
    revoke: {
      description: 'Revokes the role of an ending grant and verifies it is gone (retries with backoff)',
      timeoutMs: 120_000,
      handler: async (job, ctx) => {
        const { grantId } = job.data as { grantId: string };
        return services(ctx).grants.revoke(grantId, { log: (l) => void job.log(l) });
      },
    },
    'disable-accounts': {
      description: 'Disables the accounts of an offboarded person on every server',
      timeoutMs: 300_000,
      handler: async (job, ctx) => {
        const { userId } = job.data as { userId: string };
        return services(ctx).grants.disableAccounts(userId, { log: (l) => void job.log(l) });
      },
    },
    'expire-grants': {
      description: 'Revokes expired grants, reminds grantees 3 days before the end, wipes old reveals',
      schedule: { everyMs: 5 * 60_000 },
      attempts: 1,
      timeoutMs: 240_000,
      handler: async (job, ctx) => services(ctx).grants.sweep((l) => void job.log(l)),
    },
    'nightly-sync': {
      description: 'Syncs the inventory of servers with auto sync on',
      schedule: { cron: '30 2 * * *', tz: 'Asia/Taipei' },
      attempts: 1,
      timeoutMs: 30 * 60_000,
      handler: async (job, ctx) => {
        const s = services(ctx);
        const out: Record<string, string> = {};
        for (const server of await ctx.db.select().from(servers).where(eq(servers.autoSync, true))) {
          try {
            const r = await s.servers.sync(server.id);
            out[server.displayName] = `${r.accounts} accounts, ${r.unmanaged} unmanaged`;
          } catch (err) {
            out[server.displayName] = `failed: ${errorMessage(err)}`;
          }
          await job.log(`${server.displayName}: ${out[server.displayName]}`);
        }
        return out;
      },
    },
    reviews: {
      description: 'Starts scheduled access reviews, reminds reviewers and closes overdue campaigns',
      schedule: { cron: '15 * * * *' },
      attempts: 1,
      timeoutMs: 10 * 60_000,
      handler: async (job, ctx) => services(ctx).reviews.tick((l) => void job.log(l)),
    },
  },

  taskTypes: {
    sync: {
      async validate(config, ctx, auth) {
        auth.require(PERMISSIONS.servers);
        const { serverId } = syncTaskConfigSchema.parse(config);
        await services(ctx).servers.row(serverId);
      },
      async describe(config, ctx) {
        const { serverId } = syncTaskConfigSchema.parse(config);
        try {
          const server = await services(ctx).servers.row(serverId);
          return { label: `Inventory sync: ${server.displayName}`, href: `/dbaccess/servers/${server.id}` };
        } catch {
          return { label: 'Inventory sync: (server removed)', href: null };
        }
      },
      async run(config, task, ctx) {
        const { serverId } = syncTaskConfigSchema.parse(config);
        try {
          const r = await services(ctx).servers.sync(serverId, {
            log: (line) => task.log(line),
            signal: task.signal,
          });
          return {
            summary: `${r.accounts} accounts, ${r.roles} roles, ${r.memberships} memberships, ${r.unmanaged} unmanaged`,
            metrics: {
              accounts: r.accounts,
              roles: r.roles,
              memberships: r.memberships,
              unmanaged: r.unmanaged,
              orphans: r.orphans,
            },
            href: `/dbaccess/servers/${serverId}`,
          };
        } catch (err) {
          task.log(errorMessage(err), 'error');
          if (err instanceof HttpError) throw err;
          throw new Error(errorMessage(err));
        }
      },
    },
  },

  ai: aiTools,
  seed,
});
