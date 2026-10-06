import { z } from 'zod';
import { isPermissionKey, isPermissionPattern } from './permissions';

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
  ai?: { tools: AiToolDef[] };
  search?: { entities: string[] };
}

const zNav: z.ZodType<NavEntry> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    href: z.string().startsWith('/'),
    icon: z.string().optional(),
    permission: z.string().refine(isPermissionKey, 'invalid permission key').optional(),
    section: z.enum(['main', 'admin']).optional(),
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
        tools: z.array(
          z.object({
            name: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/),
            description: z.string().min(10),
            input: zZodType,
            permission: z.string().refine(isPermissionKey),
            destructive: z.boolean().optional(),
          }),
        ),
      })
      .optional(),
    search: z.object({ entities: z.array(z.string()) }).optional(),
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
    m.ai?.tools.forEach((t, i) => {
      if (!own(t.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['ai', 'tools', i, 'name'],
          message: `must start with "${m.id}."`,
        });
      }
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
export interface SerializedManifest extends Omit<ModuleManifest, 'events' | 'ai'> {
  events?: { emits?: { name: string; description?: string; schema?: unknown }[]; consumes?: string[] };
  ai?: { tools: (Omit<AiToolDef, 'input'> & { input: unknown })[] };
}

function toJsonSchema(schema: z.ZodType | undefined): unknown {
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
      tools: m.ai.tools.map((t) => ({ ...t, input: toJsonSchema(t.input) })),
    },
  };
}
