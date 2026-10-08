import { dateTime } from '@isbp/contracts';
import { listQuerySchema, localizedTextSchema } from '@isbp/sdk';
import { z } from 'zod';

/*
 * Knowledge Base API contracts (mounted at /api/v1/knowledge):
 *
 *   GET    /articles                       → page of articleListItemSchema
 *   POST   /articles                       → articleSchema (a draft)
 *   GET    /articles/:ref                  → articleSchema (ref = uuid or KB-00042)
 *   PATCH  /articles/:ref                  → articleSchema
 *   POST   /articles/:ref/{submit,withdraw,publish,retire,restore}
 *   DELETE /articles/:ref
 *   GET    /articles/:ref/versions[/:v]    → versions
 *   POST   /articles/:ref/feedback         → feedbackResultSchema
 *   GET    /articles/:ref/related          → { items: articleCardSchema[] }
 *   GET    /search?q=&limit=&locale=       → searchResultSchema (also used for ticket deflection)
 *   GET/POST/PATCH/DELETE /categories
 *   GET    /classifications                → classificationsSchema (the configured labels, most restrictive first)
 */

const id = z.uuid();

export const ARTICLE_LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;
export const articleLocaleSchema = z.enum(ARTICLE_LOCALES);
export type ArticleLocale = z.infer<typeof articleLocaleSchema>;

/** `everyone` = self-service; `agents` = internal (needs `knowledge.articles.read-internal`). */
export const articleAudienceSchema = z.enum(['everyone', 'agents']);
export type ArticleAudience = z.infer<typeof articleAudienceSchema>;

export const ARTICLE_STATUSES = ['draft', 'in_review', 'published', 'retired'] as const;
export const articleStatusSchema = z.enum(ARTICLE_STATUSES);
export type ArticleStatus = z.infer<typeof articleStatusSchema>;

/** Where a generated draft came from, e.g. `{ type: 'itsm.ticket', id, reference: 'INC-00042' }`. */
export const articleSourceSchema = z.object({
  type: z.string().trim().min(1).max(100),
  id: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(100).optional(),
});
export type ArticleSource = z.infer<typeof articleSourceSchema>;

/* ───────────────────────────── classification ───────────────────────────── */

/**
 * The classification labels shipped with the module (translated in the catalog under `classificationLevel.<key>`). The
 * module setting `classification.levels` lists the labels in use, one per line, most restrictive first: a line is
 * one of these keys, or any other text (a custom label, shown as written).
 */
export const BUILT_IN_CLASSIFICATIONS = [
  'strictly-confidential',
  'customer-confidential',
  'confidential',
  'internal-use-only',
] as const;
export type BuiltInClassification = (typeof BUILT_IN_CLASSIFICATIONS)[number];
export const DEFAULT_CLASSIFICATION_LEVELS = BUILT_IN_CLASSIFICATIONS.join('\n');
export const CLASSIFICATION_MAX = 100;

export interface ClassificationLevel {
  /** Stored on the article: a built-in key or the custom label itself. */
  key: string;
  builtIn: boolean;
  /** 0 = most restrictive. */
  rank: number;
}

/** The labels of the `classification.levels` setting, in order (blank lines and duplicates ignored). */
export function parseClassificationLevels(text: unknown): ClassificationLevel[] {
  const lines = (typeof text === 'string' ? text : DEFAULT_CLASSIFICATION_LEVELS)
    .split(/\r?\n/)
    .map((l) => l.trim().slice(0, CLASSIFICATION_MAX))
    .filter(Boolean);
  const keys = [...new Set(lines)].slice(0, 20);
  return keys.map((key, rank) => ({
    key,
    builtIn: (BUILT_IN_CLASSIFICATIONS as readonly string[]).includes(key),
    rank,
  }));
}

export const classificationLevelSchema = z.object({
  key: z.string(),
  builtIn: z.boolean(),
  rank: z.number().int(),
});

export const classificationsSchema = z.object({ items: z.array(classificationLevelSchema) });
export type Classifications = z.input<typeof classificationsSchema>;

/* ───────────────────────────── references ───────────────────────────── */

/** `42` → `KB-00042`. */
export const articleReference = (n: number) => `KB-${String(n).padStart(5, '0')}`;
/** Web path of an article. */
export const articleHref = (n: number) => `/knowledge/${articleReference(n)}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid or `KB-00042` (case-insensitive, leading zeros optional); null for anything else. */
export function parseArticleRef(ref: string): { id: string } | { number: number } | null {
  const v = ref.trim();
  if (UUID_RE.test(v)) return { id: v.toLowerCase() };
  const m = /^KB-?(\d{1,12})$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? { number: n } : null;
}

/** Link to the record a draft was generated from (e.g. the ITSM ticket). */
export function sourceHref(source: ArticleSource): string | null {
  if (source.type === 'itsm.ticket')
    return `/itsm/tickets/${encodeURIComponent(source.reference ?? source.id)}`;
  return null;
}

/* ───────────────────────────── shared shapes ───────────────────────────── */

export const categoryRefSchema = z.object({
  id,
  key: z.string(),
  name: localizedTextSchema,
  icon: z.string(),
});
export type CategoryRef = z.input<typeof categoryRefSchema>;

export const personRefSchema = z.object({
  id,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

const tagSchema = z.string().trim().toLowerCase().min(1).max(40);
const reviewDateSchema = z.iso.date();

/* ───────────────────────────── articles ───────────────────────────── */

export const articleListItemSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  href: z.string(),
  title: z.string(),
  summary: z.string(),
  status: articleStatusSchema,
  audience: articleAudienceSchema,
  locale: articleLocaleSchema,
  category: categoryRefSchema.nullable(),
  tags: z.array(z.string()),
  owner: personRefSchema.nullable(),
  publishedVersion: z.number().int(),
  publishedAt: dateTime.nullable(),
  /** `YYYY-MM-DD`. */
  reviewAt: reviewDateSchema.nullable(),
  /** Published and past its review date. */
  reviewDue: z.boolean(),
  views: z.number().int(),
  helpfulCount: z.number().int(),
  notHelpfulCount: z.number().int(),
  /** A review workflow is running (in review, waiting for approval). */
  awaitingApproval: z.boolean(),
  /** Classification label (a key of `classification.levels`), or none. */
  classification: z.string().nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type ArticleListItem = z.input<typeof articleListItemSchema>;

export const translationSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  href: z.string(),
  title: z.string(),
  locale: articleLocaleSchema,
  status: articleStatusSchema,
});
export type ArticleTranslation = z.input<typeof translationSchema>;

export const articleSchema = articleListItemSchema.extend({
  body: z.string(),
  translationGroupId: id,
  source: articleSourceSchema.nullable(),
  reviewInstanceId: id.nullable(),
  /** Other articles of the translation group the caller can see. */
  translations: z.array(translationSchema),
  canEdit: z.boolean(),
  canPublish: z.boolean(),
  canDelete: z.boolean(),
  /** Transitions the caller may trigger now. */
  actions: z.array(z.enum(['submit', 'withdraw', 'publish', 'retire', 'restore'])),
  myFeedback: z.object({ helpful: z.boolean(), comment: z.string().nullable() }).nullable(),
  /** Files attached to the article (the core attachments panel; readers download, editors change them). */
  attachments: z.number().int(),
});
export type Article = z.input<typeof articleSchema>;
export type ArticleAction = Article['actions'][number];

export const ARTICLE_SORTS = [
  'number',
  'title',
  'updatedAt',
  'publishedAt',
  'views',
  'reviewAt',
  'helpful',
] as const;

/**
 * Readers see published articles of their audience. Other statuses need write permission (authors see
 * their own; publishers see all). `collapse` keeps one article per translation group, preferring the
 * caller's language.
 */
export const articleQuerySchema = listQuerySchema.extend({
  /** Category key or id. */
  category: z.string().trim().max(64).optional(),
  status: articleStatusSchema.optional(),
  audience: articleAudienceSchema.optional(),
  locale: articleLocaleSchema.optional(),
  owner: z.enum(['me']).optional(),
  reviewDue: z.stringbool().optional(),
  tag: tagSchema.optional(),
  /** A classification label key, or `none` for unclassified articles. */
  classification: z.string().trim().min(1).max(CLASSIFICATION_MAX).optional(),
  collapse: z.stringbool().optional(),
});
export type ArticleQuery = z.input<typeof articleQuerySchema>;

export const createArticleSchema = z.object({
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(500).default(''),
  body: z.string().max(50_000).default(''),
  categoryId: id.nullish(),
  tags: z.array(tagSchema).max(10).default([]),
  locale: articleLocaleSchema.default('en'),
  audience: articleAudienceSchema.default('everyone'),
  /** Make this article a translation of another one (joins its translation group). */
  translationOf: id.nullish(),
  reviewAt: reviewDateSchema.nullish(),
  source: articleSourceSchema.nullish(),
  /** A label of `classification.levels`, or none. */
  classification: z.string().trim().min(1).max(CLASSIFICATION_MAX).nullish(),
});
export type CreateArticleInput = z.input<typeof createArticleSchema>;

export const updateArticleSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().max(500),
    body: z.string().max(50_000),
    categoryId: id.nullable(),
    tags: z.array(tagSchema).max(10),
    locale: articleLocaleSchema,
    audience: articleAudienceSchema,
    /** `null` detaches the article from its translation group. */
    translationOf: id.nullable(),
    reviewAt: reviewDateSchema.nullable(),
    classification: z.string().trim().min(1).max(CLASSIFICATION_MAX).nullable(),
  })
  .partial();
export type UpdateArticleInput = z.input<typeof updateArticleSchema>;

export const feedbackInputSchema = z.object({
  helpful: z.boolean(),
  comment: z.string().trim().max(1000).nullish(),
});
export type FeedbackInput = z.input<typeof feedbackInputSchema>;

export const feedbackResultSchema = z.object({
  helpful: z.boolean(),
  comment: z.string().nullable(),
  helpfulCount: z.number().int(),
  notHelpfulCount: z.number().int(),
});
export type FeedbackResult = z.input<typeof feedbackResultSchema>;

export const versionSummarySchema = z.object({
  version: z.number().int(),
  title: z.string(),
  publishedAt: dateTime,
  publishedBy: personRefSchema.nullable(),
  current: z.boolean(),
});
export type ArticleVersionSummary = z.input<typeof versionSummarySchema>;

export const versionSchema = versionSummarySchema.extend({ summary: z.string(), body: z.string() });
export type ArticleVersion = z.input<typeof versionSchema>;

/* ───────────────────────────── search ───────────────────────────── */

/** A search hit / related article. */
export const articleCardSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  title: z.string(),
  summary: z.string(),
  /** Best-matching passage (plain text). */
  snippet: z.string(),
  href: z.string(),
  /** Fused relevance 0–1 (ordering). */
  score: z.number(),
  /** Cosine similarity 0–1 of the best passage (relevance thresholds). */
  similarity: z.number(),
  locale: articleLocaleSchema,
  audience: articleAudienceSchema,
  category: categoryRefSchema.nullable(),
  classification: z.string().nullable(),
});
export type ArticleCard = z.input<typeof articleCardSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  /** Preferred language: translations in it replace other-language hits of the same article. */
  locale: articleLocaleSchema.optional(),
});
export type SearchQuery = z.input<typeof searchQuerySchema>;

export const searchResultSchema = z.object({
  items: z.array(articleCardSchema),
  /** `semantic` = hybrid index; `keyword` = plain-text fallback (e.g. empty index). */
  mode: z.enum(['semantic', 'keyword']),
});
export type SearchResult = z.input<typeof searchResultSchema>;

/* ───────────────────────────── categories ───────────────────────────── */

const iconSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lucide icon name, e.g. key-round')
  .max(64);

export const categorySchema = z.object({
  id,
  key: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  icon: z.string(),
  parentId: id.nullable(),
  sortOrder: z.number().int(),
  /** Published articles (translation groups) the caller can read. */
  articleCount: z.number().int(),
});
export type Category = z.input<typeof categorySchema>;

export const createCategorySchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and "-" only'),
  name: localizedTextSchema,
  description: localizedTextSchema.nullish(),
  icon: iconSchema.default('book-open'),
  parentId: id.nullish(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type CreateCategoryInput = z.input<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: localizedTextSchema,
    description: localizedTextSchema.nullable(),
    icon: iconSchema,
    parentId: id.nullable(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;

/* ───────────────────────────── AI tools (contract used by Helpdesk AI) ───────────────────────────── */

export const aiSearchArticlesInput = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(10).default(5),
  locale: articleLocaleSchema.optional(),
});

export const aiArticleHitSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  title: z.string(),
  summary: z.string(),
  snippet: z.string(),
  href: z.string(),
  score: z.number(),
  similarity: z.number(),
});
export type AiArticleHit = z.infer<typeof aiArticleHitSchema>;
export type AiSearchArticlesOutput = { items: AiArticleHit[] };

export const aiGetArticleInput = z
  .object({ id: id.optional(), reference: z.string().trim().max(40).optional() })
  .refine((v) => Boolean(v.id || v.reference), { message: 'Give an id or a reference' });

export const aiArticleSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  locale: articleLocaleSchema,
  audience: articleAudienceSchema,
  href: z.string(),
  /** `name` is in the caller's language. */
  category: z.object({ id, key: z.string(), name: z.string() }).nullable(),
  tags: z.array(z.string()),
  /** ISO 8601. */
  updatedAt: z.string(),
});
export type AiArticle = z.infer<typeof aiArticleSchema>;

export const aiCreateDraftInput = z.object({
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(500).optional(),
  body: z.string().min(1).max(50_000),
  categoryKey: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  locale: articleLocaleSchema.default('en'),
  audience: articleAudienceSchema.default('agents'),
  source: articleSourceSchema.optional(),
});
export type AiCreateDraftOutput = { id: string; number: number; reference: string; href: string };

/* ───────────────────────────── web slots hosted by this module ───────────────────────────── */

/** Props of `<Slot name="knowledge.home.assist" />` above the categories on the knowledge home. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type KnowledgeHomeAssistSlotProps = {};
