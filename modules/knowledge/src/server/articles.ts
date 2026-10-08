import { users, uuidv7 } from '@isbp/db/schema';
import {
  type AiIndexDocument,
  type AiSearchHit,
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import {
  type ArticleAction,
  articleHref,
  type ArticleLocale,
  type articleQuerySchema,
  articleReference,
  type ArticleStatus,
  type createArticleSchema,
  type ClassificationLevel,
  type feedbackInputSchema,
  parseArticleRef,
  parseClassificationLevels,
  type updateArticleSchema,
} from '../contracts';
import {
  ACTION_TARGET,
  audiencePermission,
  availableActions,
  canDelete,
  canEdit,
  canTransition,
  canView,
  PERMISSIONS,
  TRANSITIONS,
  type Viewer,
} from '../lifecycle';
import { keywordTerms, rankDocuments } from '../rank';
import { articles, articleVersions, categories, feedback } from './schema';
import { viaOf } from './sync-support';

export type ArticleRow = typeof articles.$inferSelect;

/** The classification labels in use (`classification.levels`), most restrictive first. */
export async function classificationLevels(ctx: ModuleContext): Promise<ClassificationLevel[]> {
  return parseClassificationLevels(await ctx.settings.get<string>('classification.levels'));
}
type CategoryRow = typeof categories.$inferSelect;

/** Document type of articles in the shared semantic index. */
export const INDEX_TYPE = 'knowledge.article';
export const PUBLISH_TRIGGER = 'knowledge.publish';
/** Score multiplier of the user guide's articles in search (they rank below our own of similar relevance). */
const GUIDE_WEIGHT = 0.5;

export function viewerOf(auth: AuthContext): Viewer {
  return {
    userId: auth.user?.id ?? null,
    read: auth.can(PERMISSIONS.read),
    readInternal: auth.can(PERMISSIONS.readInternal),
    write: auth.can(PERMISSIONS.write),
    publish: auth.can(PERMISSIONS.publish),
  };
}

/** SQL twin of `canView` for list queries. */
export function visibleWhere(v: Viewer): SQL | undefined {
  if (v.publish) return undefined;
  const published = and(
    eq(articles.status, 'published'),
    v.readInternal ? undefined : v.read ? eq(articles.audience, 'everyone') : sql`false`,
  );
  const own = v.userId
    ? and(eq(articles.ownerId, v.userId), v.write ? undefined : eq(articles.status, 'published'))
    : undefined;
  return own ? or(published, own) : published;
}

/** Counters and review bookkeeping must not look like an edit (`updated_at` stays). */
const keepUpdatedAt = { updatedAt: sql`${articles.updatedAt}` };

const categoryRef = (c: CategoryRow | null) =>
  c ? { id: c.id, key: c.key, name: c.name, icon: c.icon } : null;
const person = (id: string | null, name: string | null, avatarUrl: string | null) =>
  id ? { id, displayName: name ?? '—', avatarUrl } : null;

const reviewDueSql = sql<boolean>`(${articles.status} = 'published' and ${articles.reviewAt} is not null and ${articles.reviewAt} <= current_date)`;

const listColumns = {
  a: articles,
  c: categories,
  ownerName: users.displayName,
  ownerAvatar: users.avatarUrl,
  reviewDue: reviewDueSql,
};

type ListRow = {
  a: ArticleRow;
  c: CategoryRow | null;
  ownerName: string | null;
  ownerAvatar: string | null;
  reviewDue: boolean;
};

export function toListItem({ a, c, ownerName, ownerAvatar, reviewDue }: ListRow) {
  return {
    id: a.id,
    number: a.number,
    reference: articleReference(a.number),
    href: articleHref(a.number),
    title: a.title,
    summary: a.summary,
    status: a.status,
    audience: a.audience,
    locale: a.locale,
    category: categoryRef(c),
    tags: a.tags,
    owner: person(a.ownerId, ownerName, ownerAvatar),
    publishedVersion: a.publishedVersion,
    publishedAt: a.publishedAt,
    reviewAt: a.reviewAt,
    reviewDue: Boolean(reviewDue),
    views: a.views,
    helpfulCount: a.helpfulCount,
    notHelpfulCount: a.notHelpfulCount,
    awaitingApproval: a.status === 'in_review' && Boolean(a.reviewInstanceId),
    classification: a.classification,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

const SORTS = {
  number: articles.number,
  title: articles.title,
  updatedAt: articles.updatedAt,
  publishedAt: articles.publishedAt,
  views: articles.views,
  reviewAt: articles.reviewAt,
  helpful: articles.helpfulCount,
} as const;

function orderBy(sort: string | undefined): SQL[] {
  const key = (sort ?? '-updatedAt').replace(/^-/, '') as keyof typeof SORTS;
  const column = SORTS[key] ?? articles.updatedAt;
  const descending = sort ? sort.startsWith('-') : true;
  return [
    descending ? sql`${column} desc nulls last` : sql`${column} asc nulls last`,
    sql`${articles.id} asc`,
  ];
}

/** The indexed form of a published article (ACL from its audience). */
export function indexDocument(a: ArticleRow, category: CategoryRow | null): AiIndexDocument {
  const reference = articleReference(a.number);
  return {
    type: INDEX_TYPE,
    id: a.id,
    title: a.title,
    text: `${a.summary}\n\n${a.body}`,
    locale: a.locale,
    href: articleHref(a.number),
    acl: { permission: audiencePermission(a.audience) },
    metadata: {
      number: a.number,
      reference,
      categoryId: category?.id ?? null,
      categoryKey: category?.key ?? null,
      audience: a.audience,
      tags: a.tags,
      summary: a.summary,
    },
  };
}

const invalidTransition = (from: ArticleStatus, to: ArticleStatus) =>
  new HttpError(409, ErrorCodes.INVALID_TRANSITION, `An article can't go from ${from} to ${to}`, {
    from,
    to,
    allowed: TRANSITIONS[from],
  });

const bodyLength = (s: string) => `${s.length} characters`;

/** Business rules for articles — shared by routes, AI tools, event handlers, jobs and the seed. */
export class ArticleService {
  constructor(private readonly ctx: ModuleContext) {}

  /** The caller's rights; a sync write (Integrations Hub) acts as the author of what it writes. */
  private viewer(auth: AuthContext): Viewer {
    const v = viewerOf(auth);
    return viaOf(this.ctx) ? { ...v, syncAuthor: true } : v;
  }

  /* ───────────── lookup ───────────── */

  private async byRef(ref: string, db: Db = this.ctx.db): Promise<ArticleRow | null> {
    const parsed = parseArticleRef(ref);
    if (!parsed) return null;
    const [row] = await db
      .select()
      .from(articles)
      .where('id' in parsed ? eq(articles.id, parsed.id) : eq(articles.number, parsed.number));
    return row ?? null;
  }

  /** The article if the caller may see it; 404 otherwise (existence is not leaked). */
  async visible(ref: string, auth: AuthContext): Promise<ArticleRow> {
    const row = await this.byRef(ref);
    if (!row || !canView(row, this.viewer(auth))) throw httpErrors.notFound('Article not found');
    return row;
  }

  private async category(id: string | null, db: Db = this.ctx.db) {
    if (!id) return null;
    const [c] = await db.select().from(categories).where(eq(categories.id, id));
    return c ?? null;
  }

  /* ───────────── reads ───────────── */

  async list(q: z.output<typeof articleQuerySchema>, auth: AuthContext) {
    const v = viewerOf(auth);
    if (q.status && q.status !== 'published' && !v.write && !v.publish)
      throw httpErrors.forbidden('Only authors and editors can list unpublished articles');
    if (q.owner === 'me' && !v.userId) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };

    let categoryIds: string[] | null = null;
    if (q.category) {
      const isId = /^[0-9a-f-]{36}$/i.test(q.category);
      const [cat] = await this.ctx.db
        .select({ id: categories.id })
        .from(categories)
        .where(isId ? eq(categories.id, q.category) : eq(categories.key, q.category));
      if (!cat) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
      const children = await this.ctx.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.parentId, cat.id));
      categoryIds = [cat.id, ...children.map((c) => c.id)];
    }
    const ref = q.q ? parseArticleRef(q.q) : null;
    const where = and(
      visibleWhere(v),
      q.status ? eq(articles.status, q.status) : undefined,
      categoryIds ? inArray(articles.categoryId, categoryIds) : undefined,
      q.audience ? eq(articles.audience, q.audience) : undefined,
      q.locale ? eq(articles.locale, q.locale) : undefined,
      q.owner === 'me' ? eq(articles.ownerId, v.userId!) : undefined,
      q.reviewDue === true ? reviewDueSql : undefined,
      q.tag ? sql`${articles.tags} @> array[${q.tag}]::text[]` : undefined,
      q.classification === 'none'
        ? sql`${articles.classification} is null`
        : q.classification
          ? eq(articles.classification, q.classification)
          : undefined,
      q.q
        ? ref && 'number' in ref
          ? eq(articles.number, ref.number)
          : or(ilike(articles.title, likePattern(q.q)), ilike(articles.summary, likePattern(q.q)))
        : undefined,
    );

    // One article per translation group, preferring the caller's language, then English.
    const preferred = auth.user?.locale ?? 'en';
    const scope = q.collapse
      ? and(
          where,
          inArray(
            articles.id,
            this.ctx.db
              .selectDistinctOn([articles.translationGroupId], { id: articles.id })
              .from(articles)
              .where(where)
              .orderBy(
                articles.translationGroupId,
                sql`(${articles.locale} = ${preferred}) desc`,
                sql`(${articles.locale} = 'en') desc`,
                desc(articles.updatedAt),
              ),
          ),
        )
      : where;

    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select(listColumns)
        .from(articles)
        .leftJoin(categories, eq(categories.id, articles.categoryId))
        .leftJoin(users, eq(users.id, articles.ownerId))
        .where(scope)
        .orderBy(...orderBy(q.sort))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      q.collapse
        ? this.ctx.db
            .select({ n: countDistinct(articles.translationGroupId) })
            .from(articles)
            .where(where)
        : this.ctx.db.select({ n: count() }).from(articles).where(where),
    ]);
    return { items: rows.map(toListItem), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  /** Full article for the caller (counts a view of published articles once per reader per day). */
  async get(ref: string, auth: AuthContext, opts: { countView?: boolean } = {}) {
    const row = await this.visible(ref, auth);
    if (opts.countView && row.status === 'published' && auth.user)
      await this.recordView(row.id, auth.user.id);
    return this.detail(row.id, auth);
  }

  async detail(id: string, auth: AuthContext) {
    const v = viewerOf(auth);
    const [r] = await this.ctx.db
      .select(listColumns)
      .from(articles)
      .leftJoin(categories, eq(categories.id, articles.categoryId))
      .leftJoin(users, eq(users.id, articles.ownerId))
      .where(eq(articles.id, id));
    if (!r || !canView(r.a, v)) throw httpErrors.notFound('Article not found');
    const a = r.a;
    const [siblings, mine, files] = await Promise.all([
      this.ctx.db
        .select()
        .from(articles)
        .where(and(eq(articles.translationGroupId, a.translationGroupId), ne(articles.id, a.id)))
        .orderBy(asc(articles.locale), asc(articles.number)),
      v.userId
        ? this.ctx.db
            .select({ helpful: feedback.helpful, comment: feedback.comment })
            .from(feedback)
            .where(and(eq(feedback.articleId, a.id), eq(feedback.userId, v.userId)))
        : Promise.resolve([]),
      this.ctx.files.list({ type: INDEX_TYPE, id: a.id }),
    ]);
    return {
      ...toListItem(r),
      body: a.body,
      translationGroupId: a.translationGroupId,
      source: a.source,
      reviewInstanceId: a.reviewInstanceId,
      translations: siblings
        .filter((s) => canView(s, v))
        .map((s) => ({
          id: s.id,
          number: s.number,
          reference: articleReference(s.number),
          href: articleHref(s.number),
          title: s.title,
          locale: s.locale,
          status: s.status,
        })),
      canEdit: canEdit(a, v),
      canPublish: v.publish,
      canDelete: canDelete(a, v),
      actions: availableActions(a, v),
      myFeedback: mine[0] ?? null,
      attachments: files.length,
    };
  }

  /** A classification must be one of the configured labels (400 otherwise); `null` clears it. */
  private async assertClassification(value: string | null | undefined) {
    if (!value) return;
    const levels = await classificationLevels(this.ctx);
    if (!levels.some((l) => l.key === value))
      throw httpErrors.badRequest('Unknown classification', {
        issues: [{ path: 'classification', message: 'Unknown classification' }],
      });
  }

  private async recordView(articleId: string, userId: string) {
    try {
      await this.ctx.db.execute(sql`
        with seen as (
          insert into knowledge.article_reads (article_id, user_id, viewed_on)
          values (${articleId}, ${userId}, current_date)
          on conflict (article_id, user_id) do update set viewed_on = excluded.viewed_on
            where knowledge.article_reads.viewed_on < excluded.viewed_on
          returning 1
        )
        update knowledge.articles set views = views + 1
        where id = ${articleId} and exists (select 1 from seen)`);
    } catch (err) {
      this.ctx.logger.warn({ err, articleId }, 'could not count article view');
    }
  }

  async versions(ref: string, auth: AuthContext) {
    const a = await this.visible(ref, auth);
    const rows = await this.ctx.db
      .select({ v: articleVersions, name: users.displayName, avatarUrl: users.avatarUrl })
      .from(articleVersions)
      .leftJoin(users, eq(users.id, articleVersions.publishedBy))
      .where(eq(articleVersions.articleId, a.id))
      .orderBy(desc(articleVersions.version));
    return {
      items: rows.map(({ v: x, name, avatarUrl }) => ({
        version: x.version,
        title: x.title,
        publishedAt: x.publishedAt,
        publishedBy: person(x.publishedBy, name, avatarUrl),
        current: a.status === 'published' && x.version === a.publishedVersion,
      })),
    };
  }

  async version(ref: string, version: number, auth: AuthContext) {
    const a = await this.visible(ref, auth);
    const [row] = await this.ctx.db
      .select({ v: articleVersions, name: users.displayName, avatarUrl: users.avatarUrl })
      .from(articleVersions)
      .leftJoin(users, eq(users.id, articleVersions.publishedBy))
      .where(and(eq(articleVersions.articleId, a.id), eq(articleVersions.version, version)));
    if (!row) throw httpErrors.notFound('Version not found');
    return {
      version: row.v.version,
      title: row.v.title,
      summary: row.v.summary,
      body: row.v.body,
      publishedAt: row.v.publishedAt,
      publishedBy: person(row.v.publishedBy, row.name, row.avatarUrl),
      current: a.status === 'published' && row.v.version === a.publishedVersion,
    };
  }

  /* ───────────── writes ───────────── */

  /** Validates `translationOf` and returns the translation group to join (or null for a new group). */
  private async translationGroup(
    translationOf: string | null | undefined,
    selfId: string,
    locale: ArticleLocale,
    auth: AuthContext,
  ): Promise<string | null> {
    if (!translationOf) return null;
    if (translationOf === selfId)
      throw httpErrors.badRequest('An article cannot be a translation of itself', {
        issues: [{ path: 'translationOf', message: 'Pick another article' }],
      });
    const [target] = await this.ctx.db.select().from(articles).where(eq(articles.id, translationOf));
    if (!target || !canView(target, this.viewer(auth)))
      throw httpErrors.notFound('Original article not found');
    return target.translationGroupId;
  }

  /** One article per language in a translation group (retired ones don't count). */
  private async assertLocaleFree(groupId: string, locale: ArticleLocale, selfId: string) {
    const [clash] = await this.ctx.db
      .select({ number: articles.number })
      .from(articles)
      .where(
        and(
          eq(articles.translationGroupId, groupId),
          eq(articles.locale, locale),
          ne(articles.id, selfId),
          ne(articles.status, 'retired'),
        ),
      );
    if (clash)
      throw new HttpError(
        409,
        ErrorCodes.CONFLICT,
        `${articleReference(clash.number)} is already the ${locale} translation`,
        { field: 'locale', reference: articleReference(clash.number) },
      );
  }

  private async assertCategory(categoryId: string | null | undefined) {
    if (categoryId && !(await this.category(categoryId)))
      throw httpErrors.badRequest('Unknown category', {
        issues: [{ path: 'categoryId', message: 'Unknown category' }],
      });
  }

  async create(
    input: z.output<typeof createArticleSchema>,
    auth: AuthContext,
    ownerId: string | null = auth.user?.id ?? null,
  ): Promise<ArticleRow> {
    const id = uuidv7();
    await this.assertCategory(input.categoryId);
    await this.assertClassification(input.classification);
    const group = await this.translationGroup(input.translationOf, id, input.locale, auth);
    if (group) await this.assertLocaleFree(group, input.locale, id);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(articles)
        .values({
          id,
          title: input.title,
          summary: input.summary,
          body: input.body,
          categoryId: input.categoryId ?? null,
          tags: [...new Set(input.tags)],
          locale: input.locale,
          translationGroupId: group ?? id,
          audience: input.audience,
          status: 'draft',
          ownerId,
          reviewAt: input.reviewAt ?? null,
          source: input.source ?? null,
          classification: input.classification ?? null,
        })
        .returning();
      const a = row!;
      await this.ctx.audit.record(
        {
          action: 'knowledge.article.created',
          entityType: 'knowledge.article',
          entityId: a.id,
          entityLabel: `${articleReference(a.number)} ${a.title}`,
          metadata: {
            locale: a.locale,
            audience: a.audience,
            source: a.source,
            classification: a.classification,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'knowledge.article.created',
        {
          ...this.ref(a),
          locale: a.locale,
          audience: a.audience,
          source: a.source,
        },
        { tx },
      );
      return a;
    });
  }

  /**
   * Publishes text maintained outside the knowledge base — the user guide, reviewed in the repository — as the live
   * version: creates the article on first import, otherwise replaces its text, category, audience and tags and records
   * a new version. Review workflows decide about text written here, so this doesn't go through them.
   */
  async publishMaintained(
    articleId: string | null,
    input: z.output<typeof createArticleSchema>,
    auth: AuthContext,
  ): Promise<ArticleRow> {
    const [existing] = articleId
      ? await this.ctx.db.select().from(articles).where(eq(articles.id, articleId))
      : [];
    const row = existing ?? (await this.create(input, auth, null));
    return this.ctx.transaction(async (tx) => {
      const [updated] = await tx
        .update(articles)
        .set({
          title: input.title,
          summary: input.summary,
          body: input.body,
          categoryId: input.categoryId ?? null,
          audience: input.audience,
          tags: [...new Set(input.tags)],
          source: input.source ?? null,
        })
        .where(eq(articles.id, row.id))
        .returning();
      if (existing)
        await this.ctx.audit.record(
          {
            action: 'knowledge.article.updated',
            entityType: 'knowledge.article',
            entityId: row.id,
            entityLabel: this.label(updated!),
            metadata: { source: input.source ?? null },
          },
          { tx },
        );
      return updated!.status === 'published'
        ? this.snapshot(tx, updated!, null)
        : this.markPublished(tx, updated!, null);
    });
  }

  private ref(a: ArticleRow) {
    return { articleId: a.id, number: a.number, reference: articleReference(a.number), title: a.title };
  }

  private label(a: ArticleRow) {
    return `${articleReference(a.number)} ${a.title}`;
  }

  async update(ref: string, input: z.output<typeof updateArticleSchema>, auth: AuthContext) {
    const v = this.viewer(auth);
    const before = await this.visible(ref, auth);
    if (!canEdit(before, v)) {
      if (before.status === 'in_review' && before.reviewInstanceId)
        throw new HttpError(
          409,
          ErrorCodes.INVALID_STATE,
          'Withdraw the article from review before editing it',
        );
      if (before.status === 'retired')
        throw new HttpError(
          409,
          ErrorCodes.INVALID_STATE,
          'Restore the article to a draft before editing it',
        );
      throw httpErrors.forbidden();
    }
    await this.assertCategory(input.categoryId);
    if (input.classification !== undefined && input.classification !== before.classification)
      await this.assertClassification(input.classification);

    const patch: Partial<typeof articles.$inferInsert> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.body !== undefined) patch.body = input.body;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.tags !== undefined) patch.tags = [...new Set(input.tags)];
    if (input.audience !== undefined) patch.audience = input.audience;
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.reviewAt !== undefined) patch.reviewAt = input.reviewAt;
    if (input.classification !== undefined) patch.classification = input.classification;
    if (input.translationOf !== undefined) {
      const group = await this.translationGroup(
        input.translationOf,
        before.id,
        input.locale ?? before.locale,
        auth,
      );
      patch.translationGroupId = group ?? before.id;
    }
    const groupAfter = patch.translationGroupId ?? before.translationGroupId;
    const localeAfter = patch.locale ?? before.locale;
    if (groupAfter !== before.translationGroupId || localeAfter !== before.locale)
      await this.assertLocaleFree(groupAfter, localeAfter, before.id);

    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    if (changes.body) changes.body = [bodyLength(before.body), bodyLength(patch.body ?? '')];
    if (changes.reviewAt) patch.reviewNotifiedAt = null;
    const contentChanged = Boolean(changes.title || changes.summary || changes.body);

    return this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(articles).set(patch).where(eq(articles.id, before.id)).returning();
      const a = row!;
      await this.ctx.audit.record(
        {
          action: 'knowledge.article.updated',
          entityType: 'knowledge.article',
          entityId: a.id,
          entityLabel: this.label(a),
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'knowledge.article.updated',
        { ...this.ref(a), status: a.status, changes: Object.keys(changes) },
        { tx },
      );
      // Editing a published article puts the new text live as the next version.
      if (a.status === 'published' && contentChanged) return this.snapshot(tx, a, auth.user?.id ?? null);
      return a;
    });
  }

  /** Lifecycle actions, checked against the rules for this caller. */
  private async forAction(ref: string, action: ArticleAction, auth: AuthContext) {
    const row = await this.visible(ref, auth);
    const target = ACTION_TARGET[action];
    if (!canTransition(row.status, target)) throw invalidTransition(row.status, target);
    if (!availableActions(row, this.viewer(auth)).includes(action)) {
      if (action === 'publish' && row.reviewInstanceId)
        throw new HttpError(409, ErrorCodes.INVALID_STATE, 'An approval workflow decides on this article');
      throw httpErrors.forbidden();
    }
    return row;
  }

  /**
   * Draft → in review. With a workflow bound to `knowledge.publish`, it decides (the article publishes
   * on approval); without one, a publisher's submission publishes straight away and an author's waits
   * for a publisher.
   */
  async submit(ref: string, auth: AuthContext) {
    const before = await this.forAction(ref, 'submit', auth);
    if (!before.body.trim() || !before.title.trim())
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Write the article before submitting it', {
        issues: [{ path: 'body', message: 'Write the article before submitting it' }],
      });
    const v = this.viewer(auth);
    const category = await this.category(before.categoryId);
    return this.ctx.transaction(async (tx) => {
      const review = await this.ctx.workflows.start(
        PUBLISH_TRIGGER,
        {
          subject: {
            type: 'article',
            id: before.id,
            label: this.label(before),
            href: articleHref(before.number),
          },
          facts: {
            article: { audience: before.audience, locale: before.locale, categoryKey: category?.key ?? null },
          },
          requesterId: v.userId,
        },
        { tx },
      );
      const [row] = await tx
        .update(articles)
        .set({ status: 'in_review', reviewInstanceId: review?.instanceId ?? null })
        .where(eq(articles.id, before.id))
        .returning();
      const a = row!;
      await this.ctx.audit.record(
        {
          action: 'knowledge.article.submitted',
          entityType: 'knowledge.article',
          entityId: a.id,
          entityLabel: this.label(a),
          changes: { status: [before.status, 'in_review'] },
          metadata: { instanceId: review?.instanceId ?? null },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'knowledge.article.submitted',
        { ...this.ref(a), instanceId: review?.instanceId ?? null },
        { tx },
      );
      if (!review && v.publish) return this.markPublished(tx, a, v.userId);
      return a;
    });
  }

  /** In review → published (publishers, when no approval workflow is deciding). */
  async publish(ref: string, auth: AuthContext) {
    const before = await this.forAction(ref, 'publish', auth);
    return this.ctx.transaction((tx) => this.markPublished(tx, before, auth.user?.id ?? null));
  }

  /** Back to draft, cancelling the approval workflow if one is running. */
  async withdraw(ref: string, auth: AuthContext) {
    const before = await this.forAction(ref, 'withdraw', auth);
    return this.backToDraft(before, 'knowledge.article.withdrawn', 'Withdrawn by the author');
  }

  async restore(ref: string, auth: AuthContext) {
    const before = await this.forAction(ref, 'restore', auth);
    return this.backToDraft(before, 'knowledge.article.restored', null);
  }

  private async backToDraft(before: ArticleRow, action: string, cancelReason: string | null) {
    return this.ctx.transaction(async (tx) => {
      if (before.reviewInstanceId && cancelReason)
        await this.ctx.workflows.cancel(before.reviewInstanceId, cancelReason, { tx });
      const [row] = await tx
        .update(articles)
        .set({ status: 'draft', reviewInstanceId: null })
        .where(eq(articles.id, before.id))
        .returning();
      const a = row!;
      await this.ctx.audit.record(
        {
          action,
          entityType: 'knowledge.article',
          entityId: a.id,
          entityLabel: this.label(a),
          changes: { status: [before.status, 'draft'] },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'knowledge.article.updated',
        { ...this.ref(a), status: a.status, changes: ['status'] },
        { tx },
      );
      return a;
    });
  }

  async retire(ref: string, auth: AuthContext) {
    const before = await this.forAction(ref, 'retire', auth);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(articles)
        .set({ status: 'retired' })
        .where(eq(articles.id, before.id))
        .returning();
      const a = row!;
      await this.ctx.audit.record(
        {
          action: 'knowledge.article.retired',
          entityType: 'knowledge.article',
          entityId: a.id,
          entityLabel: this.label(a),
          changes: { status: [before.status, 'retired'] },
        },
        { tx },
      );
      await this.ctx.events.publish('knowledge.article.retired', this.ref(a), { tx });
      return a;
    });
  }

  async remove(ref: string, auth: AuthContext) {
    const row = await this.visible(ref, auth);
    if (!canDelete(row, viewerOf(auth)))
      throw httpErrors.forbidden('Only drafts can be deleted by their author');
    await this.ctx.transaction(async (tx) => {
      if (row.reviewInstanceId)
        await this.ctx.workflows.cancel(row.reviewInstanceId, 'The article was deleted', { tx });
      await tx.delete(articles).where(eq(articles.id, row.id));
      await this.ctx.audit.record(
        {
          action: 'knowledge.article.deleted',
          entityType: 'knowledge.article',
          entityId: row.id,
          entityLabel: this.label(row),
          metadata: { status: row.status },
        },
        { tx },
      );
      await this.ctx.events.publish('knowledge.article.deleted', this.ref(row), { tx });
    });
  }

  /**
   * Puts the article live as its next version: snapshot, review date (default interval), audit and the
   * `published` event (which re-indexes it after commit).
   */
  private async markPublished(tx: Db, before: ArticleRow, publishedBy: string | null): Promise<ArticleRow> {
    const interval = Number((await this.ctx.settings.get<number>('reviewIntervalDays')) ?? 180);
    const [row] = await tx
      .update(articles)
      .set({
        status: 'published',
        reviewInstanceId: null,
        ...(before.reviewAt || !(interval > 0)
          ? {}
          : { reviewAt: sql`current_date + ${Math.round(interval)}::int`, reviewNotifiedAt: null }),
      })
      .where(eq(articles.id, before.id))
      .returning();
    await this.ctx.audit.record(
      {
        action: 'knowledge.article.published',
        entityType: 'knowledge.article',
        entityId: before.id,
        entityLabel: this.label(row!),
        changes: { status: [before.status, 'published'] },
      },
      { tx },
    );
    return this.snapshot(tx, row!, publishedBy);
  }

  /** Records the live text as the next version and announces it (`knowledge.article.published`). */
  private async snapshot(tx: Db, a: ArticleRow, publishedBy: string | null): Promise<ArticleRow> {
    const version = a.publishedVersion + 1;
    const [row] = await tx
      .update(articles)
      .set({ publishedVersion: version, publishedAt: new Date() })
      .where(eq(articles.id, a.id))
      .returning();
    await tx.insert(articleVersions).values({
      articleId: a.id,
      version,
      title: a.title,
      summary: a.summary,
      body: a.body,
      publishedBy,
    });
    const category = await this.category(a.categoryId, tx);
    await this.ctx.events.publish(
      'knowledge.article.published',
      {
        ...this.ref(a),
        version,
        locale: a.locale,
        audience: a.audience,
        categoryKey: category?.key ?? null,
      },
      { tx },
    );
    return row!;
  }

  /** Completion of the `knowledge.publish` review (delivered through the outbox; idempotent). */
  async onReviewCompleted(result: WorkflowCompletion) {
    const [a] = await this.ctx.db.select().from(articles).where(eq(articles.id, result.subjectId));
    if (!a || a.status !== 'in_review' || a.reviewInstanceId !== result.instanceId) return;
    const href = articleHref(a.number);
    const params = { title: a.title, reference: articleReference(a.number) };
    await this.ctx.transaction(async (tx) => {
      if (result.outcome === 'approved') {
        await this.markPublished(tx, a, result.requesterId);
        await this.ctx.notifications.notify(
          { type: 'knowledge.article.approved', recipients: [a.ownerId], params, href },
          { tx },
        );
        return;
      }
      await tx.update(articles).set({ status: 'draft', reviewInstanceId: null }).where(eq(articles.id, a.id));
      await this.ctx.audit.record(
        {
          action: 'knowledge.article.review_closed',
          entityType: 'knowledge.article',
          entityId: a.id,
          entityLabel: this.label(a),
          changes: { status: ['in_review', 'draft'] },
          metadata: { outcome: result.outcome, comment: result.comment },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'knowledge.article.updated',
        { ...this.ref(a), status: 'draft', changes: ['status'] },
        { tx },
      );
      if (result.outcome === 'rejected')
        await this.ctx.notifications.notify(
          {
            type: 'knowledge.article.rejected',
            recipients: [a.ownerId],
            params: { ...params, comment: result.comment ?? '' },
            href,
          },
          { tx },
        );
    });
  }

  /* ───────────── feedback ───────────── */

  async feedback(ref: string, input: z.output<typeof feedbackInputSchema>, auth: AuthContext) {
    const userId = auth.user?.id;
    if (!userId) throw httpErrors.forbidden('Only people can rate articles');
    const article = await this.visible(ref, auth);
    if (article.status !== 'published')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Only published articles can be rated');
    const comment = input.comment?.trim() || null;
    return this.ctx.transaction(async (tx) => {
      // Lock the article so concurrent votes keep the counters exact.
      await tx.execute(sql`select 1 from knowledge.articles where id = ${article.id} for update`);
      const [prev] = await tx
        .select()
        .from(feedback)
        .where(and(eq(feedback.articleId, article.id), eq(feedback.userId, userId)));
      if (prev)
        await tx
          .update(feedback)
          .set({ helpful: input.helpful, comment, createdAt: new Date() })
          .where(eq(feedback.id, prev.id));
      else
        await tx.insert(feedback).values({ articleId: article.id, userId, helpful: input.helpful, comment });

      // New vote: +1 on its side; changed vote: moves from one side to the other; same vote: no change.
      const delta = (side: boolean) => (prev?.helpful === side ? -1 : 0) + (input.helpful === side ? 1 : 0);
      const dh = delta(true);
      const dn = delta(false);
      const [counts] = await tx
        .update(articles)
        .set({
          helpfulCount: sql`greatest(0, ${articles.helpfulCount} + ${dh}::int)`,
          notHelpfulCount: sql`greatest(0, ${articles.notHelpfulCount} + ${dn}::int)`,
          ...keepUpdatedAt,
        })
        .where(eq(articles.id, article.id))
        .returning({ helpful: articles.helpfulCount, notHelpful: articles.notHelpfulCount });

      await this.ctx.audit.record(
        {
          action: 'knowledge.article.rated',
          entityType: 'knowledge.article',
          entityId: article.id,
          entityLabel: this.label(article),
          metadata: { helpful: input.helpful, comment: Boolean(comment) },
        },
        { tx },
      );
      const news = !prev || prev.helpful !== input.helpful || (prev.comment ?? null) !== comment;
      if (!input.helpful && news && article.ownerId && article.ownerId !== userId)
        await this.ctx.notifications.notify(
          {
            type: 'knowledge.article.feedback',
            recipients: [article.ownerId],
            params: {
              title: article.title,
              reference: articleReference(article.number),
              reader: auth.user?.displayName ?? '',
              comment: comment ?? '',
              hasComment: comment ? 'yes' : 'no',
            },
            href: articleHref(article.number),
            data: { articleId: article.id },
          },
          { tx },
        );
      return {
        helpful: input.helpful,
        comment,
        helpfulCount: counts!.helpful,
        notHelpfulCount: counts!.notHelpful,
      };
    });
  }

  /* ───────────── search ───────────── */

  /**
   * Hybrid search over the semantic index (ACL-filtered for the caller), re-ranked per article (see
   * `rankDocuments`). One article per translation group, swapped for its translation in `locale` when
   * there is one. Falls back to a keyword query when the index has nothing (e.g. it was never built).
   */
  async search(
    query: string,
    opts: { auth: AuthContext; limit: number; locale?: ArticleLocale | null; excludeIds?: string[] },
  ): Promise<{ items: ArticleCard[]; mode: 'semantic' | 'keyword' }> {
    // Take the whole candidate pool: ranking happens per article below.
    const hits = await this.ctx.ai.index.search(query, {
      types: [INDEX_TYPE],
      auth: opts.auth,
      limit: 50,
      excludeIds: opts.excludeIds,
    });
    if (hits.length) {
      return {
        items: await this.cards(query, hits, opts.auth, opts.locale ?? null, opts.limit),
        mode: 'semantic',
      };
    }
    if (opts.excludeIds?.length) return { items: [], mode: 'semantic' };
    return { items: await this.keywordCards(query, opts.auth, opts.limit), mode: 'keyword' };
  }

  private async cards(
    query: string,
    hits: AiSearchHit[],
    auth: AuthContext,
    locale: ArticleLocale | null,
    limit: number,
  ): Promise<ArticleCard[]> {
    const v = viewerOf(auth);
    const rows = await this.ctx.db
      .select({ a: articles, c: categories })
      .from(articles)
      .leftJoin(categories, eq(categories.id, articles.categoryId))
      .where(
        and(
          inArray(
            articles.id,
            hits.map((h) => h.id),
          ),
          eq(articles.status, 'published'),
        ),
      );
    // Stale index entries (retired since) and anything the caller can't read never surface.
    const byId = new Map(rows.filter((r) => canView(r.a, v)).map((r) => [r.a.id, r]));
    const hitById = new Map(hits.map((h) => [h.id, h]));
    const ranked = rankDocuments(
      query,
      [...byId.values()].map(({ a }) => ({
        id: a.id,
        title: a.title,
        summary: a.summary,
        body: a.body,
        tags: a.tags,
        similarity: hitById.get(a.id)!.similarity,
        // The user guide explains the platform; for an IT problem our own articles come first.
        weight: a.source?.type === 'guide' ? GUIDE_WEIGHT : 1,
      })),
    );

    const picked: { hit: AiSearchHit; score: number; row: (typeof rows)[number] }[] = [];
    const groups = new Set<string>();
    for (const { id, score } of ranked) {
      const row = byId.get(id)!;
      if (groups.has(row.a.translationGroupId)) continue;
      groups.add(row.a.translationGroupId);
      picked.push({ hit: hitById.get(id)!, score, row });
      if (picked.length >= limit) break;
    }

    const translations = new Map<string, (typeof rows)[number]>();
    const swap = picked.filter((p) => locale && p.row.a.locale !== locale);
    if (locale && swap.length) {
      const alt = await this.ctx.db
        .select({ a: articles, c: categories })
        .from(articles)
        .leftJoin(categories, eq(categories.id, articles.categoryId))
        .where(
          and(
            inArray(
              articles.translationGroupId,
              swap.map((p) => p.row.a.translationGroupId),
            ),
            eq(articles.locale, locale),
            eq(articles.status, 'published'),
          ),
        );
      for (const r of alt) if (canView(r.a, v)) translations.set(r.a.translationGroupId, r);
    }

    return picked.map(({ hit, score, row }) => {
      const t = translations.get(row.a.translationGroupId);
      const { a, c } = t ?? row;
      return {
        id: a.id,
        number: a.number,
        reference: articleReference(a.number),
        title: a.title,
        summary: a.summary,
        // The passage matched in another language; the translation's summary reads better.
        snippet: t ? a.summary || hit.snippet : hit.snippet,
        href: articleHref(a.number),
        score,
        similarity: hit.similarity,
        locale: a.locale,
        audience: a.audience,
        category: categoryRef(c),
        classification: a.classification,
      };
    });
  }

  /** Plain keyword search: every query term in the title or summary, or an exact tag (trigram indexes). */
  private async keywordCards(query: string, auth: AuthContext, limit: number): Promise<ArticleCard[]> {
    const v = viewerOf(auth);
    const terms = keywordTerms(query);
    const matches = (pattern: string) => or(ilike(articles.title, pattern), ilike(articles.summary, pattern));
    const rows = await this.ctx.db
      .select({ a: articles, c: categories })
      .from(articles)
      .leftJoin(categories, eq(categories.id, articles.categoryId))
      .where(
        and(
          eq(articles.status, 'published'),
          visibleWhere({ ...v, write: false, publish: false }),
          or(
            terms.length
              ? and(...terms.map((t) => matches(likePattern(t))))
              : matches(likePattern(query.trim())),
            sql`${articles.tags} @> array[${query.trim().toLowerCase()}]::text[]`,
          ),
        ),
      )
      .orderBy(desc(articles.views), asc(articles.id))
      .limit(limit * 3);
    const groups = new Set<string>();
    const out: ArticleCard[] = [];
    for (const { a, c } of rows) {
      if (groups.has(a.translationGroupId)) continue;
      groups.add(a.translationGroupId);
      out.push({
        id: a.id,
        number: a.number,
        reference: articleReference(a.number),
        title: a.title,
        summary: a.summary,
        snippet: a.summary,
        href: articleHref(a.number),
        score: 0,
        similarity: 0,
        locale: a.locale,
        audience: a.audience,
        category: categoryRef(c),
        classification: a.classification,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Semantic neighbours of an article (other languages of the same article excluded). */
  async related(ref: string, auth: AuthContext, limit = 4) {
    const a = await this.visible(ref, auth);
    const group = await this.ctx.db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.translationGroupId, a.translationGroupId));
    const { items } = await this.search(`${a.title}\n${a.summary}`, {
      auth,
      limit,
      locale: auth.user?.locale ?? a.locale,
      excludeIds: group.map((g) => g.id),
    });
    return { items };
  }

  /** Global search (⌘K): published articles the caller can read, by title or KB number. */
  async quickFind(query: string, auth: AuthContext, limit: number) {
    const v = viewerOf(auth);
    const ref = parseArticleRef(query);
    const rows = await this.ctx.db
      .select({ id: articles.id, number: articles.number, title: articles.title, summary: articles.summary })
      .from(articles)
      .where(
        and(
          eq(articles.status, 'published'),
          visibleWhere({ ...v, write: false, publish: false }),
          ref && 'number' in ref
            ? eq(articles.number, ref.number)
            : ilike(articles.title, likePattern(query)),
        ),
      )
      .orderBy(desc(articles.views), asc(articles.id))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      type: 'article',
      title: r.title,
      subtitle: `${articleReference(r.number)} · ${r.summary}`.slice(0, 160),
      href: articleHref(r.number),
      icon: 'book-open',
    }));
  }

  /* ───────────── semantic index ───────────── */

  /**
   * Makes the index match the article's current state: published → (re)embedded; anything else →
   * removed. Order-independent and idempotent, so at-least-once event delivery is safe.
   */
  async syncIndex(articleId: string) {
    const [row] = await this.ctx.db
      .select({ a: articles, c: categories })
      .from(articles)
      .leftJoin(categories, eq(categories.id, articles.categoryId))
      .where(eq(articles.id, articleId));
    if (!row || row.a.status !== 'published') await this.ctx.ai.index.remove(INDEX_TYPE, articleId);
    else await this.ctx.ai.index.upsert(indexDocument(row.a, row.c));
  }

  /** Re-embeds every published article and drops retired ones from the index (weekly / on demand). */
  async reindexAll(log?: (message: string) => Promise<void>) {
    let indexed = 0;
    let removed = 0;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const batch = await this.ctx.db
        .select({ a: articles, c: categories })
        .from(articles)
        .leftJoin(categories, eq(categories.id, articles.categoryId))
        .where(sql`${articles.id} > ${after}`)
        .orderBy(asc(articles.id))
        .limit(200);
      if (!batch.length) break;
      for (const { a, c } of batch) {
        if (a.status === 'published') {
          await this.ctx.ai.index.upsert(indexDocument(a, c));
          indexed++;
        } else if (a.status === 'retired' || a.publishedVersion > 0) {
          await this.ctx.ai.index.remove(INDEX_TYPE, a.id);
          removed++;
        }
      }
      after = batch[batch.length - 1]!.a.id;
      await log?.(`indexed ${indexed}, removed ${removed}`);
    }
    return { indexed, removed };
  }

  /* ───────────── jobs ───────────── */

  /** Tells owners about published articles past their review date (repeats every N days). */
  async remindReviews(limit = 500) {
    const repeat = Math.max(1, Number((await this.ctx.settings.get<number>('reminderRepeatDays')) ?? 7));
    const due = await this.ctx.db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.status, 'published'),
          isNotNull(articles.ownerId),
          lte(articles.reviewAt, sql`current_date`),
          or(
            sql`${articles.reviewNotifiedAt} is null`,
            sql`${articles.reviewNotifiedAt} < now() - make_interval(days => ${repeat}::int)`,
          ),
        ),
      )
      .orderBy(asc(articles.reviewAt))
      .limit(limit);
    for (const a of due) {
      await this.ctx.transaction(async (tx) => {
        await this.ctx.notifications.notify(
          {
            type: 'knowledge.article.review_due',
            recipients: [a.ownerId],
            params: { title: a.title, reference: articleReference(a.number), reviewAt: a.reviewAt ?? '' },
            href: articleHref(a.number),
            data: { articleId: a.id },
          },
          { tx },
        );
        await tx
          .update(articles)
          .set({ reviewNotifiedAt: new Date(), ...keepUpdatedAt })
          .where(eq(articles.id, a.id));
      });
    }
    return due.length;
  }

  /** People who leave can't review their articles: clear the owner so editors pick them up. */
  async releaseOwner(userId: string) {
    const released = await this.ctx.db
      .update(articles)
      .set({ ownerId: null, ...keepUpdatedAt })
      .where(eq(articles.ownerId, userId))
      .returning({ id: articles.id });
    if (released.length)
      await this.ctx.audit.record({
        action: 'knowledge.article.owner_released',
        entityType: 'user',
        entityId: userId,
        metadata: { articles: released.length },
      });
    return released.length;
  }

  /* ───────────── AI tool shapes ───────────── */

  /** `knowledge.get_article` output (category name in the caller's language). */
  async forAi(input: { id?: string; reference?: string }, auth: AuthContext) {
    const a = await this.visible(input.id ?? input.reference ?? '', auth);
    const c = await this.category(a.categoryId);
    const lang = auth.user?.locale ?? 'en';
    return {
      id: a.id,
      number: a.number,
      reference: articleReference(a.number),
      title: a.title,
      summary: a.summary,
      body: a.body,
      locale: a.locale,
      audience: a.audience,
      href: articleHref(a.number),
      category: c ? { id: c.id, key: c.key, name: c.name[lang] || c.name.en || c.key } : null,
      tags: a.tags,
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  async categoryIdByKey(key: string | undefined) {
    if (!key) return null;
    const [c] = await this.ctx.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.key, key));
    return c?.id ?? null;
  }
}

export type ArticleCard = {
  id: string;
  number: number;
  reference: string;
  title: string;
  summary: string;
  snippet: string;
  href: string;
  score: number;
  similarity: number;
  locale: ArticleLocale;
  audience: 'everyone' | 'agents';
  category: { id: string; key: string; name: CategoryRow['name']; icon: string } | null;
  classification: string | null;
};
