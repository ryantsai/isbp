import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id, keySchema } from './common';

/* ───────────── departments ───────────── */

export const departmentSchema = z.object({
  id,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  parentId: z.string().nullable(),
  path: z.string(),
  manager: z.object({ id, displayName: z.string() }).nullable(),
  memberCount: z.number().int(),
  sortOrder: z.number().int(),
  attributes: z.record(z.string(), z.unknown()),
  createdAt: dateTime,
});
export type Department = z.input<typeof departmentSchema>;

/** Custom-field values; validated against the entity's custom field definitions. */
const attributes = z.record(z.string().max(64), z.unknown());

export const createDepartmentSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-_]*$/, 'letters, digits, "-" and "_" only'),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  parentId: id.nullish(),
  managerId: id.nullish(),
  sortOrder: z.number().int().default(0),
  attributes: attributes.optional(),
});
export type CreateDepartmentInput = z.input<typeof createDepartmentSchema>;
/** Explicit (no defaults) so a PATCH never resets fields it does not mention. */
export const updateDepartmentSchema = z.object({
  code: createDepartmentSchema.shape.code.optional(),
  name: createDepartmentSchema.shape.name.optional(),
  description: z.string().trim().max(2000).nullish(),
  parentId: id.nullish(),
  managerId: id.nullish(),
  sortOrder: z.number().int().optional(),
  attributes: attributes.optional(),
});
export type UpdateDepartmentInput = z.input<typeof updateDepartmentSchema>;

/* ───────────── groups ───────────── */

export const groupSourceSchema = z.enum(['local', 'oidc', 'saml', 'ldap', 'system']);

export const groupSchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  source: groupSourceSchema,
  isSystem: z.boolean(),
  memberCount: z.number().int(),
  roleCount: z.number().int(),
  attributes: z.record(z.string(), z.unknown()),
  createdAt: dateTime,
});
export type Group = z.input<typeof groupSchema>;

export const groupListQuerySchema = listQuerySchema.extend({ source: groupSourceSchema.optional() });

export const createGroupSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  attributes: attributes.optional(),
});
export type CreateGroupInput = z.input<typeof createGroupSchema>;
export const updateGroupSchema = createGroupSchema.omit({ key: true }).partial();
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;

export const groupMembersInputSchema = z.object({ userIds: z.array(id).min(1).max(500) });

export const groupMemberSchema = z.object({
  id,
  displayName: z.string(),
  email: z.string(),
  status: z.string(),
  avatarUrl: z.string().nullable(),
  source: z.string(),
  addedAt: dateTime,
});
export type GroupMember = z.input<typeof groupMemberSchema>;
