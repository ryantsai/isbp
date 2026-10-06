import { users } from '@isbp/db/schema';
import type { Db } from '@isbp/sdk/server';
import { inArray } from 'drizzle-orm';

export interface PersonRef {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Batch-loads display references for user ids (missing ids are simply absent). */
export async function peopleById(
  db: Db,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, PersonRef>> {
  const unique = [...new Set([...ids].filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

export function ref(map: Map<string, PersonRef>, id: string | null | undefined): PersonRef | null {
  if (!id) return null;
  return map.get(id) ?? { id, displayName: '?', avatarUrl: null };
}
