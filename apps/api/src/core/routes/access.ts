import {
  createRoleAssignmentSchema,
  createRoleSchema,
  okSchema,
  permissionSchema,
  roleAssignmentQuerySchema,
  roleAssignmentSchema,
  roleSchema,
  updateRoleSchema,
} from '@isbp/contracts';
import { type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import type { AccessService } from '../services/access';

const idParams = z.object({ id: z.uuid() });

export function accessRoutes(app: ModuleRouter, svc: AccessService) {
  const tags = ['Roles & permissions'];

  app.get(
    '/permissions',
    {
      config: { permission: 'core.roles.read' },
      schema: {
        tags,
        summary: 'Permission catalog (synced from module manifests)',
        response: { 200: z.object({ items: z.array(permissionSchema) }) },
      },
    },
    async () => ({ items: await svc.permissionCatalog() }),
  );

  app.get(
    '/roles',
    {
      config: { permission: 'core.roles.read' },
      schema: {
        tags,
        summary: 'List roles',
        querystring: z.object({ q: z.string().max(200).optional() }),
        response: { 200: z.object({ items: z.array(roleSchema) }) },
      },
    },
    async (req) => ({ items: await svc.listRoles(req.query) }),
  );

  app.post(
    '/roles',
    {
      config: { permission: 'core.roles.manage' },
      schema: {
        tags,
        summary: 'Create a custom role',
        body: createRoleSchema,
        response: { 201: roleSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.createRole(req.body, req.auth)),
  );

  app.get(
    '/roles/:id',
    {
      config: { permission: 'core.roles.read' },
      schema: { tags, summary: 'Role details', params: idParams, response: { 200: roleSchema } },
    },
    async (req) => svc.getRole(req.params.id),
  );

  app.patch(
    '/roles/:id',
    {
      config: { permission: 'core.roles.manage' },
      schema: {
        tags,
        summary: 'Update a custom role',
        params: idParams,
        body: updateRoleSchema,
        response: { 200: roleSchema },
      },
    },
    async (req) => svc.updateRole(req.params.id, req.body, req.auth),
  );

  app.delete(
    '/roles/:id',
    {
      config: { permission: 'core.roles.manage' },
      schema: { tags, summary: 'Delete a custom role', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await svc.deleteRole(req.params.id);
      return { ok: true as const };
    },
  );

  app.get(
    '/role-assignments',
    {
      config: { permission: 'core.roles.read' },
      schema: {
        tags,
        summary: 'List role assignments',
        querystring: roleAssignmentQuerySchema,
        response: { 200: pageSchema(roleAssignmentSchema) },
      },
    },
    async (req) => svc.listAssignments(req.query, req.auth),
  );

  app.post(
    '/role-assignments',
    {
      config: { permission: 'core.roles.assign', scoped: true },
      schema: {
        tags,
        summary: 'Grant a role to a user or group (optionally scoped and time-bound)',
        body: createRoleAssignmentSchema,
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) => reply.status(201).send({ id: (await svc.assign(req.body, req.auth)).id }),
  );

  app.delete(
    '/role-assignments/:id',
    {
      config: { permission: 'core.roles.assign', scoped: true },
      schema: { tags, summary: 'Revoke a role assignment', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await svc.revoke(req.params.id, req.auth);
      return { ok: true as const };
    },
  );
}
