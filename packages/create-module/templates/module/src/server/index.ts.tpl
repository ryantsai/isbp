import { defineServerModule, likePattern } from '@isbp/sdk/server';
import { count, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { routes } from './routes';
import { items } from './schema';

export default defineServerModule(manifest, {
  migrations,
  routes,

  /** React to other modules without importing them: core tells us someone left. */
  events: {
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      const released = await ctx.db.update(items).set({ ownerId: null }).where(eq(items.ownerId, userId)).returning({ id: items.id });
      if (released.length) {
        await ctx.audit.record({ action: '__ID__.items.owner_released', entityType: 'user', entityId: userId, metadata: { items: released.length } });
      }
    },
  },

  jobs: {
    'nightly-stats': {
      description: 'Logs how many items exist per status (example scheduled job)',
      schedule: { cron: '0 2 * * *' },
      handler: async (job, ctx) => {
        const rows = await ctx.db.select({ status: items.status, n: count() }).from(items).groupBy(items.status);
        await job.log(JSON.stringify(rows));
        return rows;
      },
    },
  },

  ai: {
    '__ID__.list_items': async (input, ctx) => {
      const { query, status, limit } = z
        .object({ query: z.string().optional(), status: z.enum(['draft', 'active', 'archived']).optional(), limit: z.number().default(10) })
        .parse(input);
      return ctx.db
        .select({ id: items.id, title: items.title, status: items.status, updatedAt: items.updatedAt })
        .from(items)
        .where(status ? eq(items.status, status) : query ? ilike(items.title, likePattern(query)) : undefined)
        .orderBy(desc(items.updatedAt))
        .limit(limit);
    },
  },

  search: async (query, ctx, auth, limit) => {
    if (!auth.can('__ID__.items.read')) return [];
    const rows = await ctx.db
      .select({ id: items.id, title: items.title, status: items.status })
      .from(items)
      .where(or(ilike(items.title, likePattern(query)), ilike(items.description, likePattern(query))))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, type: 'item', title: r.title, subtitle: r.status, href: `/__ID__/${r.id}`, icon: '__ICON__' }));
  },

  seed: async (ctx) => {
    const [existing] = await ctx.db.select({ n: count() }).from(items);
    if (existing!.n > 0) return;
    await ctx.db.insert(items).values([
      { title: 'Welcome to __TITLE__', description: 'This sample item was created by the module seed.', status: 'active' },
      { title: 'A draft item', description: 'Drafts are only visible to people who can manage items.', status: 'draft' },
    ]);
  },
});
