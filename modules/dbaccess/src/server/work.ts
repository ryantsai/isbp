/** What waits for a person in database access (`manifest.work`, shown on My work): their part of active reviews. */
import type { NavigationCheck, WorkProvider } from '@isbp/sdk/server';
import { and, eq, inArray } from 'drizzle-orm';
import { LIVE_GRANT_STATUSES } from '../model';
import { grants } from './schema';
import { services } from './services';

/** Grants the person (or their group) must decide in active access reviews, one row per review. */
const reviews: WorkProvider = async (auth, ctx, { limit }) => {
  const awaiting = await services(ctx).reviews.awaiting(auth);
  return {
    count: awaiting.reduce((n, r) => n + r.pending, 0),
    items: awaiting.slice(0, limit).map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: r.reference,
      detail: { key: 'dbaccess.work.toDecide', params: { count: r.pending } },
      href: `/dbaccess/reviews/${r.reference}?view=mine`,
      due: r.dueOn,
    })),
  };
};

export const dbaccessWork = { reviews };

/** "My database access" in the sidebar for the people who hold database access (to see it or reveal a password). */
const mine: NavigationCheck = async (auth, ctx) => {
  const me = auth.user?.id;
  if (!me) return false;
  const [row] = await ctx.db
    .select({ id: grants.id })
    .from(grants)
    .where(and(eq(grants.userId, me), inArray(grants.status, [...LIVE_GRANT_STATUSES])))
    .limit(1);
  return Boolean(row);
};

export const dbaccessNavigation = { mine };
