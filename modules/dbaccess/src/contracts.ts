/**
 * Database access API contract (mounted at /api/v1/dbaccess). Zod schemas shared by routes, pages, AI tools
 * and tests.
 *
 *   Self service (dbaccess.self.request)
 *     GET    /me/access                      → myAccessSchema (grants, requests, roles I own)
 *     GET    /me/summary                     → mySummarySchema (dashboard card)
 *     GET    /catalog                        catalogQuerySchema → { items: catalogItemSchema[] }
 *     POST   /requests                       createRequestSchema → { items: requestSchema[] } (201)
 *     GET    /requests/:ref                  → requestSchema (DBR-00042 or id; requester, approvers, readers)
 *     POST   /requests/:ref/cancel           → requestSchema
 *     POST   /grants/:id/relinquish          reasonSchema → grantSchema
 *     POST   /reveals/:id                    → revealSchema (once; 410 REVEAL_EXPIRED)
 *
 *   Access (dbaccess.grants.read / .manage, owners)
 *     GET    /grants                         grantQuerySchema → page(grantSchema) (readers; owners: their roles)
 *     GET    /grants/:id                     → grantSchema
 *     POST   /grants/:id/revoke              reasonSchema → grantSchema (DBA, role owner)
 *     POST   /grants/:id/retry               → grantSchema
 *     GET    /accounts                       accountQuerySchema → page(inventoryAccountSchema)
 *     GET    /unmanaged                      unmanagedQuerySchema → { items: unmanagedSchema[] }
 *     POST   /unmanaged/adopt                adoptSchema → grantSchema (201)
 *     POST   /unmanaged/revoke               revokeUnmanagedSchema → grantSchema (202)
 *     GET    /people/:userId/access          → { items: grantSchema[] } (DBAs and the person's manager)
 *
 *   Servers (dbaccess.servers.manage)
 *     GET    /servers                        → serversSchema (configured + unconfigured admin connections)
 *     POST   /servers                        createServerSchema → serverSchema (201)
 *     GET    /servers/:id                    → serverSchema
 *     PATCH  /servers/:id                    updateServerSchema → serverSchema
 *     DELETE /servers/:id                    (IN_USE while grants are live)
 *     POST   /servers/:id/sync               → syncResultSchema
 *     GET    /servers/:id/inventory          → inventorySchema
 *     GET    /servers/:id/roles              → { items: requestableRoleSchema[] }
 *     POST   /servers/:id/roles              createRoleSchema → requestableRoleSchema (201)
 *     PATCH  /roles/:id                      updateRoleSchema → requestableRoleSchema
 *     DELETE /roles/:id                      (IN_USE once granted: deactivate instead)
 *     GET    /lookups/servers                → { items: serverOptionSchema[] }
 *     GET    /lookups/groups                 lookupQuerySchema → { items: groupOptionSchema[] }
 *
 *   Access reviews (dbaccess.reviews.read / .manage, reviewers)
 *     GET    /reviews                        reviewQuerySchema → page(reviewSchema)
 *     POST   /reviews                        createReviewSchema → reviewSchema (201)
 *     GET    /reviews/:id                    → reviewSchema
 *     GET    /reviews/:id/items              reviewItemQuerySchema → page(reviewItemSchema)
 *     POST   /reviews/:id/decisions          decideSchema → { updated }   (409 REVIEW_CLOSED)
 *     POST   /reviews/:id/close              → reviewSchema
 *     GET    /reviews/:id/report.csv         → text/csv
 */
import { dateTime } from '@isbp/contracts';
import { listQuerySchema, type LocalizedText, localizedTextSchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  AUTH_MODES,
  DATABASE_NAME_RE,
  DOMAIN_RE,
  END_REASONS,
  ENVIRONMENTS,
  GRANT_OPERATIONS,
  GRANT_SOURCES,
  GRANT_STATUSES,
  GRANT_VIEW_STATUSES,
  INVENTORY_NAME_RE,
  MANAGED_ENGINES,
  PASSWORD_LENGTH,
  RECURRENCES,
  REQUEST_STATUSES,
  REVIEW_DECISIONS,
  REVIEW_POLICIES,
  REVIEW_STATUSES,
  REVIEWER_RULES,
  RISKS,
  ROLE_NAME_RE,
} from './model';

export * from './model';

const id = z.uuid();
/** A calendar date (`YYYY-MM-DD`). */
export const dateOnly = z.iso.date();

export const engineSchema = z.enum(['mssql', 'postgres', 'mysql', 'oracle']);
export const managedEngineSchema = z.enum(MANAGED_ENGINES);
export const environmentSchema = z.enum(ENVIRONMENTS);
export const authModeSchema = z.enum(AUTH_MODES);
export const riskSchema = z.enum(RISKS);
export const grantStatusSchema = z.enum(GRANT_STATUSES);
export const grantViewStatusSchema = z.enum(GRANT_VIEW_STATUSES);
export const grantSourceSchema = z.enum(GRANT_SOURCES);
export const grantOperationSchema = z.enum(GRANT_OPERATIONS);
export const endReasonSchema = z.enum(END_REASONS);
export const requestStatusSchema = z.enum(REQUEST_STATUSES);
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export const reviewDecisionSchema = z.enum(REVIEW_DECISIONS);
export const reviewerRuleSchema = z.enum(REVIEWER_RULES);
export const reviewPolicySchema = z.enum(REVIEW_POLICIES);
export const recurrenceSchema = z.enum(RECURRENCES);

/* ───────────────────────────── shared refs ───────────────────────────── */

export const personRefSchema = z.object({
  id,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type PersonRef = z.input<typeof personRefSchema>;

export const serverRefSchema = z.object({
  id,
  displayName: z.string(),
  engine: engineSchema,
  environment: environmentSchema,
});
export type ServerRef = z.input<typeof serverRefSchema>;

const localized = z.custom<LocalizedText>((v) => localizedTextSchema.safeParse(v).success);

export const roleRefSchema = z.object({
  id,
  name: localized,
  roleName: z.string(),
  /** SQL Server database; `null` for server-level roles (PostgreSQL, Oracle, SQL Server server roles). */
  database: z.string().nullable(),
  risk: riskSchema,
});
export type RoleRef = z.input<typeof roleRefSchema>;

export const ownerSchema = z.object({ kind: z.enum(['user', 'group']), id, name: z.string() });
export type Owner = z.input<typeof ownerSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1_000) });
export type ReasonInput = z.input<typeof reasonSchema>;

/* ───────────────────────────── servers ───────────────────────────── */

export const connectionInfoSchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  engine: engineSchema,
  host: z.string(),
  port: z.number().int().nullable(),
  database: z.string().nullable(),
  enabled: z.boolean(),
  status: z.enum(['unknown', 'ok', 'error']),
  serverVersion: z.string().nullable(),
});
export type ConnectionInfo = z.input<typeof connectionInfoSchema>;

export const serverSchema = z.object({
  id,
  connectionId: id,
  connection: connectionInfoSchema.nullable(),
  displayName: z.string(),
  engine: engineSchema,
  environment: environmentSchema,
  accountPattern: z.string(),
  authMode: authModeSchema,
  windowsDomain: z.string().nullable(),
  passwordLength: z.number().int(),
  autoSync: z.boolean(),
  ownerGroup: z.object({ id, name: z.string() }).nullable(),
  lastSyncAt: dateTime.nullable(),
  lastSyncStatus: z.enum(['ok', 'error']).nullable(),
  lastSyncError: z.string().nullable(),
  counts: z.object({
    roles: z.number().int(),
    accounts: z.number().int(),
    liveGrants: z.number().int(),
    unmanaged: z.number().int(),
    orphans: z.number().int(),
    failed: z.number().int(),
  }),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Server = z.input<typeof serverSchema>;

export const serversSchema = z.object({
  items: z.array(serverSchema),
  /** `admin` connections not configured as a server yet. */
  unconfigured: z.array(connectionInfoSchema),
});
export type Servers = z.input<typeof serversSchema>;

const patternSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^(?:[A-Za-z0-9_]|\{(?:username|email_local)\})+$/,
    'Letters, digits, "_" and the tokens {username} or {email_local}',
  )
  .refine((p) => /\{(?:username|email_local)\}/.test(p), 'Include {username} or {email_local}');

/** Server settings without defaults: updates are partial and must never reset what they leave out. */
const serverFields = {
  displayName: z.string().trim().min(1).max(120),
  environment: environmentSchema,
  accountPattern: patternSchema,
  authMode: authModeSchema,
  windowsDomain: z.string().trim().regex(DOMAIN_RE, 'A NetBIOS domain such as CONTOSO').nullable(),
  passwordLength: z.number().int().min(PASSWORD_LENGTH.min).max(PASSWORD_LENGTH.max),
  autoSync: z.boolean(),
  ownerGroupId: id.nullable(),
};

export const createServerSchema = z.object({
  connectionId: id,
  displayName: serverFields.displayName,
  environment: serverFields.environment.default('production'),
  accountPattern: serverFields.accountPattern.default('{username}'),
  authMode: serverFields.authMode.default('password'),
  windowsDomain: serverFields.windowsDomain.default(null),
  passwordLength: serverFields.passwordLength.default(PASSWORD_LENGTH.default),
  autoSync: serverFields.autoSync.default(true),
  ownerGroupId: serverFields.ownerGroupId.default(null),
});
export type CreateServerInput = z.input<typeof createServerSchema>;

export const updateServerSchema = z.object(serverFields).partial();
export type UpdateServerInput = z.input<typeof updateServerSchema>;

export const serverOptionSchema = serverRefSchema.extend({ roles: z.number().int() });
export type ServerOption = z.input<typeof serverOptionSchema>;

export const groupOptionSchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  members: z.number().int(),
});
export type GroupOption = z.input<typeof groupOptionSchema>;

export const lookupQuerySchema = z.object({ q: z.string().trim().max(100).optional() });

export const syncResultSchema = z.object({
  serverId: id,
  syncedAt: dateTime,
  accounts: z.number().int(),
  roles: z.number().int(),
  memberships: z.number().int(),
  unmanaged: z.number().int(),
  orphans: z.number().int(),
});
export type SyncResult = z.input<typeof syncResultSchema>;

export const inventoryRoleSchema = z.object({
  database: z.string().nullable(),
  name: z.string(),
  members: z.number().int(),
  requestableRoleId: id.nullable(),
});
export type InventoryRole = z.input<typeof inventoryRoleSchema>;

export const inventorySchema = z.object({
  syncedAt: dateTime.nullable(),
  databases: z.array(z.string()),
  roles: z.array(inventoryRoleSchema),
});
export type Inventory = z.input<typeof inventorySchema>;

/* ───────────────────────────── requestable roles ───────────────────────────── */

const days = z.number().int().min(1).max(3_650);

export const requestableRoleSchema = z.object({
  id,
  server: serverRefSchema,
  database: z.string().nullable(),
  roleName: z.string(),
  name: localized,
  description: localized.nullable(),
  owner: ownerSchema.nullable(),
  risk: riskSchema,
  defaultDays: z.number().int().nullable(),
  maxDays: z.number().int().nullable(),
  allowPermanent: z.boolean(),
  justificationRequired: z.boolean(),
  active: z.boolean(),
  liveGrants: z.number().int(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type RequestableRole = z.input<typeof requestableRoleSchema>;

/** Role settings without defaults: updates are partial and must never reset what they leave out. */
const roleFields = {
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  ownerUserId: id.nullable(),
  ownerGroupId: id.nullable(),
  risk: riskSchema,
  defaultDays: days.nullable(),
  maxDays: days.nullable(),
  allowPermanent: z.boolean(),
  justificationRequired: z.boolean(),
  active: z.boolean(),
};

export const createRoleSchema = z.object({
  database: z
    .string()
    .trim()
    .regex(DATABASE_NAME_RE, 'A database name from the inventory')
    .nullable()
    .default(null),
  roleName: z.string().trim().min(1).max(128).regex(ROLE_NAME_RE, 'A role name from the inventory'),
  name: roleFields.name,
  description: roleFields.description.default(null),
  ownerUserId: roleFields.ownerUserId.default(null),
  ownerGroupId: roleFields.ownerGroupId.default(null),
  risk: roleFields.risk.default('medium'),
  defaultDays: roleFields.defaultDays.default(30),
  maxDays: roleFields.maxDays.default(90),
  allowPermanent: roleFields.allowPermanent.default(false),
  justificationRequired: roleFields.justificationRequired.default(true),
  active: roleFields.active.default(true),
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z.object(roleFields).partial();
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

/* ───────────────────────────── catalog & requests ───────────────────────────── */

export const catalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  serverId: id.optional(),
  database: z.string().trim().max(128).optional(),
  risk: riskSchema.optional(),
});

export const catalogItemSchema = requestableRoleSchema
  .omit({ liveGrants: true, active: true, createdAt: true, updatedAt: true })
  .extend({
    /** The caller holds it (or it is being provisioned). */
    heldGrantId: id.nullable(),
    heldUntil: dateTime.nullable(),
    pendingRequest: z.object({ id, reference: z.string() }).nullable(),
  });
export type CatalogItem = z.input<typeof catalogItemSchema>;

export const createRequestSchema = z.object({
  items: z
    .array(
      z.object({
        roleId: id,
        /** Last day of access (`null`: permanent, where the role allows it). */
        expiresOn: dateOnly.nullable(),
      }),
    )
    .min(1)
    .max(10)
    .refine((items) => new Set(items.map((i) => i.roleId)).size === items.length, 'Each role once'),
  justification: z.string().trim().max(2_000).default(''),
  /** Extends this grant instead of creating a new one. */
  extensionOf: id.nullable().default(null),
});
export type CreateRequestInput = z.input<typeof createRequestSchema>;

export const requestSchema = z.object({
  id,
  reference: z.string(),
  status: requestStatusSchema,
  role: roleRefSchema,
  server: serverRefSchema,
  requester: personRefSchema.nullable(),
  expiresOn: z.string().nullable(),
  justification: z.string(),
  extensionOf: id.nullable(),
  instanceId: id.nullable(),
  decidedAt: dateTime.nullable(),
  decisionComment: z.string().nullable(),
  grant: z.object({ id, status: grantStatusSchema, viewStatus: grantViewStatusSchema }).nullable(),
  canCancel: z.boolean(),
  createdAt: dateTime,
});
export type AccessRequest = z.input<typeof requestSchema>;

/* ───────────────────────────── grants ───────────────────────────── */

export const grantSchema = z.object({
  id,
  status: grantStatusSchema,
  viewStatus: grantViewStatusSchema,
  source: grantSourceSchema,
  operation: grantOperationSchema,
  grantee: personRefSchema.nullable(),
  role: roleRefSchema,
  server: serverRefSchema,
  accountName: z.string().nullable(),
  expiresAt: dateTime.nullable(),
  grantedAt: dateTime.nullable(),
  endedAt: dateTime.nullable(),
  endReason: endReasonSchema.nullable(),
  endNote: z.string().nullable(),
  attempts: z.number().int(),
  /** The server's last error (DBAs only). */
  lastError: z.string().nullable(),
  request: z.object({ id, reference: z.string() }).nullable(),
  /** A one-time password reveal for the grantee. */
  reveal: z.object({ id, expiresAt: dateTime, available: z.boolean() }).nullable(),
  viewer: z.object({
    canRevoke: z.boolean(),
    canRetry: z.boolean(),
    canRelinquish: z.boolean(),
    canExtend: z.boolean(),
  }),
  createdAt: dateTime,
});
export type Grant = z.input<typeof grantSchema>;

export const grantQuerySchema = listQuerySchema.extend({
  /** A view status, or `live` (provisioning, active, revoking, failed) / `ended`. */
  status: z.union([grantViewStatusSchema, z.enum(['live', 'ended'])]).optional(),
  serverId: id.optional(),
  roleId: id.optional(),
  risk: riskSchema.optional(),
  userId: id.optional(),
  source: grantSourceSchema.optional(),
  /**
   * Only grants of roles the caller owns (as the person or through the owning group). Role owners without
   * `dbaccess.grants.read` always get only those.
   */
  owned: z.stringbool().optional(),
});

export const myAccessSchema = z.object({
  grants: z.array(grantSchema),
  requests: z.array(requestSchema),
  /** How many requestable roles I own (person or group): "Access to roles you own" shows when > 0. */
  ownedRoles: z.number().int(),
});
export type MyAccess = z.input<typeof myAccessSchema>;

export const revealSchema = z.object({
  accountName: z.string(),
  password: z.string(),
  server: serverRefSchema,
  connection: z.object({
    engine: engineSchema,
    host: z.string(),
    port: z.number().int().nullable(),
    database: z.string().nullable(),
  }),
});
export type Reveal = z.input<typeof revealSchema>;

/* ───────────────────────────── inventory & drift ───────────────────────────── */

export const accountQuerySchema = listQuerySchema.extend({
  serverId: id.optional(),
  orphan: z.stringbool().optional(),
  managed: z.stringbool().optional(),
});

export const inventoryAccountSchema = z.object({
  server: serverRefSchema,
  name: z.string(),
  kind: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: dateTime.nullable(),
  lastLoginAt: dateTime.nullable(),
  validUntil: dateTime.nullable(),
  person: personRefSchema.nullable(),
  /** No active person matches the account. */
  orphan: z.boolean(),
  /** Created or adopted by the platform. */
  managed: z.boolean(),
  roles: z.array(z.string()),
  syncedAt: dateTime,
});
export type InventoryAccount = z.input<typeof inventoryAccountSchema>;

export const unmanagedQuerySchema = z.object({ serverId: id.optional() });

export const unmanagedSchema = z.object({
  server: serverRefSchema,
  role: roleRefSchema,
  database: z.string().nullable(),
  memberName: z.string(),
  /** The person the account name points at (by the server's pattern). */
  suggested: personRefSchema.nullable(),
  syncedAt: dateTime.nullable(),
});
export type Unmanaged = z.input<typeof unmanagedSchema>;

const memberRef = {
  serverId: id,
  roleId: id,
  memberName: z.string().trim().min(1).max(128).regex(INVENTORY_NAME_RE),
};

export const adoptSchema = z.object({
  ...memberRef,
  userId: id,
  expiresOn: dateOnly.nullable(),
  note: z.string().trim().max(1_000).nullable().default(null),
});
export type AdoptInput = z.input<typeof adoptSchema>;

export const revokeUnmanagedSchema = z.object({ ...memberRef, reason: z.string().trim().min(3).max(1_000) });
export type RevokeUnmanagedInput = z.input<typeof revokeUnmanagedSchema>;

/* ───────────────────────────── reviews ───────────────────────────── */

export const reviewTotalsSchema = z.object({
  items: z.number().int(),
  kept: z.number().int(),
  revoked: z.number().int(),
  pending: z.number().int(),
  /** Undecided items the caller may decide. */
  mine: z.number().int(),
});

export const reviewSchema = z.object({
  id,
  reference: z.string(),
  name: z.string(),
  status: reviewStatusSchema,
  servers: z.array(serverRefSchema),
  minRisk: riskSchema,
  reviewerRule: reviewerRuleSchema,
  startOn: z.string(),
  dueOn: z.string(),
  policy: reviewPolicySchema,
  recurrence: recurrenceSchema,
  startedAt: dateTime.nullable(),
  closedAt: dateTime.nullable(),
  createdBy: personRefSchema.nullable(),
  totals: reviewTotalsSchema,
  canManage: z.boolean(),
  createdAt: dateTime,
});
export type Review = z.input<typeof reviewSchema>;

export const reviewQuerySchema = listQuerySchema.extend({
  status: reviewStatusSchema.optional(),
  /** Only campaigns with items the caller may decide. */
  mine: z.stringbool().optional(),
});

export const createReviewSchema = z
  .object({
    name: z.string().trim().min(3).max(200),
    /** Empty: every server. */
    serverIds: z.array(id).max(50).default([]),
    minRisk: riskSchema.default('low'),
    reviewerRule: reviewerRuleSchema.default('owner'),
    startOn: dateOnly.nullable().default(null),
    dueOn: dateOnly,
    policy: reviewPolicySchema.default('revoke'),
    recurrence: recurrenceSchema.default('quarterly'),
  })
  .refine((v) => !v.startOn || v.startOn < v.dueOn, {
    path: ['dueOn'],
    message: 'The due date must be after the start',
  });
export type CreateReviewInput = z.input<typeof createReviewSchema>;

export const reviewItemSchema = z.object({
  id,
  grantId: id,
  grantee: personRefSchema.nullable(),
  accountName: z.string().nullable(),
  role: roleRefSchema,
  server: serverRefSchema,
  grantedAt: dateTime.nullable(),
  expiresAt: dateTime.nullable(),
  reviewer: ownerSchema.nullable(),
  decision: reviewDecisionSchema.nullable(),
  comment: z.string().nullable(),
  decidedBy: personRefSchema.nullable(),
  decidedAt: dateTime.nullable(),
  /** Set when the campaign closed: what happened to the grant. */
  outcome: z.enum(['kept', 'revoked']).nullable(),
  canDecide: z.boolean(),
});
export type ReviewItem = z.input<typeof reviewItemSchema>;

export const reviewItemQuerySchema = listQuerySchema.extend({
  view: z.enum(['mine', 'undecided', 'decided', 'all']).optional(),
  serverId: id.optional(),
});

export const decideSchema = z
  .object({
    itemIds: z.array(id).min(1).max(200),
    decision: reviewDecisionSchema,
    comment: z.string().trim().max(1_000).nullable().default(null),
  })
  .refine((v) => v.decision === 'keep' || (v.comment ?? '').length >= 3, {
    path: ['comment'],
    message: 'Say why the access should be revoked',
  });
export type DecideInput = z.input<typeof decideSchema>;

export const mySummarySchema = z.object({
  reviews: z.array(
    z.object({ id, reference: z.string(), name: z.string(), dueOn: z.string(), pending: z.number().int() }),
  ),
  expiring: z.array(grantSchema),
});
export type MySummary = z.input<typeof mySummarySchema>;

/* ───────────────────────────── task type & AI ───────────────────────────── */

/** Config of the `dbaccess.sync` task type (Scheduled jobs). */
export const syncTaskConfigSchema = z.object({ serverId: id });
export type SyncTaskConfig = z.infer<typeof syncTaskConfigSchema>;

export const aiListMyAccessInput = z.object({
  includeEnded: z.boolean().default(false).describe('Also list expired and revoked access'),
});

export const aiRequestAccessInput = z.object({
  role: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('The requestable role: its id, its database role name (demo_reporting) or its display name'),
  server: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Server display name, when the role name is ambiguous'),
  expiresOn: dateOnly
    .nullable()
    .optional()
    .describe('Last day of access (YYYY-MM-DD); omitted: the role default'),
  justification: z.string().trim().min(3).max(2_000).describe('Why the access is needed'),
});

/* ───────────────────────────── server-side shapes ───────────────────────────── */

/** What services return (dates as `Date`; the routes encode them). Pages use the wire types above. */
export type ConnectionInfoOut = z.output<typeof connectionInfoSchema>;
export type ServerOut = z.output<typeof serverSchema>;
export type ServersOut = z.output<typeof serversSchema>;
export type SyncResultOut = z.output<typeof syncResultSchema>;
export type InventoryOut = z.output<typeof inventorySchema>;
export type RequestableRoleOut = z.output<typeof requestableRoleSchema>;
export type CatalogItemOut = z.output<typeof catalogItemSchema>;
export type AccessRequestOut = z.output<typeof requestSchema>;
export type GrantOut = z.output<typeof grantSchema>;
export type RevealOut = z.output<typeof revealSchema>;
export type InventoryAccountOut = z.output<typeof inventoryAccountSchema>;
export type UnmanagedOut = z.output<typeof unmanagedSchema>;
export type ReviewOut = z.output<typeof reviewSchema>;
export type ReviewItemOut = z.output<typeof reviewItemSchema>;
