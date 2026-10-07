import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { aiTools } from './ai';
import { recordResolvers, searchItam } from './records';
import { routes } from './routes';
import { seedItam } from './seed';
import { services } from './services';
import { sync } from './sync';

/**
 * IT asset management: hardware through its lifecycle (with the disposal approval), software licences
 * and their compliance, contracts with renewal reminders, vendors and the model catalogue.
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  workflows: {
    'itam.disposal': {
      onCompleted: (result, ctx) => services(ctx).assets.onDisposalCompleted(result),
    },
  },

  events: {
    /**
     * Someone left: reclaim their licence seats (each audited), flag every device they still hold with a
     * `return_requested` entry and tell the asset managers. Devices stay deployed until returned.
     */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      const s = services(ctx);
      await s.licenses.reclaimSeats(userId);
      await s.assets.requestReturns(userId);
    },
  },

  jobs: {
    'renewal-reminders': {
      description:
        'Daily: keeps contract statuses current (auto-renewals, expiring, expired), sends renewal reminders and the warranty-expiry digest',
      schedule: { cron: '0 8 * * *', tz: 'Asia/Taipei' },
      attempts: 3,
      timeoutMs: 10 * 60_000,
      handler: async (job, ctx) => {
        const s = services(ctx);
        const contracts = await s.contracts.daily();
        const warranties = await s.assets.warrantyDigest();
        await job.log(
          `contracts: ${contracts.renewed} renewed, ${contracts.statusChanged} status changes, ${contracts.reminders} reminders; ${warranties} warranties in the digest`,
        );
        return { ...contracts, warranties };
      },
    },
    'compliance-recompute': {
      description:
        'Nightly: recomputes licence compliance (expiry dates move on even when nothing else changes)',
      schedule: { cron: '30 2 * * *', tz: 'Asia/Taipei' },
      attempts: 3,
      timeoutMs: 10 * 60_000,
      handler: async (job, ctx) => {
        const changed = await services(ctx).licenses.recomputeAll();
        if (changed) await job.log(`${changed} licence(s) changed compliance state`);
        return { changed };
      },
    },
  },

  ai: aiTools,
  records: recordResolvers,
  search: searchItam,
  sync,
  seed: seedItam,
});
