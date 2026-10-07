/**
 * ALM API contract (mounted at /api/v1/alm). Zod schemas shared by routes, pages, AI tools and tests.
 *
 *   Applications
 *     GET    /applications                          appQuerySchema → page(appSummarySchema)
 *     POST   /applications                          createAppSchema → appDetailSchema (201)
 *     GET    /applications/:code                    → appDetailSchema            (code or id)
 *     PATCH  /applications/:code                    updateAppSchema → appDetailSchema
 *     GET    /applications/:code/metrics            metricsQuerySchema → doraSchema
 *     GET    /applications/:code/environments       → { items: environmentSchema[] }
 *     POST   /applications/:code/environments       createEnvironmentSchema → environmentSchema (201)
 *     PATCH  /applications/:code/environments/:id   updateEnvironmentSchema → environmentSchema
 *     DELETE /applications/:code/environments/:id   (IN_USE once it has deployments)
 *     POST   /applications/:code/environments/reorder   { ids } → { items }
 *     GET/POST/PATCH/DELETE /applications/:code/repositories[/:id]
 *     GET    /applications/:code/releases           releaseQuerySchema → page(releaseSummarySchema)
 *     POST   /applications/:code/releases           createReleaseSchema → releaseDetailSchema (201)
 *     GET    /applications/:code/releases/:version  → releaseDetailSchema
 *
 *   Releases
 *     GET    /releases                              calendarQuerySchema → { items: releaseSummarySchema[] }
 *     GET    /releases/:id                          → releaseDetailSchema
 *     PATCH  /releases/:id                          updateReleaseSchema → releaseDetailSchema
 *     POST   /releases/:id/status                   releaseStatusSchema → releaseDetailSchema
 *     GET    /releases/:id/readiness                readinessQuerySchema → readinessSchema
 *
 *   Deployments
 *     GET    /deployments                           deploymentQuerySchema → page(deploymentSchema)
 *     GET    /deployments/policy                    policyQuerySchema → policyCheckSchema   (dry run)
 *     POST   /deployments                           createDeploymentSchema → recordedDeploymentSchema (201)
 *     PATCH  /deployments/:id                       finishDeploymentSchema → deploymentSchema
 *
 *   Other
 *     GET    /dashboard                             → dashboardSchema
 *     GET    /changes/:changeId                     → changeUsageSchema       (ITSM change page slot)
 *     GET    /cis/:ciId/applications                → { items: ciApplicationSchema[] }  (CMDB CI page slot)
 *     GET    /lookups/groups · /lookups/departments · /lookups/cis
 */
import { dateTime } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  APP_CODE_MAX,
  APP_CODE_MIN,
  APP_CODE_RE,
  APP_STAGES,
  CRITICALITIES,
  DATA_CLASSIFICATIONS,
  DEPLOYMENT_SOURCES,
  DEPLOYMENT_STATUSES,
  DISPOSITIONS,
  ENVIRONMENT_KINDS,
  HOSTINGS,
  READINESS_CHECKS,
  RELEASE_STATUSES,
  REPO_PROVIDERS,
  RESERVED_CODES,
  VERSION_RE,
} from './model';

export * from './model';

const id = z.uuid();

export const appStageSchema = z.enum(APP_STAGES);
export const criticalitySchema = z.enum(CRITICALITIES);
export const dispositionSchema = z.enum(DISPOSITIONS);
export const hostingSchema = z.enum(HOSTINGS);
export const dataClassificationSchema = z.enum(DATA_CLASSIFICATIONS);
export const repoProviderSchema = z.enum(REPO_PROVIDERS);
export const environmentKindSchema = z.enum(ENVIRONMENT_KINDS);
export const releaseStatusSchema = z.enum(RELEASE_STATUSES);
export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);
export const deploymentSourceSchema = z.enum(DEPLOYMENT_SOURCES);
export const policyReasonSchema = z.enum(['no_change', 'change_not_approved', 'outside_window']);
export const policyWarningSchema = z.enum(['outside_window']);

/** A calendar date (`YYYY-MM-DD`), not an instant: go-live, retirement and planned release dates. */
export const dateOnly = z.iso.date();

/** https URLs only (repositories, pipelines, documentation). */
export const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(500)
  .refine((u) => u.startsWith('https://'), 'Only https:// links are allowed');

export const codeSchema = z
  .string()
  .trim()
  .min(APP_CODE_MIN)
  .max(APP_CODE_MAX)
  .regex(APP_CODE_RE, 'Lowercase letters, digits and single dashes, starting with a letter')
  .refine((c) => !RESERVED_CODES.has(c), 'This code is reserved');

export const versionSchema = z
  .string()
  .trim()
  .regex(VERSION_RE, 'Letters, digits, ".", "-", "_" and "+" (up to 40), no spaces');

/* ───────────────────────────── shared refs ───────────────────────────── */

export const personRefSchema = z.object({
  id,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type PersonRef = z.input<typeof personRefSchema>;

export const namedRefSchema = z.object({ id, name: z.string() });
export type NamedRef = z.input<typeof namedRefSchema>;

/** A configuration item, as ALM shows it (read from the CMDB). */
export const ciInfoSchema = z.object({
  id,
  /** `CI-00042`. */
  reference: z.string(),
  name: z.string(),
  classKey: z.string(),
  status: z.string(),
  criticality: z.string(),
});
export type CiInfo = z.input<typeof ciInfoSchema>;

export const appRefSchema = z.object({ id, code: z.string(), name: z.string() });
export type AppRef = z.input<typeof appRefSchema>;

/** The most recent deployment of an application or environment. */
export const lastDeploymentSchema = z.object({
  id,
  environment: z.object({ id, name: z.string(), kind: environmentKindSchema }),
  version: z.string(),
  status: deploymentStatusSchema,
  at: dateTime,
});
export type LastDeployment = z.input<typeof lastDeploymentSchema>;

/** An ITSM change as ALM shows it: status from the ITSM catalog (`itsm.status.*`) and its window. */
export const changeInfoSchema = z.object({
  id,
  /** `CHG-00012`. */
  reference: z.string(),
  title: z.string(),
  status: z.string(),
  plannedStart: dateTime.nullable(),
  plannedEnd: dateTime.nullable(),
  /** `scheduled` or `implementing`: approved by the CAB workflow. */
  authorized: z.boolean(),
  /** Now is within the planned window. */
  inWindow: z.boolean(),
  href: z.string(),
});
export type ChangeInfo = z.input<typeof changeInfoSchema>;

/* ───────────────────────────── applications ───────────────────────────── */

export const appSummarySchema = z.object({
  id,
  code: z.string(),
  name: z.string(),
  stage: appStageSchema,
  criticality: criticalitySchema,
  disposition: dispositionSchema.nullable(),
  hosting: hostingSchema,
  businessOwner: personRefSchema.nullable(),
  technicalOwner: personRefSchema.nullable(),
  team: namedRefSchema.nullable(),
  /** Current version of the (first) production environment. */
  productionVersion: z.string().nullable(),
  lastDeployment: lastDeploymentSchema.nullable(),
  updatedAt: dateTime,
});
export type AppSummary = z.input<typeof appSummarySchema>;

export const environmentSchema = z.object({
  id,
  name: z.string(),
  kind: environmentKindSchema,
  url: z.string().nullable(),
  ci: ciInfoSchema.nullable(),
  sort: z.number().int(),
  currentVersion: z.string().nullable(),
  currentRelease: z.object({ id, version: z.string() }).nullable(),
  lastDeployment: z
    .object({ id, version: z.string(), status: deploymentStatusSchema, at: dateTime })
    .nullable(),
  /** Deployments recorded (an environment with deployments can't be deleted). */
  deploymentCount: z.number().int(),
  updatedAt: dateTime,
});
export type Environment = z.input<typeof environmentSchema>;

export const repositorySchema = z.object({
  id,
  name: z.string(),
  url: z.string(),
  provider: repoProviderSchema,
  defaultBranch: z.string(),
  lastCommit: z
    .object({
      sha: z.string(),
      at: dateTime.nullable(),
      message: z.string().nullable(),
      author: z.string().nullable(),
    })
    .nullable(),
  updatedAt: dateTime,
});
export type Repository = z.input<typeof repositorySchema>;

/** What the viewer may do — the UI renders from this, the API checks it again. */
export const appViewerSchema = z.object({
  /** Owner, team member or `alm.apps.manage`: edit the application, environments and repositories. */
  canEdit: z.boolean(),
  /** Owner, team member or `alm.releases.manage`. */
  canManageReleases: z.boolean(),
  /** `alm.deployments.create`. */
  canDeploy: z.boolean(),
  /** `alm.deployments.override`. */
  canOverride: z.boolean(),
  /** Business owner, technical owner or team member. */
  isOwner: z.boolean(),
});
export type AppViewer = z.input<typeof appViewerSchema>;

export const appDetailSchema = appSummarySchema.extend({
  description: z.string().nullable(),
  supportGroup: namedRefSchema.nullable(),
  department: namedRefSchema.nullable(),
  vendor: z.string().nullable(),
  ci: ciInfoSchema.nullable(),
  techStack: z.array(z.string()),
  documentationUrl: z.string().nullable(),
  dataClassification: dataClassificationSchema,
  goLiveDate: dateOnly.nullable(),
  retireDate: dateOnly.nullable(),
  attributes: z.record(z.string(), z.unknown()),
  environments: z.array(environmentSchema),
  repositories: z.array(repositorySchema),
  counts: z.object({
    releases: z.number().int(),
    openReleases: z.number().int(),
    deployments: z.number().int(),
  }),
  viewer: appViewerSchema,
  createdAt: dateTime,
});
export type AppDetail = z.input<typeof appDetailSchema>;

export const APP_SORT_KEYS = ['code', 'name', 'stage', 'criticality', 'hosting', 'updatedAt'] as const;

/** Comma-separated values of an enum (`stage=sunsetting,retired`). */
const enumList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(200)
    .transform((v, ctx) => {
      const parts = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = parts.filter((p) => !values.includes(p));
      if (bad.length) {
        ctx.addIssue({ code: 'custom', message: `Unknown value(s): ${bad.join(', ')}` });
        return z.NEVER;
      }
      return parts as T[number][];
    });

export const appQuerySchema = listQuerySchema.extend({
  stage: enumList(APP_STAGES).optional(),
  criticality: enumList(CRITICALITIES).optional(),
  hosting: enumList(HOSTINGS).optional(),
  disposition: enumList(DISPOSITIONS).optional(),
  /** `me` (business owner, technical owner or team member) or a person's id (either owner). */
  owner: z.union([z.literal('me'), id]).optional(),
  team: id.optional(),
});
export type AppQuery = z.input<typeof appQuerySchema>;

const text = (max: number) => z.string().trim().max(max);

export const createAppSchema = z.object({
  code: codeSchema,
  name: text(200).min(1),
  description: text(20_000).nullish(),
  stage: appStageSchema.default('planned'),
  criticality: criticalitySchema.default('medium'),
  disposition: dispositionSchema.nullish(),
  businessOwnerId: id.nullish(),
  technicalOwnerId: id.nullish(),
  teamGroupId: id.nullish(),
  supportGroupId: id.nullish(),
  departmentId: id.nullish(),
  vendor: text(200).nullish(),
  hosting: hostingSchema.default('on_prem'),
  ciId: id.nullish(),
  techStack: z.array(text(40).min(1)).max(30).default([]),
  documentationUrl: httpsUrl.nullish(),
  dataClassification: dataClassificationSchema.default('internal'),
  goLiveDate: dateOnly.nullish(),
  retireDate: dateOnly.nullish(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAppInput = z.input<typeof createAppSchema>;

/** A PATCH changes only what it names (no defaults); the code is permanent (pipelines use it). */
export const updateAppSchema = z
  .object({
    name: text(200).min(1),
    description: text(20_000).nullable(),
    stage: appStageSchema,
    criticality: criticalitySchema,
    disposition: dispositionSchema.nullable(),
    businessOwnerId: id.nullable(),
    technicalOwnerId: id.nullable(),
    teamGroupId: id.nullable(),
    supportGroupId: id.nullable(),
    departmentId: id.nullable(),
    vendor: text(200).nullable(),
    hosting: hostingSchema,
    ciId: id.nullable(),
    techStack: z.array(text(40).min(1)).max(30),
    documentationUrl: httpsUrl.nullable(),
    dataClassification: dataClassificationSchema,
    goLiveDate: dateOnly.nullable(),
    retireDate: dateOnly.nullable(),
    attributes: z.record(z.string(), z.unknown()),
  })
  .partial();
export type UpdateAppInput = z.input<typeof updateAppSchema>;

/* ───────────────────────────── environments & repositories ───────────────────────────── */

export const createEnvironmentSchema = z.object({
  name: text(64).min(1),
  kind: environmentKindSchema,
  url: httpsUrl.nullish(),
  ciId: id.nullish(),
  sort: z.number().int().min(0).max(1000).optional(),
});
export type CreateEnvironmentInput = z.input<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = z
  .object({
    name: text(64).min(1),
    kind: environmentKindSchema,
    url: httpsUrl.nullable(),
    ciId: id.nullable(),
    sort: z.number().int().min(0).max(1000),
  })
  .partial();
export type UpdateEnvironmentInput = z.input<typeof updateEnvironmentSchema>;

export const reorderSchema = z.object({ ids: z.array(id).min(1).max(50) });

const commitFields = {
  lastCommitSha: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{7,64}$/i, 'A commit hash')
    .nullish(),
  lastCommitAt: dateTime.nullish(),
  lastCommitMessage: text(2000).nullish(),
  lastCommitAuthor: text(200).nullish(),
};

export const createRepositorySchema = z.object({
  name: text(200).min(1),
  url: httpsUrl,
  provider: repoProviderSchema.default('azure_devops'),
  defaultBranch: text(200).min(1).default('main'),
  ...commitFields,
});
export type CreateRepositoryInput = z.input<typeof createRepositorySchema>;

export const updateRepositorySchema = z
  .object({
    name: text(200).min(1),
    url: httpsUrl,
    provider: repoProviderSchema,
    defaultBranch: text(200).min(1),
    ...commitFields,
  })
  .partial();
export type UpdateRepositoryInput = z.input<typeof updateRepositorySchema>;

/* ───────────────────────────── releases ───────────────────────────── */

/** Readiness at a glance (lists); the full checklist comes from `/releases/:id/readiness`. */
export const readinessSummarySchema = z.object({
  passed: z.number().int(),
  total: z.number().int(),
  ready: z.boolean(),
});

export const releaseSummarySchema = z.object({
  id,
  application: appRefSchema,
  version: z.string(),
  name: z.string().nullable(),
  status: releaseStatusSchema,
  plannedDate: dateOnly.nullable(),
  releasedAt: dateTime.nullable(),
  /** Linked ITSM changes (record links), best candidate first. */
  changes: z.array(changeInfoSchema),
  readiness: readinessSummarySchema,
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type ReleaseSummary = z.input<typeof releaseSummarySchema>;

/** How far this version got: one row per environment of the application. */
export const pipelineStepSchema = z.object({
  environment: z.object({ id, name: z.string(), kind: environmentKindSchema }),
  /** The latest deployment of this version there. */
  deployment: z
    .object({
      id,
      status: deploymentStatusSchema,
      startedAt: dateTime,
      finishedAt: dateTime.nullable(),
    })
    .nullable(),
  /** The environment runs this version now. */
  current: z.boolean(),
});
export type PipelineStep = z.input<typeof pipelineStepSchema>;

export const releaseDetailSchema = releaseSummarySchema.extend({
  application: appRefSchema.extend({ stage: appStageSchema, criticality: criticalitySchema }),
  notes: z.string().nullable(),
  createdBy: personRefSchema.nullable(),
  pipeline: z.array(pipelineStepSchema),
  deploymentCount: z.number().int(),
  /** Allowed manual status changes for the viewer. */
  transitions: z.array(releaseStatusSchema),
  viewer: appViewerSchema,
});
export type ReleaseDetail = z.input<typeof releaseDetailSchema>;

export const releaseQuerySchema = listQuerySchema.extend({
  status: enumList(RELEASE_STATUSES).optional(),
});

export const calendarQuerySchema = z.object({
  /** Planned dates from (default: today) … to (default: 8 weeks later), inclusive. */
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  /** Application code. */
  application: z.string().max(64).optional(),
  status: enumList(RELEASE_STATUSES).optional(),
  /** Only applications I own or whose team I am in. */
  mine: z.stringbool().optional(),
});
export type CalendarQuery = z.input<typeof calendarQuerySchema>;

export const createReleaseSchema = z.object({
  version: versionSchema,
  name: text(200).nullish(),
  status: z.enum(['planned', 'in_progress', 'ready']).default('planned'),
  plannedDate: dateOnly.nullish(),
  notes: text(50_000).nullish(),
});
export type CreateReleaseInput = z.input<typeof createReleaseSchema>;

export const updateReleaseSchema = z
  .object({
    /** Only while nothing was deployed with this version. */
    version: versionSchema,
    name: text(200).nullable(),
    plannedDate: dateOnly.nullable(),
    notes: text(50_000).nullable(),
  })
  .partial();
export type UpdateReleaseInput = z.input<typeof updateReleaseSchema>;

export const releaseStatusChangeSchema = z.object({ status: releaseStatusSchema });

export const readinessQuerySchema = z.object({
  /** A change the person is about to name in "Record deployment" (`CHG-00012`): checked too. */
  changeReference: z.string().trim().max(32).optional(),
});

export const policyDecisionSchema = z.object({
  outcome: z.enum(['allow', 'warn', 'deny', 'override']),
  applies: z.boolean(),
  reason: policyReasonSchema.nullable(),
  warning: policyWarningSchema.nullable(),
  change: changeInfoSchema.nullable(),
});
export type PolicyDecisionDto = z.input<typeof policyDecisionSchema>;

export const readinessSchema = z.object({
  ready: z.boolean(),
  passed: z.number().int(),
  total: z.number().int(),
  checks: z.array(z.object({ key: z.enum(READINESS_CHECKS), ok: z.boolean() })),
  /** The linked change the first check is about. */
  change: changeInfoSchema.nullable(),
  /** Every change linked to the release. */
  changes: z.array(changeInfoSchema),
  /** Test / staging environments where this version succeeded. */
  testedIn: z.array(z.string()),
  failedInProduction: z.number().int(),
  policy: z.object({
    requireChange: z.boolean(),
    enforceWindow: z.boolean(),
    /** What deploying this release to production right now would meet (null: no production environment). */
    production: policyDecisionSchema.nullable(),
    /** The change named in the query, when it was found. */
    named: changeInfoSchema.nullable(),
    /** `changeReference` was given but no such change exists. */
    namedNotFound: z.boolean(),
  }),
  /** Link that opens ITSM's new-change dialog, prefilled and linked to this release. */
  raiseChangeHref: z.string(),
});
export type Readiness = z.input<typeof readinessSchema>;

/* ───────────────────────────── deployments ───────────────────────────── */

export const deploymentSchema = z.object({
  id,
  application: appRefSchema,
  environment: z.object({ id, name: z.string(), kind: environmentKindSchema }),
  release: z.object({ id, version: z.string(), status: releaseStatusSchema }).nullable(),
  version: z.string(),
  status: deploymentStatusSchema,
  startedAt: dateTime,
  finishedAt: dateTime.nullable(),
  durationSeconds: z.number().int().nullable(),
  /** Who recorded it: a person (with id), an API client or an AI agent. */
  actor: z.object({ id: id.nullable(), name: z.string() }),
  source: deploymentSourceSchema,
  change: z.object({ id: id.nullable(), reference: z.string() }).nullable(),
  overrideReason: z.string().nullable(),
  policyWarning: policyWarningSchema.nullable(),
  commitSha: z.string().nullable(),
  pipelineUrl: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Deployment = z.input<typeof deploymentSchema>;

export const recordedDeploymentSchema = deploymentSchema.extend({
  policy: z.object({
    outcome: z.enum(['allow', 'warn', 'override']),
    applies: z.boolean(),
    warning: policyWarningSchema.nullable(),
    reason: policyReasonSchema.nullable(),
  }),
});
export type RecordedDeployment = z.input<typeof recordedDeploymentSchema>;

export const DEPLOYMENT_SORT_KEYS = ['startedAt', 'finishedAt', 'status', 'version'] as const;

export const deploymentQuerySchema = listQuerySchema.extend({
  /** Application code or id. */
  application: z.string().max(64).optional(),
  environment: id.optional(),
  /** Environment kind, e.g. only production. */
  kind: environmentKindSchema.optional(),
  release: id.optional(),
  status: enumList(DEPLOYMENT_STATUSES).optional(),
  from: dateTime.optional(),
  to: dateTime.optional(),
});
export type DeploymentQuery = z.input<typeof deploymentQuerySchema>;

/**
 * The CI/CD-friendly deployment API: name the application by code and the environment by name or kind.
 * The release is matched by version. Production deployments meet the change policy.
 */
export const createDeploymentSchema = z
  .object({
    application: z.string().trim().min(1).max(64),
    /** Environment name ("Production") or kind (`production`). */
    environment: z.string().trim().min(1).max(64),
    version: versionSchema,
    status: deploymentStatusSchema.default('succeeded'),
    commitSha: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{7,64}$/i, 'A commit hash')
      .nullish(),
    /** Repository the commit is from (name or URL); defaults to the only repository. */
    repository: z.string().trim().max(500).nullish(),
    pipelineUrl: httpsUrl.nullish(),
    /** `CHG-00012`. */
    changeReference: z.string().trim().max(32).nullish(),
    changeId: id.nullish(),
    notes: text(10_000).nullish(),
    startedAt: dateTime.nullish(),
    finishedAt: dateTime.nullish(),
    /** Needs `alm.deployments.override`: records a refused production deployment anyway. */
    override: z.object({ reason: text(2000).min(10) }).nullish(),
  })
  .refine((v) => !(v.startedAt && v.finishedAt) || v.startedAt <= v.finishedAt, {
    message: 'finishedAt must not be before startedAt',
    path: ['finishedAt'],
  });
export type CreateDeploymentInput = z.input<typeof createDeploymentSchema>;

/** What the change policy would say about a deployment — the "Record deployment" dialog asks as you type. */
export const policyQuerySchema = z.object({
  application: z.string().trim().min(1).max(64),
  environment: z.string().trim().min(1).max(64),
  version: z.string().trim().max(40).optional(),
  changeReference: z.string().trim().max(32).optional(),
});

export const policyCheckSchema = z.object({
  environment: z.object({ id, name: z.string(), kind: environmentKindSchema }),
  release: z.object({ id, version: z.string() }).nullable(),
  requireChange: z.boolean(),
  enforceWindow: z.boolean(),
  decision: policyDecisionSchema,
  /** Changes linked to the release of this version. */
  changes: z.array(changeInfoSchema),
  named: changeInfoSchema.nullable(),
  namedNotFound: z.boolean(),
  /** The caller may override a refusal (`alm.deployments.override`). */
  canOverride: z.boolean(),
});
export type PolicyCheck = z.input<typeof policyCheckSchema>;

export const finishDeploymentSchema = z.object({
  status: z.enum(['succeeded', 'failed', 'rolled_back']),
  finishedAt: dateTime.nullish(),
  notes: text(10_000).nullish(),
});
export type FinishDeploymentInput = z.input<typeof finishDeploymentSchema>;

/* ───────────────────────────── metrics & dashboard ───────────────────────────── */

export const metricsQuerySchema = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) });

export const doraSchema = z.object({
  days: z.number().int(),
  from: dateTime,
  to: dateTime,
  /** Successful production deployments per week. */
  deploymentFrequency: z.object({ perWeek: z.number(), total: z.number().int() }),
  /** (failed + rolled back) / finished production deployments; null without any. */
  changeFailureRate: z.object({
    rate: z.number().nullable(),
    failures: z.number().int(),
    finished: z.number().int(),
  }),
  /** Release created → its first successful production deployment. */
  leadTime: z.object({ medianHours: z.number().nullable(), samples: z.number().int() }),
  /** Failed production deployment → the next success on that environment. */
  timeToRestore: z.object({ medianHours: z.number().nullable(), samples: z.number().int() }),
  weekly: z.array(z.object({ week: dateOnly, succeeded: z.number().int(), failed: z.number().int() })),
});
export type Dora = z.input<typeof doraSchema>;

export const dashboardSchema = z.object({
  total: z.number().int(),
  byStage: z.record(appStageSchema, z.number().int()),
  byCriticality: z.record(criticalitySchema, z.number().int()),
  /** Deployments started in the last 7 days. */
  week: z.object({
    succeeded: z.number().int(),
    failed: z.number().int(),
    inProgress: z.number().int(),
    total: z.number().int(),
  }),
  /** Open releases planned in the next 14 days. */
  upcoming: z.array(releaseSummarySchema),
  /** Applications in use (not retired) without a business or technical owner. */
  withoutOwner: z.object({
    total: z.number().int(),
    items: z.array(appRefSchema.extend({ missing: z.array(z.enum(['business', 'technical'])) })),
  }),
  /** Applications in use (not retired) without a CMDB configuration item. */
  withoutCi: z.object({ total: z.number().int(), items: z.array(appRefSchema) }),
});
export type Dashboard = z.input<typeof dashboardSchema>;

/* ───────────────────────────── other modules' pages ───────────────────────────── */

/** `itsm.ticket.aside` on a change: the releases linked to it and the deployments it authorized. */
export const changeUsageSchema = z.object({
  releases: z.array(
    z.object({ id, version: z.string(), status: releaseStatusSchema, application: appRefSchema }),
  ),
  deployments: z.array(
    z.object({
      id,
      application: appRefSchema,
      environment: z.object({ id, name: z.string(), kind: environmentKindSchema }),
      version: z.string(),
      status: deploymentStatusSchema,
      startedAt: dateTime,
      finishedAt: dateTime.nullable(),
      overridden: z.boolean(),
    }),
  ),
});
export type ChangeUsage = z.input<typeof changeUsageSchema>;

/** `cmdb.ci.related`: the application a CI is (or hosts one of its environments). */
export const ciApplicationSchema = appSummarySchema.extend({
  /** `application`: the app's own CI; `environment`: the CI of these environments. */
  roles: z.array(z.enum(['application', 'environment'])),
  environments: z.array(z.string()),
});
export type CiApplication = z.input<typeof ciApplicationSchema>;

export const lookupQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  ids: z.union([id, z.array(id).max(100)]).optional(),
});
export const lookupItemSchema = z.object({ id, name: z.string(), hint: z.string().nullable() });
export type LookupItem = z.input<typeof lookupItemSchema>;

/* ───────────────────────────── AI tools ───────────────────────────── */

export const aiFindApplicationsInput = z.object({
  query: z.string().trim().max(200).optional(),
  stage: appStageSchema.optional(),
  limit: z.number().int().min(1).max(25).default(10),
});
export const aiGetApplicationInput = z.object({ code: z.string().trim().min(1).max(64) });
export const aiReleaseReadinessInput = z.object({
  application: z.string().trim().min(1).max(64),
  version: versionSchema,
});
export const aiRecordDeploymentInput = z.object({
  application: z.string().trim().min(1).max(64),
  environment: z.string().trim().min(1).max(64),
  version: versionSchema,
  status: deploymentStatusSchema.default('succeeded'),
  changeReference: z.string().trim().max(32).optional(),
  notes: z.string().trim().max(10_000).optional(),
});
