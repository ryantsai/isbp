import {
  apiClientSchema,
  applicationListQuerySchema,
  applicationSchema,
  appMembersQuerySchema,
  appPermissionSchema,
  createApiClientSchema,
  createAppPermissionSchema,
  createApplicationSchema,
  createAppRoleSchema,
  createdSecretSchema,
  createRoleAssignmentSchema,
  oauthErrorSchema,
  oauthTokenRequestSchema,
  oauthTokenResponseSchema,
  okSchema,
  roleAssignmentSchema,
  roleQueryCheckResultSchema,
  roleQueryCheckSchema,
  roleQueryMemberSchema,
  roleQueryMembersQuerySchema,
  roleQueryResultSchema,
  roleQueryUserQuerySchema,
  roleRequestSettingsSchema,
  roleSchema,
  rotateSecretSchema,
  updateApiClientSchema,
  updateApplicationSchema,
} from '@isbp/contracts';
import { type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import { getKernel } from '../kernel-ref';
import type { AccessService } from '../services/access';
import type { ApiClientService, ApplicationService, RoleQueryService } from '../services/applications';

const idParams = z.object({ id: z.uuid() });

export function applicationRoutes(
  app: ModuleRouter,
  ctx: ModuleContext,
  apps: ApplicationService,
  clients: ApiClientService,
  roleQuery: RoleQueryService,
  access: AccessService,
) {
  const tags = ['Applications'];
  const read = { permission: 'core.applications.read', scoped: true };
  const manage = { permission: 'core.applications.manage', scoped: true };

  app.get(
    '/applications',
    {
      config: read,
      schema: {
        tags,
        summary: 'Applications whose access the platform manages',
        querystring: applicationListQuerySchema,
        response: { 200: z.object({ items: z.array(applicationSchema) }) },
      },
    },
    async (req) => ({ items: await apps.list(req.query, req.auth) }),
  );

  app.post(
    '/applications',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Register an application',
        body: createApplicationSchema,
        response: { 201: applicationSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await apps.create(req.body, req.auth)),
  );

  app.get(
    '/applications/:id',
    {
      config: read,
      schema: { tags, summary: 'An application', params: idParams, response: { 200: applicationSchema } },
    },
    async (req) => apps.get(req.params.id, req.auth),
  );

  app.patch(
    '/applications/:id',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Edit an application',
        params: idParams,
        body: updateApplicationSchema,
        response: { 200: applicationSchema },
      },
    },
    async (req) => apps.update(req.params.id, req.body, req.auth),
  );

  app.delete(
    '/applications/:id',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Delete an application with its roles and grants',
        params: idParams,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await apps.remove(req.params.id, req.auth);
      return { ok: true as const };
    },
  );

  app.get(
    '/applications/:id/permissions',
    {
      config: read,
      schema: {
        tags,
        summary: 'Permission catalog',
        params: idParams,
        response: { 200: z.object({ items: z.array(appPermissionSchema) }) },
      },
    },
    async (req) => ({ items: await apps.permissions(req.params.id, req.auth) }),
  );

  app.post(
    '/applications/:id/permissions',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Add a permission',
        params: idParams,
        body: createAppPermissionSchema,
        response: { 200: z.object({ items: z.array(appPermissionSchema) }) },
      },
    },
    async (req) => ({ items: await apps.addPermission(req.params.id, req.body, req.auth) }),
  );

  app.delete(
    '/applications/:id/permissions/:permissionId',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Remove a permission',
        params: z.object({ id: z.uuid(), permissionId: z.uuid() }),
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await apps.removePermission(req.params.id, req.params.permissionId, req.auth);
      return { ok: true as const };
    },
  );

  app.get(
    '/applications/:id/roles',
    {
      config: read,
      schema: {
        tags,
        summary: 'Roles of the application',
        params: idParams,
        response: { 200: z.object({ items: z.array(roleSchema) }) },
      },
    },
    async (req) => ({ items: await apps.roles(req.params.id, req.auth) }),
  );

  app.post(
    '/applications/:id/roles',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Create a role',
        params: idParams,
        body: createAppRoleSchema,
        response: { 201: roleSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await apps.createRole(req.params.id, req.body, req.auth)),
  );

  const roleParams = z.object({ id: z.uuid(), roleId: z.uuid() });
  app.put(
    '/applications/:id/roles/:roleId',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Edit a role',
        params: roleParams,
        body: createAppRoleSchema,
        response: { 200: roleSchema },
      },
    },
    async (req) => apps.updateRole(req.params.id, req.params.roleId, req.body, req.auth),
  );

  app.delete(
    '/applications/:id/roles/:roleId',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Delete a role and its grants',
        params: roleParams,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await apps.deleteRole(req.params.id, req.params.roleId, req.auth);
      return { ok: true as const };
    },
  );

  app.get(
    '/applications/:id/assignments',
    {
      config: read,
      schema: {
        tags,
        summary: 'Who holds which role',
        params: idParams,
        querystring: appMembersQuerySchema,
        response: { 200: pageSchema(roleAssignmentSchema) },
      },
    },
    async (req) => apps.members(req.params.id, req.query, req.auth),
  );

  app.post(
    '/applications/:id/assignments',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Grant an application role',
        params: idParams,
        body: createRoleAssignmentSchema,
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send({ id: (await access.assign(req.body, req.auth, { applicationId: req.params.id })).id }),
  );

  app.delete(
    '/applications/:id/assignments/:assignmentId',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Revoke an application role',
        params: z.object({ id: z.uuid(), assignmentId: z.uuid() }),
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await access.revoke(req.params.assignmentId, req.auth, { applicationId: req.params.id });
      return { ok: true as const };
    },
  );

  app.put(
    '/roles/:id/request-settings',
    {
      config: { permission: 'core.roles.manage' },
      schema: {
        tags: ['Roles & permissions'],
        summary:
          'Self-service settings of a platform role: requestable, risk, owner, longest grant, workflow',
        params: idParams,
        body: roleRequestSettingsSchema,
        response: { 200: roleSchema },
      },
    },
    async (req) => access.updateRequestSettings(req.params.id, req.body, req.auth),
  );

  app.put(
    '/applications/:id/roles/:roleId/request-settings',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Self-service settings of an application role',
        params: roleParams,
        body: roleRequestSettingsSchema,
        response: { 200: roleSchema },
      },
    },
    async (req) =>
      access.updateRequestSettings(req.params.roleId, req.body, req.auth, { applicationId: req.params.id }),
  );

  /* ───────────── API clients ───────────── */

  const clientTags = ['API clients'];
  const clientsManage = { permission: 'core.api-clients.manage' };

  app.get(
    '/api-clients',
    {
      config: clientsManage,
      schema: {
        tags: clientTags,
        summary: 'API clients',
        response: { 200: z.object({ items: z.array(apiClientSchema) }) },
      },
    },
    async () => ({ items: await clients.list() }),
  );

  app.post(
    '/api-clients',
    {
      config: clientsManage,
      schema: {
        tags: clientTags,
        summary: 'Create an API client — the secret is returned once',
        body: createApiClientSchema,
        response: { 201: createdSecretSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await clients.create(req.body, req.auth)),
  );

  app.get(
    '/api-clients/:id',
    {
      config: clientsManage,
      schema: {
        tags: clientTags,
        summary: 'An API client',
        params: idParams,
        response: { 200: apiClientSchema },
      },
    },
    async (req) => clients.get(req.params.id),
  );

  app.patch(
    '/api-clients/:id',
    {
      config: clientsManage,
      schema: {
        tags: clientTags,
        summary: 'Edit reach (outstanding OAuth tokens are revoked)',
        params: idParams,
        body: updateApiClientSchema,
        response: { 200: apiClientSchema },
      },
    },
    async (req) => clients.update(req.params.id, req.body, req.auth),
  );

  app.post(
    '/api-clients/:id/secrets',
    {
      config: clientsManage,
      schema: {
        tags: clientTags,
        summary: 'Add a secret for rotation — returned once',
        params: idParams,
        body: rotateSecretSchema,
        response: { 201: createdSecretSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await clients.rotate(req.params.id, req.body.expiresInDays, req.auth)),
  );

  app.delete(
    '/api-clients/:id/secrets/:secretId',
    {
      config: clientsManage,
      schema: {
        tags: clientTags,
        summary: 'Revoke one secret',
        params: z.object({ id: z.uuid(), secretId: z.uuid() }),
        response: { 200: apiClientSchema },
      },
    },
    async (req) => clients.revokeSecret(req.params.id, req.params.secretId),
  );

  app.post(
    '/api-clients/:id/revoke',
    {
      config: clientsManage,
      schema: {
        tags: clientTags,
        summary: 'Revoke the client and all its credentials',
        params: idParams,
        response: { 200: apiClientSchema },
      },
    },
    async (req) => clients.revoke(req.params.id),
  );

  /* ───────────── Role Query API ───────────── */

  const rqTags = ['Role Query API'];
  const rq = { permission: 'core.role-query.read', scoped: true };

  app.get(
    '/role-query/users/:user',
    {
      config: rq,
      schema: {
        tags: rqTags,
        summary: 'Roles and permissions of a user (id, email or username) in an application',
        params: z.object({ user: z.string().min(1).max(320) }),
        querystring: roleQueryUserQuerySchema,
        response: { 200: roleQueryResultSchema },
      },
    },
    async (req) => roleQuery.access(req.params.user, req.query.application, req.auth),
  );

  app.post(
    '/role-query/check',
    {
      config: rq,
      schema: {
        tags: rqTags,
        summary: 'Is the user allowed one permission (optionally for a department or record)?',
        body: roleQueryCheckSchema,
        response: { 200: roleQueryCheckResultSchema },
      },
    },
    async (req) => roleQuery.check(req.body, req.auth),
  );

  app.get(
    '/role-query/applications/:app/members',
    {
      config: rq,
      schema: {
        tags: rqTags,
        summary: 'Everyone holding a role in the application (for provisioning sync)',
        params: z.object({ app: z.string().min(1).max(64) }),
        querystring: roleQueryMembersQuerySchema,
        response: { 200: pageSchema(roleQueryMemberSchema) },
      },
    },
    async (req) => roleQuery.members(req.params.app, req.query, req.auth),
  );

  /** RFC 6749 §4.4 — client credentials in the body or HTTP Basic; RFC-style errors. */
  app.post(
    '/oauth/token',
    {
      config: { public: true, csrf: false, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: rqTags,
        summary: 'OAuth 2.0 client-credentials token',
        consumes: ['application/x-www-form-urlencoded', 'application/json'],
        body: oauthTokenRequestSchema,
        response: { 200: oauthTokenResponseSchema, 400: oauthErrorSchema, 401: oauthErrorSchema },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
      if (req.body.grant_type !== 'client_credentials')
        return reply.status(400).send({ error: 'unsupported_grant_type' });
      let id = req.body.client_id;
      let secret = req.body.client_secret;
      const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      if (basic) {
        const decoded = Buffer.from(basic, 'base64').toString('utf8');
        const at = decoded.indexOf(':');
        if (at > 0) {
          id = decodeURIComponent(decoded.slice(0, at));
          secret = decodeURIComponent(decoded.slice(at + 1));
        }
      }
      if (!id || !secret) return reply.status(401).send({ error: 'invalid_client' });
      const result = await getKernel().apiClients.issueToken(id, secret, req.body.scope, req.ip);
      if (!result.ok) {
        if (result.error === 'invalid_scope') return reply.status(400).send({ error: result.error });
        await ctx.audit.record({
          action: 'core.api-client.auth_failed',
          category: 'security',
          outcome: 'failure',
          metadata: { clientId: id.slice(0, 64), grant: 'client_credentials' },
        });
        return reply
          .status(401)
          .header('www-authenticate', 'Basic realm="isbp"')
          .send({ error: 'invalid_client' });
      }
      return {
        access_token: result.token,
        token_type: 'Bearer' as const,
        expires_in: result.expiresIn,
        scope: result.scopes.join(' '),
      };
    },
  );
}
