/**
 * Who may do what with an application — the one place the ownership rule lives. Routes, AI tools, record
 * resolvers and the `viewer` block of the DTOs all use it, so the UI and the API can never disagree.
 *
 * - `alm.apps.manage` edits any application, environment and repository; `alm.releases.manage` any release.
 * - The business owner, the technical owner and members of the application's team group edit their own
 *   application, environments, repositories and releases with only `alm.apps.read`.
 * - Recording deployments always needs `alm.deployments.create` (people and CI/CD API clients);
 *   overriding the change policy needs `alm.deployments.override`.
 */
import { groupMembers } from '@isbp/db/schema';
import type { AuthContext, Db } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import type { AppViewer } from '../contracts';

export const READ = 'alm.apps.read';
export const MANAGE = 'alm.apps.manage';
export const RELEASES = 'alm.releases.manage';
export const DEPLOY = 'alm.deployments.create';
export const OVERRIDE = 'alm.deployments.override';

export interface OwnedApp {
  businessOwnerId: string | null;
  technicalOwnerId: string | null;
  teamGroupId: string | null;
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

export function isOwnerOf(auth: AuthContext, app: OwnedApp, groups: ReadonlySet<string>): boolean {
  const me = personOf(auth);
  if (!me) return false;
  return (
    app.businessOwnerId === me ||
    app.technicalOwnerId === me ||
    Boolean(app.teamGroupId && groups.has(app.teamGroupId))
  );
}

/** What `auth` may do with `app` (pure; `groups` from {@link groupsOf}). */
export function viewerOf(auth: AuthContext, app: OwnedApp, groups: ReadonlySet<string>): AppViewer {
  const owner = isOwnerOf(auth, app, groups) && auth.can(READ);
  return {
    isOwner: owner,
    canEdit: owner || auth.can(MANAGE),
    canManageReleases: owner || auth.can(RELEASES),
    canDeploy: auth.can(DEPLOY),
    canOverride: auth.can(OVERRIDE),
  };
}

export class AppAccess {
  constructor(private readonly db: Db) {}

  async viewer(auth: AuthContext, app: OwnedApp): Promise<AppViewer> {
    return viewerOf(auth, app, await groupsOf(this.db, auth));
  }

  /** 403 (and an audited denial of `alm.apps.manage`) unless the caller may edit the application. */
  async requireEdit(auth: AuthContext, app: OwnedApp): Promise<AppViewer> {
    const viewer = await this.viewer(auth, app);
    if (!viewer.canEdit) auth.require(MANAGE);
    return viewer;
  }

  /** 403 (and an audited denial of `alm.releases.manage`) unless the caller may edit its releases. */
  async requireReleases(auth: AuthContext, app: OwnedApp): Promise<AppViewer> {
    const viewer = await this.viewer(auth, app);
    if (!viewer.canManageReleases) auth.require(RELEASES);
    return viewer;
  }
}
