import { createdAt, departments, groups, id, updatedAt, users } from '@isbp/db/schema';
import type { LocalizedText } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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
import type { Guidance, ItemSnapshot, OptionalLocalized, StocktakeScope } from '../contracts';
import type {
  AccountState,
  AssetStatus,
  PasswordReason,
  Privilege,
  Recurrence,
  ReviewDecision,
  ReviewSource,
  ReviewStatus,
  SharedAccountStatus,
  StocktakeResult,
  StocktakeStatus,
} from '../model';

/** All tables of Information security live in the `isms` Postgres schema. */
export const ismsSchema = pgSchema('isms');

/** Human references: `STK-00001` (stocktakes), `SHA-00001` (shared accounts), `ACR-00001` (account reviews). */
export const stocktakeNumberSeq = ismsSchema.sequence('stocktake_number_seq');
export const accountNumberSeq = ismsSchema.sequence('account_number_seq');
export const reviewNumberSeq = ismsSchema.sequence('review_number_seq');

const day = (name: string) => date(name, { mode: 'string' });
type Changes = Record<string, [unknown, unknown]>;

/* ───────────────────────────── taxonomy ───────────────────────────── */

/** Asset classes (`PE`, `HW`, `SW`, `DA`, `SV` by default) with their C/I/A scoring guidance. */
export const classes = ismsSchema.table(
  'classes',
  {
    id: id(),
    code: varchar('code', { length: 4 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<OptionalLocalized>(),
    guidance: jsonb('guidance').$type<Guidance>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('classes_code_uq').on(t.code)],
);

export const subclasses = ismsSchema.table(
  'subclasses',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 40 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<OptionalLocalized>(),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('subclasses_key_uq').on(t.classId, t.key)],
);

/** Sites (offices, data centres) whose code starts every asset number. */
export const sites = ismsSchema.table(
  'sites',
  {
    id: id(),
    code: varchar('code', { length: 8 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sites_code_uq').on(t.code)],
);

/** Classification labels (Strictly Confidential … Internal Use Only by default). */
export const labels = ismsSchema.table(
  'labels',
  {
    id: id(),
    key: varchar('key', { length: 40 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<OptionalLocalized>(),
    rank: integer('rank').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('labels_key_uq').on(t.key)],
);

/** The last sequence used per `<site><class>` prefix (incremented atomically with an upsert). */
export const numberCounters = ismsSchema.table('number_counters', {
  prefix: varchar('prefix', { length: 12 }).primaryKey(),
  last: integer('last').notNull(),
});

/* ───────────────────────────── assets ───────────────────────────── */

export const assets = ismsSchema.table(
  'assets',
  {
    id: id(),
    number: varchar('number', { length: 20 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    subclassId: uuid('subclass_id').references(() => subclasses.id, { onDelete: 'set null' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'restrict' }),
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
    managerGroupId: uuid('manager_group_id').references(() => groups.id, { onDelete: 'set null' }),
    userIds: jsonb('user_ids').$type<string[]>().notNull().default([]),
    usersText: varchar('users_text', { length: 500 }),
    location: varchar('location', { length: 200 }),
    brand: varchar('brand', { length: 100 }),
    model: varchar('model', { length: 100 }),
    version: varchar('version', { length: 100 }),
    quantity: integer('quantity').notNull().default(1),
    confidentiality: smallint('confidentiality').notNull(),
    integrity: smallint('integrity').notNull(),
    availability: smallint('availability').notNull(),
    /** max(C, I, A), stored so lists filter and sort on it. */
    value: smallint('value').notNull(),
    labelId: uuid('label_id').references(() => labels.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 12 }).$type<AssetStatus>().notNull().default('active'),
    notes: text('notes'),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    /** The record it was registered from (`cmdb.ci:<id>`), once per record. */
    sourceRef: varchar('source_ref', { length: 200 }),
    lastVerifiedOn: day('last_verified_on'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assets_number_uq').on(t.number),
    uniqueIndex('assets_source_uq')
      .on(t.sourceRef)
      .where(sql`${t.sourceRef} is not null`),
    index('assets_class_idx').on(t.classId),
    index('assets_subclass_idx').on(t.subclassId),
    index('assets_site_idx').on(t.siteId),
    index('assets_manager_idx').on(t.managerId),
    index('assets_manager_group_idx').on(t.managerGroupId),
    index('assets_label_idx').on(t.labelId),
    index('assets_status_value_idx').on(t.status, t.value),
    index('assets_name_idx').on(t.name),
    index('assets_updated_idx').on(t.updatedAt),
    index('assets_attributes_gin').using('gin', t.attributes.op('jsonb_path_ops')),
    check(
      'assets_cia',
      sql`${t.confidentiality} between 1 and 4 and ${t.integrity} between 1 and 4
      and ${t.availability} between 1 and 4 and ${t.value} = greatest(${t.confidentiality}, ${t.integrity}, ${t.availability})`,
    ),
  ],
);
export type AssetRow = typeof assets.$inferSelect;

export const ASSET_EVENT_KINDS = ['created', 'updated', 'imported', 'stocktake', 'status_changed'] as const;
export type AssetEventKind = (typeof ASSET_EVENT_KINDS)[number];

/** The asset's history (its page's History tab). */
export const assetEvents = ismsSchema.table(
  'asset_events',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).$type<AssetEventKind>().notNull(),
    changes: jsonb('changes').$type<Changes>(),
    note: text('note'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: varchar('actor_name', { length: 200 }),
    createdAt: createdAt(),
  },
  (t) => [index('asset_events_asset_idx').on(t.assetId, t.createdAt)],
);

/* ───────────────────────────── stocktakes ───────────────────────────── */

export const stocktakes = ismsSchema.table(
  'stocktakes',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('isms.stocktake_number_seq')`),
    name: varchar('name', { length: 200 }).notNull(),
    status: varchar('status', { length: 12 }).$type<StocktakeStatus>().notNull(),
    scope: jsonb('scope').$type<StocktakeScope>().notNull(),
    startOn: day('start_on').notNull(),
    dueOn: day('due_on').notNull(),
    recurrence: varchar('recurrence', { length: 10 }).$type<Recurrence>().notNull().default('none'),
    previousId: uuid('previous_id'),
    /** Reminders already sent (once each). */
    remindedOn: day('reminded_on'),
    overdueNotifiedOn: day('overdue_notified_on'),
    readyNotifiedAt: timestamp('ready_notified_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    signedOffBy: uuid('signed_off_by').references(() => users.id, { onDelete: 'set null' }),
    signedOffAt: timestamp('signed_off_at', { withTimezone: true }),
    signOffNote: text('sign_off_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('stocktakes_number_uq').on(t.number),
    uniqueIndex('stocktakes_previous_uq')
      .on(t.previousId)
      .where(sql`${t.previousId} is not null`),
    index('stocktakes_status_idx').on(t.status, t.dueOn),
  ],
);
export type StocktakeRow = typeof stocktakes.$inferSelect;

export const stocktakeItems = ismsSchema.table(
  'stocktake_items',
  {
    id: id(),
    stocktakeId: uuid('stocktake_id')
      .notNull()
      .references(() => stocktakes.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    snapshot: jsonb('snapshot').$type<ItemSnapshot>().notNull(),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeGroupId: uuid('assignee_group_id').references(() => groups.id, { onDelete: 'set null' }),
    result: varchar('result', { length: 12 }).$type<StocktakeResult>(),
    changes: jsonb('changes').$type<Changes>(),
    note: text('note'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('stocktake_items_asset_uq').on(t.stocktakeId, t.assetId),
    index('stocktake_items_stocktake_idx').on(t.stocktakeId, t.result),
    index('stocktake_items_assignee_idx').on(t.assigneeId),
    index('stocktake_items_group_idx').on(t.assigneeGroupId),
  ],
);
export type StocktakeItemRow = typeof stocktakeItems.$inferSelect;

/* ───────────────────────────── shared accounts ───────────────────────────── */

export const sharedAccounts = ismsSchema.table(
  'shared_accounts',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('isms.account_number_seq')`),
    accountName: varchar('account_name', { length: 200 }).notNull(),
    targetSystem: varchar('target_system', { length: 200 }),
    /** The application or CI the account lives on (`alm.application:<id>`). */
    targetRef: varchar('target_ref', { length: 200 }),
    custodianId: uuid('custodian_id').references(() => users.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    purpose: text('purpose'),
    project: varchar('project', { length: 200 }),
    requestReference: varchar('request_reference', { length: 64 }),
    lastPasswordChangeOn: day('last_password_change_on'),
    passwordDueSince: timestamp('password_due_since', { withTimezone: true }),
    passwordDueReason: varchar('password_due_reason', { length: 20 }).$type<PasswordReason>(),
    passwordDueUserId: uuid('password_due_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 10 }).$type<SharedAccountStatus>().notNull().default('active'),
    nextReviewOn: day('next_review_on'),
    reviewNotifiedOn: day('review_notified_on'),
    lastReviewedOn: day('last_reviewed_on'),
    lastReviewedBy: uuid('last_reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shared_accounts_number_uq').on(t.number),
    index('shared_accounts_custodian_idx').on(t.custodianId),
    index('shared_accounts_status_idx').on(t.status, t.accountName),
    index('shared_accounts_due_idx')
      .on(t.passwordDueSince)
      .where(sql`${t.passwordDueSince} is not null`),
    index('shared_accounts_review_idx').on(t.nextReviewOn),
  ],
);
export type SharedAccountRow = typeof sharedAccounts.$inferSelect;

export const accountMembers = ismsSchema.table(
  'account_members',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => sharedAccounts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.userId] }), index('account_members_user_idx').on(t.userId)],
);

export const ACCOUNT_EVENT_KINDS = [
  'created',
  'updated',
  'member_added',
  'member_removed',
  'password_change_due',
  'password_changed',
  'reviewed',
  'retired',
  'restored',
  'registered',
] as const;
export type AccountEventKind = (typeof ACCOUNT_EVENT_KINDS)[number];

export const accountEvents = ismsSchema.table(
  'account_events',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => sharedAccounts.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 24 }).$type<AccountEventKind>().notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    /** Makes event handlers and process actions idempotent (`offboarded:<event id>`, `run:<run id>`). */
    dedupeKey: varchar('dedupe_key', { length: 100 }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: varchar('actor_name', { length: 200 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('account_events_account_idx').on(t.accountId, t.createdAt),
    uniqueIndex('account_events_dedupe_uq')
      .on(t.accountId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

/* ───────────────────────────── account reviews ───────────────────────────── */

export const reviews = ismsSchema.table(
  'reviews',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('isms.review_number_seq')`),
    target: varchar('target', { length: 200 }).notNull(),
    targetRef: varchar('target_ref', { length: 200 }),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    startOn: day('start_on').notNull(),
    dueOn: day('due_on').notNull(),
    status: varchar('status', { length: 12 }).$type<ReviewStatus>().notNull().default('open'),
    source: varchar('source', { length: 12 }).$type<ReviewSource>().notNull().default('manual'),
    /** Core application whose role holders filled the items. */
    applicationId: uuid('application_id'),
    recurrence: varchar('recurrence', { length: 10 }).$type<Recurrence>().notNull().default('none'),
    /** The review this one follows (recurring reviews). */
    previousId: uuid('previous_id'),
    remindedOn: day('reminded_on'),
    overdueNotifiedOn: day('overdue_notified_on'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    signedOffBy: uuid('signed_off_by').references(() => users.id, { onDelete: 'set null' }),
    signedOffAt: timestamp('signed_off_at', { withTimezone: true }),
    signOffNote: text('sign_off_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('reviews_number_uq').on(t.number),
    uniqueIndex('reviews_previous_uq')
      .on(t.previousId)
      .where(sql`${t.previousId} is not null`),
    index('reviews_status_idx').on(t.status, t.dueOn),
    index('reviews_reviewer_idx').on(t.reviewerId),
  ],
);
export type ReviewRow = typeof reviews.$inferSelect;

export const reviewItems = ismsSchema.table(
  'review_items',
  {
    id: id(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    accountName: varchar('account_name', { length: 200 }).notNull(),
    userName: varchar('user_name', { length: 200 }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    privilege: varchar('privilege', { length: 10 }).$type<Privilege>().notNull().default('user'),
    accountStatus: varchar('account_status', { length: 10 })
      .$type<AccountState>()
      .notNull()
      .default('enabled'),
    /** Read-only context from the source (the application roles held). */
    detail: varchar('detail', { length: 500 }),
    decision: varchar('decision', { length: 10 }).$type<ReviewDecision>(),
    doneOn: day('done_on'),
    note: text('note'),
    ticketId: varchar('ticket_id', { length: 64 }),
    ticketRef: varchar('ticket_ref', { length: 64 }),
    ticketHref: varchar('ticket_href', { length: 300 }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_items_account_uq').on(t.reviewId, sql`lower(${t.accountName})`),
    index('review_items_review_idx').on(t.reviewId, t.sortOrder),
  ],
);
export type ReviewItemRow = typeof reviewItems.$inferSelect;
