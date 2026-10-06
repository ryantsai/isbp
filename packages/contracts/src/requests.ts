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

/** One row of "My requests" (access requests and form submissions together). */
export const myRequestSchema = z.object({
  kind: z.enum(['access', 'form']),
  id,
  number: z.number().int(),
  reference: z.string(),
  title: localizedTextSchema,
  subtitle: z.string().nullable(),
  icon: z.string(),
  status: z.string(),
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
