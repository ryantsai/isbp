import {
  catalogSchema,
  createDbConnectionSchema,
  dbConnectionSchema,
  dbTestResultSchema,
  testDbConnectionSchema,
  updateDbConnectionSchema,
} from '@isbp/contracts';
import type { ModuleRouter } from '@isbp/sdk/server';
import { z } from 'zod';
import type { DatabaseAdminService } from '../services/databases';

const params = z.object({ id: z.uuid() });

/** Administration → Database connections (`core.databases.*`). Credentials are write-only. */
export function databaseRoutes(app: ModuleRouter, svc: DatabaseAdminService) {
  const tags = ['Database connections'];
  const read = { permission: 'core.databases.read' };
  const manage = { permission: 'core.databases.manage' };

  app.get(
    '/databases',
    {
      config: read,
      schema: {
        tags,
        summary: 'List database connections',
        response: { 200: z.object({ items: z.array(dbConnectionSchema) }) },
      },
    },
    async () => svc.list(),
  );

  app.post(
    '/databases',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Register a database connection',
        body: createDbConnectionSchema,
        response: { 201: dbConnectionSchema },
      },
    },
    async (req, reply) => reply.code(201).send(await svc.create(req.body, req.auth)),
  );

  app.post(
    '/databases/test',
    {
      config: { ...manage, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Test unsaved connection settings',
        body: testDbConnectionSchema,
        response: { 200: dbTestResultSchema },
      },
    },
    async (req) => svc.testDraft(req.body),
  );

  app.get(
    '/databases/:id',
    {
      config: read,
      schema: { tags, summary: 'A database connection', params, response: { 200: dbConnectionSchema } },
    },
    async (req) => svc.get(req.params.id),
  );

  app.patch(
    '/databases/:id',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Change a connection (omit `password` to keep it, `null` to clear it)',
        params,
        body: updateDbConnectionSchema,
        response: { 200: dbConnectionSchema },
      },
    },
    async (req) => svc.update(req.params.id, req.body, req.auth),
  );

  app.delete(
    '/databases/:id',
    { config: manage, schema: { tags, summary: 'Delete a connection', params, response: { 204: z.null() } } },
    async (req, reply) => {
      await svc.remove(req.params.id);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/databases/:id/test',
    {
      config: { ...manage, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Connect and record the outcome',
        params,
        response: { 200: dbTestResultSchema },
      },
    },
    async (req) => svc.test(req.params.id),
  );

  app.get(
    '/databases/:id/catalog',
    {
      config: read,
      schema: {
        tags,
        summary: 'Schemas, tables, views and routines visible to the connection’s login',
        params,
        querystring: z.object({ refresh: z.stringbool().default(false) }),
        response: { 200: catalogSchema },
      },
    },
    async (req) => svc.catalog(req.params.id, req.query.refresh),
  );
}
