/**
 * Scheduled jobs API contract (mounted at /api/v1/scheduler). Zod schemas shared by routes, pages, AI
 * tools and tests.
 *
 *   Jobs
 *     GET    /jobs                       jobQuerySchema → page(jobSummarySchema)
 *     POST   /jobs                       createJobSchema → jobDetailSchema (201)
 *     GET    /jobs/:id                   → jobDetailSchema       (secrets as { secret: true, set })
 *     PATCH  /jobs/:id                   updateJobSchema → jobDetailSchema
 *     DELETE /jobs/:id                   (409 JOB_RUNNING while a run is active)
 *     POST   /jobs/:id/enable · /disable → jobDetailSchema
 *     POST   /jobs/:id/run               → runDetailSchema (201)
 *
 *   Runs
 *     GET    /runs                       runQuerySchema → page(runSummarySchema)
 *     GET    /runs/:id                   → runDetailSchema
 *     POST   /runs/:id/cancel            → runDetailSchema
 *     POST   /runs/:id/retry             → runDetailSchema (201, a new run)
 *     GET    /runs/:id/logs              logsQuerySchema → logsPageSchema
 *     GET    /runs/:id/logs/stream       text/event-stream: `lines` events, then `end`
 *
 *   Other
 *     GET    /dashboard                  → dashboardSchema
 *     GET    /attention                  → attentionSchema (home dashboard card)
 *     GET    /task-types                 → { items: taskTypeSchema[], sandbox }
 *     GET    /schedule/preview           previewQuerySchema → previewSchema
 *     GET    /connections                → { items: dbConnectionSummary[] }   (SQL jobs)
 *     GET    /connections/:id/catalog    → catalog
 *     GET    /lookups/groups             → { items: { id, name }[] }
 */
import { catalogSchema, dateTime, dbConnectionSummarySchema, taskTypeInfoSchema } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  AFTER_MODES,
  BACKOFFS,
  CONCURRENCY_POLICIES,
  HTTP_METHODS,
  LIMITS,
  LOG_LEVELS,
  parseExpectedStatus,
  RUN_STATUSES,
  RUN_TRIGGERS,
  SCRIPT_LANGUAGES,
  SKIP_REASONS,
  SQL_BUILTINS,
  SQL_PARAM_TYPES,
  TRIGGER_KINDS,
} from './model';

export * from './model';
export { catalogSchema, dbConnectionSummarySchema };
export type { CatalogDto, DbConnectionSummary, TaskConfigSlotProps } from '@isbp/contracts';

const id = z.uuid();

export const runStatusSchema = z.enum(RUN_STATUSES);
export const runTriggerSchema = z.enum(RUN_TRIGGERS);
export const triggerKindSchema = z.enum(TRIGGER_KINDS);
export const logLevelSchema = z.enum(LOG_LEVELS);

/* ───────────────────────────── built-in task configs ───────────────────────────── */

/**
 * A secret in a config: a new plain value, the stored `{ sealed }` form (server side only), or the
 * `{ secret: true, set }` placeholder the API returns (sending it back keeps the stored value).
 */
export const secretValueSchema = z.union([
  z.string().max(8_000),
  z.object({ sealed: z.string() }).strict(),
  z.object({ secret: z.literal(true), set: z.boolean() }).strict(),
]);

const headerName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Letters, digits and - _ . only');

export const httpHeaderSchema = z.object({
  name: headerName,
  value: secretValueSchema,
  secret: z.boolean().default(false),
});

export const httpAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('basic'), username: z.string().max(200), password: secretValueSchema }),
  z.object({ type: z.literal('bearer'), token: secretValueSchema }),
  z.object({ type: z.literal('header'), name: headerName, value: secretValueSchema }),
]);

export const httpConfigSchema = z
  .object({
    method: z.enum(HTTP_METHODS).default('GET'),
    url: z
      .url({ protocol: /^https?$/ })
      .max(2_000)
      .refine((u) => /^https?:\/\//i.test(u), 'Use an http:// or https:// URL'),
    headers: z.array(httpHeaderSchema).max(30).default([]),
    bodyType: z.enum(['none', 'text', 'json']).default('none'),
    body: z.string().max(100_000).default(''),
    auth: httpAuthSchema.default({ type: 'none' }),
    /** `200-299`, `200,204`, `2xx`. */
    expectedStatus: z
      .string()
      .trim()
      .max(100)
      .default('200-299')
      .refine((s) => parseExpectedStatus(s) !== null, 'Use codes and ranges such as 200-299 or 200,204'),
    timeoutSeconds: z.number().int().min(1).max(300).default(30),
  })
  .superRefine((c, ctx) => {
    if (c.bodyType !== 'json' || !c.body.trim()) return;
    try {
      JSON.parse(c.body);
    } catch {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'The body is not valid JSON' });
    }
  });
export type HttpConfig = z.infer<typeof httpConfigSchema>;

export const sqlParamSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
  /** A typed value, or one of the run's built-in values. */
  source: z.enum(['static', ...SQL_BUILTINS]).default('static'),
  type: z.enum(SQL_PARAM_TYPES).default('string'),
  value: z.string().max(4_000).nullable().default(null),
});
export type SqlParam = z.infer<typeof sqlParamSchema>;

export const sqlConfigSchema = z.object({
  /** A `data` connection (Administration → Database connections). */
  connectionId: id,
  /** One statement with `:name` parameters. */
  statement: z.string().trim().min(1).max(100_000),
  /** `query` logs the row count and a preview; `execute` logs affected rows. */
  mode: z.enum(['query', 'execute']).default('query'),
  params: z.array(sqlParamSchema).max(50).default([]),
});
export type SqlConfig = z.infer<typeof sqlConfigSchema>;

export const envVarSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'Letters, digits and underscores'),
  value: secretValueSchema,
  secret: z.boolean().default(false),
});

export const scriptConfigSchema = z.object({
  language: z.enum(SCRIPT_LANGUAGES),
  /** One of the administrator's allowed images. */
  image: z.string().trim().min(1).max(300),
  script: z
    .string()
    .min(1)
    .max(64 * 1024),
  env: z.array(envVarSchema).max(50).default([]),
  timeoutSeconds: z.number().int().min(1).max(3_600).default(300),
  cpu: z.number().min(0.1).max(2).default(0.5),
  memoryMb: z.number().int().min(32).max(2_048).default(256),
  network: z.enum(['none', 'egress']).default('none'),
});
export type ScriptConfig = z.infer<typeof scriptConfigSchema>;

/* ───────────────────────────── jobs ───────────────────────────── */

export const triggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cron'),
    /** Five fields, evaluated in `timezone`. */
    cron: z.string().trim().min(1).max(120),
    timezone: z.string().trim().min(1).max(64).default('UTC'),
  }),
  z.object({
    kind: z.literal('interval'),
    intervalMinutes: z.number().int().min(LIMITS.intervalMinutes.min).max(LIMITS.intervalMinutes.max),
  }),
  z.object({
    kind: z.literal('after'),
    upstreamIds: z.array(id).min(1).max(LIMITS.upstreams),
    mode: z.enum(AFTER_MODES).default('all'),
  }),
  z.object({ kind: z.literal('manual') }),
]);
export type Trigger = z.infer<typeof triggerSchema>;
export type TriggerInput = z.input<typeof triggerSchema>;

export const retriesSchema = z.object({
  maxAttempts: z.number().int().min(LIMITS.attempts.min).max(LIMITS.attempts.max),
  backoff: z.enum(BACKOFFS),
  delaySeconds: z.number().int().min(LIMITS.retryDelaySeconds.min).max(LIMITS.retryDelaySeconds.max),
});

export const alertsSchema = z.object({
  /** Notify the owner and the owner group when a run finally fails. */
  onFailure: z.boolean(),
  /** Also post failures to the organisation's Teams/Slack channels. */
  channels: z.boolean(),
  /** Disable the job after this many consecutive failures (0 = never). */
  autoDisableAfter: z.number().int().min(LIMITS.autoDisable.min).max(LIMITS.autoDisable.max),
});

const jobFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).nullable(),
  /** Default: the person creating the job. */
  ownerId: id.nullable(),
  ownerGroupId: id.nullable(),
  /** `<module>.<type>`, e.g. `scheduler.http` or `etl.pipeline`. */
  type: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  config: z.record(z.string(), z.unknown()),
  trigger: triggerSchema,
  enabled: z.boolean(),
  timeoutSeconds: z.number().int().min(LIMITS.timeoutSeconds.min).max(LIMITS.timeoutSeconds.max),
  retries: retriesSchema,
  concurrency: z.enum(CONCURRENCY_POLICIES),
  alerts: alertsSchema,
};

export const DEFAULT_RETRIES = { maxAttempts: 1, backoff: 'exponential', delaySeconds: 60 } as const;
export const DEFAULT_ALERTS = { onFailure: true, channels: false, autoDisableAfter: 0 } as const;

export const createJobSchema = z.object({
  ...jobFields,
  description: jobFields.description.default(null),
  ownerId: jobFields.ownerId.optional(),
  ownerGroupId: jobFields.ownerGroupId.default(null),
  config: jobFields.config.default({}),
  enabled: jobFields.enabled.default(true),
  timeoutSeconds: jobFields.timeoutSeconds.default(LIMITS.timeoutSeconds.default),
  retries: retriesSchema.default({ ...DEFAULT_RETRIES }),
  concurrency: jobFields.concurrency.default('skip'),
  alerts: alertsSchema.default({ ...DEFAULT_ALERTS }),
});
export type CreateJobInput = z.input<typeof createJobSchema>;
export type CreateJob = z.infer<typeof createJobSchema>;

/** Every field optional; the task `type` is permanent. Omitted secrets keep their stored value. */
export const updateJobSchema = z.object(jobFields).omit({ type: true }).partial();
export type UpdateJobInput = z.input<typeof updateJobSchema>;

export const jobViewSchema = z.enum(['all', 'failing', 'running', 'disabled', 'mine']);
export type JobView = z.infer<typeof jobViewSchema>;

export const jobQuerySchema = listQuerySchema.extend({
  view: jobViewSchema.optional(),
  type: z.string().max(100).optional(),
  trigger: triggerKindSchema.optional(),
  enabled: z.stringbool().optional(),
});
export type JobQuery = z.input<typeof jobQuerySchema>;
export type JobQueryOut = z.output<typeof jobQuerySchema>;

export const personRefSchema = z.object({ id, displayName: z.string(), avatarUrl: z.string().nullable() });
export type PersonRef = z.input<typeof personRefSchema>;
export const groupRefSchema = z.object({ id, name: z.string() });
export type GroupRef = z.input<typeof groupRefSchema>;

export const jobRefSchema = z.object({ id, name: z.string(), type: z.string() });
export type JobRef = z.input<typeof jobRefSchema>;

/** What the task is, for lists: the type's label and the configured object (pipeline, URL…). */
export const taskInfoSchema = z.object({
  /** i18n key of the type's name (owning module's catalog). */
  name: z.string(),
  icon: z.string().nullable(),
  /** "GET https://…", "Pipeline: Orders → warehouse". */
  label: z.string(),
  href: z.string().nullable(),
  /** The owning module is enabled (otherwise runs fail with MODULE_DISABLED). */
  available: z.boolean(),
});
export type TaskInfo = z.input<typeof taskInfoSchema>;

export const triggerOutSchema = z.object({
  kind: triggerKindSchema,
  cron: z.string().nullable(),
  timezone: z.string(),
  intervalMinutes: z.number().int().nullable(),
  mode: z.enum(AFTER_MODES).nullable(),
  upstream: z.array(jobRefSchema),
});
export type TriggerOut = z.input<typeof triggerOutSchema>;

export const lastRunSchema = z.object({
  id,
  status: runStatusSchema,
  trigger: runTriggerSchema,
  scheduledFor: dateTime,
  startedAt: dateTime.nullable(),
  finishedAt: dateTime.nullable(),
  durationMs: z.number().int().nullable(),
  summary: z.string().nullable(),
});
export type LastRun = z.input<typeof lastRunSchema>;
export type LastRunOut = z.output<typeof lastRunSchema>;

export const jobViewerSchema = z.object({
  /** Edit, enable/disable (owners, owner-group members, `scheduler.jobs.manage`). */
  canEdit: z.boolean(),
  canRun: z.boolean(),
  canDelete: z.boolean(),
});

export const jobSummarySchema = z.object({
  id,
  number: z.number().int(),
  /** `JOB-00042`. */
  reference: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  task: taskInfoSchema,
  trigger: triggerOutSchema,
  enabled: z.boolean(),
  /** `auto` when the job disabled itself after a failure streak. */
  disabledReason: z.string().nullable(),
  nextRunAt: dateTime.nullable(),
  lastRun: lastRunSchema.nullable(),
  lastSuccessAt: dateTime.nullable(),
  failureStreak: z.number().int(),
  running: z.boolean(),
  owner: personRefSchema.nullable(),
  ownerGroup: groupRefSchema.nullable(),
  updatedAt: dateTime,
});
export type JobSummary = z.input<typeof jobSummarySchema>;
export type JobSummaryOut = z.output<typeof jobSummarySchema>;

export const downstreamSchema = jobRefSchema.extend({
  mode: z.enum(AFTER_MODES),
  enabled: z.boolean(),
  lastStatus: runStatusSchema.nullable(),
});

export const jobDetailSchema = jobSummarySchema.extend({
  /** Secrets appear as `{ secret: true, set }`. */
  config: z.record(z.string(), z.unknown()),
  timeoutSeconds: z.number().int(),
  retries: retriesSchema,
  concurrency: z.enum(CONCURRENCY_POLICIES),
  alerts: alertsSchema,
  upstream: z.array(
    jobRefSchema.extend({ lastStatus: runStatusSchema.nullable(), lastSuccessAt: dateTime.nullable() }),
  ),
  downstream: z.array(downstreamSchema),
  runs: z.object({ total: z.number().int(), succeeded7d: z.number().int(), failed7d: z.number().int() }),
  viewer: jobViewerSchema,
  createdBy: personRefSchema.nullable(),
  createdAt: dateTime,
});
export type JobDetail = z.input<typeof jobDetailSchema>;
export type JobDetailOut = z.output<typeof jobDetailSchema>;

/* ───────────────────────────── runs ───────────────────────────── */

export const runViewSchema = z.enum(['all', 'failed', 'active']);
export type RunView = z.infer<typeof runViewSchema>;

export const runQuerySchema = listQuerySchema.extend({
  view: runViewSchema.optional(),
  jobId: id.optional(),
  /** One status or a comma-separated list. */
  status: z
    .string()
    .max(200)
    .regex(/^[a-z_]+(,[a-z_]+)*$/)
    .optional(),
  trigger: runTriggerSchema.optional(),
  /** Runs scheduled in the last N hours. */
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .optional(),
});
export type RunQuery = z.input<typeof runQuerySchema>;
export type RunQueryOut = z.output<typeof runQuerySchema>;

export const runSummarySchema = z.object({
  id,
  job: jobRefSchema,
  status: runStatusSchema,
  trigger: runTriggerSchema,
  skipReason: z.enum(SKIP_REASONS).nullable(),
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  scheduledFor: dateTime,
  queuedAt: dateTime,
  startedAt: dateTime.nullable(),
  finishedAt: dateTime.nullable(),
  durationMs: z.number().int().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  triggeredBy: personRefSchema.nullable(),
});
export type RunSummary = z.input<typeof runSummarySchema>;
export type RunSummaryOut = z.output<typeof runSummarySchema>;

export const attemptSchema = z.object({
  attempt: z.number().int(),
  startedAt: dateTime,
  finishedAt: dateTime.nullable(),
  status: runStatusSchema,
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
});
export type Attempt = z.input<typeof attemptSchema>;

export const runDetailSchema = runSummarySchema.extend({
  task: taskInfoSchema,
  metrics: z.record(z.string(), z.number()),
  href: z.string().nullable(),
  attempts: z.array(attemptSchema),
  cancelRequested: z.boolean(),
  heartbeatAt: dateTime.nullable(),
  nextAttemptAt: dateTime.nullable(),
  upstreamRun: z.object({ id, job: jobRefSchema }).nullable(),
  logCount: z.number().int(),
  logTruncated: z.boolean(),
  viewer: z.object({ canCancel: z.boolean(), canRetry: z.boolean() }),
});
export type RunDetail = z.input<typeof runDetailSchema>;
export type RunDetailOut = z.output<typeof runDetailSchema>;

export const logLineSchema = z.object({
  seq: z.number().int(),
  at: dateTime,
  level: logLevelSchema,
  attempt: z.number().int(),
  message: z.string(),
});
export type LogLineDto = z.input<typeof logLineSchema>;
export type LogLineOut = z.output<typeof logLineSchema>;

export const logsQuerySchema = z.object({
  /** Lines after this sequence number. */
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(5_000).default(1_000),
});

export const logsPageSchema = z.object({
  items: z.array(logLineSchema),
  status: runStatusSchema,
  /** The run is over: no more lines will come. */
  done: z.boolean(),
  truncated: z.boolean(),
});
export type LogsPage = z.input<typeof logsPageSchema>;
export type LogsPageOut = z.output<typeof logsPageSchema>;

/* ───────────────────────────── dashboard ───────────────────────────── */

/** Chart series, in a fixed order (colours follow it). */
export const CHART_SERIES = ['succeeded', 'failed', 'timed_out', 'cancelled', 'skipped', 'active'] as const;
export type ChartSeries = (typeof CHART_SERIES)[number];

export const dashboardSchema = z.object({
  kpis: z.object({
    runs24h: z.number().int(),
    successRate24h: z.number().nullable(),
    successRate7d: z.number().nullable(),
    failingJobs: z.number().int(),
    runningNow: z.number().int(),
    avgDurationMs24h: z.number().int().nullable(),
    jobs: z.number().int(),
    enabledJobs: z.number().int(),
  }),
  hourly: z.array(z.object({ hour: dateTime, counts: z.record(z.enum(CHART_SERIES), z.number().int()) })),
  upcoming: z.array(z.object({ job: jobRefSchema, at: dateTime })),
  failing: z.array(
    z.object({
      job: jobRefSchema,
      streak: z.number().int(),
      enabled: z.boolean(),
      lastFailure: z
        .object({ runId: id, status: runStatusSchema, at: dateTime, error: z.string().nullable() })
        .nullable(),
    }),
  ),
  slowest: z.array(z.object({ job: jobRefSchema, p95Ms: z.number().int(), runs: z.number().int() })),
});
export type Dashboard = z.input<typeof dashboardSchema>;
export type DashboardOut = z.output<typeof dashboardSchema>;

export const attentionSchema = z.object({
  failingJobs: z.number().int(),
  runningNow: z.number().int(),
  items: z.array(
    z.object({ job: jobRefSchema, streak: z.number().int(), at: dateTime.nullable(), runId: id.nullable() }),
  ),
});
export type Attention = z.input<typeof attentionSchema>;
export type AttentionOut = z.output<typeof attentionSchema>;

/* ───────────────────────────── metadata ───────────────────────────── */

export const sandboxStatusSchema = z.object({
  runner: z.enum(['none', 'local', 'docker', 'kubernetes']),
  isolated: z.boolean(),
  images: z.array(z.string()),
});
export type SandboxStatus = z.infer<typeof sandboxStatusSchema>;

export const taskTypeSchema = taskTypeInfoSchema.extend({ builtin: z.boolean() });
export type TaskType = z.infer<typeof taskTypeSchema>;

export const taskTypesSchema = z.object({ items: z.array(taskTypeSchema), sandbox: sandboxStatusSchema });
export type TaskTypes = z.infer<typeof taskTypesSchema>;

export const previewQuerySchema = z.object({
  kind: z.enum(['cron', 'interval']),
  cron: z.string().max(120).optional(),
  timezone: z.string().max(64).optional(),
  intervalMinutes: z.coerce.number().int().min(1).max(LIMITS.intervalMinutes.max).optional(),
  count: z.coerce.number().int().min(1).max(10).default(5),
});

export const previewSchema = z.object({
  valid: z.boolean(),
  error: z.string().nullable(),
  next: z.array(dateTime),
});
export type Preview = z.input<typeof previewSchema>;

export const lookupItemSchema = z.object({ id, name: z.string() });
export type LookupItem = z.infer<typeof lookupItemSchema>;

/* ───────────────────────────── AI tools ───────────────────────────── */

export const aiListJobsInput = z.object({
  query: z.string().max(200).optional().describe('Words from the job name or description'),
  status: z
    .enum(['failing', 'disabled', 'enabled', 'running'])
    .optional()
    .describe('Only failing (last run failed), disabled, enabled or currently running jobs'),
  limit: z.number().int().min(1).max(50).default(10),
});

export const aiRunJobInput = z.object({
  job: z.string().min(1).max(200).describe('The job name, its JOB-00042 reference or its id'),
});
