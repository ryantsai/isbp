/**
 * Who may do what with a job — the one place the ownership rule lives (routes, AI tools, record resolvers
 * and the `viewer` block of the DTOs all use it).
 *
 * - `scheduler.jobs.read` sees every job, run and log.
 * - `scheduler.jobs.create` creates jobs, and edits, runs, cancels and deletes the jobs it owns or whose
 *   owner group it belongs to.
 * - `scheduler.jobs.manage` does all of that for every job; `scheduler.jobs.run` runs and cancels any job.
 * - Saving a job also needs its task type's permission (`scheduler.sql.run`, `scheduler.scripts.manage`,
 *   `etl.pipelines.run`…), checked by the task-type registry.
 */
import { groupMembers } from '@isbp/db/schema';
import type { AuthContext, Db } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';

export const READ = 'scheduler.jobs.read';
export const CREATE = 'scheduler.jobs.create';
export const MANAGE = 'scheduler.jobs.manage';
export const RUN = 'scheduler.jobs.run';
export const SQL = 'scheduler.sql.run';

export interface OwnedJob {
  ownerId: string | null;
  ownerGroupId: string | null;
}

export interface JobViewer {
  canEdit: boolean;
  canRun: boolean;
  canDelete: boolean;
}

/** The person behind a principal: the user, or the person an agent acts for. */
export const personOf = (auth: AuthContext): string | null =>
  auth.user?.id ?? auth.principal.onBehalfOf?.id ?? null;

const groupCache = new WeakMap<AuthContext, Promise<Set<string>>>();

/** Groups the caller is a direct member of (once per request / auth context). */
export function groupsOf(db: Db, auth: AuthContext): Promise<Set<string>> {
  const cached = groupCache.get(auth);
  if (cached) return cached;
  const me = personOf(auth);
  const result = me
    ? db
        .select({ id: groupMembers.groupId })
        .from(groupMembers)
        .where(eq(groupMembers.userId, me))
        .then((rows) => new Set(rows.map((r) => r.id)))
    : Promise.resolve(new Set<string>());
  groupCache.set(auth, result);
  return result;
}

export function ownsJob(auth: AuthContext, job: OwnedJob, groups: ReadonlySet<string>): boolean {
  const me = personOf(auth);
  return Boolean(me && (job.ownerId === me || (job.ownerGroupId && groups.has(job.ownerGroupId))));
}

/** What `auth` may do with `job` (pure; `groups` from {@link groupsOf}). */
export function viewerOf(auth: AuthContext, job: OwnedJob, groups: ReadonlySet<string>): JobViewer {
  const manage = auth.can(MANAGE);
  const own = auth.can(CREATE) && ownsJob(auth, job, groups);
  return { canEdit: manage || own, canRun: manage || own || auth.can(RUN), canDelete: manage || own };
}

export class JobAccess {
  constructor(private readonly db: Db) {}

  async viewer(auth: AuthContext, job: OwnedJob): Promise<JobViewer> {
    return viewerOf(auth, job, await groupsOf(this.db, auth));
  }

  /** 403 (an audited denial of `scheduler.jobs.manage`) unless the caller may edit the job. */
  async requireEdit(auth: AuthContext, job: OwnedJob): Promise<JobViewer> {
    const v = await this.viewer(auth, job);
    if (!v.canEdit) auth.require(MANAGE);
    return v;
  }

  /** 403 (an audited denial of `scheduler.jobs.run`) unless the caller may run or cancel the job. */
  async requireRun(auth: AuthContext, job: OwnedJob): Promise<JobViewer> {
    const v = await this.viewer(auth, job);
    if (!v.canRun) auth.require(RUN);
    return v;
  }
}
