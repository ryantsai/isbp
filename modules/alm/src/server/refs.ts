/** Queries and row → DTO mappers shared by the services, record resolvers, search and AI tools. */
import { departments, groups, users } from '@isbp/db/schema';
import { formatCiNumber } from '@isbp/module-cmdb/model';
import { cis } from '@isbp/module-cmdb/schema';
import type { Db } from '@isbp/sdk/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  appSummarySchema,
  CiInfo,
  deploymentSchema,
  environmentSchema,
  lastDeploymentSchema,
  repositorySchema,
} from '../contracts';
import { applications, deployments, environments, releases, type repositories } from './schema';

export type AppRow = typeof applications.$inferSelect;
export type EnvRow = typeof environments.$inferSelect;
export type ReleaseRow = typeof releases.$inferSelect;
export type DeploymentRow = typeof deployments.$inferSelect;
export type RepoRow = typeof repositories.$inferSelect;

/** Handler-side DTO types (dates are `Date`; the response schemas encode them). */
export type AppSummaryOut = z.output<typeof appSummarySchema>;
export type EnvironmentOut = z.output<typeof environmentSchema>;
export type RepositoryOut = z.output<typeof repositorySchema>;
export type DeploymentOut = z.output<typeof deploymentSchema>;
type LastDeployment = z.output<typeof lastDeploymentSchema>;

const businessOwner = alias(users, 'business_owner');
const technicalOwner = alias(users, 'technical_owner');
const team = alias(groups, 'team');
const support = alias(groups, 'support_group');

/** Columns for an application with its people, groups and department. */
const appColumns = {
  app: applications,
  boName: businessOwner.displayName,
  boAvatar: businessOwner.avatarUrl,
  toName: technicalOwner.displayName,
  toAvatar: technicalOwner.avatarUrl,
  teamName: team.name,
  supportName: support.name,
  departmentName: departments.name,
};

export function selectApps(db: Db) {
  return db
    .select(appColumns)
    .from(applications)
    .leftJoin(businessOwner, eq(businessOwner.id, applications.businessOwnerId))
    .leftJoin(technicalOwner, eq(technicalOwner.id, applications.technicalOwnerId))
    .leftJoin(team, eq(team.id, applications.teamGroupId))
    .leftJoin(support, eq(support.id, applications.supportGroupId))
    .leftJoin(departments, eq(departments.id, applications.departmentId));
}

export type AppJoinRow = Awaited<ReturnType<ReturnType<typeof selectApps>['execute']>>[number];

const person = (id: string | null, name: string | null, avatar: string | null) =>
  id ? { id, displayName: name ?? '—', avatarUrl: avatar } : null;
const named = (id: string | null, name: string | null) => (id ? { id, name: name ?? '—' } : null);

/** Production version and last deployment of many applications (two indexed queries). */
export async function appExtras(db: Db, ids: readonly string[]) {
  const production = new Map<string, string | null>();
  const last = new Map<string, LastDeployment>();
  if (!ids.length) return { production, last };
  const unique = [...new Set(ids)];
  const [prodRows, lastRows] = await Promise.all([
    db
      .selectDistinctOn([environments.applicationId], {
        applicationId: environments.applicationId,
        version: environments.currentVersion,
      })
      .from(environments)
      .where(and(inArray(environments.applicationId, unique), eq(environments.kind, 'production')))
      .orderBy(environments.applicationId, asc(environments.sort), asc(environments.createdAt)),
    db
      .selectDistinctOn([deployments.applicationId], {
        applicationId: deployments.applicationId,
        id: deployments.id,
        version: deployments.version,
        status: deployments.status,
        startedAt: deployments.startedAt,
        finishedAt: deployments.finishedAt,
        envId: environments.id,
        envName: environments.name,
        envKind: environments.kind,
      })
      .from(deployments)
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .where(inArray(deployments.applicationId, unique))
      .orderBy(deployments.applicationId, desc(deployments.startedAt), desc(deployments.createdAt)),
  ]);
  for (const r of prodRows) production.set(r.applicationId, r.version);
  for (const r of lastRows)
    last.set(r.applicationId, {
      id: r.id,
      environment: { id: r.envId, name: r.envName, kind: r.envKind },
      version: r.version,
      status: r.status,
      at: r.finishedAt ?? r.startedAt,
    });
  return { production, last };
}

export function toAppSummary(r: AppJoinRow, extras: Awaited<ReturnType<typeof appExtras>>): AppSummaryOut {
  const a = r.app;
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    stage: a.stage,
    criticality: a.criticality,
    disposition: a.disposition,
    hosting: a.hosting,
    businessOwner: person(a.businessOwnerId, r.boName, r.boAvatar),
    technicalOwner: person(a.technicalOwnerId, r.toName, r.toAvatar),
    team: named(a.teamGroupId, r.teamName),
    productionVersion: extras.production.get(a.id) ?? null,
    lastDeployment: extras.last.get(a.id) ?? null,
    updatedAt: a.updatedAt,
  };
}

export const groupRef = named;

export const supportAndDepartment = (r: AppJoinRow) => ({
  supportGroup: named(r.app.supportGroupId, r.supportName),
  department: named(r.app.departmentId, r.departmentName),
});

/* ───────────── CMDB ───────────── */

export async function ciInfos(db: Db, ids: readonly (string | null)[]): Promise<Map<string, CiInfo>> {
  const valid = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!valid.length) return new Map();
  const rows = await db
    .select({
      id: cis.id,
      number: cis.number,
      name: cis.name,
      classKey: cis.classKey,
      status: cis.status,
      criticality: cis.criticality,
    })
    .from(cis)
    .where(inArray(cis.id, valid));
  return new Map(
    rows.map((c) => [
      c.id,
      {
        id: c.id,
        reference: formatCiNumber(c.number),
        name: c.name,
        classKey: c.classKey,
        status: c.status,
        criticality: c.criticality,
      },
    ]),
  );
}

/* ───────────── environments & repositories ───────────── */

export function toEnvironment(
  e: EnvRow,
  ci: CiInfo | null,
  currentRelease: { id: string; version: string } | null,
  deploymentCount: number,
  lastVersion: string | null,
): EnvironmentOut {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    url: e.url,
    ci,
    sort: e.sort,
    currentVersion: e.currentVersion,
    currentRelease,
    lastDeployment:
      e.lastDeploymentId && e.lastStatus && e.lastDeployedAt
        ? { id: e.lastDeploymentId, version: lastVersion ?? '', status: e.lastStatus, at: e.lastDeployedAt }
        : null,
    deploymentCount,
    updatedAt: e.updatedAt,
  };
}

export function toRepository(r: RepoRow): RepositoryOut {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    provider: r.provider,
    defaultBranch: r.defaultBranch,
    lastCommit: r.lastCommitSha
      ? {
          sha: r.lastCommitSha,
          at: r.lastCommitAt,
          message: r.lastCommitMessage,
          author: r.lastCommitAuthor,
        }
      : null,
    branches: r.branches ?? null,
    pullRequests: r.pullRequests ?? null,
    syncedAt: r.syncedAt,
    updatedAt: r.updatedAt,
  };
}

/* ───────────── deployments ───────────── */

export function selectDeployments(db: Db) {
  return db
    .select({
      d: deployments,
      appCode: applications.code,
      appName: applications.name,
      envName: environments.name,
      envKind: environments.kind,
      releaseVersion: releases.version,
      releaseStatus: releases.status,
    })
    .from(deployments)
    .innerJoin(applications, eq(applications.id, deployments.applicationId))
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .leftJoin(releases, eq(releases.id, deployments.releaseId));
}

export type DeploymentJoinRow = Awaited<ReturnType<ReturnType<typeof selectDeployments>['execute']>>[number];

export function toDeployment(r: DeploymentJoinRow): DeploymentOut {
  const d = r.d;
  return {
    id: d.id,
    application: { id: d.applicationId, code: r.appCode, name: r.appName },
    environment: { id: d.environmentId, name: r.envName, kind: r.envKind },
    release:
      d.releaseId && r.releaseVersion && r.releaseStatus
        ? { id: d.releaseId, version: r.releaseVersion, status: r.releaseStatus }
        : null,
    version: d.version,
    status: d.status,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
    durationSeconds: d.finishedAt
      ? Math.max(0, Math.round((d.finishedAt.getTime() - d.startedAt.getTime()) / 1000))
      : null,
    actor: { id: d.deployedBy, name: d.actorName },
    source: d.source,
    change: d.changeReference ? { id: d.changeId, reference: d.changeReference } : null,
    overrideReason: d.overrideReason,
    policyWarning: d.policyWarning,
    commitSha: d.commitSha,
    pipelineUrl: d.pipelineUrl,
    notes: d.notes,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
