import { departments } from '@isbp/db/schema';
import { ciClasses, cis } from '@isbp/module-cmdb/schema';
import {
  type ModuleContext,
  type ModuleRouter,
  httpErrors,
  likePattern,
  listQuerySchema,
  pageSchema,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  approvedSoftwareExportSchema,
  approvedSoftwareQuerySchema,
  approvedSoftwareSchema,
  assetDetailSchema,
  assetEventSchema,
  assetListItemSchema,
  assetQuerySchema,
  assetSoftwareSchema,
  assetStatusChangeSchema,
  assignAssetSchema,
  assignmentQuerySchema,
  attentionSchema,
  cancelContractSchema,
  ciLookupSchema,
  complianceItemSchema,
  complianceQuerySchema,
  complianceSummarySchema,
  contractDetailSchema,
  contractItemsInputSchema,
  contractListItemSchema,
  contractQuerySchema,
  createApprovedSoftwareSchema,
  createAssetSchema,
  createAssignmentSchema,
  createContractSchema,
  createLicenseSchema,
  createModelSchema,
  createTitleRuleSchema,
  createVendorSchema,
  dashboardSchema,
  discoveredTitleSchema,
  discoveryImportResultSchema,
  discoveryImportSchema,
  discoveryReportSchema,
  discoveryResultSchema,
  discoverySchema,
  disposalPreviewSchema,
  disposeAssetSchema,
  historyEntrySchema,
  holdingsSchema,
  installationQuerySchema,
  installationSchema,
  itamSettingsSchema,
  licenseAssignmentSchema,
  licenseDetailSchema,
  licenseListItemSchema,
  licenseQuerySchema,
  modelQuerySchema,
  modelSchema,
  myAssetsSchema,
  recordWipeSchema,
  renewContractSchema,
  returnAssetSchema,
  revealKeySchema,
  titleRuleQuerySchema,
  titleRuleSchema,
  updateApprovedSoftwareSchema,
  updateAssetSchema,
  updateContractSchema,
  updateLicenseSchema,
  updateModelSchema,
  updateVendorSchema,
  vendorDetailSchema,
  vendorQuerySchema,
  vendorSchema,
} from '../contracts';
import {
  CONFIG_MANAGE,
  CONTRACTS_MANAGE,
  CONTRACTS_READ,
  HARDWARE_MANAGE,
  HARDWARE_READ,
  hardwareFilter,
  LICENSES_REVEAL,
  SELF_READ,
  SOFTWARE_MANAGE,
  SOFTWARE_READ,
} from './access';
import { seatsOf } from './assets';
import { assets } from './schema';
import { services } from './services';
import { itamConfig, requireAny } from './support';

const id = z.uuid();
const refParams = z.object({ ref: z.string().trim().min(1).max(64) });
const idParams = z.object({ id });
const pageQuery = listQuerySchema.pick({ page: true, pageSize: true });

/** Department readers are filtered inside the handler (`hardwareFilter` / `canReadHardware`). */
const HW_READ = { permission: HARDWARE_READ, scoped: true } as const;
const HW_MANAGE = { permission: HARDWARE_MANAGE } as const;
const SW_READ = { permission: SOFTWARE_READ } as const;
const SW_MANAGE = { permission: SOFTWARE_MANAGE } as const;
const CT_READ = { permission: CONTRACTS_READ } as const;
const CT_MANAGE = { permission: CONTRACTS_MANAGE } as const;
const CONFIG = { permission: CONFIG_MANAGE } as const;
/**
 * Every Assets role (and everyone, by default) holds `itam.self.read`; routes that serve several roles
 * (vendor and model pickers, settings) check the real permissions in the handler with `requireAny`.
 */
const MEMBER = { permission: SELF_READ, scoped: true } as const;

/** Readers of vendors: contract people and the catalogue's maintainers. */
const VENDOR_READERS = [CONTRACTS_READ, CONFIG_MANAGE];
/** Readers of the model catalogue: anyone working with hardware. */
const MODEL_READERS = [HARDWARE_READ, HARDWARE_MANAGE, CONFIG_MANAGE];

/** REST API mounted at /api/v1/itam (see the endpoint list in contracts.ts). */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const svc = () => services(ctx);
  const hw = ['Assets: hardware'];
  const sw = ['Assets: software'];
  const ct = ['Assets: contracts'];
  const cat = ['Assets: vendors and models'];
  const misc = ['Assets'];

  /* ───────────────────────────── hardware ───────────────────────────── */

  app.get(
    '/assets',
    {
      config: HW_READ,
      schema: {
        tags: hw,
        summary: 'Hardware assets in your reach (department readers: their departments and their people)',
        querystring: assetQuerySchema,
        response: { 200: pageSchema(assetListItemSchema) },
      },
    },
    async (req) => svc().assets.list(req.query, req.auth),
  );

  app.post(
    '/assets',
    {
      config: HW_MANAGE,
      schema: {
        tags: hw,
        summary: 'Register an asset (optionally deployed straight to a person)',
        body: createAssetSchema,
        response: { 201: assetDetailSchema },
      },
    },
    async (req, reply) => {
      const row = await svc().assets.create(req.body, req.auth);
      return reply.status(201).send(await svc().assets.detailById(row.id, req.auth));
    },
  );

  app.get(
    '/assets/:ref',
    {
      config: HW_READ,
      schema: {
        tags: hw,
        summary: 'An asset by id or tag (AST-00042)',
        params: refParams,
        response: { 200: assetDetailSchema },
      },
    },
    async (req) => svc().assets.detail(req.params.ref, req.auth),
  );

  app.patch(
    '/assets/:ref',
    {
      config: HW_MANAGE,
      schema: {
        tags: hw,
        summary: 'Edit identity, location, finance, CI link or custom fields',
        params: refParams,
        body: updateAssetSchema,
        response: { 200: assetDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().assets.update(req.params.ref, req.body, req.auth);
      return svc().assets.detailById(row.id, req.auth);
    },
  );

  app.post(
    '/assets/:ref/assign',
    {
      config: HW_MANAGE,
      schema: {
        tags: hw,
        summary: 'Hand the asset to a person (it becomes deployed; they are notified)',
        params: refParams,
        body: assignAssetSchema,
        response: { 200: assetDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().assets.assign(req.params.ref, req.body, req.auth);
      return svc().assets.detailById(row.id, req.auth);
    },
  );

  app.post(
    '/assets/:ref/return',
    {
      config: HW_MANAGE,
      schema: {
        tags: hw,
        summary: 'Take the asset back (to stock, or to repair)',
        params: refParams,
        body: returnAssetSchema,
        response: { 200: assetDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().assets.returnAsset(req.params.ref, req.body, req.auth);
      return svc().assets.detailById(row.id, req.auth);
    },
  );

  app.post(
    '/assets/:ref/status',
    {
      config: HW_MANAGE,
      schema: {
        tags: hw,
        summary: 'Move the asset along its lifecycle (INVALID_TRANSITION lists the allowed statuses)',
        params: refParams,
        body: assetStatusChangeSchema,
        response: { 200: assetDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().assets.changeStatus(req.params.ref, req.body, req.auth);
      return svc().assets.detailById(row.id, req.auth);
    },
  );

  app.post(
    '/assets/:ref/wipe',
    {
      config: HW_MANAGE,
      schema: {
        tags: hw,
        summary:
          'Record data wipe: who wiped the device’s storage, when and how (clears the pending wipe; audited)',
        params: refParams,
        body: recordWipeSchema,
        response: { 200: assetDetailSchema },
      },
    },
    async (req) => {
      const a = await svc().assets.recordWipe(req.params.ref, req.body, req.auth);
      return svc().assets.detailById(a.id, req.auth);
    },
  );

  app.get(
    '/assets/:ref/disposal-preview',
    {
      config: HW_MANAGE,
      schema: {
        tags: hw,
        summary:
          'Who would approve a disposal request now: a dry run of the bound disposal workflow with the asset’s facts',
        params: refParams,
        response: { 200: disposalPreviewSchema },
      },
    },
    async (req) => svc().assets.disposalPreview(req.params.ref, req.auth),
  );

  app.post(
    '/assets/:ref/dispose',
    {
      config: HW_MANAGE,
      schema: {
        tags: hw,
        summary: 'Request disposal of a retired asset (starts the disposal approval)',
        params: refParams,
        body: disposeAssetSchema,
        response: { 200: assetDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().assets.requestDisposal(req.params.ref, req.body, req.auth);
      return svc().assets.detailById(row.id, req.auth);
    },
  );

  app.get(
    '/assets/:ref/events',
    {
      config: HW_READ,
      schema: {
        tags: hw,
        summary: 'Lifecycle timeline, newest first',
        params: refParams,
        querystring: pageQuery,
        response: { 200: pageSchema(assetEventSchema) },
      },
    },
    async (req) => svc().assets.events(req.params.ref, req.query, req.auth),
  );

  app.get(
    '/assets/:ref/software',
    {
      config: HW_READ,
      schema: {
        tags: hw,
        summary: 'Installed software (unlicensed flagged) and the licences of the device and its user',
        params: refParams,
        response: { 200: assetSoftwareSchema },
      },
    },
    async (req) => {
      const row = await svc().assets.readable(req.params.ref, req.auth);
      const [installs, seats] = await Promise.all([
        svc().licenses.installations({ assetId: row.asset.id }, { page: 1, pageSize: 500 }),
        seatsOf(ctx.db, row.asset.id, row.asset.assignedTo),
      ]);
      const fmt = (s: { id: string; number: number; product: string; licenseType: string }) => ({
        id: s.id,
        reference: `LIC-${String(s.number).padStart(5, '0')}`,
        product: s.product,
        licenseType: s.licenseType as 'per_user',
      });
      return {
        installations: installs.items,
        licenses: seats.deviceSeats.map((s) => ({
          assignmentId: s.assignmentId,
          assignedAt: s.assignedAt,
          license: fmt(s),
        })),
        userLicenses: seats.userSeats.map(fmt),
      };
    },
  );

  app.get(
    '/assets/:ref/contracts',
    {
      config: { permission: [HARDWARE_READ, CONTRACTS_READ], scoped: true },
      schema: {
        tags: hw,
        summary: 'Contracts covering the asset',
        params: refParams,
        response: { 200: z.object({ items: z.array(contractListItemSchema) }) },
      },
    },
    async (req) => {
      req.auth.require(CONTRACTS_READ);
      const row = await svc().assets.readable(req.params.ref, req.auth);
      return { items: await svc().contracts.coveringAsset(row.asset.id) };
    },
  );

  /* ───────────────────────────── software ───────────────────────────── */

  app.get(
    '/licenses',
    {
      config: SW_READ,
      schema: {
        tags: sw,
        summary: 'Software licences with usage and compliance',
        querystring: licenseQuerySchema,
        response: { 200: pageSchema(licenseListItemSchema) },
      },
    },
    async (req) => svc().licenses.list(req.query),
  );

  app.post(
    '/licenses',
    {
      config: SW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Add a licence (the key is sealed and never returned)',
        body: createLicenseSchema,
        response: { 201: licenseDetailSchema },
      },
    },
    async (req, reply) => {
      const row = await svc().licenses.create(req.body, req.auth);
      return reply.status(201).send(await svc().licenses.detailOf(row.id, req.auth));
    },
  );

  app.get(
    '/licenses/:ref',
    {
      config: SW_READ,
      schema: {
        tags: sw,
        summary: 'A licence by id or reference (LIC-00012)',
        params: refParams,
        response: { 200: licenseDetailSchema },
      },
    },
    async (req) => svc().licenses.detail(req.params.ref, req.auth),
  );

  app.patch(
    '/licenses/:ref',
    {
      config: SW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Edit a licence (quantity changes recompute compliance)',
        params: refParams,
        body: updateLicenseSchema,
        response: { 200: licenseDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().licenses.update(req.params.ref, req.body, req.auth);
      return svc().licenses.detailOf(row.id, req.auth);
    },
  );

  app.get(
    '/licenses/:ref/assignments',
    {
      config: SW_READ,
      schema: {
        tags: sw,
        summary: 'Seats: the people and devices holding this licence',
        params: refParams,
        querystring: assignmentQuerySchema,
        response: { 200: pageSchema(licenseAssignmentSchema) },
      },
    },
    async (req) => svc().licenses.assignments(req.params.ref, req.query),
  );

  app.post(
    '/licenses/:ref/assignments',
    {
      config: SW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Give a seat to a person or a device',
        params: refParams,
        body: createAssignmentSchema,
        response: { 201: z.object({ id }) },
      },
    },
    async (req, reply) => {
      const row = await svc().licenses.assign(req.params.ref, req.body, req.auth);
      return reply.status(201).send({ id: row.id });
    },
  );

  app.delete(
    '/licenses/:ref/assignments/:id',
    {
      config: SW_MANAGE,
      schema: { tags: sw, summary: 'Take a seat back', params: refParams.extend({ id }) },
    },
    async (req, reply) => {
      await svc().licenses.unassign(req.params.ref, req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  app.get(
    '/licenses/:ref/installations',
    {
      config: SW_READ,
      schema: {
        tags: sw,
        summary: 'Devices with the product installed; unlicensed ones first',
        params: refParams,
        querystring: installationQuerySchema,
        response: { 200: pageSchema(installationSchema) },
      },
    },
    async (req) => {
      const l = await svc().licenses.resolve(req.params.ref);
      return svc().licenses.installations({ product: l.product }, req.query);
    },
  );

  app.post(
    '/licenses/:ref/reveal-key',
    {
      config: { permission: [SOFTWARE_READ, LICENSES_REVEAL] },
      schema: {
        tags: sw,
        summary: 'Reveal the licence key (audited)',
        params: refParams,
        response: { 200: revealKeySchema },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return svc().licenses.revealKey(req.params.ref, req.auth);
    },
  );

  /* ───────────────────────────── discovery ───────────────────────────── */

  app.post(
    '/discovery/software',
    {
      config: HW_MANAGE,
      schema: {
        tags: sw,
        summary:
          "An inventory tool reports a device's complete software list: products are upserted, earlier products missing from the report are removed (manual entries are kept)",
        body: discoverySchema,
        response: { 200: discoveryResultSchema },
      },
    },
    async (req) => svc().discovery.discover(req.body, req.auth),
  );

  app.post(
    '/discovery/import',
    {
      config: HW_MANAGE,
      schema: {
        tags: sw,
        summary:
          'Imports devices from an inventory tool’s CSV export (parsed by the client; whole devices, at most 100 per request): each device is a complete report, like /discovery/software',
        body: discoveryImportSchema,
        response: { 200: discoveryImportResultSchema },
      },
    },
    async (req) => svc().discovery.importDevices(req.body, req.auth),
  );

  app.get(
    '/discovery/reports',
    {
      config: HW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Software reports per device (API and CSV imports), newest first',
        querystring: listQuerySchema.extend({ source: z.enum(['api', 'import']).optional() }),
        response: { 200: pageSchema(discoveryReportSchema) },
      },
    },
    async (req) => svc().discovery.reports(req.query, req.auth),
  );

  app.get(
    '/discovery/titles',
    {
      config: HW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Discovered titles that match no licence’s product and have no rule, most widespread first',
        querystring: listQuerySchema,
        response: { 200: pageSchema(discoveredTitleSchema) },
      },
    },
    async (req) => svc().discovery.titles(req.query, req.auth),
  );

  app.get(
    '/discovery/rules',
    {
      config: HW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Title rules: discovered titles counted as a licence’s product, or ignored',
        querystring: titleRuleQuerySchema,
        response: { 200: pageSchema(titleRuleSchema) },
      },
    },
    async (req) => svc().discovery.rules(req.query, req.auth),
  );

  app.post(
    '/discovery/rules',
    {
      config: SW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Map a discovered title to a licence (licenseId) or ignore it (licenseId null)',
        body: createTitleRuleSchema,
        response: { 201: titleRuleSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await svc().discovery.createRule(req.body, req.auth)),
  );

  app.delete(
    '/discovery/rules/:id',
    {
      config: SW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Remove a title rule (a mapped title’s installs go back to the reported title)',
        params: z.object({ id }),
      },
    },
    async (req, reply) => {
      await svc().discovery.deleteRule(req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  app.get(
    '/discovery/compliance',
    {
      config: HW_MANAGE,
      schema: {
        tags: sw,
        summary:
          'Installs on devices in use that the approved-software list doesn’t cover for the device’s department (unapproved) or blocks',
        querystring: complianceQuerySchema,
        response: { 200: pageSchema(complianceItemSchema) },
      },
    },
    async (req) => svc().approvedSoftware.compliance(req.query, req.auth),
  );

  app.get(
    '/discovery/compliance/summary',
    {
      config: HW_MANAGE,
      schema: {
        tags: sw,
        summary: 'How many installs are unapproved or blocked, on how many devices',
        response: { 200: complianceSummarySchema },
      },
    },
    async (req) => svc().approvedSoftware.summary(req.auth),
  );

  /* ───────────────────────────── approved software ───────────────────────────── */

  app.get(
    '/approved-software',
    {
      config: SW_READ,
      schema: {
        tags: sw,
        summary: 'The approved-software list (allow and block list)',
        querystring: approvedSoftwareQuerySchema,
        response: { 200: pageSchema(approvedSoftwareSchema) },
      },
    },
    async (req) => svc().approvedSoftware.list(req.query, req.auth),
  );

  app.get(
    '/approved-software/export',
    {
      config: SW_READ,
      schema: {
        tags: sw,
        summary:
          'The list as CSV (UTF-8 with BOM) in the software whitelist layout, with the filters of the list',
        querystring: approvedSoftwareExportSchema,
      },
    },
    async (req, reply) => {
      const { locale, ...q } = req.query;
      const lang = locale ?? (req.auth.user?.locale as 'en' | 'zh-TW' | 'ja-JP' | undefined) ?? 'en';
      const body = await svc().approvedSoftware.exportCsv(
        { ...q },
        req.auth,
        lang === 'zh-TW' || lang === 'ja-JP' ? lang : 'en',
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="approved-software-${new Date().toISOString().slice(0, 10)}.csv"`,
        )
        .header('cache-control', 'no-store')
        .send(body);
    },
  );

  app.post(
    '/approved-software',
    {
      config: SW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Add a title to the list (allowed or blocked; company-wide or for departments)',
        body: createApprovedSoftwareSchema,
        response: { 201: approvedSoftwareSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await svc().approvedSoftware.create(req.body, req.auth)),
  );

  app.get(
    '/approved-software/:id',
    {
      config: SW_READ,
      schema: {
        tags: sw,
        summary: 'One approved-software entry',
        params: idParams,
        response: { 200: approvedSoftwareSchema },
      },
    },
    async (req) => svc().approvedSoftware.get(req.params.id, req.auth),
  );

  app.patch(
    '/approved-software/:id',
    {
      config: SW_MANAGE,
      schema: {
        tags: sw,
        summary: 'Change an entry (absent fields stay as they are)',
        params: idParams,
        body: updateApprovedSoftwareSchema,
        response: { 200: approvedSoftwareSchema },
      },
    },
    async (req) => svc().approvedSoftware.update(req.params.id, req.body, req.auth),
  );

  app.delete(
    '/approved-software/:id',
    {
      config: SW_MANAGE,
      schema: { tags: sw, summary: 'Remove an entry from the list', params: idParams },
    },
    async (req, reply) => {
      await svc().approvedSoftware.remove(req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  /* ───────────────────────────── contracts ───────────────────────────── */

  app.get(
    '/contracts',
    {
      config: CT_READ,
      schema: {
        tags: ct,
        summary: 'Contracts (views: active, renewing, expired; `renewal=90d` = ending within 90 days)',
        querystring: contractQuerySchema,
        response: { 200: pageSchema(contractListItemSchema) },
      },
    },
    async (req) => svc().contracts.list(req.query),
  );

  app.post(
    '/contracts',
    {
      config: CT_MANAGE,
      schema: {
        tags: ct,
        summary: 'Add a contract',
        body: createContractSchema,
        response: { 201: contractDetailSchema },
      },
    },
    async (req, reply) => {
      const row = await svc().contracts.create(req.body, req.auth);
      return reply.status(201).send(await svc().contracts.detailOf(row.id, req.auth));
    },
  );

  app.get(
    '/contracts/:ref',
    {
      config: CT_READ,
      schema: {
        tags: ct,
        summary: 'A contract by id or number (CTR-00007) with what it covers',
        params: refParams,
        response: { 200: contractDetailSchema },
      },
    },
    async (req) => svc().contracts.detail(req.params.ref, req.auth),
  );

  app.patch(
    '/contracts/:ref',
    {
      config: CT_MANAGE,
      schema: {
        tags: ct,
        summary: 'Edit a contract (`activate` turns a draft into a live contract)',
        params: refParams,
        body: updateContractSchema,
        response: { 200: contractDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().contracts.update(req.params.ref, req.body, req.auth);
      return svc().contracts.detailOf(row.id, req.auth);
    },
  );

  app.post(
    '/contracts/:ref/renew',
    {
      config: CT_MANAGE,
      schema: {
        tags: ct,
        summary: 'Renew: a new term (start defaults to the day after the current end), optionally a new cost',
        params: refParams,
        body: renewContractSchema,
        response: { 200: contractDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().contracts.renew(req.params.ref, req.body, req.auth);
      return svc().contracts.detailOf(row.id, req.auth);
    },
  );

  app.post(
    '/contracts/:ref/cancel',
    {
      config: CT_MANAGE,
      schema: {
        tags: ct,
        summary: 'Cancel a contract (no more reminders or renewals)',
        params: refParams,
        body: cancelContractSchema,
        response: { 200: contractDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().contracts.cancel(req.params.ref, req.body, req.auth);
      return svc().contracts.detailOf(row.id, req.auth);
    },
  );

  app.put(
    '/contracts/:ref/items',
    {
      config: CT_MANAGE,
      schema: {
        tags: ct,
        summary: 'Replace the assets and licences the contract covers',
        params: refParams,
        body: contractItemsInputSchema,
        response: { 200: contractDetailSchema },
      },
    },
    async (req) => {
      const row = await svc().contracts.setItems(req.params.ref, req.body, req.auth);
      return svc().contracts.detailOf(row.id, req.auth);
    },
  );

  app.get(
    '/contracts/:ref/history',
    {
      config: CT_READ,
      schema: {
        tags: ct,
        summary: "The contract's history (renewals, edits, reminders)",
        params: refParams,
        response: { 200: z.object({ items: z.array(historyEntrySchema) }) },
      },
    },
    async (req) => svc().contracts.history(req.params.ref),
  );

  /* ───────────────────────────── vendors & models ───────────────────────────── */

  app.get(
    '/vendors',
    {
      config: MEMBER,
      schema: {
        tags: cat,
        summary: 'Vendors with counts and annual spend (contracts readers and catalogue maintainers)',
        querystring: vendorQuerySchema,
        response: { 200: pageSchema(vendorSchema) },
      },
    },
    async (req) => {
      requireAny(req.auth, VENDOR_READERS);
      return svc().catalog.listVendors(req.query);
    },
  );

  app.post(
    '/vendors',
    {
      config: CONFIG,
      schema: {
        tags: cat,
        summary: 'Add a vendor',
        body: createVendorSchema,
        response: { 201: vendorDetailSchema },
      },
    },
    async (req, reply) => {
      const row = await svc().catalog.createVendor(req.body, req.auth);
      return reply.status(201).send(await svc().catalog.vendor(row.id));
    },
  );

  app.get(
    '/vendors/:id',
    {
      config: MEMBER,
      schema: {
        tags: cat,
        summary: 'A vendor with its contracts, licences and spend',
        params: idParams,
        response: { 200: vendorDetailSchema },
      },
    },
    async (req) => {
      requireAny(req.auth, VENDOR_READERS);
      const vendor = await svc().catalog.vendor(req.params.id);
      // Licences are only listed for people who may read software.
      return req.auth.can(SOFTWARE_READ) ? vendor : { ...vendor, licenses: [] };
    },
  );

  app.patch(
    '/vendors/:id',
    {
      config: CONFIG,
      schema: {
        tags: cat,
        summary: 'Edit a vendor',
        params: idParams,
        body: updateVendorSchema,
        response: { 200: vendorDetailSchema },
      },
    },
    async (req) => {
      await svc().catalog.updateVendor(req.params.id, req.body, req.auth);
      return svc().catalog.vendor(req.params.id);
    },
  );

  app.get(
    '/models',
    {
      config: MEMBER,
      schema: {
        tags: cat,
        summary: 'The hardware model catalogue',
        querystring: modelQuerySchema,
        response: { 200: pageSchema(modelSchema) },
      },
    },
    async (req) => {
      requireAny(req.auth, MODEL_READERS);
      return svc().catalog.listModels(req.query);
    },
  );

  app.post(
    '/models',
    {
      config: CONFIG,
      schema: { tags: cat, summary: 'Add a model', body: createModelSchema, response: { 201: modelSchema } },
    },
    async (req, reply) => {
      const row = await svc().catalog.createModel(req.body, req.auth);
      return reply.status(201).send(await svc().catalog.model(row.id));
    },
  );

  app.patch(
    '/models/:id',
    {
      config: CONFIG,
      schema: {
        tags: cat,
        summary: 'Edit a model',
        params: idParams,
        body: updateModelSchema,
        response: { 200: modelSchema },
      },
    },
    async (req) => {
      await svc().catalog.updateModel(req.params.id, req.body, req.auth);
      return svc().catalog.model(req.params.id);
    },
  );

  /* ───────────────────────────── people ───────────────────────────── */

  app.get(
    '/me/assets',
    {
      config: { permission: SELF_READ },
      schema: {
        tags: misc,
        summary: 'My devices and software',
        response: { 200: myAssetsSchema },
      },
    },
    async (req) => {
      const me = req.auth.user?.id;
      if (!me) throw httpErrors.forbidden('My devices is for people');
      const [devices, software] = await Promise.all([svc().assets.mine(me), svc().licenses.heldBy(me)]);
      return { devices, software };
    },
  );

  app.get(
    '/people/:userId/holdings',
    {
      config: HW_READ,
      schema: {
        tags: misc,
        summary: "A person's assets (within your reach) and, for software readers, their licences",
        params: z.object({ userId: id }),
        response: { 200: holdingsSchema },
      },
    },
    async (req) => {
      const [held, seats] = await Promise.all([
        svc().assets.heldBy(req.params.userId, req.auth),
        req.auth.can(SOFTWARE_READ) ? svc().licenses.heldBy(req.params.userId) : Promise.resolve(null),
      ]);
      return {
        assets: held,
        licenses: seats
          ? seats.filter((s) => !s.device).map((s) => ({ ...s.license, assignedAt: s.assignedAt }))
          : null,
      };
    },
  );

  /* ───────────────────────────── overview ───────────────────────────── */

  app.get(
    '/dashboard',
    {
      config: HW_READ,
      schema: { tags: misc, summary: 'KPIs and series for the overview', response: { 200: dashboardSchema } },
    },
    async (req) => svc().dashboard.overview(req.auth),
  );

  app.get(
    '/attention',
    {
      config: MEMBER,
      schema: {
        tags: misc,
        summary: 'What needs an asset manager today (counts per area you can read)',
        response: { 200: attentionSchema },
      },
    },
    async (req) => {
      requireAny(req.auth, [HARDWARE_READ, SOFTWARE_READ, CONTRACTS_READ]);
      return svc().dashboard.attention(req.auth);
    },
  );

  app.get(
    '/settings',
    {
      config: MEMBER,
      schema: { tags: misc, summary: 'Effective module settings', response: { 200: itamSettingsSchema } },
    },
    async (req) => {
      const cfg = await itamConfig(ctx);
      return { ...cfg, canEditSettings: req.auth.can('core.modules.manage') };
    },
  );

  app.get(
    '/lookups/cis',
    {
      config: HW_MANAGE,
      schema: {
        tags: misc,
        summary: 'CMDB configuration items to link an asset to (name or CI number)',
        querystring: z.object({ q: z.string().trim().max(200).default('') }),
        response: { 200: ciLookupSchema },
      },
    },
    async (req) => {
      const q = req.query.q;
      const ci = /^ci-?(\d{1,12})$/i.exec(q);
      const rows = await ctx.db
        .select({
          id: cis.id,
          number: cis.number,
          name: cis.name,
          status: cis.status,
          className: ciClasses.name,
        })
        .from(cis)
        .innerJoin(ciClasses, eq(ciClasses.key, cis.classKey))
        .where(
          q
            ? or(ilike(cis.name, likePattern(q)), ci ? eq(cis.number, Number(ci[1])) : undefined)
            : sql`${cis.classKey} in ('server', 'network-device', 'storage', 'database', 'end-user-device')`,
        )
        .orderBy(asc(cis.name))
        .limit(15);
      return {
        items: rows.map((r) => ({
          id: r.id,
          reference: `CI-${String(r.number).padStart(5, '0')}`,
          name: r.name,
          status: r.status,
          className: r.className as Record<string, string>,
        })),
      };
    },
  );

  app.get(
    '/lookups/locations',
    {
      config: HW_READ,
      schema: {
        tags: misc,
        summary: 'Locations in use (for filters and suggestions)',
        response: { 200: z.object({ items: z.array(z.string()) }) },
      },
    },
    async (req) => {
      const rows = await ctx.db
        .selectDistinct({ location: assets.location })
        .from(assets)
        .where(and(isNotNull(assets.location), hardwareFilter(req.auth)))
        .orderBy(asc(assets.location))
        .limit(200);
      return { items: rows.map((r) => r.location!) };
    },
  );

  app.get(
    '/lookups/departments',
    {
      config: MEMBER,
      schema: {
        tags: misc,
        summary: 'Departments (for the asset form and filters)',
        response: { 200: z.object({ items: z.array(z.object({ id, name: z.string(), code: z.string() })) }) },
      },
    },
    async (req) => {
      requireAny(req.auth, MODEL_READERS);
      const rows = await ctx.db
        .select({ id: departments.id, name: departments.name, code: departments.code })
        .from(departments)
        .orderBy(asc(departments.path))
        .limit(1000);
      return { items: rows };
    },
  );
}
