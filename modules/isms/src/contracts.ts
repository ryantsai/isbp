/**
 * Request and response shapes of the Information security API (`/api/v1/isms`), shared by the server and the web
 * pages. Update schemas are built from defaults-free field maps (R26).
 */
import { dateTime } from '@isbp/contracts';
import { listQuerySchema, localizedTextSchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  ACCOUNT_STATES,
  ASSET_STATUSES,
  CLASS_CODE_RE,
  isDate,
  KEY_RE,
  PASSWORD_REASONS,
  PRIVILEGES,
  RECURRENCES,
  REVIEW_DECISIONS,
  REVIEW_SOURCES,
  REVIEW_STATUSES,
  SHARED_ACCOUNT_STATUSES,
  SITE_CODE_RE,
  STOCKTAKE_RESULTS,
  STOCKTAKE_STATUSES,
} from './model';

export {
  ACCOUNT_STATES,
  ASSET_STATUSES,
  CIA_DIMENSIONS,
  CIA_LEVELS,
  PASSWORD_REASONS,
  PRIVILEGES,
  RECURRENCES,
  REGISTER_COLUMNS,
  REVIEW_COLUMNS,
  REVIEW_DECISIONS,
  REVIEW_SOURCES,
  REVIEW_STATUSES,
  SHARED_ACCOUNT_STATUSES,
  STOCKTAKE_EDITABLE,
  STOCKTAKE_RESULTS,
  STOCKTAKE_STATUSES,
} from './model';

const uuid = z.uuid();
const day = z.string().refine(isDate, 'Use a date like 2026-10-08');
const level = z.number().int().min(1).max(4);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Text per language that may be empty (a guidance level that doesn't apply). */
export const optionalLocalizedSchema = z.object({
  en: z.string().trim().max(1000).optional(),
  'zh-TW': z.string().trim().max(1000).optional(),
  'ja-JP': z.string().trim().max(1000).optional(),
});
export type OptionalLocalized = z.infer<typeof optionalLocalizedSchema>;

const levelsSchema = z.object({
  '1': optionalLocalizedSchema,
  '2': optionalLocalizedSchema,
  '3': optionalLocalizedSchema,
  '4': optionalLocalizedSchema,
});
/** Scoring guidance of a class: what each score 1–4 means for confidentiality, integrity and availability. */
export const guidanceSchema = z.object({ c: levelsSchema, i: levelsSchema, a: levelsSchema });
export type Guidance = z.infer<typeof guidanceSchema>;

export const person = z.object({
  id: uuid,
  displayName: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type Person = z.input<typeof person>;
const groupRef = z.object({ id: uuid, key: z.string(), name: z.string() });

/* ───────────────────────────── taxonomy ───────────────────────────── */

export const subclassSchema = z.object({
  id: uuid,
  key: z.string(),
  name: localizedTextSchema,
  description: optionalLocalizedSchema.nullable(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
});
export type Subclass = z.input<typeof subclassSchema>;

export const assetClassSchema = z.object({
  id: uuid,
  code: z.string(),
  name: localizedTextSchema,
  description: optionalLocalizedSchema.nullable(),
  guidance: guidanceSchema,
  sortOrder: z.number().int(),
  archived: z.boolean(),
  subclasses: z.array(subclassSchema),
  assetCount: z.number().int(),
});
export type AssetClass = z.input<typeof assetClassSchema>;

const subclassInput = z.object({
  /** Existing sub-class (omit for a new one). */
  id: uuid.optional(),
  key: z
    .string()
    .regex(KEY_RE, 'Use lowercase letters, digits and dashes')
    .describe('Lowercase slug, e.g. servers'),
  name: localizedTextSchema.describe('Name in en, zh-TW and ja-JP'),
  description: optionalLocalizedSchema.nullish(),
  archived: z
    .boolean()
    .optional()
    .describe('Archived sub-classes stay on existing assets but are not offered'),
});

/** A class with its sub-classes and guidance (the admin page's form and the `isms.asset-class` kind's value). */
export const upsertClassSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(CLASS_CODE_RE, 'Use 2–4 capital letters')
    .describe('2-4 capital letters used in asset numbers, e.g. HW. Cannot change once created'),
  name: localizedTextSchema.describe('Name in en, zh-TW and ja-JP'),
  description: optionalLocalizedSchema.nullish(),
  guidance: guidanceSchema.describe(
    'For c (confidentiality), i (integrity) and a (availability): what scores 1, 2, 3 and 4 mean for this class, per language',
  ),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  subclasses: z.array(subclassInput).max(50).describe('Sub-classes in display order'),
});
export type UpsertClassInput = z.input<typeof upsertClassSchema>;
export const updateClassSchema = upsertClassSchema.partial();
export type UpdateClassInput = z.input<typeof updateClassSchema>;

export const siteSchema = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  archived: z.boolean(),
  assetCount: z.number().int(),
});
export type Site = z.input<typeof siteSchema>;
export const createSiteSchema = z.object({
  code: z.string().trim().regex(SITE_CODE_RE, 'Use 2–8 capital letters or digits'),
  name: text(200).min(1),
  description: optionalText(2000),
});
export const updateSiteSchema = z.object({
  name: text(200).min(1).optional(),
  description: optionalText(2000).optional(),
  archived: z.boolean().optional(),
});

export const labelSchema = z.object({
  id: uuid,
  key: z.string(),
  name: localizedTextSchema,
  description: optionalLocalizedSchema.nullable(),
  rank: z.number().int(),
  archived: z.boolean(),
});
export type ClassificationLabel = z.input<typeof labelSchema>;
export const createLabelSchema = z.object({
  key: z.string().regex(KEY_RE, 'Use lowercase letters, digits and dashes'),
  name: localizedTextSchema,
  description: optionalLocalizedSchema.nullish(),
  /** Higher = more sensitive; the list is shown highest first. */
  rank: z.number().int().min(0).max(100).optional(),
});
export const updateLabelSchema = z.object({
  name: localizedTextSchema.optional(),
  description: optionalLocalizedSchema.nullish(),
  rank: z.number().int().min(0).max(100).optional(),
  archived: z.boolean().optional(),
});

/** Everything the register's forms and filters need (active entries only, unless `all`). */
export const taxonomySchema = z.object({
  classes: z.array(assetClassSchema),
  sites: z.array(siteSchema),
  labels: z.array(labelSchema),
});
export type Taxonomy = z.input<typeof taxonomySchema>;

/* ───────────────────────────── assets ───────────────────────────── */

const assetClassRef = z.object({ id: uuid, code: z.string(), name: localizedTextSchema });
const subclassRef = z.object({ id: uuid, key: z.string(), name: localizedTextSchema });
const siteRef = z.object({ id: uuid, code: z.string(), name: z.string() });
const labelRef = z.object({ id: uuid, key: z.string(), name: localizedTextSchema, rank: z.number().int() });

export const assetListItemSchema = z.object({
  id: uuid,
  number: z.string(),
  name: z.string(),
  class: assetClassRef,
  subclass: subclassRef.nullable(),
  site: siteRef,
  manager: person.nullable(),
  managerGroup: groupRef.nullable(),
  location: z.string().nullable(),
  confidentiality: z.number().int(),
  integrity: z.number().int(),
  availability: z.number().int(),
  value: z.number().int(),
  classification: labelRef.nullable(),
  status: z.enum(ASSET_STATUSES),
  updatedAt: dateTime,
});
export type AssetListItem = z.input<typeof assetListItemSchema>;

export const assetSchema = assetListItemSchema.extend({
  users: z.array(person),
  usersText: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  version: z.string().nullable(),
  quantity: z.number().int(),
  notes: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  sourceRef: z.string().nullable(),
  lastVerifiedOn: z.string().nullable(),
  createdAt: dateTime,
  viewer: z.object({ canManage: z.boolean() }),
});
export type Asset = z.input<typeof assetSchema>;

export const ASSET_VIEWS = ['active', 'missing', 'disposed', 'all'] as const;
export const assetQuerySchema = listQuerySchema.extend({
  view: z.enum(ASSET_VIEWS).default('active'),
  class: uuid.optional(),
  subclass: uuid.optional(),
  site: uuid.optional(),
  classification: uuid.optional(),
  minValue: z.coerce.number().int().min(1).max(4).optional(),
  manager: z.union([uuid, z.literal('me')]).optional(),
  managerGroup: uuid.optional(),
});
export type AssetQuery = z.input<typeof assetQuerySchema>;

/** Export: the same filters, every matching row. */
export const assetExportQuerySchema = assetQuerySchema.omit({ page: true, pageSize: true });

const assetFields = {
  name: text(200).min(1),
  classId: uuid,
  subclassId: uuid.nullable(),
  siteId: uuid,
  managerId: uuid.nullable(),
  managerGroupId: uuid.nullable(),
  userIds: z.array(uuid).max(50),
  usersText: optionalText(500),
  location: optionalText(200),
  brand: optionalText(100),
  model: optionalText(100),
  version: optionalText(100),
  quantity: z.number().int().min(0).max(1_000_000),
  confidentiality: level,
  integrity: level,
  availability: level,
  classificationId: uuid.nullable(),
  notes: optionalText(5000),
  attributes: z.record(z.string(), z.unknown()),
};

export const createAssetSchema = z.object({
  ...assetFields,
  subclassId: assetFields.subclassId.optional(),
  managerId: assetFields.managerId.optional(),
  managerGroupId: assetFields.managerGroupId.optional(),
  userIds: assetFields.userIds.default([]),
  usersText: assetFields.usersText.optional(),
  location: assetFields.location.optional(),
  brand: assetFields.brand.optional(),
  model: assetFields.model.optional(),
  version: assetFields.version.optional(),
  quantity: assetFields.quantity.default(1),
  classificationId: assetFields.classificationId.optional(),
  notes: assetFields.notes.optional(),
  attributes: assetFields.attributes.optional(),
});
export type CreateAssetInput = z.input<typeof createAssetSchema>;

/** PATCH: every field optional, no defaults (R26); `classId`/`siteId` changes keep the asset's number. */
export const updateAssetSchema = z.object({
  name: assetFields.name.optional(),
  classId: assetFields.classId.optional(),
  subclassId: assetFields.subclassId.optional(),
  siteId: assetFields.siteId.optional(),
  managerId: assetFields.managerId.optional(),
  managerGroupId: assetFields.managerGroupId.optional(),
  userIds: assetFields.userIds.optional(),
  usersText: assetFields.usersText.optional(),
  location: assetFields.location.optional(),
  brand: assetFields.brand.optional(),
  model: assetFields.model.optional(),
  version: assetFields.version.optional(),
  quantity: assetFields.quantity.optional(),
  confidentiality: assetFields.confidentiality.optional(),
  integrity: assetFields.integrity.optional(),
  availability: assetFields.availability.optional(),
  classificationId: assetFields.classificationId.optional(),
  notes: assetFields.notes.optional(),
  attributes: assetFields.attributes.optional(),
  status: z.enum(ASSET_STATUSES).optional(),
});
export type UpdateAssetInput = z.input<typeof updateAssetSchema>;

export const assetEventSchema = z.object({
  id: uuid,
  kind: z.string(),
  changes: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])).nullable(),
  note: z.string().nullable(),
  actor: z.object({ id: uuid.nullable(), displayName: z.string() }).nullable(),
  createdAt: dateTime,
});
export type AssetEvent = z.input<typeof assetEventSchema>;

export const importAssetsSchema = z.object({
  csv: z.string().min(1).max(4_000_000),
  /** Only check the file and report what would happen. */
  dryRun: z.boolean().default(true),
});

export const IMPORT_ISSUES = [
  'required',
  'unknownClass',
  'unknownSubclass',
  'unknownSite',
  'unknownLabel',
  'unknownManager',
  'badLevel',
  'badQuantity',
  'badNumber',
  'badStatus',
  'duplicate',
  'tooLong',
  'notFound',
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUES)[number];

export const importIssueSchema = z.object({
  line: z.number().int(),
  column: z.string().nullable(),
  code: z.enum(IMPORT_ISSUES),
  value: z.string().nullable(),
});
export type ImportIssue = z.input<typeof importIssueSchema>;

export const assetImportReportSchema = z.object({
  dryRun: z.boolean(),
  /** The file could not be read at all. */
  error: z.enum(['empty', 'tooManyRows', 'missingColumns']).nullable(),
  missing: z.array(z.string()),
  rows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
  issues: z.array(importIssueSchema),
  items: z.array(
    z.object({
      line: z.number().int(),
      number: z.string().nullable(),
      action: z.enum(['create', 'update', 'none']),
    }),
  ),
});
export type AssetImportReport = z.input<typeof assetImportReportSchema>;

/** Record types an asset can be registered from ("Create from…"). */
export const SOURCE_TYPES = [
  'cmdb.ci',
  'itam.asset',
  'itam.license',
  'itam.contract',
  'alm.application',
  'knowledge.article',
] as const;

export const sourceSearchQuerySchema = z.object({
  type: z.enum(SOURCE_TYPES),
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sourceRecordSchema = z.object({
  ref: z.string(),
  reference: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  href: z.string(),
  registered: z.object({ id: uuid, number: z.string() }).nullable(),
});
export type SourceRecord = z.input<typeof sourceRecordSchema>;

export const createFromRecordsSchema = z.object({
  refs: z.array(z.string().max(200)).min(1).max(100),
  classId: uuid,
  subclassId: uuid.nullish(),
  siteId: uuid,
  managerId: uuid.nullish(),
  managerGroupId: uuid.nullish(),
  confidentiality: level,
  integrity: level,
  availability: level,
  classificationId: uuid.nullish(),
});
export const createFromRecordsResultSchema = z.object({
  created: z.array(z.object({ id: uuid, number: z.string(), name: z.string() })),
  skipped: z.array(z.object({ ref: z.string(), reason: z.enum(['registered', 'hidden']) })),
});

/* ───────────────────────────── stocktakes ───────────────────────────── */

export const stocktakeScopeSchema = z.object({
  classIds: z.array(uuid).max(50).default([]),
  siteIds: z.array(uuid).max(50).default([]),
  managerIds: z.array(uuid).max(100).default([]),
  managerGroupIds: z.array(uuid).max(50).default([]),
});
export type StocktakeScope = z.output<typeof stocktakeScopeSchema>;

export const createStocktakeSchema = z.object({
  name: text(200).min(1),
  dueOn: day,
  /** Start later (the daily job opens it); today or empty starts it now. */
  startOn: day.nullish(),
  scope: stocktakeScopeSchema.default({ classIds: [], siteIds: [], managerIds: [], managerGroupIds: [] }),
  recurrence: z.enum(RECURRENCES).default('none'),
});
export type CreateStocktakeInput = z.input<typeof createStocktakeSchema>;

const progressSchema = z.object({
  total: z.number().int(),
  done: z.number().int(),
  percent: z.number().int(),
  byResult: z.object({
    confirmed: z.number().int(),
    changed: z.number().int(),
    missing: z.number().int(),
    disposed: z.number().int(),
  }),
});

export const stocktakeSchema = z.object({
  id: uuid,
  reference: z.string(),
  name: z.string(),
  status: z.enum(STOCKTAKE_STATUSES),
  startOn: z.string(),
  dueOn: z.string(),
  overdue: z.boolean(),
  recurrence: z.enum(RECURRENCES),
  scope: z.object({
    classes: z.array(z.object({ id: uuid, code: z.string(), name: localizedTextSchema })),
    sites: z.array(siteRef),
    managers: z.array(person),
    managerGroups: z.array(groupRef),
  }),
  progress: progressSchema,
  createdBy: person.nullable(),
  signedOffBy: person.nullable(),
  signedOffAt: dateTime.nullable(),
  signOffNote: z.string().nullable(),
  createdAt: dateTime,
  viewer: z.object({ canManage: z.boolean(), canSignOff: z.boolean(), pendingForMe: z.number().int() }),
});
export type Stocktake = z.input<typeof stocktakeSchema>;

export const stocktakeQuerySchema = listQuerySchema.extend({
  status: z.enum(STOCKTAKE_STATUSES).optional(),
  mine: z.stringbool().optional(),
});

/** What the item looked like when the stocktake started. */
export const itemSnapshotSchema = z.object({
  number: z.string(),
  name: z.string(),
  classCode: z.string(),
  className: localizedTextSchema,
  subclassName: localizedTextSchema.nullable(),
  siteCode: z.string(),
  location: z.string().nullable(),
  usersText: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  version: z.string().nullable(),
  quantity: z.number().int(),
  value: z.number().int(),
});
export type ItemSnapshot = z.infer<typeof itemSnapshotSchema>;

export const stocktakeItemSchema = z.object({
  id: uuid,
  assetId: uuid.nullable(),
  snapshot: itemSnapshotSchema,
  assignee: person.nullable(),
  assigneeGroup: groupRef.nullable(),
  result: z.enum(STOCKTAKE_RESULTS).nullable(),
  changes: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])).nullable(),
  note: z.string().nullable(),
  decidedBy: person.nullable(),
  decidedAt: dateTime.nullable(),
  canRecord: z.boolean(),
});
export type StocktakeItem = z.input<typeof stocktakeItemSchema>;

export const STOCKTAKE_ITEM_VIEWS = ['all', 'pending', 'done', ...STOCKTAKE_RESULTS] as const;
export const stocktakeItemQuerySchema = listQuerySchema.extend({
  view: z.enum(STOCKTAKE_ITEM_VIEWS).default('all'),
  mine: z.stringbool().optional(),
});

/** An item assigned to me in an open stocktake (dashboard, "My items"). */
export const myStocktakeItemSchema = stocktakeItemSchema.extend({
  stocktake: z.object({ id: uuid, reference: z.string(), name: z.string(), dueOn: z.string() }),
});
export type MyStocktakeItem = z.input<typeof myStocktakeItemSchema>;

export const stocktakeChangesSchema = z.object({
  name: text(200).min(1).optional(),
  location: optionalText(200).optional(),
  usersText: optionalText(500).optional(),
  brand: optionalText(100).optional(),
  model: optionalText(100).optional(),
  version: optionalText(100).optional(),
  quantity: z.number().int().min(0).max(1_000_000).optional(),
});
export type StocktakeChanges = z.input<typeof stocktakeChangesSchema>;

export const recordItemSchema = z.object({
  result: z.enum(STOCKTAKE_RESULTS),
  note: optionalText(2000).optional(),
  /** For `changed`: the corrected values, applied to the asset. */
  changes: stocktakeChangesSchema.optional(),
});
export type RecordItemInput = z.input<typeof recordItemSchema>;

export const signOffSchema = z.object({ note: optionalText(2000).optional() });

/* ───────────────────────────── shared accounts ───────────────────────────── */

export const accountMemberSchema = z.object({ user: person, addedAt: dateTime, active: z.boolean() });

export const sharedAccountSchema = z.object({
  id: uuid,
  reference: z.string(),
  accountName: z.string(),
  targetSystem: z.string().nullable(),
  targetRef: z.string().nullable(),
  custodian: person.nullable(),
  department: z.object({ id: uuid, name: z.string() }).nullable(),
  members: z.array(accountMemberSchema),
  purpose: z.string().nullable(),
  project: z.string().nullable(),
  requestReference: z.string().nullable(),
  lastPasswordChangeOn: z.string().nullable(),
  passwordChange: z.object({
    due: z.boolean(),
    since: dateTime.nullable(),
    reason: z.enum(PASSWORD_REASONS).nullable(),
    member: person.nullable(),
  }),
  status: z.enum(SHARED_ACCOUNT_STATUSES),
  nextReviewOn: z.string().nullable(),
  reviewDue: z.boolean(),
  lastReviewedOn: z.string().nullable(),
  lastReviewedBy: person.nullable(),
  notes: z.string().nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
  viewer: z.object({ canManage: z.boolean(), isCustodian: z.boolean(), canRecordPassword: z.boolean() }),
});
export type SharedAccount = z.input<typeof sharedAccountSchema>;

export const sharedAccountListItemSchema = sharedAccountSchema.omit({ members: true, viewer: true }).extend({
  memberCount: z.number().int(),
});
export type SharedAccountListItem = z.input<typeof sharedAccountListItemSchema>;

export const ACCOUNT_VIEWS = ['active', 'password', 'review', 'retired', 'all'] as const;
export const accountQuerySchema = listQuerySchema.extend({
  view: z.enum(ACCOUNT_VIEWS).default('active'),
  mine: z.stringbool().optional(),
  custodian: uuid.optional(),
});

const recordRefText = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*:[A-Za-z0-9_-]{1,64}$/,
    'A record reference such as alm.application:<id>',
  );

const accountFields = {
  accountName: text(200).min(1),
  targetSystem: optionalText(200),
  targetRef: recordRefText.nullable(),
  custodianId: uuid,
  memberIds: z.array(uuid).max(100),
  departmentId: uuid.nullable(),
  purpose: optionalText(2000),
  project: optionalText(200),
  requestReference: optionalText(64),
  lastPasswordChangeOn: day.nullable(),
  nextReviewOn: day.nullable(),
  notes: optionalText(5000),
};

export const createSharedAccountSchema = z.object({
  ...accountFields,
  targetSystem: accountFields.targetSystem.optional(),
  targetRef: accountFields.targetRef.optional(),
  memberIds: accountFields.memberIds.default([]),
  departmentId: accountFields.departmentId.optional(),
  purpose: accountFields.purpose.optional(),
  project: accountFields.project.optional(),
  requestReference: accountFields.requestReference.optional(),
  lastPasswordChangeOn: accountFields.lastPasswordChangeOn.optional(),
  nextReviewOn: accountFields.nextReviewOn.optional(),
  notes: accountFields.notes.optional(),
});
export type CreateSharedAccountInput = z.input<typeof createSharedAccountSchema>;

export const updateSharedAccountSchema = z.object({
  accountName: accountFields.accountName.optional(),
  targetSystem: accountFields.targetSystem.optional(),
  targetRef: accountFields.targetRef.optional(),
  custodianId: accountFields.custodianId.optional(),
  memberIds: accountFields.memberIds.optional(),
  departmentId: accountFields.departmentId.optional(),
  purpose: accountFields.purpose.optional(),
  project: accountFields.project.optional(),
  requestReference: accountFields.requestReference.optional(),
  nextReviewOn: accountFields.nextReviewOn.optional(),
  notes: accountFields.notes.optional(),
  status: z.enum(SHARED_ACCOUNT_STATUSES).optional(),
});
export type UpdateSharedAccountInput = z.input<typeof updateSharedAccountSchema>;

export const passwordChangedSchema = z.object({ changedOn: day, note: optionalText(2000).optional() });
export const reviewAccountSchema = z.object({
  /** Members who keep access; anyone else is removed (and the password becomes due). */
  memberIds: z.array(uuid).max(100),
  note: optionalText(2000).optional(),
});

export const accountEventSchema = z.object({
  id: uuid,
  kind: z.string(),
  user: person.nullable(),
  note: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  actor: z.object({ id: uuid.nullable(), displayName: z.string() }).nullable(),
  createdAt: dateTime,
});
export type AccountEvent = z.input<typeof accountEventSchema>;

/* ───────────────────────────── account reviews ───────────────────────────── */

export const createReviewSchema = z.object({
  target: text(200).min(1),
  targetRef: recordRefText.nullish(),
  reviewerId: uuid,
  dueOn: day,
  /** Start later (the daily job opens it and tells the reviewer); today or empty starts it now. */
  startOn: day.nullish(),
  /** Fill the items from the role holders of a registered application (core applications). */
  applicationId: uuid.nullish(),
  /** Signing off a recurring review schedules the next one (start and due dates moved by the period). */
  recurrence: z.enum(RECURRENCES).default('none'),
});
export type CreateReviewInput = z.input<typeof createReviewSchema>;

export const reviewProgressSchema = z.object({
  total: z.number().int(),
  decided: z.number().int(),
  percent: z.number().int(),
  byDecision: z.object({ keep: z.number().int(), disable: z.number().int(), delete: z.number().int() }),
});

export const reviewSchema = z.object({
  id: uuid,
  reference: z.string(),
  target: z.string(),
  targetRef: z.string().nullable(),
  reviewer: person.nullable(),
  startOn: z.string(),
  dueOn: z.string(),
  overdue: z.boolean(),
  recurrence: z.enum(RECURRENCES),
  status: z.enum(REVIEW_STATUSES),
  source: z.enum(REVIEW_SOURCES),
  application: z.object({ id: uuid, key: z.string(), name: z.string() }).nullable(),
  progress: reviewProgressSchema,
  createdBy: person.nullable(),
  completedBy: person.nullable(),
  completedAt: dateTime.nullable(),
  signedOffBy: person.nullable(),
  signedOffAt: dateTime.nullable(),
  signOffNote: z.string().nullable(),
  createdAt: dateTime,
  viewer: z.object({
    canDecide: z.boolean(),
    canManage: z.boolean(),
    canSignOff: z.boolean(),
    /** ITSM is enabled and the viewer may raise tickets through it. */
    canRaiseTickets: z.boolean(),
  }),
});
export type Review = z.input<typeof reviewSchema>;

export const reviewListItemSchema = reviewSchema.omit({ viewer: true });
export type ReviewListItem = z.input<typeof reviewListItemSchema>;

export const reviewQuerySchema = listQuerySchema.extend({
  status: z.enum(REVIEW_STATUSES).optional(),
  mine: z.stringbool().optional(),
});

export const reviewItemSchema = z.object({
  id: uuid,
  accountName: z.string(),
  userName: z.string().nullable(),
  user: person.nullable(),
  privilege: z.enum(PRIVILEGES),
  accountStatus: z.enum(ACCOUNT_STATES),
  detail: z.string().nullable(),
  decision: z.enum(REVIEW_DECISIONS).nullable(),
  doneOn: z.string().nullable(),
  note: z.string().nullable(),
  ticket: z.object({ id: z.string(), reference: z.string(), href: z.string().nullable() }).nullable(),
  decidedBy: person.nullable(),
  decidedAt: dateTime.nullable(),
});
export type ReviewItem = z.input<typeof reviewItemSchema>;

export const REVIEW_ITEM_VIEWS = ['all', 'undecided', 'keep', 'disable', 'delete', 'admin'] as const;
export const reviewItemQuerySchema = listQuerySchema.extend({
  view: z.enum(REVIEW_ITEM_VIEWS).default('all'),
});

export const addReviewItemSchema = z.object({
  accountName: text(200).min(1),
  userName: optionalText(200).optional(),
  userId: uuid.nullish(),
  privilege: z.enum(PRIVILEGES).default('user'),
  accountStatus: z.enum(ACCOUNT_STATES).default('enabled'),
});

export const decideItemSchema = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  /** When the account was disabled or deleted. */
  doneOn: day.nullish(),
  note: optionalText(2000).optional(),
});
export type DecideItemInput = z.input<typeof decideItemSchema>;

export const decideManySchema = decideItemSchema.extend({ itemIds: z.array(uuid).min(1).max(500) });

export const importReviewItemsSchema = z.object({
  csv: z.string().min(1).max(4_000_000),
  dryRun: z.boolean().default(true),
});

export const REVIEW_IMPORT_ISSUES = [
  'required',
  'badPrivilege',
  'badStatus',
  'duplicate',
  'tooLong',
] as const;
export const reviewImportReportSchema = z.object({
  dryRun: z.boolean(),
  error: z.enum(['empty', 'tooManyRows', 'missingColumns']).nullable(),
  missing: z.array(z.string()),
  rows: z.number().int(),
  added: z.number().int(),
  updated: z.number().int(),
  matched: z.number().int(),
  skipped: z.number().int(),
  issues: z.array(
    z.object({
      line: z.number().int(),
      column: z.string().nullable(),
      code: z.enum(REVIEW_IMPORT_ISSUES),
      value: z.string().nullable(),
    }),
  ),
});
export type ReviewImportReport = z.input<typeof reviewImportReportSchema>;

export const raiseTicketsResultSchema = z.object({
  raised: z.number().int(),
  failed: z.number().int(),
});

/* ───────────────────────────── lookups, dashboard, AI ───────────────────────────── */

export const lookupItemSchema = z.object({ id: uuid, key: z.string().nullable(), name: z.string() });
export type LookupItem = z.input<typeof lookupItemSchema>;

export const dashboardSchema = z.object({
  assets: z
    .object({
      total: z.number().int(),
      byValue: z.array(z.object({ value: z.number().int(), count: z.number().int() })),
      highValue: z.number().int(),
    })
    .nullable(),
  stocktakes: z.array(
    z.object({
      id: uuid,
      reference: z.string(),
      name: z.string(),
      dueOn: z.string(),
      percent: z.number().int(),
    }),
  ),
  myStocktakeItems: z.number().int(),
  passwordDue: z.array(z.object({ id: uuid, reference: z.string(), accountName: z.string() })),
  reviews: z.array(
    z.object({
      id: uuid,
      reference: z.string(),
      target: z.string(),
      dueOn: z.string(),
      percent: z.number().int(),
      status: z.enum(REVIEW_STATUSES),
    }),
  ),
});
export type Dashboard = z.input<typeof dashboardSchema>;

export const aiFindAssetsInput = z.object({
  query: z.string().trim().max(200).optional().describe('Asset number (HQ01HW0001) or words of its name'),
  classCode: z
    .string()
    .trim()
    .max(4)
    .optional()
    .describe('Class code such as HW (hardware) or DA (information)'),
  minValue: z.number().int().min(1).max(4).optional().describe('Only assets whose value is at least this'),
  limit: z.number().int().min(1).max(50).default(10),
});
