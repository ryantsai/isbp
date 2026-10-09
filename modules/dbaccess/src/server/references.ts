import type { ReferenceFinder } from '@isbp/sdk/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { formatReviewRef } from '../model';
import { reviewItems, reviews } from './schema';

/** Access reviews in progress with grants still to decide by the group. */
const groupReferences: ReferenceFinder = async ({ id }, _ctx, { tx, limit }) => {
  const rows = await tx
    .selectDistinct({ number: reviews.number, name: reviews.name })
    .from(reviewItems)
    .innerJoin(reviews, eq(reviews.id, reviewItems.reviewId))
    .where(
      and(
        eq(reviewItems.reviewerGroupId, id),
        isNull(reviewItems.decision),
        sql`${reviews.status} in ('scheduled', 'active')`,
      ),
    )
    .limit(limit);
  return rows.map((r) => {
    const reference = formatReviewRef(r.number);
    return { kind: 'work', label: `${reference} · ${r.name}`, href: `/dbaccess/reviews/${reference}` };
  });
};

export const references = { 'core.group': groupReferences };
