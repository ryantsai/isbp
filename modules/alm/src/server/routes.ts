import { departments, groups } from '@isbp/db/schema';
import { formatCiNumber } from '@isbp/module-cmdb/model';
import { cis } from '@isbp/module-cmdb/schema';
import { likePattern, type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  appDetailSchema,
  appQuerySchema,
  appSummarySchema,
  calendarQuerySchema,
  changeUsageSchema,
  ciApplicationSchema,
  createAppSchema,
  createDeploymentSchema,
  createEnvironmentSchema,
  createReleaseSchema,
  createRepositorySchema,
  dashboardSchema,
  deploymentQuerySchema,
  deploymentSchema,
  doraSchema,
  environmentSchema,
  finishDeploymentSchema,
  lookupItemSchema,
  lookupQuerySchema,
  metricsQuerySchema,
  policyCheckSchema,
  policyQuerySchema,
  readinessQuerySchema,
  readinessSchema,
  recordedDeploymentSchema,
  releaseDetailSchema,
  releaseQuerySchema,
  releaseStatusChangeSchema,
  releaseSummarySchema,
  reorderSchema,
  repositorySchema,
  updateAppSchema,
  updateEnvironmentSchema,
  updateReleaseSchema,
  updateRepositorySchema,
} from '../contracts';
import { DEPLOY, MANAGE, READ } from './access';
import { services } from './services';

/** An application's code (`erp`) or id. */
const codeParams = z.object({ code: z.string().trim().min(1).max(64) });
const codeIdParams = codeParams.extend({ id: z.uuid() });
const idParams = z.object({ id: z.uuid() });
const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/**
 * REST API mounted at /api/v1/alm. Every route declares a permission; routes that owners may use with only
 * `alm.apps.read` check the ownership rule in the service (`AppAccess`), so API clients, AI tools and a
 * future sync adapter meet the same rules as the UI.
 */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = services(ctx);
  const apps = ['Applications'];
  const rel = ['Releases'];
  const dep = ['Deployments'];

  /* ───────────── applications ───────────── */

  app.get(
    '/applications',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'List applications (filters: q, stage, criticality, hosting, owner=me, team; sort)',
        querystring: appQuerySchema,
        response: { 200: pageSchema(appSummarySchema) },
      },
    },
    async (req) => s.apps.list(req.query, req.auth),
  );

  app.post(
    '/applications',
    {
      config: { permission: MANAGE },
      schema: {
        tags: apps,
        summary: 'Add an application to the inventory',
        body: createAppSchema,
        response: { 201: appDetailSchema },
      },
    },
    async (req, reply) => {
      const created = await s.apps.create(req.body, req.auth);
      return reply.status(201).send(await s.apps.detail(created.id, req.auth));
    },
  );

  app.get(
    '/applications/:code',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Get an application by code (or id) with environments, repositories and what you may do',
        params: codeParams,
        response: { 200: appDetailSchema },
      },
    },
    async (req) => s.apps.detail(req.params.code, req.auth),
  );

  app.patch(
    '/applications/:code',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Edit an application (owners, team members or alm.apps.manage); the code is permanent',
        params: codeParams,
        body: updateAppSchema,
        response: { 200: appDetailSchema },
      },
    },
    async (req) => {
      const updated = await s.apps.update(req.params.code, req.body, req.auth);
      return s.apps.detail(updated.id, req.auth);
    },
  );

  app.get(
    '/applications/:code/metrics',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary:
          'DORA-style production metrics: deployment frequency, change failure rate, lead time, time to restore',
        params: codeParams,
        querystring: metricsQuerySchema,
        response: { 200: doraSchema },
      },
    },
    async (req) => s.metrics.dora(req.params.code, req.query.days),
  );

  /* ───────────── environments ───────────── */

  app.get(
    '/applications/:code/environments',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: "An application's environments in pipeline order, with what each runs",
        params: codeParams,
        response: { 200: items(environmentSchema) },
      },
    },
    async (req) => ({ items: await s.apps.environments((await s.apps.resolve(req.params.code)).id) }),
  );

  app.post(
    '/applications/:code/environments',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Add an environment (owners, team members or alm.apps.manage)',
        params: codeParams,
        body: createEnvironmentSchema,
        response: { 201: environmentSchema },
      },
    },
    async (req, reply) => {
      const env = await s.apps.createEnvironment(req.params.code, req.body, req.auth);
      return reply.status(201).send((await s.apps.environmentDtos([env]))[0]!);
    },
  );

  app.patch(
    '/applications/:code/environments/:id',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Edit an environment',
        params: codeIdParams,
        body: updateEnvironmentSchema,
        response: { 200: environmentSchema },
      },
    },
    async (req) => {
      const env = await s.apps.updateEnvironment(req.params.code, req.params.id, req.body, req.auth);
      return (await s.apps.environmentDtos([env]))[0]!;
    },
  );

  app.delete(
    '/applications/:code/environments/:id',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Delete an environment without deployments (IN_USE otherwise)',
        params: codeIdParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s.apps.deleteEnvironment(req.params.code, req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  app.post(
    '/applications/:code/environments/reorder',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Put the environments in this order (every environment exactly once)',
        params: codeParams,
        body: reorderSchema,
        response: { 200: items(environmentSchema) },
      },
    },
    async (req) => ({ items: await s.apps.reorderEnvironments(req.params.code, req.body.ids, req.auth) }),
  );

  /* ───────────── repositories ───────────── */

  app.get(
    '/applications/:code/repositories',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: "An application's source repositories",
        params: codeParams,
        response: { 200: items(repositorySchema) },
      },
    },
    async (req) => ({ items: await s.apps.repositories(req.params.code) }),
  );

  app.post(
    '/applications/:code/repositories',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Add a source repository (https URL, unique per application)',
        params: codeParams,
        body: createRepositorySchema,
        response: { 201: repositorySchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await s.apps.createRepository(req.params.code, req.body, req.auth)),
  );

  app.patch(
    '/applications/:code/repositories/:id',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Edit a repository (also its last known commit, e.g. from a sync)',
        params: codeIdParams,
        body: updateRepositorySchema,
        response: { 200: repositorySchema },
      },
    },
    async (req) => s.apps.updateRepository(req.params.code, req.params.id, req.body, req.auth),
  );

  app.delete(
    '/applications/:code/repositories/:id',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Remove a repository',
        params: codeIdParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s.apps.deleteRepository(req.params.code, req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  /* ───────────── releases ───────────── */

  app.get(
    '/applications/:code/releases',
    {
      config: { permission: READ },
      schema: {
        tags: rel,
        summary: "An application's releases with linked change status and readiness",
        params: codeParams,
        querystring: releaseQuerySchema,
        response: { 200: pageSchema(releaseSummarySchema) },
      },
    },
    async (req) => s.releases.list(req.params.code, req.query),
  );

  app.post(
    '/applications/:code/releases',
    {
      config: { permission: READ },
      schema: {
        tags: rel,
        summary: 'Plan a release (owners, team members or alm.releases.manage); the version is unique',
        params: codeParams,
        body: createReleaseSchema,
        response: { 201: releaseDetailSchema },
      },
    },
    async (req, reply) => {
      const created = await s.releases.create(req.params.code, req.body, req.auth);
      return reply.status(201).send(await s.releases.detail(created.id, req.auth));
    },
  );

  app.get(
    '/applications/:code/releases/:version',
    {
      config: { permission: READ },
      schema: {
        tags: rel,
        summary: 'Get a release by application code and version (e.g. erp / 12.1.0)',
        params: codeParams.extend({ version: z.string().trim().min(1).max(40) }),
        response: { 200: releaseDetailSchema },
      },
    },
    async (req) => s.releases.detailByVersion(req.params.code, req.params.version, req.auth),
  );

  app.get(
    '/releases',
    {
      config: { permission: READ },
      schema: {
        tags: rel,
        summary: 'Release calendar: releases of every application planned between from and to',
        querystring: calendarQuerySchema,
        response: { 200: items(releaseSummarySchema) },
      },
    },
    async (req) => s.releases.calendar(req.query, req.auth),
  );

  app.get(
    '/releases/:id',
    {
      config: { permission: READ },
      schema: {
        tags: rel,
        summary: 'Get a release with its pipeline (where this version is deployed)',
        params: idParams,
        response: { 200: releaseDetailSchema },
      },
    },
    async (req) => s.releases.detail(req.params.id, req.auth),
  );

  app.patch(
    '/releases/:id',
    {
      config: { permission: READ },
      schema: {
        tags: rel,
        summary: 'Edit a release: name, planned date, release notes (Markdown); version until deployed',
        params: idParams,
        body: updateReleaseSchema,
        response: { 200: releaseDetailSchema },
      },
    },
    async (req) => {
      await s.releases.update(req.params.id, req.body, req.auth);
      return s.releases.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/releases/:id/status',
    {
      config: { permission: READ },
      schema: {
        tags: rel,
        summary: 'Move a release to another status (INVALID_TRANSITION for illegal moves)',
        params: idParams,
        body: releaseStatusChangeSchema,
        response: { 200: releaseDetailSchema },
      },
    },
    async (req) => {
      await s.releases.setStatus(req.params.id, req.body.status, req.auth);
      return s.releases.detail(req.params.id, req.auth);
    },
  );

  app.get(
    '/releases/:id/readiness',
    {
      config: { permission: READ },
      schema: {
        tags: rel,
        summary:
          'Readiness checklist, linked changes (status, window) and what the change policy says about deploying to production now',
        params: idParams,
        querystring: readinessQuerySchema,
        response: { 200: readinessSchema },
      },
    },
    async (req) => s.releases.readiness(req.params.id, req.auth, req.query.changeReference),
  );

  /* ───────────── deployments ───────────── */

  app.get(
    '/deployments',
    {
      config: { permission: READ },
      schema: {
        tags: dep,
        summary: 'Deployment history (filters: application, environment, kind, release, status, from, to)',
        querystring: deploymentQuerySchema,
        response: { 200: pageSchema(deploymentSchema) },
      },
    },
    async (req) => s.deployments.list(req.query),
  );

  app.get(
    '/deployments/policy',
    {
      config: { permission: READ },
      schema: {
        tags: dep,
        summary: 'Dry run of the change policy for a deployment (what recording it now would meet)',
        querystring: policyQuerySchema,
        response: { 200: policyCheckSchema },
      },
    },
    async (req) => s.deployments.policy(req.query, req.auth),
  );

  app.post(
    '/deployments',
    {
      config: { permission: DEPLOY },
      schema: {
        tags: dep,
        summary:
          'Record a deployment (CI/CD friendly: application code, environment name or kind, version). Production needs an authorized change (409 CHANGE_REQUIRED)',
        body: createDeploymentSchema,
        response: { 201: recordedDeploymentSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await s.deployments.record(req.body, req.auth)),
  );

  app.patch(
    '/deployments/:id',
    {
      config: { permission: DEPLOY },
      schema: {
        tags: dep,
        summary: 'Finish an in-progress deployment (or roll back a successful one)',
        params: idParams,
        body: finishDeploymentSchema,
        response: { 200: deploymentSchema },
      },
    },
    async (req) => s.deployments.finish(req.params.id, req.body, req.auth),
  );

  /* ───────────── dashboard & other modules' pages ───────────── */

  app.get(
    '/dashboard',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Portfolio counts, deployments in the last 7 days, upcoming releases and gaps',
        response: { 200: dashboardSchema },
      },
    },
    async () => s.metrics.dashboard(),
  );

  app.get(
    '/changes/:changeId',
    {
      config: { permission: READ },
      schema: {
        tags: dep,
        summary: 'Releases linked to an ITSM change and the deployments it authorized',
        params: z.object({ changeId: z.uuid() }),
        response: { 200: changeUsageSchema },
      },
    },
    async (req) => s.deployments.forChange(req.params.changeId),
  );

  app.get(
    '/cis/:ciId/applications',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Applications whose CI (or one of whose environments’ CI) is this configuration item',
        params: z.object({ ciId: z.uuid() }),
        response: { 200: items(ciApplicationSchema) },
      },
    },
    async (req) => ({ items: await s.apps.forCi(req.params.ciId) }),
  );

  /* ───────────── pickers ───────────── */

  const idsOf = (ids: string | string[] | undefined) => (ids === undefined ? [] : [ids].flat());

  app.get(
    '/lookups/groups',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Groups to pick a team or support group from',
        querystring: lookupQuerySchema,
        response: { 200: items(lookupItemSchema) },
      },
    },
    async (req) => {
      const ids = idsOf(req.query.ids);
      const q = req.query.q;
      const rows = await ctx.db
        .select({ id: groups.id, name: groups.name, hint: groups.key })
        .from(groups)
        .where(
          ids.length
            ? inArray(groups.id, ids)
            : and(
                eq(groups.isSystem, false),
                q ? or(ilike(groups.name, likePattern(q)), ilike(groups.key, likePattern(q))) : undefined,
              ),
        )
        .orderBy(asc(groups.name))
        .limit(100);
      return { items: rows };
    },
  );

  app.get(
    '/lookups/departments',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Departments to pick from',
        querystring: lookupQuerySchema,
        response: { 200: items(lookupItemSchema) },
      },
    },
    async (req) => {
      const ids = idsOf(req.query.ids);
      const q = req.query.q;
      const rows = await ctx.db
        .select({ id: departments.id, name: departments.name, hint: departments.code })
        .from(departments)
        .where(
          ids.length
            ? inArray(departments.id, ids)
            : q
              ? or(ilike(departments.name, likePattern(q)), ilike(departments.code, likePattern(q)))
              : undefined,
        )
        .orderBy(asc(departments.name))
        .limit(200);
      return { items: rows };
    },
  );

  app.get(
    '/lookups/cis',
    {
      config: { permission: READ },
      schema: {
        tags: apps,
        summary: 'Configuration items to link an application or environment to (by name or CI number)',
        querystring: lookupQuerySchema,
        response: { 200: items(lookupItemSchema) },
      },
    },
    async (req) => {
      const ids = idsOf(req.query.ids);
      const q = req.query.q?.trim();
      const number = q && /^(ci-?)?\d{1,12}$/i.test(q) ? Number(q.replace(/\D/g, '')) : null;
      const rows = await ctx.db
        .select({ id: cis.id, name: cis.name, number: cis.number, classKey: cis.classKey })
        .from(cis)
        .where(
          ids.length
            ? inArray(cis.id, ids)
            : and(
                ne(cis.status, 'retired'),
                q
                  ? or(ilike(cis.name, likePattern(q)), number ? eq(cis.number, number) : undefined)
                  : undefined,
              ),
        )
        .orderBy(asc(cis.name))
        .limit(ids.length ? 100 : 30);
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          hint: `${formatCiNumber(r.number)} · ${r.classKey}`,
        })),
      };
    },
  );
}
