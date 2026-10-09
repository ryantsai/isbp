/**
 * What waits for a person in information security (`manifest.work`, shown on My work): their part of open stocktakes,
 * the account reviews they are the reviewer of, and the shared accounts whose password they must change.
 */
import type { WorkProvider } from '@isbp/sdk/server';
import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { formatRef } from '../model';
import { accountHref } from './accounts';
import { reviewHref } from './reviews';
import { reviews, sharedAccounts, stocktakeItems, stocktakes } from './schema';
import { stocktakeHref } from './stocktakes';
import { groupIdsOf } from './support';

/** Pending stocktake items assigned to the person or their groups, one row per stocktake. */
const stocktakeChecks: WorkProvider = async (auth, ctx, { limit }) => {
  const me = auth.user!.id;
  const groupIds = await groupIdsOf(ctx.db, me);
  const rows = await ctx.db
    .select({
      id: stocktakes.id,
      number: stocktakes.number,
      name: stocktakes.name,
      dueOn: stocktakes.dueOn,
      n: count(),
    })
    .from(stocktakeItems)
    .innerJoin(stocktakes, eq(stocktakes.id, stocktakeItems.stocktakeId))
    .where(
      and(
        eq(stocktakes.status, 'open'),
        isNull(stocktakeItems.result),
        or(
          eq(stocktakeItems.assigneeId, me),
          groupIds.length ? inArray(stocktakeItems.assigneeGroupId, groupIds) : undefined,
        ),
      ),
    )
    .groupBy(stocktakes.id, stocktakes.number, stocktakes.name, stocktakes.dueOn)
    .orderBy(asc(stocktakes.dueOn));
  return {
    count: rows.reduce((n, r) => n + r.n, 0),
    items: rows.slice(0, limit).map((r) => {
      const reference = formatRef('stocktake', r.number);
      return {
        id: r.id,
        title: r.name,
        subtitle: reference,
        detail: { key: 'isms.work.toCheck', params: { count: r.n } },
        href: `${stocktakeHref(reference)}?mine=true`,
        due: r.dueOn,
      };
    }),
  };
};

/** Open account reviews the person is the reviewer of. */
const accountReviews: WorkProvider = async (auth, ctx, { limit }) => {
  const where = and(eq(reviews.status, 'open'), eq(reviews.reviewerId, auth.user!.id));
  const [[total], rows] = await Promise.all([
    ctx.db.select({ n: count() }).from(reviews).where(where),
    limit > 0
      ? ctx.db
          .select({ id: reviews.id, number: reviews.number, target: reviews.target, dueOn: reviews.dueOn })
          .from(reviews)
          .where(where)
          .orderBy(asc(reviews.dueOn))
          .limit(limit)
      : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map((r) => {
      const reference = formatRef('review', r.number);
      return { id: r.id, title: r.target, subtitle: reference, href: reviewHref(reference), due: r.dueOn };
    }),
  };
};

/** Active shared accounts the person looks after whose password must be changed. */
const passwordChanges: WorkProvider = async (auth, ctx, { limit }) => {
  const where = and(
    eq(sharedAccounts.status, 'active'),
    isNotNull(sharedAccounts.passwordDueSince),
    eq(sharedAccounts.custodianId, auth.user!.id),
  );
  const [[total], rows] = await Promise.all([
    ctx.db.select({ n: count() }).from(sharedAccounts).where(where),
    limit > 0
      ? ctx.db
          .select({
            id: sharedAccounts.id,
            number: sharedAccounts.number,
            accountName: sharedAccounts.accountName,
            targetSystem: sharedAccounts.targetSystem,
            since: sharedAccounts.passwordDueSince,
          })
          .from(sharedAccounts)
          .where(where)
          .orderBy(sql`${sharedAccounts.passwordDueSince} asc`)
          .limit(limit)
      : Promise.resolve([]),
  ]);
  return {
    count: total?.n ?? 0,
    items: rows.map((r) => {
      const reference = formatRef('account', r.number);
      return {
        id: r.id,
        title: r.targetSystem ? `${r.accountName} · ${r.targetSystem}` : r.accountName,
        subtitle: reference,
        href: accountHref(reference),
        since: r.since,
      };
    }),
  };
};

export const ismsWork = {
  'stocktake-checks': stocktakeChecks,
  'account-reviews': accountReviews,
  'password-changes': passwordChanges,
};
