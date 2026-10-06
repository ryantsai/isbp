import type { LocalizedText, WorkflowGraph, WorkflowState } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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
import { users } from './identity';

export type WorkflowInstanceStatus = 'running' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalTaskStatus = 'pending' | 'approved' | 'rejected' | 'delegated' | 'cancelled';

/**
 * An approval workflow for one trigger (attach point). `draft` is what the builder edits; publishing
 * snapshots it into `workflow_versions`, and instances pin the version they started with.
 */
export const workflowDefinitions = core.table(
  'workflow_definitions',
  {
    id: id(),
    key: varchar('key', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    triggerKey: varchar('trigger_key', { length: 150 }).notNull(),
    /** Used for the trigger when the caller doesn't pick a definition (one per trigger). */
    isDefault: boolean('is_default').notNull().default(false),
    /** Installed from a manifest's `defaultGraph`. */
    isSystem: boolean('is_system').notNull().default(false),
    draft: jsonb('draft').$type<WorkflowGraph>().notNull(),
    publishedVersion: integer('published_version'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('workflow_definitions_key_uq').on(t.key),
    uniqueIndex('workflow_definitions_default_uq')
      .on(t.triggerKey)
      .where(sql`${t.isDefault} and ${t.archivedAt} is null`),
    index('workflow_definitions_trigger_idx').on(t.triggerKey),
  ],
);

export const workflowVersions = core.table(
  'workflow_versions',
  {
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    graph: jsonb('graph').$type<WorkflowGraph>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.definitionId, t.version] })],
);

export const workflowInstances = core.table(
  'workflow_instances',
  {
    id: id(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    triggerKey: varchar('trigger_key', { length: 150 }).notNull(),
    moduleId: varchar('module_id', { length: 64 }).notNull(),
    subjectType: varchar('subject_type', { length: 100 }).notNull(),
    subjectId: varchar('subject_id', { length: 200 }).notNull(),
    /** Shown in inboxes; localized when the subject has a name in several languages. */
    subjectLabel: jsonb('subject_label').$type<LocalizedText>().notNull(),
    subjectHref: varchar('subject_href', { length: 500 }),
    requesterId: uuid('requester_id').references(() => users.id, { onDelete: 'set null' }),
    /** Whose manager chain approver rules use (defaults to the requester). */
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).$type<WorkflowInstanceStatus>().notNull().default('running'),
    facts: jsonb('facts').$type<Record<string, unknown>>().notNull().default({}),
    state: jsonb('state').$type<WorkflowState>().notNull(),
    /** Comment of the decision that completed the instance (e.g. the rejection reason). */
    outcomeComment: text('outcome_comment'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('workflow_instances_status_idx').on(t.status, t.startedAt.desc()),
    index('workflow_instances_requester_idx').on(t.requesterId, t.startedAt.desc()),
    index('workflow_instances_subject_idx').on(t.subjectType, t.subjectId),
    index('workflow_instances_trigger_idx').on(t.triggerKey, t.status),
    index('workflow_instances_definition_idx').on(t.definitionId),
  ],
);

/**
 * One row per (approver slot, person). A group slot fans out to every member; the first decision in a
 * slot closes the others. Delegation closes a task as `delegated` and opens one for the delegate.
 */
export const approvalTasks = core.table(
  'approval_tasks',
  {
    id: id(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    stepId: varchar('step_id', { length: 64 }).notNull(),
    slot: integer('slot').notNull(),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Original assignee when the task reached this person through delegation. */
    delegatedFromId: uuid('delegated_from_id').references(() => users.id, { onDelete: 'set null' }),
    /** Added by an SLA escalation. */
    isEscalation: boolean('is_escalation').notNull().default(false),
    status: varchar('status', { length: 20 }).$type<ApprovalTaskStatus>().notNull().default('pending'),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Who decided: the assignee, or null for the system (SLA auto-decision). */
    decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    remindAt: timestamp('remind_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    breachedAt: timestamp('breached_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('approval_tasks_assignee_idx').on(t.assigneeId, t.status, t.createdAt.desc()),
    index('approval_tasks_instance_idx').on(t.instanceId, t.stepId),
    index('approval_tasks_due_idx')
      .on(t.dueAt)
      .where(sql`${t.status} = 'pending' and ${t.dueAt} is not null and ${t.breachedAt} is null`),
    index('approval_tasks_remind_idx')
      .on(t.remindAt)
      .where(sql`${t.status} = 'pending' and ${t.remindAt} is not null and ${t.remindedAt} is null`),
  ],
);

/** Human-readable timeline of an instance (the audit log keeps the security record). */
export const workflowEvents = core.table(
  'workflow_events',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id'),
    stepId: varchar('step_id', { length: 64 }),
    type: varchar('type', { length: 40 }).notNull(),
    actorId: uuid('actor_id'),
    actorName: varchar('actor_name', { length: 200 }),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('workflow_events_instance_idx').on(t.instanceId, t.seq)],
);

/** Out-of-office: new approval tasks for `user` go to `delegate` while active. */
export const approvalDelegations = core.table(
  'approval_delegations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delegateId: uuid('delegate_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 300 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('approval_delegations_user_idx').on(t.userId, t.endsAt),
    check('approval_delegations_not_self', sql`${t.userId} <> ${t.delegateId}`),
    check('approval_delegations_window', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
