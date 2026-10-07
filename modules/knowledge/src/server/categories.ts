import { type AuthContext, ErrorCodes, HttpError, httpErrors, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, countDistinct, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { createCategorySchema, updateCategorySchema } from '../contracts';
import { viewerOf } from './articles';
import { articles, categories } from './schema';

type CategoryRow = typeof categories.$inferSelect;

function toDto(c: CategoryRow, articleCount: number) {
  return {
    id: c.id,
    key: c.key,
    name: c.name,
    description: c.description,
    icon: c.icon,
    parentId: c.parentId,
    sortOrder: c.sortOrder,
    articleCount,
  };
}

/** Categories: a small, admin-managed tree (parent → children) that groups articles. */
export class CategoryService {
  constructor(private readonly ctx: ModuleContext) {}

  /** Every category with the number of published articles (translation groups) the caller can read. */
  async list(auth: AuthContext) {
    const v = viewerOf(auth);
    const [rows, counts] = await Promise.all([
      this.ctx.db
        .select()
        .from(categories)
        .orderBy(asc(categories.sortOrder), sql`${categories.name}->>'en'`, asc(categories.key)),
      this.ctx.db
        .select({ categoryId: articles.categoryId, n: countDistinct(articles.translationGroupId) })
        .from(articles)
        .where(
          and(
            eq(articles.status, 'published'),
            v.readInternal || v.publish ? undefined : eq(articles.audience, 'everyone'),
          ),
        )
        .groupBy(articles.categoryId),
    ]);
    const byCategory = new Map(counts.map((c) => [c.categoryId, c.n]));
    return { items: rows.map((c) => toDto(c, byCategory.get(c.id) ?? 0)) };
  }

  private async get(id: string) {
    const [c] = await this.ctx.db.select().from(categories).where(eq(categories.id, id));
    if (!c) throw httpErrors.notFound('Category not found');
    return c;
  }

  /** A parent must exist and must not be the category itself or one of its descendants. */
  private async assertParent(parentId: string | null | undefined, selfId?: string) {
    if (!parentId) return;
    if (parentId === selfId)
      throw new HttpError(400, ErrorCodes.INVALID_PARENT, 'A category cannot be its own parent');
    const all = await this.ctx.db
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories);
    const parentOf = new Map(all.map((c) => [c.id, c.parentId]));
    if (!parentOf.has(parentId))
      throw new HttpError(400, ErrorCodes.INVALID_PARENT, 'Unknown parent category');
    for (let cur: string | null | undefined = parentId, hops = 0; cur && hops < 100; hops++) {
      if (cur === selfId)
        throw new HttpError(
          400,
          ErrorCodes.INVALID_PARENT,
          'A category cannot sit under its own subcategory',
        );
      cur = parentOf.get(cur);
    }
  }

  async create(input: z.output<typeof createCategorySchema>) {
    const [taken] = await this.ctx.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.key, input.key));
    if (taken)
      throw new HttpError(409, ErrorCodes.CONFLICT, `The key "${input.key}" is already used`, {
        field: 'key',
      });
    await this.assertParent(input.parentId);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          icon: input.icon,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'knowledge.category.created',
          entityType: 'knowledge.category',
          entityId: row!.id,
          entityLabel: row!.key,
        },
        { tx },
      );
      return toDto(row!, 0);
    });
  }

  async update(id: string, input: z.output<typeof updateCategorySchema>) {
    const before = await this.get(id);
    if (input.parentId !== undefined) await this.assertParent(input.parentId, id);
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return toDto(before, 0);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(categories).set(input).where(eq(categories.id, id)).returning();
      await this.ctx.audit.record(
        {
          action: 'knowledge.category.updated',
          entityType: 'knowledge.category',
          entityId: id,
          entityLabel: row!.key,
          changes,
        },
        { tx },
      );
      return toDto(row!, 0);
    });
  }

  /** Refused with `IN_USE` while articles (in any status) still belong to the category. */
  async remove(id: string) {
    const c = await this.get(id);
    const [used] = await this.ctx.db.select({ n: count() }).from(articles).where(eq(articles.categoryId, id));
    if (used!.n > 0)
      throw new HttpError(409, ErrorCodes.IN_USE, `${used!.n} article(s) still use this category`, {
        articles: used!.n,
      });
    await this.ctx.transaction(async (tx) => {
      await tx.delete(categories).where(eq(categories.id, id));
      await this.ctx.audit.record(
        {
          action: 'knowledge.category.deleted',
          entityType: 'knowledge.category',
          entityId: id,
          entityLabel: c.key,
        },
        { tx },
      );
    });
  }
}
