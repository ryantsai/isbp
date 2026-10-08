import { listQuerySchema, localizedTextSchema } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id } from './common';
import { personRefSchema, workflowInstanceSummarySchema } from './workflows';

/** Human-friendly request number: `REQ-01042`. */
export function formatRequestNumber(n: number): string {
  return `REQ-${String(n).padStart(5, '0')}`;
}
/** `REQ-01042` / `1042` → 1042. */
export function parseRequestNumber(ref: string): number | null {
  const m = /^(?:REQ-)?0*(\d{1,12})$/i.exec(ref.trim());
  return m ? Number(m[1]) : null;
}

export const riskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const requestableRoleSchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Set for roles a module declares: translated from `<moduleId>.systemRoles.<key>`. */
  moduleId: z.string().nullable(),
  application: z.object({ id, key: z.string(), name: z.string(), isPlatform: z.boolean() }),
  riskLevel: riskLevelSchema,
  maxDurationDays: z.number().int().nullable(),
  owner: personRefSchema.nullable(),
  /** The viewer (or `for` person) already holds it globally. */
  held: z.boolean(),
  pendingRequest: z.object({ id, reference: z.string() }).nullable(),
});
export type RequestableRole = z.input<typeof requestableRoleSchema>;

export const requestableRoleQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  applicationId: id.optional(),
  /** Check held/pending for someone else (manager requesting for a report). */
  for: id.optional(),
});

export const accessRequestStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled', 'failed']);
export type AccessRequestStatus = z.infer<typeof accessRequestStatusSchema>;

export const createAccessRequestSchema = z
  .object({
    roleId: id,
    /** Someone else (your direct report, or anyone if you may assign roles). Default: yourself. */
    beneficiaryId: id.nullish(),
    scopeType: z.enum(['global', 'department']).default('global'),
    scopeDepartmentId: id.nullish(),
    /** Null = permanent (only when the role allows it). */
    durationDays: z.number().int().min(1).max(3650).nullish(),
    justification: z.string().trim().min(10).max(2000),
  })
  .superRefine((v, ctx) => {
    if (v.scopeType === 'department' && !v.scopeDepartmentId)
      ctx.addIssue({ code: 'custom', path: ['scopeDepartmentId'], message: 'Department is required' });
  });
export type CreateAccessRequestInput = z.input<typeof createAccessRequestSchema>;

export const accessRequestSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  role: z.object({
    id,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    moduleId: z.string().nullable(),
    riskLevel: riskLevelSchema,
    application: z.object({ key: z.string(), name: z.string() }),
  }),
  requester: personRefSchema.nullable(),
  beneficiary: personRefSchema,
  scopeType: z.enum(['global', 'department', 'record']),
  scopeDepartment: z.object({ id, name: z.string() }).nullable(),
  durationDays: z.number().int().nullable(),
  justification: z.string(),
  status: accessRequestStatusSchema,
  failureReason: z.string().nullable(),
  expiresAt: dateTime.nullable(),
  decidedAt: dateTime.nullable(),
  createdAt: dateTime,
  workflow: workflowInstanceSummarySchema.nullable(),
  canCancel: z.boolean(),
});
export type AccessRequest = z.input<typeof accessRequestSchema>;

export const accessRequestQuerySchema = listQuerySchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: accessRequestStatusSchema.optional(),
  roleId: id.optional(),
});

/** A module's progress on a request (e.g. the service-desk ticket fulfilling a form submission). */
export const fulfilmentSchema = z.object({
  moduleId: z.string(),
  reference: z.string(),
  href: z.string(),
  state: z.enum(['open', 'done', 'cancelled']),
  /** i18n key in the module's catalog, e.g. `itsm.status.in_progress`. */
  statusKey: z.string(),
  tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).nullable(),
  updatedAt: dateTime,
});
export type Fulfilment = z.input<typeof fulfilmentSchema>;

/**
 * One row of "My requests": access requests, form submissions and module records registered through
 * `ctx.portal` (e.g. incidents), newest first.
 */
export const myRequestSchema = z.object({
  kind: z.enum(['access', 'form', 'module']),
  /** Record id (a uuid for access/form; the module's id for module rows). */
  id: z.string(),
  number: z.number().int().nullable(),
  reference: z.string(),
  title: localizedTextSchema,
  subtitle: z.string().nullable(),
  icon: z.string(),
  /** Access/form: their status. Module rows: `open` or `closed` (label from `statusKey`). */
  status: z.string(),
  /** Module rows: status label key in the module catalog. */
  statusKey: z.string().nullable(),
  tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).nullable(),
  /** Where the row links to (module rows); access/form rows open `/requests/<reference>`. */
  href: z.string().nullable(),
  moduleId: z.string().nullable(),
  fulfilment: fulfilmentSchema.nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
  workflow: workflowInstanceSummarySchema
    .pick({ status: true, currentSteps: true, pendingWith: true })
    .nullable(),
});
export type MyRequest = z.input<typeof myRequestSchema>;

export const myRequestQuerySchema = listQuerySchema.extend({
  status: z.enum(['open', 'closed']).optional(),
});

export const accessRequestPreviewInputSchema = z.object({
  roleId: id,
  beneficiaryId: id.nullish(),
  durationDays: z.number().int().min(1).max(3650).nullish(),
  scopeType: z.enum(['global', 'department']).optional(),
});

/** The approval path a request would take, with the people each step would ask. */
export const approvalPreviewSchema = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      name: localizedTextSchema,
      type: z.enum(['approval', 'notify']),
      outcome: z.enum(['ask', 'skipped', 'no-approver', 'reject']),
      people: z.array(personRefSchema),
    }),
  ),
});
export type ApprovalPreview = z.input<typeof approvalPreviewSchema>;

/** A module's card in the portal's "What do you need?" (`manifest.portal.entries`). */
export const portalEntrySchema = z.object({
  moduleId: z.string(),
  id: z.string(),
  /** i18n keys in the module's catalog. */
  label: z.string(),
  description: z.string().nullable(),
  icon: z.string(),
  href: z.string(),
  order: z.number(),
});
export type PortalEntry = z.input<typeof portalEntrySchema>;
