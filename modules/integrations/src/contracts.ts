/**
 * Integrations Hub API contract (mounted at /api/v1/integrations). Zod schemas shared by the routes, the
 * pages and the tests.
 *
 *   Catalogue
 *     GET    /connectors                         → { connectors, entities }
 *     GET    /entities/:entity/fields            ?containerId → { items: localField[] }
 *     GET    /entities/:entity/containers        ?q → { items: { id, label }[] }
 *
 *   Connections
 *     GET    /connections                        → { items: connection[] }
 *     POST   /connections                        createConnection → connectionCreated (201, webhook secret once)
 *     GET    /connections/:id                    → connection          (secrets: only `storedSecrets` keys)
 *     PATCH  /connections/:id                    updateConnection → connection
 *     DELETE /connections/:id                    (409 SYNC_RUNNING while a run is active)
 *     POST   /connections/:id/test               → testResult           (updates health)
 *     POST   /connections/test                   testDraft → testResult (unsaved settings)
 *     POST   /connections/:id/webhook-secret     → { webhookSecret, rotatedAt } (shown once)
 *     GET    /connections/:id/scopes             ?objectType → { items: { id, name }[] }
 *     GET    /connections/:id/fields             ?objectType&scope → { items: remoteField[] }
 *
 *   Profiles
 *     GET    /profiles                           ?connectionId → { items: profileSummary[] }
 *     GET    /profiles/default-mapping           ?connectionId&objectType&entity&scope&containerId
 *     POST   /profiles                           createProfile → profile (201; needs the entity's .sync permission)
 *     POST   /profiles/preview                   profileDraft → preview (dry run of an unsaved profile)
 *     GET    /profiles/:id                       → profile
 *     PATCH  /profiles/:id                       updateProfile → profile
 *     DELETE /profiles/:id
 *     POST   /profiles/:id/run                   → run (201; 409 SYNC_RUNNING)
 *     POST   /profiles/:id/export                → run (201; push existing records)
 *     POST   /profiles/:id/preview               profileDraft? → preview
 *
 *   Runs · links · conflicts
 *     GET    /runs                               runQuery → page(runSummary)
 *     GET    /runs/:id                           → runDetail (with the log)
 *     GET    /links                              linkQuery → page(link)
 *     GET    /links/by-record                    ?entity&id → { items: recordLink[] } (the record panel)
 *     POST   /links/:id/resync                   → run (202)
 *     POST   /links/:id/relink                   { remoteId } → link
 *     DELETE /links/:id                          unlink (nothing is deleted on either side)
 *     GET    /conflicts                          conflictQuery → page(conflictSummary)
 *     GET    /conflicts/:id                      → conflictDetail
 *     POST   /conflicts/:id/resolve              { choices } → conflictDetail (409 CONFLICT_RESOLVED)
 *     POST   /conflicts/:id/dismiss              → conflictDetail (keep both as they are)
 *
 *   Webhooks (public)
 *     POST   /hooks/:connectionId                X-ISBP-Webhook-Secret or Basic password → 202
 */
import { dateTime } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  CONFLICT_POLICIES,
  CONFLICT_STATUSES,
  COUNT_KEYS,
  DIRECTIONS,
  FIELD_TYPES,
  FILTER_OPS,
  HEALTHS,
  LIMITS,
  LINK_ORIGINS,
  LINK_STATES,
  LOG_LEVELS,
  MAPPING_DIRECTIONS,
  RUN_KINDS,
  RUN_STATUSES,
  RUN_TRIGGERS,
} from './model';

export * from './model';
export type { ConnectorConfigSlotProps, RecordPanelSlotProps, TaskConfigSlotProps } from '@isbp/contracts';

const id = z.uuid();
const entityKey = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/, 'Use <module>.<entity>');
const connectorType = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/, 'Use <module>.<type>');
const objectType = z.string().regex(/^[a-z][a-z0-9-]*$/);
const fieldKey = z.string().trim().min(1).max(200);
/** Ids of local records and remote objects are opaque strings. */
const opaqueId = z.string().trim().min(1).max(200);

export const fieldTypeSchema = z.enum(FIELD_TYPES);
export const directionSchema = z.enum(DIRECTIONS);
export const mappingDirectionSchema = z.enum(MAPPING_DIRECTIONS);
export const conflictPolicySchema = z.enum(CONFLICT_POLICIES);
export const healthSchema = z.enum(HEALTHS);
export const linkStateSchema = z.enum(LINK_STATES);
export const linkOriginSchema = z.enum(LINK_ORIGINS);
export const runStatusSchema = z.enum(RUN_STATUSES);
export const runTriggerSchema = z.enum(RUN_TRIGGERS);
export const runKindSchema = z.enum(RUN_KINDS);
export const conflictStatusSchema = z.enum(CONFLICT_STATUSES);
export const logLevelSchema = z.enum(LOG_LEVELS);

/** A catalogue label: an i18n key of the owning module, or text per locale. */
export const labelSchema = z.union([z.string(), z.record(z.string(), z.string())]);

/* ───────────────────────────── catalogue ───────────────────────────── */

export const localFieldSchema = z.object({
  key: z.string(),
  label: labelSchema,
  type: fieldTypeSchema,
  choices: z.array(z.object({ value: z.string(), label: labelSchema })).optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  createOnly: z.boolean().optional(),
  maxLength: z.number().int().optional(),
});
export type LocalField = z.infer<typeof localFieldSchema>;

export const remoteFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: fieldTypeSchema,
  choices: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  createOnly: z.boolean().optional(),
});
export type RemoteField = z.infer<typeof remoteFieldSchema>;

export const capabilitiesSchema = z.object({
  create: z.boolean(),
  update: z.boolean(),
  comments: z.boolean(),
  webhooks: z.boolean(),
  hierarchy: z.boolean(),
});

export const connectorInfoSchema = z.object({
  transport: z.enum(['http', 'database']).optional(),
  configurePermission: z.string().optional(),
  type: z.string(),
  moduleId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  configSchema: z.unknown(),
  secretsSchema: z.unknown(),
  secretKeys: z.array(z.string()),
  objects: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      entities: z.array(z.string()),
      capabilities: capabilitiesSchema,
      scoped: z.boolean(),
    }),
  ),
});
export type ConnectorInfoDto = z.infer<typeof connectorInfoSchema>;

export const entityInfoSchema = z.object({
  entity: z.string(),
  moduleId: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  permission: z.string(),
  container: z.string().nullable(),
  comments: z.boolean(),
  recordType: z.boolean(),
  matchKeys: z.array(z.string()),
  /** The caller holds the entity's `.sync` permission (may set up profiles that write it). */
  canConfigure: z.boolean(),
});
export type EntityInfoDto = z.infer<typeof entityInfoSchema>;

export const catalogueSchema = z.object({
  connectors: z.array(connectorInfoSchema),
  entities: z.array(entityInfoSchema),
});
export type Catalogue = z.infer<typeof catalogueSchema>;

export const optionSchema = z.object({ id: z.string(), label: z.string() });
export type Option = z.infer<typeof optionSchema>;

export const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/* ───────────────────────────── connections ───────────────────────────── */

const name = z.string().trim().min(1).max(120);
const config = z.record(z.string(), z.unknown());
/** Typed secret values (empty strings are ignored: "leave empty to keep it"). */
const secrets = z.record(z.string(), z.string().max(20_000));

export const createConnectionSchema = z.object({
  name,
  type: connectorType,
  config: config.default({}),
  secrets: secrets.default({}),
  enabled: z.boolean().default(true),
  /** Lets the connector call plain `http://` (credentials and data cross the network unencrypted). */
  allowInsecureHttp: z.boolean().default(false),
});
export type CreateConnectionInput = z.input<typeof createConnectionSchema>;

/** No defaults (R26): omitted fields keep their stored values. */
export const updateConnectionSchema = z.object({
  name: name.optional(),
  config: config.optional(),
  /** Merged over the stored secrets. */
  secrets: secrets.optional(),
  /** Stored secrets to remove (optional ones). */
  removeSecrets: z.array(z.string().max(100)).max(50).optional(),
  enabled: z.boolean().optional(),
  allowInsecureHttp: z.boolean().optional(),
});
export type UpdateConnectionInput = z.input<typeof updateConnectionSchema>;

export const testDraftSchema = z.object({
  /** Reuse this connection's stored secrets for keys left empty. */
  id: id.optional(),
  type: connectorType,
  config: config.default({}),
  secrets: secrets.default({}),
  removeSecrets: z.array(z.string().max(100)).max(50).optional(),
  /** Omitted: the connection's stored setting (off for a new one). */
  allowInsecureHttp: z.boolean().optional(),
});
export type TestDraftInput = z.input<typeof testDraftSchema>;

export const testResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().nullable(),
  account: z.string().nullable(),
  /** Error code when the test could not reach or sign in to the system. */
  code: z.string().nullable(),
  durationMs: z.number().int(),
});
export type TestResult = z.infer<typeof testResultSchema>;

export const connectionStatsSchema = z.object({
  profiles: z.number().int(),
  links: z.number().int(),
  conflicts: z.number().int(),
  errors: z.number().int(),
  lastSyncAt: dateTime.nullable(),
  lastRunStatus: runStatusSchema.nullable(),
});

export const connectionSchema = z.object({
  id,
  name: z.string(),
  type: z.string(),
  /** The connector's display data; `available` is false when its module is disabled or gone. */
  connector: z.object({
    name: z.string(),
    icon: z.string().nullable(),
    moduleId: z.string(),
    available: z.boolean(),
    webhooks: z.boolean(),
  }),
  config: z.record(z.string(), z.unknown()),
  /** Secret keys with a stored value (never the values). */
  storedSecrets: z.array(z.string()),
  enabled: z.boolean(),
  allowInsecureHttp: z.boolean(),
  health: healthSchema,
  healthMessage: z.string().nullable(),
  account: z.string().nullable(),
  lastCheckedAt: dateTime.nullable(),
  webhook: z.object({ path: z.string(), secretSet: z.boolean(), rotatedAt: dateTime.nullable() }),
  stats: connectionStatsSchema,
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Connection = z.input<typeof connectionSchema>;
export type ConnectionOut = z.output<typeof connectionSchema>;

export const connectionCreatedSchema = connectionSchema.extend({
  /** Shown once: only its SHA-256 is stored. */
  webhookSecret: z.string(),
});
export type ConnectionCreated = z.input<typeof connectionCreatedSchema>;
export type ConnectionCreatedOut = z.output<typeof connectionCreatedSchema>;

export const webhookSecretSchema = z.object({ webhookSecret: z.string(), rotatedAt: dateTime });
export type WebhookSecret = z.input<typeof webhookSecretSchema>;
export type WebhookSecretOut = z.output<typeof webhookSecretSchema>;

/* ───────────────────────────── profiles ───────────────────────────── */

/**
 * Value map rows. `direction` (omitted = both ways) lets several remote values become one local value (pull
 * rows) while one row sends that local value out: per direction a value may have only one row.
 */
export const valueMapSchema = z
  .array(
    z.object({
      remote: z.string().trim().min(1).max(200),
      local: z.string().trim().min(1).max(200),
      direction: mappingDirectionSchema.optional(),
    }),
  )
  .max(LIMITS.valueMap);
export type ValueMapRow = z.infer<typeof valueMapSchema>[number];

export const fieldMappingSchema = z.object({
  local: fieldKey,
  remote: fieldKey,
  direction: mappingDirectionSchema.default('both'),
  values: valueMapSchema.optional(),
});
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

export const filterConditionSchema = z.object({
  field: fieldKey,
  op: z.enum(FILTER_OPS),
  value: z
    .union([z.string().max(500), z.array(z.string().max(500)).max(50)])
    .nullable()
    .optional(),
});

export const matchRuleSchema = z.object({ local: fieldKey, remote: fieldKey });

/** Fields of a profile that can change after creation (the "what ↔ what" part can't). */
const editable = {
  name: z.string().trim().min(1).max(200),
  direction: directionSchema,
  createLocal: z.boolean(),
  createRemote: z.boolean(),
  matchRule: matchRuleSchema.nullable(),
  pushFilter: z.array(filterConditionSchema).max(LIMITS.filters),
  mappings: z.array(fieldMappingSchema).max(LIMITS.mappings),
  conflictPolicy: conflictPolicySchema,
  comments: z.boolean(),
  /** Minutes between scheduled pulls; 0 = only "Run now", webhooks and Scheduled Jobs. */
  intervalMinutes: z.number().int().min(0).max(LIMITS.intervalMinutes),
  enabled: z.boolean(),
};

const what = {
  connectionId: id,
  objectType,
  remoteScope: z.string().trim().min(1).max(300).nullable().default(null),
  entity: entityKey,
  containerId: opaqueId.nullable().default(null),
};

export const createProfileSchema = z.object({
  ...what,
  name: editable.name,
  direction: editable.direction.default('pull'),
  createLocal: editable.createLocal.default(true),
  createRemote: editable.createRemote.default(false),
  matchRule: editable.matchRule.default(null),
  pushFilter: editable.pushFilter.default([]),
  mappings: editable.mappings.default([]),
  conflictPolicy: editable.conflictPolicy.default('manual'),
  comments: editable.comments.default(false),
  intervalMinutes: editable.intervalMinutes.default(15),
  enabled: editable.enabled.default(true),
});
export type CreateProfileInput = z.input<typeof createProfileSchema>;
export type ProfileDraft = z.infer<typeof createProfileSchema>;

/** No defaults (R26). */
export const updateProfileSchema = z.object(editable).partial();
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const profileSchema = z.object({
  id,
  connectionId: id,
  name: z.string(),
  objectType: z.string(),
  remoteScope: z.string().nullable(),
  remoteScopeName: z.string().nullable(),
  entity: z.string(),
  containerId: z.string().nullable(),
  containerLabel: z.string().nullable(),
  direction: directionSchema,
  createLocal: z.boolean(),
  createRemote: z.boolean(),
  matchRule: matchRuleSchema.nullable(),
  pushFilter: z.array(filterConditionSchema),
  mappings: z.array(fieldMappingSchema),
  conflictPolicy: conflictPolicySchema,
  comments: z.boolean(),
  intervalMinutes: z.number().int(),
  enabled: z.boolean(),
  cursor: z.string().nullable(),
  nextRunAt: dateTime.nullable(),
  lastRun: z
    .object({ id, status: runStatusSchema, startedAt: dateTime.nullable(), finishedAt: dateTime.nullable() })
    .nullable(),
  stats: z.object({ links: z.number().int(), conflicts: z.number().int(), errors: z.number().int() }),
  /** Whether the caller may change it (holds the entity's `.sync` permission). */
  canEdit: z.boolean(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Profile = z.input<typeof profileSchema>;
export type ProfileOut = z.output<typeof profileSchema>;

export const defaultMappingQuerySchema = z.object({
  connectionId: id,
  objectType,
  entity: entityKey,
  scope: z.string().max(300).optional(),
  containerId: z.string().max(200).optional(),
});

export const defaultMappingSchema = z.object({
  mappings: z.array(fieldMappingSchema),
  /** Suggestions dropped because a catalogue doesn't have the field (or the types don't fit). */
  dropped: z.number().int(),
});
export type DefaultMapping = z.input<typeof defaultMappingSchema>;
export type DefaultMappingOut = z.output<typeof defaultMappingSchema>;

/** A dry run of an unsaved profile (or unsaved changes to `id`). */
export const profileDraftSchema = createProfileSchema.extend({ id: id.optional() });
export type ProfileDraftInput = z.input<typeof profileDraftSchema>;

export const previewChangeSchema = z.object({
  field: z.string(),
  remoteField: z.string(),
  /** `pull`: written in ISBP; `push`: sent to the remote system; `conflict`: both changed. */
  direction: z.enum(['pull', 'push', 'conflict']),
  before: z.unknown(),
  after: z.unknown(),
});

export const PREVIEW_ACTIONS = [
  'create',
  'link',
  'update',
  'push',
  'remoteCreate',
  'conflict',
  'skip',
  'orphan',
] as const;
export type PreviewAction = (typeof PREVIEW_ACTIONS)[number];

export const previewItemSchema = z.object({
  remoteId: z.string().nullable(),
  remoteRef: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  title: z.string(),
  localId: z.string().nullable(),
  localTitle: z.string().nullable(),
  actions: z.array(z.enum(PREVIEW_ACTIONS)),
  /** Why nothing happens, or what to look at (`not_linked`, `unchanged`, `filtered`, `parent_unlinked`, …). */
  notes: z.array(z.string()),
  changes: z.array(previewChangeSchema),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type PreviewItem = z.input<typeof previewItemSchema>;

export const previewSchema = z.object({
  source: z.enum(['remote', 'local']),
  items: z.array(previewItemSchema),
  hasMore: z.boolean(),
});
export type Preview = z.input<typeof previewSchema>;
export type PreviewOut = z.output<typeof previewSchema>;

/* ───────────────────────────── runs ───────────────────────────── */

export const countsSchema = z.object(
  Object.fromEntries(COUNT_KEYS.map((k) => [k, z.number().int()])) as Record<
    (typeof COUNT_KEYS)[number],
    z.ZodNumber
  >,
);

export const logEntrySchema = z.object({
  at: z.string(),
  level: logLevelSchema,
  message: z.string(),
  ref: z
    .object({
      remote: z.string().optional(),
      local: z.string().optional(),
      linkId: z.string().optional(),
      fields: z.array(labelSchema).optional(),
    })
    .optional(),
});
export type LogEntryDto = z.infer<typeof logEntrySchema>;

export const runSummarySchema = z.object({
  id,
  profile: z.object({ id, name: z.string(), entity: z.string(), objectType: z.string() }),
  connection: z.object({ id, name: z.string(), type: z.string() }),
  kind: runKindSchema,
  trigger: runTriggerSchema,
  status: runStatusSchema,
  counts: countsSchema,
  error: z.string().nullable(),
  /** Error code of a failed run (`REMOTE_AUTH_FAILED`, `INSECURE_HTTP`, …), for the translated message. */
  errorCode: z.string().nullable(),
  triggeredBy: z.object({ id, displayName: z.string() }).nullable(),
  resumeAt: dateTime.nullable(),
  startedAt: dateTime.nullable(),
  finishedAt: dateTime.nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: dateTime,
});
export type RunSummary = z.input<typeof runSummarySchema>;
export type RunSummaryOut = z.output<typeof runSummarySchema>;

export const runDetailSchema = runSummarySchema.extend({
  log: z.array(logEntrySchema),
  /** Entries left out between the first ones and the latest ones. */
  logDropped: z.number().int(),
});
export type RunDetail = z.input<typeof runDetailSchema>;
export type RunDetailOut = z.output<typeof runDetailSchema>;

export const runQuerySchema = listQuerySchema.extend({
  connectionId: id.optional(),
  profileId: id.optional(),
  status: runStatusSchema.optional(),
  trigger: runTriggerSchema.optional(),
  kind: runKindSchema.optional(),
});
export type RunQueryOut = z.output<typeof runQuerySchema>;

/* ───────────────────────────── links ───────────────────────────── */

export const lastErrorSchema = z
  .object({ code: z.string(), message: z.string(), details: z.unknown().optional() })
  .nullable();

export const localRecordSchema = z.object({
  id: z.string(),
  reference: z.string().nullable(),
  title: z.string(),
  href: z.string().nullable(),
  /** The caller can't see this record (title withheld). */
  hidden: z.boolean(),
});

export const linkSchema = z.object({
  id,
  profileId: id,
  profileName: z.string(),
  connectionId: id,
  entity: z.string(),
  local: localRecordSchema.nullable(),
  remoteId: z.string(),
  remoteRef: z.string().nullable(),
  remoteTitle: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  remoteVersion: z.string().nullable(),
  origin: linkOriginSchema,
  state: linkStateSchema,
  lastError: lastErrorSchema,
  lastSyncedAt: dateTime.nullable(),
  createdAt: dateTime,
});
export type Link = z.input<typeof linkSchema>;
export type LinkOut = z.output<typeof linkSchema>;

export const linkQuerySchema = listQuerySchema.extend({
  connectionId: id.optional(),
  profileId: id.optional(),
  state: linkStateSchema.optional(),
});
export type LinkQueryOut = z.output<typeof linkQuerySchema>;

export const byRecordQuerySchema = z.object({
  entity: entityKey,
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/),
});

export const recordLinkSchema = z.object({
  id,
  state: linkStateSchema,
  connection: z.object({ id, name: z.string(), type: z.string(), icon: z.string().nullable() }),
  connectorName: z.string(),
  remoteRef: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  lastSyncedAt: dateTime.nullable(),
  /** Error code only (translated in the UI). */
  lastErrorCode: z.string().nullable(),
  canSync: z.boolean(),
});
export type RecordLink = z.input<typeof recordLinkSchema>;
export type RecordLinkOut = z.output<typeof recordLinkSchema>;

export const relinkSchema = z.object({ remoteId: opaqueId });

export const resyncResultSchema = z.object({ runId: id });

/* ───────────────────────────── conflicts ───────────────────────────── */

export const conflictFieldSchema = z.object({
  /** Local field key (and the mapping's remote key). */
  field: z.string(),
  remoteField: z.string(),
  label: labelSchema,
  type: fieldTypeSchema,
  /** Last agreed value, current ISBP value, current remote value: all in ISBP's form. */
  base: z.unknown(),
  local: z.unknown(),
  remote: z.unknown(),
});
export type ConflictField = z.input<typeof conflictFieldSchema>;

export const conflictSummarySchema = z.object({
  id,
  linkId: id,
  profile: z.object({ id, name: z.string() }),
  connection: z.object({ id, name: z.string(), type: z.string() }),
  entity: z.string(),
  local: localRecordSchema.nullable(),
  remoteRef: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  status: conflictStatusSchema,
  fields: z.array(z.string()),
  resolvedBy: z.object({ id, displayName: z.string() }).nullable(),
  resolvedAt: dateTime.nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type ConflictSummary = z.input<typeof conflictSummarySchema>;
export type ConflictSummaryOut = z.output<typeof conflictSummarySchema>;

export const conflictDetailSchema = conflictSummarySchema.extend({
  /** Values are withheld (empty) when the caller can't see the record. */
  details: z.array(conflictFieldSchema),
  choices: z.record(z.string(), z.enum(['local', 'remote'])).nullable(),
  canResolve: z.boolean(),
  /** When each side last changed (and, here, by whom when the audit log says so). */
  localChange: z.object({ at: dateTime, by: z.string().nullable() }).nullable(),
  remoteChange: z.object({ at: dateTime }).nullable(),
});
export type ConflictDetail = z.input<typeof conflictDetailSchema>;
export type ConflictDetailOut = z.output<typeof conflictDetailSchema>;

export const conflictQuerySchema = listQuerySchema.extend({
  connectionId: id.optional(),
  profileId: id.optional(),
  status: conflictStatusSchema.optional(),
});
export type ConflictQueryOut = z.output<typeof conflictQuerySchema>;

export const resolveConflictSchema = z.object({
  choices: z.record(fieldKey, z.enum(['local', 'remote'])),
});

/* ───────────────────────────── task type ───────────────────────────── */

/** `integrations.sync` (Scheduled Jobs): run a profile's pull. */
export const syncTaskConfigSchema = z.object({ profileId: id });
export type SyncTaskConfig = z.infer<typeof syncTaskConfigSchema>;

/* ───────────────────────────── webhooks ───────────────────────────── */

export const webhookAcceptedSchema = z.object({ accepted: z.number().int() });
