import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';
import {
  aiListJobsInput,
  aiRunJobInput,
  httpConfigSchema,
  runStatusSchema,
  runTriggerSchema,
  scriptConfigSchema,
  sqlConfigSchema,
  triggerKindSchema,
} from './contracts';

const jobRef = z.object({ jobId: z.uuid(), name: z.string(), type: z.string() });
const runRef = z.object({ runId: z.uuid(), jobId: z.uuid(), name: z.string() });

/**
 * Scheduled jobs: HTTP calls, SQL statements, sandboxed scripts and the task types other modules
 * contribute (ETL pipelines, inventory syncs), on cron/interval/after-job triggers, with retries,
 * timeouts, run history, live logs and alerts. Postgres holds the schedule; BullMQ executes runs.
 */
export const manifest = defineManifest({
  id: 'scheduler',
  version: '0.1.0',
  name: 'scheduler.meta.name',
  description: 'scheduler.meta.description',
  icon: 'calendar-clock',
  navigation: [
    {
      id: 'overview',
      label: 'scheduler.nav.overview',
      href: '/scheduler',
      icon: 'activity',
      permission: 'scheduler.jobs.read',
      section: 'main',
      group: 'scheduler.nav.group',
      order: 60,
    },
    {
      id: 'jobs',
      label: 'scheduler.nav.jobs',
      href: '/scheduler/jobs',
      icon: 'calendar-clock',
      permission: 'scheduler.jobs.read',
      section: 'main',
      group: 'scheduler.nav.group',
      order: 61,
    },
    {
      id: 'runs',
      label: 'scheduler.nav.runs',
      href: '/scheduler/runs',
      icon: 'history',
      permission: 'scheduler.jobs.read',
      section: 'main',
      group: 'scheduler.nav.group',
      order: 62,
    },
  ],
  permissions: [
    { key: 'scheduler.jobs.read', description: 'scheduler.permissions.jobsRead' },
    { key: 'scheduler.jobs.create', description: 'scheduler.permissions.jobsCreate' },
    { key: 'scheduler.jobs.manage', description: 'scheduler.permissions.jobsManage' },
    { key: 'scheduler.jobs.run', description: 'scheduler.permissions.jobsRun' },
    { key: 'scheduler.sql.run', description: 'scheduler.permissions.sqlRun' },
    { key: 'scheduler.scripts.manage', description: 'scheduler.permissions.scriptsManage' },
  ],
  roles: [
    {
      key: 'scheduler-viewer',
      name: 'Scheduled jobs viewer',
      description: 'See jobs, run history, logs and the monitoring dashboard',
      permissions: ['scheduler.jobs.read'],
    },
    {
      key: 'scheduler-operator',
      name: 'Scheduled jobs operator',
      description:
        'Create HTTP jobs and jobs of module task types; edit, run and cancel own and team jobs; run or cancel any job',
      permissions: ['scheduler.jobs.read', 'scheduler.jobs.create', 'scheduler.jobs.run'],
    },
    {
      key: 'scheduler-admin',
      name: 'Scheduled jobs administrator',
      description: 'Everything in Scheduled jobs, including SQL and script jobs',
      permissions: ['scheduler.*'],
    },
  ],
  events: {
    emits: [
      { name: 'scheduler.job.created', schema: jobRef.extend({ trigger: triggerKindSchema }) },
      { name: 'scheduler.job.updated', schema: jobRef.extend({ changes: z.array(z.string()) }) },
      { name: 'scheduler.job.deleted', schema: jobRef },
      { name: 'scheduler.job.enabled', schema: jobRef },
      {
        name: 'scheduler.job.disabled',
        description: 'A job was switched off (by a person, or automatically after a failure streak)',
        schema: jobRef.extend({ automatic: z.boolean() }),
      },
      {
        name: 'scheduler.run.requested',
        description: 'Someone ran a job now (or retried a run)',
        schema: runRef.extend({ trigger: runTriggerSchema }),
      },
      { name: 'scheduler.run.cancelled', schema: runRef },
      {
        name: 'scheduler.run.succeeded',
        schema: runRef.extend({ durationMs: z.number().int().nullable(), summary: z.string().nullable() }),
      },
      {
        name: 'scheduler.run.failed',
        description: 'A run failed after its last attempt',
        schema: runRef.extend({
          status: runStatusSchema,
          error: z.string().nullable(),
          streak: z.number().int(),
        }),
      },
    ],
    consumes: ['core.user.offboarded'],
  },
  settings: [
    {
      key: 'allowedHosts',
      label: 'scheduler.settings.allowedHosts',
      description: 'scheduler.settings.allowedHostsHelp',
      type: 'text',
      default: '',
    },
    {
      key: 'retentionDays',
      label: 'scheduler.settings.retentionDays',
      description: 'scheduler.settings.retentionDaysHelp',
      type: 'number',
      default: 90,
    },
    {
      key: 'misfireGraceMinutes',
      label: 'scheduler.settings.misfireGraceMinutes',
      description: 'scheduler.settings.misfireGraceMinutesHelp',
      type: 'number',
      default: 60,
      advanced: true,
    },
  ],
  ai: {
    tools: [
      {
        name: 'scheduler.list_jobs',
        description:
          'List scheduled jobs (HTTP calls, SQL tasks, scripts, ETL pipelines…) with their schedule, next run, last run status and failure streak; filter by name or by failing, disabled, enabled or running.',
        input: aiListJobsInput,
        permission: 'scheduler.jobs.read',
        readOnly: true,
      },
      {
        name: 'scheduler.run_job',
        description:
          'Run a scheduled job now, by name, JOB-00042 reference or id. Returns the queued run and a link to follow its live log.',
        input: aiRunJobInput,
        permission: 'scheduler.jobs.run',
        destructive: true,
      },
    ],
  },
  search: { entities: ['job'] },
  notifications: [
    { type: 'scheduler.run.failed', defaultChannels: ['inApp', 'email'] },
    { type: 'scheduler.run.recovered', defaultChannels: ['inApp'] },
    { type: 'scheduler.job.auto_disabled', defaultChannels: ['inApp', 'email'] },
  ],
  records: {
    types: [
      {
        type: 'job',
        name: 'scheduler.entities.job',
        icon: 'calendar-clock',
        permission: 'scheduler.jobs.read',
      },
    ],
  },
  customizations: [
    {
      kind: 'job',
      label: 'scheduler.customizations.job',
      description:
        'A scheduled job: an HTTP call, SQL statement, sandboxed script or module task (such as an ETL pipeline) on a cron, interval, after-other-jobs or manual trigger, with timeout, retries and failure alerts. Applying makes it live; archiving disables it.',
      icon: 'calendar-clock',
      readPermission: 'scheduler.jobs.read',
      applyPermission: 'scheduler.jobs.manage',
      operations: ['create', 'update', 'archive', 'delete'],
    },
  ],
  taskTypes: [
    {
      type: 'http',
      name: 'scheduler.taskTypes.http.name',
      description: 'scheduler.taskTypes.http.description',
      icon: 'globe',
      permission: 'scheduler.jobs.create',
      config: httpConfigSchema,
    },
    {
      type: 'sql',
      name: 'scheduler.taskTypes.sql.name',
      description: 'scheduler.taskTypes.sql.description',
      icon: 'database',
      permission: 'scheduler.sql.run',
      config: sqlConfigSchema,
    },
    {
      type: 'script',
      name: 'scheduler.taskTypes.script.name',
      description: 'scheduler.taskTypes.script.description',
      icon: 'square-terminal',
      permission: 'scheduler.scripts.manage',
      config: scriptConfigSchema,
    },
  ],
});
