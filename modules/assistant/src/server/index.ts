import { defineServerModule, likePattern } from '@isbp/sdk/server';
import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import migrations from '../../migrations';
import { changeSetHref, changeSetReference } from '../contracts';
import { manifest } from '../manifest';
import { ChangeSetService, REVIEW_TRIGGER } from './change-sets';
import { routes } from './routes';
import { changeSets } from './schema';
import { seed } from './seed';
import { aiTools } from './tools';

export { ChangeSetService, checkFromError, readableError } from './change-sets';

/**
 * The AI agent that customises the platform through change sets. Configuration surfaces are the customisation
 * kinds of every enabled module (`ctx.customizations`); this module never writes another module's tables.
 */
export default defineServerModule(manifest, {
  migrations,
  routes,
  ai: aiTools,

  workflows: {
    [REVIEW_TRIGGER]: { onCompleted: (result, ctx) => new ChangeSetService(ctx).onReviewCompleted(result) },
  },

  /** `CS-00012` or a title, among the change sets the caller may see. */
  search: async (query, ctx, auth, limit) => {
    if (!auth.can('assistant.agent.use')) return [];
    const mine = auth.user ? eq(changeSets.createdById, auth.user.id) : sql`false`;
    const rows = await ctx.db
      .select()
      .from(changeSets)
      .where(
        sql`${or(
          ilike(changeSets.title, likePattern(query)),
          sql`('CS-' || lpad(${changeSets.number}::text, 5, '0')) ilike ${likePattern(query)}`,
        )} and ${auth.can('assistant.change-sets.read') ? sql`true` : mine}`,
      )
      .orderBy(desc(changeSets.updatedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      type: 'change-set',
      title: `${changeSetReference(r.number)} ${r.title}`.trim(),
      status: `assistant.status.${r.status}`,
      href: changeSetHref(r.id),
      icon: 'git-pull-request-arrow',
    }));
  },

  seed,
});
