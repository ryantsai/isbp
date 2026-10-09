import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id, localeSchema, passwordSchema } from './common';

export const userStatusSchema = z.enum(['pending', 'active', 'suspended', 'offboarded']);
export type UserStatus = z.infer<typeof userStatusSchema>;
export const authSourceSchema = z.enum(['local', 'oidc', 'saml', 'ldap']);
export type AuthSource = z.infer<typeof authSourceSchema>;

export const userSummarySchema = z.object({
  id,
  email: z.string(),
  username: z.string(),
  displayName: z.string(),
  jobTitle: z.string().nullable(),
  status: userStatusSchema,
  authSource: authSourceSchema,
  avatarUrl: z.string().nullable(),
  department: z.object({ id, name: z.string() }).nullable(),
  lastLoginAt: dateTime.nullable(),
  createdAt: dateTime,
});
export type UserSummary = z.input<typeof userSummarySchema>;

export const userDetailSchema = userSummarySchema.extend({
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  phone: z.string().nullable(),
  employeeId: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
  manager: z.object({ id, displayName: z.string() }).nullable(),
  attributes: z.record(z.string(), z.unknown()),
  mustChangePassword: z.boolean(),
  lockedUntil: dateTime.nullable(),
  onboardedAt: dateTime.nullable(),
  offboardedAt: dateTime.nullable(),
  updatedAt: dateTime,
  groups: z.array(
    z.object({
      id,
      key: z.string(),
      name: z.string(),
      /** `manual` (added here) or `sync` (kept by a directory sync: change it in the directory). */
      source: z.string(),
      /** Where the group comes from: `local`, `ldap`, `oidc` or `saml`. */
      groupSource: z.string(),
    }),
  ),
  directReports: z.number().int(),
  activeSessions: z.number().int(),
});
export type UserDetail = z.input<typeof userDetailSchema>;

export const userListQuerySchema = listQuerySchema.extend({
  status: userStatusSchema.optional(),
  authSource: authSourceSchema.optional(),
  departmentId: id.optional(),
  /** With `departmentId`: include people in every sub-department. */
  subtree: z.stringbool().optional(),
  groupId: id.optional(),
  /** Custom-field filters `key:value`, e.g. `attr=costCenter:CC-1010` (repeatable, all must match). */
  attr: z
    .union([z.string().max(200), z.array(z.string().max(200)).max(10)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
});
export type UserListQuery = z.input<typeof userListQuerySchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const createUserSchema = z.object({
  email: z.email().max(320),
  username: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/, 'letters, digits, ".", "_" and "-" only'),
  displayName: z.string().trim().min(1).max(200),
  givenName: optionalText(100),
  familyName: optionalText(100),
  jobTitle: optionalText(200),
  phone: optionalText(50),
  employeeId: optionalText(64),
  departmentId: id.nullish(),
  managerId: id.nullish(),
  locale: localeSchema.default('en'),
  timezone: z.string().max(64).default('Asia/Taipei'),
  /** `pending` = pre-boarded (cannot sign in until onboarded). */
  status: z.enum(['pending', 'active']).default('active'),
  password: passwordSchema.optional(),
  groupIds: z.array(id).max(100).default([]),
  /** Custom-field values (`core.user` custom fields). */
  attributes: z.record(z.string().max(64), z.unknown()).optional(),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

// Defaults are dropped first: `.partial()` keeps `.default()`s, which would reset omitted fields.
export const updateUserSchema = createUserSchema
  .omit({ password: true, status: true, groupIds: true, username: true })
  .extend({ locale: localeSchema, timezone: z.string().max(64) })
  .partial();
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const offboardUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  removeGroupMemberships: z.boolean().default(true),
  removeRoleAssignments: z.boolean().default(true),
  transferReportsTo: id.nullish(),
});
export type OffboardUserInput = z.input<typeof offboardUserSchema>;

/** Add a person to groups and take them out of others, in one change. */
export const changeUserGroupsSchema = z
  .object({
    add: z.array(id).max(100).default([]),
    remove: z.array(id).max(100).default([]),
  })
  .refine((v) => v.add.length + v.remove.length > 0, { message: 'Nothing to change' });
export type ChangeUserGroupsInput = z.input<typeof changeUserGroupsSchema>;

/**
 * Move a person to another department in one change: the department, their manager and job title (omitted: kept),
 * the groups they leave and join, and the department-scoped role assignments to remove.
 */
export const transferUserSchema = z.object({
  departmentId: id.nullable(),
  /** Omitted: keep the current manager; `null`: no manager. */
  managerId: id.nullish(),
  /** Omitted: keep the current job title; empty or `null`: clear it. */
  jobTitle: z.string().trim().max(200).nullish(),
  leaveGroupIds: z.array(id).max(100).default([]),
  joinGroupIds: z.array(id).max(100).default([]),
  revokeAssignmentIds: z.array(id).max(100).default([]),
});
export type TransferUserInput = z.input<typeof transferUserSchema>;

export const transferOptionsQuerySchema = z.object({ departmentId: id.optional() });

/** What a move to `departmentId` suggests: the department's manager, groups to leave and join, roles to review. */
export const transferOptionsSchema = z.object({
  department: z
    .object({
      id,
      name: z.string(),
      manager: z.object({ id, displayName: z.string() }).nullable(),
    })
    .nullable(),
  /** Groups the person is in that most of their current department shares and most of the new one doesn't. */
  leave: z.array(id),
  /** Groups most of the new department belongs to that the person isn't in. */
  join: z.array(id),
  /** The person's department-scoped role assignments; `oldDepartment`: scoped to the current department or below. */
  roles: z.array(
    z.object({
      assignmentId: id,
      role: z.object({ id, key: z.string(), name: z.string(), moduleId: z.string().nullable() }),
      application: z.string().nullable(),
      scope: z.object({ id, name: z.string() }),
      oldDepartment: z.boolean(),
    }),
  ),
});
export type TransferOptions = z.input<typeof transferOptionsSchema>;

export const transferResultSchema = z.object({
  joined: z.number().int(),
  left: z.number().int(),
  revoked: z.number().int(),
});

export const setUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().max(500).optional(),
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
  mustChangePassword: z.boolean().default(true),
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const sessionInfoSchema = z.object({
  id,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: dateTime,
  lastSeenAt: dateTime,
  expiresAt: dateTime,
  current: z.boolean(),
});
export type SessionInfo = z.input<typeof sessionInfoSchema>;

/** Minimal colleague profile for pickers available to every signed-in person. */
export const personLookupSchema = z.object({
  id,
  displayName: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  department: z.string().nullable(),
  /** `pending` = pre-boarded (only with `includePreboarded`); everyone else found is `active`. */
  status: z.enum(['active', 'pending']),
});
export type PersonLookup = z.input<typeof personLookupSchema>;

export const personLookupQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  ids: z
    .union([id, z.array(id).max(50)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  /**
   * Also find pre-boarded people (not started yet) the caller may request access for: their direct reports, and
   * people in departments where the caller may assign roles. Used by "Request access → Someone else".
   */
  includePreboarded: z.stringbool().optional(),
});
