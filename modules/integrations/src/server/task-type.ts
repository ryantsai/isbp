import { ErrorCodes, HttpError, type TaskTypeHandler } from '@isbp/sdk/server';
import type { SyncTaskConfig } from '../contracts';
import { connectionHref, profileHref, runHref } from '../model';
import { MANAGE } from './access';
import { services } from './services';

/**
 * `integrations.sync`: Scheduled Jobs runs a profile's pull (an export for push-only profiles) to the end,
 * mirroring the sync run's log into the job's live log. A run that is already going is not doubled: the job
 * run says so and succeeds. A failed sync fails the job run (so its retries and alerts apply).
 */
export const syncTask: TaskTypeHandler<SyncTaskConfig> = {
  async validate(config, ctx, auth) {
    await services(ctx).profiles.row(config.profileId);
    if (!auth.can(MANAGE))
      throw new HttpError(
        403,
        ErrorCodes.FORBIDDEN,
        'Scheduling a sync needs integrations.connections.manage',
        {
          permission: MANAGE,
        },
      );
  },

  async describe(config, ctx) {
    try {
      const p = await services(ctx).profiles.row(config.profileId);
      return { label: `Sync: ${p.name}`, href: profileHref(p.connectionId, p.id) };
    } catch {
      return { label: `Sync: ${config.profileId}`, href: null };
    }
  },

  async run(config, task, ctx) {
    const s = services(ctx);
    const p = await s.profiles.row(config.profileId);
    task.log(`Sync profile ${p.name}`);
    try {
      const run = await s.engine.runNow(p.id, 'schedule', {
        signal: task.signal,
        onLog: (e) => task.log(e.message, e.level),
      });
      const c = run.counts;
      const summary = `${c.read} read, ${c.created + c.remoteCreated} created, ${c.updated} updated, ${c.pushed} pushed, ${c.conflicts} conflicts, ${c.errors} errors`;
      if (run.status === 'failed')
        throw new HttpError(422, ErrorCodes.INVALID_STATE, run.error ?? 'The sync failed', {
          runId: run.id,
          href: runHref(run.id),
        });
      if (run.status === 'waiting')
        task.log('The remote system is rate limiting; the sync continues on its own', 'warn');
      return {
        summary,
        metrics: {
          read: c.read,
          created: c.created + c.remoteCreated,
          updated: c.updated,
          pushed: c.pushed,
          conflicts: c.conflicts,
          errors: c.errors,
        },
        href: runHref(run.id),
      };
    } catch (err) {
      if (err instanceof HttpError && err.code === ErrorCodes.SYNC_RUNNING) {
        task.log('A sync of this profile is already running; nothing to do', 'warn');
        return { summary: 'Already running', href: connectionHref(p.connectionId) };
      }
      throw err;
    }
  },
};
