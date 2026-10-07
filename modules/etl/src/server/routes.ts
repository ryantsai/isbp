import { dbConnectionSummarySchema } from '@isbp/contracts';
import { catalogSchema } from '@isbp/contracts';
import { apiClients } from '@isbp/db/schema';
import { type DbConnectionInfo, type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import {
  apiClientRefSchema,
  callDetailSchema,
  callerSchema,
  callQuerySchema,
  callSchema,
  createEndpointSchema,
  endpointDetailSchema,
  endpointQuerySchema,
  endpointStatsSchema,
  endpointSummarySchema,
  pipelineDetailSchema,
  pipelineInputSchema,
  pipelineQuerySchema,
  pipelineSummarySchema,
  pipelineUpdateSchema,
  previewResultSchema,
  previewSchema,
  publishSchema,
  runDetailSchema,
  runQuerySchema,
  runSchema,
  statsQuerySchema,
  testRequestSchema,
  testResultSchema,
  updateEndpointSchema,
  versionActionSchema,
} from '../contracts';
import { buildOpenApi } from '../model';
import { ENDPOINTS_MANAGE, ENDPOINTS_READ, PIPELINES_MANAGE, PIPELINES_READ, PIPELINES_RUN } from './access';
import { callableEndpoints, invocationRoutes, openApiInfo } from './invoke';
import { services } from './services';

const refParams = z.object({ ref: z.string().trim().min(1).max(64) });
const idParams = z.object({ id: z.uuid() });
const runParams = idParams.extend({ runId: z.uuid() });
const versionParams = refParams.extend({
  version: z.coerce.number().int().min(1),
  action: versionActionSchema,
});
const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

const summary = (c: DbConnectionInfo) => ({
  id: c.id,
  key: c.key,
  name: c.name,
  engine: c.engine,
  database: c.database,
  readOnly: c.readOnly,
  enabled: c.enabled,
  status: c.status,
});

/**
 * REST API mounted at /api/v1/etl. Every route declares a permission. The callers' side (`/data/…`,
 * `/openapi.json`) lives in `invoke.ts`.
 */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = services(ctx);
  const ep = ['Data APIs'];
  const pl = ['ETL pipelines'];

  invocationRoutes(app, ctx);

  /* ───────────── connection pickers (one per editor: permissions are all-of) ───────────── */

  const connectionRoutes = (prefix: string, permission: string, tags: string[]) => {
    app.get(
      `${prefix}/connections`,
      {
        config: { permission },
        schema: {
          tags,
          summary: 'Enabled database connections that allow data use (no credentials)',
          response: { 200: items(dbConnectionSummarySchema) },
        },
      },
      async () => ({
        items: (await ctx.databases.list({ purpose: 'data', enabledOnly: true })).map(summary),
      }),
    );
    app.get(
      `${prefix}/connections/:id/catalog`,
      {
        config: { permission },
        schema: {
          tags,
          summary: "Tables, views and routines the connection's login can see (cached 5 minutes)",
          params: idParams,
          querystring: z.object({ refresh: z.stringbool().optional() }),
          response: { 200: catalogSchema },
        },
      },
      async (req) => ctx.databases.catalog(req.params.id, { purpose: 'data', refresh: req.query.refresh }),
    );
  };
  connectionRoutes('', ENDPOINTS_MANAGE, ep);
  connectionRoutes('/pipelines', PIPELINES_MANAGE, pl);

  app.get(
    '/clients',
    {
      config: { permission: ENDPOINTS_MANAGE },
      schema: {
        tags: ep,
        summary: 'API clients for the endpoint allow-list',
        response: { 200: items(apiClientRefSchema) },
      },
    },
    async () => ({
      items: (
        await ctx.db
          .select({
            id: apiClients.id,
            name: apiClients.name,
            clientId: apiClients.clientId,
            revokedAt: apiClients.revokedAt,
          })
          .from(apiClients)
          .orderBy(asc(apiClients.name))
      ).map((c) => ({ id: c.id, name: c.name, clientId: c.clientId, revoked: c.revokedAt !== null })),
    }),
  );

  /* ───────────── endpoints ───────────── */

  app.get(
    '/endpoints',
    {
      config: { permission: ENDPOINTS_READ },
      schema: {
        tags: ep,
        summary: 'Data APIs (filters: q, status, connection)',
        querystring: endpointQuerySchema,
        response: { 200: pageSchema(endpointSummarySchema) },
      },
    },
    async (req) => s.endpoints.list(req.query),
  );

  app.get(
    '/endpoints/openapi.json',
    {
      config: { permission: ENDPOINTS_READ },
      schema: {
        tags: ep,
        summary: 'OpenAPI 3.1 of every published Data API (for readers; callers use /openapi.json)',
      },
    },
    async () => buildOpenApi(await callableEndpoints(ctx, null), openApiInfo),
  );

  app.post(
    '/endpoints',
    {
      config: { permission: ENDPOINTS_MANAGE },
      schema: {
        tags: ep,
        summary: 'Create a Data API (an empty draft on a data connection)',
        body: createEndpointSchema,
        response: { 201: endpointDetailSchema },
      },
    },
    async (req, reply) => {
      const row = await s.endpoints.create(req.body, req.auth);
      return reply.status(201).send(await s.endpoints.detail(row, req.auth));
    },
  );

  app.get(
    '/endpoints/:ref',
    {
      config: { permission: ENDPOINTS_READ },
      schema: {
        tags: ep,
        summary: 'A Data API by id or slug: draft, versions, access',
        params: refParams,
        response: { 200: endpointDetailSchema },
      },
    },
    async (req) => s.endpoints.detail(req.params.ref, req.auth),
  );

  app.patch(
    '/endpoints/:ref',
    {
      config: { permission: ENDPOINTS_MANAGE },
      schema: {
        tags: ep,
        summary: 'Edit the draft, access or settings (published versions never change)',
        params: refParams,
        body: updateEndpointSchema,
        response: { 200: endpointDetailSchema },
      },
    },
    async (req) => s.endpoints.detail(await s.endpoints.update(req.params.ref, req.body), req.auth),
  );

  app.delete(
    '/endpoints/:ref',
    {
      config: { permission: ENDPOINTS_MANAGE },
      schema: { tags: ep, summary: 'Delete a Data API with its versions and log', params: refParams },
    },
    async (req, reply) => {
      await s.endpoints.remove(req.params.ref);
      return reply.status(204).send();
    },
  );

  app.post(
    '/endpoints/:ref/test',
    {
      config: { permission: ENDPOINTS_MANAGE },
      schema: {
        tags: ep,
        summary: 'Test console: run the draft (or a version) and see rows, columns, time and bound SQL',
        params: refParams,
        body: testRequestSchema,
        response: { 200: testResultSchema },
      },
    },
    async (req) => s.endpoints.test(req.params.ref, req.body),
  );

  app.post(
    '/endpoints/:ref/publish',
    {
      config: { permission: ENDPOINTS_MANAGE },
      schema: {
        tags: ep,
        summary: 'Publish the tested draft as a new version (409 TEST_REQUIRED otherwise)',
        params: refParams,
        body: publishSchema,
        response: { 200: endpointDetailSchema },
      },
    },
    async (req) => {
      await s.endpoints.publish(req.params.ref, req.body.note, req.auth);
      return s.endpoints.detail(req.params.ref, req.auth);
    },
  );

  app.post(
    '/endpoints/:ref/versions/:version/:action',
    {
      config: { permission: ENDPOINTS_MANAGE },
      schema: {
        tags: ep,
        summary: 'Deprecate, retire or restore a version, or load it into the draft',
        params: versionParams,
        response: { 200: endpointDetailSchema },
      },
    },
    async (req) => {
      await s.endpoints.versionAction(req.params.ref, req.params.version, req.params.action);
      return s.endpoints.detail(req.params.ref, req.auth);
    },
  );

  app.get(
    '/endpoints/:ref/stats',
    {
      config: { permission: ENDPOINTS_READ },
      schema: {
        tags: ep,
        summary: 'Calls, error rate and p95 latency over 24 hours (hourly) or 7 days (daily)',
        params: refParams,
        querystring: statsQuerySchema,
        response: { 200: endpointStatsSchema },
      },
    },
    async (req) => s.endpoints.stats(req.params.ref, req.query.period),
  );

  /* ───────────── execution log ───────────── */

  app.get(
    '/calls',
    {
      config: { permission: ENDPOINTS_READ },
      schema: {
        tags: ep,
        summary: 'Execution log (filters: endpoint, status ok/error, caller, period)',
        querystring: callQuerySchema,
        response: { 200: pageSchema(callSchema) },
      },
    },
    async (req) => s.calls.list(req.query),
  );

  app.get(
    '/calls/callers',
    {
      config: { permission: ENDPOINTS_READ },
      schema: {
        tags: ep,
        summary: 'People and API clients that called in the last 30 days',
        response: { 200: items(callerSchema) },
      },
    },
    async () => ({ items: await s.calls.callers() }),
  );

  app.get(
    '/calls/:id',
    {
      config: { permission: ENDPOINTS_READ },
      schema: {
        tags: ep,
        summary: 'One logged call with its full error',
        params: idParams,
        response: { 200: callDetailSchema },
      },
    },
    async (req) => s.calls.get(req.params.id),
  );

  /* ───────────── pipelines ───────────── */

  app.get(
    '/pipelines',
    {
      config: { permission: PIPELINES_READ },
      schema: {
        tags: pl,
        summary: 'ETL pipelines with their latest run (filters: q, status of the latest run, enabled)',
        querystring: pipelineQuerySchema,
        response: { 200: pageSchema(pipelineSummarySchema) },
      },
    },
    async (req) => s.pipelines.list(req.query),
  );

  app.post(
    '/pipelines',
    {
      config: { permission: PIPELINES_MANAGE },
      schema: {
        tags: pl,
        summary: 'Create a pipeline (validated against the target catalog)',
        body: pipelineInputSchema,
        response: { 201: pipelineDetailSchema },
      },
    },
    async (req, reply) => {
      const row = await s.pipelines.create(req.body, req.auth);
      return reply.status(201).send(await s.pipelines.detail(row, req.auth));
    },
  );

  app.post(
    '/pipelines/preview',
    {
      config: { permission: PIPELINES_MANAGE },
      schema: {
        tags: pl,
        summary: 'Run the source SQL read-only and return 10 rows (for the column mapping)',
        body: previewSchema,
        response: { 200: previewResultSchema },
      },
    },
    async (req) => s.pipelines.preview(req.body),
  );

  app.get(
    '/pipelines/:id',
    {
      config: { permission: PIPELINES_READ },
      schema: { tags: pl, summary: 'A pipeline', params: idParams, response: { 200: pipelineDetailSchema } },
    },
    async (req) => s.pipelines.detail(req.params.id, req.auth),
  );

  app.patch(
    '/pipelines/:id',
    {
      config: { permission: PIPELINES_MANAGE },
      schema: {
        tags: pl,
        summary: 'Edit a pipeline (validated against the target catalog)',
        params: idParams,
        body: pipelineUpdateSchema,
        response: { 200: pipelineDetailSchema },
      },
    },
    async (req) => s.pipelines.detail(await s.pipelines.update(req.params.id, req.body), req.auth),
  );

  app.delete(
    '/pipelines/:id',
    {
      config: { permission: PIPELINES_MANAGE },
      schema: { tags: pl, summary: 'Delete a pipeline and its run history', params: idParams },
    },
    async (req, reply) => {
      await s.pipelines.remove(req.params.id);
      return reply.status(204).send();
    },
  );

  app.post(
    '/pipelines/:id/run',
    {
      config: { permission: PIPELINES_RUN },
      schema: {
        tags: pl,
        summary: 'Run now: queue a manual run (409 JOB_RUNNING while one is running)',
        params: idParams,
        response: { 202: runSchema },
      },
    },
    async (req, reply) => {
      const run = await s.pipelines.runNow(req.params.id, req.auth);
      return reply.status(202).send(s.pipelines.runDto(run, new Map()));
    },
  );

  app.get(
    '/pipelines/:id/runs',
    {
      config: { permission: PIPELINES_READ },
      schema: {
        tags: pl,
        summary: 'Runs of a pipeline, newest first',
        params: idParams,
        querystring: runQuerySchema,
        response: { 200: pageSchema(runSchema) },
      },
    },
    async (req) => s.pipelines.runs(req.params.id, req.query),
  );

  app.get(
    '/pipelines/:id/runs/:runId',
    {
      config: { permission: PIPELINES_READ },
      schema: {
        tags: pl,
        summary: 'A run with its progress and log',
        params: runParams,
        response: { 200: runDetailSchema },
      },
    },
    async (req) => s.pipelines.run(req.params.id, req.params.runId, req.auth),
  );

  app.post(
    '/pipelines/:id/runs/:runId/cancel',
    {
      config: { permission: PIPELINES_RUN },
      schema: {
        tags: pl,
        summary: 'Cancel a queued or running run (the load is rolled back)',
        params: runParams,
        response: { 200: runDetailSchema },
      },
    },
    async (req) => {
      await s.pipelines.cancel(req.params.id, req.params.runId);
      return s.pipelines.run(req.params.id, req.params.runId, req.auth);
    },
  );
}
