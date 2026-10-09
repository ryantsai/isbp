import { type AuthContext, type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import {
  articleCardSchema,
  articleCountsQuerySchema,
  articleCountsSchema,
  articleLocaleSchema,
  articleListItemSchema,
  articleQuerySchema,
  articleSchema,
  categorySchema,
  classificationsSchema,
  createArticleSchema,
  createCategorySchema,
  feedbackInputSchema,
  feedbackResultSchema,
  searchQuerySchema,
  searchResultSchema,
  submitOutcomeQuerySchema,
  submitOutcomeSchema,
  updateArticleSchema,
  updateCategorySchema,
  versionSchema,
  versionSummarySchema,
} from '../contracts';
import { PERMISSIONS } from '../lifecycle';
import { ArticleService, classificationLevels } from './articles';
import { CategoryService } from './categories';
import { guideArticleRef } from './guide';

const refParams = z.object({ ref: z.string().trim().min(1).max(64).describe('uuid or KB-00042') });
const tags = ['Knowledge'];
const { read: READ, write: WRITE, publish: PUBLISH, manageCategories: MANAGE_CATEGORIES } = PERMISSIONS;

/**
 * REST API mounted at /api/v1/knowledge. Audience and status visibility are enforced in the service
 * for every route (an article the caller can't see is a 404).
 */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const svc = new ArticleService(ctx);
  const cats = new CategoryService(ctx);

  /* ───────────── classification ───────────── */

  app.get(
    '/classifications',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary:
          'The classification labels in use (module setting `classification.levels`), most restrictive first; built-in keys are translated by the client',
        response: { 200: classificationsSchema },
      },
    },
    async () => ({ items: await classificationLevels(ctx) }),
  );

  /* ───────────── articles ───────────── */

  app.get(
    '/articles',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'List articles (published for readers; drafts and reviews for authors and editors)',
        querystring: articleQuerySchema,
        response: { 200: pageSchema(articleListItemSchema) },
      },
    },
    async (req) => svc.list(req.query, req.auth),
  );

  app.get(
    '/articles/counts',
    {
      config: { permission: [READ, WRITE] },
      schema: {
        tags,
        summary:
          'Articles per management tab (my drafts, in review, published, retired, review due) with the list filters',
        querystring: articleCountsQuerySchema,
        response: { 200: articleCountsSchema },
      },
    },
    async (req) => svc.counts(req.query, req.auth),
  );

  app.get(
    '/articles/submit-outcome',
    {
      config: { permission: [READ, WRITE] },
      schema: {
        tags,
        summary:
          'What submitting an article with these facts would do for you: publish it, send it to an editor, or start the approval workflow',
        querystring: submitOutcomeQuerySchema,
        response: { 200: submitOutcomeSchema },
      },
    },
    async (req) => ({ outcome: await svc.submitOutcomeFor(req.query, req.auth) }),
  );

  app.post(
    '/articles',
    {
      config: { permission: [READ, WRITE] },
      schema: {
        tags,
        summary: 'Write a draft article',
        body: createArticleSchema,
        response: { 201: articleSchema },
      },
    },
    async (req, reply) => {
      const row = await svc.create(req.body, req.auth);
      return reply.status(201).send(await svc.detail(row.id, req.auth));
    },
  );

  app.get(
    '/articles/:ref',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Get an article (counts a view of published articles once per reader per day)',
        params: refParams,
        response: { 200: articleSchema },
      },
    },
    async (req) => svc.get(req.params.ref, req.auth, { countView: true }),
  );

  app.patch(
    '/articles/:ref',
    {
      config: { permission: [READ, WRITE] },
      schema: {
        tags,
        summary: 'Edit an article (editing a published article publishes the next version)',
        params: refParams,
        body: updateArticleSchema,
        response: { 200: articleSchema },
      },
    },
    async (req) => {
      const row = await svc.update(req.params.ref, req.body, req.auth);
      return svc.detail(row.id, req.auth);
    },
  );

  const transition = (
    path: string,
    summary: string,
    permission: string[],
    run: (ref: string, auth: AuthContext) => Promise<{ id: string }>,
  ) =>
    app.post(
      `/articles/:ref/${path}`,
      {
        config: { permission },
        schema: { tags, summary, params: refParams, response: { 200: articleSchema } },
      },
      async (req) => {
        const row = await run(req.params.ref, req.auth);
        return svc.detail(row.id, req.auth);
      },
    );

  transition(
    'submit',
    'Submit a draft for review (publishes directly for editors when no approval workflow is bound)',
    [READ, WRITE],
    (ref, auth) => svc.submit(ref, auth),
  );
  transition('withdraw', 'Withdraw an article from review (back to draft)', [READ, WRITE], (ref, auth) =>
    svc.withdraw(ref, auth),
  );
  transition('publish', 'Publish an article that is in review', [READ, PUBLISH], (ref, auth) =>
    svc.publish(ref, auth),
  );
  transition('retire', 'Retire a published article (removed from search)', [READ, PUBLISH], (ref, auth) =>
    svc.retire(ref, auth),
  );
  transition('restore', 'Restore a retired article as a draft', [READ, PUBLISH], (ref, auth) =>
    svc.restore(ref, auth),
  );

  app.delete(
    '/articles/:ref',
    {
      config: { permission: [READ, WRITE] },
      schema: {
        tags,
        summary: 'Delete an article (authors: their drafts; editors: any article)',
        params: refParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await svc.remove(req.params.ref, req.auth);
      return reply.status(204).send();
    },
  );

  app.get(
    '/articles/:ref/versions',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Published versions of an article, newest first',
        params: refParams,
        response: { 200: z.object({ items: z.array(versionSummarySchema) }) },
      },
    },
    async (req) => svc.versions(req.params.ref, req.auth),
  );

  app.get(
    '/articles/:ref/versions/:version',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'One published version of an article',
        params: refParams.extend({ version: z.coerce.number().int().min(1) }),
        response: { 200: versionSchema },
      },
    },
    async (req) => svc.version(req.params.ref, req.params.version, req.auth),
  );

  app.post(
    '/articles/:ref/feedback',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Was this helpful? One vote per reader; voting again updates it',
        params: refParams,
        body: feedbackInputSchema,
        response: { 200: feedbackResultSchema },
      },
    },
    async (req) => svc.feedback(req.params.ref, req.body, req.auth),
  );

  app.get(
    '/articles/:ref/related',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Semantically related articles',
        params: refParams,
        response: { 200: z.object({ items: z.array(articleCardSchema) }) },
      },
    },
    async (req) => svc.related(req.params.ref, req.auth),
  );

  /* ───────────── in-app help ───────────── */

  app.get(
    '/guide/:slug',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: "The user guide's article for an in-app help link, in the caller's language when translated",
        params: z.object({ slug: z.string().trim().min(1).max(64) }),
        querystring: z.object({ locale: articleLocaleSchema.optional() }),
        response: { 200: z.object({ reference: z.string(), href: z.string() }) },
      },
    },
    async (req) =>
      guideArticleRef(ctx, req.params.slug, req.query.locale ?? req.auth.user?.locale ?? null, req.auth),
  );

  /* ───────────── search ───────────── */

  app.get(
    '/search',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Hybrid (semantic + keyword) search of published articles — also used for ticket deflection',
        querystring: searchQuerySchema,
        response: { 200: searchResultSchema },
      },
    },
    async (req) =>
      svc.search(req.query.q, {
        auth: req.auth,
        limit: req.query.limit,
        locale: req.query.locale ?? req.auth.user?.locale ?? null,
      }),
  );

  /* ───────────── categories ───────────── */

  app.get(
    '/categories',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Categories with the number of published articles you can read',
        response: { 200: z.object({ items: z.array(categorySchema) }) },
      },
    },
    async (req) => cats.list(req.auth),
  );

  app.post(
    '/categories',
    {
      config: { permission: MANAGE_CATEGORIES },
      schema: {
        tags,
        summary: 'Create a category',
        body: createCategorySchema,
        response: { 201: categorySchema },
      },
    },
    async (req, reply) => reply.status(201).send(await cats.create(req.body)),
  );

  app.patch(
    '/categories/:id',
    {
      config: { permission: MANAGE_CATEGORIES },
      schema: {
        tags,
        summary: 'Edit a category',
        params: z.object({ id: z.uuid() }),
        body: updateCategorySchema,
        response: { 200: categorySchema },
      },
    },
    async (req) => cats.update(req.params.id, req.body),
  );

  app.delete(
    '/categories/:id',
    {
      config: { permission: MANAGE_CATEGORIES },
      schema: {
        tags,
        summary: 'Delete a category (refused with IN_USE while articles use it)',
        params: z.object({ id: z.uuid() }),
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await cats.remove(req.params.id);
      return reply.status(204).send();
    },
  );
}
