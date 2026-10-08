import { createGroupSchema } from '@isbp/contracts';
import { groups } from '@isbp/db/schema';
import {
  type CustomizationHandler,
  type CustomizationIssue,
  localize,
  type ModuleContext,
} from '@isbp/sdk/server';
import { asc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { getKernel } from '../kernel-ref';
import { DirectoryService } from '../services/directory';
import { likePattern } from '../util';
import { isUuid } from './shared';

const schema = z.object({
  key: createGroupSchema.shape.key.describe(
    'Unique key, a lowercase slug such as "information-security-committee". Workflows (approvers { "type": "group", "groupKey" }), forms (audience) and assignments name the group by it. Fixed after creation.',
  ),
  name: createGroupSchema.shape.name.describe(
    'Name people see in pickers, approval inboxes and the group list',
  ),
  description: createGroupSchema.shape.description.describe('What the group is for (optional)'),
  attributes: z
    .record(z.string().max(64), z.unknown())
    .default({})
    .describe('Values of the custom fields on groups (reference.customFields), by field key'),
});
export type GroupValue = z.output<typeof schema>;

type GroupRow = typeof groups.$inferSelect;

async function findGroup(ctx: ModuleContext, id: string): Promise<GroupRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await ctx.db.select().from(groups).where(eq(groups.id, id));
  return row ?? null;
}

const valueOf = (g: GroupRow): GroupValue => ({
  key: g.key,
  name: g.name,
  description: g.description,
  attributes: g.attributes ?? {},
});

/** JSON with sorted keys: attribute objects compare equal whatever order they were built in. */
const sameJson = (a: unknown, b: unknown) => {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
              .map(([k, x]) => [k, canon(x)]),
          )
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
};

const INSTRUCTIONS = `A group is a named set of people: an approval team, a committee, a support group. Value: key (lowercase slug, fixed after creation), name, description, attributes (values of the custom fields on groups, reference.customFields).
Other configuration names a group by its key: workflow approvers { "type": "group", "groupKey": "<key>" }, form audiences, form assignments, a CI's support group. To use a new group in a workflow of the same change set, propose the group first: later items are checked after it, so its key is known by then.
Members are people, not configuration: they are never part of this kind. After the change set is applied, an administrator adds people on the group's page (Administration → Groups), or the identity provider's directory sync fills it. Roles are given to a group on the Roles page or through access requests, not here.
Existing groups are in reference.groups (source "local" are made here; "oidc", "saml" and "ldap" come from an identity provider, whose next sync may rename them). Deleting a group also removes its memberships and the roles given to it; system groups (such as Everyone) can't be deleted (SYSTEM_GROUP).`;

const example: GroupValue = {
  key: 'information-security-committee',
  name: 'Information security committee',
  description: 'Reviews information security exceptions and approves high-risk access',
  attributes: {},
};

export const groupKind: CustomizationHandler<GroupValue> = {
  schema,

  async guide(ctx) {
    const [list, fields] = await Promise.all([
      ctx.db
        .select({
          key: groups.key,
          name: groups.name,
          description: groups.description,
          source: groups.source,
          system: groups.isSystem,
        })
        .from(groups)
        .orderBy(asc(groups.name))
        .limit(200),
      ctx.fields.definitions('core.group'),
    ]);
    return {
      instructions: INSTRUCTIONS,
      reference: {
        groups: list,
        customFields: fields.map((f) => ({
          key: f.key,
          type: f.type,
          label: localize(f.label, 'en'),
          required: !!f.required,
          ...(f.options ? { options: f.options.map((o) => o.value) } : {}),
        })),
      },
      examples: [
        { description: 'A committee that approves information security exceptions', value: example },
      ],
    };
  },

  async list({ q, limit }, ctx) {
    const rows = await ctx.db
      .select()
      .from(groups)
      .where(q ? or(ilike(groups.name, likePattern(q)), ilike(groups.key, likePattern(q))) : undefined)
      .orderBy(asc(groups.name))
      .limit(limit);
    return rows.map((g) => ({
      id: g.id,
      label: g.name,
      description: `${g.key}${g.isSystem ? ' (system)' : ''}${g.source !== 'local' ? ` · ${g.source}` : ''}${g.description ? ` · ${g.description}` : ''}`,
      href: `/admin/groups/${g.id}`,
    }));
  },

  async get(id, ctx) {
    const g = await findGroup(ctx, id);
    if (!g) return null;
    return {
      id: g.id,
      label: g.name,
      description: g.description,
      href: `/admin/groups/${g.id}`,
      value: valueOf(g),
    };
  },

  async check(change, ctx) {
    if (change.op !== 'create' && change.op !== 'update') return [];
    const v = change.value!;
    const issues: CustomizationIssue[] = [];
    if (change.op === 'create') {
      const [taken] = await ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.key, v.key));
      if (taken)
        issues.push({
          path: 'key',
          code: 'duplicate_key',
          message: `A group with the key "${v.key}" exists`,
        });
    } else {
      const current = (await findGroup(ctx, change.id!))!;
      if (current.key !== v.key)
        issues.push({
          path: 'key',
          code: 'immutable',
          message: `The key of a group cannot change (it is "${current.key}")`,
        });
    }
    return issues;
  },

  async apply(change, ctx, auth) {
    const directory = new DirectoryService(ctx);
    const v = change.value;
    switch (change.op) {
      case 'create': {
        const g = await directory.createGroup(
          { key: v!.key, name: v!.name, description: v!.description ?? null, attributes: v!.attributes },
          auth,
        );
        return { id: g.id };
      }
      case 'update': {
        const before = valueOf((await findGroup(ctx, change.id!))!);
        const same =
          before.name === v!.name &&
          before.description === (v!.description ?? null) &&
          sameJson(before.attributes, v!.attributes);
        // The service audits every call: skip no-ops (applying `get().value` changes nothing).
        if (!same)
          await directory.updateGroup(
            change.id!,
            { name: v!.name, description: v!.description ?? null, attributes: v!.attributes },
            auth,
          );
        return { id: change.id! };
      }
      case 'delete':
        await directory.deleteGroup(change.id!, auth);
        return { id: change.id! };
      default:
        throw new Error(`core.group does not support ${change.op}`);
    }
  },

  /** Deleting a group drops the roles given to it: refresh cached permissions once that is committed. */
  async committed(change) {
    if (change.op === 'delete') await getKernel().rbac.bump();
  },
};
