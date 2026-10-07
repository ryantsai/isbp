import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { aiTools } from './ai';
import { records, search } from './records';
import { routes } from './routes';
import { seed } from './seed';
import { services } from './services';
import { httpTask, scriptTask, sqlTask } from './tasks';

export { type HistoryOptions, type SeedJobInput, seedJob, seedRunHistory } from './seed';
/** The service layer (tests and the platform seed). */
export { services } from './services';

/**
 * Scheduled jobs: the schedule lives in Postgres (`next_run_at`, claimed by the `tick` job with
 * `FOR UPDATE SKIP LOCKED`); `execute-run` runs one attempt through the task-type registry with heartbeat,
 * timeout, cancel, retries and live logs.
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  taskTypes: { http: httpTask, sql: sqlTask, script: scriptTask },

  events: {
    /** People who leave stop owning jobs (their owner group keeps them). */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      await services(ctx).jobs.releaseOwner(userId);
    },
  },

  jobs: {
    tick: {
      description:
        'Every 30 s: starts due scheduled runs, logs missed slots, fails runs whose worker stopped and re-queues lost runs',
      schedule: { everyMs: 30_000 },
      attempts: 3,
      timeoutMs: 5 * 60_000,
      handler: async (_job, ctx) => services(ctx).engine.tick(),
    },
    'execute-run': {
      description:
        'Runs one attempt of a job run (retries, timeouts and cancellation are handled by the engine)',
      concurrency: 8,
      attempts: 1,
      handler: async (job, ctx) =>
        services(ctx).engine.execute(job.data as { runId: string; attempt: number }),
    },
    purge: {
      description:
        'Daily: deletes runs and logs older than the retention period (keeps each job’s latest run)',
      schedule: { cron: '20 3 * * *', tz: 'Asia/Taipei' },
      attempts: 3,
      timeoutMs: 30 * 60_000,
      handler: async (job, ctx) => {
        const deleted = await services(ctx).engine.purge();
        if (deleted) await job.log(`${deleted} run(s) purged`);
        return { deleted };
      },
    },
  },

  ai: aiTools,
  records,
  search,
  seed,
});
