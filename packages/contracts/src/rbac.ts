import { isPermissionPattern, listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id, keySchema } from './common';
import { grantSchema } from './auth';

export const scopeTypeSchema = z.enum(['global', 'department', 'record']);
export type ScopeTypeValue = z.infer<typeof scopeTypeSchema>;

export const permissionSchema = z.object({
  key: z.string(),
  moduleId: z.string().nullable(),
  description: z.string(),
  scopes: z.array(z.string()),
});
export type PermissionInfo = z.input<typeof permissionSchema>;

export const permissionPatternSchema = z
  .string()
  .max(200)
  .refine(isPermissionPattern, 'Use module.resource.action, with optional * wildcards');

export const roleSchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  moduleId: z.string().nullable(),
  application: z.object({ id, key: z.string(), name: z.string(), isPlatform: z.boolean() }),
  permissions: z.array(z.string()),
  assignmentCount: z.number().int(),
  /** Self-service request settings. */
  requestable: z.boolean(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  owner: z.object({ id, displayName: z.string() }).nullable(),
  maxDurationDays: z.number().int().nullable(),
  requestWorkflow: z.object({ id, name: z.string() }).nullable(),
  updatedAt: dateTime,
});
export type Role = z.input<typeof roleSchema>;

export const createRoleSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  permissions: z.array(permissionPatternSchema).max(500).default([]),
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = createRoleSchema.omit({ key: true }).partial();
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const principalTypeSchema = z.enum(['user', 'group']);

export const roleAssignmentSchema = z.object({
  id,
  role: z.object({ id, key: z.string(), name: z.string() }),
  principal: z.object({ type: principalTypeSchema, id, name: z.string(), detail: z.string().nullable() }),
  scopeType: scopeTypeSchema,
  scope: z.object({
    departmentId: z.string().nullable(),
    departmentName: z.string().nullable(),
    recordType: z.string().nullable(),
    recordId: z.string().nullable(),
  }),
  expiresAt: dateTime.nullable(),
  expired: z.boolean(),
  source: z.string(),
  reason: z.string().nullable(),
  grantedBy: z.object({ id, displayName: z.string() }).nullable(),
  grantedAt: dateTime,
});
export type RoleAssignment = z.input<typeof roleAssignmentSchema>;

export const roleAssignmentQuerySchema = listQuerySchema.extend({
  roleId: id.optional(),
  applicationId: id.optional(),
  userId: id.optional(),
  groupId: id.optional(),
  includeExpired: z.stringbool().default(false),
});

export const createRoleAssignmentSchema = z
  .object({
    roleId: id,
    principalType: principalTypeSchema,
    principalId: id,
    scopeType: scopeTypeSchema.default('global'),
    scopeDepartmentId: id.nullish(),
    scopeRecordType: z.string().trim().max(100).nullish(),
    scopeRecordId: z.string().trim().max(200).nullish(),
    expiresAt: dateTime.nullish(),
    reason: z.string().trim().max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.scopeType === 'department' && !v.scopeDepartmentId) {
      ctx.addIssue({ code: 'custom', path: ['scopeDepartmentId'], message: 'Department is required' });
    }
    if (v.scopeType === 'record' && (!v.scopeRecordType || !v.scopeRecordId)) {
      ctx.addIssue({ code: 'custom', path: ['scopeRecordId'], message: 'Record type and id are required' });
    }
    if (v.expiresAt && v.expiresAt.getTime() <= Date.now()) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must be in the future' });
    }
  });
export type CreateRoleAssignmentInput = z.input<typeof createRoleAssignmentSchema>;

export const effectivePermissionsSchema = z.object({
  grants: z.array(grantSchema),
  sources: z.array(
    z.object({
      permission: z.string(),
      role: z.object({ id, key: z.string(), name: z.string() }),
      via: z.enum(['direct', 'group', 'everyone']),
      group: z.object({ id, name: z.string() }).nullable(),
      scopeType: scopeTypeSchema,
      scopeLabel: z.string().nullable(),
      expiresAt: dateTime.nullable(),
    }),
  ),
});
export type EffectivePermissions = z.input<typeof effectivePermissionsSchema>;
