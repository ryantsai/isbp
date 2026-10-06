import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { core, createdAt, id, scopeType, updatedAt } from './core';
import { departments, groups, users } from './identity';
import { workflowDefinitions } from './workflow';

export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Applications own roles and permissions. `isbp` is this platform; external apps registered here are
 * answered by the Role Query API (Phase 1).
 */
export const applications = core.table(
  'applications',
  {
    id: id(),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    homepageUrl: varchar('homepage_url', { length: 500 }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('applications_key_uq').on(t.key)],
);

/** Permission catalog. For the platform app it is synced from module manifests at boot. */
export const permissions = core.table(
  'permissions',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 200 }).notNull(),
    moduleId: varchar('module_id', { length: 64 }),
    description: text('description').notNull().default(''),
    scopes: jsonb('scopes').$type<string[]>().notNull().default(['global']),
    deprecated: boolean('deprecated').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('permissions_app_key_uq').on(t.applicationId, t.key)],
);

export const roles = core.table(
  'roles',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    /** System roles are managed by the platform/module manifests and cannot be deleted. */
    isSystem: boolean('is_system').notNull().default(false),
    moduleId: varchar('module_id', { length: 64 }),
    /** Listed in the self-service portal; granted through the access-request workflow. */
    requestable: boolean('requestable').notNull().default(false),
    /** Available to workflow conditions (`role.riskLevel`), e.g. high-risk roles need a security review. */
    riskLevel: varchar('risk_level', { length: 10 }).$type<RiskLevel>().notNull().default('low'),
    /** Business owner — the default access-request workflow asks them to approve. */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** Longest grant a request may ask for (null = permanent allowed). */
    maxDurationDays: integer('max_duration_days'),
    /** Workflow for requests of this role instead of the trigger default. */
    requestWorkflowId: uuid('request_workflow_id').references(() => workflowDefinitions.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('roles_app_key_uq').on(t.applicationId, t.key),
    index('roles_requestable_idx')
      .on(t.applicationId)
      .where(sql`${t.requestable}`),
  ],
);

/** Permission patterns per role (wildcards allowed: `core.users.*`, `*.*.read`, `*`). */
export const rolePermissions = core.table(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: varchar('permission', { length: 200 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const roleAssignments = core.table(
  'role_assignments',
  {
    id: id(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    scopeType: scopeType('scope_type').notNull().default('global'),
    scopeDepartmentId: uuid('scope_department_id').references(() => departments.id, { onDelete: 'cascade' }),
    scopeRecordType: varchar('scope_record_type', { length: 100 }),
    scopeRecordId: varchar('scope_record_id', { length: 200 }),
    /** Time-bound access: ignored after expiry and removed by the expiry job. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    source: varchar('source', { length: 20 }).notNull().default('manual'),
    reason: text('reason'),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the holder was told the access is about to expire (sent once). */
    expiryNotifiedAt: timestamp('expiry_notified_at', { withTimezone: true }),
  },
  (t) => [
    check('role_assignments_one_principal', sql`(${t.userId} is null) <> (${t.groupId} is null)`),
    check(
      'role_assignments_scope_shape',
      sql`(${t.scopeType} = 'global' and ${t.scopeDepartmentId} is null and ${t.scopeRecordId} is null)
       or (${t.scopeType} = 'department' and ${t.scopeDepartmentId} is not null)
       or (${t.scopeType} = 'record' and ${t.scopeRecordType} is not null and ${t.scopeRecordId} is not null)`,
    ),
    unique('role_assignments_uq')
      .on(t.roleId, t.userId, t.groupId, t.scopeType, t.scopeDepartmentId, t.scopeRecordType, t.scopeRecordId)
      .nullsNotDistinct(),
    index('role_assignments_user_idx').on(t.userId),
    index('role_assignments_group_idx').on(t.groupId),
    index('role_assignments_role_idx').on(t.roleId),
    index('role_assignments_expires_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} is not null`),
  ],
);
