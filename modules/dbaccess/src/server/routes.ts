import { type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import {
  accountQuerySchema,
  adoptSchema,
  catalogItemSchema,
  catalogQuerySchema,
  createRequestSchema,
  createReviewSchema,
  createRoleSchema,
  createServerSchema,
  decideSchema,
  grantQuerySchema,
  grantSchema,
  groupOptionSchema,
  inventoryAccountSchema,
  inventorySchema,
  lookupQuerySchema,
  myAccessSchema,
  mySummarySchema,
  reasonSchema,
  requestableRoleSchema,
  requestSchema,
  revealSchema,
  reviewItemQuerySchema,
  reviewItemSchema,
  reviewQuerySchema,
  reviewSchema,
  revokeUnmanagedSchema,
  serverOptionSchema,
  serverSchema,
  serversSchema,
  syncResultSchema,
  unmanagedQuerySchema,
  unmanagedSchema,
  updateRoleSchema,
  updateServerSchema,
} from '../contracts';
import { PERMISSIONS, requireAny } from './access';
import { services } from './services';

const idParams = z.object({ id: z.uuid() });
const refParams = z.object({ ref: z.string().trim().min(1).max(64) });
const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });
const ok = z.object({ ok: z.literal(true) });

/**
 * REST API mounted at /api/v1/dbaccess. Routes that people with different roles share (revoking as a DBA or
 * as the role owner, reviewing as an assigned reviewer) declare the everyone-permission and check the rest
 * in the service, so API clients, AI tools and the UI meet the same rules.
 */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = () => services(ctx);
  const self = ['Database access: self service'];
  const access = ['Database access: grants'];
  const srv = ['Database access: servers'];
  const rev = ['Database access: reviews'];

  /* ───────────── self service ───────────── */

  app.get(
    '/me/access',
    {
      config: { permission: PERMISSIONS.request },
      schema: {
        tags: self,
        summary: 'My database access and recent requests',
        response: { 200: myAccessSchema },
      },
    },
    async (req) => ({ grants: await s().grants.mine(req.auth), requests: await s().requests.mine(req.auth) }),
  );

  app.get(
    '/me/summary',
    {
      config: { permission: PERMISSIONS.request },
      schema: {
        tags: self,
        summary: 'Reviews awaiting me and my access ending soon (dashboard)',
        response: { 200: mySummarySchema },
      },
    },
    async (req) => {
      const grants = await s().grants.mine(req.auth);
      return {
        reviews: await s().reviews.awaiting(req.auth),
        expiring: grants.filter((g) => g.viewStatus === 'expiring'),
      };
    },
  );

  app.get(
    '/catalog',
    {
      config: { permission: PERMISSIONS.request },
      schema: {
        tags: self,
        summary: 'Requestable roles (filters: q, server, database, risk) with what I hold or asked for',
        querystring: catalogQuerySchema,
        response: { 200: items(catalogItemSchema) },
      },
    },
    async (req) => ({ items: await s().requests.catalog(req.query, req.auth) }),
  );

  app.post(
    '/requests',
    {
      config: { permission: PERMISSIONS.request },
      schema: {
        tags: self,
        summary: 'Request one or more roles (one approval workflow per role)',
        body: createRequestSchema,
        response: { 201: items(requestSchema) },
      },
    },
    async (req, reply) => reply.status(201).send({ items: await s().requests.submit(req.body, req.auth) }),
  );

  app.get(
    '/requests/:ref',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: self,
        summary: 'A request (DBR-00042 or id): requester, approvers, role owners and grants readers',
        params: refParams,
        response: { 200: requestSchema },
      },
    },
    async (req) => s().requests.detail(req.params.ref, req.auth),
  );

  app.post(
    '/requests/:ref/cancel',
    {
      config: { permission: PERMISSIONS.request },
      schema: {
        tags: self,
        summary: 'Withdraw my pending request',
        params: refParams,
        response: { 200: requestSchema },
      },
    },
    async (req) => s().requests.cancel(req.params.ref, req.auth),
  );

  app.post(
    '/grants/:id/relinquish',
    {
      config: { permission: PERMISSIONS.request },
      schema: {
        tags: self,
        summary: 'Give my access back (the role is revoked by the worker)',
        params: idParams,
        body: reasonSchema,
        response: { 200: grantSchema },
      },
    },
    async (req) => s().grants.relinquish(req.params.id, req.body.reason, req.auth),
  );

  app.post(
    '/reveals/:id',
    {
      config: { permission: PERMISSIONS.request },
      schema: {
        tags: self,
        summary: 'Show my generated password once (audited); afterwards 410 REVEAL_EXPIRED',
        params: idParams,
        response: { 200: revealSchema },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return s().grants.reveal(req.params.id, req.auth);
    },
  );

  /* ───────────── grants ───────────── */

  app.get(
    '/grants',
    {
      config: { permission: PERMISSIONS.grantsRead },
      schema: {
        tags: access,
        summary:
          'All database access (filters: status incl. expiring/live/ended, server, role, risk, person, source)',
        querystring: grantQuerySchema,
        response: { 200: pageSchema(grantSchema) },
      },
    },
    async (req) => s().grants.list(req.query, req.auth),
  );

  app.get(
    '/grants/:id',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: access,
        summary: 'A grant (grantee, role owner, manager or grants readers)',
        params: idParams,
        response: { 200: grantSchema },
      },
    },
    async (req) => s().grants.detail(req.params.id, req.auth),
  );

  app.post(
    '/grants/:id/revoke',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: access,
        summary: 'Revoke early with a reason (DBAs with dbaccess.grants.manage, or the role owner)',
        params: idParams,
        body: reasonSchema,
        response: { 200: grantSchema },
      },
    },
    async (req) => s().grants.revokeEarly(req.params.id, req.body.reason, req.auth),
  );

  app.post(
    '/grants/:id/retry',
    {
      config: { permission: PERMISSIONS.grantsManage },
      schema: {
        tags: access,
        summary: 'Run a failed provisioning or revocation again',
        params: idParams,
        response: { 200: grantSchema },
      },
    },
    async (req) => s().grants.retry(req.params.id, req.auth),
  );

  app.get(
    '/accounts',
    {
      config: { permission: PERMISSIONS.grantsRead },
      schema: {
        tags: access,
        summary: 'Accounts from the inventory with their person, orphan and managed flags',
        querystring: accountQuerySchema,
        response: { 200: pageSchema(inventoryAccountSchema) },
      },
    },
    async (req) => s().servers.accounts(req.query),
  );

  app.get(
    '/unmanaged',
    {
      config: { permission: PERMISSIONS.grantsRead },
      schema: {
        tags: access,
        summary: 'Memberships of requestable roles that no grant explains',
        querystring: unmanagedQuerySchema,
        response: { 200: items(unmanagedSchema) },
      },
    },
    async (req) => ({ items: await s().servers.unmanaged(req.query.serverId) }),
  );

  app.post(
    '/unmanaged/adopt',
    {
      config: { permission: PERMISSIONS.grantsManage },
      schema: {
        tags: access,
        summary: 'Adopt unmanaged access as a grant for a person, with an end date',
        body: adoptSchema,
        response: { 201: grantSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await s().grants.adopt(req.body, req.auth)),
  );

  app.post(
    '/unmanaged/revoke',
    {
      config: { permission: PERMISSIONS.grantsManage },
      schema: {
        tags: access,
        summary: 'Revoke unmanaged access (the worker removes the membership)',
        body: revokeUnmanagedSchema,
        response: { 202: grantSchema },
      },
    },
    async (req, reply) => reply.status(202).send(await s().grants.revokeUnmanaged(req.body, req.auth)),
  );

  app.get(
    '/people/:id/access',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: access,
        summary: "A person's database access (grants readers and the person's manager)",
        params: idParams,
        response: { 200: items(grantSchema) },
      },
    },
    async (req) => ({ items: await s().grants.ofPerson(req.params.id, req.auth) }),
  );

  /* ───────────── servers & roles ───────────── */

  app.get(
    '/servers',
    {
      config: { permission: PERMISSIONS.servers },
      schema: {
        tags: srv,
        summary: 'Configured servers and admin connections not configured yet',
        response: { 200: serversSchema },
      },
    },
    async () => s().servers.list(),
  );

  app.post(
    '/servers',
    {
      config: { permission: PERMISSIONS.servers },
      schema: {
        tags: srv,
        summary: 'Manage accounts on an admin connection',
        body: createServerSchema,
        response: { 201: serverSchema },
      },
    },
    async (req, reply) => {
      const row = await s().servers.create(req.body, req.auth);
      return reply.status(201).send(await s().servers.detail(row.id));
    },
  );

  app.get(
    '/servers/:id',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: srv,
        summary: 'A server with counts and sync status',
        params: idParams,
        response: { 200: serverSchema },
      },
    },
    async (req) => {
      s().servers.requireServerReader(req.auth);
      return s().servers.detail(req.params.id);
    },
  );

  app.patch(
    '/servers/:id',
    {
      config: { permission: PERMISSIONS.servers },
      schema: {
        tags: srv,
        summary: 'Change server settings',
        params: idParams,
        body: updateServerSchema,
        response: { 200: serverSchema },
      },
    },
    async (req) => {
      await s().servers.update(req.params.id, req.body);
      return s().servers.detail(req.params.id);
    },
  );

  app.delete(
    '/servers/:id',
    {
      config: { permission: PERMISSIONS.servers },
      schema: {
        tags: srv,
        summary: 'Stop managing a server (IN_USE while access is live)',
        params: idParams,
        response: { 200: ok },
      },
    },
    async (req) => {
      await s().servers.remove(req.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/servers/:id/sync',
    {
      config: { permission: PERMISSIONS.servers },
      schema: {
        tags: srv,
        summary: 'Read accounts, roles and memberships from the server now',
        params: idParams,
        response: { 200: syncResultSchema },
      },
    },
    async (req) => s().servers.sync(req.params.id),
  );

  app.get(
    '/servers/:id/inventory',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: srv,
        summary: 'Roles from the last sync (to make them requestable)',
        params: idParams,
        response: { 200: inventorySchema },
      },
    },
    async (req) => {
      s().servers.requireServerReader(req.auth);
      return s().servers.inventory(req.params.id);
    },
  );

  app.get(
    '/servers/:id/roles',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: srv,
        summary: 'Requestable roles of a server (active and inactive)',
        params: idParams,
        response: { 200: items(requestableRoleSchema) },
      },
    },
    async (req) => {
      s().servers.requireServerReader(req.auth);
      return { items: await s().servers.roles(req.params.id) };
    },
  );

  app.post(
    '/servers/:id/roles',
    {
      config: { permission: PERMISSIONS.servers },
      schema: {
        tags: srv,
        summary: 'Make an inventory role requestable',
        params: idParams,
        body: createRoleSchema,
        response: { 201: requestableRoleSchema },
      },
    },
    async (req, reply) => {
      const row = await s().servers.createRole(req.params.id, req.body);
      return reply.status(201).send((await s().servers.roleDtos([row]))[0]!);
    },
  );

  app.patch(
    '/roles/:id',
    {
      config: { permission: PERMISSIONS.servers },
      schema: {
        tags: srv,
        summary: 'Change a requestable role',
        params: idParams,
        body: updateRoleSchema,
        response: { 200: requestableRoleSchema },
      },
    },
    async (req) => {
      const row = await s().servers.updateRole(req.params.id, req.body);
      return (await s().servers.roleDtos([row]))[0]!;
    },
  );

  app.delete(
    '/roles/:id',
    {
      config: { permission: PERMISSIONS.servers },
      schema: {
        tags: srv,
        summary: 'Remove a requestable role that was never granted (IN_USE otherwise)',
        params: idParams,
        response: { 200: ok },
      },
    },
    async (req) => {
      await s().servers.removeRole(req.params.id);
      return { ok: true as const };
    },
  );

  app.get(
    '/lookups/servers',
    {
      config: { permission: PERMISSIONS.request },
      schema: {
        tags: srv,
        summary: 'Servers for filters and pickers',
        response: { 200: items(serverOptionSchema) },
      },
    },
    async () => ({ items: await s().servers.options() }),
  );

  app.get(
    '/lookups/groups',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: srv,
        summary: 'Groups for owner pickers (DBAs and review managers)',
        querystring: lookupQuerySchema,
        response: { 200: items(groupOptionSchema) },
      },
    },
    async (req) => {
      requireAny(req.auth, [PERMISSIONS.servers, PERMISSIONS.reviewsManage]);
      return { items: await s().servers.groupOptions(req.query.q) };
    },
  );

  /* ───────────── access reviews ───────────── */

  app.get(
    '/reviews',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: rev,
        summary: 'Campaigns (all for review readers; otherwise those with items for me)',
        querystring: reviewQuerySchema,
        response: { 200: pageSchema(reviewSchema) },
      },
    },
    async (req) => s().reviews.list(req.query, req.auth),
  );

  app.post(
    '/reviews',
    {
      config: { permission: PERMISSIONS.reviewsManage },
      schema: {
        tags: rev,
        summary: 'Create (and start) a campaign',
        body: createReviewSchema,
        response: { 201: reviewSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await s().reviews.create(req.body, req.auth)),
  );

  app.get(
    '/reviews/:id',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: rev,
        summary: 'A campaign with its totals',
        params: idParams,
        response: { 200: reviewSchema },
      },
    },
    async (req) => s().reviews.detail(req.params.id, req.auth),
  );

  app.get(
    '/reviews/:id/items',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: rev,
        summary: 'Items of a campaign (view: mine, undecided, decided, all)',
        params: idParams,
        querystring: reviewItemQuerySchema,
        response: { 200: pageSchema(reviewItemSchema) },
      },
    },
    async (req) => s().reviews.items(req.params.id, req.query, req.auth),
  );

  app.post(
    '/reviews/:id/decisions',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: {
        tags: rev,
        summary: 'Keep or revoke items (bulk), with a comment; 409 REVIEW_CLOSED once closed',
        params: idParams,
        body: decideSchema,
        response: { 200: z.object({ updated: z.number().int() }) },
      },
    },
    async (req) => s().reviews.decide(req.params.id, req.body, req.auth),
  );

  app.post(
    '/reviews/:id/close',
    {
      config: { permission: PERMISSIONS.reviewsManage },
      schema: {
        tags: rev,
        summary: 'Close: apply decisions and the policy for undecided items, queue revocations',
        params: idParams,
        response: { 200: reviewSchema },
      },
    },
    async (req) => {
      await s().reviews.close(req.params.id, req.auth);
      return s().reviews.detail(req.params.id, req.auth);
    },
  );

  app.get(
    '/reviews/:id/report.csv',
    {
      config: { permission: PERMISSIONS.request, scoped: true },
      schema: { tags: rev, summary: 'The campaign report as CSV', params: idParams },
    },
    async (req, reply) => {
      const { filename, body } = await s().reviews.csv(req.params.id, req.auth);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(body);
    },
  );
}
