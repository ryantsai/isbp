import {
  createDepartmentSchema,
  createGroupSchema,
  departmentSchema,
  groupListQuerySchema,
  groupMemberSchema,
  groupMembersInputSchema,
  groupSchema,
  okSchema,
  updateDepartmentSchema,
  updateGroupSchema,
} from '@isbp/contracts';
import { listQuerySchema, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import type { DirectoryService } from '../services/directory';

const idParams = z.object({ id: z.uuid() });

export function directoryRoutes(app: ModuleRouter, svc: DirectoryService) {
  /* departments */
  const dTags = ['Departments'];

  app.get(
    '/departments',
    {
      config: { permission: 'core.departments.read' },
      schema: {
        tags: dTags,
        summary: 'Whole org hierarchy (flat, parent ids + materialized paths)',
        response: { 200: z.object({ items: z.array(departmentSchema) }) },
      },
    },
    async () => ({ items: await svc.listDepartments() }),
  );

  app.post(
    '/departments',
    {
      config: { permission: 'core.departments.manage', scoped: true },
      schema: {
        tags: dTags,
        summary: 'Create a department',
        body: createDepartmentSchema,
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) => reply.status(201).send({ id: (await svc.createDepartment(req.body, req.auth)).id }),
  );

  app.patch(
    '/departments/:id',
    {
      config: { permission: 'core.departments.manage', scoped: true },
      schema: {
        tags: dTags,
        summary: 'Update or move a department',
        params: idParams,
        body: updateDepartmentSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await svc.updateDepartment(req.params.id, req.body, req.auth);
      return { ok: true as const };
    },
  );

  app.delete(
    '/departments/:id',
    {
      config: { permission: 'core.departments.manage', scoped: true },
      schema: {
        tags: dTags,
        summary: 'Delete an empty department',
        params: idParams,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await svc.deleteDepartment(req.params.id, req.auth);
      return { ok: true as const };
    },
  );

  /* groups */
  const gTags = ['Groups'];

  app.get(
    '/groups',
    {
      config: { permission: 'core.groups.read' },
      schema: {
        tags: gTags,
        summary: 'List groups',
        querystring: groupListQuerySchema,
        response: { 200: pageSchema(groupSchema) },
      },
    },
    async (req) => svc.listGroups(req.query),
  );

  app.post(
    '/groups',
    {
      config: { permission: 'core.groups.manage' },
      schema: {
        tags: gTags,
        summary: 'Create a group',
        body: createGroupSchema,
        response: { 201: groupSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await svc.getGroup((await svc.createGroup(req.body, req.auth)).id)),
  );

  app.get(
    '/groups/:id',
    {
      config: { permission: 'core.groups.read' },
      schema: { tags: gTags, summary: 'Group details', params: idParams, response: { 200: groupSchema } },
    },
    async (req) => svc.getGroup(req.params.id),
  );

  app.patch(
    '/groups/:id',
    {
      config: { permission: 'core.groups.manage', scoped: true },
      schema: {
        tags: gTags,
        summary: 'Update a group',
        params: idParams,
        body: updateGroupSchema,
        response: { 200: groupSchema },
      },
    },
    async (req) => {
      await svc.updateGroup(req.params.id, req.body, req.auth);
      return svc.getGroup(req.params.id);
    },
  );

  app.delete(
    '/groups/:id',
    {
      config: { permission: 'core.groups.manage', scoped: true },
      schema: { tags: gTags, summary: 'Delete a group', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await svc.deleteGroup(req.params.id, req.auth);
      return { ok: true as const };
    },
  );

  app.get(
    '/groups/:id/members',
    {
      config: { permission: 'core.groups.read' },
      schema: {
        tags: gTags,
        summary: 'Group members',
        params: idParams,
        querystring: listQuerySchema,
        response: { 200: pageSchema(groupMemberSchema) },
      },
    },
    async (req) => svc.listMembers(req.params.id, req.query),
  );

  app.post(
    '/groups/:id/members',
    {
      config: { permission: 'core.groups.manage', scoped: true },
      schema: {
        tags: gTags,
        summary: 'Add members',
        params: idParams,
        body: groupMembersInputSchema,
        response: { 200: z.object({ added: z.number() }) },
      },
    },
    async (req) => ({ added: await svc.addMembers(req.params.id, req.body.userIds, req.auth) }),
  );

  app.post(
    '/groups/:id/members/remove',
    {
      config: { permission: 'core.groups.manage', scoped: true },
      schema: {
        tags: gTags,
        summary: 'Remove members',
        params: idParams,
        body: groupMembersInputSchema,
        response: { 200: z.object({ removed: z.number() }) },
      },
    },
    async (req) => ({ removed: await svc.removeMembers(req.params.id, req.body.userIds, req.auth) }),
  );
}
