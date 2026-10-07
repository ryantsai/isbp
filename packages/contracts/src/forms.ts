import { fieldDefSchema, formSchemaSchema, listQuerySchema, localizedTextSchema } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id, keySchema } from './common';
import { fulfilmentSchema } from './requests';
import { personRefSchema, workflowInstanceSummarySchema } from './workflows';

/* ───────────── custom fields ───────────── */

export const customFieldEntitySchema = z.object({
  type: z.string(),
  moduleId: z.string(),
  name: z.string(),
  fieldCount: z.number().int(),
});
export type CustomFieldEntity = z.input<typeof customFieldEntitySchema>;

export const customFieldSchema = z.object({
  id,
  entityType: z.string(),
  key: z.string(),
  field: fieldDefSchema,
  sortOrder: z.number().int(),
  archived: z.boolean(),
  /** How many records have a value (helps decide whether a change is safe). */
  usage: z.number().int(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type CustomField = z.input<typeof customFieldSchema>;

export const customFieldQuerySchema = z.object({
  entityType: z.string().max(100),
  includeArchived: z.stringbool().default(false),
});

export const createCustomFieldSchema = z.object({ entityType: z.string().max(100), field: fieldDefSchema });
export type CreateCustomFieldInput = z.input<typeof createCustomFieldSchema>;

/** The key and type of an existing field are fixed (stored values depend on them). */
export const updateCustomFieldSchema = z.object({ field: fieldDefSchema });
export type UpdateCustomFieldInput = z.input<typeof updateCustomFieldSchema>;

export const reorderCustomFieldsSchema = z.object({
  entityType: z.string().max(100),
  ids: z.array(id).max(200),
});

/** Values for an entity's custom fields (validated against the definitions). */
export const attributesSchema = z.record(z.string().max(64), z.unknown());

/* ───────────── forms ───────────── */

export const formAudienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('everyone') }),
  z.object({ type: z.literal('groups'), groupKeys: z.array(z.string().max(100)).min(1).max(50) }),
]);
export type FormAudience = z.input<typeof formAudienceSchema>;

export const formSummarySchema = z.object({
  id,
  key: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  icon: z.string(),
  category: z.string().nullable(),
  publishedVersion: z.number().int().nullable(),
  active: z.boolean(),
  archived: z.boolean(),
  hasUnpublishedChanges: z.boolean(),
  fieldCount: z.number().int(),
  workflow: z.object({ id, name: z.string() }).nullable(),
  audience: formAudienceSchema,
  submissionCount: z.number().int(),
  pendingCount: z.number().int(),
  updatedAt: dateTime,
});
export type FormSummary = z.input<typeof formSummarySchema>;

export const formDetailSchema = formSummarySchema.extend({
  draft: formSchemaSchema,
  published: formSchemaSchema.nullable(),
  versions: z.array(
    z.object({ version: z.number().int(), publishedAt: dateTime, publishedBy: personRefSchema.nullable() }),
  ),
});
export type FormDetail = z.input<typeof formDetailSchema>;

export const formListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  includeArchived: z.stringbool().default(false),
});

const icon = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

export const createFormSchema = z.object({
  key: keySchema,
  name: localizedTextSchema,
  description: localizedTextSchema.nullish(),
  icon: icon.optional(),
  category: z.string().trim().max(64).nullish(),
});
export type CreateFormInput = z.input<typeof createFormSchema>;

export const updateFormSchema = z.object({
  name: localizedTextSchema.optional(),
  description: localizedTextSchema.nullish(),
  icon: icon.optional(),
  category: z.string().trim().max(64).nullish(),
  draft: formSchemaSchema.optional(),
  workflowDefinitionId: id.nullish(),
  audience: formAudienceSchema.optional(),
  active: z.boolean().optional(),
});
export type UpdateFormInput = z.input<typeof updateFormSchema>;

export const catalogItemSchema = z.object({
  id,
  key: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  icon: z.string(),
  category: z.string().nullable(),
  hasApproval: z.boolean(),
});
export type CatalogItem = z.input<typeof catalogItemSchema>;

export const publishedFormSchema = z.object({
  id,
  key: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  icon: z.string(),
  version: z.number().int(),
  schema: formSchemaSchema,
  hasApproval: z.boolean(),
});
export type PublishedForm = z.input<typeof publishedFormSchema>;

export const submitFormSchema = z.object({ data: z.record(z.string().max(64), z.unknown()) });

export const submissionStatusSchema = z.enum(['submitted', 'pending', 'approved', 'rejected', 'cancelled']);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

export const formSubmissionSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  form: z.object({ id, key: z.string(), name: localizedTextSchema, icon: z.string() }),
  version: z.number().int(),
  /** The schema the submission was made with (to render the answers). */
  schema: formSchemaSchema,
  data: z.record(z.string(), z.unknown()),
  /** Display names for `user` fields. */
  people: z.record(z.string(), z.string()),
  status: submissionStatusSchema,
  submittedBy: personRefSchema.nullable(),
  createdAt: dateTime,
  completedAt: dateTime.nullable(),
  workflow: workflowInstanceSummarySchema.nullable(),
  canCancel: z.boolean(),
  /** A module's fulfilment progress (e.g. the service-desk ticket), set through `ctx.forms`. */
  fulfilment: fulfilmentSchema.nullable(),
});
export type FormSubmission = z.input<typeof formSubmissionSchema>;

export const submissionQuerySchema = listQuerySchema.extend({ status: submissionStatusSchema.optional() });

export const submissionSummarySchema = formSubmissionSchema.pick({
  id: true,
  number: true,
  reference: true,
  status: true,
  submittedBy: true,
  createdAt: true,
  completedAt: true,
});
export type SubmissionSummary = z.input<typeof submissionSummarySchema>;
