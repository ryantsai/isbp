import { sql } from 'drizzle-orm';
import { boolean, index, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { core, createdAt, id, updatedAt } from './core';
import { users } from './identity';

/**
 * API clients are service principals: external applications calling the Role Query API (or, with
 * explicit permissions, the platform API) with an API key or OAuth 2.0 client credentials.
 */
export const apiClients = core.table(
  'api_clients',
  {
    id: id(),
    /** Public identifier, also the OAuth `client_id`. */
    clientId: varchar('client_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    /** Applications this client may query with the Role Query API. */
    applicationIds: uuid('application_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    allApplications: boolean('all_applications').notNull().default(false),
    /** Platform API permission patterns (global), e.g. `core.users.read`. */
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Optional source-IP allow-list (CIDRs); empty = any. */
    allowedCidrs: text('allowed_cidrs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: varchar('last_used_ip', { length: 64 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('api_clients_client_id_uq').on(t.clientId)],
);

/** Client secrets / API keys. Several may be active at once for zero-downtime rotation. */
export const apiClientSecrets = core.table(
  'api_client_secrets',
  {
    id: id(),
    apiClientId: uuid('api_client_id')
      .notNull()
      .references(() => apiClients.id, { onDelete: 'cascade' }),
    /** First characters of the key, shown in the UI to tell keys apart (`isbp_sk_ab12cd…`). */
    prefix: varchar('prefix', { length: 24 }).notNull(),
    /** SHA-256 (hex) of the full key; the key itself is shown once and never stored. */
    secretHash: varchar('secret_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('api_client_secrets_hash_uq').on(t.secretHash),
    index('api_client_secrets_client_idx').on(t.apiClientId),
  ],
);
