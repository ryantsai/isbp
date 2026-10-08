/**
 * Small, rarely-changing configuration (categories, calendars, SLA policies) cached per process for a
 * few seconds, plus batched lookups of people and groups for DTOs.
 */
import { groups, users } from '@isbp/db/schema';
import { type Db, localize, type LocalizedText } from '@isbp/sdk/server';
import { asc, eq, inArray, is } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { TicketType } from '../contracts';
import type { CalendarSpec } from './business-time';
import { businessCalendars, categories, slaPolicies } from './schema';

const TTL_MS = 15_000;

export interface CategoryInfo {
  id: string;
  key: string;
  name: LocalizedText;
  parentId: string | null;
  ticketTypes: TicketType[];
  defaultGroupId: string | null;
  active: boolean;
  sortOrder: number;
  /** "Network › VPN" (English). */
  path: string;
  ancestors: { id: string; name: LocalizedText }[];
}

export type CalendarInfo = typeof businessCalendars.$inferSelect & { spec: CalendarSpec };
export type PolicyRow = typeof slaPolicies.$inferSelect;

interface Entry<T> {
  at: number;
  value: Promise<T>;
}

let categoryCache: Entry<Map<string, CategoryInfo>> | null = null;
let calendarCache: Entry<Map<string, CalendarInfo>> | null = null;
let policyCache: Entry<PolicyRow[]> | null = null;

/**
 * Inside a transaction (a change set being applied, or a dry run that is rolled back) the tables are read
 * directly and nothing is cached: the transaction sees its own changes, and they never outlive a rollback.
 */
function cached<T>(
  db: Db,
  entry: Entry<T> | null,
  load: () => Promise<T>,
  set: (e: Entry<T>) => void,
): Promise<T> {
  if (is(db, PgTransaction)) return load();
  if (entry && Date.now() - entry.at < TTL_MS) return entry.value;
  const value = load();
  set({ at: Date.now(), value });
  value.catch(() => set({ at: 0, value }));
  return value;
}

/** Drop cached configuration after an admin change. */
export function invalidateLookups() {
  categoryCache = null;
  calendarCache = null;
  policyCache = null;
}

export function categoryMap(db: Db): Promise<Map<string, CategoryInfo>> {
  return cached(
    db,
    categoryCache,
    async () => {
      const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.key));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const out = new Map<string, CategoryInfo>();
      for (const r of rows) {
        const chain: (typeof rows)[number][] = [];
        const seen = new Set<string>();
        for (let p = r.parentId ? byId.get(r.parentId) : undefined; p && !seen.has(p.id);) {
          seen.add(p.id);
          chain.unshift(p);
          p = p.parentId ? byId.get(p.parentId) : undefined;
        }
        out.set(r.id, {
          id: r.id,
          key: r.key,
          name: r.name,
          parentId: r.parentId,
          ticketTypes: r.ticketTypes,
          defaultGroupId: r.defaultGroupId,
          active: r.active,
          sortOrder: r.sortOrder,
          path: [...chain, r].map((c) => localize(c.name, 'en')).join(' › '),
          ancestors: chain.map((c) => ({ id: c.id, name: c.name })),
        });
      }
      return out;
    },
    (e) => (categoryCache = e),
  );
}

export function calendarMap(db: Db): Promise<Map<string, CalendarInfo>> {
  return cached(
    db,
    calendarCache,
    async () => {
      const rows = await db.select().from(businessCalendars);
      return new Map(
        rows.map((r) => [
          r.id,
          {
            ...r,
            spec: { timezone: r.timezone, hours: r.hours, holidays: r.holidays, alwaysOpen: r.alwaysOpen },
          },
        ]),
      );
    },
    (e) => (calendarCache = e),
  );
}

/** Active SLA policies in evaluation order. */
export function activePolicies(db: Db): Promise<PolicyRow[]> {
  return cached(
    db,
    policyCache,
    () =>
      db
        .select()
        .from(slaPolicies)
        .where(eq(slaPolicies.active, true))
        .orderBy(asc(slaPolicies.sortOrder), asc(slaPolicies.createdAt)),
    (e) => (policyCache = e),
  );
}

export function categoryRef(c: CategoryInfo | undefined | null) {
  return c ? { id: c.id, key: c.key, name: c.name, path: c.path } : null;
}

export interface PersonInfo {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  departmentId: string | null;
  status: string;
}

export async function peopleByIds(
  db: Db,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PersonInfo>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      locale: users.locale,
      departmentId: users.departmentId,
      status: users.status,
    })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

export const personRef = (p: PersonInfo | undefined | null) =>
  p ? { id: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl } : null;

export interface GroupInfo {
  id: string;
  key: string;
  name: string;
}

export async function groupsByIds(
  db: Db,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, GroupInfo>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: groups.id, key: groups.key, name: groups.name })
    .from(groups)
    .where(inArray(groups.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}
