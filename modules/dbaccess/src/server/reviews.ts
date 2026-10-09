/**
 * Access review campaigns: scope (servers, minimum risk), reviewers (role owner or the grantee's manager),
 * a due date and a policy for undecided items. Starting snapshots the active grants; closing applies the
 * decisions and the policy (revocations go through the worker). Closed campaigns are read-only.
 */
import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  localize,
  type ModuleContext,
} from '@isbp/sdk/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type {
  CreateReviewInput,
  DecideInput,
  ReviewItemOut as ReviewItem,
  ReviewOut as Review,
} from '../contracts';
import { createReviewSchema, decideSchema } from '../contracts';
import {
  addDays,
  closeOutcome,
  formatReviewRef,
  nextCampaignDates,
  REVIEW_REF_RE,
  REVIEW_REMIND_DAYS,
  type ReviewDecision,
  reviewerFor,
  riskAtLeast,
  todayIn,
  toCsv,
} from '../model';
import { groupsOf, PERMISSIONS, personOf, requireAny } from './access';
import type { GrantService } from './grants';
import {
  grants,
  inventoryAccounts,
  requestableRoles,
  requests,
  reviewItems,
  reviews,
  servers,
} from './schema';
import type { ServerService } from './servers';
import { activeMembers, groupsByIds, peopleByIds, personRef, roleRef, serverRef } from './support';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReviewRow = typeof reviews.$inferSelect;
const REVIEW_ENTITY = 'dbaccess.review';
/** Campaign dates follow the company calendar. */
const COMPANY_TZ = 'Asia/Taipei';

export class ReviewService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly serversSvc: ServerService,
    private readonly grantsSvc: GrantService,
  ) {}

  private get db() {
    return this.ctx.db;
  }

  async row(id: string): Promise<ReviewRow> {
    const [row] = await this.db.select().from(reviews).where(eq(reviews.id, id));
    if (!row) throw httpErrors.notFound('Access review not found');
    return row;
  }

  /** The id of a review given its reference (`REV-0001`, used in links) or its id. */
  async idOf(ref: string): Promise<string> {
    const m = REVIEW_REF_RE.exec(ref);
    if (!m && !UUID_RE.test(ref)) throw httpErrors.notFound('Access review not found');
    const [row] = await this.db
      .select({ id: reviews.id })
      .from(reviews)
      .where(m ? eq(reviews.number, Number(m[1])) : eq(reviews.id, ref));
    if (!row) throw httpErrors.notFound('Access review not found');
    return row.id;
  }

  private canRead(auth: AuthContext) {
    return auth.can(PERMISSIONS.reviewsRead) || auth.can(PERMISSIONS.reviewsManage);
  }

  /** Undecided-or-not items the caller reviews (as the person, or through a group), never their own grant. */
  private async reviewerCond(auth: AuthContext): Promise<SQL> {
    const me = personOf(auth);
    if (!me) return sql`false`;
    const groups = [...(await groupsOf(this.db, auth))];
    return and(
      or(
        eq(reviewItems.reviewerUserId, me),
        groups.length ? inArray(reviewItems.reviewerGroupId, groups) : sql`false`,
      ),
      or(isNull(grants.userId), ne(grants.userId, me)),
    )!;
  }

  /* ───────────── campaigns ───────────── */

  async list(
    query: { page: number; pageSize: number; q?: string; status?: string; mine?: boolean },
    auth: AuthContext,
  ) {
    const mineOnly = query.mine || !this.canRead(auth);
    const where: (SQL | undefined)[] = [];
    if (query.status) where.push(eq(reviews.status, query.status as ReviewRow['status']));
    if (query.q) where.push(ilike(reviews.name, likePattern(query.q)));
    if (mineOnly) {
      const cond = await this.reviewerCond(auth);
      where.push(
        sql`exists (select 1 from ${reviewItems} join ${grants} on ${grants.id} = ${reviewItems.grantId} where ${reviewItems.reviewId} = ${reviews.id} and ${cond})`,
      );
    }
    const rows = await this.db
      .select()
      .from(reviews)
      .where(and(...where))
      .orderBy(
        sql`case ${reviews.status} when 'active' then 0 when 'scheduled' then 1 else 2 end`,
        desc(reviews.dueOn),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await this.db
      .select({ n: count() })
      .from(reviews)
      .where(and(...where));
    return {
      items: await this.toDtos(rows, auth),
      total: total?.n ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string, auth: AuthContext): Promise<Review> {
    const r = await this.row(id);
    if (!this.canRead(auth)) {
      const [any] = await this.db
        .select({ id: reviewItems.id })
        .from(reviewItems)
        .innerJoin(grants, eq(grants.id, reviewItems.grantId))
        .where(and(eq(reviewItems.reviewId, id), await this.reviewerCond(auth)))
        .limit(1);
      if (!any) auth.require(PERMISSIONS.reviewsRead);
    }
    return (await this.toDtos([r], auth))[0]!;
  }

  private async toDtos(rows: ReviewRow[], auth: AuthContext): Promise<Review[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const totals = await this.db
      .select({ reviewId: reviewItems.reviewId, decision: reviewItems.decision, n: count() })
      .from(reviewItems)
      .where(inArray(reviewItems.reviewId, ids))
      .groupBy(reviewItems.reviewId, reviewItems.decision);
    const reviewer = await this.reviewerCond(auth);
    const mine = await this.db
      .select({
        reviewId: reviewItems.reviewId,
        n: count(),
        pending: sql<number>`count(*) filter (where ${reviewItems.decision} is null)`.mapWith(Number),
      })
      .from(reviewItems)
      .innerJoin(grants, eq(grants.id, reviewItems.grantId))
      .where(and(inArray(reviewItems.reviewId, ids), reviewer))
      .groupBy(reviewItems.reviewId);
    const serverBy = await this.serversSvc.rowsByIds(rows.flatMap((r) => r.serverIds));
    const allServers = rows.some((r) => !r.serverIds.length) ? await this.db.select().from(servers) : [];
    const people = await peopleByIds(
      this.db,
      rows.map((r) => r.createdBy),
    );
    const canManage = auth.can(PERMISSIONS.reviewsManage);
    return rows.map((r) => {
      const t = totals.filter((x) => x.reviewId === r.id);
      const sum = (d: ReviewDecision | null) =>
        t.filter((x) => x.decision === d).reduce((n, x) => n + x.n, 0);
      const items = t.reduce((n, x) => n + x.n, 0);
      const scope = r.serverIds.length
        ? r.serverIds.map((id) => serverBy.get(id)).filter((s) => s !== undefined)
        : allServers;
      return {
        id: r.id,
        reference: formatReviewRef(r.number),
        name: r.name,
        status: r.status,
        servers: scope.map(serverRef),
        minRisk: r.minRisk,
        reviewerRule: r.reviewerRule,
        startOn: r.startOn,
        dueOn: r.dueOn,
        policy: r.policy,
        recurrence: r.recurrence,
        startedAt: r.startedAt,
        closedAt: r.closedAt,
        createdBy: personRef(r.createdBy ? people.get(r.createdBy) : null),
        totals: {
          items,
          kept: sum('keep'),
          revoked: sum('revoke'),
          pending: sum(null),
          mine: mine.find((m) => m.reviewId === r.id)?.pending ?? 0,
          mineTotal: mine.find((m) => m.reviewId === r.id)?.n ?? 0,
        },
        canManage: canManage && r.status !== 'closed',
        createdAt: r.createdAt,
      };
    });
  }

  async create(raw: CreateReviewInput, auth: AuthContext): Promise<Review> {
    auth.require(PERMISSIONS.reviewsManage);
    const input = createReviewSchema.parse(raw);
    const today = todayIn(COMPANY_TZ);
    const startOn = input.startOn ?? today;
    if (input.dueOn <= today)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'The due date must be in the future', {
        issues: [{ path: 'dueOn', message: 'The due date must be in the future' }],
      });
    if (input.serverIds.length)
      await this.serversSvc.rowsByIds(input.serverIds).then((m) => {
        if (m.size !== new Set(input.serverIds).size) throw httpErrors.badRequest('Unknown server');
      });
    const row = await this.ctx.transaction(async (tx) => {
      const [r] = await tx
        .insert(reviews)
        .values({ ...input, startOn, status: 'scheduled', createdBy: personOf(auth) })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'dbaccess.review.created',
          entityType: REVIEW_ENTITY,
          entityId: r!.id,
          entityLabel: r!.name,
          metadata: {
            dueOn: r!.dueOn,
            policy: r!.policy,
            reviewerRule: r!.reviewerRule,
            minRisk: r!.minRisk,
          },
        },
        { tx },
      );
      return r!;
    });
    if (startOn <= today) await this.start(row.id);
    return this.detail(row.id, auth);
  }

  /** Snapshots active grants in scope as items and tells the reviewers. */
  async start(id: string): Promise<number> {
    const r = await this.row(id);
    if (r.status !== 'scheduled') return 0;
    const rows = await this.db
      .select({ g: grants, role: requestableRoles, managerId: users.managerId })
      .from(grants)
      .innerJoin(requestableRoles, eq(requestableRoles.id, grants.roleId))
      .leftJoin(users, eq(users.id, grants.userId))
      .where(
        and(
          eq(grants.status, 'active'),
          r.serverIds.length ? inArray(grants.serverId, r.serverIds) : undefined,
        ),
      );
    const inScope = rows.filter((x) => riskAtLeast(x.role.risk, r.minRisk));
    const recipients = new Map<string, number>();
    const groupMembersCache = new Map<string, string[]>();
    await this.ctx.transaction(async (tx) => {
      const [claimed] = await tx
        .update(reviews)
        .set({ status: 'active', startedAt: new Date() })
        .where(and(eq(reviews.id, id), eq(reviews.status, 'scheduled')))
        .returning();
      if (!claimed) return;
      for (const x of inScope) {
        const reviewer = reviewerFor(r.reviewerRule, {
          ownerUserId: x.role.ownerUserId,
          ownerGroupId: x.role.ownerGroupId,
          granteeId: x.g.userId,
          granteeManagerId: x.managerId,
        });
        await tx
          .insert(reviewItems)
          .values({
            reviewId: id,
            grantId: x.g.id,
            reviewerUserId: reviewer?.kind === 'user' ? reviewer.id : null,
            reviewerGroupId: reviewer?.kind === 'group' ? reviewer.id : null,
          })
          .onConflictDoNothing();
        let people: string[] = [];
        if (reviewer?.kind === 'user') people = [reviewer.id];
        else if (reviewer?.kind === 'group') {
          if (!groupMembersCache.has(reviewer.id))
            groupMembersCache.set(reviewer.id, await activeMembers(tx, reviewer.id));
          people = groupMembersCache.get(reviewer.id)!;
        }
        for (const p of people) if (p !== x.g.userId) recipients.set(p, (recipients.get(p) ?? 0) + 1);
      }
      for (const [userId, n] of recipients)
        await this.ctx.notifications.notify(
          {
            type: 'dbaccess.review.assigned',
            recipients: [userId],
            params: { name: r.name, count: n, dueOn: r.dueOn },
            href: `/dbaccess/reviews/${formatReviewRef(r.number)}?view=mine`,
          },
          { tx },
        );
      await this.ctx.audit.record(
        {
          action: 'dbaccess.review.started',
          entityType: REVIEW_ENTITY,
          entityId: id,
          entityLabel: r.name,
          metadata: { items: inScope.length, reviewers: recipients.size },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'dbaccess.review.started',
        { reviewId: id, items: inScope.length },
        { tx },
      );
    });
    return inScope.length;
  }

  /* ───────────── items & decisions ───────────── */

  async items(
    id: string,
    query: {
      page: number;
      pageSize: number;
      q?: string;
      view?: string;
      mine?: boolean;
      serverId?: string;
      sort?: string;
    },
    auth: AuthContext,
  ) {
    const r = await this.row(id);
    const reader = this.canRead(auth);
    const reviewer = await this.reviewerCond(auth);
    const where: (SQL | undefined)[] = [eq(reviewItems.reviewId, id)];
    const view = query.view ?? (reader ? 'all' : 'mine');
    if (view === 'mine' || query.mine || !reader) where.push(reviewer);
    if (view === 'mine' || view === 'undecided') where.push(isNull(reviewItems.decision));
    if (view === 'decided') where.push(isNotNull(reviewItems.decision));
    if (query.serverId) where.push(eq(grants.serverId, query.serverId));
    if (query.q) {
      const p = likePattern(query.q);
      where.push(
        or(
          ilike(grants.accountName, p),
          ilike(requestableRoles.roleName, p),
          ilike(users.displayName, p),
          sql`${requestableRoles.name}::text ilike ${p}`,
        ),
      );
    }
    const cond = and(...where);
    const base = () =>
      this.db
        .select({ item: reviewItems, g: grants, role: requestableRoles })
        .from(reviewItems)
        .innerJoin(grants, eq(grants.id, reviewItems.grantId))
        .innerJoin(requestableRoles, eq(requestableRoles.id, grants.roleId))
        .leftJoin(users, eq(users.id, grants.userId));
    const rows = await base()
      .where(cond)
      .orderBy(
        sql`${reviewItems.decision} is not null`,
        asc(users.displayName),
        asc(requestableRoles.roleName),
        asc(reviewItems.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await this.db
      .select({ n: count() })
      .from(reviewItems)
      .innerJoin(grants, eq(grants.id, reviewItems.grantId))
      .innerJoin(requestableRoles, eq(requestableRoles.id, grants.roleId))
      .leftJoin(users, eq(users.id, grants.userId))
      .where(cond);
    return {
      items: await this.itemDtos(r, rows, auth),
      total: total?.n ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async itemDtos(
    r: ReviewRow,
    rows: {
      item: typeof reviewItems.$inferSelect;
      g: typeof grants.$inferSelect;
      role: typeof requestableRoles.$inferSelect;
    }[],
    auth: AuthContext,
  ): Promise<ReviewItem[]> {
    const serverBy = await this.serversSvc.rowsByIds(rows.map((x) => x.g.serverId));
    const people = await peopleByIds(
      this.db,
      rows.flatMap((x) => [x.g.userId, x.item.reviewerUserId, x.item.decidedBy]),
    );
    const groupBy = await groupsByIds(
      this.db,
      rows.map((x) => x.item.reviewerGroupId),
    );
    const me = personOf(auth);
    const myGroups = await groupsOf(this.db, auth);
    const manager = auth.can(PERMISSIONS.reviewsManage);
    // Why the person has it and whether they use it: the request's reason and the account's last sign-in.
    const requestIds = [...new Set(rows.map((x) => x.g.requestId).filter((v): v is string => Boolean(v)))];
    const reasons = new Map(
      requestIds.length
        ? (
            await this.db
              .select({ id: requests.id, justification: requests.justification })
              .from(requests)
              .where(inArray(requests.id, requestIds))
          ).map((q) => [q.id, q.justification])
        : [],
    );
    const accountKeys = rows.filter((x) => x.g.accountName).map((x) => [x.g.serverId, x.g.accountName!]);
    const logins = new Map(
      accountKeys.length
        ? (
            await this.db
              .select({
                serverId: inventoryAccounts.serverId,
                name: inventoryAccounts.name,
                lastLoginAt: inventoryAccounts.lastLoginAt,
                syncedAt: inventoryAccounts.syncedAt,
              })
              .from(inventoryAccounts)
              .where(
                or(
                  ...accountKeys.map(([serverId, name]) =>
                    and(
                      eq(inventoryAccounts.serverId, serverId!),
                      eq(sql`lower(${inventoryAccounts.name})`, name!.toLowerCase()),
                    ),
                  ),
                ),
              )
          ).map((a) => [`${a.serverId}|${a.name.toLowerCase()}`, a])
        : [],
    );
    // Only some engines report sign-ins (Oracle): a server whose accounts never show one doesn't report them.
    const serverIds = [...new Set(rows.map((x) => x.g.serverId))];
    const reporting = new Set(
      serverIds.length
        ? (
            await this.db
              .selectDistinct({ serverId: inventoryAccounts.serverId })
              .from(inventoryAccounts)
              .where(
                and(inArray(inventoryAccounts.serverId, serverIds), isNotNull(inventoryAccounts.lastLoginAt)),
              )
          ).map((r) => r.serverId)
        : [],
    );
    return rows.map(({ item, g, role }) => {
      const login = g.accountName ? logins.get(`${g.serverId}|${g.accountName.toLowerCase()}`) : undefined;
      const reviewerPerson = item.reviewerUserId ? people.get(item.reviewerUserId) : undefined;
      const reviewerGroup = item.reviewerGroupId ? groupBy.get(item.reviewerGroupId) : undefined;
      const assigned =
        (me && item.reviewerUserId === me) ||
        Boolean(item.reviewerGroupId && myGroups.has(item.reviewerGroupId));
      return {
        id: item.id,
        grantId: g.id,
        grantee: personRef(g.userId ? people.get(g.userId) : null),
        accountName: g.accountName,
        role: roleRef(role),
        server: serverRef(serverBy.get(g.serverId)!),
        grantedAt: g.grantedAt,
        expiresAt: g.expiresAt,
        reason: (g.requestId ? reasons.get(g.requestId) : null) || null,
        signIn:
          login && reporting.has(g.serverId)
            ? { known: true, lastAt: login.lastLoginAt, checkedAt: login.syncedAt }
            : { known: false, lastAt: null, checkedAt: null },
        reviewer: reviewerPerson
          ? { kind: 'user', id: reviewerPerson.id, name: reviewerPerson.displayName }
          : reviewerGroup
            ? { kind: 'group', id: reviewerGroup.id, name: reviewerGroup.name }
            : null,
        decision: item.decision,
        comment: item.comment,
        decidedBy: personRef(item.decidedBy ? people.get(item.decidedBy) : null),
        decidedAt: item.decidedAt,
        outcome: item.outcome,
        canDecide: r.status === 'active' && g.userId !== me && Boolean(me) && (assigned || manager),
      };
    });
  }

  async decide(id: string, raw: DecideInput, auth: AuthContext): Promise<{ updated: number }> {
    const input = decideSchema.parse(raw);
    const r = await this.row(id);
    if (r.status === 'closed')
      throw new HttpError(409, ErrorCodes.REVIEW_CLOSED, 'This access review is closed');
    if (r.status !== 'active')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This access review has not started');
    const me = personOf(auth);
    if (!me) throw httpErrors.forbidden('Only people review access');
    const rows = await this.db
      .select({ item: reviewItems, g: grants, role: requestableRoles })
      .from(reviewItems)
      .innerJoin(grants, eq(grants.id, reviewItems.grantId))
      .innerJoin(requestableRoles, eq(requestableRoles.id, grants.roleId))
      .where(and(eq(reviewItems.reviewId, id), inArray(reviewItems.id, input.itemIds)));
    if (rows.length !== new Set(input.itemIds).size) throw httpErrors.notFound('Review item not found');
    const dtos = await this.itemDtos(r, rows, auth);
    if (dtos.some((d) => !d.canDecide)) auth.require(PERMISSIONS.reviewsManage);
    if (dtos.some((d) => d.grantee?.id === me)) throw httpErrors.forbidden('Nobody reviews their own access');
    await this.ctx.transaction(async (tx) => {
      // Locks the campaign row: a concurrent close waits, and decisions never land on a closed campaign.
      const [locked] = await tx
        .select({ status: reviews.status })
        .from(reviews)
        .where(eq(reviews.id, id))
        .for('update');
      if (locked?.status !== 'active')
        throw new HttpError(409, ErrorCodes.REVIEW_CLOSED, 'This access review is closed');
      await tx
        .update(reviewItems)
        .set({ decision: input.decision, comment: input.comment, decidedBy: me, decidedAt: new Date() })
        .where(inArray(reviewItems.id, input.itemIds));
      for (const x of rows)
        await this.ctx.audit.record(
          {
            action: 'dbaccess.review.decided',
            entityType: REVIEW_ENTITY,
            entityId: id,
            entityLabel: r.name,
            metadata: {
              itemId: x.item.id,
              grantId: x.g.id,
              account: x.g.accountName,
              role: x.role.roleName,
              decision: input.decision,
              comment: input.comment,
              previous: x.item.decision,
            },
          },
          { tx },
        );
    });
    return { updated: rows.length };
  }

  /** Applies decisions and the policy, queues revocations, and schedules the next campaign. */
  async close(id: string, auth: AuthContext | null): Promise<void> {
    if (auth) auth.require(PERMISSIONS.reviewsManage);
    const r = await this.row(id);
    if (r.status === 'closed')
      throw new HttpError(409, ErrorCodes.REVIEW_CLOSED, 'This access review is closed');
    const revoke: string[] = [];
    await this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(reviews).where(eq(reviews.id, id)).for('update');
      if (!locked || locked.status === 'closed')
        throw new HttpError(409, ErrorCodes.REVIEW_CLOSED, 'This access review is closed');
      const items = await tx.select().from(reviewItems).where(eq(reviewItems.reviewId, id));
      const outcome = closeOutcome(items, r.policy);
      const revokeSet = new Set(outcome.revoke);
      const grantRows = items.length
        ? await tx
            .select()
            .from(grants)
            .where(
              inArray(
                grants.id,
                items.map((i) => i.grantId),
              ),
            )
        : [];
      for (const g of grantRows) {
        if (!revokeSet.has(g.id)) continue;
        const item = items.find((i) => i.grantId === g.id)!;
        const note = item.decision
          ? (item.comment ?? `Access review ${r.name}`)
          : `Access review ${r.name}: not reviewed by the due date`;
        if (await this.grantsSvc.beginRevoke(tx, g, 'review', note, item.decidedBy)) revoke.push(g.id);
      }
      for (const item of items)
        await tx
          .update(reviewItems)
          .set({ outcome: revokeSet.has(item.grantId) ? 'revoked' : 'kept' })
          .where(eq(reviewItems.id, item.id));
      await tx.update(reviews).set({ status: 'closed', closedAt: new Date() }).where(eq(reviews.id, id));
      await this.ctx.audit.record(
        {
          action: 'dbaccess.review.closed',
          entityType: REVIEW_ENTITY,
          entityId: id,
          entityLabel: r.name,
          metadata: {
            kept: outcome.keep.length,
            revoked: outcome.revoke.length,
            defaulted: outcome.defaulted.length,
            policy: r.policy,
            automatic: !auth,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'dbaccess.review.closed',
        { reviewId: id, kept: outcome.keep.length, revoked: outcome.revoke.length },
        { tx },
      );
      if (r.recurrence === 'quarterly') {
        const next = nextCampaignDates(r.startOn, r.dueOn);
        await tx.insert(reviews).values({
          name: nextName(r.name, next.startOn),
          serverIds: r.serverIds,
          minRisk: r.minRisk,
          reviewerRule: r.reviewerRule,
          startOn: next.startOn,
          dueOn: next.dueOn,
          policy: r.policy,
          recurrence: r.recurrence,
          status: 'scheduled',
          previousId: r.id,
          createdBy: r.createdBy,
        });
      }
    });
    for (const g of revoke) await this.grantsSvc.enqueue('revoke', g);
  }

  async csv(id: string, auth: AuthContext): Promise<{ filename: string; body: string }> {
    requireAny(auth, [PERMISSIONS.reviewsRead, PERMISSIONS.reviewsManage]);
    const r = await this.row(id);
    const rows = await this.db
      .select({ item: reviewItems, g: grants, role: requestableRoles })
      .from(reviewItems)
      .innerJoin(grants, eq(grants.id, reviewItems.grantId))
      .innerJoin(requestableRoles, eq(requestableRoles.id, grants.roleId))
      .where(eq(reviewItems.reviewId, id));
    const items = await this.itemDtos(r, rows, auth);
    const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : '');
    const body = toCsv([
      [
        'Server',
        'Database',
        'Role',
        'Role name',
        'Risk',
        'Person',
        'Account',
        'Granted',
        'Expires',
        'Reviewer',
        'Decision',
        'Comment',
        'Decided by',
        'Decided at',
        'Outcome',
      ],
      ...items
        .sort(
          (a, b) =>
            a.server.displayName.localeCompare(b.server.displayName) ||
            (a.grantee?.displayName ?? '').localeCompare(b.grantee?.displayName ?? ''),
        )
        .map((i) => [
          i.server.displayName,
          i.role.database ?? '',
          localize(i.role.name, 'en'),
          i.role.roleName,
          i.role.risk,
          i.grantee?.displayName ?? '',
          i.accountName ?? '',
          iso(i.grantedAt),
          iso(i.expiresAt),
          i.reviewer?.name ?? '',
          i.decision ?? '',
          i.comment ?? '',
          i.decidedBy?.displayName ?? '',
          iso(i.decidedAt),
          i.outcome ?? '',
        ]),
    ]);
    await this.ctx.audit.record({
      action: 'dbaccess.review.exported',
      entityType: REVIEW_ENTITY,
      entityId: id,
      entityLabel: r.name,
      metadata: { rows: items.length },
    });
    return { filename: `${formatReviewRef(r.number)}-${r.dueOn}.csv`, body };
  }

  /* ───────────── schedule ───────────── */

  /** Hourly: start scheduled campaigns, remind reviewers before the due date, close overdue campaigns. */
  async tick(log: (l: string) => void = () => undefined) {
    const today = todayIn(COMPANY_TZ);
    let started = 0;
    let reminded = 0;
    let closed = 0;
    for (const r of await this.db
      .select()
      .from(reviews)
      .where(and(eq(reviews.status, 'scheduled'), lte(reviews.startOn, today)))) {
      await this.start(r.id);
      started++;
    }
    for (const r of await this.db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.status, 'active'),
          lte(reviews.dueOn, addDays(today, REVIEW_REMIND_DAYS)),
          isNull(reviews.remindedAt),
        ),
      )) {
      if (r.dueOn < today) continue;
      reminded += await this.remind(r);
    }
    for (const r of await this.db
      .select()
      .from(reviews)
      .where(and(eq(reviews.status, 'active'), sql`${reviews.dueOn} < ${today}`))) {
      await this.close(r.id, null);
      closed++;
    }
    log(`${started} started, ${reminded} reminders, ${closed} closed`);
    return { started, reminded, closed };
  }

  private async remind(r: ReviewRow): Promise<number> {
    const pending = await this.db
      .select({ item: reviewItems, granteeId: grants.userId })
      .from(reviewItems)
      .innerJoin(grants, eq(grants.id, reviewItems.grantId))
      .where(and(eq(reviewItems.reviewId, r.id), isNull(reviewItems.decision)));
    const counts = new Map<string, number>();
    for (const p of pending) {
      const people = p.item.reviewerUserId
        ? [p.item.reviewerUserId]
        : p.item.reviewerGroupId
          ? await activeMembers(this.db, p.item.reviewerGroupId)
          : [];
      for (const u of people) if (u !== p.granteeId) counts.set(u, (counts.get(u) ?? 0) + 1);
    }
    await this.ctx.transaction(async (tx) => {
      await tx.update(reviews).set({ remindedAt: new Date() }).where(eq(reviews.id, r.id));
      for (const [userId, n] of counts)
        await this.ctx.notifications.notify(
          {
            type: 'dbaccess.review.reminder',
            recipients: [userId],
            params: { name: r.name, pending: n, dueOn: r.dueOn, policy: r.policy },
            href: `/dbaccess/reviews/${formatReviewRef(r.number)}?view=mine`,
          },
          { tx },
        );
    });
    return counts.size;
  }

  /** Dashboard: campaigns waiting for the caller. */
  async awaiting(auth: AuthContext) {
    const cond = await this.reviewerCond(auth);
    const rows = await this.db
      .select({
        id: reviews.id,
        number: reviews.number,
        name: reviews.name,
        dueOn: reviews.dueOn,
        n: count(),
      })
      .from(reviewItems)
      .innerJoin(reviews, eq(reviews.id, reviewItems.reviewId))
      .innerJoin(grants, eq(grants.id, reviewItems.grantId))
      .where(and(eq(reviews.status, 'active'), isNull(reviewItems.decision), cond))
      .groupBy(reviews.id, reviews.number, reviews.name, reviews.dueOn)
      .orderBy(asc(reviews.dueOn));
    return rows.map((r) => ({
      id: r.id,
      reference: formatReviewRef(r.number),
      name: r.name,
      dueOn: r.dueOn,
      pending: r.n,
    }));
  }
}

/** "Q4 2026 database access review" → "Q1 2027 database access review" (else the name with the start date). */
function nextName(name: string, startOn: string): string {
  const m = /^Q([1-4]) (\d{4})(.*)$/.exec(name);
  if (!m) return `${name.replace(/ \(\d{4}-\d{2}-\d{2}\)$/, '')} (${startOn})`;
  const q = Number(m[1]);
  const y = Number(m[2]);
  return q === 4 ? `Q1 ${y + 1}${m[3]}` : `Q${q + 1} ${y}${m[3]}`;
}
