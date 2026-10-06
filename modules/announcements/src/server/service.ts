import { users } from '@isbp/db/schema';
import { type Db, httpErrors, likePattern, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, desc, eq, gt, ilike, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { createPostSchema, postQuerySchema, Severity, updatePostSchema } from '../contracts';
import { posts } from './schema';

type Row = typeof posts.$inferSelect;

export function toDto(p: Row, authorName: string | null) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    severity: p.severity,
    status: p.status,
    pinned: p.pinned,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    publishedAt: p.publishedAt,
    author: p.authorId ? { id: p.authorId, displayName: authorName ?? '—' } : null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export const currentCondition = (): SQL =>
  and(eq(posts.status, 'published'), or(isNull(posts.endsAt), gt(posts.endsAt, sql`now()`)))!;

/** Business rules for posts — shared by routes, the AI tools and the expiry job. */
export class PostService {
  constructor(private readonly ctx: ModuleContext) {}

  async find(id: string, canManage: boolean) {
    const [row] = await this.ctx.db
      .select({ post: posts, authorName: users.displayName })
      .from(posts)
      .leftJoin(users, eq(users.id, posts.authorId))
      .where(eq(posts.id, id));
    if (!row || (row.post.status === 'draft' && !canManage))
      throw httpErrors.notFound('Announcement not found');
    return toDto(row.post, row.authorName);
  }

  async list(q: z.output<typeof postQuerySchema>, canManage: boolean) {
    if (q.view === 'drafts' && !canManage) throw httpErrors.forbidden();
    const view =
      q.view === 'current'
        ? currentCondition()
        : q.view === 'drafts'
          ? eq(posts.status, 'draft')
          : or(
              eq(posts.status, 'archived'),
              and(eq(posts.status, 'published'), lte(posts.endsAt, sql`now()`)),
            );
    const where = and(
      view,
      q.severity ? eq(posts.severity, q.severity) : undefined,
      q.q ? or(ilike(posts.title, likePattern(q.q)), ilike(posts.body, likePattern(q.q))) : undefined,
    );
    const order =
      q.view === 'current' ? [desc(posts.pinned), desc(posts.publishedAt)] : [desc(posts.updatedAt)];
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select({ post: posts, authorName: users.displayName })
        .from(posts)
        .leftJoin(users, eq(users.id, posts.authorId))
        .where(where)
        .orderBy(...order, asc(posts.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(posts).where(where),
    ]);
    return {
      items: rows.map((r) => toDto(r.post, r.authorName)),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private async assertPinCapacity(excludeId?: string) {
    const max = Number((await this.ctx.settings.get<number>('maxPinned')) ?? 3);
    const [pinned] = await this.ctx.db
      .select({ n: count() })
      .from(posts)
      .where(
        and(
          eq(posts.pinned, true),
          currentCondition(),
          excludeId ? sql`${posts.id} <> ${excludeId}` : undefined,
        ),
      );
    if (pinned!.n >= max) throw httpErrors.conflict(`At most ${max} announcements can be pinned at once`);
  }

  async create(input: z.output<typeof createPostSchema>, authorId: string | null) {
    if (input.pinned) await this.assertPinCapacity();
    const severity = input.severity ?? ((await this.ctx.settings.get<Severity>('defaultSeverity')) || 'info');
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(posts)
        .values({
          title: input.title,
          body: input.body,
          severity,
          pinned: input.pinned,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          authorId,
          status: input.publish ? 'published' : 'draft',
          publishedAt: input.publish ? new Date() : null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'announcements.post.created',
          entityType: 'announcements.post',
          entityId: row!.id,
          entityLabel: row!.title,
          metadata: { severity, published: input.publish },
        },
        { tx },
      );
      if (input.publish) await this.publishedEvent(tx, row!);
      return row!;
    });
  }

  private async publishedEvent(tx: Db, row: Row) {
    await this.ctx.events.publish(
      'announcements.post.published',
      { postId: row.id, title: row.title, severity: row.severity },
      { tx },
    );
  }

  async update(id: string, input: z.output<typeof updatePostSchema>) {
    const [before] = await this.ctx.db.select().from(posts).where(eq(posts.id, id));
    if (!before) throw httpErrors.notFound('Announcement not found');
    if (input.pinned && !before.pinned && before.status === 'published') await this.assertPinCapacity(id);
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(posts).set(input).where(eq(posts.id, id)).returning();
      await this.ctx.audit.record(
        {
          action: 'announcements.post.updated',
          entityType: 'announcements.post',
          entityId: id,
          entityLabel: row!.title,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'announcements.post.updated',
        { postId: id, title: row!.title, changes: Object.keys(changes) },
        { tx },
      );
      return row!;
    });
  }

  async publish(id: string) {
    const [before] = await this.ctx.db.select().from(posts).where(eq(posts.id, id));
    if (!before) throw httpErrors.notFound('Announcement not found');
    if (before.status === 'published') return before;
    if (before.pinned) await this.assertPinCapacity(id);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(posts)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(posts.id, id))
        .returning();
      await this.ctx.audit.record(
        {
          action: 'announcements.post.published',
          entityType: 'announcements.post',
          entityId: id,
          entityLabel: row!.title,
          changes: { status: [before.status, 'published'] },
        },
        { tx },
      );
      await this.publishedEvent(tx, row!);
      return row!;
    });
  }

  async archive(id: string, reason: 'manual' | 'expired') {
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(posts)
        .set({ status: 'archived', pinned: false })
        .where(and(eq(posts.id, id), sql`${posts.status} <> 'archived'`))
        .returning();
      if (!row) return null;
      await this.ctx.audit.record(
        {
          action: 'announcements.post.archived',
          entityType: 'announcements.post',
          entityId: id,
          entityLabel: row.title,
          metadata: { reason },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'announcements.post.archived',
        { postId: id, title: row.title, reason },
        { tx },
      );
      return row;
    });
  }

  async remove(id: string) {
    const [row] = await this.ctx.db.select().from(posts).where(eq(posts.id, id));
    if (!row) throw httpErrors.notFound('Announcement not found');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(posts).where(eq(posts.id, id));
      await this.ctx.audit.record(
        {
          action: 'announcements.post.deleted',
          entityType: 'announcements.post',
          entityId: id,
          entityLabel: row.title,
        },
        { tx },
      );
      await this.ctx.events.publish('announcements.post.deleted', { postId: id, title: row.title }, { tx });
    });
  }
}
