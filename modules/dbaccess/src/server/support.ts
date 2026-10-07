/** Small shared helpers: people and group lookups, refs for DTOs and database-name mapping. */
import { groupMembers, groups, users } from '@isbp/db/schema';
import type { Db } from '@isbp/sdk/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PersonRef, RoleRef, ServerRef } from '../contracts';
import type { Environment } from '../model';
import type { requestableRoles, servers } from './schema';

export type ServerRow = typeof servers.$inferSelect;
export type RoleRow = typeof requestableRoles.$inferSelect;

/** `''` (server level) ↔ `null` on the wire. */
export const dbOut = (database: string) => database || null;
export const dbIn = (database: string | null | undefined) => (database ?? '').trim();

export const serverRef = (
  s: Pick<ServerRow, 'id' | 'displayName' | 'engine' | 'environment'>,
): ServerRef => ({
  id: s.id,
  displayName: s.displayName,
  engine: s.engine as ServerRef['engine'],
  environment: s.environment as Environment,
});

export const roleRef = (r: RoleRow): RoleRef => ({
  id: r.id,
  name: r.name,
  roleName: r.roleName,
  database: dbOut(r.database),
  risk: r.risk,
});

export interface PersonInfo {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  username: string;
  email: string;
  status: string;
  timezone: string;
  locale: string;
  managerId: string | null;
}

export const personRef = (p: PersonInfo | undefined | null): PersonRef | null =>
  p ? { id: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl } : null;

const personColumns = {
  id: users.id,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  username: users.username,
  email: users.email,
  status: users.status,
  timezone: users.timezone,
  locale: users.locale,
  managerId: users.managerId,
};

export async function peopleByIds(
  db: Db,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PersonInfo>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map();
  const rows = await db.select(personColumns).from(users).where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r as PersonInfo]));
}

export async function personById(db: Db, id: string): Promise<PersonInfo | null> {
  return (await peopleByIds(db, [id])).get(id) ?? null;
}

/** Everyone (for orphan detection and adoption suggestions): id, names and whether they are active. */
export async function allPeople(db: Db) {
  const rows = await db
    .select({ id: users.id, username: users.username, email: users.email, status: users.status })
    .from(users);
  return rows.map((r) => ({ id: r.id, username: r.username, email: r.email, active: r.status === 'active' }));
}

export async function groupsByIds(
  db: Db,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, { id: string; key: string; name: string }>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ id: groups.id, key: groups.key, name: groups.name })
    .from(groups)
    .where(inArray(groups.id, wanted));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Active members of a group (capped: workflow slots and notifications fan out to at most 100). */
export async function activeMembers(db: Db, groupId: string, limit = 100): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), eq(users.status, 'active')))
    .orderBy(users.displayName)
    .limit(limit);
  return rows.map((r) => r.id);
}

/** `count(*)` as a number. */
export const countAll = sql<number>`count(*)::int`;
