import { v7 as uuidv7 } from 'uuid';
import { pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

/** All kernel/core tables live in the `core` Postgres schema; modules get their own schema. */
export const core = pgSchema('core');

export const userStatus = core.enum('user_status', ['pending', 'active', 'suspended', 'offboarded']);
export const authSource = core.enum('auth_source', ['local', 'oidc', 'saml', 'ldap']);
export const groupSource = core.enum('group_source', ['local', 'oidc', 'saml', 'ldap', 'system']);
export const idpType = core.enum('idp_type', ['oidc', 'saml', 'ldap']);
export const scopeType = core.enum('scope_type', ['global', 'department', 'record']);

/** UUIDv7 primary key generated app-side (time ordered → B-tree friendly). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export { uuidv7 };
