import { createRoleSchema, permissionPatternSchema } from '@isbp/contracts';
import { applications, permissions, roles } from '@isbp/db/schema';
import {
  type CustomizationHandler,
  type CustomizationIssue,
  type Db,
  matchPermission,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { PLATFORM_APP_KEY } from '../../kernel/rbac';
import { likePattern } from '../util';
import { AccessService } from '../services/access';
import { catalogText, isUuid } from './shared';

const schema = z.object({
  key: createRoleSchema.shape.key.describe(
    'Unique key, a lowercase slug such as "access-reviewer". Fixed after creation.',
  ),
  name: createRoleSchema.shape.name.describe('Name people see when roles are assigned or requested'),
  description: createRoleSchema.shape.description.describe('What the role is for (optional)'),
  permissions: z
    .array(permissionPatternSchema)
    .max(500)
    .transform((list) => [...new Set(list)].sort())
    .describe(
      'Permission keys or patterns from reference.permissions, e.g. itsm.tickets.read or core.users.*',
    ),
});
export type RoleValue = z.output<typeof schema>;

/** A role of the platform itself (application roles belong to their application's admins). */
async function findPlatformRole(ctx: ModuleContext, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await ctx.db
    .select({ id: roles.id })
    .from(roles)
    .innerJoin(applications, eq(applications.id, roles.applicationId))
    .where(and(eq(roles.id, id), eq(applications.key, PLATFORM_APP_KEY)));
  return row ? new AccessService(ctx).getRole(row.id) : null;
}

const valueOf = (role: { key: string; name: string; description: string | null; permissions: string[] }) => ({
  key: role.key,
  name: role.name,
  description: role.description,
  permissions: [...new Set(role.permissions)].sort(),
});

/** Every permission key of the platform, deprecated ones included (roles may still hold them). */
async function permissionKeys(db: Db): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(permissions)
    .innerJoin(applications, eq(applications.id, permissions.applicationId))
    .where(eq(applications.key, PLATFORM_APP_KEY));
  return rows.map((r) => r.key);
}

const INSTRUCTIONS = `A role is a named set of permissions; people and groups receive roles through assignments and access requests (not part of this kind). Value: key (lowercase slug, fixed after creation), name, description, permissions.
Permissions are module.resource.action keys from reference.permissions (each with what it allows and the scopes it can be granted at). A * matches any one segment, and a trailing * every remaining one: core.users.* (every action on people), core.* (all of core), *.*.read (read everything). Grant the least the role needs: prefer read permissions and specific actions over wildcards.
Roles here are platform-wide. Applying is refused with PRIVILEGE_ESCALATION when the person applying does not hold every permission the change adds; system roles (defined by modules, reference.systemRoles) are read-only (SYSTEM_ROLE_READONLY), so build a new role instead of changing one.`;

const example: RoleValue = {
  key: 'access-reviewer',
  name: 'Access reviewer',
  description: 'Reviews who has which access, without changing it',
  permissions: ['core.access-requests.read', 'core.roles.read', 'core.users.read'],
};

export const roleKind: CustomizationHandler<RoleValue> = {
  schema,

  async guide(ctx) {
    const access = new AccessService(ctx);
    const [catalog, systemRoles] = await Promise.all([
      access.permissionCatalog(),
      ctx.db
        .select({ key: roles.key, name: roles.name })
        .from(roles)
        .innerJoin(applications, eq(applications.id, roles.applicationId))
        .where(and(eq(applications.key, PLATFORM_APP_KEY), eq(roles.isSystem, true)))
        .orderBy(asc(roles.key)),
    ]);
    const permissionList = await Promise.all(
      catalog.map(async (p) => ({
        key: p.key,
        module: p.moduleId,
        description: await catalogText(p.description),
        scopes: p.scopes,
      })),
    );
    return {
      instructions: INSTRUCTIONS,
      reference: { permissions: permissionList, systemRoles },
      examples: [
        {
          description: 'Read-only access to people, roles and access requests, for periodic access reviews',
          value: example,
        },
      ],
    };
  },

  async list({ q, limit }, ctx) {
    const rows = await ctx.db
      .select({ r: roles })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .where(
        and(
          eq(applications.key, PLATFORM_APP_KEY),
          q ? or(ilike(roles.name, likePattern(q)), ilike(roles.key, likePattern(q))) : undefined,
        ),
      )
      .orderBy(asc(roles.name))
      .limit(limit);
    return rows.map(({ r }) => ({
      id: r.id,
      label: r.name,
      description: `${r.key}${r.isSystem ? ' (system, read-only)' : ''}${r.description ? ` · ${r.description}` : ''}`,
      href: `/admin/roles/${r.id}`,
    }));
  },

  async get(id, ctx) {
    const role = await findPlatformRole(ctx, id);
    if (!role) return null;
    return {
      id: role.id,
      label: role.name,
      description: role.description,
      href: `/admin/roles/${role.id}`,
      value: valueOf(role),
    };
  },

  async check(change, ctx) {
    if (change.op !== 'create' && change.op !== 'update') return [];
    const v = change.value!;
    const issues: CustomizationIssue[] = [];
    let held: string[] = [];
    if (change.op === 'create') {
      const [taken] = await ctx.db
        .select({ id: roles.id })
        .from(roles)
        .innerJoin(applications, eq(applications.id, roles.applicationId))
        .where(and(eq(applications.key, PLATFORM_APP_KEY), eq(roles.key, v.key)));
      if (taken)
        issues.push({ path: 'key', code: 'duplicate_key', message: `A role with the key "${v.key}" exists` });
    } else {
      const current = (await findPlatformRole(ctx, change.id!))!;
      held = current.permissions;
      if (current.key !== v.key)
        issues.push({
          path: 'key',
          code: 'immutable',
          message: `The key of a role cannot change (it is "${current.key}")`,
        });
    }
    // Only added permissions are checked: a role may still hold keys of a module that was removed.
    const known = await permissionKeys(ctx.db);
    v.permissions.forEach((p, i) => {
      if (held.includes(p)) return;
      if (p.includes('*') ? !known.some((k) => matchPermission(p, k)) : !known.includes(p))
        issues.push({
          path: `permissions.${i}`,
          code: 'unknown_permission',
          message: `"${p}" matches no permission: use keys from reference.permissions`,
        });
    });
    return issues;
  },

  async apply(change, ctx, auth) {
    const access = new AccessService(ctx);
    const v = change.value;
    switch (change.op) {
      case 'create': {
        const role = await access.createRole(
          { key: v!.key, name: v!.name, description: v!.description ?? null, permissions: v!.permissions },
          auth,
        );
        return { id: role.id };
      }
      case 'update': {
        const before = valueOf(await access.getRole(change.id!));
        const same =
          before.name === v!.name &&
          before.description === (v!.description ?? null) &&
          JSON.stringify(before.permissions) === JSON.stringify(v!.permissions);
        // The service audits and invalidates every cached permission set on each call: skip no-ops.
        if (!same)
          await access.updateRole(
            change.id!,
            { name: v!.name, description: v!.description ?? null, permissions: v!.permissions },
            auth,
          );
        return { id: change.id! };
      }
      case 'delete':
        await access.deleteRole(change.id!);
        return { id: change.id! };
      default:
        throw new Error(`core.role does not support ${change.op}`);
    }
  },
};
