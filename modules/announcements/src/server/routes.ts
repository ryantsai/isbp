import { type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import { createPostSchema, postQuerySchema, postSchema, updatePostSchema } from '../contracts';
import { PostService } from './service';

const idParams = z.object({ id: z.uuid() });
const tags = ['Announcements'];
const MANAGE = 'announcements.posts.manage';

/** REST API mounted at /api/v1/announcements. */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const svc = new PostService(ctx);

  app.get(
    '/posts',
    {
      config: { permission: 'announcements.posts.read' },
      schema: {
        tags,
        summary: 'List announcements (current, drafts or archive)',
        querystring: postQuerySchema,
        response: { 200: pageSchema(postSchema) },
      },
    },
    async (req) => svc.list(req.query, req.auth.can(MANAGE)),
  );

  app.post(
    '/posts',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Write an announcement (optionally publish immediately)',
        body: createPostSchema,
        response: { 201: postSchema },
      },
    },
    async (req, reply) => {
      const row = await svc.create(req.body, req.auth.user?.id ?? null);
      return reply.status(201).send(await svc.find(row.id, true));
    },
  );

  app.get(
    '/posts/:id',
    {
      config: { permission: 'announcements.posts.read' },
      schema: { tags, summary: 'Get an announcement', params: idParams, response: { 200: postSchema } },
    },
    async (req) => svc.find(req.params.id, req.auth.can(MANAGE)),
  );

  app.patch(
    '/posts/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Edit an announcement',
        params: idParams,
        body: updatePostSchema,
        response: { 200: postSchema },
      },
    },
    async (req) => {
      await svc.update(req.params.id, req.body);
      return svc.find(req.params.id, true);
    },
  );

  app.post(
    '/posts/:id/publish',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Publish a draft (or send it for approval when a review workflow is bound)',
        params: idParams,
        response: { 200: postSchema },
      },
    },
    async (req) => {
      await svc.publish(req.params.id, req.auth.user?.id ?? null);
      return svc.find(req.params.id, true);
    },
  );

  app.post(
    '/posts/:id/withdraw',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Withdraw a post from review (back to draft)',
        params: idParams,
        response: { 200: postSchema },
      },
    },
    async (req) => {
      await svc.withdraw(req.params.id);
      return svc.find(req.params.id, true);
    },
  );

  app.post(
    '/posts/:id/archive',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Archive (unpublish) an announcement',
        params: idParams,
        response: { 200: postSchema },
      },
    },
    async (req) => {
      await svc.archive(req.params.id, 'manual');
      return svc.find(req.params.id, true);
    },
  );

  app.delete(
    '/posts/:id',
    {
      config: { permission: MANAGE },
      schema: { tags, summary: 'Delete an announcement', params: idParams, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      await svc.remove(req.params.id);
      return reply.status(204).send();
    },
  );
}
