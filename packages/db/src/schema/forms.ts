import type { FieldDef, FormSchema, LocalizedText } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { core, createdAt, id, updatedAt } from './core';
import { users } from './identity';
import { workflowDefinitions, workflowInstances } from './workflow';

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
  },
  (t) => [
    uniqueIndex('form_submissions_number_uq').on(t.number),
    index('form_submissions_submitter_idx').on(t.submittedBy, t.createdAt.desc()),
    index('form_submissions_form_idx').on(t.formId, t.createdAt.desc()),
    index('form_submissions_status_idx').on(t.status),
  ],
);
