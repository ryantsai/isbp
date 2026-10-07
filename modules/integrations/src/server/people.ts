import { groupMembers, roleAssignments, rolePermissions, users } from '@isbp/db/schema';
import { matchPermission, type Db, type ModuleContext } from '@isbp/sdk/server';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

/**
 * People lookups for conversions (remote people ↔ local users by email) and notifications (who holds a
 * permission). Results are cached per instance: create one per run.
 */
export class People {
  private readonly byEmail = new Map<string, Promise<string | null>>();
  private readonly byId = new Map<string, Promise<{ email: string; name: string } | null>>();

  constructor(private readonly db: Db) {}

  /** An active user by email, case-insensitive. */
  userIdByEmail(email: string): Promise<string | null> {
    const key = email.trim().toLowerCase();
    if (!key) return Promise.resolve(null);
    let p = this.byEmail.get(key);
    if (!p) {
      p = this.db
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${key}`, eq(users.status, 'active')))
        .limit(2)
        .then((rows) => (rows.length === 1 ? rows[0]!.id : null));
      this.byEmail.set(key, p);
    }
    return p;
  }

  user(id: string): Promise<{ email: string; name: string } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(null);
    let p = this.byId.get(id);
    if (!p) {
      p = this.db
        .select({ email: users.email, name: users.displayName })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      this.byId.set(id, p);
    }
    return p;
  }
}

/**
 * Active users who hold `permission` globally (directly or through a group), e.g. the integration
 * administrators who hear about failing connections.
 */
export async function holdersOf(ctx: ModuleContext, permission: string, limit = 200): Promise<string[]> {
  const patterns = await ctx.db
    .selectDistinct({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(or(eq(rolePermissions.permission, permission), sql`${rolePermissions.permission} like '%*%'`));
  const roleIds = [
    ...new Set(patterns.filter((p) => matchPermission(p.permission, permission)).map((p) => p.roleId)),
  ];
  if (!roleIds.length) return [];
  const rows = await ctx.db
    .select({ userId: roleAssignments.userId, memberId: groupMembers.userId })
    .from(roleAssignments)
    .leftJoin(groupMembers, eq(groupMembers.groupId, roleAssignments.groupId))
    .where(
      and(
        inArray(roleAssignments.roleId, roleIds),
        eq(roleAssignments.scopeType, 'global'),
        or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())),
      ),
    );
  const ids = [...new Set(rows.map((r) => r.userId ?? r.memberId).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return [];
  const active = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids.slice(0, 2_000)), eq(users.status, 'active')))
    .limit(limit);
  return active.map((u) => u.id);
}
