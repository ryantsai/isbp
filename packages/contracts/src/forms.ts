import {
  FIELD_TYPES,
  type FieldDef,
  fieldDefSchema,
  formSchemaSchema,
  listQuerySchema,
  localizedTextSchema,
  PROCESS_ACTION_OUTCOMES,
} from '@isbp/sdk';
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

/* ───────────── process actions ───────────── */

export const processActionRunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped']);
export type ProcessActionRunStatus = z.infer<typeof processActionRunStatusSchema>;

/** One process action of a request: its status and what it did. `error` is only shown to form administrators. */
export const processActionRunSchema = z.object({
  id,
  actionId: z.string(),
  /** `<module>.<action>`. */
  type: z.string(),
  /** The name the form gave the action, if any. */
  name: localizedTextSchema.nullable(),
  /** i18n key of the action type's name (when its module is installed). */
  typeName: z.string().nullable(),
  icon: z.string().nullable(),
  on: z.enum(PROCESS_ACTION_OUTCOMES),
  status: processActionRunStatusSchema,
  attempts: z.number().int(),
  result: z
    .object({
      reference: z.string().nullish(),
      href: z.string().nullish(),
      /** An i18n key in the module catalog, or short plain text. */
      summary: z.string().nullish(),
      /** The summary's ICU arguments (ISO dates are formatted as dates). */
      summaryParams: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
      record: z.object({ type: z.string(), id: z.string() }).nullish(),
    })
    .nullable(),
  /**
   * Why a `skipped` run didn't run: its condition (`FormAction.when`) didn't hold for this request, or the action is
   * no longer available (its module was disabled, the form version is gone).
   */
  reason: z.enum(['condition', 'unavailable']).nullable(),
  error: z.object({ code: z.string().nullable(), message: z.string() }).nullable(),
  canRetry: z.boolean(),
  nextAttemptAt: dateTime.nullable(),
  createdAt: dateTime,
  startedAt: dateTime.nullable(),
  finishedAt: dateTime.nullable(),
});
export type ProcessActionRun = z.input<typeof processActionRunSchema>;

/** A reminder a request's action scheduled (`core.remind`): sent through the notification centre when due. */
export const requestReminderSchema = z.object({
  id,
  /** The action (`FormAction.id`) that set it. */
  actionId: z.string().nullable(),
  title: z.string(),
  dueAt: dateTime,
  status: z.enum(['pending', 'sent', 'cancelled']),
  sentAt: dateTime.nullable(),
});
export type RequestReminder = z.input<typeof requestReminderSchema>;

/** A configuration field of an action (the shared FieldDef model; options can be empty when nothing applies). */
const processActionFieldSchema = z.looseObject({
  key: z.string(),
  type: z.enum(FIELD_TYPES),
  label: localizedTextSchema,
});

/** An action type a form builder can add (`allowed`: the caller holds its permission). */
export const processActionTypeSchema = z.object({
  type: z.string(),
  moduleId: z.string(),
  /** i18n keys. */
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  permission: z.string(),
  allowed: z.boolean(),
  /** Config keys holding secrets: stored sealed, sent back as `{ set: true }`, password inputs in the builder. */
  secrets: z.array(z.string()),
  fields: z.array(processActionFieldSchema),
});
export type ProcessActionType = Omit<z.input<typeof processActionTypeSchema>, 'fields'> & {
  fields: FieldDef[];
};

export const processActionCatalogQuerySchema = z.object({ formId: id.optional() });
/** The builder sends its unsaved draft, so options follow the fields it has now. */
export const processActionCatalogInputSchema = z.object({
  formId: id.optional(),
  draft: formSchemaSchema.optional(),
});
export const processActionCatalogSchema = z.object({ items: z.array(processActionTypeSchema) });

/**
 * One decision on a request's approval, with what the approver filled in (`ApprovalStep.fields`): render `data` with
 * `fields` (labels per language, shown in the reader's) as the request's answers are.
 */
export const requestDecisionSchema = z.object({
  taskId: id,
  stepId: z.string(),
  step: localizedTextSchema,
  status: z.enum(['approved', 'rejected']),
  /** Null for an automatic decision after the step's deadline. */
  decidedBy: personRefSchema.nullable(),
  decidedAt: dateTime.nullable(),
  comment: z.string().nullable(),
  /** The step's fields (empty when it asks for none). */
  fields: z.array(fieldDefSchema),
  /** The values, by field key (`user` fields: names in the submission's `people`). */
  data: z.record(z.string(), z.unknown()),
});
export type RequestDecision = z.input<typeof requestDecisionSchema>;

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
  /** What the request set off (the version's process actions), in the order they were queued. */
  actions: z.array(processActionRunSchema),
  /** Reminders its actions scheduled (`core.remind`), by due date. */
  reminders: z.array(requestReminderSchema),
  /** The approval's decisions in order, each with the values its approver filled in. */
  decisions: z.array(requestDecisionSchema),
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
