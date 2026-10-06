import { users } from '@isbp/db/schema';
import {
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
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
    reviewInstanceId: p.reviewInstanceId,
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
    if (!row || ((row.post.status === 'draft' || row.post.status === 'pending') && !canManage))
      throw httpErrors.notFound('Announcement not found');
    return toDto(row.post, row.authorName);
  }

  async list(q: z.output<typeof postQuerySchema>, canManage: boolean) {
    if (q.view === 'drafts' && !canManage) throw httpErrors.forbidden();
    const view =
      q.view === 'current'
        ? currentCondition()
        : q.view === 'drafts'
          ? or(eq(posts.status, 'draft'), eq(posts.status, 'pending'))
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
          status: 'draft',
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
      return input.publish ? this.goLiveOrReview(tx, row!, authorId) : row!;
    });
  }

  /**
   * Publishes now, or — when an admin bound a workflow to `announcements.publish` — sends the post
   * for approval; `onReviewCompleted` publishes it once approved.
   */
  private async goLiveOrReview(tx: Db, before: Row, requesterId: string | null): Promise<Row> {
    const review = await this.ctx.workflows.start(
      'announcements.publish',
      {
        subject: { type: 'post', id: before.id, label: before.title, href: `/announcements/${before.id}` },
        facts: {
          post: {
            severity: before.severity,
            pinned: before.pinned,
            hasWindow: Boolean(before.startsAt || before.endsAt),
          },
        },
        requesterId,
      },
      { tx },
    );
    if (!review) return this.markPublished(tx, before);
    const [row] = await tx
      .update(posts)
      .set({ status: 'pending', reviewInstanceId: review.instanceId })
      .where(eq(posts.id, before.id))
      .returning();
    await this.ctx.audit.record(
      {
        action: 'announcements.post.submitted',
        entityType: 'announcements.post',
        entityId: before.id,
        entityLabel: before.title,
        metadata: { instanceId: review.instanceId },
      },
      { tx },
    );
    await this.ctx.events.publish(
      'announcements.post.submitted',
      { postId: before.id, title: before.title, instanceId: review.instanceId },
      { tx },
    );
    return row!;
  }

  private async markPublished(tx: Db, before: Row): Promise<Row> {
    const [row] = await tx
      .update(posts)
      .set({ status: 'published', publishedAt: new Date(), reviewInstanceId: null })
      .where(eq(posts.id, before.id))
      .returning();
    await this.ctx.audit.record(
      {
        action: 'announcements.post.published',
        entityType: 'announcements.post',
        entityId: before.id,
        entityLabel: row!.title,
        changes: { status: [before.status, 'published'] },
      },
      { tx },
    );
    await this.ctx.events.publish(
      'announcements.post.published',
      { postId: row!.id, title: row!.title, severity: row!.severity },
      { tx },
    );
    await this.ctx.notifications.broadcast(
      {
        type: 'announcements.post.published',
        params: { title: row!.title, severity: row!.severity },
        href: `/announcements/${row!.id}`,
      },
      { tx },
    );
    return row!;
  }

  /** Completion of the review workflow (delivered through the outbox; idempotent). */
  async onReviewCompleted(result: WorkflowCompletion) {
    const [post] = await this.ctx.db.select().from(posts).where(eq(posts.id, result.subjectId));
    if (!post || post.status !== 'pending' || post.reviewInstanceId !== result.instanceId) return;
    await this.ctx.transaction(async (tx) => {
      if (result.outcome === 'approved') {
        await this.markPublished(tx, post);
        await this.ctx.notifications.notify(
          {
            type: 'announcements.post.approved',
            recipients: [post.authorId],
            params: { title: post.title },
            href: `/announcements/${post.id}`,
          },
          { tx },
        );
        return;
      }
      await tx.update(posts).set({ status: 'draft', reviewInstanceId: null }).where(eq(posts.id, post.id));
      await this.ctx.audit.record(
        {
          action: 'announcements.post.review_closed',
          entityType: 'announcements.post',
          entityId: post.id,
          entityLabel: post.title,
          metadata: { outcome: result.outcome, comment: result.comment },
        },
        { tx },
      );
      if (result.outcome === 'rejected')
        await this.ctx.notifications.notify(
          {
            type: 'announcements.post.rejected',
            recipients: [post.authorId],
            params: { title: post.title, comment: result.comment ?? '' },
            href: `/announcements/${post.id}`,
          },
          { tx },
        );
    });
  }

  async update(id: string, input: z.output<typeof updatePostSchema>) {
    const [before] = await this.ctx.db.select().from(posts).where(eq(posts.id, id));
    if (!before) throw httpErrors.notFound('Announcement not found');
    if (before.status === 'pending')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Withdraw the post from review before editing it');
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

  async publish(id: string, requesterId: string | null) {
    const [before] = await this.ctx.db.select().from(posts).where(eq(posts.id, id));
    if (!before) throw httpErrors.notFound('Announcement not found');
    if (before.status === 'published' || before.status === 'pending') return before;
    if (before.pinned) await this.assertPinCapacity(id);
    return this.ctx.transaction((tx) => this.goLiveOrReview(tx, before, requesterId));
  }

  /** Back to draft, closing the review. */
  async withdraw(id: string) {
    const [before] = await this.ctx.db.select().from(posts).where(eq(posts.id, id));
    if (!before) throw httpErrors.notFound('Announcement not found');
    if (before.status !== 'pending' || !before.reviewInstanceId)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This post is not waiting for approval');
    return this.ctx.transaction(async (tx) => {
      await this.ctx.workflows.cancel(before.reviewInstanceId!, 'Withdrawn by the author', { tx });
      const [row] = await tx
        .update(posts)
        .set({ status: 'draft', reviewInstanceId: null })
        .where(eq(posts.id, id))
        .returning();
      return row!;
    });
  }

  async archive(id: string, reason: 'manual' | 'expired') {
    const [current] = await this.ctx.db.select().from(posts).where(eq(posts.id, id));
    if (current?.status === 'pending') await this.withdraw(id);
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
    if (row.status === 'pending') await this.withdraw(id);
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
