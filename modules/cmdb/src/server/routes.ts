import { departments, groups } from '@isbp/db/schema';
import { likePattern, type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  ciClassSchema,
  ciDetailSchema,
  ciQuerySchema,
  ciRelationSchema,
  ciSummarySchema,
  createCiSchema,
  createClassSchema,
  createRelationshipSchema,
  impactQuerySchema,
  impactSchema,
  lookupItemSchema,
  lookupQuerySchema,
  relationshipSchema,
  serviceQuerySchema,
  serviceSchema,
  updateCiSchema,
  updateClassSchema,
} from '../contracts';
import { ClassService } from './classes';
import { CiService } from './service';

const READ = 'cmdb.cis.read';
const MANAGE = 'cmdb.cis.manage';
const CLASSES = 'cmdb.classes.manage';

/** A CI's uuid or its number (`CI-00042`). */
const refParams = z.object({ ref: z.string().min(1).max(64) });
const tags = ['CMDB'];

/** REST API mounted at /api/v1/cmdb — every route is authenticated and permission-gated. */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const svc = new CiService(ctx);
  const classes = new ClassService(ctx);
  const detail = async (ref: string, canManage: boolean) => svc.detail(ref, canManage);

  /* ───────────── configuration items ───────────── */

  app.get(
    '/cis',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'List configuration items (filter, search by name or CI number, sort)',
        querystring: ciQuerySchema,
        response: { 200: pageSchema(ciSummarySchema) },
      },
    },
    async (req) => svc.list(req.query),
  );

  app.post(
    '/cis',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Register a configuration item',
        body: createCiSchema,
        response: { 201: ciDetailSchema },
      },
    },
    async (req, reply) => {
      const ci = await svc.create(req.body);
      return reply.status(201).send(await detail(ci.id, true));
    },
  );

  app.get(
    '/cis/:ref',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Get a configuration item by id or number (CI-00042)',
        params: refParams,
        response: { 200: ciDetailSchema },
      },
    },
    async (req) => detail(req.params.ref, req.auth.can(MANAGE)),
  );

  app.patch(
    '/cis/:ref',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Edit a configuration item',
        params: refParams,
        body: updateCiSchema,
        response: { 200: ciDetailSchema },
      },
    },
    async (req) => {
      const ci = await svc.update(req.params.ref, req.body);
      return detail(ci.id, true);
    },
  );

  app.post(
    '/cis/:ref/retire',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Take a configuration item out of service',
        params: refParams,
        response: { 200: ciDetailSchema },
      },
    },
    async (req) => {
      const ci = await svc.retire(req.params.ref);
      return detail(ci.id, true);
    },
  );

  app.delete(
    '/cis/:ref',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary:
          'Delete a configuration item and its relationships (IN_USE while other records reference it)',
        params: refParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await svc.remove(req.params.ref);
      return reply.status(204).send();
    },
  );

  /* ───────────── relationships ───────────── */

  app.get(
    '/cis/:ref/relationships',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: "A CI's relationships in both directions, labelled from its point of view",
        params: refParams,
        response: { 200: z.object({ items: z.array(ciRelationSchema) }) },
      },
    },
    async (req) => ({ items: await svc.relations(req.params.ref) }),
  );

  app.post(
    '/relationships',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Relate two CIs (RELATIONSHIP_INVALID for self links, duplicates and containment loops)',
        body: createRelationshipSchema,
        response: { 201: relationshipSchema },
      },
    },
    async (req, reply) => {
      const rel = await svc.createRelationship(req.body, req.auth.user?.id ?? null);
      return reply.status(201).send({
        id: rel.id,
        sourceId: rel.sourceId,
        targetId: rel.targetId,
        type: rel.type,
        note: rel.note,
        createdAt: rel.createdAt,
      });
    },
  );

  app.delete(
    '/relationships/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Remove a relationship',
        params: z.object({ id: z.uuid() }),
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await svc.deleteRelationship(req.params.id);
      return reply.status(204).send();
    },
  );

  /* ───────────── impact ───────────── */

  app.get(
    '/cis/:ref/impact',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Impact analysis: what breaks if this CI fails (impacted) and what it needs (dependsOn)',
        params: refParams,
        querystring: impactQuerySchema,
        response: { 200: impactSchema },
      },
    },
    async (req) => svc.impact(req.params.ref, req.query.depth),
  );

  /* ───────────── business services (everyone) ───────────── */

  app.get(
    '/services',
    {
      config: { permission: 'cmdb.services.read' },
      schema: {
        tags,
        summary: 'Operational business services (id, number, name, description) — e.g. "affected service"',
        querystring: serviceQuerySchema,
        response: { 200: z.object({ items: z.array(serviceSchema) }) },
      },
    },
    async (req) => ({ items: await svc.services(req.query.q, req.query.limit) }),
  );

  /* ───────────── classes ───────────── */

  app.get(
    '/classes',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'CI classes with how many CIs use each',
        response: { 200: z.object({ items: z.array(ciClassSchema) }) },
      },
    },
    async () => ({ items: await classes.list() }),
  );

  app.post(
    '/classes',
    {
      config: { permission: CLASSES },
      schema: { tags, summary: 'Add a CI class', body: createClassSchema, response: { 201: ciClassSchema } },
    },
    async (req, reply) => reply.status(201).send(await classes.create(req.body)),
  );

  app.patch(
    '/classes/:key',
    {
      config: { permission: CLASSES },
      schema: {
        tags,
        summary: 'Rename a class or change its icon',
        params: z.object({ key: z.string().max(64) }),
        body: updateClassSchema,
        response: { 200: ciClassSchema },
      },
    },
    async (req) => classes.update(req.params.key, req.body),
  );

  app.delete(
    '/classes/:key',
    {
      config: { permission: CLASSES },
      schema: {
        tags,
        summary: 'Delete an unused, non-system class',
        params: z.object({ key: z.string().max(64) }),
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await classes.remove(req.params.key);
      return reply.status(204).send();
    },
  );

  /* ───────────── pickers (support group, department) ───────────── */

  const idsOf = (ids: string | string[] | undefined) => (ids === undefined ? [] : [ids].flat());

  app.get(
    '/lookups/groups',
    {
      config: { permission: READ },
      schema: {
        tags,
        summary: 'Groups to pick a support group from (id, name, key)',
        querystring: lookupQuerySchema,
        response: { 200: z.object({ items: z.array(lookupItemSchema) }) },
      },
    },
    async (req) => {
      const ids = idsOf(req.query.ids);
      const rows = await ctx.db
        .select({ id: groups.id, name: groups.name, hint: groups.key })
        .from(groups)
        .where(
          ids.length
            ? inArray(groups.id, ids)
            : and(
                eq(groups.isSystem, false),
                req.query.q
                  ? or(
                      ilike(groups.name, likePattern(req.query.q)),
                      ilike(groups.key, likePattern(req.query.q)),
                    )
                  : undefined,
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
        tags,
        summary: 'Departments to pick from (id, name, code)',
        querystring: lookupQuerySchema,
        response: { 200: z.object({ items: z.array(lookupItemSchema) }) },
      },
    },
    async (req) => {
      const ids = idsOf(req.query.ids);
      const rows = await ctx.db
        .select({ id: departments.id, name: departments.name, hint: departments.code })
        .from(departments)
        .where(
          ids.length
            ? inArray(departments.id, ids)
            : req.query.q
              ? or(
                  ilike(departments.name, likePattern(req.query.q)),
                  ilike(departments.code, likePattern(req.query.q)),
                )
              : undefined,
        )
        .orderBy(asc(departments.name))
        .limit(200);
      return { items: rows };
    },
  );
}
