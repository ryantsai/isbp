import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';
import {
  aiListEndpointsInput,
  aiRunPipelineInput,
  pipelineTaskConfigSchema,
  runTriggerSchema,
} from './contracts';

const endpointRef = z.object({ endpointId: z.uuid(), slug: z.string() });
const versionRef = endpointRef.extend({ version: z.number().int() });
const pipelineRef = z.object({ pipelineId: z.uuid(), name: z.string() });
const runRef = pipelineRef.extend({ runId: z.uuid(), trigger: runTriggerSchema });

/**
 * Data APIs & ETL: REST endpoints published from parameterized SQL or stored procedures (versions, access,
 * rate limits, caching, OpenAPI, test console, execution logs) and ETL pipelines between database
 * connections. Reaches databases only through the kernel (`ctx.databases`); Scheduled Jobs runs pipelines
 * through the `etl.pipeline` task type.
 */
export const manifest = defineManifest({
  id: 'etl',
  version: '0.1.0',
  name: 'etl.meta.name',
  description: 'etl.meta.description',
  icon: 'database-zap',
  dependsOn: [],
  navigation: [
    {
      id: 'endpoints',
      label: 'etl.nav.endpoints',
      href: '/etl',
      icon: 'database-zap',
      permission: 'etl.endpoints.read',
      section: 'main',
      group: 'etl.nav.group',
      order: 56,
    },
    {
      id: 'pipelines',
      label: 'etl.nav.pipelines',
      href: '/etl/pipelines',
      icon: 'workflow',
      permission: 'etl.pipelines.read',
      section: 'main',
      group: 'etl.nav.group',
      order: 57,
    },
    {
      id: 'logs',
      label: 'etl.nav.logs',
      href: '/etl/logs',
      icon: 'scroll-text',
      permission: 'etl.endpoints.read',
      section: 'main',
      group: 'etl.nav.group',
      order: 58,
    },
  ],
  permissions: [
    { key: 'etl.endpoints.read', description: 'etl.permissions.endpointsRead' },
    { key: 'etl.endpoints.manage', description: 'etl.permissions.endpointsManage' },
    {
      key: 'etl.endpoints.invoke',
      description: 'etl.permissions.endpointsInvoke',
      scopes: ['global', 'record'],
    },
    { key: 'etl.pipelines.read', description: 'etl.permissions.pipelinesRead' },
    { key: 'etl.pipelines.manage', description: 'etl.permissions.pipelinesManage' },
    { key: 'etl.pipelines.run', description: 'etl.permissions.pipelinesRun' },
  ],
  roles: [
    {
      key: 'etl-viewer',
      name: 'Data APIs viewer',
      description:
        'See Data APIs, their versions, docs and execution logs, and ETL pipelines with their runs',
      permissions: ['etl.endpoints.read', 'etl.pipelines.read'],
    },
    {
      key: 'etl-developer',
      name: 'Data APIs developer',
      description: 'Build, test, publish and call Data APIs; build, run and schedule ETL pipelines',
      permissions: ['etl.*'],
    },
    {
      key: 'etl-consumer',
      name: 'Data APIs consumer',
      description: 'Call published Data APIs that allow signed-in people (grant on one endpoint to limit it)',
      permissions: ['etl.endpoints.invoke'],
    },
  ],
  events: {
    emits: [
      {
        name: 'etl.endpoint.created',
        schema: endpointRef.extend({ name: z.string() }),
      },
      {
        name: 'etl.endpoint.updated',
        description: 'The draft, access or settings of an endpoint changed (names of the changed fields)',
        schema: endpointRef.extend({ changes: z.array(z.string()) }),
      },
      { name: 'etl.endpoint.deleted', schema: endpointRef },
      {
        name: 'etl.endpoint.published',
        description: 'A tested draft was frozen as a new version',
        schema: versionRef,
      },
      {
        name: 'etl.endpoint.deprecated',
        description: 'A version still answers but carries a Deprecation header',
        schema: versionRef,
      },
      { name: 'etl.endpoint.retired', description: 'A version answers 410 Gone', schema: versionRef },
      {
        name: 'etl.endpoint.restored',
        description: 'A deprecated or retired version is published again',
        schema: versionRef,
      },
      { name: 'etl.pipeline.created', schema: pipelineRef },
      { name: 'etl.pipeline.updated', schema: pipelineRef.extend({ changes: z.array(z.string()) }) },
      { name: 'etl.pipeline.deleted', schema: pipelineRef },
      {
        name: 'etl.pipeline.run_succeeded',
        schema: runRef.extend({ rowsRead: z.number().int(), rowsWritten: z.number().int() }),
      },
      {
        name: 'etl.pipeline.run_failed',
        description: 'A pipeline run failed or was cancelled (the load was rolled back)',
        schema: runRef.extend({ error: z.string() }),
      },
    ],
    consumes: ['core.db-connection.deleted'],
  },
  settings: [
    {
      key: 'logRetentionDays',
      label: 'etl.settings.logRetentionDays',
      description: 'etl.settings.logRetentionDaysHelp',
      type: 'number',
      default: 30,
    },
    {
      key: 'defaultRateLimitPerMinute',
      label: 'etl.settings.defaultRateLimit',
      description: 'etl.settings.defaultRateLimitHelp',
      type: 'number',
      default: 120,
    },
  ],
  ai: {
    tools: [
      {
        name: 'etl.list_endpoints',
        description:
          'List published Data APIs (REST endpoints over company databases), optionally filtered by a search term such as "customers" or "sales". Returns the slug, name, URL, method, latest version and parameters of each, so you can tell a person which API answers their question and how to call it.',
        input: aiListEndpointsInput,
        permission: 'etl.endpoints.read',
      },
      {
        name: 'etl.run_pipeline',
        description:
          'Queue a run of an ETL pipeline by its name or id (for example "Customer dimension"). The run loads rows from the source database into the target table in one transaction; it changes data in the target database, so only run it when a person explicitly asks. Returns the run id and a link to follow its progress.',
        input: aiRunPipelineInput,
        permission: 'etl.pipelines.run',
        destructive: true,
      },
    ],
  },
  search: { entities: ['endpoint', 'pipeline'] },
  notifications: [{ type: 'etl.pipeline.failed', defaultChannels: ['inApp', 'email'] }],
  records: {
    types: [
      {
        type: 'endpoint',
        name: 'etl.entities.endpoint',
        icon: 'database-zap',
        permission: 'etl.endpoints.read',
      },
      { type: 'pipeline', name: 'etl.entities.pipeline', icon: 'workflow', permission: 'etl.pipelines.read' },
    ],
  },
  taskTypes: [
    {
      type: 'pipeline',
      name: 'etl.taskTypes.pipeline.name',
      description: 'etl.taskTypes.pipeline.description',
      icon: 'workflow',
      permission: 'etl.pipelines.run',
      config: pipelineTaskConfigSchema,
    },
  ],
});
