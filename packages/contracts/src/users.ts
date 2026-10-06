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
  groups: z.array(z.object({ id, key: z.string(), name: z.string() })),
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

export const updateUserSchema = createUserSchema
  .omit({ password: true, status: true, groupIds: true, username: true })
  .partial();
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const offboardUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  removeGroupMemberships: z.boolean().default(true),
  removeRoleAssignments: z.boolean().default(true),
  transferReportsTo: id.nullish(),
});
export type OffboardUserInput = z.input<typeof offboardUserSchema>;

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
});
export type PersonLookup = z.input<typeof personLookupSchema>;

export const personLookupQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  ids: z
    .union([id, z.array(id).max(50)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
});
