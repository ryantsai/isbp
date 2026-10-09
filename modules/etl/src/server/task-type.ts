import { ErrorCodes, HttpError, httpErrors, type TaskTypeHandler } from '@isbp/sdk/server';
import type { PipelineTaskConfig } from '../contracts';
import { pipelineHref, runHref } from '../model';
import { PIPELINES_RUN } from './access';
import { executeRun } from './runner';
import { services } from './services';

/**
 * `etl.pipeline`: Scheduled Jobs runs a pipeline with the same runner as "Run now" (trigger `schedule`),
 * mirroring progress into the job's live log and honouring its timeout/cancel signal. A failed load fails
 * the job run (so the scheduler retries and alerts per its policy). After the last attempt the pipeline's owner
 * is told too, unless the job's own alert reaches them (`task.failureRecipients`).
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
    const queued = await s.queueRun(pipeline, 'schedule', { taskRunId: task.runId, taskJobId: task.jobId });
    const run = await executeRun(ctx, queued.id, {
      signal: task.signal,
      log: (m, level) => task.log(m, level),
      // The pipeline's owner hears about the attempt the job gives up on, unless the job alerts them anyway.
      notify: task.attempt < (task.maxAttempts ?? 1) ? false : { except: task.failureRecipients ?? [] },
    });
    const metrics = { rowsRead: run.rowsRead, rowsWritten: run.rowsWritten, rowsRejected: run.rowsRejected };
    if (run.status !== 'succeeded')
      throw new HttpError(422, ErrorCodes.INVALID_STATE, run.error ?? `Pipeline run ${run.status}`, {
        runId: run.id,
        href: runHref(pipeline.id, run.id),
        // The job's run explains the failure as the pipeline's run does (which connection, what to do).
        problem: run.problem ?? undefined,
        ...metrics,
      });
    return {
      summary: 'etl.results.pipeline',
      summaryParams: { written: run.rowsWritten, read: run.rowsRead, rejected: run.rowsRejected },
      metrics,
      href: runHref(pipeline.id, run.id),
    };
  },
};
