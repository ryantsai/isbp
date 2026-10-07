import { createdAt, departments, groups, id, updatedAt, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import type { Condition, LocalizedText } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ActivityKind,
  LinkType,
  ResolutionCode,
  TicketStatus,
  TicketType,
  WorkingHours,
} from '../contracts';

/** All ITSM tables live in the `itsm` Postgres schema (docs/architecture.md §9.3). */
export const itsmSchema = pgSchema('itsm');

/** One human-number sequence per ticket type: INC-00042, SR-00042, PRB-00042, CHG-00042. */
export const incidentNumberSeq = itsmSchema.sequence('incident_number_seq');
export const serviceRequestNumberSeq = itsmSchema.sequence('service_request_number_seq');
export const problemNumberSeq = itsmSchema.sequence('problem_number_seq');
export const changeNumberSeq = itsmSchema.sequence('change_number_seq');

export type Channel = 'portal' | 'agent' | 'chat' | 'email' | 'phone' | 'form' | 'ai';
export type ChangeType = 'standard' | 'normal' | 'emergency';
export type Risk = 'low' | 'medium' | 'high';
export type SlaMetric = 'response' | 'resolution';
export type SlaStatus = 'running' | 'paused' | 'met' | 'breached' | 'cancelled';

/** The form submission a service request fulfils (`source->>'id'` is unique: idempotent fulfilment). */
export interface TicketSource {
  type: 'form-submission';
  id: string;
  reference: string;
  formKey: string;
  formName: LocalizedText;
}

/** Catalog answers rendered at fulfilment time (labels localized, values formatted). */
export interface TicketAnswer {
  key: string;
  label: LocalizedText;
  value: string;
}

/** Who triaged the ticket last (an agent, or an AI agent identity). */
export interface TriagedBy {
  type: 'ai' | 'agent';
  id: string | null;
  name: string;
}

/** Fields a person chose explicitly — AI triage with `onlyEmpty` never overwrites them. */
export type ManualField = 'impact' | 'urgency' | 'category' | 'group' | 'assignee' | 'priority';

/** Category tree (Network › VPN); a category may route tickets to a default assignment group. */
export const categories = itsmSchema.table(
  'categories',
  {
    id: id(),
    key: varchar('key', { length: 64 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, { onDelete: 'restrict' }),
    ticketTypes: text('ticket_types')
      .array()
      .$type<TicketType[]>()
      .notNull()
      .default(sql`'{incident,service_request}'::text[]`),
    defaultGroupId: uuid('default_group_id').references(() => groups.id, { onDelete: 'set null' }),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_key_uq').on(t.key), index('categories_parent_idx').on(t.parentId)],
);

export const tickets = itsmSchema.table(
  'tickets',
  {
    id: id(),
    type: varchar('type', { length: 20 }).$type<TicketType>().notNull(),
    number: bigint('number', { mode: 'number' }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    status: varchar('status', { length: 24 }).$type<TicketStatus>().notNull(),
    impact: smallint('impact').notNull().default(2),
    urgency: smallint('urgency').notNull().default(2),
    priority: smallint('priority').notNull().default(3),
    /** An agent chose the priority instead of the impact × urgency matrix. */
    priorityOverridden: boolean('priority_overridden').notNull().default(false),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    requesterId: uuid('requester_id').references(() => users.id, { onDelete: 'set null' }),
    requestedForId: uuid('requested_for_id').references(() => users.id, { onDelete: 'set null' }),
    /** The requester's department at creation — the scope of department-scoped agent permissions. */
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    assignmentGroupId: uuid('assignment_group_id').references(() => groups.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    channel: varchar('channel', { length: 16 }).$type<Channel>().notNull().default('portal'),
    source: jsonb('source').$type<TicketSource>(),
    answers: jsonb('answers').$type<TicketAnswer[]>(),
    major: boolean('major').notNull().default(false),
    resolutionCode: varchar('resolution_code', { length: 32 }).$type<ResolutionCode>(),
    resolutionNotes: text('resolution_notes'),
    satisfaction: smallint('satisfaction'),
    satisfactionComment: text('satisfaction_comment'),
    /** Custom fields (`itsm.ticket`). */
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    manualFields: text('manual_fields')
      .array()
      .$type<ManualField[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    triagedAt: timestamp('triaged_at', { withTimezone: true }),
    triagedBy: jsonb('triaged_by').$type<TriagedBy>(),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tickets_type_number_uq').on(t.type, t.number),
    index('tickets_queue_idx').on(t.type, t.status, t.priority),
    index('tickets_group_status_idx').on(t.assignmentGroupId, t.status),
    index('tickets_assignee_status_idx').on(t.assigneeId, t.status),
    index('tickets_requester_idx').on(t.requesterId, t.createdAt.desc()),
    index('tickets_requested_for_idx')
      .on(t.requestedForId)
      .where(sql`${t.requestedForId} is not null`),
    index('tickets_created_idx').on(t.createdAt.desc()),
    index('tickets_resolved_idx')
      .on(t.resolvedAt)
      .where(sql`${t.resolvedAt} is not null`),
    index('tickets_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
    index('tickets_department_idx').on(t.departmentId),
    index('tickets_category_idx').on(t.categoryId),
    index('tickets_major_idx')
      .on(t.status)
      .where(sql`${t.major}`),
    // Idempotent catalog fulfilment: one ticket per form submission.
    uniqueIndex('tickets_source_uq')
      .on(sql`(${t.source}->>'id')`)
      .where(sql`${t.source} is not null`),
  ],
);

export const ticketActivities = itsmSchema.table(
  'ticket_activities',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).$type<ActivityKind>().notNull(),
    /** Requesters see public entries only. */
    public: boolean('public').notNull().default(false),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Display name for AI agents, services and the system (users show their current name). */
    authorName: varchar('author_name', { length: 200 }),
    authorAi: boolean('author_ai').notNull().default(false),
    body: text('body'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_activities_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const ticketLinks = itsmSchema.table(
  'ticket_links',
  {
    id: id(),
    /** `source —type→ target`, e.g. an incident `caused_by` a problem. */
    sourceId: uuid('source_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).$type<LinkType>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ticket_links_uq').on(t.sourceId, t.targetId, t.type),
    index('ticket_links_target_idx').on(t.targetId),
  ],
);

/** Affected configuration items (read-only references into `cmdb.cis`). */
export const ticketCis = itsmSchema.table(
  'ticket_cis',
  {
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    /** Restrict: ticket history keeps its CIs — CMDB answers `IN_USE` and admins retire the CI instead. */
    ciId: uuid('ci_id')
      .notNull()
      .references(() => cis.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.ciId] }), index('ticket_cis_ci_idx').on(t.ciId)],
);

export const changes = itsmSchema.table(
  'changes',
  {
    ticketId: uuid('ticket_id')
      .primaryKey()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    changeType: varchar('change_type', { length: 16 }).$type<ChangeType>().notNull().default('normal'),
    risk: varchar('risk', { length: 8 }).$type<Risk>().notNull().default('medium'),
    reason: text('reason').notNull().default(''),
    plannedStart: timestamp('planned_start', { withTimezone: true }),
    plannedEnd: timestamp('planned_end', { withTimezone: true }),
    implementationPlan: text('implementation_plan').notNull().default(''),
    backoutPlan: text('backout_plan').notNull().default(''),
    testPlan: text('test_plan').notNull().default(''),
    /** The CAB workflow instance (`itsm.change`). */
    approvalInstanceId: uuid('approval_instance_id'),
  },
  (t) => [
    index('changes_window_idx')
      .on(t.plannedStart, t.plannedEnd)
      .where(sql`${t.plannedStart} is not null`),
    index('changes_instance_idx')
      .on(t.approvalInstanceId)
      .where(sql`${t.approvalInstanceId} is not null`),
  ],
);

export const problems = itsmSchema.table('problems', {
  ticketId: uuid('ticket_id')
    .primaryKey()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  rootCause: text('root_cause').notNull().default(''),
  workaround: text('workaround').notNull().default(''),
  knownError: boolean('known_error').notNull().default(false),
  kbArticleId: uuid('kb_article_id'),
  /** Snapshot of the linked knowledge article (the knowledge module owns the article). */
  kbArticle: jsonb('kb_article').$type<{ id: string; reference: string; title: string }>(),
});

export const businessCalendars = itsmSchema.table('business_calendars', {
  id: id(),
  name: varchar('name', { length: 200 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  hours: jsonb('hours').$type<WorkingHours>().notNull(),
  holidays: jsonb('holidays').$type<{ date: string; name: string }[]>().notNull().default([]),
  /** 24×7: business time = wall-clock time. */
  alwaysOpen: boolean('always_open').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export interface SlaTargets {
  [priority: string]: { responseMinutes: number; resolutionMinutes: number };
}

export const slaPolicies = itsmSchema.table(
  'sla_policies',
  {
    id: id(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    ticketTypes: text('ticket_types').array().$type<TicketType[]>().notNull(),
    condition: jsonb('condition').$type<Condition>(),
    targets: jsonb('targets').$type<SlaTargets>().notNull(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => businessCalendars.id, { onDelete: 'restrict' }),
    pauseStatuses: text('pause_statuses')
      .array()
      .$type<TicketStatus[]>()
      .notNull()
      .default(sql`'{on_hold}'::text[]`),
    warnAt: doublePrecision('warn_at').notNull().default(0.75),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sla_policies_order_idx').on(t.active, t.sortOrder)],
);

export const ticketSlas = itsmSchema.table(
  'ticket_slas',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => slaPolicies.id, { onDelete: 'restrict' }),
    metric: varchar('metric', { length: 16 }).$type<SlaMetric>().notNull(),
    status: varchar('status', { length: 16 }).$type<SlaStatus>().notNull().default('running'),
    /** Target in business minutes (from the policy, for the ticket's priority). */
    targetMinutes: integer('target_minutes').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Business-time deadline (extended by paused time). */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    /** When the warning threshold is reached. */
    warnAt: timestamp('warn_at', { withTimezone: true }).notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    /** Business time spent paused so far. */
    pausedMs: bigint('paused_ms', { mode: 'number' }).notNull().default(0),
    /** Met, breached or cancelled at. */
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    warnedAt: timestamp('warned_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ticket_slas_ticket_metric_uq').on(t.ticketId, t.metric),
    index('ticket_slas_due_idx')
      .on(t.dueAt)
      .where(sql`${t.status} = 'running'`),
    index('ticket_slas_warn_idx')
      .on(t.warnAt)
      .where(sql`${t.status} = 'running' and ${t.warnedAt} is null`),
    index('ticket_slas_breached_idx')
      .on(t.ticketId)
      .where(sql`${t.status} = 'breached'`),
    index('ticket_slas_policy_idx').on(t.policyId),
    index('ticket_slas_started_idx').on(t.startedAt),
  ],
);

/** Service catalog: which Phase 1 forms the service desk fulfils, and how. */
export const catalogItems = itsmSchema.table('catalog_items', {
  formKey: varchar('form_key', { length: 64 }).primaryKey(),
  active: boolean('active').notNull().default(true),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
  priority: smallint('priority').notNull().default(3),
  fulfilOn: varchar('fulfil_on', { length: 16 })
    .$type<'submitted' | 'approved'>()
    .notNull()
    .default('approved'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
