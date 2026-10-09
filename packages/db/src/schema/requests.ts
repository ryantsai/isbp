import { sql } from 'drizzle-orm';
import { bigint, index, integer, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { core, createdAt, id, scopeType, updatedAt } from './core';
import { nextRequestNumber } from './forms';
import { departments, users } from './identity';
import { roles } from './rbac';
import { workflowInstances } from './workflow';

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'failed';

/** Self-service role requests, decided by the `core.access-request` workflow. */
export const accessRequests = core.table(
  'access_requests',
  {
    id: id(),
    number: bigint('number', { mode: 'number' }).notNull().default(nextRequestNumber()),
    requesterId: uuid('requester_id').references(() => users.id, { onDelete: 'set null' }),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // History outlives the role: a role (or its application) with access requests on record can't be deleted.
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    scopeType: scopeType('scope_type').notNull().default('global'),
    scopeDepartmentId: uuid('scope_department_id').references(() => departments.id, { onDelete: 'cascade' }),
    /** Requested duration; null = permanent. */
    durationDays: integer('duration_days'),
    justification: text('justification').notNull(),
    status: varchar('status', { length: 20 }).$type<AccessRequestStatus>().notNull().default('pending'),
    /** Why fulfilment failed (e.g. the person was offboarded meanwhile). */
    failureReason: text('failure_reason'),
    workflowInstanceId: uuid('workflow_instance_id').references(() => workflowInstances.id, {
      onDelete: 'set null',
    }),
    /** The granted role assignment (no FK: it is deleted when the access expires). */
    assignmentId: uuid('assignment_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('access_requests_number_uq').on(t.number),
    index('access_requests_beneficiary_idx').on(t.beneficiaryId, t.createdAt.desc()),
    index('access_requests_requester_idx').on(t.requesterId, t.createdAt.desc()),
    index('access_requests_status_idx').on(t.status, t.createdAt.desc()),
    index('access_requests_role_idx').on(t.roleId),
    /** One open request per person, role and scope. */
    uniqueIndex('access_requests_pending_uq')
      .on(
        t.beneficiaryId,
        t.roleId,
        t.scopeType,
        sql`coalesce(${t.scopeDepartmentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.status} = 'pending'`),
  ],
);
