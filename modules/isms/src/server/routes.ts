/**
 * REST API mounted at /api/v1/isms. Every route declares a permission; routes everyone may use (`isms.self.use`,
 * granted to everyone by default) narrow what they return in the services (`access.ts`): the stocktake items,
 * shared accounts and account reviews that are the caller's own, or everything for readers.
 */
import { departments, groups } from '@isbp/db/schema';
import { likePattern, type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { asc, ilike, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  accountEventSchema,
  accountQuerySchema,
  addReviewItemSchema,
  assetClassSchema,
  assetEventSchema,
  assetExportQuerySchema,
  assetImportReportSchema,
  assetListItemSchema,
  assetQuerySchema,
  assetSchema,
  createAssetSchema,
  createFromRecordsResultSchema,
  createFromRecordsSchema,
  createLabelSchema,
  createReviewSchema,
  createSharedAccountSchema,
  createSiteSchema,
  createStocktakeSchema,
  dashboardSchema,
  decideItemSchema,
  decideManySchema,
  importAssetsSchema,
  importReviewItemsSchema,
  labelSchema,
  lookupItemSchema,
  myStocktakeItemSchema,
  passwordChangedSchema,
  raiseTicketsResultSchema,
  recordItemSchema,
  reviewAccountSchema,
  reviewImportReportSchema,
  reviewItemQuerySchema,
  reviewItemSchema,
  reviewListItemSchema,
  reviewQuerySchema,
  reviewSchema,
  sharedAccountListItemSchema,
  sharedAccountSchema,
  signOffSchema,
  siteSchema,
  sourceRecordSchema,
  sourceSearchQuerySchema,
  stocktakeItemQuerySchema,
  stocktakeItemSchema,
  stocktakeQuerySchema,
  stocktakeSchema,
  taxonomySchema,
  updateAssetSchema,
  updateClassSchema,
  updateLabelSchema,
  updateSharedAccountSchema,
  updateSiteSchema,
  upsertClassSchema,
} from '../contracts';
import { canReadAssets, P } from './access';
import { services } from './services';

const refParams = z.object({ ref: z.string().regex(/^[A-Za-z0-9-]{1,40}$/) });
const idParams = z.object({ id: z.uuid() });
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const localeQuery = z.object({ locale: z.enum(['en', 'zh-TW', 'ja-JP']).optional() });
const lookupQuery = z.object({ q: z.string().trim().max(100).optional() });
const IMPORT_LIMIT = 5 * 1024 * 1024;

export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = () => services(ctx);
  const csv = (
    reply: { header(k: string, v: string): unknown; send(b: string): unknown },
    out: { filename: string; csv: string },
  ) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${out.filename}"`);
    return reply.send(out.csv);
  };

  /* ───────────── taxonomy ───────────── */

  const tax = ['Information security: configuration'];
  app.get(
    '/taxonomy',
    {
      config: { permission: P.assetsRead },
      schema: {
        tags: tax,
        summary: 'Active classes, sites and classification labels',
        response: { 200: taxonomySchema },
      },
    },
    async () => s().taxonomy.taxonomy(false),
  );
  app.get(
    '/config/classes',
    {
      config: { permission: P.configManage },
      schema: {
        tags: tax,
        summary: 'Classes (archived ones too)',
        response: { 200: z.object({ items: z.array(assetClassSchema) }) },
      },
    },
    async () => ({ items: await s().taxonomy.classes(true) }),
  );
  app.post(
    '/config/classes',
    {
      config: { permission: P.configManage },
      schema: {
        tags: tax,
        summary: 'Create a class',
        body: upsertClassSchema,
        response: { 201: assetClassSchema },
      },
    },
    async (req, reply) => reply.code(201).send(await s().taxonomy.createClass(req.body, req.auth)),
  );
  app.patch(
    '/config/classes/:id',
    {
      config: { permission: P.configManage },
      schema: {
        tags: tax,
        summary: 'Change a class',
        params: idParams,
        body: updateClassSchema,
        response: { 200: assetClassSchema },
      },
    },
    async (req) => s().taxonomy.updateClass(req.params.id, req.body, req.auth),
  );
  for (const [path, archived] of [
    ['archive', true],
    ['restore', false],
  ] as const)
    app.post(
      `/config/classes/:id/${path}`,
      {
        config: { permission: P.configManage },
        schema: {
          tags: tax,
          summary: `${path === 'archive' ? 'Archive' : 'Restore'} a class`,
          params: idParams,
          response: { 200: assetClassSchema },
        },
      },
      async (req) => s().taxonomy.setClassArchived(req.params.id, archived, req.auth),
    );
  app.get(
    '/config/sites',
    {
      config: { permission: P.configManage },
      schema: {
        tags: tax,
        summary: 'Sites (archived ones too)',
        response: { 200: z.object({ items: z.array(siteSchema) }) },
      },
    },
    async () => ({ items: await s().taxonomy.sites(true) }),
  );
  app.post(
    '/config/sites',
    {
      config: { permission: P.configManage },
      schema: { tags: tax, summary: 'Create a site', body: createSiteSchema, response: { 201: siteSchema } },
    },
    async (req, reply) => reply.code(201).send(await s().taxonomy.createSite(req.body, req.auth)),
  );
  app.patch(
    '/config/sites/:id',
    {
      config: { permission: P.configManage },
      schema: {
        tags: tax,
        summary: 'Change or archive a site',
        params: idParams,
        body: updateSiteSchema,
        response: { 200: siteSchema },
      },
    },
    async (req) => s().taxonomy.updateSite(req.params.id, req.body, req.auth),
  );
  app.get(
    '/config/labels',
    {
      config: { permission: P.configManage },
      schema: {
        tags: tax,
        summary: 'Classification labels (archived ones too)',
        response: { 200: z.object({ items: z.array(labelSchema) }) },
      },
    },
    async () => ({ items: await s().taxonomy.labels(true) }),
  );
  app.post(
    '/config/labels',
    {
      config: { permission: P.configManage },
      schema: {
        tags: tax,
        summary: 'Create a classification label',
        body: createLabelSchema,
        response: { 201: labelSchema },
      },
    },
    async (req, reply) => reply.code(201).send(await s().taxonomy.createLabel(req.body, req.auth)),
  );
  app.patch(
    '/config/labels/:id',
    {
      config: { permission: P.configManage },
      schema: {
        tags: tax,
        summary: 'Change or archive a classification label',
        params: idParams,
        body: updateLabelSchema,
        response: { 200: labelSchema },
      },
    },
    async (req) => s().taxonomy.updateLabel(req.params.id, req.body, req.auth),
  );

  /* ───────────── lookups ───────────── */

  const look = ['Information security: lookups'];
  app.get(
    '/lookups/groups',
    {
      config: { permission: P.self },
      schema: {
        tags: look,
        summary: 'Groups to pick as asset managers or in a scope',
        querystring: lookupQuery,
        response: { 200: z.object({ items: z.array(lookupItemSchema) }) },
      },
    },
    async (req) => ({
      items: await ctx.db
        .select({ id: groups.id, key: groups.key, name: groups.name })
        .from(groups)
        .where(
          req.query.q
            ? or(ilike(groups.name, likePattern(req.query.q)), ilike(groups.key, likePattern(req.query.q)))
            : ne(groups.key, 'everyone'),
        )
        .orderBy(asc(groups.name))
        .limit(200),
    }),
  );
  app.get(
    '/lookups/departments',
    {
      config: { permission: P.self },
      schema: {
        tags: look,
        summary: 'Departments to pick for a shared account',
        querystring: lookupQuery,
        response: { 200: z.object({ items: z.array(lookupItemSchema) }) },
      },
    },
    async (req) => ({
      items: await ctx.db
        .select({ id: departments.id, key: departments.code, name: departments.name })
        .from(departments)
        .where(req.query.q ? ilike(departments.name, likePattern(req.query.q)) : undefined)
        .orderBy(asc(departments.name))
        .limit(300),
    }),
  );
  app.get(
    '/lookups/applications',
    {
      config: { permission: P.reviewsManage },
      schema: {
        tags: look,
        summary: 'Applications whose role holders you may review',
        response: { 200: z.object({ items: z.array(lookupItemSchema) }) },
      },
    },
    async (req) => s().reviews.applications(req.auth),
  );

  /* ───────────── assets ───────────── */

  const reg = ['Information security: assets'];
  app.get(
    '/assets',
    {
      config: { permission: P.assetsRead },
      schema: {
        tags: reg,
        summary: 'The information asset register',
        querystring: assetQuerySchema,
        response: { 200: pageSchema(assetListItemSchema) },
      },
    },
    async (req) => s().assets.list(req.query, req.auth),
  );
  app.get(
    '/assets/export.csv',
    {
      config: { permission: P.assetsRead },
      schema: {
        tags: reg,
        summary: 'The register as CSV (UTF-8 with BOM, register column order)',
        querystring: assetExportQuerySchema.extend(localeQuery.shape),
      },
    },
    async (req, reply) => {
      const { locale, ...q } = req.query;
      return csv(reply, await s().assets.exportCsv(q, req.auth, locale ?? req.auth.user?.locale ?? 'en'));
    },
  );
  app.post(
    '/assets/import',
    {
      bodyLimit: IMPORT_LIMIT,
      config: { permission: P.assetsManage, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: reg,
        summary: 'Import the register from CSV (dry run by default)',
        body: importAssetsSchema,
        response: { 200: assetImportReportSchema },
      },
    },
    async (req) => s().assets.importCsv(req.body.csv, req.body.dryRun, req.auth),
  );
  app.get(
    '/sources',
    {
      config: { permission: P.assetsManage },
      schema: {
        tags: reg,
        summary: 'Records of other modules to register as assets',
        querystring: sourceSearchQuerySchema,
        response: { 200: z.object({ items: z.array(sourceRecordSchema) }) },
      },
    },
    async (req) => s().assets.sourceSearch(req.query, req.auth),
  );
  app.post(
    '/assets/from-records',
    {
      config: { permission: P.assetsManage },
      schema: {
        tags: reg,
        summary: 'Register assets from other records (linked to them)',
        body: createFromRecordsSchema,
        response: { 200: createFromRecordsResultSchema },
      },
    },
    async (req) => s().assets.createFromRecords(req.body, req.auth),
  );
  app.post(
    '/assets',
    {
      config: { permission: P.assetsManage },
      schema: {
        tags: reg,
        summary: 'Register an asset (numbered per site and class)',
        body: createAssetSchema,
        response: { 201: assetSchema },
      },
    },
    async (req, reply) => {
      const a = await s().assets.create(req.body, req.auth);
      return reply.code(201).send(await s().assets.detailOf(a.id, req.auth));
    },
  );
  app.get(
    '/assets/:ref',
    {
      config: { permission: P.assetsRead },
      schema: {
        tags: reg,
        summary: 'An asset by number or id',
        params: refParams,
        response: { 200: assetSchema },
      },
    },
    async (req) => s().assets.detail(req.params.ref, req.auth),
  );
  app.patch(
    '/assets/:ref',
    {
      config: { permission: P.assetsManage },
      schema: {
        tags: reg,
        summary: 'Change an asset',
        params: refParams,
        body: updateAssetSchema,
        response: { 200: assetSchema },
      },
    },
    async (req) => {
      const a = await s().assets.update(req.params.ref, req.body, req.auth);
      return s().assets.detailOf(a.id, req.auth);
    },
  );
  app.delete(
    '/assets/:ref',
    {
      config: { permission: P.assetsManage },
      schema: {
        tags: reg,
        summary: 'Delete an asset (drops its links and files)',
        params: refParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s().assets.remove(req.params.ref, req.auth);
      return reply.code(204).send();
    },
  );
  app.get(
    '/assets/:ref/events',
    {
      config: { permission: P.assetsRead },
      schema: {
        tags: reg,
        summary: 'The asset’s history, newest first',
        params: refParams,
        querystring: pageQuery,
        response: { 200: pageSchema(assetEventSchema) },
      },
    },
    async (req) => s().assets.events(req.params.ref, req.query, req.auth),
  );

  /* ───────────── stocktakes ───────────── */

  const st = ['Information security: stocktakes'];
  app.get(
    '/stocktakes',
    {
      config: { permission: P.self },
      schema: {
        tags: st,
        summary: 'Stocktakes (all for readers, else those with items of yours)',
        querystring: stocktakeQuerySchema,
        response: { 200: pageSchema(stocktakeSchema) },
      },
    },
    async (req) => s().stocktakes.list(req.query, req.auth),
  );
  app.post(
    '/stocktakes',
    {
      config: { permission: P.stocktakesManage },
      schema: {
        tags: st,
        summary: 'Start (or schedule) a stocktake',
        body: createStocktakeSchema,
        response: { 201: stocktakeSchema },
      },
    },
    async (req, reply) => reply.code(201).send(await s().stocktakes.create(req.body, req.auth)),
  );
  app.get(
    '/stocktake-items/mine',
    {
      config: { permission: P.self },
      schema: {
        tags: st,
        summary: 'Items waiting for you in open stocktakes',
        response: { 200: z.object({ items: z.array(myStocktakeItemSchema) }) },
      },
    },
    async (req) => s().stocktakes.myItems(req.auth),
  );
  app.get(
    '/stocktakes/:ref',
    {
      config: { permission: P.self },
      schema: {
        tags: st,
        summary: 'A stocktake with its progress',
        params: refParams,
        response: { 200: stocktakeSchema },
      },
    },
    async (req) => s().stocktakes.detail(req.params.ref, req.auth),
  );
  app.get(
    '/stocktakes/:ref/items',
    {
      config: { permission: P.self },
      schema: {
        tags: st,
        summary: 'The items (yours only unless you read the register)',
        params: refParams,
        querystring: stocktakeItemQuerySchema,
        response: { 200: pageSchema(stocktakeItemSchema) },
      },
    },
    async (req) => s().stocktakes.items(req.params.ref, req.query, req.auth),
  );
  app.post(
    '/stocktakes/:ref/items/:itemId',
    {
      config: { permission: P.self },
      schema: {
        tags: st,
        summary: 'Record an item: confirmed, changed (with the corrections), missing or disposed',
        params: refParams.extend({ itemId: z.uuid() }),
        body: recordItemSchema,
        response: { 200: stocktakeItemSchema },
      },
    },
    async (req) => s().stocktakes.recordItem(req.params.ref, req.params.itemId, req.body, req.auth),
  );
  app.post(
    '/stocktakes/:ref/sign-off',
    {
      config: { permission: P.stocktakesSignoff },
      schema: {
        tags: st,
        summary: 'Sign off a stocktake whose items are all recorded',
        params: refParams,
        body: signOffSchema,
        response: { 200: stocktakeSchema },
      },
    },
    async (req) => s().stocktakes.signOff(req.params.ref, req.body.note, req.auth),
  );
  app.post(
    '/stocktakes/:ref/cancel',
    {
      config: { permission: P.stocktakesManage },
      schema: {
        tags: st,
        summary: 'Cancel a stocktake',
        params: refParams,
        response: { 200: stocktakeSchema },
      },
    },
    async (req) => s().stocktakes.cancel(req.params.ref, req.auth),
  );
  app.get(
    '/stocktakes/:ref/export.csv',
    {
      config: { permission: P.self },
      schema: { tags: st, summary: 'The results as CSV', params: refParams, querystring: localeQuery },
    },
    async (req, reply) =>
      csv(
        reply,
        await s().stocktakes.exportCsv(
          req.params.ref,
          req.auth,
          req.query.locale ?? req.auth.user?.locale ?? 'en',
        ),
      ),
  );

  /* ───────────── shared accounts ───────────── */

  const acc = ['Information security: shared accounts'];
  app.get(
    '/accounts',
    {
      config: { permission: P.self },
      schema: {
        tags: acc,
        summary: 'Shared accounts (all for readers, else those you look after or use)',
        querystring: accountQuerySchema,
        response: { 200: pageSchema(sharedAccountListItemSchema) },
      },
    },
    async (req) => s().accounts.list(req.query, req.auth),
  );
  app.post(
    '/accounts',
    {
      config: { permission: P.accountsManage },
      schema: {
        tags: acc,
        summary: 'Register a shared account',
        body: createSharedAccountSchema,
        response: { 201: sharedAccountSchema },
      },
    },
    async (req, reply) => {
      const a = await s().accounts.create(req.body, req.auth);
      return reply.code(201).send(await s().accounts.detail(a.id, req.auth));
    },
  );
  app.get(
    '/accounts/:ref',
    {
      config: { permission: P.self },
      schema: {
        tags: acc,
        summary: 'A shared account with its members',
        params: refParams,
        response: { 200: sharedAccountSchema },
      },
    },
    async (req) => s().accounts.detail(req.params.ref, req.auth),
  );
  app.patch(
    '/accounts/:ref',
    {
      config: { permission: P.accountsManage },
      schema: {
        tags: acc,
        summary: 'Change a shared account (members taken off make the password due)',
        params: refParams,
        body: updateSharedAccountSchema,
        response: { 200: sharedAccountSchema },
      },
    },
    async (req) => {
      const a = await s().accounts.update(req.params.ref, req.body, req.auth);
      return s().accounts.detail(a.id, req.auth);
    },
  );
  app.get(
    '/accounts/:ref/events',
    {
      config: { permission: P.self },
      schema: {
        tags: acc,
        summary: 'The account’s history',
        params: refParams,
        querystring: pageQuery,
        response: { 200: pageSchema(accountEventSchema) },
      },
    },
    async (req) => s().accounts.events(req.params.ref, req.query, req.auth),
  );
  app.post(
    '/accounts/:ref/password-changed',
    {
      config: { permission: P.self },
      schema: {
        tags: acc,
        summary: 'Record that the password was changed (custodian)',
        params: refParams,
        body: passwordChangedSchema,
        response: { 200: sharedAccountSchema },
      },
    },
    async (req) => s().accounts.passwordChanged(req.params.ref, req.body, req.auth),
  );
  app.post(
    '/accounts/:ref/review',
    {
      config: { permission: P.self },
      schema: {
        tags: acc,
        summary: 'The yearly review: confirm the members who keep access',
        params: refParams,
        body: reviewAccountSchema,
        response: { 200: sharedAccountSchema },
      },
    },
    async (req) => s().accounts.review(req.params.ref, req.body, req.auth),
  );
  app.delete(
    '/accounts/:ref/members/:userId',
    {
      config: { permission: P.self },
      schema: {
        tags: acc,
        summary: 'Take someone off the list (the password becomes due)',
        params: refParams.extend({ userId: z.uuid() }),
        response: { 200: sharedAccountSchema },
      },
    },
    async (req) => s().accounts.removeMember(req.params.ref, req.params.userId, req.auth),
  );

  /* ───────────── account reviews ───────────── */

  const rv = ['Information security: account reviews'];
  app.get(
    '/reviews',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'Account reviews (all for readers, else yours to review)',
        querystring: reviewQuerySchema,
        response: { 200: pageSchema(reviewListItemSchema) },
      },
    },
    async (req) => s().reviews.list(req.query, req.auth),
  );
  app.post(
    '/reviews',
    {
      config: { permission: P.reviewsManage },
      schema: {
        tags: rv,
        summary: 'Start (or schedule) an account review',
        body: createReviewSchema,
        response: { 201: reviewSchema },
      },
    },
    async (req, reply) => reply.code(201).send(await s().reviews.create(req.body, req.auth)),
  );
  app.get(
    '/reviews/:ref',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'An account review with its progress',
        params: refParams,
        response: { 200: reviewSchema },
      },
    },
    async (req) => s().reviews.detail(req.params.ref, req.auth),
  );
  app.get(
    '/reviews/:ref/items',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'The accounts under review',
        params: refParams,
        querystring: reviewItemQuerySchema,
        response: { 200: pageSchema(reviewItemSchema) },
      },
    },
    async (req) => s().reviews.items(req.params.ref, req.query, req.auth),
  );
  app.post(
    '/reviews/:ref/items',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'Add an account by hand',
        params: refParams,
        body: addReviewItemSchema,
        response: { 201: reviewItemSchema },
      },
    },
    async (req, reply) => reply.code(201).send(await s().reviews.addItem(req.params.ref, req.body, req.auth)),
  );
  app.post(
    '/reviews/:ref/import',
    {
      bodyLimit: IMPORT_LIMIT,
      config: { permission: P.self, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: rv,
        summary: 'Import the system’s account list from CSV (dry run by default)',
        params: refParams,
        body: importReviewItemsSchema,
        response: { 200: reviewImportReportSchema },
      },
    },
    async (req) => s().reviews.importItems(req.params.ref, req.body.csv, req.body.dryRun, req.auth),
  );
  app.post(
    '/reviews/:ref/items/:itemId/decision',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'Decide one account: keep, disable or delete (with the date it was done)',
        params: refParams.extend({ itemId: z.uuid() }),
        body: decideItemSchema,
        response: { 200: reviewItemSchema },
      },
    },
    async (req) =>
      (await s().reviews.decide(req.params.ref, [req.params.itemId], req.body, req.auth)).items[0]!,
  );
  app.post(
    '/reviews/:ref/decisions',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'Decide several accounts at once',
        params: refParams,
        body: decideManySchema,
        response: { 200: z.object({ items: z.array(reviewItemSchema) }) },
      },
    },
    async (req) => {
      const { itemIds, ...decision } = req.body;
      return s().reviews.decide(req.params.ref, itemIds, decision, req.auth);
    },
  );
  app.post(
    '/reviews/:ref/complete',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'Complete the review (every account decided)',
        params: refParams,
        response: { 200: reviewSchema },
      },
    },
    async (req) => s().reviews.complete(req.params.ref, req.auth),
  );
  app.post(
    '/reviews/:ref/reopen',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'Send a completed review back to its reviewer',
        params: refParams,
        response: { 200: reviewSchema },
      },
    },
    async (req) => s().reviews.reopen(req.params.ref, req.auth),
  );
  app.post(
    '/reviews/:ref/sign-off',
    {
      config: { permission: P.reviewsSignoff },
      schema: {
        tags: rv,
        summary: 'Sign off a completed review (schedules the next one when it recurs)',
        params: refParams,
        body: signOffSchema,
        response: { 200: reviewSchema },
      },
    },
    async (req) => s().reviews.signOff(req.params.ref, req.body.note, req.auth),
  );
  app.post(
    '/reviews/:ref/cancel',
    {
      config: { permission: P.reviewsManage },
      schema: { tags: rv, summary: 'Cancel a review', params: refParams, response: { 200: reviewSchema } },
    },
    async (req) => s().reviews.cancel(req.params.ref, req.auth),
  );
  app.post(
    '/reviews/:ref/tickets',
    {
      config: { permission: P.self, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: rv,
        summary: 'Raise a service desk ticket per disable or delete decision without one',
        params: refParams,
        response: { 200: raiseTicketsResultSchema },
      },
    },
    async (req) => s().reviews.raiseTickets(req.params.ref, req.auth),
  );
  app.get(
    '/reviews/:ref/export.csv',
    {
      config: { permission: P.self },
      schema: {
        tags: rv,
        summary: 'The review in the account-review layout as CSV',
        params: refParams,
        querystring: localeQuery,
      },
    },
    async (req, reply) =>
      csv(
        reply,
        await s().reviews.exportCsv(
          req.params.ref,
          req.auth,
          req.query.locale ?? req.auth.user?.locale ?? 'en',
        ),
      ),
  );

  /* ───────────── dashboard ───────────── */

  app.get(
    '/dashboard',
    {
      config: { permission: P.self },
      schema: {
        tags: ['Information security'],
        summary: 'What needs attention: asset values, stocktakes, passwords, reviews',
        response: { 200: dashboardSchema },
      },
    },
    async (req) => {
      const svc = s();
      const [assets, stocktakes, mine, passwordDue, reviews] = await Promise.all([
        canReadAssets(req.auth) ? svc.assets.byValue() : Promise.resolve(null),
        svc.stocktakes.openSummaries(req.auth),
        svc.stocktakes.myItems(req.auth, 500),
        svc.accounts.passwordDueFor(req.auth),
        svc.reviews.inProgress(req.auth),
      ]);
      return { assets, stocktakes, myStocktakeItems: mine.items.length, passwordDue, reviews };
    },
  );
}
