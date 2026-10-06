import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id, keySchema } from './common';
import { permissionPatternSchema, scopeTypeSchema } from './rbac';
import { riskLevelSchema } from './requests';
import { personRefSchema } from './workflows';

/* ───────────── applications (external apps answered by the Role Query API) ───────────── */

export const applicationSchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  homepageUrl: z.string().nullable(),
  owner: personRefSchema.nullable(),
  /** The platform itself — its roles are managed on the Roles page. */
  isSystem: z.boolean(),
  counts: z.object({
    roles: z.number().int(),
    permissions: z.number().int(),
    members: z.number().int(),
    clients: z.number().int(),
  }),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Application = z.input<typeof applicationSchema>;

export const createApplicationSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  homepageUrl: z.url().max(500).nullish(),
  ownerId: id.nullish(),
});
export type CreateApplicationInput = z.input<typeof createApplicationSchema>;

export const updateApplicationSchema = createApplicationSchema.omit({ key: true }).partial();
export type UpdateApplicationInput = z.input<typeof updateApplicationSchema>;

/** External apps name permissions their own way: dotted segments, e.g. `invoices.approve`. */
export const appPermissionKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9_:-]*(\.[a-z0-9][a-z0-9_:-]*){0,5}$/, 'Lowercase segments separated by dots');
export const appPermissionPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(\*|[a-z0-9][a-z0-9_:-]*)(\.(\*|[a-z0-9][a-z0-9_:-]*)){0,5}$/, 'Permission key or pattern with *');

export const appPermissionSchema = z.object({
  id,
  key: z.string(),
  description: z.string(),
  roleCount: z.number().int(),
});
export type AppPermission = z.input<typeof appPermissionSchema>;

export const createAppPermissionSchema = z.object({
  key: appPermissionKeySchema,
  description: z.string().trim().max(500).default(''),
});

export const roleRequestSettingsSchema = z.object({
  requestable: z.boolean(),
  riskLevel: riskLevelSchema,
  ownerId: id.nullable(),
  maxDurationDays: z.number().int().min(1).max(3650).nullable(),
  requestWorkflowId: id.nullable(),
});
export type RoleRequestSettings = z.input<typeof roleRequestSettingsSchema>;

export const createAppRoleSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  permissions: z.array(appPermissionPatternSchema).max(500).default([]),
});
export type CreateAppRoleInput = z.input<typeof createAppRoleSchema>;

/* ───────────── API clients ───────────── */

const cidrSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'IP address or CIDR, e.g. 10.0.0.0/8');

export const apiClientSecretSchema = z.object({
  id,
  prefix: z.string(),
  createdAt: dateTime,
  expiresAt: dateTime.nullable(),
  lastUsedAt: dateTime.nullable(),
  revokedAt: dateTime.nullable(),
  active: z.boolean(),
});
export type ApiClientSecret = z.input<typeof apiClientSecretSchema>;

export const apiClientSchema = z.object({
  id,
  clientId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  applications: z.array(z.object({ id, key: z.string(), name: z.string() })),
  allApplications: z.boolean(),
  permissions: z.array(z.string()),
  allowedCidrs: z.array(z.string()),
  revokedAt: dateTime.nullable(),
  lastUsedAt: dateTime.nullable(),
  lastUsedIp: z.string().nullable(),
  createdAt: dateTime,
  createdBy: personRefSchema.nullable(),
  secrets: z.array(apiClientSecretSchema),
});
export type ApiClient = z.input<typeof apiClientSchema>;

export const createApiClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  applicationIds: z.array(id).max(100).default([]),
  allApplications: z.boolean().default(false),
  permissions: z.array(permissionPatternSchema).max(100).default([]),
  allowedCidrs: z.array(cidrSchema).max(50).default([]),
  /** Days until the first secret expires (null = never). */
  secretExpiresInDays: z.number().int().min(1).max(730).nullish(),
});
export type CreateApiClientInput = z.input<typeof createApiClientSchema>;

export const updateApiClientSchema = createApiClientSchema.omit({ secretExpiresInDays: true }).partial();
export type UpdateApiClientInput = z.input<typeof updateApiClientSchema>;

export const rotateSecretSchema = z.object({ expiresInDays: z.number().int().min(1).max(730).nullish() });

export const createdSecretSchema = z.object({ client: apiClientSchema, secret: z.string() });
export type CreatedSecret = z.input<typeof createdSecretSchema>;

/* ───────────── Role Query API ───────────── */

export const roleQueryScopeSchema = z.object({
  type: scopeTypeSchema,
  departmentId: z.string().nullable(),
  departmentCode: z.string().nullable(),
  recordType: z.string().nullable(),
  recordId: z.string().nullable(),
});

export const roleQueryUserSchema = z.object({
  id,
  username: z.string(),
  email: z.string(),
  displayName: z.string(),
  status: z.string(),
  department: z.object({ id, code: z.string(), name: z.string() }).nullable(),
});

export const roleQueryRoleSchema = z.object({
  key: z.string(),
  name: z.string(),
  scope: roleQueryScopeSchema,
  expiresAt: dateTime.nullable(),
  source: z.enum(['direct', 'group', 'everyone']),
  group: z.object({ key: z.string(), name: z.string() }).nullable(),
});

export const roleQueryResultSchema = z.object({
  user: roleQueryUserSchema,
  application: z.object({ key: z.string(), name: z.string() }),
  /** False for suspended/offboarded people — they hold nothing. */
  active: z.boolean(),
  roles: z.array(roleQueryRoleSchema),
  /** Effective permission keys granted globally (wildcards expanded against the app's catalog). */
  permissions: z.array(z.string()),
  /** Permissions limited to a department subtree or one record. */
  scopedPermissions: z.array(z.object({ permission: z.string(), scope: roleQueryScopeSchema })),
  evaluatedAt: dateTime,
});
export type RoleQueryResult = z.input<typeof roleQueryResultSchema>;

export const roleQueryUserQuerySchema = z.object({ application: z.string().min(1).max(64) });

export const roleQueryCheckSchema = z.object({
  /** User id, email or username. */
  user: z.string().trim().min(1).max(320),
  application: z.string().min(1).max(64),
  permission: z.string().min(1).max(200),
  departmentId: id.optional(),
  recordType: z.string().max(100).optional(),
  recordId: z.string().max(200).optional(),
});
export type RoleQueryCheckInput = z.input<typeof roleQueryCheckSchema>;

export const roleQueryCheckResultSchema = z.object({
  allowed: z.boolean(),
  user: z.object({ id, username: z.string() }),
  application: z.string(),
  permission: z.string(),
  matchedRoles: z.array(z.string()),
  evaluatedAt: dateTime,
});
export type RoleQueryCheckResult = z.input<typeof roleQueryCheckResultSchema>;

export const roleQueryMembersQuerySchema = listQuerySchema.extend({ role: z.string().max(100).optional() });

export const roleQueryMemberSchema = z.object({
  user: roleQueryUserSchema,
  roles: z.array(roleQueryRoleSchema.omit({ name: true })),
});

export const oauthTokenRequestSchema = z.object({
  grant_type: z.string(),
  client_id: z.string().max(64).optional(),
  client_secret: z.string().max(200).optional(),
  scope: z.string().max(200).optional(),
});

export const oauthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
  scope: z.string(),
});

export const oauthErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

export const applicationListQuerySchema = z.object({ q: z.string().trim().max(200).optional() });
export const appMembersQuerySchema = listQuerySchema.extend({ roleId: id.optional() });
