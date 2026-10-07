/**
 * ITSM changes as ALM sees them. ALM **reads** `itsm.tickets` + `itsm.changes` (it depends on ITSM) and the
 * record links between releases and changes; it never writes them.
 */
import { recordLinks } from '@isbp/db/schema';
import { formatTicketRef, parseTicketRef } from '@isbp/module-itsm/contracts';
import { changes, tickets } from '@isbp/module-itsm/schema';
import type { Db, ModuleContext, RecordRef } from '@isbp/sdk/server';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { z } from 'zod';
import type { changeInfoSchema } from '../contracts';
import { inWindow, isAuthorizedChange, type PolicyChange, rankChanges } from '../model';

export const CHANGE_TYPE = 'itsm.change';
export const RELEASE_TYPE = 'alm.release';
export const APPLICATION_TYPE = 'alm.application';

export interface ChangeRow {
  id: string;
  number: number;
  title: string;
  status: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const columns = {
  id: tickets.id,
  number: tickets.number,
  title: tickets.title,
  status: tickets.status,
  plannedStart: changes.plannedStart,
  plannedEnd: changes.plannedEnd,
};

export const changeReference = (c: { number: number }) => formatTicketRef('change', c.number);

export async function changesByIds(db: Db, ids: readonly string[]): Promise<Map<string, ChangeRow>> {
  const valid = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  if (!valid.length) return new Map();
  const rows = await db
    .select(columns)
    .from(tickets)
    .innerJoin(changes, eq(changes.ticketId, tickets.id))
    .where(and(inArray(tickets.id, valid), eq(tickets.type, 'change')));
  return new Map(rows.map((r) => [r.id, r]));
}

/** A change by id or reference (`CHG-00012`); null when there is no such change. */
export async function findChange(
  db: Db,
  by: { id?: string | null; reference?: string | null },
): Promise<ChangeRow | null> {
  if (by.id) return (await changesByIds(db, [by.id])).get(by.id) ?? null;
  const ref = by.reference ? parseTicketRef(by.reference) : null;
  if (!ref || ref.type !== 'change') return null;
  const [row] = await db
    .select(columns)
    .from(tickets)
    .innerJoin(changes, eq(changes.ticketId, tickets.id))
    .where(and(eq(tickets.type, 'change'), eq(tickets.number, ref.number)));
  return row ?? null;
}

export function toPolicyChange(c: ChangeRow, named = false): PolicyChange {
  return {
    id: c.id,
    reference: changeReference(c),
    status: c.status,
    plannedStart: c.plannedStart,
    plannedEnd: c.plannedEnd,
    named,
  };
}

export type ChangeInfoOut = z.output<typeof changeInfoSchema>;

export function toChangeInfo(c: ChangeRow | PolicyChange, now: Date, title?: string): ChangeInfoOut {
  const reference = 'reference' in c ? c.reference : changeReference(c);
  return {
    id: c.id,
    reference,
    title: title ?? ('title' in c ? c.title : reference),
    status: c.status,
    plannedStart: c.plannedStart,
    plannedEnd: c.plannedEnd,
    authorized: isAuthorizedChange(c.status),
    inWindow: inWindow(c, now),
    href: `/itsm/tickets/${reference}`,
  };
}

/** Changes linked to one release (through `ctx.records`), best candidate first. */
export async function linkedChanges(
  ctx: ModuleContext,
  releaseId: string,
  now: Date,
  tx?: Db,
): Promise<ChangeRow[]> {
  const refs = await ctx.records.linked({ type: RELEASE_TYPE, id: releaseId }, { types: [CHANGE_TYPE], tx });
  const rows = await changesByIds(
    tx ?? ctx.db,
    refs.map((r) => r.id),
  );
  return sortRows([...rows.values()], now);
}

/** Changes linked to many releases (list pages): one read of `core.record_links`, one of ITSM. */
export async function linkedChangesOf(
  db: Db,
  releaseIds: readonly string[],
  now: Date,
): Promise<Map<string, ChangeRow[]>> {
  const out = new Map<string, ChangeRow[]>();
  if (!releaseIds.length) return out;
  const ids = [...new Set(releaseIds)];
  const links = await db
    .select({
      aType: recordLinks.aType,
      aId: recordLinks.aId,
      bType: recordLinks.bType,
      bId: recordLinks.bId,
    })
    .from(recordLinks)
    .where(
      or(
        and(
          eq(recordLinks.aType, RELEASE_TYPE),
          inArray(recordLinks.aId, ids),
          eq(recordLinks.bType, CHANGE_TYPE),
        ),
        and(
          eq(recordLinks.bType, RELEASE_TYPE),
          inArray(recordLinks.bId, ids),
          eq(recordLinks.aType, CHANGE_TYPE),
        ),
      ),
    );
  const pairs = links.map((l) =>
    l.aType === RELEASE_TYPE ? { release: l.aId, change: l.bId } : { release: l.bId, change: l.aId },
  );
  const rows = await changesByIds(
    db,
    pairs.map((p) => p.change),
  );
  for (const p of pairs) {
    const row = rows.get(p.change);
    if (row) out.set(p.release, [...(out.get(p.release) ?? []), row]);
  }
  for (const [k, v] of out) out.set(k, sortRows(v, now));
  return out;
}

/** Releases linked to a change (both directions of `core.record_links`). */
export async function releasesLinkedTo(ctx: ModuleContext, changeId: string): Promise<string[]> {
  const refs: RecordRef[] = await ctx.records.linked(
    { type: CHANGE_TYPE, id: changeId },
    { types: [RELEASE_TYPE] },
  );
  return refs.map((r) => r.id);
}

function sortRows(rows: ChangeRow[], now: Date): ChangeRow[] {
  const order = rankChanges(
    rows.map((r) => toPolicyChange(r)),
    now,
  ).map((c) => c.id);
  return order.map((id) => rows.find((r) => r.id === id)!);
}
