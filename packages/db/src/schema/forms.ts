import type { FieldDef, FormSchema, LocalizedText } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { core, createdAt, id, updatedAt } from './core';
import { groups, users } from './identity';
import { workflowDefinitions, workflowInstances } from './workflow';

export interface SubmissionFulfilment {
  moduleId: string;
  reference: string;
  href: string;
  state: 'open' | 'done' | 'cancelled';
  statusKey: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  updatedAt: string;
}

/** Request numbers (`REQ-01042`) shared by access requests and form submissions. */
export const requestNumberSeq = core.sequence('request_number_seq', { startWith: 1000 });
export const nextRequestNumber = () => sql`nextval('core.request_number_seq')`;

/**
 * Custom fields admins add to an entity type declared in a manifest (`customFields.entities`).
 * Values live in the entity's `attributes` JSONB under `key`.
 */
export const customFields = core.table(
  'custom_fields',
  {
    id: id(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    key: varchar('key', { length: 64 }).notNull(),
    field: jsonb('field').$type<FieldDef>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('custom_fields_entity_key_uq').on(t.entityType, t.key),
    index('custom_fields_entity_idx').on(t.entityType, t.sortOrder),
  ],
);

export type FormAudience = { type: 'everyone' } | { type: 'groups'; groupKeys: string[] };

export const forms = core.table(
  'forms',
  {
    id: id(),
    key: varchar('key', { length: 100 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<LocalizedText>(),
    icon: varchar('icon', { length: 64 }).notNull().default('file-text'),
    category: varchar('category', { length: 64 }),
    draft: jsonb('draft').$type<FormSchema>().notNull(),
    publishedVersion: integer('published_version'),
    /** Approval workflow started for every submission (trigger `core.form-submission`). */
    workflowDefinitionId: uuid('workflow_definition_id').references(() => workflowDefinitions.id, {
      onDelete: 'set null',
    }),
    audience: jsonb('audience').$type<FormAudience>().notNull().default({ type: 'everyone' }),
    /** Accepting submissions (a published form can be paused). */
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('forms_key_uq').on(t.key)],
);

export const formVersions = core.table(
  'form_versions',
  {
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    schema: jsonb('schema').$type<FormSchema>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.formId, t.version] })],
);

export type SubmissionStatus = 'submitted' | 'pending' | 'approved' | 'rejected' | 'cancelled';

export const formSubmissions = core.table(
  'form_submissions',
  {
    id: id(),
    number: bigint('number', { mode: 'number' }).notNull().default(nextRequestNumber()),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 20 }).$type<SubmissionStatus>().notNull().default('submitted'),
    workflowInstanceId: uuid('workflow_instance_id').references(() => workflowInstances.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** A module's progress on the request (e.g. the ITSM ticket fulfilling it), set via `ctx.forms`. */
    fulfilment: jsonb('fulfilment').$type<SubmissionFulfilment>(),
  },
  (t) => [
    uniqueIndex('form_submissions_number_uq').on(t.number),
    index('form_submissions_submitter_idx').on(t.submittedBy, t.createdAt.desc()),
    index('form_submissions_form_idx').on(t.formId, t.createdAt.desc()),
    index('form_submissions_status_idx').on(t.status),
  ],
);

export type ProcessActionRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

/** What a process action reported (`ProcessActionResult`). */
export interface ProcessActionRunResult {
  reference?: string | null;
  href?: string | null;
  summary?: string | null;
  /** ICU arguments of the summary (ISO dates are shown as dates). */
  summaryParams?: Record<string, string | number> | null;
  record?: { type: string; id: string } | null;
}

/**
 * One process action (`FormSchema.actions`) of one submission, created in the transaction of its outcome
 * (submitted, approved, rejected) and executed by the worker after commit, with retries.
 */
export const processActionRuns = core.table(
  'process_action_runs',
  {
    id: id(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => formSubmissions.id, { onDelete: 'cascade' }),
    /** The form version whose `actions` the run comes from (actions are versioned with the form). */
    formVersion: integer('form_version').notNull(),
    actionId: varchar('action_id', { length: 64 }).notNull(),
    /** `<module>.<action>`, e.g. `itsm.create-change`. */
    type: varchar('type', { length: 100 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).$type<'submitted' | 'approved' | 'rejected'>().notNull(),
    status: varchar('status', { length: 16 }).$type<ProcessActionRunStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** The approver whose decision led to the run (approved / rejected outcomes). */
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    result: jsonb('result').$type<ProcessActionRunResult>(),
    /** Last error (shown to administrators). */
    error: text('error'),
    errorCode: varchar('error_code', { length: 64 }),
    /** When a queued run may next be attempted (retries back off exponentially). */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('process_action_runs_submission_action_uq').on(t.submissionId, t.actionId),
    index('process_action_runs_status_idx').on(t.status, t.nextAttemptAt),
  ],
);

export type FormAssignmentStatus = 'open' | 'done' | 'cancelled';

/**
 * A form someone is asked to fill in by a date (Phase 8): a recurring checklist opened by a scheduled job (monthly
 * server room inspection, yearly firewall review…) or assigned by hand. Assigned to a person or to a group (any
 * member may do it); submitting the form from the assignment completes it.
 */
export const formAssignments = core.table(
  'form_assignments',
  {
    id: id(),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeGroupId: uuid('assignee_group_id').references(() => groups.id, { onDelete: 'set null' }),
    /** The period it covers (e.g. `2026-10`), shown and used to spot missed periods. */
    periodKey: varchar('period_key', { length: 32 }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 16 }).$type<FormAssignmentStatus>().notNull().default('open'),
    submissionId: uuid('submission_id').references(() => formSubmissions.id, { onDelete: 'set null' }),
    /** What opened it: `{ type: 'job', id }` (a scheduled job) or `{ type: 'manual' }`. */
    source: jsonb('source').$type<{ type: string; id?: string | null }>().notNull(),
    /** Makes job-created assignments idempotent (one per form, period and assignee). */
    dedupeKey: varchar('dedupe_key', { length: 300 }),
    note: text('note'),
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('form_assignments_dedupe_uq').on(t.dedupeKey),
    index('form_assignments_status_due_idx').on(t.status, t.dueAt),
    index('form_assignments_user_idx').on(t.assigneeUserId, t.status),
    index('form_assignments_group_idx').on(t.assigneeGroupId, t.status),
    index('form_assignments_form_idx').on(t.formId, t.createdAt.desc()),
  ],
);
