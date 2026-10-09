import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id, keySchema } from './common';

/* ───────────── audit ───────────── */

export const auditRefSchema = z.object({
  /** `user`, `group`, `department`, `role`, `form`, `workflow_definition`, `application`. */
  type: z.string(),
  name: z.string(),
  /** Roles: their key and module, so the UI can show the translated name. */
  key: z.string().nullable(),
  moduleId: z.string().nullable(),
});
export type AuditRef = z.input<typeof auditRefSchema>;

export const auditLogSchema = z.object({
  seq: z.number().int(),
  eventId: z.string(),
  occurredAt: dateTime,
  actorType: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  category: z.string(),
  moduleId: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  entityLabel: z.string().nullable(),
  changes: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  outcome: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  /**
   * Names for the ids the record mentions (its target, ids in `changes`, `metadata.userIds`, role keys under
   * `role:<key>`), resolved when it is read: what they are called now. Absent when nothing needed resolving.
   */
  refs: z.record(z.string(), auditRefSchema).optional(),
});
export type AuditLog = z.input<typeof auditLogSchema>;

export const auditQuerySchema = listQuerySchema.extend({
  actorId: id.optional(),
  action: z.string().max(200).optional(),
  moduleId: z.string().max(64).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(200).optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  category: z.enum(['data', 'security', 'system']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Any of these actions; an entry ending in `*` is a prefix (`core.role.*`). "What changed" uses it. */
  actions: z
    .union([z.string().max(200), z.array(z.string().max(200)).max(40)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  /** Entries about this person: their own record, or a change that lists them (group members added, removed). */
  userId: id.optional(),
  /** Entries about this role: the role itself and the grants, revocations and expiries of it. */
  roleId: id.optional(),
});
export type AuditQuery = z.input<typeof auditQuerySchema>;

export const auditVerifySchema = z.object({ seq: z.number().int(), valid: z.boolean(), hash: z.string() });

/* ───────────── modules ───────────── */

export const moduleInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.string(),
  icon: z.string().nullable(),
  enabled: z.boolean(),
  system: z.boolean(),
  dependsOn: z.array(z.string()),
  dependents: z.array(z.string()),
  permissions: z.array(z.object({ key: z.string(), description: z.string() })),
  events: z.object({
    emits: z.array(z.object({ name: z.string(), description: z.string().nullable() })),
    consumes: z.array(z.string()),
  }),
  aiTools: z.array(
    z.object({ name: z.string(), description: z.string(), permission: z.string(), destructive: z.boolean() }),
  ),
  /** The identity the module's background AI work runs as (`manifest.ai.agent`), if any. */
  aiAgent: z.object({ name: z.string(), permissions: z.array(z.string()) }).nullable(),
  settings: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      description: z.string().nullable(),
      type: z.string(),
      advanced: z.boolean(),
      options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
      value: z.unknown(),
    }),
  ),
  navigation: z.number().int(),
  jobs: z.array(
    z.object({ name: z.string(), description: z.string().nullable(), schedule: z.string().nullable() }),
  ),
  enabledChangedAt: dateTime.nullable(),
  installedAt: dateTime,
});
export type ModuleInfo = z.input<typeof moduleInfoSchema>;

export const toggleModuleSchema = z.object({ enabled: z.boolean() });
export const updateModuleSettingsSchema = z.object({ values: z.record(z.string(), z.unknown()) });

/* ───────────── navigation / shell ───────────── */

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: string;
  section: 'main' | 'admin';
  /** @deprecated Always empty: groups are entries with `children`. */
  group?: string;
  /** Counter key from `GET /me/badges`. */
  badge?: string;
  order: number;
  moduleId: string;
  /** A group's pages (sidebar rows). */
  children?: NavItem[];
  /** Pages reached through this page's section tabs: not rows, but they highlight it and the palette lists them. */
  tabs?: NavItem[];
  /** Extra path prefixes that highlight the entry. */
  match?: string[];
  /** i18n key: what the page is for. */
  description?: string;
  /** i18n key: extra words the command palette matches. */
  keywords?: string;
  /** Administration entries: the hub section. */
  area?: 'people' | 'automation' | 'modules' | 'integrations' | 'platform';
}
const navItem: z.ZodType<NavItem, NavItem> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    href: z.string(),
    icon: z.string().optional(),
    section: z.enum(['main', 'admin']),
    group: z.string().optional(),
    badge: z.string().optional(),
    order: z.number(),
    moduleId: z.string(),
    children: z.array(navItem).optional(),
    tabs: z.array(navItem).optional(),
    match: z.array(z.string()).optional(),
    description: z.string().optional(),
    keywords: z.string().optional(),
    area: z.enum(['people', 'automation', 'modules', 'integrations', 'platform']).optional(),
  }),
);
export const navigationSchema = z.object({
  /**
   * The sidebar in order: personal entries, one row per area (a group of `children`), and the Administration row
   * (`/admin`) when the person has administration pages (one or two of them are shown as rows instead).
   */
  items: z.array(navItem),
  /** Every administration page the person may open (the `/admin` hub's cards). */
  admin: z.array(navItem),
});
export interface Navigation {
  items: NavItem[];
  admin: NavItem[];
}

/* ───────────── search ───────────── */

export const searchHitSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  href: z.string(),
  icon: z.string().optional(),
  /** i18n key of the status. */
  status: z.string().nullable().optional(),
  exact: z.boolean().optional(),
  moduleId: z.string(),
});
export type SearchHitDTO = z.input<typeof searchHitSchema>;
export const searchResponseSchema = z.object({ hits: z.array(searchHitSchema), tookMs: z.number() });

/* ───────────── dashboard ───────────── */

export const dashboardSchema = z.object({
  counts: z.object({
    users: z.number().int(),
    activeUsers: z.number().int(),
    pendingUsers: z.number().int(),
    groups: z.number().int(),
    roles: z.number().int(),
    departments: z.number().int(),
    modules: z.number().int(),
    enabledModules: z.number().int(),
    activeSessions: z.number().int(),
    expiringAssignments: z.number().int(),
  }),
  activity: z.array(z.object({ date: z.string(), total: z.number().int(), security: z.number().int() })),
  usersBySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
  recent: z.array(auditLogSchema),
});
export type Dashboard = z.input<typeof dashboardSchema>;

/* ───────────── identity providers ───────────── */

export const idpTypeSchema = z.enum(['oidc', 'saml', 'ldap']);

const groupMapping = z.object({ external: z.string().trim().min(1).max(512), groupId: id });

export const oidcConfigSchema = z.object({
  issuer: z.url(),
  clientId: z.string().trim().min(1).max(200),
  scopes: z.string().max(500).optional(),
  claims: z
    .object({
      email: z.string().max(100).optional(),
      name: z.string().max(100).optional(),
      username: z.string().max(100).optional(),
      groups: z.string().max(100).optional(),
    })
    .optional(),
  allowedDomains: z.array(z.string().max(253)).optional(),
  preset: z.enum(['entra', 'generic']).optional(),
});

export const samlConfigSchema = z.object({
  entryPoint: z.url(),
  issuer: z.string().trim().min(1).max(500),
  idpCertificate: z.string().trim().min(20),
  attributes: z
    .object({
      email: z.string().max(200).optional(),
      name: z.string().max(200).optional(),
      username: z.string().max(200).optional(),
      groups: z.string().max(200).optional(),
    })
    .optional(),
  wantAssertionsSigned: z.boolean().optional(),
});

export const ldapConfigSchema = z.object({
  url: z.string().regex(/^ldaps?:\/\//, 'Must start with ldap:// or ldaps://'),
  bindDn: z.string().trim().min(1).max(500),
  baseDn: z.string().trim().min(1).max(500),
  userFilter: z.string().trim().min(1).max(500),
  groupBaseDn: z.string().trim().max(500).optional(),
  groupFilter: z.string().trim().max(500).optional(),
  attributes: z
    .object({
      username: z.string().max(100).optional(),
      email: z.string().max(100).optional(),
      name: z.string().max(100).optional(),
      memberOf: z.string().max(100).optional(),
    })
    .optional(),
  tls: z.object({ rejectUnauthorized: z.boolean().optional() }).optional(),
});

const idpCommon = {
  key: keySchema,
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(false),
  jitProvisioning: z.boolean().default(true),
  defaultDepartmentId: id.nullish(),
  groupMappings: z.array(groupMapping).max(500).default([]),
  syncEnabled: z.boolean().default(false),
  syncCron: z.string().max(100).nullish(),
  displayOrder: z.number().int().default(0),
};

export const createIdpSchema = z.discriminatedUnion('type', [
  z.object({
    ...idpCommon,
    type: z.literal('oidc'),
    config: oidcConfigSchema,
    secrets: z.object({ clientSecret: z.string().min(1).max(2000) }).optional(),
  }),
  z.object({
    ...idpCommon,
    type: z.literal('saml'),
    config: samlConfigSchema,
    secrets: z.object({}).optional(),
  }),
  z.object({
    ...idpCommon,
    type: z.literal('ldap'),
    config: ldapConfigSchema,
    secrets: z.object({ bindPassword: z.string().min(1).max(2000) }).optional(),
  }),
]);
export type CreateIdpInput = z.input<typeof createIdpSchema>;

export const updateIdpSchema = z.object({
  name: idpCommon.name.optional(),
  enabled: z.boolean().optional(),
  jitProvisioning: z.boolean().optional(),
  defaultDepartmentId: id.nullish(),
  groupMappings: z.array(groupMapping).max(500).optional(),
  syncEnabled: z.boolean().optional(),
  syncCron: z.string().max(100).nullish(),
  displayOrder: z.number().int().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  /** Only provided keys are replaced; omitted secrets are kept. */
  secrets: z.record(z.string(), z.string().max(2000)).optional(),
});
export type UpdateIdpInput = z.input<typeof updateIdpSchema>;

export const idpSchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  type: idpTypeSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  secretKeys: z.array(z.string()),
  jitProvisioning: z.boolean(),
  defaultDepartmentId: z.string().nullable(),
  groupMappings: z.array(z.object({ external: z.string(), groupId: z.string() })),
  syncEnabled: z.boolean(),
  syncCron: z.string().nullable(),
  lastSyncAt: dateTime.nullable(),
  lastSyncStatus: z.string().nullable(),
  lastSyncMessage: z.string().nullable(),
  displayOrder: z.number().int(),
  linkedUsers: z.number().int(),
  /** Values the IdP admin needs (redirect URI, SAML ACS/metadata). */
  endpoints: z.record(z.string(), z.string()),
  updatedAt: dateTime,
});
export type IdentityProvider = z.input<typeof idpSchema>;

export const idpTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
