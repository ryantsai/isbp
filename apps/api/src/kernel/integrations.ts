import {
  type AuthContext,
  type CacheService,
  type ConnectorDef,
  type ConnectorHandler,
  type ConnectorInfo,
  type ConnectorsService,
  type DomainEvent,
  ErrorCodes,
  type HttpClient,
  HttpError,
  type OpenConnector,
  type ServerModule,
  type SyncAdapter,
  type SyncChange,
  type SyncEntityDef,
  type SyncEntityInfo,
  type SyncFieldDef,
  type SyncService,
  type SyncWriteInput,
  toJsonSchema,
} from '@isbp/sdk/server';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { createCacheService } from './cache';
import type { ModuleRegistry } from './modules';

interface EntityEntry {
  entity: string;
  moduleId: string;
  def: SyncEntityDef;
  adapter: SyncAdapter;
  recordType: boolean;
}

/** Holds the permission at any scope. */
function reaches(auth: AuthContext, permission: string): boolean {
  const r = auth.reach(permission);
  return r.global || r.departmentIds.length > 0 || r.records.length > 0;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why `value` doesn't fit `field`, or null. `null` (empty) always fits except for required fields on create. */
export function fieldIssue(field: SyncFieldDef, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case 'string':
    case 'text':
    case 'markdown':
    case 'html':
      if (typeof value !== 'string') return 'expected a string';
      if (field.maxLength && value.length > field.maxLength) return `longer than ${field.maxLength}`;
      return null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'expected a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected true or false';
    case 'date':
      return typeof value === 'string' && DAY_RE.test(value) ? null : 'expected YYYY-MM-DD';
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? null
        : 'expected an ISO date-time';
    case 'choice':
      if (typeof value !== 'string') return 'expected a choice value';
      return !field.choices || field.choices.some((c) => c.value === value)
        ? null
        : `"${value}" is not a choice`;
    case 'tags':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? null
        : 'expected a list of strings';
    case 'user':
    case 'parent':
      return typeof value === 'string' && UUID_RE.test(value) ? null : 'expected an id';
    case 'json':
      return null;
  }
}

/** `ctx.sync`: the sync adapters (`manifest.syncEntities`) of enabled modules. */
export class SyncRegistry {
  private readonly entries = new Map<string, EntityEntry>();
  /** Event name → the entities (and kind) it reports changes for. */
  private readonly byEvent = new Map<string, { entity: string; kind: 'record' | 'comment' }[]>();

  constructor(private readonly registry: ModuleRegistry) {
    for (const m of registry.modules as readonly ServerModule[]) {
      const recordTypes = new Set(m.manifest.records?.types.map((t) => t.type) ?? []);
      for (const def of m.manifest.syncEntities ?? []) {
        const entity = `${m.manifest.id}.${def.entity}`;
        this.entries.set(entity, {
          entity,
          moduleId: m.manifest.id,
          def,
          adapter: m.sync![def.entity]!,
          recordType: recordTypes.has(def.entity),
        });
        for (const [names, kind] of [
          [def.events, 'record'],
          [def.commentEvents ?? [], 'comment'],
        ] as const) {
          for (const name of names) {
            const list = this.byEvent.get(name) ?? [];
            list.push({ entity, kind });
            this.byEvent.set(name, list);
          }
        }
      }
    }
  }

  /** Whether any sync entity reports changes with this event. */
  isSyncEvent(name: string): boolean {
    return this.byEvent.has(name);
  }

  /** The changes an event stands for (entities of enabled modules whose adapter resolves an id). */
  changesFor(event: DomainEvent): SyncChange[] {
    const out: SyncChange[] = [];
    for (const { entity, kind } of this.byEvent.get(event.name) ?? []) {
      const e = this.entries.get(entity)!;
      if (!this.registry.isEnabled(e.moduleId)) continue;
      const id = e.adapter.idFromEvent(event);
      if (id) out.push({ entity, id, kind, event });
    }
    return out;
  }

  private entry(entity: string): EntityEntry {
    const e = this.entries.get(entity);
    if (!e) throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown sync entity ${entity}`);
    if (!this.registry.isEnabled(e.moduleId))
      throw new HttpError(409, ErrorCodes.MODULE_DISABLED, `Module ${e.moduleId} is disabled`, {
        moduleId: e.moduleId,
      });
    return e;
  }

  private async validate(e: EntityEntry, input: SyncWriteInput) {
    const ctx = this.registry.context(e.moduleId);
    const fields = new Map(
      (await e.adapter.fields(ctx, { containerId: input.containerId ?? null })).map((f) => [f.key, f]),
    );
    const creating = !input.id;
    const issues: { path: string; message: string }[] = [];
    for (const [key, value] of Object.entries(input.values)) {
      const f = fields.get(key);
      if (!f) issues.push({ path: key, message: 'unknown field' });
      else if (f.readOnly) issues.push({ path: key, message: 'read-only' });
      else if (!creating && f.createOnly)
        issues.push({ path: key, message: 'can only be set when creating' });
      else {
        const issue = fieldIssue(f, value);
        if (issue) issues.push({ path: key, message: issue });
      }
    }
    if (creating) {
      for (const f of fields.values())
        if (f.required && !f.readOnly && (input.values[f.key] ?? null) === null)
          issues.push({ path: f.key, message: 'required' });
      if (e.def.container && !input.containerId) issues.push({ path: 'containerId', message: 'required' });
    }
    if (issues.length)
      throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, `Invalid ${e.entity} values`, { issues });
  }

  service(): SyncService {
    return {
      entities: (auth?: AuthContext): SyncEntityInfo[] =>
        [...this.entries.values()]
          .filter((e) => this.registry.isEnabled(e.moduleId))
          .filter((e) => !auth || reaches(auth, e.def.permission))
          .map((e) => ({
            entity: e.entity,
            moduleId: e.moduleId,
            name: e.def.name,
            icon: e.def.icon ?? null,
            permission: e.def.permission,
            container: e.def.container ?? null,
            comments: Boolean(e.def.commentEvents?.length && e.adapter.comments),
            recordType: e.recordType,
            matchKeys: e.adapter.findBy ? (e.adapter.matchKeys ?? []) : [],
          })),
      fields: async (entity, opts) => {
        const e = this.entry(entity);
        return e.adapter.fields(this.registry.context(e.moduleId), opts);
      },
      read: async (entity, id) => {
        const e = this.entry(entity);
        return e.adapter.read(id, this.registry.context(e.moduleId));
      },
      readMany: async (entity, ids) => {
        const e = this.entry(entity);
        return ids.length ? e.adapter.readMany(ids, this.registry.context(e.moduleId)) : [];
      },
      list: async (entity, opts) => {
        const e = this.entry(entity);
        return e.adapter.list(opts, this.registry.context(e.moduleId));
      },
      write: async (entity, input, opts) => {
        const e = this.entry(entity);
        if (!reaches(opts.auth, e.def.permission))
          throw new HttpError(403, ErrorCodes.FORBIDDEN, `Writing ${entity} needs ${e.def.permission}`, {
            permission: e.def.permission,
          });
        await this.validate(e, input);
        const ctx = this.registry.context(e.moduleId);
        const { id } = await e.adapter.write(input, opts, ctx);
        // Read back in the same transaction: what the module stored, normalizations included.
        const record = await e.adapter.read(id, { ...ctx, db: opts.tx });
        return { id, record };
      },
      findBy: async (entity, field, value, opts) => {
        const e = this.entry(entity);
        if (!e.adapter.findBy || !(e.adapter.matchKeys ?? []).includes(field)) return null;
        if (value === null || value === undefined || value === '') return null;
        return e.adapter.findBy(field, value, opts ?? {}, this.registry.context(e.moduleId));
      },
      comments: {
        list: async (entity, id) => {
          const e = this.entry(entity);
          if (!e.adapter.comments)
            throw new HttpError(409, ErrorCodes.NOT_SUPPORTED, `${entity} has no comments`);
          return e.adapter.comments.list(id, this.registry.context(e.moduleId));
        },
        add: async (entity, id, comment, opts) => {
          const e = this.entry(entity);
          if (!e.adapter.comments)
            throw new HttpError(409, ErrorCodes.NOT_SUPPORTED, `${entity} has no comments`);
          if (!reaches(opts.auth, e.def.permission))
            throw new HttpError(403, ErrorCodes.FORBIDDEN, `Writing ${entity} needs ${e.def.permission}`, {
              permission: e.def.permission,
            });
          if (!comment.body.trim())
            throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'Empty comment', {
              issues: [{ path: 'body', message: 'required' }],
            });
          return e.adapter.comments.add(id, comment, opts, this.registry.context(e.moduleId));
        },
      },
    };
  }
}

interface ConnectorEntry {
  type: string;
  moduleId: string;
  def: ConnectorDef;
  handler: ConnectorHandler;
  info: ConnectorInfo;
}

function secretKeys(schema: z.ZodType): string[] {
  return schema instanceof z.ZodObject ? Object.keys(schema.shape) : [];
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const notSupported = (what: string) =>
  new HttpError(409, ErrorCodes.NOT_SUPPORTED, `${what} is not supported`);

/** `ctx.connectors`: the connector types (`manifest.connectors`) of enabled modules. */
export class ConnectorRegistry {
  private readonly entries = new Map<string, ConnectorEntry>();

  constructor(
    private readonly registry: ModuleRegistry,
    private readonly http: HttpClient,
    private readonly redis: Redis,
  ) {
    for (const m of registry.modules as readonly ServerModule[]) {
      for (const def of m.manifest.connectors ?? []) {
        const type = `${m.manifest.id}.${def.type}`;
        this.entries.set(type, {
          type,
          moduleId: m.manifest.id,
          def,
          handler: m.connectors![def.type]!,
          info: {
            type,
            moduleId: m.manifest.id,
            name: def.name,
            description: def.description ?? null,
            icon: def.icon ?? null,
            configSchema: toJsonSchema(def.config),
            secretsSchema: toJsonSchema(def.secrets),
            secretKeys: secretKeys(def.secrets),
            objects: def.objects.map((o) => ({
              type: o.type,
              name: o.name,
              entities: o.entities ?? [],
              capabilities: {
                create: Boolean(o.capabilities.create),
                update: Boolean(o.capabilities.update),
                comments: Boolean(o.capabilities.comments),
                webhooks: Boolean(o.capabilities.webhooks),
                hierarchy: Boolean(o.capabilities.hierarchy),
              },
              scoped: Boolean(o.scoped),
            })),
          },
        });
      }
    }
  }

  private entry(type: string): ConnectorEntry {
    const e = this.entries.get(type);
    if (!e) throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown connector ${type}`);
    if (!this.registry.isEnabled(e.moduleId))
      throw new HttpError(409, ErrorCodes.MODULE_DISABLED, `Module ${e.moduleId} is disabled`, {
        moduleId: e.moduleId,
      });
    return e;
  }

  /**
   * `ctx.http` limited to `hosts`, with private addresses allowed for exactly those. Plain HTTP only with the
   * connection's explicit opt-in (or to loopback, for the development stand-ins).
   */
  private scopedHttp(hosts: string[], allowInsecureHttp: boolean): HttpClient {
    const allowed = hosts.map((h) => h.toLowerCase().replace(/\.$/, ''));
    return {
      request: (raw, opts = {}) => {
        let host: string;
        let protocol: string;
        try {
          const url = new URL(raw);
          host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
          protocol = url.protocol;
        } catch {
          throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Invalid URL');
        }
        if (protocol === 'http:' && !allowInsecureHttp && !LOOPBACK_HOSTS.has(host))
          throw new HttpError(
            422,
            ErrorCodes.INSECURE_HTTP,
            `${host} is plain HTTP; the connection does not allow insecure HTTP`,
            { host },
          );
        if (!allowed.includes(host))
          throw new HttpError(
            422,
            ErrorCodes.TARGET_BLOCKED,
            `${host} is not one of this connection's hosts`,
          );
        return this.http.request(raw, { ...opts, allowHosts: allowed });
      },
    };
  }

  service(): ConnectorsService {
    return {
      list: () =>
        [...this.entries.values()].filter((e) => this.registry.isEnabled(e.moduleId)).map((e) => e.info),
      validate: (type, config, secrets) => {
        const e = this.entry(type);
        const issues: { path: string; message: string }[] = [];
        const c = e.def.config.safeParse(config);
        if (!c.success)
          issues.push(
            ...c.error.issues.map((i) => ({ path: ['config', ...i.path].join('.'), message: i.message })),
          );
        const s = e.def.secrets.safeParse(secrets);
        if (!s.success)
          issues.push(
            ...s.error.issues.map((i) => ({ path: ['secrets', ...i.path].join('.'), message: i.message })),
          );
        if (issues.length)
          throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Invalid connection settings', { issues });
        return { config: c.data, secrets: s.data };
      },
      open: (type, connection): OpenConnector => {
        const e = this.entry(type);
        const h = e.handler;
        const config = e.def.config.parse(connection.config);
        const hosts = h.hosts(config);
        const cache: CacheService = createCacheService(this.redis, `${e.moduleId}:conn:${connection.id}`);
        const conn = {
          connectionId: connection.id,
          config,
          secrets: connection.secrets,
          http: this.scopedHttp(hosts, Boolean(connection.allowInsecureHttp)),
          cache,
          signal: connection.signal,
        };
        const object = (objectType: string) => {
          const o = e.info.objects.find((x) => x.type === objectType);
          if (!o) throw new HttpError(404, ErrorCodes.NOT_FOUND, `${type} has no object type ${objectType}`);
          return o;
        };
        return {
          info: e.info,
          hosts: () => hosts,
          test: () => h.test(conn),
          scopes: async (objectType) => {
            object(objectType);
            return h.scopes ? h.scopes(conn, objectType) : [];
          },
          fields: async (objectType, scope) => {
            object(objectType);
            return h.fields(conn, objectType, scope);
          },
          changes: async (objectType, opts) => {
            object(objectType);
            return h.changes(conn, objectType, opts);
          },
          get: async (objectType, id, opts) => {
            object(objectType);
            return h.get(conn, objectType, id, opts);
          },
          create: async (objectType, values, opts) => {
            if (!object(objectType).capabilities.create || !h.create)
              throw notSupported(`Creating ${objectType}`);
            return h.create(conn, objectType, values, opts);
          },
          update: async (objectType, id, values, opts) => {
            if (!object(objectType).capabilities.update || !h.update)
              throw notSupported(`Updating ${objectType}`);
            return h.update(conn, objectType, id, values, opts);
          },
          comments: {
            list: async (objectType, id, opts) => {
              if (!object(objectType).capabilities.comments || !h.comments)
                throw notSupported(`Comments on ${objectType}`);
              return h.comments.list(conn, objectType, id, opts);
            },
            add: async (objectType, id, comment, opts) => {
              if (!object(objectType).capabilities.comments || !h.comments)
                throw notSupported(`Comments on ${objectType}`);
              return h.comments.add(conn, objectType, id, comment, opts);
            },
          },
          webhook: async (req) => {
            if (!h.webhook) throw notSupported('Webhooks');
            return h.webhook(conn, req);
          },
          defaultMapping: (objectType, entity) => {
            object(objectType);
            return h.defaultMapping?.(objectType, entity) ?? [];
          },
        };
      },
    };
  }
}
