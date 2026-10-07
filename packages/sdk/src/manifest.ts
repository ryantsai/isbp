import { z } from 'zod';
import { isPermissionKey, isPermissionPattern } from './permissions';
import { type WorkflowGraph, workflowGraphSchema } from './workflow';

export const MODULE_ID_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Ids that collide with platform routes (`/api/v1/<id>`, `/<id>` in the web app) or Postgres schemas.
 */
export const RESERVED_MODULE_IDS = new Set([
  'admin',
  'ai',
  'api',
  'app',
  'assets',
  'auth',
  'docs',
  'drizzle',
  'health',
  'healthz',
  'information-schema',
  'login',
  'logout',
  'me',
  'metrics',
  'modules',
  'openapi',
  'pg-catalog',
  'platform',
  'public',
  'readyz',
  'search',
  'settings',
  'static',
  'system',
]);

export type NavSection = 'main' | 'admin';

export interface NavEntry {
  id: string;
  /** i18n key (`<module>.nav.<x>`) — resolved by the web app. */
  label: string;
  /** Absolute path in the web app, e.g. `/announcements`. */
  href: string;
  /** lucide icon name in kebab-case, e.g. `megaphone`. */
  icon?: string;
  /** Hidden unless the viewer holds this permission at any scope. */
  permission?: string;
  section?: NavSection;
  /** i18n key of a sub-heading within the section (entries with the same group sit together). */
  group?: string;
  /** Counter shown next to the label, from `GET /me/badges` (e.g. `approvals`). */
  badge?: string;
  order?: number;
  children?: NavEntry[];
}

export interface PermissionDef {
  key: string;
  /** i18n key or plain English description. */
  description: string;
  scopes?: ('global' | 'department' | 'record')[];
}

export interface RoleTemplate {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  /**
   * Granted to the implicit "Everyone" group when the role is first created (e.g. read access to
   * announcements). Admins can revoke it afterwards; it is not re-granted.
   */
  grantByDefault?: boolean;
}

export interface EventDef {
  /** `<module>.<entity>.<past-tense-verb>` e.g. `core.user.offboarded`. */
  name: string;
  description?: string;
  schema?: z.ZodType;
}

export type SettingType = 'string' | 'text' | 'number' | 'boolean' | 'select' | 'secret';

export interface SettingDef {
  key: string;
  label: string;
  description?: string;
  type: SettingType;
  default?: string | number | boolean | null;
  options?: { value: string; label: string }[];
  /** Hidden behind "Advanced" in the admin UI. */
  advanced?: boolean;
}

export interface AiToolDef {
  /** Globally unique tool name: `<module>.<verb>_<noun>`, e.g. `core.find_users`. */
  name: string;
  description: string;
  input: z.ZodType;
  /** Permission the calling identity must hold. */
  permission: string;
  /** Destructive or privileged → requires human confirmation before execution. */
  destructive?: boolean;
}

/**
 * An attach point for approval workflows, e.g. "publishing an announcement". Admins bind a workflow
 * definition to it; the module calls `ctx.workflows.start(key, …)` and gets `onCompleted` back.
 */
export interface WorkflowTriggerDef {
  /** `<module>.<name>`, e.g. `announcements.publish`. */
  key: string;
  /** i18n key. */
  name: string;
  description?: string;
  /** Entity type the workflow decides about (shown in approval inboxes), e.g. `post`. */
  subject: string;
  /** Shape of the facts passed to `start()` — conditions and "approver from fact" pick from it. */
  facts?: z.ZodType;
  /** A workflow always runs: without a bound definition the `defaultGraph` is installed and used. */
  required?: boolean;
  /** Installed as a system definition on first sync. */
  defaultGraph?: WorkflowGraph;
}

export type NotificationChannelKind = 'inApp' | 'email';

/**
 * A notification type users can tune. Text comes from the module catalog by convention:
 * `<module>.notifications.<rest_with_underscores>.{label,title,body}` (ICU, with `params`).
 */
export interface NotificationTypeDef {
  /** `<module>.<entity>.<verb>`, e.g. `core.approval.assigned`. */
  type: string;
  /** Channels used until the user changes their preferences (default: in-app only). */
  defaultChannels?: NotificationChannelKind[];
  /** Security-relevant notices users cannot switch off. */
  mandatory?: boolean;
}

/**
 * A card in the request portal's "What do you need?" (e.g. "Report an issue"). Shown only when the module
 * is enabled and the viewer holds `permission` (if set).
 */
export interface PortalEntry {
  id: string;
  /** i18n keys. */
  label: string;
  description?: string;
  /** lucide icon name. */
  icon?: string;
  /** Absolute web path, e.g. `/itsm/report`. */
  href: string;
  permission?: string;
  order?: number;
}

/**
 * The identity a module's background AI work runs as (an `ai_agent` principal). Its permissions are
 * declared up front — least privilege, visible to admins — and checked like any user's.
 */
export interface AiAgentDef {
  /** Display name in audit logs and timelines, e.g. "Helpdesk AI". */
  name: string;
  /** Permission patterns the agent holds (globally). */
  permissions: string[];
}

/** An entity whose `attributes` JSONB admins can extend with custom fields. */
export interface CustomFieldEntityDef {
  /** Entity name inside the module; the full type is `<module>.<type>`, e.g. `core.user`. */
  type: string;
  /** i18n key. */
  name: string;
}

/**
 * A kind of record other modules can link to and attach files to (`<module>.<type>`, e.g. `itsm.ticket`).
 * The module provides a `records[type]` resolver in `defineServerModule` that decides what each caller sees.
 */
export interface RecordTypeDef {
  /** Entity name inside the module; the full type is `<module>.<type>`. */
  type: string;
  /** i18n key of the singular noun ("Ticket"). */
  name: string;
  /** lucide icon name. */
  icon?: string;
  /** Holding it (at any scope) lists the type in record pickers; resolvers still check every record. */
  permission: string;
}

/**
 * A kind of work Scheduled Jobs can run (`<module>.<type>`, e.g. `etl.pipeline`). The module provides a
 * `taskTypes[type]` handler in `defineServerModule`; the job form validates `config` with the schema.
 */
export interface TaskTypeDef {
  /** Name inside the module; the full type is `<module>.<type>`. */
  type: string;
  /** i18n keys. */
  name: string;
  description?: string;
  /** lucide icon name. */
  icon?: string;
  /** Needed (at any scope) to create or edit a job of this type. */
  permission: string;
  /** Shape of the job's configuration (JSON). */
  config: z.ZodType;
}

export interface ModuleManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  icon?: string;
  /** System modules cannot be disabled. */
  system?: boolean;
  dependsOn?: string[];
  navigation?: NavEntry[];
  permissions?: PermissionDef[];
  roles?: RoleTemplate[];
  events?: { emits?: EventDef[]; consumes?: string[] };
  settings?: SettingDef[];
  ai?: { tools?: AiToolDef[]; agent?: AiAgentDef };
  search?: { entities: string[] };
  portal?: { entries: PortalEntry[] };
  workflows?: WorkflowTriggerDef[];
  notifications?: NotificationTypeDef[];
  customFields?: { entities: CustomFieldEntityDef[] };
  /** Record types that can be linked across modules and carry attachments. */
  records?: { types: RecordTypeDef[] };
  /** Work Scheduled Jobs can run on a schedule (handlers in `defineServerModule({ taskTypes })`). */
  taskTypes?: TaskTypeDef[];
}

const zNav: z.ZodType<NavEntry> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    href: z.string().startsWith('/'),
    icon: z.string().optional(),
    permission: z.string().refine(isPermissionKey, 'invalid permission key').optional(),
    section: z.enum(['main', 'admin']).optional(),
    group: z.string().optional(),
    badge: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]*$/)
      .optional(),
    order: z.number().optional(),
    children: z.array(zNav).optional(),
  }),
);

const zZodType = z.custom<z.ZodType>((v) => v instanceof z.ZodType, 'expected a Zod schema');

export const manifestSchema = z
  .object({
    id: z
      .string()
      .regex(MODULE_ID_RE, 'module id must be kebab-case, 3–40 chars')
      .refine((id) => !RESERVED_MODULE_IDS.has(id), 'module id is reserved'),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'version must be semver'),
    name: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    system: z.boolean().optional(),
    dependsOn: z.array(z.string()).optional(),
    navigation: z.array(zNav).optional(),
    permissions: z
      .array(
        z.object({
          key: z.string().refine(isPermissionKey, 'permission keys look like module.resource.action'),
          description: z.string(),
          scopes: z.array(z.enum(['global', 'department', 'record'])).optional(),
        }),
      )
      .optional(),
    roles: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9-]*$/),
          name: z.string(),
          description: z.string().optional(),
          permissions: z.array(z.string().refine(isPermissionPattern, 'invalid permission pattern')),
          grantByDefault: z.boolean().optional(),
        }),
      )
      .optional(),
    events: z
      .object({
        emits: z
          .array(
            z.object({
              name: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*$/),
              description: z.string().optional(),
              schema: zZodType.optional(),
            }),
          )
          .optional(),
        consumes: z.array(z.string()).optional(),
      })
      .optional(),
    settings: z
      .array(
        z.object({
          key: z.string().regex(/^[a-zA-Z][\w.-]*$/),
          label: z.string(),
          description: z.string().optional(),
          type: z.enum(['string', 'text', 'number', 'boolean', 'select', 'secret']),
          default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
          options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
          advanced: z.boolean().optional(),
        }),
      )
      .optional(),
    ai: z
      .object({
        tools: z
          .array(
            z.object({
              name: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/),
              description: z.string().min(10),
              input: zZodType,
              permission: z.string().refine(isPermissionKey),
              destructive: z.boolean().optional(),
            }),
          )
          .optional(),
        agent: z
          .object({
            name: z.string().min(1).max(80),
            permissions: z.array(z.string().refine(isPermissionPattern, 'invalid permission pattern')).min(1),
          })
          .optional(),
      })
      .optional(),
    search: z.object({ entities: z.array(z.string()) }).optional(),
    portal: z
      .object({
        entries: z.array(
          z.object({
            id: z.string().regex(/^[a-z][a-z0-9-]*$/),
            label: z.string().min(1),
            description: z.string().optional(),
            icon: z.string().optional(),
            href: z.string().startsWith('/'),
            permission: z.string().refine(isPermissionKey, 'invalid permission key').optional(),
            order: z.number().optional(),
          }),
        ),
      })
      .optional(),
    workflows: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
          name: z.string().min(1),
          description: z.string().optional(),
          subject: z.string().regex(/^[a-z][a-z0-9-]*$/),
          facts: zZodType.optional(),
          required: z.boolean().optional(),
          defaultGraph: workflowGraphSchema.optional(),
        }),
      )
      .optional(),
    notifications: z
      .array(
        z.object({
          type: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*$/),
          defaultChannels: z.array(z.enum(['inApp', 'email'])).optional(),
          mandatory: z.boolean().optional(),
        }),
      )
      .optional(),
    customFields: z
      .object({
        entities: z.array(z.object({ type: z.string().regex(/^[a-z][a-z0-9-]*$/), name: z.string().min(1) })),
      })
      .optional(),
    records: z
      .object({
        types: z.array(
          z.object({
            type: z.string().regex(/^[a-z][a-z0-9-]*$/),
            name: z.string().min(1),
            icon: z.string().optional(),
            permission: z.string().refine(isPermissionKey, 'invalid permission key'),
          }),
        ),
      })
      .optional(),
    taskTypes: z
      .array(
        z.object({
          type: z.string().regex(/^[a-z][a-z0-9-]*$/),
          name: z.string().min(1),
          description: z.string().optional(),
          icon: z.string().optional(),
          permission: z.string().refine(isPermissionKey, 'invalid permission key'),
          config: zZodType,
        }),
      )
      .optional(),
  })
  .superRefine((m, ctx) => {
    const own = (key: string) => key.startsWith(`${m.id}.`);
    m.permissions?.forEach((p, i) => {
      if (!own(p.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['permissions', i, 'key'],
          message: `must start with "${m.id}."`,
        });
      }
    });
    m.events?.emits?.forEach((e, i) => {
      if (!own(e.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', 'emits', i, 'name'],
          message: `must start with "${m.id}."`,
        });
      }
    });
    m.ai?.tools?.forEach((t, i) => {
      if (!own(t.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['ai', 'tools', i, 'name'],
          message: `must start with "${m.id}."`,
        });
      }
    });
    m.workflows?.forEach((w, i) => {
      if (!own(w.key))
        ctx.addIssue({
          code: 'custom',
          path: ['workflows', i, 'key'],
          message: `must start with "${m.id}."`,
        });
    });
    m.notifications?.forEach((n, i) => {
      if (!own(n.type))
        ctx.addIssue({
          code: 'custom',
          path: ['notifications', i, 'type'],
          message: `must start with "${m.id}."`,
        });
    });
    const types = new Set<string>();
    m.records?.types.forEach((r, i) => {
      if (types.has(r.type))
        ctx.addIssue({
          code: 'custom',
          path: ['records', 'types', i, 'type'],
          message: 'duplicate record type',
        });
      types.add(r.type);
    });
    const taskTypes = new Set<string>();
    m.taskTypes?.forEach((t, i) => {
      if (taskTypes.has(t.type))
        ctx.addIssue({ code: 'custom', path: ['taskTypes', i, 'type'], message: 'duplicate task type' });
      taskTypes.add(t.type);
    });
  });

/** Identity helper that gives manifests full type checking and validates them eagerly. */
export function defineManifest<const M extends ModuleManifest>(manifest: M): M {
  const result = manifestSchema.safeParse(manifest);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid module manifest "${manifest.id}":\n${issues}`);
  }
  return manifest;
}

/** JSON-safe view of a manifest (Zod schemas converted to JSON Schema) for APIs, admin UI and MCP. */
export interface SerializedManifest extends Omit<
  ModuleManifest,
  'events' | 'ai' | 'workflows' | 'taskTypes'
> {
  events?: { emits?: { name: string; description?: string; schema?: unknown }[]; consumes?: string[] };
  ai?: { tools?: (Omit<AiToolDef, 'input'> & { input: unknown })[]; agent?: AiAgentDef };
  workflows?: (Omit<WorkflowTriggerDef, 'facts'> & { facts?: unknown })[];
  taskTypes?: (Omit<TaskTypeDef, 'config'> & { config: unknown })[];
}

export function toJsonSchema(schema: z.ZodType | undefined): unknown {
  if (!schema) return undefined;
  try {
    return z.toJSONSchema(schema, { unrepresentable: 'any' });
  } catch {
    return undefined;
  }
}

export function serializeManifest(m: ModuleManifest): SerializedManifest {
  return {
    ...m,
    events: m.events && {
      consumes: m.events.consumes,
      emits: m.events.emits?.map((e) => ({
        name: e.name,
        description: e.description,
        schema: toJsonSchema(e.schema),
      })),
    },
    ai: m.ai && {
      tools: m.ai.tools?.map((t) => ({ ...t, input: toJsonSchema(t.input) })),
      agent: m.ai.agent,
    },
    workflows: m.workflows?.map((w) => ({ ...w, facts: toJsonSchema(w.facts) })),
    taskTypes: m.taskTypes?.map((t) => ({ ...t, config: toJsonSchema(t.config) })),
  };
}
