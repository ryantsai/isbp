import { createdAt, departments, groups, id, updatedAt, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AppStage,
  Criticality,
  DataClassification,
  DeploymentSource,
  DeploymentStatus,
  Disposition,
  EnvironmentKind,
  Hosting,
  PolicyWarning,
  ReleaseStatus,
  RepoProvider,
} from '../model';
import type { RepoBranch, RepoPullRequest } from '../contracts';

/**
 * All tables of this module live in the `alm` Postgres schema. Exported as `@isbp/module-alm/schema` for
 * modules that depend on ALM (read only). Every table has a stable uuid v7 id and `updated_at`, so the
 * Phase 5 integrations (Azure DevOps Server, ServiceDesk Plus) can sync them both ways.
 */
export const almSchema = pgSchema('alm');

export const applications = almSchema.table(
  'applications',
  {
    id: id(),
    /** `erp`, `hr-portal` — unique, the URL segment (`/alm/erp`). */
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** Markdown. */
    description: text('description'),
    stage: varchar('stage', { length: 16 }).$type<AppStage>().notNull().default('planned'),
    criticality: varchar('criticality', { length: 16 }).$type<Criticality>().notNull().default('medium'),
    /** Gartner TIME. */
    disposition: varchar('disposition', { length: 16 }).$type<Disposition>(),
    businessOwnerId: uuid('business_owner_id').references(() => users.id, { onDelete: 'set null' }),
    technicalOwnerId: uuid('technical_owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** The delivery team: its members may edit the application like its owners. */
    teamGroupId: uuid('team_group_id').references(() => groups.id, { onDelete: 'set null' }),
    supportGroupId: uuid('support_group_id').references(() => groups.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    /** SaaS / COTS vendor. */
    vendor: varchar('vendor', { length: 200 }),
    hosting: varchar('hosting', { length: 16 }).$type<Hosting>().notNull().default('on_prem'),
    /** The application's configuration item (read from the CMDB, never written). */
    ciId: uuid('ci_id').references(() => cis.id, { onDelete: 'set null' }),
    techStack: text('tech_stack')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    documentationUrl: varchar('documentation_url', { length: 500 }),
    dataClassification: varchar('data_classification', { length: 16 })
      .$type<DataClassification>()
      .notNull()
      .default('internal'),
    goLiveDate: date('go_live_date', { mode: 'string' }),
    retireDate: date('retire_date', { mode: 'string' }),
    /** Custom fields (`alm.application`). */
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('applications_code_uq').on(t.code),
    index('applications_name_idx').on(t.name),
    index('applications_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
    index('applications_code_trgm').using('gin', t.code.op('gin_trgm_ops')),
    index('applications_stage_idx').on(t.stage),
    index('applications_criticality_idx').on(t.criticality),
    index('applications_hosting_idx').on(t.hosting),
    index('applications_business_owner_idx').on(t.businessOwnerId),
    index('applications_technical_owner_idx').on(t.technicalOwnerId),
    index('applications_team_idx').on(t.teamGroupId),
    index('applications_ci_idx').on(t.ciId),
    index('applications_updated_idx').on(t.updatedAt),
    index('applications_attributes_gin').using('gin', t.attributes.op('jsonb_path_ops')),
  ],
);

/** Source repositories. Phase 5 Azure DevOps Server sync fills in the last commit; until then, by hand. */
export const repositories = almSchema.table(
  'repositories',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    /** https only. */
    url: varchar('url', { length: 500 }).notNull(),
    provider: varchar('provider', { length: 16 }).$type<RepoProvider>().notNull().default('other'),
    defaultBranch: varchar('default_branch', { length: 200 }).notNull().default('main'),
    lastCommitSha: varchar('last_commit_sha', { length: 64 }),
    lastCommitAt: timestamp('last_commit_at', { withTimezone: true }),
    lastCommitMessage: text('last_commit_message'),
    lastCommitAuthor: varchar('last_commit_author', { length: 200 }),
    /** Git status from a sync with the Git server: branches and active pull requests. */
    branches: jsonb('branches').$type<RepoBranch[]>(),
    pullRequests: jsonb('pull_requests').$type<RepoPullRequest[]>(),
    /** When a sync last wrote the repository ("Synced 5 minutes ago"). */
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('repositories_app_url_uq').on(t.applicationId, t.url)],
);

export const environments = almSchema.table(
  'environments',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 16 }).$type<EnvironmentKind>().notNull(),
    url: varchar('url', { length: 500 }),
    /** The environment's configuration item (e.g. its server), read from the CMDB. */
    ciId: uuid('ci_id').references(() => cis.id, { onDelete: 'set null' }),
    sort: integer('sort').notNull().default(0),
    /* Denormalized from deployments, updated in the same transaction as every deployment. */
    currentVersion: varchar('current_version', { length: 40 }),
    currentReleaseId: uuid('current_release_id'),
    lastDeploymentId: uuid('last_deployment_id'),
    lastDeployedAt: timestamp('last_deployed_at', { withTimezone: true }),
    lastStatus: varchar('last_status', { length: 16 }).$type<DeploymentStatus>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('environments_app_name_uq').on(t.applicationId, t.name),
    index('environments_app_sort_idx').on(t.applicationId, t.sort),
    index('environments_kind_idx').on(t.kind),
    index('environments_ci_idx').on(t.ciId),
  ],
);

export const releases = almSchema.table(
  'releases',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    /** Free text, unique per application (`12.1.0`, `2026.10`). */
    version: varchar('version', { length: 40 }).notNull(),
    name: varchar('name', { length: 200 }),
    status: varchar('status', { length: 16 }).$type<ReleaseStatus>().notNull().default('planned'),
    plannedDate: date('planned_date', { mode: 'string' }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    /** Markdown release notes. */
    notes: text('notes'),
    /** When the owners were told that readiness first became all ✓ (`alm.release.ready`, sent once). */
    readyNotifiedAt: timestamp('ready_notified_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('releases_app_version_uq').on(t.applicationId, t.version),
    index('releases_app_created_idx').on(t.applicationId, t.createdAt.desc()),
    index('releases_planned_idx')
      .on(t.plannedDate)
      .where(sql`${t.plannedDate} is not null`),
    index('releases_status_idx').on(t.status),
    index('releases_version_trgm').using('gin', t.version.op('gin_trgm_ops')),
  ],
);

export const deployments = almSchema.table(
  'deployments',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'restrict' }),
    /** Matched by version when the caller only sends one. */
    releaseId: uuid('release_id').references(() => releases.id, { onDelete: 'set null' }),
    version: varchar('version', { length: 40 }).notNull(),
    status: varchar('status', { length: 16 }).$type<DeploymentStatus>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    deployedBy: uuid('deployed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Display name of the principal: a person, an API client or an AI agent. */
    actorName: varchar('actor_name', { length: 200 }).notNull(),
    source: varchar('source', { length: 8 }).$type<DeploymentSource>().notNull().default('manual'),
    /** Snapshot of the authorizing ITSM change (`itsm.tickets.id`, `CHG-00012`). */
    changeId: uuid('change_id'),
    changeReference: varchar('change_reference', { length: 32 }),
    /** Set when someone with `alm.deployments.override` let a refused deployment through. */
    overrideReason: text('override_reason'),
    /** Allowed with a warning (outside the change window while the window is not enforced). */
    policyWarning: varchar('policy_warning', { length: 32 }).$type<PolicyWarning>(),
    commitSha: varchar('commit_sha', { length: 64 }),
    pipelineUrl: varchar('pipeline_url', { length: 500 }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('deployments_app_started_idx').on(t.applicationId, t.startedAt.desc()),
    index('deployments_env_started_idx').on(t.environmentId, t.startedAt.desc()),
    index('deployments_status_idx').on(t.status),
    index('deployments_release_idx')
      .on(t.releaseId)
      .where(sql`${t.releaseId} is not null`),
    index('deployments_change_idx')
      .on(t.changeId)
      .where(sql`${t.changeId} is not null`),
    index('deployments_started_idx').on(t.startedAt.desc()),
  ],
);
