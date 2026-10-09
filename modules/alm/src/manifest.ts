import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';
import {
  aiFindApplicationsInput,
  aiGetApplicationInput,
  aiRecordDeploymentInput,
  aiReleaseReadinessInput,
  appStageSchema,
  deploymentStatusSchema,
  environmentKindSchema,
  policyReasonSchema,
  policyWarningSchema,
  releaseStatusSchema,
} from './contracts';
import { APP_STAGES, CRITICALITIES, DATA_CLASSIFICATIONS, DISPOSITIONS, HOSTINGS } from './model';

const fact = (key: string) => `alm.recordFacts.${key}`;

/**
 * Approval facts of an application (`alm.application` picked in a record field), for workflows
 * (`records.<field>.<fact>`) and record-field filters. People are user ids, groups are group keys.
 */
export const appFactsSchema = z.object({
  code: z.string().meta({ label: fact('code') }),
  stage: z.enum(APP_STAGES).meta({ label: fact('stage'), valueLabels: 'alm.stage' }),
  criticality: z.enum(CRITICALITIES).meta({ label: fact('criticality'), valueLabels: 'alm.criticality' }),
  hosting: z.enum(HOSTINGS).meta({ label: fact('hosting'), valueLabels: 'alm.hosting' }),
  dataClassification: z
    .enum(DATA_CLASSIFICATIONS)
    .meta({ label: fact('dataClassification'), valueLabels: 'alm.classification' }),
  disposition: z
    .enum(DISPOSITIONS)
    .nullable()
    .meta({ label: fact('disposition'), valueLabels: 'alm.disposition' }),
  ownerId: z
    .uuid()
    .nullable()
    .meta({ label: fact('ownerId'), ref: 'user' }),
  businessOwnerId: z
    .uuid()
    .nullable()
    .meta({ label: fact('businessOwnerId'), ref: 'user' }),
  teamGroup: z
    .string()
    .nullable()
    .meta({ label: fact('teamGroup'), ref: 'group' }),
  supportGroup: z
    .string()
    .nullable()
    .meta({ label: fact('supportGroup'), ref: 'group' }),
  departmentCode: z
    .string()
    .nullable()
    .meta({ label: fact('departmentCode') }),
});
export type AppFacts = z.infer<typeof appFactsSchema>;

const appRef = z.object({ applicationId: z.uuid(), code: z.string(), name: z.string() });
const releaseRef = appRef.extend({ releaseId: z.uuid(), version: z.string() });
const repositoryRef = appRef.extend({ repositoryId: z.uuid(), repository: z.string() });
const deploymentRef = appRef.extend({
  deploymentId: z.uuid(),
  environmentId: z.uuid(),
  environment: z.string(),
  kind: environmentKindSchema,
  version: z.string(),
  status: deploymentStatusSchema,
  releaseId: z.uuid().nullable(),
  changeReference: z.string().nullable(),
});

/**
 * Application lifecycle management: the application inventory (ownership, lifecycle, criticality, CMDB
 * link, repositories), environments, releases and deployment records — tied to ITSM change management:
 * production deployments need an authorized change. Reads `cmdb.cis`, `itsm.tickets` and `itsm.changes`.
 */
export const manifest = defineManifest({
  id: 'alm',
  version: '0.1.0',
  name: 'alm.meta.name',
  description: 'alm.meta.description',
  icon: 'app-window',
  dependsOn: ['cmdb', 'itsm'],
  navigation: [
    {
      id: 'applications',
      label: 'alm.nav.applications',
      href: '/alm',
      icon: 'app-window',
      permission: 'alm.apps.read',
      section: 'main',
      order: 48,
      tabs: [
        {
          id: 'releases',
          label: 'alm.nav.releases',
          href: '/alm/releases',
          icon: 'rocket',
          permission: 'alm.apps.read',
        },
      ],
    },
  ],
  permissions: [
    { key: 'alm.apps.read', description: 'alm.permissions.appsRead' },
    { key: 'alm.apps.manage', description: 'alm.permissions.appsManage' },
    { key: 'alm.releases.manage', description: 'alm.permissions.releasesManage' },
    { key: 'alm.deployments.create', description: 'alm.permissions.deploymentsCreate' },
    { key: 'alm.deployments.override', description: 'alm.permissions.deploymentsOverride' },
    // Phase 5: written by the Integrations Hub's agent (it holds `*.*.sync`), never by a role template.
    { key: 'alm.repositories.sync', description: 'alm.permissions.repositoriesSync' },
  ],
  roles: [
    {
      key: 'alm-viewer',
      name: 'Applications viewer',
      description:
        'Browse applications, environments, releases and deployments. Owners and team members still edit their own applications.',
      permissions: ['alm.apps.read'],
    },
    {
      key: 'alm-release-manager',
      name: 'Release manager',
      description: 'Plan and edit releases of any application and record deployments',
      permissions: ['alm.apps.read', 'alm.releases.manage', 'alm.deployments.create'],
    },
    {
      key: 'alm-pipeline',
      name: 'CI/CD pipeline',
      description: 'For API clients of CI/CD tools: record deployments through the deployment API',
      permissions: ['alm.apps.read', 'alm.deployments.create'],
    },
    {
      key: 'alm-manager',
      name: 'Applications manager',
      description: 'Create and edit any application, environment, repository and release; record deployments',
      permissions: ['alm.apps.read', 'alm.apps.manage', 'alm.releases.manage', 'alm.deployments.create'],
    },
    {
      key: 'alm-admin',
      name: 'Applications administrator',
      description: 'Everything in Applications, including overriding the change policy (audited)',
      permissions: ['alm.*'],
    },
  ],
  events: {
    emits: [
      {
        name: 'alm.application.created',
        description: 'An application was added to the inventory',
        schema: appRef.extend({ stage: appStageSchema }),
      },
      {
        name: 'alm.application.updated',
        description:
          'Fields of an application changed (names of the changed fields; `environments` / `repositories` for those)',
        schema: appRef.extend({ changes: z.array(z.string()) }),
      },
      {
        name: 'alm.application.stage_changed',
        description: 'An application moved through its lifecycle (e.g. into production, or retired)',
        schema: appRef.extend({ from: appStageSchema, to: appStageSchema }),
      },
      {
        name: 'alm.repository.created',
        description: 'A repository was added to an application (by a person or a sync with the Git server)',
        schema: repositoryRef,
      },
      {
        name: 'alm.repository.updated',
        description: 'A repository changed, e.g. its Git status (names of the changed fields)',
        schema: repositoryRef.extend({ changes: z.array(z.string()) }),
      },
      {
        name: 'alm.release.created',
        schema: releaseRef.extend({ status: releaseStatusSchema }),
      },
      { name: 'alm.release.updated', schema: releaseRef.extend({ changes: z.array(z.string()) }) },
      {
        name: 'alm.release.status_changed',
        schema: releaseRef.extend({ from: releaseStatusSchema, to: releaseStatusSchema }),
      },
      {
        name: 'alm.deployment.recorded',
        description: 'A deployment was recorded (by a person, a CI/CD pipeline or an AI agent)',
        schema: deploymentRef.extend({ warning: policyWarningSchema.nullable() }),
      },
      { name: 'alm.deployment.succeeded', schema: deploymentRef },
      {
        name: 'alm.deployment.failed',
        description: 'A deployment failed or was rolled back',
        schema: deploymentRef,
      },
      {
        name: 'alm.deployment.policy_overridden',
        description: 'A production deployment the change policy refused was recorded with an override',
        schema: deploymentRef.extend({ reason: policyReasonSchema, overrideReason: z.string() }),
      },
    ],
    consumes: [
      'core.user.offboarded',
      // A change linked to a release: a planned release moves to in progress; readiness is re-checked.
      'core.record.linked',
      // A linked change was approved: readiness may now be complete.
      'itsm.change.approved',
    ],
  },
  settings: [
    {
      key: 'policy.requireChange',
      label: 'alm.settings.requireChange',
      description: 'alm.settings.requireChangeHelp',
      type: 'boolean',
      default: true,
    },
    {
      key: 'policy.enforceWindow',
      label: 'alm.settings.enforceWindow',
      description: 'alm.settings.enforceWindowHelp',
      type: 'boolean',
      default: false,
    },
  ],
  ai: {
    tools: [
      {
        name: 'alm.find_applications',
        description:
          'Search the application inventory by code or name (e.g. "erp", "HR Portal"), optionally by lifecycle stage. Returns code, name, stage, criticality, owners, the production version and the last deployment. Use it to identify which application a person or ticket means.',
        input: aiFindApplicationsInput,
        permission: 'alm.apps.read',
        readOnly: true,
      },
      {
        name: 'alm.get_application',
        description:
          'Get one application by its code (e.g. "erp"): owners, delivery and support teams, stage, criticality, hosting, its CMDB configuration item, environments with the version each runs, and the latest releases. Use it to answer "what version is in production" or "who owns this".',
        input: aiGetApplicationInput,
        permission: 'alm.apps.read',
        readOnly: true,
      },
      {
        name: 'alm.release_readiness',
        description:
          'Check whether a release (application code + version, e.g. erp 12.1.0) is ready for production: an authorized (CAB-approved) change is linked, the version succeeded in test or staging, release notes are written, and no production deployment of it failed. Also says whether the change policy would allow a production deployment right now.',
        input: aiReleaseReadinessInput,
        permission: 'alm.apps.read',
        readOnly: true,
      },
      {
        name: 'alm.record_deployment',
        description:
          'Record a deployment of an application version to an environment (named like "Production" or by kind like "test") with its outcome. Production deployments need an authorized ITSM change (pass changeReference such as CHG-00012, or link the change to the release); the change policy cannot be overridden through this tool.',
        input: aiRecordDeploymentInput,
        permission: 'alm.deployments.create',
      },
    ],
  },
  search: { entities: ['application', 'release'] },
  notifications: [
    { type: 'alm.deployment.failed', defaultChannels: ['inApp', 'email'] },
    { type: 'alm.deployment.overridden', defaultChannels: ['inApp', 'email'] },
    { type: 'alm.release.ready', defaultChannels: ['inApp'] },
  ],
  customFields: { entities: [{ type: 'application', name: 'alm.entities.application' }] },
  /**
   * Repositories kept in step with the Git server by the Integrations Hub (adapter in `server/sync.ts`):
   * inside an application, matched on URL, with branches and active pull requests ("Git status").
   */
  syncEntities: [
    {
      entity: 'repository',
      name: 'alm.sync.entities.repository',
      icon: 'git-branch',
      permission: 'alm.repositories.sync',
      events: ['alm.repository.created', 'alm.repository.updated'],
      container: 'alm.application',
    },
  ],
  records: {
    types: [
      {
        type: 'application',
        name: 'alm.entities.application',
        icon: 'app-window',
        permission: 'alm.apps.read',
        facts: appFactsSchema,
      },
      { type: 'release', name: 'alm.entities.release', icon: 'rocket', permission: 'alm.apps.read' },
    ],
  },
});
