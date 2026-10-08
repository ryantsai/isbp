import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { profileCustomization } from './customizations';
import { routes } from './routes';
import { services } from './services';
import { syncTask } from './task-type';

export {
  connectionByName,
  createConnection,
  createProfile,
  hubAuth,
  registerDemoWebhook,
  runPullNow,
} from './seed';
/** The service layer (tests and the platform seed). */
export { services } from './services';
/** The pure profile validator (the API and the editor use it), e.g. to check connectors' default mappings. */
export { validateProfile as validateProfileMapping } from '../mapping';
export type { CatalogueField, MappingIssue, ProfileShape } from '../mapping';

/**
 * Integrations Hub: connections, sync profiles, the sync engine (pull, push, three-way merge, webhooks),
 * runs, links and conflicts. Local changes arrive through `onSyncChange` (every event a sync entity lists),
 * remote ones through the change feed (`tick` → `pull`) and webhooks (`webhook-items`).
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  taskTypes: { sync: syncTask },

  onSyncChange: async (change, ctx) => services(ctx).engine.onLocalChange(change),

  customizations: { profile: profileCustomization },

  jobs: {
    tick: {
      description:
        'Every minute: starts due scheduled pulls, fails runs whose worker stopped, re-queues lost runs and stalled pushes',
      schedule: { everyMs: 60_000 },
      attempts: 2,
      timeoutMs: 5 * 60_000,
      handler: async (_job, ctx) => services(ctx).engine.tick(),
    },
    pull: {
      description: 'Executes a sync run (pull, export or resync; a rate-limited run continues here)',
      concurrency: 4,
      attempts: 1,
      handler: async (job, ctx) => {
        const run = await services(ctx).engine.execute((job.data as { runId: string }).runId);
        return run ? { status: run.status } : { skipped: true };
      },
    },
    push: {
      description: 'Pushes the queued local changes of one profile (batched into one run)',
      attempts: 3,
      backoffMs: 5_000,
      handler: async (job, ctx) => {
        const run = await services(ctx).engine.drainPushes((job.data as { profileId: string }).profileId);
        return run ? { status: run.status } : { skipped: true };
      },
    },
    'webhook-items': {
      description: 'Re-reads the records a webhook named (the body is never trusted for data)',
      attempts: 1,
      handler: async (job, ctx) => {
        const run = await services(ctx).engine.execute((job.data as { runId: string }).runId);
        return run ? { status: run.status } : { skipped: true };
      },
    },
    'check-connections': {
      description: 'Every 15 minutes: tests each enabled connection and purges runs older than 30 days',
      schedule: { everyMs: 15 * 60_000 },
      attempts: 2,
      timeoutMs: 10 * 60_000,
      handler: async (_job, ctx) => services(ctx).engine.checkConnections(),
    },
  },
});
