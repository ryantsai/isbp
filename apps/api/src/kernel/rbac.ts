import { users } from '@isbp/db/schema';
import { type Grant, PermissionSet, type RbacReader } from '@isbp/sdk/server';
import type { Db } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

export const PLATFORM_APP_KEY = 'isbp';
export const EVERYONE_GROUP_KEY = 'everyone';

const VERSION_KEY = 'isbp:rbac:version';
const MAX_TTL_SECONDS = 600;

export type AssignmentSourceRow = {
  assignment_id: string;
  role_id: string;
  role_key: string;
  role_name: string;
  /** Set for roles a module's manifest declares. */
  role_module_id: string | null;
  permission: string;
  user_id: string | null;
  group_id: string | null;
  group_key: string | null;
  group_name: string | null;
  scope_type: 'global' | 'department' | 'record';
  scope_department_id: string | null;
  department_path: string | null;
  department_name: string | null;
  scope_record_type: string | null;
  scope_record_id: string | null;
  expires_at: Date | null;
};

/**
 * Resolves effective permissions: direct assignments ∪ group assignments ∪ the implicit "everyone"
 * group, skipping expired grants. Department scopes are expanded to their full subtree once, then
 * the compiled snapshot is cached in Redis under a global version counter — any RBAC change bumps the
 * version, which invalidates every snapshot on every replica at once.
 */
export class RbacService implements Pick<RbacReader, 'permissionsFor'> {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
  ) {}

  async bump(): Promise<void> {
    await this.redis.incr(VERSION_KEY);
  }

  async permissionsFor(userId: string): Promise<PermissionSet> {
    const version = (await this.redis.get(VERSION_KEY)) ?? '0';
    const key = `isbp:rbac:grants:${userId}:${version}`;
    const cached = await this.redis.get(key);
    if (cached) return new PermissionSet(JSON.parse(cached) as Grant[]);
    const { grants, ttl } = await this.compute(userId);
    await this.redis.set(key, JSON.stringify(grants), 'EX', ttl);
    return new PermissionSet(grants);
  }

  async assignmentSources(userId: string): Promise<AssignmentSourceRow[]> {
    const result = await this.db.execute<AssignmentSourceRow>(sql`
      select ra.id as assignment_id, r.id as role_id, r.key as role_key, r.name as role_name,
             r.module_id as role_module_id, rp.permission,
             ra.user_id, ra.group_id, g.key as group_key, g.name as group_name,
             ra.scope_type, ra.scope_department_id, d.path as department_path, d.name as department_name,
             ra.scope_record_type, ra.scope_record_id, ra.expires_at
        from core.role_assignments ra
        join core.roles r on r.id = ra.role_id
        join core.applications app on app.id = r.application_id and app.key = ${PLATFORM_APP_KEY}
        join core.role_permissions rp on rp.role_id = r.id
        left join core.groups g on g.id = ra.group_id
        left join core.departments d on d.id = ra.scope_department_id
       where (ra.expires_at is null or ra.expires_at > now())
         and (ra.user_id = ${userId}
              or ra.group_id in (select gm.group_id from core.group_members gm where gm.user_id = ${userId})
              or ra.group_id in (select eg.id from core.groups eg where eg.key = ${EVERYONE_GROUP_KEY} and eg.is_system))
       order by r.key, rp.permission`);
    return result.rows;
  }

  async compute(userId: string): Promise<{ grants: Grant[]; ttl: number }> {
    const [user] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'active') return { grants: [], ttl: 60 };

    const rows = await this.assignmentSources(userId);
    const subtreeCache = new Map<string, string[]>();
    const subtree = async (path: string) => {
      let ids = subtreeCache.get(path);
      if (!ids) {
        const res = await this.db.execute<{ id: string }>(
          sql`select id from core.departments where path like ${`${path}%`}`,
        );
        ids = res.rows.map((r) => r.id);
        subtreeCache.set(path, ids);
      }
      return ids;
    };

    const global = new Set<string>();
    const departments = new Map<string, Set<string>>();
    const records = new Map<string, { t: string; id: string }>();
    let ttl = MAX_TTL_SECONDS;
    const now = Date.now();

    for (const row of rows) {
      if (row.expires_at) {
        ttl = Math.min(ttl, Math.max(5, Math.ceil((new Date(row.expires_at).getTime() - now) / 1000)));
      }
      if (row.scope_type === 'global') global.add(row.permission);
      else if (row.scope_type === 'department' && row.department_path) {
        const set = departments.get(row.permission) ?? new Set<string>();
        (await subtree(row.department_path)).forEach((id) => set.add(id));
        departments.set(row.permission, set);
      } else if (row.scope_type === 'record' && row.scope_record_type && row.scope_record_id) {
        records.set(`${row.permission}|${row.scope_record_type}|${row.scope_record_id}`, {
          t: row.scope_record_type,
          id: row.scope_record_id,
        });
      }
    }

    const grants: Grant[] = [...global].map((p) => ({ p, s: 'g' as const }));
    for (const [p, ids] of departments) if (!global.has(p)) grants.push({ p, s: 'd', d: [...ids] });
    for (const [key, r] of records) {
      const p = key.split('|')[0]!;
      if (!global.has(p)) grants.push({ p, s: 'r', t: r.t, id: r.id });
    }
    return { grants, ttl };
  }
}
