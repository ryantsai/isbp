import {
  type CustomizationHandler,
  type CustomizationIssue,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createProfileSchema } from '../contracts';
import { CONFLICT_POLICIES, DIRECTIONS, FILTER_OPS, LIMITS, profileHref } from '../model';
import { connections, profiles } from './schema';
import { services } from './services';
import type { ProfileRow } from './session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const c = createProfileSchema.shape;

/** What syncs with what: fixed when the profile is created. */
const BINDING = ['connectionId', 'objectType', 'remoteScope', 'entity', 'containerId'] as const;

/** The profile form without `enabled`: a disabled profile is an archived one. */
export const profileValueSchema = z.object({
  connectionId: c.connectionId.describe(
    'The connection to the outside system (see the guide). Fixed after creation',
  ),
  objectType: c.objectType.describe('The remote object type, e.g. request or workitem. Fixed after creation'),
  remoteScope: c.remoteScope.describe(
    'Where in the remote system (a project) for scoped object types, else null. Fixed after creation',
  ),
  entity: c.entity.describe('The ISBP sync entity, e.g. itsm.ticket. Fixed after creation'),
  containerId: c.containerId.describe(
    'Where in ISBP (e.g. an ALM application) for entities with a container, else null. Fixed after creation',
  ),
  name: c.name.describe('Profile name'),
  direction: c.direction.describe('pull (remote → ISBP), push (ISBP → remote) or both'),
  createLocal: c.createLocal.describe('Pulling creates ISBP records for remote records not linked yet'),
  createRemote: c.createRemote.describe(
    'Pushing creates remote records for new ISBP records that pass pushFilter',
  ),
  matchRule: c.matchRule.describe(
    'Before creating, link a record whose local field equals the remote field ({ local, remote }), or null',
  ),
  pushFilter: c.pushFilter.describe(
    'Conditions on local fields an ISBP record must meet to be created remotely',
  ),
  mappings: c.mappings.describe(
    'Field mappings { local, remote, direction, values? }; `values` maps choice values ({ remote, local, direction? })',
  ),
  conflictPolicy: c.conflictPolicy.describe(
    'Both sides changed a field: manual (conflict queue), remote, local or newest wins',
  ),
  comments: c.comments.describe('Sync comments too (when the remote object and the entity support them)'),
  intervalMinutes: c.intervalMinutes.describe(
    'Minutes between scheduled pulls; 0 = only "Run now", webhooks and Scheduled Jobs',
  ),
});
export type ProfileValue = z.infer<typeof profileValueSchema>;

async function rowOf(ctx: ModuleContext, id: string): Promise<ProfileRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await ctx.db.select().from(profiles).where(eq(profiles.id, id));
  return row ?? null;
}

function valueOf(p: ProfileRow): ProfileValue {
  return {
    connectionId: p.connectionId,
    objectType: p.objectType,
    remoteScope: p.remoteScope,
    entity: p.entity,
    containerId: p.containerId,
    name: p.name,
    direction: p.direction,
    createLocal: p.createLocal,
    createRemote: p.createRemote,
    matchRule: p.matchRule ?? null,
    pushFilter: p.pushFilter,
    mappings: p.mappings,
    conflictPolicy: p.conflictPolicy,
    comments: p.comments,
    intervalMinutes: p.intervalMinutes,
  };
}

const summary = (
  p: Pick<ProfileRow, 'id' | 'name' | 'connectionId' | 'objectType' | 'entity' | 'enabled'>,
) => ({
  id: p.id,
  label: p.name,
  description: `${p.objectType} ↔ ${p.entity}`,
  archived: !p.enabled,
  href: profileHref(p.connectionId, p.id),
});

/** The connections, their connectors' objects and suggested mappings, and the entities, for the guide. */
async function reference(ctx: ModuleContext) {
  const s = services(ctx);
  const rows = await ctx.db.select().from(connections).orderBy(asc(connections.name));
  const connectors = new Map(ctx.connectors.list().map((info) => [info.type, info]));
  const entities = ctx.sync.entities();
  const out = [];
  for (const row of rows) {
    const info = connectors.get(row.type);
    const objects = [];
    for (const o of info?.objects ?? []) {
      let scopes: { id: string; name: string }[] | undefined;
      const defaults: Record<string, unknown> = {};
      try {
        const conn = s.connections.open(row, AbortSignal.timeout(5_000));
        for (const entity of o.entities) defaults[entity] = conn.defaultMapping(o.type, entity);
        // Scopes come from the remote system (a read); a system that can't answer leaves them out.
        if (o.scoped && row.enabled)
          scopes = (await conn.scopes(o.type)).map((x) => ({ id: x.id, name: x.name }));
      } catch {
        /* the connector's module is off or the system is unreachable */
      }
      objects.push({
        type: o.type,
        entities: o.entities,
        scoped: o.scoped,
        capabilities: o.capabilities,
        ...(scopes ? { scopes } : {}),
        defaultMappings: defaults,
      });
    }
    out.push({ id: row.id, name: row.name, type: row.type, enabled: row.enabled, objects });
  }
  const fields: Record<string, unknown> = {};
  for (const e of entities) {
    if (e.container) continue;
    try {
      fields[e.entity] = (await ctx.sync.fields(e.entity)).map((f) => ({
        key: f.key,
        type: f.type,
        ...(f.required ? { required: true } : {}),
        ...(f.readOnly ? { readOnly: true } : {}),
        ...(f.createOnly ? { createOnly: true } : {}),
        ...(f.choices ? { choices: f.choices.map((x) => x.value) } : {}),
      }));
    } catch {
      /* listed without fields */
    }
  }
  return {
    connections: out,
    entities: entities.map((e) => ({
      entity: e.entity,
      permission: e.permission,
      container: e.container,
      comments: e.comments,
      matchKeys: e.matchKeys,
      fields: fields[e.entity] ?? null,
    })),
    directions: DIRECTIONS,
    conflictPolicies: CONFLICT_POLICIES,
    filterOps: FILTER_OPS,
    limits: { mappings: LIMITS.mappings, valueMap: LIMITS.valueMap, filters: LIMITS.filters },
  };
}

/** `integrations.profile`: a sync profile, live on apply; archiving disables it. */
export const profileCustomization: CustomizationHandler<ProfileValue> = {
  schema: profileValueSchema,

  async guide(ctx) {
    const ref = await reference(ctx);
    return {
      instructions: [
        'A sync profile pairs one remote object type of a connection (a ServiceDesk Plus request, an Azure DevOps work item) with one ISBP sync entity (itsm.ticket …) and maps their fields. connectionId, objectType, remoteScope, entity and containerId are fixed once the profile exists.',
        'Start from the connector’s suggested mapping in `defaultMappings` for the object and entity, then adjust. A mapping row is { local, remote, direction } with direction both, pull or push (narrowed by the profile’s direction); each local and each remote field appears in one row. Read-only local fields can only push; create-only ones are written when a record is created.',
        'Choice fields map values with `values` rows { remote, local, direction? }: several remote values may pull into one local value (pull rows), and each local value has one row that pushes. Unmapped values are left alone.',
        'Applying checks the mappings against both field catalogues (the remote one is read from the outside system) and needs the entity’s `.sync` permission. Applying makes the profile live (enabled: it syncs on its interval); archive disables it, restore enables it again. Deleting a profile drops its links but never deletes records on either side.',
      ].join('\n'),
      reference: ref,
      examples: [
        {
          description: 'Pull ServiceDesk Plus requests into service desk tickets every 15 minutes',
          value: {
            connectionId:
              ref.connections.find((c) => c.type === 'sdp.server')?.id ??
              '0190a0a0-0000-7000-8000-000000000001',
            objectType: 'request',
            remoteScope: null,
            entity: 'itsm.ticket',
            containerId: null,
            name: 'SDP requests',
            direction: 'pull',
            createLocal: true,
            createRemote: false,
            matchRule: null,
            pushFilter: [],
            mappings: [
              { local: 'title', remote: 'subject', direction: 'both' },
              { local: 'description', remote: 'description', direction: 'both' },
              {
                local: 'priority',
                remote: 'priority',
                direction: 'both',
                values: [
                  { remote: 'High', local: '1' },
                  { remote: 'Medium', local: '2' },
                  { remote: 'Normal', local: '3' },
                  { remote: 'Low', local: '4' },
                ],
              },
            ],
            conflictPolicy: 'manual',
            comments: false,
            intervalMinutes: 15,
          },
        },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx) {
    const rows = await ctx.db
      .select()
      .from(profiles)
      .where(
        and(
          includeArchived ? undefined : eq(profiles.enabled, true),
          q ? ilike(profiles.name, likePattern(q)) : undefined,
        ),
      )
      .orderBy(sql`lower(${profiles.name})`, asc(profiles.id))
      .limit(limit);
    return rows.map(summary);
  },

  async get(id, ctx) {
    const row = await rowOf(ctx, id);
    return row ? { ...summary(row), value: valueOf(row) } : null;
  },

  async check({ op, id, value }, ctx) {
    if ((op !== 'create' && op !== 'update') || !value) return [];
    const issues: CustomizationIssue[] = [];
    const current = id ? await rowOf(ctx, id) : null;
    if (current) {
      const was = valueOf(current);
      for (const key of BINDING)
        if (value[key] !== was[key])
          issues.push({
            path: key,
            message: 'The connection, remote object, scope, entity and container of a profile can’t change',
            code: 'immutable',
          });
      return issues;
    }
    const [conn] = await ctx.db
      .select({ type: connections.type })
      .from(connections)
      .where(eq(connections.id, value.connectionId));
    if (!conn) return [{ path: 'connectionId', message: 'Unknown connection', code: 'unknown_connection' }];
    const object = ctx.connectors
      .list()
      .find((x) => x.type === conn.type)
      ?.objects.find((o) => o.type === value.objectType);
    if (!object)
      issues.push({ path: 'objectType', message: 'Unknown remote object type', code: 'unknown_object' });
    else if (object.scoped && !value.remoteScope)
      issues.push({
        path: 'remoteScope',
        message: 'Choose where in the remote system',
        code: 'scope_required',
      });
    const entity = ctx.sync.entities().find((x) => x.entity === value.entity);
    if (!entity) issues.push({ path: 'entity', message: 'Unknown sync entity', code: 'unknown_entity' });
    else if (entity.container && !value.containerId)
      issues.push({ path: 'containerId', message: 'Choose where in ISBP', code: 'container_required' });
    else if (!entity.container && value.containerId)
      issues.push({
        path: 'containerId',
        message: `${entity.entity} has no containers`,
        code: 'no_container',
      });
    return issues;
  },

  async apply({ op, id, value }, ctx, auth) {
    const s = services(ctx).profiles;
    switch (op) {
      case 'create':
        return { id: (await s.create({ ...value!, enabled: true }, auth)).id };
      case 'update': {
        const v = value!;
        await s.update(
          id!,
          {
            name: v.name,
            direction: v.direction,
            createLocal: v.createLocal,
            createRemote: v.createRemote,
            matchRule: v.matchRule,
            pushFilter: v.pushFilter,
            mappings: v.mappings,
            conflictPolicy: v.conflictPolicy,
            comments: v.comments,
            intervalMinutes: v.intervalMinutes,
          },
          auth,
        );
        return { id: id! };
      }
      case 'archive':
      case 'restore':
        await s.update(id!, { enabled: op === 'restore' }, auth);
        return { id: id! };
      case 'delete':
        await s.remove(id!, auth);
        return { id: id! };
    }
  },
};
