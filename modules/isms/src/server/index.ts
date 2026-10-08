import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { aiTools } from './ai';
import { customizations } from './customizations';
import { ismsProcesses } from './packages/isms-processes';
import { processActions } from './process-actions';
import { recordResolvers, searchIsms } from './records';
import { routes } from './routes';
import { seedIsms } from './seed';
import { services } from './services';
import { systemAuth } from './support';

/**
 * Information security: the information asset register (configurable classes, C/I/A, numbering per site and class,
 * CSV import and export), stocktakes, shared accounts and account reviews.
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  events: {
    /** Someone left: off every shared account (password due), and their custodianships reported. */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      await services(ctx).accounts.onPersonChanged(userId, 'member_left', event.id, systemAuth());
    },
    /** Someone moved department: the passwords of the shared accounts they use are due. */
    'core.user.transferred': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      await services(ctx).accounts.onPersonChanged(userId, 'member_moved', event.id, systemAuth());
    },
  },

  jobs: {
    daily: {
      description:
        'Daily: opens scheduled stocktakes and account reviews, reminds people before due dates and when they pass, and tells custodians when a shared account review is due',
      schedule: { cron: '0 8 * * *', tz: 'Asia/Taipei' },
      attempts: 3,
      timeoutMs: 10 * 60_000,
      handler: async (job, ctx) => {
        const s = services(ctx);
        const log = (m: string) => void job.log(m);
        const stocktakes = await s.stocktakes.daily(log);
        const reviews = await s.reviews.daily(log);
        const accounts = await s.accounts.daily(log);
        return { stocktakes, reviews, accounts };
      },
    },
  },

  ai: aiTools,
  records: recordResolvers,
  search: searchIsms,
  processActions,
  customizations,
  customizationPackages: { 'isms-processes': ({ locale }) => ismsProcesses(locale) },
  seed: seedIsms,
});
