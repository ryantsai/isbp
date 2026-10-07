import { dateTime } from '@isbp/contracts';
import { listQuerySchema, localizedTextSchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  CI_CRITICALITIES,
  CI_ENVIRONMENTS,
  CI_STATUSES,
  CI_VIEWS,
  MAX_IMPACT_DEPTH,
  RELATIONSHIP_TYPES,
} from './model';

export * from './model';

export const ciStatusSchema = z.enum(CI_STATUSES);
export const ciEnvironmentSchema = z.enum(CI_ENVIRONMENTS);
export const ciCriticalitySchema = z.enum(CI_CRITICALITIES);
export const relationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);
export const relationDirectionSchema = z.enum(['outgoing', 'incoming']);

/** Stored LocalizedText (any locale may be missing). */
const localizedOut = z.object({
  en: z.string().optional(),
  'zh-TW': z.string().optional(),
  'ja-JP': z.string().optional(),
});

/* ───────────────────────────── classes ───────────────────────────── */

export const CLASS_KEY_RE = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
export const ICON_RE = /^[a-z][a-z0-9-]{0,62}$/;

export const ciClassRefSchema = z.object({ key: z.string(), name: localizedOut, icon: z.string() });
export type CiClassRef = z.input<typeof ciClassRefSchema>;

export const ciClassSchema = ciClassRefSchema.extend({
  description: localizedOut.nullable(),
  system: z.boolean(),
  sortOrder: z.number().int(),
  /** CIs of this class (a class in use can't be deleted). */
  ciCount: z.number().int(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type CiClass = z.input<typeof ciClassSchema>;

export const createClassSchema = z.object({
  key: z.string().trim().regex(CLASS_KEY_RE, 'Lowercase letters, digits and dashes (3–64)'),
  name: localizedTextSchema,
  description: localizedTextSchema.nullish(),
  icon: z.string().trim().regex(ICON_RE, 'A lucide icon name').default('box'),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});
export type CreateClassInput = z.input<typeof createClassSchema>;

export const updateClassSchema = z
  .object({
    name: localizedTextSchema,
    description: localizedTextSchema.nullable(),
    icon: z.string().trim().regex(ICON_RE, 'A lucide icon name'),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();
export type UpdateClassInput = z.input<typeof updateClassSchema>;

/* ───────────────────────────── configuration items ───────────────────────────── */

const personRef = z.object({ id: z.uuid(), displayName: z.string(), avatarUrl: z.string().nullable() });
const namedRef = z.object({ id: z.uuid(), name: z.string() });

/** The smallest useful description of a CI (relationships, impact, other modules' slots). */
export const ciRefSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  /** `CI-00042`. */
  reference: z.string(),
  name: z.string(),
  class: ciClassRefSchema,
  status: ciStatusSchema,
  environment: ciEnvironmentSchema.nullable(),
  criticality: ciCriticalitySchema,
});
export type CiRef = z.input<typeof ciRefSchema>;

export const ciSummarySchema = ciRefSchema.extend({
  owner: personRef.nullable(),
  supportGroup: namedRef.nullable(),
  department: namedRef.nullable(),
  tags: z.array(z.string()),
  updatedAt: dateTime,
});
export type CiSummary = z.input<typeof ciSummarySchema>;

export const ciDetailSchema = ciSummarySchema.extend({
  description: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  relationshipCounts: z.object({
    total: z.number().int(),
    /** This CI is the source. */
    outgoing: z.number().int(),
    /** This CI is the target. */
    incoming: z.number().int(),
  }),
  /** The viewer may edit, retire or delete it and change its relationships. */
  canManage: z.boolean(),
  createdAt: dateTime,
});
export type CiDetail = z.input<typeof ciDetailSchema>;

export const CI_SORT_KEYS = [
  'number',
  'name',
  'class',
  'status',
  'environment',
  'criticality',
  'updatedAt',
] as const;

export const ciQuerySchema = listQuerySchema.extend({
  /** Quick tab: a set of classes. */
  view: z.enum(Object.keys(CI_VIEWS) as [keyof typeof CI_VIEWS, ...(keyof typeof CI_VIEWS)[]]).optional(),
  class: z.string().trim().max(64).optional(),
  status: ciStatusSchema.optional(),
  environment: ciEnvironmentSchema.optional(),
  criticality: ciCriticalitySchema.optional(),
  owner: z.uuid().optional(),
  supportGroup: z.uuid().optional(),
});
export type CiQuery = z.input<typeof ciQuerySchema>;

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[^,]+$/, 'Tags cannot contain commas');

const ciFields = {
  name: z.string().trim().min(1).max(200),
  classKey: z.string().trim().min(1).max(64),
  status: ciStatusSchema,
  environment: ciEnvironmentSchema.nullable(),
  criticality: ciCriticalitySchema,
  ownerId: z.uuid().nullable(),
  supportGroupId: z.uuid().nullable(),
  departmentId: z.uuid().nullable(),
  description: z.string().trim().max(10_000).nullable(),
  tags: z.array(tagSchema).max(20),
  /** Custom field values (`cmdb.ci`). */
  attributes: z.record(z.string().max(64), z.unknown()),
};

export const createCiSchema = z.object({
  name: ciFields.name,
  classKey: ciFields.classKey,
  status: ciFields.status.default('in_use'),
  environment: ciFields.environment.optional(),
  criticality: ciFields.criticality.default('medium'),
  ownerId: ciFields.ownerId.optional(),
  supportGroupId: ciFields.supportGroupId.optional(),
  departmentId: ciFields.departmentId.optional(),
  description: ciFields.description.optional(),
  tags: ciFields.tags.default([]),
  attributes: ciFields.attributes.optional(),
});
export type CreateCiInput = z.input<typeof createCiSchema>;

export const updateCiSchema = z.object(ciFields).partial();
export type UpdateCiInput = z.input<typeof updateCiSchema>;

/* ───────────────────────────── relationships ───────────────────────────── */

export const createRelationshipSchema = z.object({
  sourceId: z.uuid(),
  targetId: z.uuid(),
  type: relationshipTypeSchema,
  note: z.string().trim().max(500).nullish(),
});
export type CreateRelationshipInput = z.input<typeof createRelationshipSchema>;

export const relationshipSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  targetId: z.uuid(),
  type: relationshipTypeSchema,
  note: z.string().nullable(),
  createdAt: dateTime,
});
export type Relationship = z.input<typeof relationshipSchema>;

/** A relationship from one CI's point of view: `ci` is the other end. */
export const ciRelationSchema = z.object({
  id: z.uuid(),
  type: relationshipTypeSchema,
  direction: relationDirectionSchema,
  /** English label from this CI's point of view, e.g. "depends on" / "used by". */
  label: z.string(),
  note: z.string().nullable(),
  ci: ciRefSchema,
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  createdAt: dateTime,
});
export type CiRelation = z.input<typeof ciRelationSchema>;

/* ───────────────────────────── impact ───────────────────────────── */

export const impactQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(MAX_IMPACT_DEPTH).default(3),
});

export const impactNodeSchema = z.object({
  ci: ciRefSchema,
  /** 1 = directly linked to the analysed CI. */
  depth: z.number().int(),
  /** Type of the relationship on the path that reached this CI. */
  edgeType: relationshipTypeSchema,
  /** The CI it was reached from (the analysed CI at depth 1). */
  parentId: z.uuid(),
  /** A business service: what users notice first. */
  isService: z.boolean(),
});
export type ImpactNode = z.input<typeof impactNodeSchema>;

export const impactSchema = z.object({
  root: ciRefSchema,
  depth: z.number().int(),
  /** Upstream: what breaks if this CI breaks. */
  impacted: z.array(impactNodeSchema),
  /** Downstream: what this CI needs. */
  dependsOn: z.array(impactNodeSchema),
  /** Business services among `impacted`. */
  impactedServices: z.number().int(),
  /** The result was capped (very large estates); narrow the depth. */
  truncated: z.boolean(),
});
export type Impact = z.input<typeof impactSchema>;

/* ───────────────────────────── services & lookups ───────────────────────────── */

/** What everyone may see of a business service (to pick the affected service when reporting an issue). */
export const serviceSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reference: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});
export type Service = z.input<typeof serviceSchema>;

export const serviceQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const lookupQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  ids: z.union([z.uuid(), z.array(z.uuid()).max(50)]).optional(),
});

export const lookupItemSchema = z.object({ id: z.uuid(), name: z.string(), hint: z.string().nullable() });
export type LookupItem = z.input<typeof lookupItemSchema>;

/* ───────────────────────────── slots ───────────────────────────── */

/**
 * Props of the `cmdb.ci.related` slot on the CI page's overview ("Related work"), e.g. ITSM's open
 * tickets for the CI.
 */
export interface CiRelatedSlotProps {
  ci: { id: string; number: number; reference: string; name: string };
}
