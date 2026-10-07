import { createdAt, groups, id, updatedAt, users } from '@isbp/db/schema';
import type { LocalizedText } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AuthMode,
  EndReason,
  Environment,
  GrantOperation,
  GrantSource,
  GrantStatus,
  Recurrence,
  RequestStatus,
  ReviewDecision,
  ReviewerRule,
  ReviewPolicy,
  ReviewStatus,
  Risk,
} from '../model';

/**
 * Tables of the `dbaccess` schema. Database names are stored as `''` for server-level roles so that keys
 * and joins stay simple; the API turns them into `null`. Connections live in the kernel
 * (`core.db_connections`) and are only referenced by id: the module reaches them through `ctx.databases`.
 */
export const dbaccessSchema = pgSchema('dbaccess');

export const requestNumberSeq = dbaccessSchema.sequence('request_number_seq');
export const reviewNumberSeq = dbaccessSchema.sequence('review_number_seq');

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** An `admin`-purpose connection the module manages accounts on, with the module's own settings. */
export const servers = dbaccessSchema.table(
  'servers',
  {
    id: id(),
    connectionId: uuid('connection_id').notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    /** The connection's engine when last seen (kept for filters and history). */
    engine: varchar('engine', { length: 16 }).notNull(),
    environment: varchar('environment', { length: 16 }).$type<Environment>().notNull().default('production'),
    accountPattern: varchar('account_pattern', { length: 60 }).notNull().default('{username}'),
    authMode: varchar('auth_mode', { length: 16 }).$type<AuthMode>().notNull().default('password'),
    windowsDomain: varchar('windows_domain', { length: 15 }),
    passwordLength: integer('password_length').notNull().default(24),
    autoSync: boolean('auto_sync').notNull().default(true),
    /** DBAs alerted when provisioning fails. */
    ownerGroupId: uuid('owner_group_id').references(() => groups.id, { onDelete: 'set null' }),
    lastSyncAt: ts('last_sync_at'),
    lastSyncStatus: varchar('last_sync_status', { length: 8 }).$type<'ok' | 'error'>(),
    lastSyncError: text('last_sync_error'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('servers_connection_uq').on(t.connectionId)],
);

/** A role people may request on a server (picked from the synced inventory by a DBA). */
export const requestableRoles = dbaccessSchema.table(
  'roles',
  {
    id: id(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    database: varchar('database', { length: 128 }).notNull().default(''),
    roleName: varchar('role_name', { length: 128 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<LocalizedText>(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    ownerGroupId: uuid('owner_group_id').references(() => groups.id, { onDelete: 'set null' }),
    risk: varchar('risk', { length: 8 }).$type<Risk>().notNull().default('medium'),
    defaultDays: integer('default_days'),
    maxDays: integer('max_days'),
    allowPermanent: boolean('allow_permanent').notNull().default(false),
    justificationRequired: boolean('justification_required').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('roles_server_role_uq').on(t.serverId, t.database, t.roleName),
    index('roles_owner_user_idx').on(t.ownerUserId),
    index('roles_owner_group_idx').on(t.ownerGroupId),
  ],
);

/** A person's request for one role (one workflow instance each). */
export const requests = dbaccessSchema.table(
  'requests',
  {
    id: id(),
    number: integer('number')
      .notNull()
      .default(sql`nextval('dbaccess.request_number_seq')`),
    requesterId: uuid('requester_id').references(() => users.id, { onDelete: 'set null' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => requestableRoles.id, { onDelete: 'cascade' }),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    /** Last day of access (`null`: permanent). */
    expiresOn: date('expires_on', { mode: 'string' }),
    /** The requester's time zone when asking: the end date ends at midnight there. */
    timeZone: varchar('time_zone', { length: 64 }).notNull().default('UTC'),
    justification: text('justification').notNull().default(''),
    status: varchar('status', { length: 12 }).$type<RequestStatus>().notNull().default('pending'),
    /** Extends this grant instead of creating one. */
    extensionOf: uuid('extension_of'),
    instanceId: uuid('instance_id'),
    decidedAt: ts('decided_at'),
    decisionComment: text('decision_comment'),
    grantId: uuid('grant_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('requests_number_uq').on(t.number),
    index('requests_requester_idx').on(t.requesterId, t.status),
    index('requests_role_idx').on(t.roleId, t.status),
    uniqueIndex('requests_pending_uq')
      .on(t.requesterId, t.roleId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** A database account the platform created or adopted for a person on a server. */
export const accounts = dbaccessSchema.table(
  'accounts',
  {
    id: id(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The login (`CONTOSO\jdoe` for Windows logins). */
    name: varchar('name', { length: 160 }).notNull(),
    authMode: varchar('auth_mode', { length: 16 }).$type<AuthMode>().notNull(),
    /** Created by the platform (else it existed and was adopted). */
    createdByPlatform: boolean('created_by_platform').notNull().default(false),
    status: varchar('status', { length: 12 }).$type<'active' | 'disabled'>().notNull().default('active'),
    disabledAt: ts('disabled_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('accounts_server_name_uq').on(t.serverId, t.name),
    index('accounts_user_idx').on(t.userId),
  ],
);

/** A role held (or being given, or taken away) on a server. */
export const grants = dbaccessSchema.table(
  'grants',
  {
    id: id(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => requestableRoles.id, { onDelete: 'cascade' }),
    /** The grantee (`null` for unmanaged memberships revoked without a known person). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    requestId: uuid('request_id'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    accountName: varchar('account_name', { length: 160 }),
    source: varchar('source', { length: 12 }).$type<GrantSource>().notNull().default('request'),
    status: varchar('status', { length: 16 }).$type<GrantStatus>().notNull().default('provisioning'),
    operation: varchar('operation', { length: 8 }).$type<GrantOperation>().notNull().default('grant'),
    expiresAt: ts('expires_at'),
    grantedAt: ts('granted_at'),
    endedAt: ts('ended_at'),
    endReason: varchar('end_reason', { length: 16 }).$type<EndReason>(),
    endNote: text('end_note'),
    endedBy: uuid('ended_by').references(() => users.id, { onDelete: 'set null' }),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: ts('last_attempt_at'),
    lastError: text('last_error'),
    expiryRemindedAt: ts('expiry_reminded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('grants_user_idx').on(t.userId, t.status),
    index('grants_server_idx').on(t.serverId, t.status),
    index('grants_role_idx').on(t.roleId, t.status),
    index('grants_expires_idx').on(t.expiresAt),
  ],
);

/** A generated password, readable once by the grantee within a week (sealed with `ctx.secrets`). */
export const reveals = dbaccessSchema.table(
  'reveals',
  {
    id: id(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Cleared once viewed or expired. */
    secretSealed: text('secret_sealed'),
    expiresAt: ts('expires_at').notNull(),
    viewedAt: ts('viewed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('reveals_grant_idx').on(t.grantId), index('reveals_user_idx').on(t.userId)],
);

/* ───────────────────────────── inventory snapshots ───────────────────────────── */

/** Logins/users on a server as of the last sync. */
export const inventoryAccounts = dbaccessSchema.table(
  'inventory_accounts',
  {
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    kind: varchar('kind', { length: 60 }),
    enabled: boolean('enabled').notNull().default(true),
    createdOn: ts('created_on'),
    lastLoginAt: ts('last_login_at'),
    validUntil: ts('valid_until'),
    syncedAt: ts('synced_at').notNull(),
  },
  (t) => [uniqueIndex('inventory_accounts_uq').on(t.serverId, t.name)],
);

/** Roles on a server (per database on SQL Server). */
export const inventoryRoles = dbaccessSchema.table(
  'inventory_roles',
  {
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    database: varchar('database', { length: 128 }).notNull().default(''),
    name: varchar('name', { length: 128 }).notNull(),
    syncedAt: ts('synced_at').notNull(),
  },
  (t) => [uniqueIndex('inventory_roles_uq').on(t.serverId, t.database, t.name)],
);

/** Role memberships as of the last sync (kept current by provisioning and revocation). */
export const inventoryMemberships = dbaccessSchema.table(
  'inventory_memberships',
  {
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    database: varchar('database', { length: 128 }).notNull().default(''),
    roleName: varchar('role_name', { length: 128 }).notNull(),
    memberName: varchar('member_name', { length: 160 }).notNull(),
    syncedAt: ts('synced_at').notNull(),
  },
  (t) => [
    uniqueIndex('inventory_memberships_uq').on(t.serverId, t.database, t.roleName, t.memberName),
    index('inventory_memberships_member_idx').on(t.serverId, t.memberName),
  ],
);

/* ───────────────────────────── access reviews ───────────────────────────── */

export const reviews = dbaccessSchema.table(
  'reviews',
  {
    id: id(),
    number: integer('number')
      .notNull()
      .default(sql`nextval('dbaccess.review_number_seq')`),
    name: varchar('name', { length: 200 }).notNull(),
    /** Empty: every server. */
    serverIds: uuid('server_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    minRisk: varchar('min_risk', { length: 8 }).$type<Risk>().notNull().default('low'),
    reviewerRule: varchar('reviewer_rule', { length: 8 }).$type<ReviewerRule>().notNull().default('owner'),
    startOn: date('start_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    policy: varchar('policy', { length: 8 }).$type<ReviewPolicy>().notNull().default('revoke'),
    recurrence: varchar('recurrence', { length: 12 }).$type<Recurrence>().notNull().default('none'),
    status: varchar('status', { length: 12 }).$type<ReviewStatus>().notNull().default('scheduled'),
    startedAt: ts('started_at'),
    closedAt: ts('closed_at'),
    remindedAt: ts('reminded_at'),
    /** The campaign this one recurs from. */
    previousId: uuid('previous_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('reviews_number_uq').on(t.number), index('reviews_status_idx').on(t.status, t.dueOn)],
);

/** One grant to keep or revoke in a campaign (a snapshot taken when it started). */
export const reviewItems = dbaccessSchema.table(
  'review_items',
  {
    id: id(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerGroupId: uuid('reviewer_group_id').references(() => groups.id, { onDelete: 'set null' }),
    decision: varchar('decision', { length: 8 }).$type<ReviewDecision>(),
    comment: text('comment'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts('decided_at'),
    outcome: varchar('outcome', { length: 8 }).$type<'kept' | 'revoked'>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_items_uq').on(t.reviewId, t.grantId),
    index('review_items_user_idx').on(t.reviewerUserId),
    index('review_items_group_idx').on(t.reviewerGroupId),
  ],
);
