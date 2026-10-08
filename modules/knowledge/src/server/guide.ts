import { type GuideArticle, guideArticles } from '@isbp/guide';
import { type AuthContext, httpErrors, type ModuleContext, PermissionSet } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { articleHref, articleReference, type ArticleLocale } from '../contracts';
import { ArticleService, viewerOf, visibleWhere } from './articles';
import { CategoryService } from './categories';
import { articles, categories, guideArticles as guideRows } from './schema';

/**
 * In-app help: publishes the user guide (`@isbp/guide`, generated from docs/guide) into the knowledge base — one
 * article per guide, its zh-TW and ja-JP versions as translations of the English one, in the "Using IS Big Platform"
 * category. The guide is the source of truth: articles whose text differs from the guide are republished from it.
 * Design: docs/architecture.md §14.2.
 */

export const GUIDE_CATEGORY = 'using-isbp';
export const GUIDE_TAG = 'isbp-guide';
const IMPORT_LOCK = 'guide-import';

/** Who the import runs as: the knowledge base itself, holding its own permissions. */
function guideAuth(): AuthContext {
  const permissions = new PermissionSet([{ p: 'knowledge.*', s: 'g' }]);
  return {
    principal: { type: 'system', id: null, name: 'IS Big Platform guide' },
    user: null,
    sessionId: null,
    permissions,
    can: (p, r) => permissions.can(p, r),
    require: (p, r) => {
      if (!permissions.can(p, r)) throw httpErrors.forbidden();
    },
    reach: (p) => permissions.reach(p),
  };
}

async function ensureCategory(ctx: ModuleContext): Promise<string> {
  const [row] = await ctx.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.key, GUIDE_CATEGORY));
  if (row) return row.id;
  const created = await new CategoryService(ctx).create({
    key: GUIDE_CATEGORY,
    name: {
      en: 'Using IS Big Platform',
      'zh-TW': '使用 IS Big Platform',
      'ja-JP': 'IS Big Platform の使い方',
    },
    description: {
      en: 'How to use the platform for our IT work: guides for every role, a glossary and answers to common questions.',
      'zh-TW': '如何使用本平台完成 IT 工作：各角色的指南、詞彙表與常見問題。',
      'ja-JP': 'IT 業務でプラットフォームを使う方法: ロール別のガイド、用語集、よくある質問。',
    },
    icon: 'life-buoy',
    sortOrder: 0,
  });
  return created.id;
}

/**
 * Publishes every guide article whose text changed (or that doesn't exist yet). English first, so translations can
 * join its translation group. Returns how many articles were published. Cheap when nothing changed (one query).
 * Does nothing when the `guide.publish` setting is off, or while another import runs (the seed and the job).
 */
export async function importGuide(ctx: ModuleContext): Promise<number> {
  if ((await ctx.settings.get<boolean>('guide.publish')) === false) return 0;
  if ((await ctx.cache.increment(IMPORT_LOCK, 10 * 60)) > 1) return 0;
  try {
    return await publishChanged(ctx);
  } finally {
    await ctx.cache.delete(IMPORT_LOCK);
  }
}

async function publishChanged(ctx: ModuleContext): Promise<number> {
  const rows = await ctx.db.select().from(guideRows);
  const known = new Map(rows.map((r) => [`${r.locale}/${r.slug}`, r]));
  const changed = guideArticles.filter((g) => known.get(`${g.locale}/${g.slug}`)?.hash !== g.hash);
  if (!changed.length) return 0;
  const categoryId = await ensureCategory(ctx);
  const auth = guideAuth();
  const service = new ArticleService(ctx);
  const englishId = new Map(rows.filter((r) => r.locale === 'en').map((r) => [r.slug, r.articleId]));
  const ordered = changed.sort((a, b) => Number(a.locale !== 'en') - Number(b.locale !== 'en'));
  for (const g of ordered) {
    const row = known.get(`${g.locale}/${g.slug}`);
    const article = await service.publishMaintained(
      row?.articleId ?? null,
      input(g, categoryId, englishId),
      auth,
    );
    if (g.locale === 'en') englishId.set(g.slug, article.id);
    await ctx.db
      .insert(guideRows)
      .values({ slug: g.slug, locale: g.locale as ArticleLocale, articleId: article.id, hash: g.hash })
      .onConflictDoUpdate({
        target: [guideRows.slug, guideRows.locale],
        set: { articleId: article.id, hash: g.hash, updatedAt: new Date() },
      });
  }
  return ordered.length;
}

function input(g: GuideArticle, categoryId: string, englishId: Map<string, string>) {
  return {
    title: g.title,
    summary: g.summary,
    body: g.body,
    categoryId,
    tags: [GUIDE_TAG],
    locale: g.locale as ArticleLocale,
    audience: 'everyone' as const,
    translationOf: g.locale === 'en' ? null : (englishId.get(g.slug) ?? null),
    source: { type: 'guide', id: g.slug, reference: `docs/guide/${g.locale}/${g.file}` },
  };
}

/** The article of a guide in the reader's language (English when it has no translation), if they may read it. */
export async function guideArticleRef(
  ctx: ModuleContext,
  slug: string,
  locale: string | null,
  auth: AuthContext,
): Promise<{ reference: string; href: string }> {
  const rows = await ctx.db
    .select({ locale: guideRows.locale, number: articles.number })
    .from(guideRows)
    .innerJoin(articles, eq(articles.id, guideRows.articleId))
    .where(and(eq(guideRows.slug, slug), eq(articles.status, 'published'), visibleWhere(viewerOf(auth))));
  const pick = rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'en') ?? rows[0];
  if (!pick) throw httpErrors.notFound('This guide is not available');
  return { reference: articleReference(pick.number), href: articleHref(pick.number) };
}
