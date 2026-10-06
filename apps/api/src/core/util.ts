import type { PermissionReach } from '@isbp/sdk/server';
import { type AnyColumn, asc, desc, inArray, or, type SQL, sql } from 'drizzle-orm';

export { likePattern } from '@isbp/sdk/server';

/** `?sort=-createdAt` → ORDER BY, restricted to an allow-list, with a stable tiebreaker. */
export function orderBy(
  sort: string | undefined,
  columns: Record<string, AnyColumn | SQL>,
  fallback: string,
  tiebreaker: AnyColumn,
): SQL[] {
  const raw = sort ?? fallback;
  const descending = raw.startsWith('-');
  const key = descending ? raw.slice(1) : raw;
  const column = columns[key] ?? columns[fallback.replace(/^-/, '')]!;
  return [descending ? desc(column) : asc(column), asc(tiebreaker)];
}

/**
 * Turns a permission reach into a WHERE clause: undefined for global reach, otherwise rows in the
 * reachable departments (or explicitly granted records). An empty reach matches nothing.
 */
export function reachFilter(
  reach: PermissionReach,
  departmentColumn: AnyColumn,
  idColumn: AnyColumn,
  recordType: string,
): SQL | undefined {
  if (reach.global) return undefined;
  const parts: SQL[] = [];
  if (reach.departmentIds.length) parts.push(inArray(departmentColumn, reach.departmentIds));
  const ids = reach.records.filter((r) => r.type === recordType).map((r) => r.id);
  if (ids.length) parts.push(inArray(idColumn, ids));
  return parts.length ? or(...parts) : sql`false`;
}

export function pageOffset(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}

/** Validates a post-login redirect target: same-origin relative paths only (no open redirects). */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/api/'))
    return '/';
  return next.slice(0, 1000);
}
