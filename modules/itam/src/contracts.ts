/**
 * API contract of the asset-management module (`/api/v1/itam`): Zod schemas shared by the routes, the AI
 * tools and the web pages. Calendar dates (purchase, warranty, contract terms) are `YYYY-MM-DD` strings;
 * timestamps use the `dateTime` codec. Money is a number in the record's `currency`.
 *
 * Endpoints:
 * - Hardware: `GET|POST /assets`, `GET|PATCH /assets/:ref`, `POST /assets/:ref/{assign,return,status,dispose}`,
 *   `GET /assets/:ref/{events,software,contracts}`
 * - Software: `GET|POST /licenses`, `GET|PATCH /licenses/:ref`, `GET|POST /licenses/:ref/assignments`,
 *   `DELETE /licenses/:ref/assignments/:id`, `GET /licenses/:ref/installations`, `POST /licenses/:ref/reveal-key`
 * - Discovery: `POST /discovery/software`
 * - Contracts: `GET|POST /contracts`, `GET|PATCH /contracts/:ref`, `POST /contracts/:ref/{renew,cancel}`,
 *   `PUT /contracts/:ref/items`, `GET /contracts/:ref/history`
 * - Catalogue: `GET|POST /vendors`, `GET|PATCH /vendors/:id`, `GET|POST /models`, `PATCH /models/:id`
 * - People: `GET /me/assets`, `GET /people/:userId/holdings`
 * - Overview: `GET /dashboard`, `GET /attention`, `GET /settings`, `GET /lookups/{cis,locations}`
 */
import { dateTime } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  COMPLIANCE_STATES,
  CONTRACT_BILLING,
  CONTRACT_KINDS,
  CONTRACT_STATUSES,
  CONTRACT_VIEWS,
  HARDWARE_VIEWS,
  INSTALL_SOURCES,
  LICENSE_BILLING,
  LICENSE_TYPES,
  RETURN_STATUSES,
} from './model';

export * from './model';

/* ───────────────────────────── primitives ───────────────────────────── */

/** A calendar date, `YYYY-MM-DD`. */
export const dateOnly = z.iso.date();
const id = z.uuid();
const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'ISO 4217 code, e.g. TWD')
  .transform((v) => v.toUpperCase());
const amount = z.number().min(0).max(9_999_999_999.99);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
/** Comma-separated query values (`status=retired,disposed`). */
const csv = <const V extends readonly [string, ...string[]]>(values: V) =>
  z
    .string()
    .max(500)
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)).max(20));

export const assetCategorySchema = z.enum(ASSET_CATEGORIES);
export const assetStatusSchema = z.enum(ASSET_STATUSES);
export const licenseTypeSchema = z.enum(LICENSE_TYPES);
export const licenseBillingSchema = z.enum(LICENSE_BILLING);
export const complianceStateSchema = z.enum(COMPLIANCE_STATES);
export const contractKindSchema = z.enum(CONTRACT_KINDS);
export const contractStatusSchema = z.enum(CONTRACT_STATUSES);
export const contractBillingSchema = z.enum(CONTRACT_BILLING);
export const warrantyStateSchema = z.enum(['none', 'active', 'expiring', 'expired']);

export const personRefSchema = z.object({
  id,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  email: z.string().nullable(),
});
export type PersonRef = z.input<typeof personRefSchema>;

export const namedRefSchema = z.object({ id, name: z.string() });
export type NamedRef = z.input<typeof namedRefSchema>;

export const modelRefSchema = z.object({
  id,
  category: assetCategorySchema,
  manufacturer: z.string(),
  name: z.string(),
});
export type ModelRef = z.input<typeof modelRefSchema>;

export const ciRefSchema = z.object({
  id,
  reference: z.string(),
  name: z.string(),
  status: z.string(),
  className: z.record(z.string(), z.string()).nullable(),
});
export type CiRef = z.input<typeof ciRefSchema>;

export const assetRefSchema = z.object({
  id,
  tag: z.string(),
  name: z.string(),
  category: assetCategorySchema,
  status: assetStatusSchema,
});
export type AssetRef = z.input<typeof assetRefSchema>;

export const licenseRefSchema = z.object({ id, reference: z.string(), product: z.string() });
export const contractRefSchema = z.object({
  id,
  reference: z.string(),
  title: z.string(),
  status: contractStatusSchema,
});

/* ───────────────────────────── hardware ───────────────────────────── */

export const depreciationSchema = z.object({
  lifespanMonths: z.number().int(),
  ageMonths: z.number().int(),
  bookValue: z.number(),
  depreciatedPercent: z.number(),
  fullyDepreciatedOn: dateOnly,
});

export const ASSET_SORT_KEYS = [
  'number',
  'name',
  'category',
  'status',
  'assignee',
  'location',
  'warrantyEnd',
  'purchaseDate',
  'updatedAt',
] as const;

export const assetListItemSchema = z.object({
  id,
  number: z.number().int(),
  tag: z.string(),
  name: z.string(),
  category: assetCategorySchema,
  status: assetStatusSchema,
  model: modelRefSchema.nullable(),
  serialNumber: z.string().nullable(),
  assignee: personRefSchema.nullable(),
  assignedAt: dateTime.nullable(),
  location: z.string().nullable(),
  department: namedRefSchema.nullable(),
  warrantyEnd: dateOnly.nullable(),
  warrantyState: warrantyStateSchema,
  purchaseCost: z.number().nullable(),
  currency: z.string(),
  bookValue: z.number().nullable(),
  ci: z.object({ id, reference: z.string(), name: z.string() }).nullable(),
  updatedAt: dateTime,
});
export type AssetListItem = z.input<typeof assetListItemSchema>;

export const assetViewerSchema = z.object({
  canManage: z.boolean(),
  /** Statuses "Change status" offers (disposal goes through "Request disposal"). */
  transitions: z.array(assetStatusSchema),
  canAssign: z.boolean(),
  canReturn: z.boolean(),
  canDispose: z.boolean(),
  canReadContracts: z.boolean(),
  canReadSoftware: z.boolean(),
});

export const assetDetailSchema = assetListItemSchema.extend({
  vendor: namedRefSchema.nullable(),
  purchaseDate: dateOnly.nullable(),
  invoiceNumber: z.string().nullable(),
  retireOn: dateOnly.nullable(),
  notes: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  depreciation: depreciationSchema.nullable(),
  ciDetail: ciRefSchema.nullable(),
  disposedAt: dateTime.nullable(),
  disposalNote: z.string().nullable(),
  /** The running disposal approval, if any. */
  disposalInstanceId: z.uuid().nullable(),
  viewer: assetViewerSchema,
  createdAt: dateTime,
});
export type AssetDetail = z.input<typeof assetDetailSchema>;

export const assetQuerySchema = listQuerySchema.extend({
  view: z.enum(Object.keys(HARDWARE_VIEWS) as [keyof typeof HARDWARE_VIEWS]).optional(),
  status: csv(ASSET_STATUSES).optional(),
  category: assetCategorySchema.optional(),
  assignee: id.optional(),
  department: id.optional(),
  location: z.string().trim().max(200).optional(),
  model: id.optional(),
  vendor: id.optional(),
  ci: id.optional(),
  warranty: z.enum(['expiring', 'expired']).optional(),
});
export type AssetQuery = z.input<typeof assetQuerySchema>;

const assetFields = {
  name: text(200).min(1),
  category: assetCategorySchema,
  modelId: id.nullish(),
  serialNumber: optionalText(100),
  location: optionalText(200),
  departmentId: id.nullish(),
  ciId: id.nullish(),
  vendorId: id.nullish(),
  purchaseDate: dateOnly.nullish(),
  purchaseCost: amount.nullish(),
  currency: currency.optional(),
  invoiceNumber: optionalText(64),
  warrantyEnd: dateOnly.nullish(),
  retireOn: dateOnly.nullish(),
  notes: optionalText(10_000),
  attributes: z.record(z.string(), z.unknown()).optional(),
};

export const createAssetSchema = z.object({
  ...assetFields,
  /** `ordered` or `in_stock` (default); assign a person afterwards to deploy it. */
  status: z.enum(['ordered', 'in_stock']).optional(),
  /** Deploy straight to this person (status becomes `deployed`). */
  assigneeId: id.nullish(),
});
export type CreateAssetInput = z.input<typeof createAssetSchema>;

/** Every field optional; absent = unchanged. Status and assignment have their own actions. */
export const updateAssetSchema = z.object(assetFields).partial();
export type UpdateAssetInput = z.input<typeof updateAssetSchema>;

export const assignAssetSchema = z.object({ userId: id, note: optionalText(2000) });
export const returnAssetSchema = z.object({
  note: optionalText(2000),
  toStatus: z.enum(RETURN_STATUSES).default('in_stock'),
});
export const assetStatusChangeSchema = z.object({ status: assetStatusSchema, note: optionalText(2000) });
export const disposeAssetSchema = z.object({ note: text(2000).min(1) });

export const assetEventSchema = z.object({
  id,
  kind: z.enum([
    'created',
    'status_changed',
    'assigned',
    'returned',
    'updated',
    'note',
    'return_requested',
    'disposal_requested',
    'disposed',
  ]),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  user: personRefSchema.nullable(),
  actor: z
    .object({ id: id.nullable(), displayName: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
  note: z.string().nullable(),
  createdAt: dateTime,
});
export type AssetEvent = z.input<typeof assetEventSchema>;

export const installationSchema = z.object({
  id,
  asset: assetRefSchema.extend({ assignee: personRefSchema.nullable() }),
  product: z.string(),
  publisher: z.string().nullable(),
  version: z.string().nullable(),
  source: z.enum(INSTALL_SOURCES),
  firstSeenAt: dateTime,
  lastSeenAt: dateTime,
  /** A seat covers it (the device, or for per-user products the device's assignee). */
  licensed: z.boolean(),
  /** A licence of the same product exists (otherwise the product is simply not managed). */
  managed: z.boolean(),
});
export type Installation = z.input<typeof installationSchema>;

export const assetSoftwareSchema = z.object({
  installations: z.array(installationSchema),
  /** Licences assigned to this device. */
  licenses: z.array(
    z.object({
      assignmentId: id,
      license: licenseRefSchema.extend({ licenseType: licenseTypeSchema }),
      assignedAt: dateTime,
    }),
  ),
  /** Licences the device's assignee holds (per user). */
  userLicenses: z.array(licenseRefSchema.extend({ licenseType: licenseTypeSchema })),
});
export type AssetSoftware = z.input<typeof assetSoftwareSchema>;

/* ───────────────────────────── software ───────────────────────────── */

export const LICENSE_SORT_KEYS = [
  'number',
  'product',
  'publisher',
  'type',
  'endDate',
  'compliance',
  'usage',
] as const;

export const licenseListItemSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  product: z.string(),
  publisher: z.string().nullable(),
  vendor: namedRefSchema.nullable(),
  licenseType: licenseTypeSchema,
  quantity: z.number().int().nullable(),
  /** Seats in use (assignments, plus unlicensed installs for per-device licences). */
  used: z.number().int(),
  assigned: z.number().int(),
  unlicensed: z.number().int(),
  cost: z.number().nullable(),
  currency: z.string(),
  billing: licenseBillingSchema,
  annualCost: z.number().nullable(),
  startDate: dateOnly.nullable(),
  endDate: dateOnly.nullable(),
  complianceState: complianceStateSchema,
  contract: contractRefSchema.nullable(),
  updatedAt: dateTime,
});
export type LicenseListItem = z.input<typeof licenseListItemSchema>;

export const licenseDetailSchema = licenseListItemSchema.extend({
  notes: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  hasKey: z.boolean(),
  /** The last characters of the key, for recognising it (`null` without a key). */
  keyHint: z.string().nullable(),
  viewer: z.object({ canManage: z.boolean(), canReveal: z.boolean(), canReadContracts: z.boolean() }),
  createdAt: dateTime,
});
export type LicenseDetail = z.input<typeof licenseDetailSchema>;

export const licenseQuerySchema = listQuerySchema.extend({
  type: licenseTypeSchema.optional(),
  compliance: csv(COMPLIANCE_STATES).optional(),
  vendor: id.optional(),
  contract: id.optional(),
});
export type LicenseQuery = z.input<typeof licenseQuerySchema>;

const licenseFields = {
  product: text(200).min(1),
  publisher: optionalText(200),
  vendorId: id.nullish(),
  licenseType: licenseTypeSchema,
  quantity: z.number().int().min(0).max(10_000_000).nullish(),
  cost: amount.nullish(),
  currency: currency.optional(),
  billing: licenseBillingSchema.optional(),
  startDate: dateOnly.nullish(),
  endDate: dateOnly.nullish(),
  contractId: id.nullish(),
  /** Stored sealed; send `null` to remove it. Never returned. */
  licenseKey: z.string().trim().max(4000).nullish(),
  notes: optionalText(10_000),
  attributes: z.record(z.string(), z.unknown()).optional(),
};

export const createLicenseSchema = z.object(licenseFields);
export type CreateLicenseInput = z.input<typeof createLicenseSchema>;
export const updateLicenseSchema = z.object(licenseFields).partial();
export type UpdateLicenseInput = z.input<typeof updateLicenseSchema>;

export const licenseAssignmentSchema = z.object({
  id,
  user: personRefSchema.nullable(),
  asset: assetRefSchema.extend({ assignee: personRefSchema.nullable() }).nullable(),
  assignedAt: dateTime,
  assignedBy: z.object({ id, displayName: z.string() }).nullable(),
});
export type LicenseAssignment = z.input<typeof licenseAssignmentSchema>;

export const assignmentQuerySchema = listQuerySchema.extend({ target: z.enum(['user', 'asset']).optional() });

export const createAssignmentSchema = z
  .object({ userId: id.optional(), assetId: id.optional() })
  .refine((v) => Boolean(v.userId) !== Boolean(v.assetId), 'Give either userId or assetId');
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;

export const installationQuerySchema = listQuerySchema.extend({ unlicensed: z.stringbool().optional() });

export const revealKeySchema = z.object({ key: z.string() });

/* ───────────────────────────── discovery ───────────────────────────── */

export const discoverySchema = z
  .object({
    assetId: id.optional(),
    assetSerial: z.string().trim().min(1).max(100).optional(),
    products: z
      .array(
        z.object({
          product: text(200).min(1),
          publisher: optionalText(200),
          version: optionalText(64),
        }),
      )
      .max(2000),
    source: z.enum(['api', 'import']).default('api'),
  })
  .refine((v) => Boolean(v.assetId) !== Boolean(v.assetSerial), 'Give either assetId or assetSerial');
export type DiscoveryInput = z.input<typeof discoverySchema>;

export const discoveryResultSchema = z.object({
  asset: assetRefSchema,
  added: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  /** Products installed without a seat, after this report. */
  unlicensed: z.array(z.string()),
});

/* ───────────────────────────── contracts ───────────────────────────── */

export const CONTRACT_SORT_KEYS = [
  'number',
  'title',
  'kind',
  'status',
  'endDate',
  'cost',
  'updatedAt',
] as const;

export const contractListItemSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  title: z.string(),
  vendor: namedRefSchema.nullable(),
  kind: contractKindSchema,
  status: contractStatusSchema,
  startDate: dateOnly.nullable(),
  endDate: dateOnly.nullable(),
  autoRenew: z.boolean(),
  noticeDays: z.number().int(),
  noticeDate: dateOnly.nullable(),
  /** Days until the end (negative once ended), `null` when open-ended. */
  daysToEnd: z.number().int().nullable(),
  cost: z.number().nullable(),
  currency: z.string(),
  billing: contractBillingSchema,
  annualCost: z.number().nullable(),
  owner: personRefSchema.nullable(),
  itemCount: z.number().int(),
  updatedAt: dateTime,
});
export type ContractListItem = z.input<typeof contractListItemSchema>;

export const contractItemSchema = z.object({
  id,
  asset: assetRefSchema.extend({ model: z.string().nullable() }).nullable(),
  license: licenseRefSchema.extend({ licenseType: licenseTypeSchema }).nullable(),
});
export type ContractItem = z.input<typeof contractItemSchema>;

export const contractDetailSchema = contractListItemSchema.extend({
  notes: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  items: z.array(contractItemSchema),
  licenses: z.array(licenseRefSchema),
  lastReminderFor: dateOnly.nullable(),
  /** Today in the company time zone (the renewal timeline marks it). */
  today: dateOnly,
  viewer: z.object({ canManage: z.boolean() }),
  createdAt: dateTime,
});
export type ContractDetail = z.input<typeof contractDetailSchema>;

export const contractQuerySchema = listQuerySchema.extend({
  view: z.enum(CONTRACT_VIEWS).optional(),
  status: csv(CONTRACT_STATUSES).optional(),
  kind: contractKindSchema.optional(),
  vendor: id.optional(),
  owner: id.optional(),
  /** Ending within this window, e.g. `90d`. */
  renewal: z
    .string()
    .regex(/^\d{1,4}d$/)
    .transform((v) => Number(v.slice(0, -1)))
    .optional(),
});
export type ContractQuery = z.input<typeof contractQuerySchema>;

const contractFields = {
  title: text(300).min(1),
  vendorId: id.nullish(),
  kind: contractKindSchema,
  startDate: dateOnly.nullish(),
  endDate: dateOnly.nullish(),
  autoRenew: z.boolean().optional(),
  noticeDays: z.number().int().min(0).max(730).optional(),
  cost: amount.nullish(),
  currency: currency.optional(),
  billing: contractBillingSchema.optional(),
  ownerId: id.nullish(),
  notes: optionalText(20_000),
  attributes: z.record(z.string(), z.unknown()).optional(),
};

export const createContractSchema = z.object({
  ...contractFields,
  /** `draft` keeps it out of reminders until it is signed. */
  draft: z.boolean().optional(),
});
export type CreateContractInput = z.input<typeof createContractSchema>;

export const updateContractSchema = z.object({ ...contractFields, activate: z.boolean() }).partial();
export type UpdateContractInput = z.input<typeof updateContractSchema>;

export const renewContractSchema = z.object({
  startDate: dateOnly.optional(),
  endDate: dateOnly,
  cost: amount.nullish(),
  note: optionalText(2000),
});
export type RenewContractInput = z.input<typeof renewContractSchema>;

export const cancelContractSchema = z.object({ note: optionalText(2000) });

export const contractItemsInputSchema = z.object({
  assetIds: z.array(id).max(2000).default([]),
  licenseIds: z.array(id).max(500).default([]),
});
export type ContractItemsInput = z.input<typeof contractItemsInputSchema>;

export const historyEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actor: z.string().nullable(),
  occurredAt: dateTime,
  changes: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type HistoryEntry = z.input<typeof historyEntrySchema>;

/* ───────────────────────────── vendors & models ───────────────────────────── */

export const vendorSchema = z.object({
  id,
  name: z.string(),
  website: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  counts: z.object({ assets: z.number().int(), licenses: z.number().int(), contracts: z.number().int() }),
  /** Annualised cost of active contracts and licences in the default currency. */
  annualSpend: z.number(),
  updatedAt: dateTime,
});
export type Vendor = z.input<typeof vendorSchema>;

export const vendorDetailSchema = vendorSchema.extend({
  currency: z.string(),
  contracts: z.array(contractListItemSchema),
  licenses: z.array(licenseListItemSchema),
  hardwareSpend12m: z.number(),
});
export type VendorDetail = z.input<typeof vendorDetailSchema>;

export const vendorQuerySchema = listQuerySchema.extend({ active: z.stringbool().optional() });

const vendorFields = {
  name: text(200).min(1),
  website: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullish(),
  contactName: optionalText(200),
  contactEmail: z.email().max(320).nullish(),
  phone: optionalText(50),
  notes: optionalText(5000),
  active: z.boolean().optional(),
};
export const createVendorSchema = z.object(vendorFields);
export type CreateVendorInput = z.input<typeof createVendorSchema>;
export const updateVendorSchema = z.object(vendorFields).partial();

export const modelSchema = z.object({
  id,
  category: assetCategorySchema,
  manufacturer: z.string(),
  name: z.string(),
  partNumber: z.string().nullable(),
  lifespanMonths: z.number().int(),
  active: z.boolean(),
  assetCount: z.number().int(),
  updatedAt: dateTime,
});
export type Model = z.input<typeof modelSchema>;

export const modelQuerySchema = listQuerySchema.extend({
  category: assetCategorySchema.optional(),
  active: z.stringbool().optional(),
});

const modelFields = {
  category: assetCategorySchema,
  manufacturer: text(100).min(1),
  name: text(200).min(1),
  partNumber: optionalText(100),
  /** Defaults by category (laptop 36, desktop 48, server 60, …). */
  lifespanMonths: z.number().int().min(1).max(600).optional(),
  active: z.boolean().optional(),
};
export const createModelSchema = z.object(modelFields);
export type CreateModelInput = z.input<typeof createModelSchema>;
export const updateModelSchema = z.object(modelFields).partial();

/* ───────────────────────────── people, dashboard, settings ───────────────────────────── */

export const myAssetsSchema = z.object({
  devices: z.array(
    assetListItemSchema.extend({
      model: modelRefSchema.nullable(),
      /** When it was handed over. */
      since: dateTime.nullable(),
    }),
  ),
  software: z.array(
    z.object({
      license: licenseRefSchema.extend({ licenseType: licenseTypeSchema, publisher: z.string().nullable() }),
      /** The device the seat is on, for per-device licences. */
      device: assetRefSchema.nullable(),
      assignedAt: dateTime,
      endDate: dateOnly.nullable(),
    }),
  ),
});
export type MyAssets = z.input<typeof myAssetsSchema>;

export const holdingsSchema = z.object({
  assets: z.array(assetListItemSchema),
  /** `null` when the caller can't read software. */
  licenses: z
    .array(licenseRefSchema.extend({ licenseType: licenseTypeSchema, assignedAt: dateTime }))
    .nullable(),
});
export type Holdings = z.input<typeof holdingsSchema>;

const countByStatus = z.record(z.string(), z.number().int());

export const dashboardSchema = z.object({
  currency: z.string(),
  today: dateOnly,
  assets: z.object({
    total: z.number().int(),
    byStatus: countByStatus,
    byCategory: z.array(
      z.object({ category: assetCategorySchema, total: z.number().int(), byStatus: countByStatus }),
    ),
    purchaseCost: z.number(),
    bookValue: z.number(),
  }),
  warranties: z.object({
    expiring30: z.number().int(),
    expiring90: z.number().int(),
    expired: z.number().int(),
  }),
  software: z
    .object({
      total: z.number().int(),
      byState: countByStatus,
      nonCompliant: z.number().int(),
    })
    .nullable(),
  contracts: z
    .object({
      active: z.number().int(),
      renewing90: z.number().int(),
      renewing90AnnualCost: z.number(),
    })
    .nullable(),
  spendByVendor: z.array(z.object({ vendor: namedRefSchema, amount: z.number() })).nullable(),
  attention: z.object({
    warranties: z.array(assetListItemSchema),
    contracts: z.array(contractListItemSchema).nullable(),
    licenses: z.array(licenseListItemSchema).nullable(),
  }),
  /** Records in other currencies, left out of the money totals. */
  otherCurrencies: z.number().int(),
});
export type Dashboard = z.input<typeof dashboardSchema>;

export const attentionSchema = z.object({
  nonCompliantLicenses: z.number().int().nullable(),
  contractsRenewing30: z.number().int().nullable(),
  warrantiesExpiring30: z.number().int().nullable(),
});
export type Attention = z.input<typeof attentionSchema>;

export const itamSettingsSchema = z.object({
  currency: z.string(),
  warrantyDays: z.number().int(),
  underUsedPercent: z.number().int(),
  canEditSettings: z.boolean(),
});
export type ItamSettings = z.input<typeof itamSettingsSchema>;

export const ciLookupSchema = z.object({ items: z.array(ciRefSchema) });

/* ───────────────────────────── AI tools ───────────────────────────── */

export const aiFindAssetsInput = z.object({
  query: z.string().trim().max(200).optional().describe('Asset tag (AST-00042), serial number or name'),
  assignee: z
    .string()
    .trim()
    .max(320)
    .optional()
    .describe('Person the asset is assigned to: user id, username or email'),
  status: assetStatusSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const aiGetAssetInput = z
  .object({
    id: z.uuid().optional(),
    reference: z.string().trim().max(32).optional().describe('Asset tag, e.g. AST-00042'),
    serial: z.string().trim().max(100).optional(),
  })
  .refine(
    (v) => [v.id, v.reference, v.serial].filter(Boolean).length === 1,
    'Give one of id, reference or serial',
  );

export const aiLicenseComplianceInput = z.object({
  product: z.string().trim().max(200).optional().describe('Product name, e.g. "Adobe Acrobat Pro"'),
});

export const aiExpiringContractsInput = z.object({ days: z.number().int().min(1).max(730).default(90) });

/* ───────────────────────────── slots ───────────────────────────── */

/** Props of the `itam.*` contributions are the hosts' contracts; nothing is hosted by this module. */
export const ASSET_RECORD_TYPE = 'itam.asset';
export const LICENSE_RECORD_TYPE = 'itam.license';
export const CONTRACT_RECORD_TYPE = 'itam.contract';
