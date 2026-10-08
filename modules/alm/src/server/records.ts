/**
 * Applications and releases as linkable records (`alm.application`, `alm.release`) for the platform's
 * record registry: the "Linked records" and attachment panels, and pickers in other modules. Visibility is
 * the same as the pages (`alm.apps.read`); `editable` follows the ownership rule (`access.ts`).
 */
import {
  type AuthContext,
  likePattern,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
  type SearchHit,
} from '@isbp/sdk/server';
import { departments, groups } from '@isbp/db/schema';
import { and, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AppFacts } from '../manifest';
import { appHref, RELEASE_TONE, releaseHref, STAGE_TONE } from '../model';
import { groupsOf, READ, viewerOf } from './access';
import { appSearchCondition } from './applications';
import { applications, releases } from './schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validIds = (ids: readonly string[]) => [...new Set(ids.filter((id) => UUID_RE.test(id)))];

type AppRow = typeof applications.$inferSelect;
type ReleaseRow = typeof releases.$inferSelect;

/** "erp 12.1", "Finance ERP 12", "12.1.0": a release by version, or by application and version. */
export function releaseSearchCondition(term: string): SQL {
  const pattern = likePattern(term.trim());
  return or(
    ilike(releases.version, pattern),
    ilike(releases.name, pattern),
    sql`(${applications.code} || ' ' || ${releases.version}) ilike ${pattern}`,
    sql`(${applications.name} || ' ' || ${releases.version}) ilike ${pattern}`,
  )!;
}

async function appSummaries(rows: AppRow[], ctx: ModuleContext, auth: AuthContext): Promise<RecordSummary[]> {
  const groups = await groupsOf(ctx.db, auth);
  return rows.map((a) => ({
    id: a.id,
    reference: a.code,
    title: a.name,
    subtitle: a.vendor,
    status: { key: `alm.stage.${a.stage}`, tone: STAGE_TONE[a.stage] },
    href: appHref(a.code),
    editable: viewerOf(auth, a, groups).canEdit,
  }));
}

async function releaseSummaries(
  rows: { release: ReleaseRow; app: AppRow }[],
  ctx: ModuleContext,
  auth: AuthContext,
): Promise<RecordSummary[]> {
  const groups = await groupsOf(ctx.db, auth);
  return rows.map(({ release, app }) => ({
    id: release.id,
    reference: `${app.code} ${release.version}`,
    title: release.name || `${app.name} ${release.version}`,
    subtitle: app.name,
    status: { key: `alm.releaseStatus.${release.status}`, tone: RELEASE_TONE[release.status] },
    href: releaseHref(app.code, release.version),
    editable: viewerOf(auth, app, groups).canManageReleases,
  }));
}

/** Approval facts of applications (`appFactsSchema`) by id — not permission-filtered (they route approvals). */
async function appFacts(ids: readonly string[], ctx: ModuleContext): Promise<Map<string, AppFacts>> {
  const valid = validIds(ids);
  if (!valid.length) return new Map();
  const team = alias(groups, 'team_group');
  const support = alias(groups, 'support_group');
  const rows = await ctx.db
    .select({ app: applications, team: team.key, support: support.key, departmentCode: departments.code })
    .from(applications)
    .leftJoin(team, eq(team.id, applications.teamGroupId))
    .leftJoin(support, eq(support.id, applications.supportGroupId))
    .leftJoin(departments, eq(departments.id, applications.departmentId))
    .where(inArray(applications.id, valid));
  return new Map(
    rows.map(({ app: a, team: teamKey, support: supportKey, departmentCode }) => [
      a.id,
      {
        code: a.code,
        stage: a.stage,
        criticality: a.criticality,
        hosting: a.hosting,
        dataClassification: a.dataClassification,
        disposition: a.disposition ?? null,
        ownerId: a.technicalOwnerId,
        businessOwnerId: a.businessOwnerId,
        teamGroup: teamKey,
        supportGroup: supportKey,
        departmentCode,
      },
    ]),
  );
}

const application: RecordResolver = {
  facts: appFacts,
  async resolve(ids, ctx, auth) {
    const valid = validIds(ids);
    if (!valid.length || !auth.can(READ)) return [];
    const rows = await ctx.db.select().from(applications).where(inArray(applications.id, valid));
    return appSummaries(rows, ctx, auth);
  },
  async search(query, ctx, auth, limit) {
    if (!auth.can(READ)) return [];
    const q = query.trim();
    const rows = await ctx.db
      .select()
      .from(applications)
      .where(q ? appSearchCondition(q) : undefined)
      .orderBy(
        q ? sql`${applications.code} = ${q.toLowerCase()} desc` : desc(applications.updatedAt),
        applications.name,
      )
      .limit(limit);
    return appSummaries(rows, ctx, auth);
  },
};

const release: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const valid = validIds(ids);
    if (!valid.length || !auth.can(READ)) return [];
    const rows = await ctx.db
      .select({ release: releases, app: applications })
      .from(releases)
      .innerJoin(applications, eq(applications.id, releases.applicationId))
      .where(inArray(releases.id, valid));
    return releaseSummaries(rows, ctx, auth);
  },
  async search(query, ctx, auth, limit) {
    if (!auth.can(READ)) return [];
    const q = query.trim();
    const rows = await ctx.db
      .select({ release: releases, app: applications })
      .from(releases)
      .innerJoin(applications, eq(applications.id, releases.applicationId))
      .where(q ? releaseSearchCondition(q) : undefined)
      .orderBy(desc(releases.updatedAt))
      .limit(limit);
    return releaseSummaries(rows, ctx, auth);
  },
};

export const records = { application, release };

/** Command palette: applications by code or name, releases as "erp 12.1". */
export async function search(
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
): Promise<SearchHit[]> {
  if (!auth.can(READ)) return [];
  const q = query.trim();
  if (!q) return [];
  const [apps, rels] = await Promise.all([
    ctx.db
      .select()
      .from(applications)
      .where(appSearchCondition(q))
      .orderBy(sql`${applications.code} = ${q.toLowerCase()} desc`, applications.name)
      .limit(limit),
    ctx.db
      .select({ release: releases, app: applications })
      .from(releases)
      .innerJoin(applications, eq(applications.id, releases.applicationId))
      .where(and(releaseSearchCondition(q)))
      .orderBy(desc(releases.createdAt))
      .limit(limit),
  ]);
  const hits: SearchHit[] = [
    ...apps.map((a) => ({
      id: a.id,
      type: 'application',
      title: a.name,
      subtitle: a.code,
      href: appHref(a.code),
      icon: 'app-window',
    })),
    ...rels.map(({ release: r, app: a }) => ({
      id: r.id,
      type: 'release',
      title: `${a.name} ${r.version}`,
      subtitle: r.name ?? a.code,
      href: releaseHref(a.code, r.version),
      icon: 'rocket',
    })),
  ];
  return hits.slice(0, limit);
}
