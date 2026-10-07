import { ErrorCodes, HttpError, httpErrors, type TaskTypeHandler } from '@isbp/sdk/server';
import type { PipelineTaskConfig } from '../contracts';
import { pipelineHref, runHref } from '../model';
import { PIPELINES_RUN } from './access';
import { executeRun } from './runner';
import { services } from './services';

/**
 * `etl.pipeline`: Scheduled Jobs runs a pipeline with the same runner as "Run now" (trigger `schedule`),
 * mirroring progress into the job's live log and honouring its timeout/cancel signal. A failed load fails
 * the job run (so the scheduler retries and alerts per its policy).
 */
export const pipelineTask: TaskTypeHandler<PipelineTaskConfig> = {
  async validate(config, ctx, auth) {
    const p = await services(ctx).pipelines.find(config.pipelineId);
    if (!p) throw httpErrors.notFound('Pipeline not found');
    if (!auth.can(PIPELINES_RUN))
      throw new HttpError(403, ErrorCodes.FORBIDDEN, 'Scheduling a pipeline needs etl.pipelines.run', {
        permission: PIPELINES_RUN,
      });
  },

  async describe(config, ctx) {
    const p = await services(ctx).pipelines.find(config.pipelineId);
    return { label: `Pipeline: ${p?.name ?? config.pipelineId}`, href: p ? pipelineHref(p.id) : null };
  },

  async run(config, task, ctx) {
    const s = services(ctx).pipelines;
    const pipeline = await s.find(config.pipelineId);
    if (!pipeline) throw httpErrors.notFound('Pipeline not found (deleted?)');
    task.log(`Pipeline ${pipeline.name}`);
    const queued = await s.queueRun(pipeline, 'schedule', { taskRunId: task.runId });
    const run = await executeRun(ctx, queued.id, {
      signal: task.signal,
      log: (m, level) => task.log(m, level),
    });
    const metrics = { rowsRead: run.rowsRead, rowsWritten: run.rowsWritten, rowsRejected: run.rowsRejected };
    if (run.status !== 'succeeded')
      throw new HttpError(422, ErrorCodes.INVALID_STATE, run.error ?? `Pipeline run ${run.status}`, {
        runId: run.id,
        href: runHref(pipeline.id, run.id),
        ...metrics,
      });
    return {
      summary: `${run.rowsWritten} rows written (${run.rowsRead} read, ${run.rowsRejected} rejected)`,
      metrics,
      href: runHref(pipeline.id, run.id),
    };
  },
};
