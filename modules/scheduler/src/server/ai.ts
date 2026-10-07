import type { AiToolHandler } from '@isbp/sdk/server';
import type { JobSummaryOut } from '../contracts';
import { aiListJobsInput, aiRunJobInput } from '../contracts';
import { jobHref, runHref } from '../model';
import { services } from './services';

/** Plain values a model can quote, plus a link for the UI. */
const compact = (j: JobSummaryOut) => ({
  reference: j.reference,
  name: j.name,
  type: j.type,
  task: j.task.label,
  trigger:
    j.trigger.kind === 'cron'
      ? `cron "${j.trigger.cron}" (${j.trigger.timezone})`
      : j.trigger.kind === 'interval'
        ? `every ${j.trigger.intervalMinutes} minutes`
        : j.trigger.kind === 'after'
          ? `after ${j.trigger.upstream.map((u) => u.name).join(', ')} (${j.trigger.mode})`
          : 'manual',
  enabled: j.enabled,
  nextRunAt: j.nextRunAt,
  lastRun: j.lastRun && {
    status: j.lastRun.status,
    at: j.lastRun.finishedAt ?? j.lastRun.scheduledFor,
    summary: j.lastRun.summary,
  },
  failureStreak: j.failureStreak,
  owner: j.owner?.displayName ?? null,
  ownerGroup: j.ownerGroup?.name ?? null,
  href: jobHref(j.id),
});

/** Handlers of `manifest.ai.tools` (input validated against the manifest schemas). */
export const aiTools: Record<string, AiToolHandler> = {
  'scheduler.list_jobs': async (input, ctx, auth) => {
    const { query, status, limit } = aiListJobsInput.parse(input);
    const page = await services(ctx).jobs.list(
      {
        page: 1,
        pageSize: limit,
        q: query || undefined,
        view:
          status === 'failing'
            ? 'failing'
            : status === 'running'
              ? 'running'
              : status === 'disabled'
                ? 'disabled'
                : undefined,
        enabled: status === 'enabled' ? true : undefined,
        sort: status === 'failing' ? '-failureStreak' : 'name',
      },
      auth,
    );
    return { total: page.total, jobs: page.items.map(compact) };
  },

  'scheduler.run_job': async (input, ctx, auth) => {
    const { job: ref } = aiRunJobInput.parse(input);
    const s = services(ctx);
    const job = await s.jobs.resolve(ref);
    const run = await s.jobs.run(job.id, auth);
    return { job: job.name, runId: run.id, status: run.status, href: runHref(run.id) };
  },
};
