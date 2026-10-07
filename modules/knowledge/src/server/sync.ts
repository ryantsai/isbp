/**
 * Sync adapter (Phase 5): `knowledge.article`, so the Integrations Hub can keep articles in step with
 * another knowledge base (ServiceDesk Plus solutions) without this module knowing it. Writes go through
 * `ArticleService` as the hub's agent, which acts as the author of what it syncs. Holding
 * `knowledge.articles.sync` (checked by the kernel, and required to set up a profile that writes articles)
 * lets a sync publish, retire, restore and edit live articles: the other knowledge base approved them. A
 * running review workflow in ISBP still decides alone (409).
 */
import {
  type AuthContext,
  type DomainEvent,
  httpErrors,
  localize,
  type LocalizedText,
  type ModuleContext,
  type SyncAdapter,
  type SyncFieldDef,
  type SyncRecord,
  type SyncWriteOptions,
} from '@isbp/sdk/server';
import { asc, eq, ilike, inArray } from 'drizzle-orm';
import {
  ARTICLE_LOCALES,
  ARTICLE_STATUSES,
  articleHref,
  articleReference,
  type ArticleStatus,
  createArticleSchema,
  updateArticleSchema,
} from '../contracts';
import { canEdit, PERMISSIONS, TRANSITIONS } from '../lifecycle';
import { type ArticleRow, ArticleService } from './articles';
import { articles, categories } from './schema';
import {
  approvalRequired,
  cursorAt,
  exactLike,
  inSyncWrite,
  invalidValues,
  isUuid,
  noTransition,
  pageLimit,
  pageOf,
  pageOrder,
  pageWhere,
  parseInput,
  statusPath,
  syncErrors,
  writerAuth,
} from './sync-support';

type Values = Record<string, unknown>;

const KEYS: Record<string, string> = { categoryId: 'category' };
const FIELDS = ['title', 'summary', 'body', 'tags', 'locale', 'audience'] as const;
const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;

const label = (key: string) => `knowledge.sync.fields.${key}`;

function record(a: ArticleRow): SyncRecord {
  const reference = articleReference(a.number);
  return {
    id: a.id,
    ref: reference,
    title: a.title,
    href: articleHref(a.number),
    updatedAt: a.updatedAt.toISOString(),
    containerId: null,
    values: {
      title: a.title,
      summary: a.summary,
      body: a.body,
      category: a.categoryId,
      tags: a.tags,
      locale: a.locale,
      audience: a.audience,
      status: a.status,
      ref: reference,
    },
  };
}

async function rowOf(ctx: ModuleContext, id: string): Promise<ArticleRow> {
  const [row] = isUuid(id) ? await ctx.db.select().from(articles).where(eq(articles.id, id)) : [];
  if (!row) throw httpErrors.notFound('Article not found');
  return row;
}

/** The fields in the shape of the module's article schemas (texts: null → ''). */
function articleFields(v: Values): Values {
  const out: Values = {};
  for (const k of FIELDS) {
    if (!(k in v)) continue;
    if (v[k] === null && (k === 'locale' || k === 'audience'))
      throw invalidValues([{ path: k, message: 'required' }]);
    out[k] = v[k] ?? (k === 'tags' ? [] : '');
  }
  if ('category' in v) out.categoryId = v.category;
  return out;
}

/**
 * One lifecycle step with the service's own action (and its checks). Submitting and withdrawing happen as the
 * author (so a submission goes to review, or to a bound review workflow, instead of publishing at once);
 * publishing, retiring and restoring as a publisher.
 */
async function step(s: ArticleService, auth: AuthContext, a: ArticleRow, to: ArticleStatus) {
  if (a.status === 'draft' && to === 'in_review') return s.submit(a.id, auth);
  if (a.status === 'in_review' && to === 'draft') return s.withdraw(a.id, auth);
  if (a.status === 'in_review' && to === 'published') {
    if (a.reviewInstanceId)
      throw approvalRequired(a.status, to, 'An approval workflow decides whether this article is published');
    return s.publish(a.id, publisherOf(auth));
  }
  if (to === 'retired') return s.retire(a.id, publisherOf(auth));
  return s.restore(a.id, publisherOf(auth));
}

/**
 * Walks the lifecycle to `to` one step at a time. A step may go further than asked (a publisher's
 * submission publishes at once when no review workflow is bound), so the path is recomputed each time.
 */
async function moveTo(ctx: ModuleContext, auth: AuthContext, a: ArticleRow, to: ArticleStatus) {
  const s = new ArticleService(ctx);
  let current = a;
  for (let guard = 0; current.status !== to && guard < 8; guard++) {
    const path = statusPath<ArticleStatus>((x) => TRANSITIONS[x], current.status, to);
    if (!path) throw noTransition(current.status, to, TRANSITIONS[current.status], 'An article');
    await step(s, auth, current, path[0]!);
    current = await rowOf(ctx, a.id);
  }
  return current;
}

const AUTHOR = [PERMISSIONS.read, PERMISSIONS.readInternal, PERMISSIONS.write];

/** The agent as the author of what it syncs. */
function writer(opts: SyncWriteOptions) {
  return writerAuth(opts.auth, AUTHOR);
}

/** The kernel has checked `knowledge.articles.sync`: what the other system approved may go live. */
function publisherOf(auth: AuthContext) {
  return writerAuth(auth, [...AUTHOR, PERMISSIONS.publish]);
}

export const articleAdapter: SyncAdapter = {
  matchKeys: ['title'],

  async fields(ctx): Promise<SyncFieldDef[]> {
    const rows = await ctx.db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.key));
    const byId = new Map(rows.map((c) => [c.id, c]));
    const path = (c: (typeof rows)[number], l: string) => {
      const names: LocalizedText[] = [c.name];
      const seen = new Set([c.id]);
      for (let p = c.parentId ? byId.get(c.parentId) : undefined; p && !seen.has(p.id);) {
        seen.add(p.id);
        names.unshift(p.name);
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
      return names.map((n) => localize(n, l)).join(' › ');
    };
    return [
      { key: 'title', label: label('title'), type: 'string', required: true, maxLength: 300 },
      { key: 'summary', label: label('summary'), type: 'text', maxLength: 500 },
      { key: 'body', label: label('body'), type: 'markdown', maxLength: 50_000 },
      {
        key: 'category',
        label: label('category'),
        type: 'choice',
        choices: rows.map((c) => ({
          value: c.id,
          label: Object.fromEntries(LOCALES.map((l) => [l, path(c, l)])),
        })),
      },
      { key: 'tags', label: label('tags'), type: 'tags' },
      {
        key: 'locale',
        label: label('locale'),
        type: 'choice',
        choices: ARTICLE_LOCALES.map((l) => ({ value: l, label: `knowledge.sync.locales.${l}` })),
      },
      {
        key: 'audience',
        label: label('audience'),
        type: 'choice',
        choices: (['everyone', 'agents'] as const).map((a) => ({
          value: a,
          label: `knowledge.audience.${a}`,
        })),
      },
      {
        key: 'status',
        label: label('status'),
        type: 'choice',
        choices: ARTICLE_STATUSES.map((s) => ({ value: s, label: `knowledge.status.${s}` })),
      },
      { key: 'ref', label: label('ref'), type: 'string', readOnly: true },
    ];
  },

  async read(id, ctx) {
    if (!isUuid(id)) return null;
    const [row] = await ctx.db.select().from(articles).where(eq(articles.id, id));
    return row ? record(row) : null;
  },

  async readMany(ids, ctx) {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    return (await ctx.db.select().from(articles).where(inArray(articles.id, valid))).map(record);
  },

  async list(opts, ctx) {
    const limit = pageLimit(opts.limit);
    const rows = await ctx.db
      .select({ a: articles, cursorAt: cursorAt(articles.updatedAt) })
      .from(articles)
      .where(pageWhere(articles.updatedAt, articles.id, opts))
      .orderBy(...pageOrder(articles.updatedAt, articles.id))
      .limit(limit + 1);
    const page = pageOf(
      rows.map((r) => ({ ...r, id: r.a.id })),
      limit,
    );
    return { items: page.rows.map((r) => record(r.a)), next: page.next };
  },

  /** Case-insensitive exact title; null when several articles share it. */
  async findBy(field, value, _opts, ctx) {
    if (field !== 'title' || typeof value !== 'string' || !value.trim()) return null;
    const rows = await ctx.db
      .select()
      .from(articles)
      .where(ilike(articles.title, exactLike(value.trim())))
      .limit(2);
    return rows.length === 1 ? record(rows[0]!) : null;
  },

  write(input, opts, ctx) {
    return inSyncWrite(ctx, opts, async (bound) => {
      const v: Values = { ...input.values };
      const auth = writer(opts);
      const s = new ArticleService(bound);
      const target = v.status as ArticleStatus | undefined;
      return syncErrors(KEYS, async () => {
        if (!input.id) {
          const created = await s.create(
            parseInput(
              createArticleSchema,
              {
                ...articleFields(v),
                // Where it came from, shown on the article ("Synced from Contoso ServiceDesk Plus #812").
                source: {
                  type: 'integration',
                  id: opts.source.connectionId,
                  reference: `${opts.source.connectionName} ${opts.source.remoteRef}`.slice(0, 100),
                },
              },
              KEYS,
            ),
            auth,
            null,
          );
          if (target) await moveTo(bound, auth, created, target);
          return { id: created.id };
        }
        const before = await rowOf(bound, input.id);
        const fields = articleFields(v);
        const edit = async () => {
          // Editing a live article publishes a new version.
          if (Object.keys(fields).length)
            await s.update(before.id, parseInput(updateArticleSchema, fields, KEYS), publisherOf(auth));
        };
        const viewer = {
          userId: null,
          read: true,
          readInternal: true,
          write: true,
          publish: true,
          syncAuthor: true,
        };
        // Edit while the article is editable; otherwise move it first (e.g. a retired one back to a draft).
        if (!target || canEdit(before, viewer)) {
          await edit();
          if (target) await moveTo(bound, auth, await rowOf(bound, before.id), target);
        } else {
          await moveTo(bound, auth, before, target);
          await edit();
        }
        return { id: before.id };
      });
    });
  },

  idFromEvent(event: DomainEvent) {
    const id = (event.payload as { articleId?: unknown }).articleId;
    return isUuid(id) ? id : null;
  },
};

export const sync = { article: articleAdapter };
