import { defineServerModule } from '@isbp/sdk/server';
import { eq, or } from 'drizzle-orm';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { ENDPOINT_TYPE, PIPELINE_TYPE } from './access';
import { aiTools } from './ai';
import { endpointCustomization, pipelineCustomization } from './customizations';
import { records, search } from './records';
import { routes } from './routes';
import { executeRun } from './runner';
import { endpoints, endpointVersions, pipelines } from './schema';
import { seed } from './seed';
import { services } from './services';
import { pipelineTask } from './task-type';

/**
 * Data APIs & ETL: REST endpoints over parameterized SQL and stored procedures, and ETL pipelines between
 * database connections — everything through the kernel's `ctx.databases`.
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  events: {
    /** A connection was deleted: flag the endpoints and pipelines that use it ("Connection missing"). */
    'core.db-connection.deleted': async (event, ctx) => {
      const { connectionId } = event.payload as { connectionId: string };
      const versionUsers = await ctx.db
        .selectDistinct({ id: endpointVersions.endpointId })
        .from(endpointVersions)
        .where(eq(endpointVersions.connectionId, connectionId));
      const draftUsers = await ctx.db
        .select({ id: endpoints.id })
        .from(endpoints)
        .where(eq(endpoints.connectionId, connectionId));
      const endpointIds = [...new Set([...versionUsers, ...draftUsers].map((r) => r.id))];
      const affectedPipelines = await ctx.db
        .select({ id: pipelines.id, name: pipelines.name, flagged: pipelines.connectionMissing })
        .from(pipelines)
        .where(
          or(eq(pipelines.sourceConnectionId, connectionId), eq(pipelines.targetConnectionId, connectionId)),
        );
      await ctx.transaction(async (tx) => {
        for (const id of endpointIds) {
          const [row] = await tx
            .update(endpoints)
            .set({ connectionMissing: true })
            .where(eq(endpoints.id, id))
            .returning({ name: endpoints.name });
          if (row)
            await ctx.audit.record(
              {
                action: 'etl.endpoint.connection_missing',
                entityType: ENDPOINT_TYPE,
                entityId: id,
                entityLabel: row.name,
                metadata: { connectionId },
              },
              { tx },
            );
        }
        for (const p of affectedPipelines) {
          if (p.flagged) continue;
          await tx.update(pipelines).set({ connectionMissing: true }).where(eq(pipelines.id, p.id));
          await ctx.audit.record(
            {
              action: 'etl.pipeline.connection_missing',
              entityType: PIPELINE_TYPE,
              entityId: p.id,
              entityLabel: p.name,
              metadata: { connectionId },
            },
            { tx },
          );
        }
      });
    },
  },

  jobs: {
    /** "Run now" (and AI tool) runs. Scheduled runs come through the task type instead. */
    'run-pipeline': {
      description: 'Runs a queued pipeline run',
      attempts: 1,
      timeoutMs: 6 * 3_600_000,
      concurrency: 2,
      handler: async (job, ctx) => {
        const { runId } = job.data as { runId: string };
        const run = await executeRun(ctx, runId, { log: (m) => void job.log(m) });
        return { status: run.status, rowsWritten: run.rowsWritten };
      },
    },
    /** Execution log retention (`logRetentionDays`). */
    'purge-logs': {
      description: 'Deletes Data API execution logs older than the retention setting',
      schedule: { cron: '30 3 * * *' },
      attempts: 2,
      handler: async (job, ctx) => {
        const deleted = await services(ctx).calls.purge();
        await job.log(`Deleted ${deleted} calls`);
        return { deleted };
      },
    },
  },

  taskTypes: { pipeline: pipelineTask },
  ai: aiTools,
  customizations: { pipeline: pipelineCustomization, endpoint: endpointCustomization },
  search,
  records,
  seed,
});
