import { defineServerModule, likePattern, type RecordSummary, type StatusTone } from '@isbp/sdk/server';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import migrations from '../../migrations';
import {
  aiCreateDraftInput,
  aiGetArticleInput,
  aiSearchArticlesInput,
  type AiCreateDraftOutput,
  type AiSearchArticlesOutput,
  articleHref,
  articleReference,
  parseArticleRef,
} from '../contracts';
import { type ArticleFacts, manifest } from '../manifest';
import { canEdit } from '../lifecycle';
import { ArticleService, INDEX_TYPE, viewerOf, visibleWhere } from './articles';
import { importGuide } from './guide';
import { routes } from './routes';
import { articles, categories } from './schema';
import { seedKnowledge } from './seed';
import { sync } from './sync';

export { importGuide } from './guide';

type ArticleEvent = { articleId: string };

export default defineServerModule(manifest, {
  migrations,
  routes,

  workflows: {
    'knowledge.publish': {
      onCompleted: (result, ctx) => new ArticleService(ctx).onReviewCompleted(result),
    },
  },

  /**
   * The semantic index follows our own lifecycle events, after commit: embedding may call a remote
   * provider, which must never happen inside a transaction. Handlers re-read the article, so they are
   * idempotent and order-independent.
   */
  events: {
    'knowledge.article.published': (event, ctx) =>
      new ArticleService(ctx).syncIndex((event.payload as ArticleEvent).articleId),
    'knowledge.article.updated': async (event, ctx) => {
      const p = event.payload as ArticleEvent & { status: string };
      // Metadata of a live article (category, tags, audience → ACL) changed.
      if (p.status === 'published') await new ArticleService(ctx).syncIndex(p.articleId);
    },
    'knowledge.article.retired': (event, ctx) =>
      new ArticleService(ctx).syncIndex((event.payload as ArticleEvent).articleId),
    'knowledge.article.deleted': (event, ctx) =>
      ctx.ai.index.remove(INDEX_TYPE, (event.payload as ArticleEvent).articleId),
    'core.user.offboarded': async (event, ctx) => {
      await new ArticleService(ctx).releaseOwner((event.payload as { userId: string }).userId);
    },
  },

  jobs: {
    'guide-sync': {
      description:
        'Publishes the user guide ("Using IS Big Platform") when a new version of the platform ships it',
      schedule: { everyMs: 15 * 60_000 },
      attempts: 2,
      handler: async (job, ctx) => {
        const published = await importGuide(ctx);
        if (published) await job.log(`published ${published} guide article(s)`);
        return { published };
      },
    },
    'reindex-articles': {
      description: 'Re-embeds every published article in the semantic index (weekly, or run it manually)',
      schedule: { cron: '0 3 * * 0' },
      attempts: 2,
      timeoutMs: 30 * 60_000,
      handler: async (job, ctx) => new ArticleService(ctx).reindexAll((m) => job.log(m)),
    },
    'review-reminders': {
      description: 'Reminds owners of published articles that are past their review date',
      schedule: { cron: '0 9 * * *', tz: 'Asia/Taipei' },
      attempts: 3,
      handler: async (job, ctx) => {
        const sent = await new ArticleService(ctx).remindReviews();
        if (sent) await job.log(`reminded owners of ${sent} article(s)`);
        return { reminded: sent };
      },
    },
  },

  ai: {
    'knowledge.search_articles': async (input, ctx, auth): Promise<AiSearchArticlesOutput> => {
      const { query, limit, locale, categoryIds } = aiSearchArticlesInput.parse(input);
      const { items } = await new ArticleService(ctx).search(query, {
        auth,
        limit,
        locale: locale ?? auth.user?.locale ?? null,
        categoryIds,
      });
      return {
        items: items.map(
          ({ id, number, reference, title, summary, snippet, href, score, similarity, attachment }) => ({
            id,
            number,
            reference,
            title,
            summary,
            snippet,
            href,
            score,
            similarity,
            attachment: attachment ?? null,
          }),
        ),
      };
    },
    'knowledge.get_article': async (input, ctx, auth) =>
      new ArticleService(ctx).forAi(aiGetArticleInput.parse(input), auth),
    'knowledge.create_draft': async (input, ctx, auth): Promise<AiCreateDraftOutput> => {
      const v = aiCreateDraftInput.parse(input);
      const svc = new ArticleService(ctx);
      const row = await svc.create(
        {
          title: v.title,
          summary: v.summary ?? '',
          body: v.body,
          categoryId: await svc.categoryIdByKey(v.categoryKey),
          tags: [...new Set((v.tags ?? []).map((t) => t.toLowerCase()))],
          // Omitted: the caller's language (`create` picks it), never silently English.
          locale: v.locale,
          audience: v.audience,
          translationOf: null,
          reviewAt: null,
          source: v.source ?? null,
        },
        auth,
        auth.user?.id ?? null,
      );
      return {
        id: row.id,
        number: row.number,
        reference: articleReference(row.number),
        href: articleHref(row.number),
      };
    },
  },

  search: async (query, ctx, auth, limit) => {
    if (!auth.permissions.hasAny('knowledge.articles.read')) return [];
    return new ArticleService(ctx).quickFind(query, auth, limit);
  },

  /**
   * Articles as linkable records (e.g. a problem ↔ its known-error article), visible as on the site. `editable` (links
   * and attachments, through the core panels) follows who may edit the article; readers download its attachments.
   */
  records: {
    article: {
      async resolve(ids, ctx, auth) {
        const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
        if (!valid.length) return [];
        const v = viewerOf(auth);
        const rows = await ctx.db
          .select()
          .from(articles)
          .where(and(inArray(articles.id, valid), visibleWhere(v)));
        return rows.map((a) => articleRecord(a, canEdit(a, v)));
      },
      async search(query, ctx, auth, limit) {
        const v = viewerOf(auth);
        const q = query.trim();
        const ref = q ? parseArticleRef(q) : null;
        const rows = await ctx.db
          .select()
          .from(articles)
          .where(
            and(
              visibleWhere(v),
              !q
                ? eq(articles.status, 'published')
                : or(
                    ilike(articles.title, likePattern(q)),
                    ref && 'number' in ref ? eq(articles.number, ref.number) : undefined,
                  ),
            ),
          )
          .orderBy(desc(articles.updatedAt))
          .limit(limit);
        return rows.map((a) => articleRecord(a, canEdit(a, v)));
      },
      /** Approval facts (`articleFactsSchema`), not permission-filtered: they route approvals. */
      async facts(ids, ctx) {
        const valid = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
        if (!valid.length) return new Map();
        const rows = await ctx.db
          .select({ article: articles, categoryKey: categories.key })
          .from(articles)
          .leftJoin(categories, eq(categories.id, articles.categoryId))
          .where(inArray(articles.id, valid));
        return new Map(
          rows.map(({ article: a, categoryKey }): [string, ArticleFacts] => [
            a.id,
            {
              audience: a.audience,
              categoryKey,
              status: a.status,
              locale: a.locale,
              ownerId: a.ownerId,
              tags: a.tags,
              classification: a.classification,
            },
          ]),
        );
      },
    },
  },

  sync,

  seed: seedKnowledge,
});

const STATUS_TONE: Record<(typeof articles.$inferSelect)['status'], StatusTone> = {
  draft: 'neutral',
  in_review: 'info',
  published: 'success',
  retired: 'neutral',
};

function articleRecord(a: typeof articles.$inferSelect, editable: boolean): RecordSummary {
  return {
    id: a.id,
    reference: articleReference(a.number),
    title: a.title,
    subtitle: a.summary.slice(0, 160) || null,
    status: { key: `knowledge.status.${a.status}`, tone: STATUS_TONE[a.status] },
    href: articleHref(a.number),
    editable,
  };
}
