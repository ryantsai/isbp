import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import {
  aiCreateDraftInput,
  aiGetArticleInput,
  aiSearchArticlesInput,
  type AiCreateDraftOutput,
  type AiSearchArticlesOutput,
  articleHref,
  articleReference,
} from '../contracts';
import { manifest } from '../manifest';
import { ArticleService, INDEX_TYPE } from './articles';
import { routes } from './routes';
import { seedKnowledge } from './seed';

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
      const { query, limit, locale } = aiSearchArticlesInput.parse(input);
      const { items } = await new ArticleService(ctx).search(query, {
        auth,
        limit,
        locale: locale ?? auth.user?.locale ?? null,
      });
      return {
        items: items.map(({ id, number, reference, title, summary, snippet, href, score, similarity }) => ({
          id,
          number,
          reference,
          title,
          summary,
          snippet,
          href,
          score,
          similarity,
        })),
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

  seed: seedKnowledge,
});
