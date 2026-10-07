/**
 * Who may do what — the one place the rules live, so routes, AI tools and jobs agree:
 *
 * - Everyone with `dbaccess.self.request` requests roles and sees and relinquishes their own access.
 * - Role owners (the person, or members of the owning group) may revoke grants of their roles early and
 *   review them in campaigns.
 * - `dbaccess.grants.read` sees all access; `dbaccess.grants.manage` revokes, adopts and retries.
 * - A person's manager sees that person's database access (people page).
 */
import { groupMembers, users } from '@isbp/db/schema';
import { type AuthContext, type Db, httpErrors, PermissionSet } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import { PERMISSIONS } from '../manifest';

export { PERMISSIONS };

/** Full access for the module's own background work (jobs, event handlers, workflow callbacks, seed). */
export function systemAuth(name = 'Database access'): AuthContext {
  const permissions = new PermissionSet([{ p: 'dbaccess.*', s: 'g' }]);
  return {
    principal: { type: 'system', id: null, name },
    user: null,
    sessionId: null,
    permissions,
    can: (permission, resource) => permissions.can(permission, resource),
    require(permission, resource) {
      if (!permissions.can(permission, resource)) throw httpErrors.forbidden();
    },
    reach: (permission) => permissions.reach(permission),
  };
}

/** The person behind a principal: the user, or the person an agent acts for. */
export const personOf = (auth: AuthContext): string | null =>
  auth.user?.id ?? auth.principal.onBehalfOf?.id ?? null;

/** Requires at least one of the permissions (at any scope); audits the denial like `auth.require`. */
export function requireAny(auth: AuthContext, permissions: readonly string[]) {
  if (permissions.some((p) => auth.permissions.hasAny(p))) return;
  auth.require(permissions[0]!);
}

const groupCache = new WeakMap<AuthContext, Promise<Set<string>>>();

/** Groups the caller is a direct member of (once per auth context). */
export function groupsOf(db: Db, auth: AuthContext): Promise<Set<string>> {
  const cached = groupCache.get(auth);
  if (cached) return cached;
  const me = personOf(auth);
  const result = me ? groupIdsOf(db, me) : Promise.resolve(new Set<string>());
  groupCache.set(auth, result);
  return result;
}

export async function groupIdsOf(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  return new Set(rows.map((r) => r.id));
}

export interface OwnedRole {
  ownerUserId: string | null;
  ownerGroupId: string | null;
}

export function isRoleOwner(me: string | null, role: OwnedRole, groups: ReadonlySet<string>): boolean {
  if (!me) return false;
  return role.ownerUserId === me || Boolean(role.ownerGroupId && groups.has(role.ownerGroupId));
}

/** The person's manager (`core.users.manager_id`). */
export async function managerOf(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ managerId: users.managerId }).from(users).where(eq(users.id, userId));
  return row?.managerId ?? null;
}
