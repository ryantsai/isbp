import { type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import {
  byRecordQuerySchema,
  catalogueSchema,
  conflictDetailSchema,
  conflictQuerySchema,
  conflictSummarySchema,
  connectionCreatedSchema,
  connectionSchema,
  createConnectionSchema,
  createProfileSchema,
  defaultMappingQuerySchema,
  defaultMappingSchema,
  items,
  linkQuerySchema,
  linkSchema,
  localFieldSchema,
  optionSchema,
  previewSchema,
  profileDraftSchema,
  profileSchema,
  recordLinkSchema,
  relinkSchema,
  remoteFieldSchema,
  resolveConflictSchema,
  resyncResultSchema,
  runDetailSchema,
  runQuerySchema,
  runSummarySchema,
  testDraftSchema,
  testResultSchema,
  updateConnectionSchema,
  updateProfileSchema,
  webhookAcceptedSchema,
  webhookSecretSchema,
} from '../contracts';
import { canConfigure, MANAGE, READ, RESOLVE } from './access';
import { entityOf } from './session';
import { services } from './services';

const idParams = z.object({ id: z.uuid() });
const entityParams = z.object({ entity: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/) });
const objectQuery = z.object({
  objectType: z.string().regex(/^[a-z][a-z0-9-]*$/),
  scope: z.string().max(300).optional(),
});

/**
 * REST API mounted at /api/v1/integrations. Every route declares a permission except the record panel's
 * (`/links/by-record`, people only: it checks the record's own visibility) and the public webhook (it checks
 * the connection's secret).
 */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = services(ctx);
  const catalogueTag = ['Integrations: catalogue'];
  const connectionsTag = ['Integrations: connections'];
  const profilesTag = ['Integrations: sync profiles'];
  const runsTag = ['Integrations: runs'];
  const linksTag = ['Integrations: links'];
  const conflictsTag = ['Integrations: conflicts'];

  /* ───────────── catalogue ───────────── */

  app.get(
    '/connectors',
    {
      config: { permission: READ },
      schema: {
        tags: catalogueTag,
        summary: 'Connector types of enabled modules, and the entities they can sync with',
        response: { 200: catalogueSchema },
      },
    },
    async (req) => ({
      connectors: ctx.connectors.list(),
      entities: ctx.sync.entities().map((e) => ({ ...e, canConfigure: canConfigure(req.auth, e) })),
    }),
  );

  app.get(
    '/entities/:entity/fields',
    {
      config: { permission: READ },
      schema: {
        tags: catalogueTag,
        summary: "A sync entity's field catalogue (choices narrowed to a container when given)",
        params: entityParams,
        querystring: z.object({ containerId: z.string().max(200).optional() }),
        response: { 200: items(localFieldSchema) },
      },
    },
    async (req) => {
      entityOf(ctx, req.params.entity);
      return {
        items: await ctx.sync.fields(req.params.entity, { containerId: req.query.containerId ?? null }),
      };
    },
  );

  app.get(
    '/entities/:entity/containers',
    {
      config: { permission: READ },
      schema: {
        tags: catalogueTag,
        summary: 'Containers to sync into (e.g. projects for tasks) that you can see',
        params: entityParams,
        querystring: z.object({ q: z.string().trim().max(200).default('') }),
        response: { 200: items(optionSchema) },
      },
    },
    async (req) => {
      const container = entityOf(ctx, req.params.entity).container;
      if (!container) return { items: [] };
      const info = ctx.sync.entities().find((e) => e.entity === container);
      // A container that isn't itself synced (ALM applications) is found through the record registry.
      if (!info || info.recordType) {
        const found = await ctx.records.search(req.query.q, {
          auth: req.auth,
          types: [container],
          limit: 25,
        });
        return {
          items: found.map((r) => ({ id: r.id, label: `${r.reference ? `${r.reference} ` : ''}${r.title}` })),
        };
      }
      const q = req.query.q.toLowerCase();
      const page = await ctx.sync.list(container, { limit: 200 });
      return {
        items: page.items
          .filter((r) => !q || r.title.toLowerCase().includes(q) || r.ref?.toLowerCase().includes(q))
          .slice(0, 25)
          .map((r) => ({ id: r.id, label: `${r.ref ? `${r.ref} ` : ''}${r.title}` })),
      };
    },
  );

  /* ───────────── connections ───────────── */

  app.get(
    '/connections',
    {
      config: { permission: READ },
      schema: {
        tags: connectionsTag,
        summary: 'Connections with health, last sync and counts (never their secrets)',
        response: { 200: items(connectionSchema) },
      },
    },
    async () => ({ items: await s.connections.list() }),
  );

  app.post(
    '/connections',
    {
      config: { permission: MANAGE },
      schema: {
        tags: connectionsTag,
        summary: 'Add a connection; the response shows the webhook secret once',
        body: createConnectionSchema,
        response: { 201: connectionCreatedSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await s.connections.create(req.body, req.auth)),
  );

  app.post(
    '/connections/test',
    {
      config: { permission: MANAGE },
      schema: {
        tags: connectionsTag,
        summary: 'Test unsaved settings (empty secrets of an existing connection reuse the stored ones)',
        body: testDraftSchema,
        response: { 200: testResultSchema },
      },
    },
    async (req) => s.connections.testDraft(req.body, req.auth),
  );

  app.get(
    '/connections/:id',
    {
      config: { permission: READ },
      schema: {
        tags: connectionsTag,
        summary: 'One connection',
        params: idParams,
        response: { 200: connectionSchema },
      },
    },
    async (req) => s.connections.get(req.params.id),
  );

  app.patch(
    '/connections/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags: connectionsTag,
        summary: 'Change a connection; typed secrets replace stored ones, empty ones keep them',
        params: idParams,
        body: updateConnectionSchema,
        response: { 200: connectionSchema },
      },
    },
    async (req) => s.connections.update(req.params.id, req.body, req.auth),
  );

  app.delete(
    '/connections/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags: connectionsTag,
        summary: 'Delete a connection with its profiles and links (nothing is deleted in either system)',
        params: idParams,
      },
    },
    async (req, reply) => {
      await s.connections.remove(req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  app.post(
    '/connections/:id/test',
    {
      config: { permission: MANAGE },
      schema: {
        tags: connectionsTag,
        summary: 'Test a connection and record its health',
        params: idParams,
        response: { 200: testResultSchema },
      },
    },
    async (req) => s.connections.test(req.params.id, req.auth),
  );

  app.post(
    '/connections/:id/webhook-secret',
    {
      config: { permission: MANAGE },
      schema: {
        tags: connectionsTag,
        summary: 'Rotate the webhook secret (shown once; the old one stops working)',
        params: idParams,
        response: { 200: webhookSecretSchema },
      },
    },
    async (req) => s.connections.rotateWebhookSecret(req.params.id, req.auth),
  );

  app.get(
    '/connections/:id/scopes',
    {
      config: { permission: READ },
      schema: {
        tags: connectionsTag,
        summary: 'Remote scopes of an object type (e.g. Azure DevOps team projects)',
        params: idParams,
        querystring: objectQuery,
        response: { 200: items(z.object({ id: z.string(), name: z.string() })) },
      },
    },
    async (req) => {
      const conn = s.connections.open(await s.connections.row(req.params.id));
      return { items: await conn.scopes(req.query.objectType) };
    },
  );

  app.get(
    '/connections/:id/fields',
    {
      config: { permission: READ },
      schema: {
        tags: connectionsTag,
        summary: "A remote object's field catalogue",
        params: idParams,
        querystring: objectQuery,
        response: { 200: items(remoteFieldSchema) },
      },
    },
    async (req) => {
      const conn = s.connections.open(await s.connections.row(req.params.id));
      return { items: await conn.fields(req.query.objectType, req.query.scope ?? null) };
    },
  );

  /* ───────────── profiles ───────────── */

  app.get(
    '/profiles',
    {
      config: { permission: READ },
      schema: {
        tags: profilesTag,
        summary: 'Sync profiles (of one connection)',
        querystring: z.object({ connectionId: z.uuid().optional() }),
        response: { 200: items(profileSchema) },
      },
    },
    async (req) => ({ items: await s.profiles.list(req.query.connectionId, req.auth) }),
  );

  app.get(
    '/profiles/default-mapping',
    {
      config: { permission: MANAGE },
      schema: {
        tags: profilesTag,
        summary: "The connector's suggested field mapping for an object ↔ entity pair",
        querystring: defaultMappingQuerySchema,
        response: { 200: defaultMappingSchema },
      },
    },
    async (req) => s.profiles.defaultMapping(req.query),
  );

  app.post(
    '/profiles',
    {
      config: { permission: MANAGE },
      schema: {
        tags: profilesTag,
        summary: "Create a sync profile (needs the synced entity's .sync permission)",
        body: createProfileSchema,
        response: { 201: profileSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await s.profiles.create(req.body, req.auth)),
  );

  app.post(
    '/profiles/preview',
    {
      config: { permission: MANAGE },
      schema: {
        tags: profilesTag,
        summary: 'Dry run of an unsaved profile: what the next changes would do, per field',
        body: profileDraftSchema,
        response: { 200: previewSchema },
      },
    },
    async (req) => s.profiles.preview(req.body, req.auth),
  );

  app.get(
    '/profiles/:id',
    {
      config: { permission: READ },
      schema: {
        tags: profilesTag,
        summary: 'One sync profile',
        params: idParams,
        response: { 200: profileSchema },
      },
    },
    async (req) => s.profiles.get(req.params.id, req.auth),
  );

  app.patch(
    '/profiles/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags: profilesTag,
        summary: "Change a sync profile (needs the synced entity's .sync permission)",
        params: idParams,
        body: updateProfileSchema,
        response: { 200: profileSchema },
      },
    },
    async (req) => s.profiles.update(req.params.id, req.body, req.auth),
  );

  app.delete(
    '/profiles/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags: profilesTag,
        summary: 'Delete a sync profile and its links (nothing is deleted in either system)',
        params: idParams,
      },
    },
    async (req, reply) => {
      await s.profiles.remove(req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  for (const kind of ['run', 'export'] as const)
    app.post(
      `/profiles/:id/${kind}`,
      {
        config: { permission: MANAGE },
        schema: {
          tags: profilesTag,
          summary:
            kind === 'run'
              ? 'Run the sync now (409 SYNC_RUNNING while one is going)'
              : 'Push existing records: create unlinked local records remotely and push changes',
          params: idParams,
          response: { 201: runSummarySchema },
        },
      },
      async (req, reply) => {
        const run = await s.engine.request(req.params.id, kind === 'run' ? 'pull' : 'export', req.auth);
        return reply.status(201).send(await s.runs.detail(run.id));
      },
    );

  app.post(
    '/profiles/:id/preview',
    {
      config: { permission: MANAGE },
      schema: {
        tags: profilesTag,
        summary: 'Dry run of a saved profile, optionally with unsaved changes',
        params: idParams,
        body: updateProfileSchema.nullish(),
        response: { 200: previewSchema },
      },
    },
    async (req) => {
      const p = await s.profiles.row(req.params.id);
      const edits = req.body ?? {};
      return s.profiles.preview(
        {
          id: p.id,
          connectionId: p.connectionId,
          objectType: p.objectType,
          remoteScope: p.remoteScope,
          entity: p.entity,
          containerId: p.containerId,
          name: edits.name ?? p.name,
          direction: edits.direction ?? p.direction,
          createLocal: edits.createLocal ?? p.createLocal,
          createRemote: edits.createRemote ?? p.createRemote,
          matchRule: edits.matchRule === undefined ? (p.matchRule ?? null) : edits.matchRule,
          pushFilter: edits.pushFilter ?? p.pushFilter,
          mappings: edits.mappings ?? p.mappings,
          conflictPolicy: edits.conflictPolicy ?? p.conflictPolicy,
          comments: edits.comments ?? p.comments,
          intervalMinutes: edits.intervalMinutes ?? p.intervalMinutes,
          enabled: edits.enabled ?? p.enabled,
        },
        req.auth,
      );
    },
  );

  /* ───────────── runs ───────────── */

  app.get(
    '/runs',
    {
      config: { permission: READ },
      schema: {
        tags: runsTag,
        summary: 'Sync runs (filters: connection, profile, status, trigger, kind)',
        querystring: runQuerySchema,
        response: { 200: pageSchema(runSummarySchema) },
      },
    },
    async (req) => s.runs.list(req.query),
  );

  app.get(
    '/runs/:id',
    {
      config: { permission: READ },
      schema: {
        tags: runsTag,
        summary: 'One run with its log (poll while it is running)',
        params: idParams,
        response: { 200: runDetailSchema },
      },
    },
    async (req) => s.runs.detail(req.params.id),
  );

  /* ───────────── links ───────────── */

  app.get(
    '/links',
    {
      config: { permission: READ },
      schema: {
        tags: linksTag,
        summary:
          'Linked records (filters: connection, profile, state, q); titles you may not see are withheld',
        querystring: linkQuerySchema,
        response: { 200: pageSchema(linkSchema) },
      },
    },
    async (req) => s.links.list(req.query, req.auth),
  );

  app.get(
    '/links/by-record',
    {
      schema: {
        tags: linksTag,
        summary: "A record's links to outside systems (for whoever can read the record)",
        querystring: byRecordQuerySchema,
        response: { 200: items(recordLinkSchema) },
      },
    },
    async (req) => s.links.byRecord(req.query.entity, req.query.id, req.auth),
  );

  app.post(
    '/links/:id/resync',
    {
      config: { permission: MANAGE },
      schema: {
        tags: linksTag,
        summary: 'Sync this record now (a run; follow it on the run page)',
        params: idParams,
        response: { 202: resyncResultSchema },
      },
    },
    async (req, reply) => reply.status(202).send(await s.links.resync(req.params.id, req.auth)),
  );

  app.post(
    '/links/:id/relink',
    {
      config: { permission: MANAGE },
      schema: {
        tags: linksTag,
        summary: 'Link the local record to another remote record, then sync',
        params: idParams,
        body: relinkSchema,
        response: { 200: linkSchema },
      },
    },
    async (req) => s.links.relink(req.params.id, req.body.remoteId, req.auth),
  );

  app.delete(
    '/links/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags: linksTag,
        summary: 'Unlink (nothing is deleted on either side; a later sync may link them again)',
        params: idParams,
      },
    },
    async (req, reply) => {
      await s.links.unlink(req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  /* ───────────── conflicts ───────────── */

  app.get(
    '/conflicts',
    {
      config: { permission: READ },
      schema: {
        tags: conflictsTag,
        summary: 'Sync conflicts (filters: connection, profile, status)',
        querystring: conflictQuerySchema,
        response: { 200: pageSchema(conflictSummarySchema) },
      },
    },
    async (req) => s.conflicts.list(req.query, req.auth),
  );

  app.get(
    '/conflicts/:id',
    {
      config: { permission: READ },
      schema: {
        tags: conflictsTag,
        summary: 'One conflict: base, ISBP and remote value per field',
        params: idParams,
        response: { 200: conflictDetailSchema },
      },
    },
    async (req) => s.conflicts.detail(req.params.id, req.auth),
  );

  app.post(
    '/conflicts/:id/resolve',
    {
      config: { permission: RESOLVE },
      schema: {
        tags: conflictsTag,
        summary:
          'Pick ISBP or the remote value per field and apply (409 CONFLICT_RESOLVED when already done)',
        params: idParams,
        body: resolveConflictSchema,
        response: { 200: conflictDetailSchema },
      },
    },
    async (req) => s.conflicts.resolve(req.params.id, req.body.choices, req.auth),
  );

  app.post(
    '/conflicts/:id/dismiss',
    {
      config: { permission: RESOLVE },
      schema: {
        tags: conflictsTag,
        summary: 'Keep both values as they are (they become the agreed ones)',
        params: idParams,
        response: { 200: conflictDetailSchema },
      },
    },
    async (req) => s.conflicts.dismiss(req.params.id, req.auth),
  );

  /* ───────────── webhooks (public) ───────────── */

  app.post(
    '/hooks/:connectionId',
    {
      config: { public: true, csrf: false, rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['Integrations: webhooks'],
        summary:
          'Webhook for a connection: needs its secret (X-ISBP-Webhook-Secret header or Basic password); only says which records changed',
        params: z.object({ connectionId: z.uuid() }),
        response: { 202: webhookAcceptedSchema },
      },
    },
    async (req, reply) =>
      reply.status(202).send(await s.engine.acceptWebhook(req.params.connectionId, req.headers, req.body)),
  );
}
