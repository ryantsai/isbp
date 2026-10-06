import { users } from '@isbp/db/schema';
import { httpErrors, likePattern, type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { createItemSchema, itemQuerySchema, itemSchema, updateItemSchema } from '../contracts';
import { items } from './schema';

const idParams = z.object({ id: z.uuid() });
const tags = ['__TITLE__'];

export async function findItem(ctx: ModuleContext, id: string) {
  const [row] = await ctx.db
    .select({ item: items, ownerName: users.displayName })
    .from(items)
    .leftJoin(users, eq(users.id, items.ownerId))
    .where(eq(items.id, id));
  if (!row) throw httpErrors.notFound('Item not found');
  return toDto(row.item, row.ownerName);
}

function toDto(item: typeof items.$inferSelect, ownerName: string | null) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    owner: item.ownerId ? { id: item.ownerId, displayName: ownerName ?? '—' } : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** REST API mounted at /api/v1/__ID__ — every route is authenticated and permission-gated. */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  app.get(
    '/items',
    {
      config: { permission: '__ID__.items.read' },
      schema: { tags, summary: 'List items', querystring: itemQuerySchema, response: { 200: pageSchema(itemSchema) } },
    },
    async (req) => {
      const q = req.query;
      const where = and(
        q.status ? eq(items.status, q.status) : undefined,
        q.q ? or(ilike(items.title, likePattern(q.q)), ilike(items.description, likePattern(q.q))) : undefined,
      );
      const sortable = { title: items.title, status: items.status, createdAt: items.createdAt, updatedAt: items.updatedAt };
      const key = (q.sort?.replace(/^-/, '') ?? 'updatedAt') as keyof typeof sortable;
      const column = sortable[key] ?? items.updatedAt;
      const direction = q.sort ? (q.sort.startsWith('-') ? desc : asc) : desc;
      const [rows, [total]] = await Promise.all([
        ctx.db
          .select({ item: items, ownerName: users.displayName })
          .from(items)
          .leftJoin(users, eq(users.id, items.ownerId))
          .where(where)
          .orderBy(direction(column), asc(items.id))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        ctx.db.select({ n: count() }).from(items).where(where),
      ]);
      return { items: rows.map((r) => toDto(r.item, r.ownerName)), total: total!.n, page: q.page, pageSize: q.pageSize };
    },
  );

  app.post(
    '/items',
    {
      config: { permission: '__ID__.items.manage' },
      schema: { tags, summary: 'Create an item', body: createItemSchema, response: { 201: itemSchema } },
    },
    async (req, reply) => {
      const status = req.body.status ?? ((await ctx.settings.get<string>('defaultStatus')) as 'draft' | 'active') ?? 'draft';
      const created = await ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(items)
          .values({ ...req.body, status, ownerId: req.body.ownerId ?? req.auth.user?.id ?? null, createdBy: req.auth.user?.id ?? null })
          .returning();
        await ctx.audit.record({ action: '__ID__.item.created', entityType: '__ID__.item', entityId: row!.id, entityLabel: row!.title }, { tx });
        await ctx.events.publish('__ID__.item.created', { itemId: row!.id, title: row!.title }, { tx });
        return row!;
      });
      return reply.status(201).send(await findItem(ctx, created.id));
    },
  );

  app.get(
    '/items/:id',
    { config: { permission: '__ID__.items.read' }, schema: { tags, summary: 'Get an item', params: idParams, response: { 200: itemSchema } } },
    async (req) => findItem(ctx, req.params.id),
  );

  app.patch(
    '/items/:id',
    {
      config: { permission: '__ID__.items.manage' },
      schema: { tags, summary: 'Update an item', params: idParams, body: updateItemSchema, response: { 200: itemSchema } },
    },
    async (req) => {
      const [before] = await ctx.db.select().from(items).where(eq(items.id, req.params.id));
      if (!before) throw httpErrors.notFound('Item not found');
      const changes = ctx.audit.diff(before as unknown as Record<string, unknown>, req.body as Record<string, unknown>);
      if (Object.keys(changes).length) {
        await ctx.transaction(async (tx) => {
          await tx.update(items).set(req.body).where(eq(items.id, before.id));
          await ctx.audit.record({ action: '__ID__.item.updated', entityType: '__ID__.item', entityId: before.id, entityLabel: req.body.title ?? before.title, changes }, { tx });
          await ctx.events.publish('__ID__.item.updated', { itemId: before.id, title: req.body.title ?? before.title, changes: Object.keys(changes) }, { tx });
        });
      }
      return findItem(ctx, before.id);
    },
  );

  app.delete(
    '/items/:id',
    { config: { permission: '__ID__.items.manage' }, schema: { tags, summary: 'Delete an item', params: idParams, response: { 204: z.undefined() } } },
    async (req, reply) => {
      const item = await findItem(ctx, req.params.id);
      await ctx.transaction(async (tx) => {
        await tx.delete(items).where(eq(items.id, item.id));
        await ctx.audit.record({ action: '__ID__.item.deleted', entityType: '__ID__.item', entityId: item.id, entityLabel: item.title }, { tx });
        await ctx.events.publish('__ID__.item.deleted', { itemId: item.id, title: item.title }, { tx });
      });
      return reply.status(204).send();
    },
  );
}
