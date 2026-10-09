import { forms } from '@isbp/db/schema';
import type { Reference, ReferenceFinder } from '@isbp/sdk/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { OPEN_STATUSES, refOf, ticketHref } from './rules';
import { catalogItems, categories, tickets } from './schema';

/**
 * A group the service desk still routes to: open tickets in its queue, and active categories and catalog items that
 * send new tickets to it (deleting the group would quietly leave them unassigned).
 */
const groupReferences: ReferenceFinder = async ({ id }, _ctx, { tx, limit }) => {
  const open = await tx
    .select({ type: tickets.type, number: tickets.number, title: tickets.title })
    .from(tickets)
    .where(and(eq(tickets.assignmentGroupId, id), inArray(tickets.status, OPEN_STATUSES)))
    .orderBy(desc(tickets.createdAt))
    .limit(limit);
  const out: Reference[] = open.map((t) => ({
    kind: 'work',
    label: `${refOf(t)} · ${t.title}`,
    href: ticketHref(refOf(t)),
  }));
  if (out.length >= limit) return out;
  const routed = await tx
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.defaultGroupId, id), eq(categories.active, true)))
    .limit(limit - out.length);
  out.push(...routed.map((c) => ({ kind: 'setting' as const, label: c.name, href: '/itsm/settings' })));
  if (out.length >= limit) return out;
  const catalog = await tx
    .select({ formKey: catalogItems.formKey, name: forms.name })
    .from(catalogItems)
    .leftJoin(forms, eq(forms.key, catalogItems.formKey))
    .where(and(eq(catalogItems.groupId, id), eq(catalogItems.active, true)))
    .limit(limit - out.length);
  out.push(
    ...catalog.map((c) => ({
      kind: 'setting' as const,
      label: c.name ?? c.formKey,
      href: '/itsm/settings?tab=catalog',
    })),
  );
  return out;
};

export const references = { 'core.group': groupReferences };
