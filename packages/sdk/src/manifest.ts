import { z } from 'zod';
import type { CustomizationKindDef, CustomizationPackageDef } from './customizations';
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
  'my-work',
  'openapi',
  'pg-catalog',
  'platform',
  'public',
  'readyz',
  'search',
  'settings',
  'static',
  'system',
  'tour',
]);

export type NavSection = 'main' | 'admin';

/** The sections of the Administration hub (`/admin`) that `section: 'admin'` entries are grouped in. */
export const ADMIN_AREAS = ['people', 'automation', 'modules', 'integrations', 'platform'] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];

/**
 * A sidebar entry. The sidebar is personal entries first (Home, My work, Requests, Knowledge), then one row per area
 * whose pages are its `children` (a collapsible group), then one "Administration" row that opens the `/admin` hub of
 * every `section: 'admin'` entry. Declare one top-level entry per module (its landing page) with its pages as
 * `children`, sub-pages that are section tabs of a page as that page's `tabs`, and settings with `section: 'admin'`.
 */
export interface NavEntry {
  id: string;
  /** i18n key (`<module>.nav.<x>`) — resolved by the web app. */
  label: string;
  /** Absolute path in the web app, e.g. `/announcements`. */
  href: string;
  /** lucide icon name in kebab-case, e.g. `megaphone`. Top-level rows need distinct icons (the collapsed rail). */
  icon?: string;
  /**
   * Hidden unless the viewer holds this permission (or one of these) at any scope. Use the permission of the people
   * who *work* in the page, not a self-service one everyone holds: what people only take part in reaches them through
   * My work (`manifest.work`) and notifications.
   */
  permission?: string | string[];
  section?: NavSection;
  /** @deprecated Ignored: group pages with `children` (or `parent`) instead. */
  group?: string;
  /** Counter shown next to the label, from `GET /me/badges` (`work`, `notifications`, …). */
  badge?: string;
  order?: number;
  /**
   * The area's pages: the entry becomes a collapsible group of them (an entry with children shows when at least one
   * child does; one visible child shows as a plain row with the group's label).
   */
  children?: NavEntry[];
  /**
   * Pages reached through this page's section tabs (`SectionTabs`): not sidebar rows, but they highlight this entry
   * and are listed by the command palette.
   */
  tabs?: NavEntry[];
  /**
   * A top-level entry that belongs in another module's group: `<module>.<entry id>` (CMDB's configuration items in
   * `itsm.service-desk`), or among another module's page's section tabs when that id is a page (Helpdesk AI's
   * insights in `itsm.reports`). Shown on its own when that group or page is disabled or hidden from the viewer.
   */
  parent?: string;
  /** Extra path prefixes that highlight this entry (plain prefixes, e.g. `/itsm/tickets/PRB-` for Problems). */
  match?: string[];
  /** i18n key: one line on what the page is for (Administration hub cards and the command palette). */
  description?: string;
  /** i18n key of extra words the command palette matches, comma-separated in the catalog ("SLA, calendars"). */
  keywords?: string;
  /** `section: 'admin'` entries: the Administration hub section of the card (default `modules`). */
  area?: AdminArea;
  /**
   * After the permission check, ask the module whether to show the entry to this person:
   * `defineServerModule({ navigation: { [id]: (auth, ctx) => boolean } })` (e.g. "is a member of a project").
   */
  check?: boolean;
}

/**
 * A kind of work that waits for people (`<module>.<key>`): approvals, forms to fill in, review decisions, tasks. The
 * module provides `work[key]` in `defineServerModule`; the kernel asks every source for the signed-in person and shows
 * the results on My work (`/my-work`), on Home and as the sidebar badge.
 */
export interface WorkSourceDef {
  /** Name inside the module; the full key is `<module>.<key>`. */
  key: string;
  /** i18n key: the heading of the source's items on My work ("Database access reviews"). */
  label: string;
  /**
   * The My work section: `approval` (decisions on requests), `todo` (something to fill in or do), `review` (records
   * to check), `task` (assigned work items). `task` items are listed but don't count in the badge.
   */
  kind: WorkKind;
  /** lucide icon name. */
  icon?: string;
  /** Asked only for people holding this permission (any scope); the provider still decides what is theirs. */
  permission?: string;
  /** "View all" link (the module's own list), if any. */
  href?: string;
}

export const WORK_KINDS = ['approval', 'todo', 'review', 'task'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

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
  /** Only reads: assistants may run it without asking, MCP clients see `readOnlyHint`. */
  readOnly?: boolean;
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
  /**
   * The entity whose custom fields are passed as facts (`attributes.<key>`, and `records.<key>.<fact>` for record
   * fields — see `ctx.fields.facts`), e.g. `itsm.ticket`. The workflow builder lists them as facts.
   */
  customFieldEntity?: string;
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
  /**
   * Approval facts of a record (e.g. a CI's `criticality`, `environment`, `ownerGroup`): what workflows may route on
   * when the record is picked in a `record` field. Served by the resolver's `facts`. Ids of people are user ids,
   * groups are group keys.
   */
  facts?: z.ZodType;
}

/**
 * Work a form can do after it is sent, approved or rejected (`<module>.<action>`, e.g. `itsm.create-change`). The
 * module provides a `processActions[action]` handler in `defineServerModule`.
 */
export interface ProcessActionDef {
  /** Action name inside the module; the full type is `<module>.<action>`. */
  action: string;
  /** i18n keys. */
  name: string;
  description: string;
  /** lucide icon name. */
  icon?: string;
  /** Needed (in addition to managing forms) to add the action to a form. */
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

/**
 * An entity the Integrations Hub can keep in sync with an outside system (`<module>.<entity>`, e.g.
 * `itsm.ticket`; use the record type's name when the entity is one). The module provides `sync[entity]` in
 * `defineServerModule`: a field catalogue, read and write. Sync writes are held to the module's own rules
 * (state machines, required approvals), never to fewer.
 */
export interface SyncEntityDef {
  /** Entity name inside the module; the full key is `<module>.<entity>`. */
  entity: string;
  /** i18n key of the plural noun ("Tickets"). */
  name: string;
  /** lucide icon name. */
  icon?: string;
  /**
   * Needed to write through the adapter, and to set up a sync profile that writes this entity. Declare a
   * dedicated `<module>.<resource>.sync` permission for it (the hub's agent holds `*.*.sync`).
   */
  permission: string;
  /** This module's events that mean a record changed (`idFromEvent` reads the id from their payload). */
  events: string[];
  /** This module's events that mean a comment was added, when comments sync. */
  commentEvents?: string[];
  /** Records live inside another sync entity (tasks in a project): its full key. */
  container?: string;
}

/** A kind of object an outside system has (a ServiceDesk Plus request, an Azure DevOps work item). */
export interface ConnectorObjectDef {
  /** Name inside the connector, e.g. `request`. */
  type: string;
  /** i18n key. */
  name: string;
  /** Sync entities it usually maps to (`itsm.ticket`): suggested in the profile form, with default mappings. */
  entities?: string[];
  /** Whether the remote API lets a sync create and update these, sync comments, and send webhooks. */
  capabilities: {
    create?: boolean;
    update?: boolean;
    comments?: boolean;
    webhooks?: boolean;
    hierarchy?: boolean;
  };
  /** Lives in a remote scope chosen per profile (an Azure DevOps team project). */
  scoped?: boolean;
}

/**
 * A kind of outside system the Integrations Hub can connect to (`<module>.<type>`, e.g. `sdp.server`). The
 * module provides `connectors[type]` in `defineServerModule`. Connections (instances with credentials) are
 * created by admins in the hub.
 */
export interface ConnectorDef {
  /** Name inside the module; the full type is `<module>.<type>`. */
  type: string;
  /** i18n keys. */
  name: string;
  description?: string;
  /** lucide icon name. */
  icon?: string;
  /** Non-secret settings (server URL, API version). */
  config: z.ZodType;
  /** Secret settings: sealed at rest, never returned by the API (client secret, refresh token, PAT). */
  secrets: z.ZodType;
  objects: ConnectorObjectDef[];
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
  /** Work that waits for people, shown on My work (providers in `defineServerModule({ work })`). */
  work?: WorkSourceDef[];
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
  /** Work forms can do after they are sent or decided (handlers in `defineServerModule({ processActions })`). */
  processActions?: ProcessActionDef[];
  /** Work Scheduled Jobs can run on a schedule (handlers in `defineServerModule({ taskTypes })`). */
  taskTypes?: TaskTypeDef[];
  /** Entities the Integrations Hub may sync (adapters in `defineServerModule({ sync })`). */
  syncEntities?: SyncEntityDef[];
  /** Outside systems this module connects to (handlers in `defineServerModule({ connectors })`). */
  connectors?: ConnectorDef[];
  /** Surfaces admins configure that the AI agent may build changes for (handlers in `customizations`). */
  customizations?: CustomizationKindDef[];
  /** Ready-made sets of changes installed as one change set (content in `customizationPackages`). */
  customizationPackages?: CustomizationPackageDef[];
}

const zPermission = z.string().refine(isPermissionKey, 'invalid permission key');

const zNav: z.ZodType<NavEntry> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    href: z.string().startsWith('/'),
    icon: z.string().optional(),
    permission: z.union([zPermission, z.array(zPermission).min(1)]).optional(),
    section: z.enum(['main', 'admin']).optional(),
    group: z.string().optional(),
    badge: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]*$/)
      .optional(),
    order: z.number().optional(),
    children: z.array(zNav).optional(),
    tabs: z.array(zNav).optional(),
    parent: z
      .string()
      .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/, 'parent is `<module>.<entry id>`')
      .optional(),
    match: z.array(z.string().startsWith('/')).optional(),
    description: z.string().min(1).optional(),
    keywords: z.string().min(1).optional(),
    area: z.enum(ADMIN_AREAS).optional(),
    check: z.boolean().optional(),
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
    work: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9-]*$/),
          label: z.string().min(1),
          kind: z.enum(WORK_KINDS),
          icon: z.string().optional(),
          permission: zPermission.optional(),
          href: z.string().startsWith('/').optional(),
        }),
      )
      .optional(),
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
              readOnly: z.boolean().optional(),
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
          customFieldEntity: z
            .string()
            .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)
            .optional(),
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
            facts: zZodType.optional(),
          }),
        ),
      })
      .optional(),
    processActions: z
      .array(
        z.object({
          action: z.string().regex(/^[a-z][a-z0-9-]*$/),
          name: z.string().min(1),
          description: z.string().min(1),
          icon: z.string().optional(),
          permission: z.string().refine(isPermissionKey, 'invalid permission key'),
        }),
      )
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
    syncEntities: z
      .array(
        z.object({
          entity: z.string().regex(/^[a-z][a-z0-9-]*$/),
          name: z.string().min(1),
          icon: z.string().optional(),
          permission: z.string().refine(isPermissionKey, 'invalid permission key'),
          events: z.array(z.string().min(1)).min(1),
          commentEvents: z.array(z.string().min(1)).optional(),
          container: z
            .string()
            .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)
            .optional(),
        }),
      )
      .optional(),
    connectors: z
      .array(
        z.object({
          type: z.string().regex(/^[a-z][a-z0-9-]*$/),
          name: z.string().min(1),
          description: z.string().optional(),
          icon: z.string().optional(),
          config: zZodType,
          secrets: zZodType,
          objects: z
            .array(
              z.object({
                type: z.string().regex(/^[a-z][a-z0-9-]*$/),
                name: z.string().min(1),
                entities: z.array(z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)).optional(),
                capabilities: z.object({
                  create: z.boolean().optional(),
                  update: z.boolean().optional(),
                  comments: z.boolean().optional(),
                  webhooks: z.boolean().optional(),
                  hierarchy: z.boolean().optional(),
                }),
                scoped: z.boolean().optional(),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    customizations: z
      .array(
        z.object({
          kind: z.string().regex(/^[a-z][a-z0-9-]*$/),
          label: z.string().min(1),
          description: z.string().min(10),
          icon: z.string().optional(),
          readPermission: z.string().refine(isPermissionKey, 'invalid permission key'),
          applyPermission: z.string().refine(isPermissionKey, 'invalid permission key'),
          operations: z
            .array(z.enum(['create', 'update', 'archive', 'delete']))
            .min(1)
            .refine(
              (ops) => !ops.includes('create') || ops.includes('archive') || ops.includes('delete'),
              'a kind that can create must also archive or delete (rollbacks undo creates with them)',
            )
            .optional(),
        }),
      )
      .optional(),
    customizationPackages: z
      .array(
        z.object({
          key: z
            .string()
            .regex(/^[a-z][a-z0-9-]{0,59}$/, 'package keys are kebab-case, at most 60 characters'),
          name: z.string().min(1),
          description: z.string().min(1),
          icon: z.string().optional(),
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
    const navIds = new Set<string>();
    const walkNav = (entries: NavEntry[] | undefined, path: (string | number)[], depth: number) =>
      entries?.forEach((e, i) => {
        if (navIds.has(e.id))
          ctx.addIssue({ code: 'custom', path: [...path, i, 'id'], message: 'duplicate navigation id' });
        navIds.add(e.id);
        if (depth > 0 && (e.parent || e.section))
          ctx.addIssue({
            code: 'custom',
            path: [...path, i],
            message: 'only top-level entries take `parent` or `section`',
          });
        if (e.section === 'admin' && (e.children?.length || e.parent))
          ctx.addIssue({
            code: 'custom',
            path: [...path, i],
            message: 'administration entries are hub cards: no `children` or `parent`',
          });
        if (e.parent?.startsWith(`${m.id}.`))
          ctx.addIssue({
            code: 'custom',
            path: [...path, i, 'parent'],
            message: 'use `children` for entries of the same module',
          });
        walkNav(e.children, [...path, i, 'children'], depth + 1);
        walkNav(e.tabs, [...path, i, 'tabs'], depth + 1);
      });
    walkNav(m.navigation, ['navigation'], 0);
    const workKeys = new Set<string>();
    m.work?.forEach((w, i) => {
      if (workKeys.has(w.key))
        ctx.addIssue({ code: 'custom', path: ['work', i, 'key'], message: 'duplicate work source' });
      workKeys.add(w.key);
    });
    const taskTypes = new Set<string>();
    m.taskTypes?.forEach((t, i) => {
      if (taskTypes.has(t.type))
        ctx.addIssue({ code: 'custom', path: ['taskTypes', i, 'type'], message: 'duplicate task type' });
      taskTypes.add(t.type);
    });
    const actions = new Set<string>();
    m.processActions?.forEach((a, i) => {
      if (actions.has(a.action))
        ctx.addIssue({
          code: 'custom',
          path: ['processActions', i, 'action'],
          message: 'duplicate process action',
        });
      actions.add(a.action);
    });
    const emitted = new Set(m.events?.emits?.map((e) => e.name) ?? []);
    const entities = new Set<string>();
    m.syncEntities?.forEach((e, i) => {
      if (entities.has(e.entity))
        ctx.addIssue({
          code: 'custom',
          path: ['syncEntities', i, 'entity'],
          message: 'duplicate sync entity',
        });
      entities.add(e.entity);
      [...e.events, ...(e.commentEvents ?? [])].forEach((name) => {
        if (!emitted.has(name))
          ctx.addIssue({
            code: 'custom',
            path: ['syncEntities', i, 'events'],
            message: `"${name}" is not in events.emits`,
          });
      });
    });
    const kinds = new Set<string>();
    m.customizations?.forEach((k, i) => {
      if (kinds.has(k.kind))
        ctx.addIssue({ code: 'custom', path: ['customizations', i, 'kind'], message: 'duplicate kind' });
      kinds.add(k.kind);
    });
    const packages = new Set<string>();
    m.customizationPackages?.forEach((p, i) => {
      if (packages.has(p.key))
        ctx.addIssue({
          code: 'custom',
          path: ['customizationPackages', i, 'key'],
          message: 'duplicate package',
        });
      packages.add(p.key);
    });
    const connectors = new Set<string>();
    m.connectors?.forEach((c, i) => {
      if (connectors.has(c.type))
        ctx.addIssue({ code: 'custom', path: ['connectors', i, 'type'], message: 'duplicate connector' });
      connectors.add(c.type);
      const objects = new Set<string>();
      c.objects.forEach((o, j) => {
        if (objects.has(o.type))
          ctx.addIssue({
            code: 'custom',
            path: ['connectors', i, 'objects', j, 'type'],
            message: 'duplicate object type',
          });
        objects.add(o.type);
      });
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
  'events' | 'ai' | 'workflows' | 'taskTypes' | 'connectors' | 'records'
> {
  records?: { types: (Omit<RecordTypeDef, 'facts'> & { facts?: unknown })[] };
  events?: { emits?: { name: string; description?: string; schema?: unknown }[]; consumes?: string[] };
  ai?: { tools?: (Omit<AiToolDef, 'input'> & { input: unknown })[]; agent?: AiAgentDef };
  workflows?: (Omit<WorkflowTriggerDef, 'facts'> & { facts?: unknown })[];
  taskTypes?: (Omit<TaskTypeDef, 'config'> & { config: unknown })[];
  connectors?: (Omit<ConnectorDef, 'config' | 'secrets'> & { config: unknown; secrets: unknown })[];
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
    records: m.records && { types: m.records.types.map((t) => ({ ...t, facts: toJsonSchema(t.facts) })) },
    taskTypes: m.taskTypes?.map((t) => ({ ...t, config: toJsonSchema(t.config) })),
    connectors: m.connectors?.map((c) => ({
      ...c,
      config: toJsonSchema(c.config),
      secrets: toJsonSchema(c.secrets),
    })),
  };
}
