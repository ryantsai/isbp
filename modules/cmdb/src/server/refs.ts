import { departments, groups, users } from '@isbp/db/schema';
import type { Db, LocalizedText } from '@isbp/sdk/server';
import { eq, inArray } from 'drizzle-orm';
import { formatCiNumber } from '../model';
import { ciClasses, cis } from './schema';

export type CiRow = typeof cis.$inferSelect;
export type ClassRow = typeof ciClasses.$inferSelect;

/** Columns for a CI with its class (enough for a `CiRef`). */
export const refColumns = {
  ci: cis,
  className: ciClasses.name,
  classIcon: ciClasses.icon,
};

/** Columns for a CI with class, owner, support group and department (a `CiSummary`). */
export const summaryColumns = {
  ...refColumns,
  ownerName: users.displayName,
  ownerAvatar: users.avatarUrl,
  groupName: groups.name,
  departmentName: departments.name,
};

export interface RefRow {
  ci: CiRow;
  className: LocalizedText;
  classIcon: string;
}

export interface SummaryRow extends RefRow {
  ownerName: string | null;
  ownerAvatar: string | null;
  groupName: string | null;
  departmentName: string | null;
}

/** `select … from cis join ci_classes` (plus people and groups for summaries). */
export function selectRefs(db: Db) {
  return db.select(refColumns).from(cis).innerJoin(ciClasses, eq(ciClasses.key, cis.classKey));
}

export function selectSummaries(db: Db) {
  return db
    .select(summaryColumns)
    .from(cis)
    .innerJoin(ciClasses, eq(ciClasses.key, cis.classKey))
    .leftJoin(users, eq(users.id, cis.ownerId))
    .leftJoin(groups, eq(groups.id, cis.supportGroupId))
    .leftJoin(departments, eq(departments.id, cis.departmentId));
}

export function toRef(r: RefRow) {
  return {
    id: r.ci.id,
    number: r.ci.number,
    reference: formatCiNumber(r.ci.number),
    name: r.ci.name,
    class: { key: r.ci.classKey, name: r.className, icon: r.classIcon },
    status: r.ci.status,
    environment: r.ci.environment,
    criticality: r.ci.criticality,
  };
}

export function toSummary(r: SummaryRow) {
  return {
    ...toRef(r),
    owner: r.ci.ownerId
      ? { id: r.ci.ownerId, displayName: r.ownerName ?? '—', avatarUrl: r.ownerAvatar }
      : null,
    supportGroup: r.ci.supportGroupId ? { id: r.ci.supportGroupId, name: r.groupName ?? '—' } : null,
    department: r.ci.departmentId ? { id: r.ci.departmentId, name: r.departmentName ?? '—' } : null,
    tags: r.ci.tags,
    updatedAt: r.ci.updatedAt,
  };
}

export type CiRefDto = ReturnType<typeof toRef>;

/** CI refs by id (one query), for relationship and impact lists. */
export async function refsById(db: Db, ids: readonly string[]): Promise<Map<string, CiRefDto>> {
  if (!ids.length) return new Map();
  const rows = await selectRefs(db).where(inArray(cis.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.ci.id, toRef(r)]));
}

/** `CI-00042 Finance ERP` — the label audit rows show. */
export const auditLabel = (ci: { number: number; name: string }) => `${formatCiNumber(ci.number)} ${ci.name}`;
