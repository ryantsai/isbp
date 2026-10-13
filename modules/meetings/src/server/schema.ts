import { createdAt, id, updatedAt, users } from '@isbp/db/schema';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  date,
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
import type { Destination, ItemStatus, MeetingStatus, RouteError, Visibility } from '../model';

/**
 * All tables of this module live in the `meetings` Postgres schema. Other modules never read them: they link to
 * meetings through the record registry and reach them through the AI tool registry.
 */
export const meetingsSchema = pgSchema('meetings');

/** Human numbers: `MTG-00042`. */
export const meetingNumberSeq = meetingsSchema.sequence('meeting_number_seq');

const day = (name: string) => date(name, { mode: 'string' });

export const meetings = meetingsSchema.table(
  'meetings',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('meetings.meeting_number_seq')`),
    title: varchar('title', { length: 200 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: smallint('duration_minutes').notNull().default(60),
    location: varchar('location', { length: 300 }),
    /** `private`: attendees (and readers of every meeting); `internal`: everyone who uses Meetings. */
    visibility: varchar('visibility', { length: 10 }).$type<Visibility>().notNull().default('private'),
    /** `draft` while the minutes are written; `published` once sent to the attendees. */
    status: varchar('status', { length: 10 }).$type<MeetingStatus>().notNull().default('draft'),
    organizerId: uuid('organizer_id').references(() => users.id, { onDelete: 'set null' }),
    /** People who attended without an account here, by name. */
    guests: varchar('guests', { length: 500 }),
    /** The notes as taken (Markdown). */
    notes: text('notes'),
    /** The minutes: a summary, decisions and open questions (action items are rows). */
    summary: text('summary'),
    decisions: jsonb('decisions').$type<string[]>().notNull().default([]),
    questions: jsonb('questions').$type<string[]>().notNull().default([]),
    /** The meeting this one follows up (its open items are shown here). */
    previousId: uuid('previous_id').references((): AnyPgColumn => meetings.id, { onDelete: 'set null' }),
    organisedMode: varchar('organised_mode', { length: 10 }).$type<'llm' | 'builtin'>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('meetings_number_uq').on(t.number),
    index('meetings_starts_idx').on(t.startsAt),
    index('meetings_organizer_idx').on(t.organizerId, t.startsAt),
    index('meetings_previous_idx').on(t.previousId),
    index('meetings_status_idx').on(t.status),
    index('meetings_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
  ],
);

export const attendees = meetingsSchema.table(
  'attendees',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'attendees_pk', columns: [t.meetingId, t.userId] }),
    index('attendees_user_idx').on(t.userId),
  ],
);

/**
 * Action items. A `meeting` item is tracked here (My work, reminders); a `task` item becomes a task of a project
 * (created through the AI tool registry as the person sending the minutes) and then follows that task's events.
 * The project and task are named by id and reference only (never a foreign key into another module).
 */
export const actionItems = meetingsSchema.table(
  'action_items',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: day('due_date'),
    status: varchar('status', { length: 10 }).$type<ItemStatus>().notNull().default('open'),
    destination: varchar('destination', { length: 10 }).$type<Destination>().notNull().default('meeting'),
    projectId: uuid('project_id'),
    /** The record the item became (`projects.task`) and its reference (`NET-42`). */
    targetType: varchar('target_type', { length: 40 }),
    targetId: uuid('target_id'),
    targetReference: varchar('target_reference', { length: 40 }),
    /** `creating` while its task is being created (claimed, so a retried publish creates nothing twice). */
    targetState: varchar('target_state', { length: 10 }).$type<'creating' | 'created'>(),
    routeError: varchar('route_error', { length: 20 }).$type<RouteError>(),
    note: text('note'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    /** The due date the "due tomorrow" reminder was sent for; when the last overdue notice went out. */
    remindedDueDate: day('reminded_due_date'),
    overdueRemindedAt: timestamp('overdue_reminded_at', { withTimezone: true }),
    sort: integer('sort').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('action_items_meeting_idx').on(t.meetingId, t.sort),
    // My work and reminders: a person's open items by due date.
    index('action_items_owner_idx').on(t.ownerId, t.status, t.dueDate),
    index('action_items_target_idx').on(t.targetType, t.targetId),
  ],
);

export type MeetingRow = typeof meetings.$inferSelect;
export type ActionItemRow = typeof actionItems.$inferSelect;
