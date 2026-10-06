import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { authSource, core, createdAt, groupSource, id, idpType, updatedAt, userStatus } from './core';

export const departments = core.table(
  'departments',
  {
    id: id(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    parentId: uuid('parent_id').references((): AnyPgColumn => departments.id, { onDelete: 'restrict' }),
    /** Materialized path `/rootId/…/id/` — subtree queries use `path LIKE '/…/%'`. */
    path: text('path').notNull(),
    managerId: uuid('manager_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('departments_code_uq').on(t.code),
    index('departments_parent_idx').on(t.parentId),
    index('departments_path_idx').on(t.path.op('text_pattern_ops')),
  ],
);

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'system';
  sidebarCollapsed?: boolean;
}

export const users = core.table(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 320 }).notNull(),
    username: varchar('username', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    givenName: varchar('given_name', { length: 100 }),
    familyName: varchar('family_name', { length: 100 }),
    jobTitle: varchar('job_title', { length: 200 }),
    phone: varchar('phone', { length: 50 }),
    employeeId: varchar('employee_id', { length: 64 }),
    avatarUrl: text('avatar_url'),
    locale: varchar('locale', { length: 10 }).notNull().default('en'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    status: userStatus('status').notNull().default('active'),
    authSource: authSource('auth_source').notNull().default('local'),
    passwordHash: text('password_hash'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    departmentId: uuid('department_id').references((): AnyPgColumn => departments.id, {
      onDelete: 'set null',
    }),
    managerId: uuid('manager_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    /** Custom field values (schema registry arrives in Phase 1). */
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    preferences: jsonb('preferences').$type<UserPreferences>().notNull().default({}),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    offboardedAt: timestamp('offboarded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    uniqueIndex('users_username_uq').on(sql`lower(${t.username})`),
    index('users_status_idx').on(t.status),
    index('users_department_idx').on(t.departmentId),
    index('users_manager_idx').on(t.managerId),
    index('users_created_idx').on(t.createdAt),
    index('users_display_name_trgm').using('gin', t.displayName.op('gin_trgm_ops')),
    index('users_email_trgm').using('gin', t.email.op('gin_trgm_ops')),
  ],
);

export interface OidcConfig {
  issuer: string;
  clientId: string;
  scopes?: string;
  /** Claim names (defaults: email, name, preferred_username, groups). */
  claims?: { email?: string; name?: string; username?: string; groups?: string };
  allowedDomains?: string[];
  preset?: 'entra' | 'generic';
}

export interface SamlConfig {
  entryPoint: string;
  issuer: string;
  idpCertificate: string;
  attributes?: { email?: string; name?: string; username?: string; groups?: string };
  wantAssertionsSigned?: boolean;
}

export interface LdapConfig {
  url: string;
  bindDn: string;
  baseDn: string;
  userFilter: string;
  groupBaseDn?: string;
  groupFilter?: string;
  attributes?: { username?: string; email?: string; name?: string; memberOf?: string };
  tls?: { rejectUnauthorized?: boolean };
}

export type IdpConfig = OidcConfig | SamlConfig | LdapConfig;

export interface GroupMapping {
  /** Value from the IdP (group object id, DN or name). */
  external: string;
  groupId: string;
}

export const identityProviders = core.table(
  'identity_providers',
  {
    id: id(),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    type: idpType('type').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<IdpConfig>().notNull(),
    /** AES-256-GCM envelope of `{ clientSecret | bindPassword … }` — never returned by the API. */
    secrets: text('secrets'),
    jitProvisioning: boolean('jit_provisioning').notNull().default(true),
    defaultDepartmentId: uuid('default_department_id').references(() => departments.id, {
      onDelete: 'set null',
    }),
    groupMappings: jsonb('group_mappings').$type<GroupMapping[]>().notNull().default([]),
    syncEnabled: boolean('sync_enabled').notNull().default(false),
    syncCron: varchar('sync_cron', { length: 100 }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncStatus: varchar('last_sync_status', { length: 20 }),
    lastSyncMessage: text('last_sync_message'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('identity_providers_key_uq').on(t.key)],
);

export const userIdentities = core.table(
  'user_identities',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    idpId: uuid('idp_id')
      .notNull()
      .references(() => identityProviders.id, { onDelete: 'cascade' }),
    subject: varchar('subject', { length: 512 }).notNull(),
    email: varchar('email', { length: 320 }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_identities_subject_uq').on(t.idpId, t.subject),
    index('user_identities_user_idx').on(t.userId),
  ],
);

export const groups = core.table(
  'groups',
  {
    id: id(),
    key: varchar('key', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    source: groupSource('source').notNull().default('local'),
    externalId: varchar('external_id', { length: 512 }),
    idpId: uuid('idp_id').references(() => identityProviders.id, { onDelete: 'set null' }),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('groups_key_uq').on(t.key),
    uniqueIndex('groups_external_uq')
      .on(t.idpId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('groups_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

export const groupMembers = core.table(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 20 }).notNull().default('manual'),
    addedBy: uuid('added_by'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index('group_members_user_idx').on(t.userId)],
);

export const sessions = core.table(
  'sessions',
  {
    id: id(),
    /** SHA-256 (hex) of the opaque cookie token; the token itself is never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: varchar('csrf_token', { length: 64 }).notNull(),
    idpId: uuid('idp_id').references(() => identityProviders.id, { onDelete: 'set null' }),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 64 }),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);
