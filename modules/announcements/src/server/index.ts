import { defineServerModule, likePattern } from '@isbp/sdk/server';
import { and, count, desc, eq, ilike, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { routes } from './routes';
import { posts } from './schema';
import { currentCondition, PostService, toDto } from './service';

export default defineServerModule(manifest, {
  migrations,
  routes,

  workflows: {
    'announcements.publish': {
      onCompleted: (result, ctx) => new PostService(ctx).onReviewCompleted(result),
    },
  },

  events: {
    /** Drafts of people who leave would be orphaned — archive them (published posts stay). */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      const drafts = await ctx.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.authorId, userId), eq(posts.status, 'draft')));
      const svc = new PostService(ctx);
      for (const d of drafts) await svc.archive(d.id, 'manual');
    },
  },

  jobs: {
    'expire-posts': {
      description: 'Archives published announcements whose window has ended',
      schedule: { everyMs: 5 * 60_000 },
      handler: async (job, ctx) => {
        const ended = await ctx.db
          .select({ id: posts.id })
          .from(posts)
          .where(and(eq(posts.status, 'published'), lte(posts.endsAt, sql`now()`)))
          .limit(200);
        const svc = new PostService(ctx);
        for (const p of ended) await svc.archive(p.id, 'expired');
        if (ended.length) await job.log(`archived ${ended.length} ended announcement(s)`);
        return { archived: ended.length };
      },
    },
  },

  ai: {
    'announcements.list_current': async (input, ctx) => {
      const { severity, limit } = z
        .object({
          severity: z.enum(['info', 'maintenance', 'incident']).optional(),
          limit: z.number().default(10),
        })
        .parse(input);
      const rows = await ctx.db
        .select()
        .from(posts)
        .where(and(currentCondition(), severity ? eq(posts.severity, severity) : undefined))
        .orderBy(desc(posts.pinned), desc(posts.publishedAt))
        .limit(limit);
      return rows.map((r) => toDto(r, null));
    },
    'announcements.publish_post': async (input, ctx, auth) => {
      const v = z
        .object({
          title: z.string(),
          body: z.string(),
          severity: z.enum(['info', 'maintenance', 'incident']),
          startsAt: z.string().optional(),
          endsAt: z.string().optional(),
        })
        .parse(input);
      const row = await new PostService(ctx).create(
        {
          title: v.title,
          body: v.body,
          severity: v.severity,
          pinned: false,
          publish: true,
          startsAt: v.startsAt ? new Date(v.startsAt) : null,
          endsAt: v.endsAt ? new Date(v.endsAt) : null,
        },
        auth.user?.id ?? null,
      );
      return { id: row.id, href: `/announcements/${row.id}` };
    },
  },

  search: async (query, ctx, auth, limit) => {
    if (!auth.permissions.hasAny('announcements.posts.read')) return [];
    const rows = await ctx.db
      .select({ id: posts.id, title: posts.title, severity: posts.severity })
      .from(posts)
      .where(
        and(
          eq(posts.status, 'published'),
          or(ilike(posts.title, likePattern(query)), ilike(posts.body, likePattern(query))),
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      type: 'announcement',
      title: r.title,
      status: `announcements.severity.${r.severity}`,
      href: `/announcements/${r.id}`,
      icon: 'megaphone',
    }));
  },

  seed: async (ctx) => {
    const [existing] = await ctx.db.select({ n: count() }).from(posts);
    if (existing!.n > 0) return;
    const hour = 3_600_000;
    const now = Date.now();
    const saturday = new Date(now + ((6 - new Date(now).getDay() + 7) % 7 || 7) * 24 * hour);
    saturday.setHours(22, 0, 0, 0);
    await ctx.db.insert(posts).values([
      {
        title: 'Planned maintenance: core network switches',
        body: 'The data-centre core switches will be upgraded. VPN and Wi-Fi may drop for up to 15 minutes during the window. No action is required.',
        severity: 'maintenance',
        status: 'published',
        pinned: true,
        startsAt: saturday,
        endsAt: new Date(saturday.getTime() + 4 * hour),
        publishedAt: new Date(now - 26 * hour),
      },
      {
        title: 'Resolved: e-mail delivery delays',
        body: 'Outbound e-mail was delayed by up to 20 minutes between 09:10 and 09:45 due to a relay certificate renewal. All queued messages have been delivered.',
        severity: 'incident',
        status: 'published',
        publishedAt: new Date(now - 5 * hour),
      },
      {
        title: 'New: request database access through IS Big Platform',
        body: 'Database access requests, approvals and automatic revocation are moving to the platform. Watch this space for the rollout schedule.',
        severity: 'info',
        status: 'published',
        publishedAt: new Date(now - 72 * hour),
      },
      {
        title: 'Draft: Q4 laptop refresh programme',
        body: 'Eligible devices, ordering windows and data-migration help.',
        severity: 'info',
        status: 'draft',
      },
    ]);
  },
});
