import { createdAt, departments, id, updatedAt, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ApprovalScope,
  ApprovalStatus,
  AssetCategory,
  AssetStatus,
  ComplianceState,
  ContractBilling,
  ContractKind,
  ContractStatus,
  InstallSource,
  LicenseBilling,
  LicenseModel,
  LicenseType,
  WipeMethod,
} from '../model';

/**
 * All tables of the asset-management module live in the `itam` Postgres schema. Every syncable table has
 * a stable uuid and `updated_at`, and the fields an external asset system maps (serial, name, model,
 * status, assignee, location, purchase, warranty) are plain columns, so a Phase 5 sync adapter can match
 * records by serial number and map statuses without parsing JSON.
 */
export const itamSchema = pgSchema('itam');

/** Human numbers: `AST-00042`, `LIC-00012`, `CTR-00007`. */
export const assetNumberSeq = itamSchema.sequence('asset_number_seq');
export const licenseNumberSeq = itamSchema.sequence('license_number_seq');
export const contractNumberSeq = itamSchema.sequence('contract_number_seq');

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });
const day = (name: string) => date(name, { mode: 'string' });

export const vendors = itamSchema.table(
  'vendors',
  {
    id: id(),
    name: varchar('name', { length: 200 }).notNull(),
    website: varchar('website', { length: 500 }),
    contactName: varchar('contact_name', { length: 200 }),
    contactEmail: varchar('contact_email', { length: 320 }),
    phone: varchar('phone', { length: 50 }),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('vendors_name_uq').on(sql`lower(${t.name})`),
    index('vendors_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

/** The hardware catalogue (what can be bought), with the depreciation period. */
export const models = itamSchema.table(
  'models',
  {
    id: id(),
    category: varchar('category', { length: 20 }).$type<AssetCategory>().notNull(),
    manufacturer: varchar('manufacturer', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    partNumber: varchar('part_number', { length: 100 }),
    lifespanMonths: integer('lifespan_months').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('models_manufacturer_name_uq').on(sql`lower(${t.manufacturer})`, sql`lower(${t.name})`),
    index('models_category_idx').on(t.category),
    check('models_lifespan_positive', sql`${t.lifespanMonths} > 0`),
  ],
);

/** Hardware through its lifecycle. */
export const assets = itamSchema.table(
  'assets',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('itam.asset_number_seq')`),
    /** Hostname or friendly name. */
    name: varchar('name', { length: 200 }).notNull(),
    category: varchar('category', { length: 20 }).$type<AssetCategory>().notNull(),
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    serialNumber: varchar('serial_number', { length: 100 }),
    status: varchar('status', { length: 20 }).$type<AssetStatus>().notNull().default('in_stock'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    location: varchar('location', { length: 200 }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    /** The CMDB configuration item this asset is (servers, network gear). Read-only reference. */
    ciId: uuid('ci_id').references(() => cis.id, { onDelete: 'set null' }),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    purchaseDate: day('purchase_date'),
    purchaseCost: money('purchase_cost'),
    currency: char('currency', { length: 3 }).notNull().default('TWD'),
    invoiceNumber: varchar('invoice_number', { length: 64 }),
    warrantyEnd: day('warranty_end'),
    retireOn: day('retire_on'),
    notes: text('notes'),
    /** Custom fields (`itam.asset`), validated against `core.custom_fields`. */
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    disposedAt: timestamp('disposed_at', { withTimezone: true }),
    disposalNote: text('disposal_note'),
    /** The running `itam.disposal` approval (cleared once it completes). */
    disposalInstanceId: uuid('disposal_instance_id'),
    /** The warranty end date the expiry digest already covered (once per asset and date). */
    warrantyNotifiedFor: day('warranty_notified_for'),
    /** Returned device: the date its data must be kept until (from the return, e.g. a request's answer). */
    dataRetainUntil: day('data_retain_until'),
    /** The date its storage must be wiped by (retention + the configured months); cleared by "Record data wipe". */
    wipeDue: day('wipe_due'),
    /** Reminders sent for the pending wipe: 0 none, 1 "due soon", 2 "overdue" (reset when `wipe_due` changes). */
    wipeReminders: smallint('wipe_reminders').notNull().default(0),
    /** The last recorded wipe. */
    wipedAt: timestamp('wiped_at', { withTimezone: true }),
    wipedBy: uuid('wiped_by').references(() => users.id, { onDelete: 'set null' }),
    wipeMethod: varchar('wipe_method', { length: 30 }).$type<WipeMethod>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assets_number_uq').on(t.number),
    uniqueIndex('assets_serial_uq')
      .on(sql`lower(${t.serialNumber})`)
      .where(sql`${t.serialNumber} is not null`),
    index('assets_status_category_idx').on(t.status, t.category),
    index('assets_assigned_to_idx').on(t.assignedTo),
    index('assets_department_idx').on(t.departmentId),
    index('assets_warranty_end_idx').on(t.warrantyEnd),
    index('assets_model_idx').on(t.modelId),
    index('assets_vendor_idx').on(t.vendorId),
    index('assets_ci_idx').on(t.ciId),
    index('assets_updated_idx').on(t.updatedAt),
    index('assets_name_idx').on(t.name),
    index('assets_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
    index('assets_serial_trgm').using('gin', t.serialNumber.op('gin_trgm_ops')),
    index('assets_location_idx').on(t.location),
    index('assets_attributes_gin').using('gin', t.attributes.op('jsonb_path_ops')),
    index('assets_wipe_due_idx')
      .on(t.wipeDue)
      .where(sql`${t.wipeDue} is not null`),
  ],
);

export type AssetEventKind =
  | 'created'
  | 'status_changed'
  | 'assigned'
  | 'returned'
  | 'updated'
  | 'note'
  | 'return_requested'
  | 'disposal_requested'
  | 'disposed'
  | 'wipe_scheduled'
  | 'data_wiped';

/** The request (form submission) behind a lifecycle step a process action made, e.g. the signed agreement. */
export interface AssetEventRequest {
  /** The process action run (idempotency: one run makes its steps once). */
  runId: string;
  submissionId: string;
  /** `REQ-01042`. */
  reference: string;
  formKey: string;
}

/** The lifecycle timeline of an asset. */
export const assetEvents = itamSchema.table(
  'asset_events',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 30 }).$type<AssetEventKind>().notNull(),
    fromValue: varchar('from_value', { length: 200 }),
    toValue: varchar('to_value', { length: 200 }),
    /** The person the step is about (the assignee handed the asset or returning it). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Who did it (a person); system and agent principals are named in `actor_name`. */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: varchar('actor_name', { length: 200 }),
    note: text('note'),
    /** Made by a sync with another system: where it came from ("via ServiceDesk Plus #1234"). */
    via: jsonb('via').$type<{
      connectionId: string;
      connection: string;
      connector: string;
      ref: string;
      url: string | null;
    }>(),
    /** Made by a request form's process action: the request (shown as a link on the history). */
    request: jsonb('request').$type<AssetEventRequest>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('asset_events_asset_idx').on(t.assetId, t.createdAt),
    index('asset_events_run_idx')
      .on(sql`(${t.request}->>'runId')`)
      .where(sql`${t.request} is not null`),
  ],
);

export const contracts = itamSchema.table(
  'contracts',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('itam.contract_number_seq')`),
    title: varchar('title', { length: 300 }).notNull(),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 20 }).$type<ContractKind>().notNull(),
    /** Kept current by the daily job and by renew/cancel. */
    status: varchar('status', { length: 20 }).$type<ContractStatus>().notNull().default('active'),
    startDate: day('start_date'),
    endDate: day('end_date'),
    autoRenew: boolean('auto_renew').notNull().default(false),
    noticeDays: integer('notice_days').notNull().default(60),
    cost: money('cost'),
    currency: char('currency', { length: 3 }).notNull().default('TWD'),
    billing: varchar('billing', { length: 20 }).$type<ContractBilling>().notNull().default('annual'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** Markdown. */
    notes: text('notes'),
    /** Custom fields (`itam.contract`). */
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    /** The end date the last renewal reminder was about (so reminders don't repeat). */
    lastReminderFor: day('last_reminder_for'),
    lastRemindedOn: day('last_reminded_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('contracts_number_uq').on(t.number),
    index('contracts_status_end_idx').on(t.status, t.endDate),
    index('contracts_end_idx').on(t.endDate),
    index('contracts_vendor_idx').on(t.vendorId),
    index('contracts_owner_idx').on(t.ownerId),
    index('contracts_kind_idx').on(t.kind),
    index('contracts_updated_idx').on(t.updatedAt),
    index('contracts_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
    index('contracts_attributes_gin').using('gin', t.attributes.op('jsonb_path_ops')),
    check('contracts_notice_days', sql`${t.noticeDays} >= 0`),
  ],
);

/** Software entitlements. */
export const licenses = itamSchema.table(
  'licenses',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('itam.license_number_seq')`),
    /** The name installs are matched by (case-insensitive), e.g. "Microsoft 365 E3". */
    product: varchar('product', { length: 200 }).notNull(),
    publisher: varchar('publisher', { length: 200 }),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    licenseType: varchar('license_type', { length: 20 }).$type<LicenseType>().notNull(),
    /** Entitlements; null = unlimited / site licence. */
    quantity: integer('quantity'),
    cost: money('cost'),
    currency: char('currency', { length: 3 }).notNull().default('TWD'),
    billing: varchar('billing', { length: 20 }).$type<LicenseBilling>().notNull().default('annual'),
    startDate: day('start_date'),
    /** Expiry or renewal; null = perpetual. */
    endDate: day('end_date'),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
    /** Sealed with the platform master key (`ctx.secrets`); never returned in lists. */
    licenseKeySealed: text('license_key_sealed'),
    /** Stored; recomputed with every assignment or quantity change and nightly. */
    complianceState: varchar('compliance_state', { length: 20 })
      .$type<ComplianceState>()
      .notNull()
      .default('compliant'),
    notes: text('notes'),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('licenses_number_uq').on(t.number),
    index('licenses_product_idx').on(sql`lower(${t.product})`),
    index('licenses_product_trgm').using('gin', t.product.op('gin_trgm_ops')),
    index('licenses_compliance_idx').on(t.complianceState),
    index('licenses_end_idx').on(t.endDate),
    index('licenses_vendor_idx').on(t.vendorId),
    index('licenses_contract_idx').on(t.contractId),
    index('licenses_updated_idx').on(t.updatedAt),
    check('licenses_quantity', sql`${t.quantity} is null or ${t.quantity} >= 0`),
  ],
);

/** A seat: a licence given to exactly one person or one device. */
export const licenseAssignments = itamSchema.table(
  'license_assignments',
  {
    id: id(),
    licenseId: uuid('license_id')
      .notNull()
      .references(() => licenses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('license_assignments_one_target', sql`(${t.userId} is null) <> (${t.assetId} is null)`),
    uniqueIndex('license_assignments_user_uq')
      .on(t.licenseId, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex('license_assignments_asset_uq')
      .on(t.licenseId, t.assetId)
      .where(sql`${t.assetId} is not null`),
    index('license_assignments_user_idx').on(t.userId),
    index('license_assignments_asset_idx').on(t.assetId),
  ],
);

/** What discovery tools (or people) report as installed on a device. */
export const softwareInstallations = itamSchema.table(
  'software_installations',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    product: varchar('product', { length: 200 }).notNull(),
    /**
     * The title the inventory tool reported, when a title rule counts it as a licence's product (`product` then
     * holds the licence's product). Removing the rule restores it.
     */
    reportedAs: varchar('reported_as', { length: 200 }),
    publisher: varchar('publisher', { length: 200 }),
    version: varchar('version', { length: 64 }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    source: varchar('source', { length: 10 }).$type<InstallSource>().notNull().default('manual'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('software_installations_asset_product_uq').on(t.assetId, sql`lower(${t.product})`),
    index('software_installations_product_idx').on(sql`lower(${t.product})`),
    index('software_installations_reported_as_idx')
      .on(sql`lower(${t.reportedAs})`)
      .where(sql`${t.reportedAs} is not null`),
    index('software_installations_seen_idx').on(t.lastSeenAt.desc()),
  ],
);

/**
 * One software report for one device: from an inventory tool (`POST /discovery/software`) or a CSV import, which
 * goes through the same discovery service. The Discovery page lists them, newest first.
 */
export const discoveryReports = itamSchema.table(
  'discovery_reports',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 10 }).$type<'api' | 'import'>().notNull(),
    /** The CSV file a person imported (source `import`). */
    fileName: varchar('file_name', { length: 255 }),
    reported: integer('reported').notNull(),
    added: integer('added').notNull(),
    updated: integer('updated').notNull(),
    removed: integer('removed').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** API clients and agents (no person). */
    actorName: varchar('actor_name', { length: 200 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('discovery_reports_created_idx').on(t.createdAt.desc()),
    index('discovery_reports_asset_idx').on(t.assetId),
  ],
);

/**
 * A decision about a discovered title that matches no licence's product: count it as that licence's product
 * (`licenseId`), or ignore it (`licenseId` null: needs no licence, e.g. a free tool). One rule per title.
 */
export const softwareTitleRules = itamSchema.table(
  'software_title_rules',
  {
    id: id(),
    title: varchar('title', { length: 200 }).notNull(),
    licenseId: uuid('license_id').references(() => licenses.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('software_title_rules_title_uq').on(sql`lower(${t.title})`),
    index('software_title_rules_license_idx').on(t.licenseId),
    index('software_title_rules_created_idx').on(t.createdAt.desc()),
  ],
);

/**
 * The approved-software list (allow list / block list, "software whitelist"): a title (optionally one version) that
 * may or must not be installed, company-wide or for some departments, optionally until a date (short-term use).
 * Discovered installs are checked against it (`server/approved-software.ts`).
 */
export const approvedSoftware = itamSchema.table(
  'approved_software',
  {
    id: id(),
    title: varchar('title', { length: 200 }).notNull(),
    publisher: varchar('publisher', { length: 200 }),
    /** `null` = any version; otherwise this version and more precise ones (`23` covers `23.01`). */
    version: varchar('version', { length: 64 }),
    licenseModel: varchar('license_model', { length: 20 }).$type<LicenseModel>().notNull(),
    /** The licence record holding the serial number or seats (paid software). */
    licenseId: uuid('license_id').references(() => licenses.id, { onDelete: 'set null' }),
    /** The contract (subscription, purchase) it is used under. */
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
    scope: varchar('scope', { length: 12 }).$type<ApprovalScope>().notNull().default('company'),
    status: varchar('status', { length: 10 }).$type<ApprovalStatus>().notNull().default('allowed'),
    /** Short-term approvals end on this day (inclusive); `null` = permanent. */
    validUntil: day('valid_until'),
    notes: text('notes'),
    /** The request it was approved with, e.g. `REQ-01042` (a software install request). */
    requestReference: varchar('request_reference', { length: 40 }),
    /** Added or extended by a request form's process action (`itam.approve-software`): the last run. */
    source: jsonb('source').$type<AssetEventRequest>(),
    /** The valid-until date the expiry digest already covered (once per entry and date). */
    expiryNotifiedFor: day('expiry_notified_for'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('approved_software_title_idx').on(sql`lower(${t.title})`),
    index('approved_software_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
    index('approved_software_status_idx').on(t.status, t.validUntil),
    index('approved_software_valid_until_idx')
      .on(t.validUntil)
      .where(sql`${t.validUntil} is not null`),
    index('approved_software_license_idx').on(t.licenseId),
    index('approved_software_contract_idx').on(t.contractId),
    index('approved_software_updated_idx').on(t.updatedAt.desc()),
    index('approved_software_run_idx')
      .on(sql`(${t.source}->>'runId')`)
      .where(sql`${t.source} is not null`),
  ],
);

/** The departments an entry with scope `departments` applies to. */
export const approvedSoftwareDepartments = itamSchema.table(
  'approved_software_departments',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => approvedSoftware.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.departmentId] }),
    index('approved_software_departments_dept_idx').on(t.departmentId),
  ],
);

/** What a contract covers: exactly one asset or one licence per row. */
export const contractItems = itamSchema.table(
  'contract_items',
  {
    id: id(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'cascade' }),
    licenseId: uuid('license_id').references(() => licenses.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('contract_items_one_target', sql`(${t.assetId} is null) <> (${t.licenseId} is null)`),
    uniqueIndex('contract_items_asset_uq')
      .on(t.contractId, t.assetId)
      .where(sql`${t.assetId} is not null`),
    uniqueIndex('contract_items_license_uq')
      .on(t.contractId, t.licenseId)
      .where(sql`${t.licenseId} is not null`),
    index('contract_items_asset_idx').on(t.assetId),
    index('contract_items_license_idx').on(t.licenseId),
  ],
);

export type VendorRow = typeof vendors.$inferSelect;
export type ModelRow = typeof models.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type AssetEventRow = typeof assetEvents.$inferSelect;
export type LicenseRow = typeof licenses.$inferSelect;
export type AssignmentRow = typeof licenseAssignments.$inferSelect;
export type InstallationRow = typeof softwareInstallations.$inferSelect;
export type DiscoveryReportRow = typeof discoveryReports.$inferSelect;
export type TitleRuleRow = typeof softwareTitleRules.$inferSelect;
export type ContractRow = typeof contracts.$inferSelect;
export type ContractItemRow = typeof contractItems.$inferSelect;
export type ApprovedSoftwareRow = typeof approvedSoftware.$inferSelect;
