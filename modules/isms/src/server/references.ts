import type { ReferenceFinder } from '@isbp/sdk/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { formatRef } from '../model';
import { stocktakeItems, stocktakes } from './schema';
import { stocktakeHref } from './stocktakes';

/** Stocktakes in progress with items still to check by the group (they would be left without anyone to do them). */
const groupReferences: ReferenceFinder = async ({ id }, _ctx, { tx, limit }) => {
  const rows = await tx
    .selectDistinct({ number: stocktakes.number, name: stocktakes.name })
    .from(stocktakeItems)
    .innerJoin(stocktakes, eq(stocktakes.id, stocktakeItems.stocktakeId))
    .where(
      and(
        eq(stocktakeItems.assigneeGroupId, id),
        isNull(stocktakeItems.result),
        sql`${stocktakes.status} in ('scheduled', 'open')`,
      ),
    )
    .limit(limit);
  return rows.map((s) => {
    const reference = formatRef('stocktake', s.number);
    return { kind: 'work', label: `${reference} · ${s.name}`, href: stocktakeHref(reference) };
  });
};

export const references = { 'core.group': groupReferences };
