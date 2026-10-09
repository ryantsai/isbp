/**
 * Data APIs & ETL contract (mounted at /api/v1/etl). Zod schemas shared by routes, pages, AI tools and tests.
 *
 *   Data APIs (callers)
 *     GET|POST /data/:slug                         latest published version (query string or JSON body)
 *     GET|POST /data/:slug/v:version               a pinned version
 *     GET      /openapi.json                        OpenAPI 3.1 of the versions the caller may use
 *
 *   Endpoints (developers)
 *     GET    /endpoints                             endpointQuerySchema → page(endpointSummarySchema)
 *     POST   /endpoints                             createEndpointSchema → endpointDetailSchema (201)
 *     GET    /endpoints/:ref                        → endpointDetailSchema            (id or slug)
 *     PATCH  /endpoints/:ref                        updateEndpointSchema → endpointDetailSchema (edits the draft)
 *     DELETE /endpoints/:ref
 *     POST   /endpoints/:ref/test                   testRequestSchema → testResultSchema
 *     POST   /endpoints/:ref/publish                publishSchema → endpointDetailSchema (409 TEST_REQUIRED)
 *     POST   /endpoints/:ref/versions/:version/:action   deprecate | retire | restore | load → endpointDetailSchema
 *     GET    /endpoints/:ref/stats                  statsQuerySchema → endpointStatsSchema
 *     GET    /connections · /connections/:id/catalog · /clients
 *
 *   Execution log
 *     GET    /calls                                 callQuerySchema → page(callSchema)
 *     GET    /calls/callers                         → { items: callerSchema[] }
 *     GET    /calls/:id                             → callDetailSchema
 *
 *   Pipelines
 *     GET    /pipelines                             pipelineQuerySchema → page(pipelineSummarySchema)
 *     POST   /pipelines                             pipelineInputSchema → pipelineDetailSchema (201)
 *     GET    /pipelines/:id                         → pipelineDetailSchema
 *     PATCH  /pipelines/:id                         pipelineUpdateSchema → pipelineDetailSchema
 *     DELETE /pipelines/:id
 *     POST   /pipelines/preview                     previewSchema → previewResultSchema (source sample)
 *     POST   /pipelines/:id/run                     → runSchema (202, queued)
 *     GET    /pipelines/:id/runs                    runQuerySchema → page(runSchema)
 *     GET    /pipelines/:id/runs/:runId             → runDetailSchema
 *     POST   /pipelines/:id/runs/:runId/cancel      → runDetailSchema
 */
import { dateTime, dbConnectionSummarySchema, dbEngineSchema } from '@isbp/contracts';
import { listQuerySchema, runProblemSchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  CALL_PERIODS,
  ENDPOINT_KINDS,
  ENDPOINT_METHODS,
  ENDPOINT_STATUSES,
  MAX_PARAMS,
  PARAM_NAME_RE,
  PARAM_TYPES,
  RESPONSE_SHAPES,
  RUN_STATUSES,
  RUN_TRIGGERS,
  SLUG_MAX,
  SLUG_MIN,
  SLUG_RE,
  STATS_PERIODS,
  TRANSFORM_RE,
  VERSION_STATUSES,
  WRITE_MODES,
  compilePattern,
} from './model';

export * from './model';

const id = z.uuid();
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const endpointMethodSchema = z.enum(ENDPOINT_METHODS);
export const endpointKindSchema = z.enum(ENDPOINT_KINDS);
export const responseShapeSchema = z.enum(RESPONSE_SHAPES);
export const paramTypeSchema = z.enum(PARAM_TYPES);
export const versionStatusSchema = z.enum(VERSION_STATUSES);
export const endpointStatusSchema = z.enum(ENDPOINT_STATUSES);
export const writeModeSchema = z.enum(WRITE_MODES);
export const runStatusSchema = z.enum(RUN_STATUSES);
export const runTriggerSchema = z.enum(RUN_TRIGGERS);

export const slugSchema = z
  .string()
  .trim()
  .min(SLUG_MIN)
  .max(SLUG_MAX)
  .regex(SLUG_RE, 'Lower-case letters, digits and single dashes, starting with a letter');

export const actorSchema = z.object({ id, name: z.string() });
export type Actor = z.input<typeof actorSchema>;

export const personRefSchema = z.object({ id, displayName: z.string(), avatarUrl: z.string().nullable() });
export type PersonRef = z.input<typeof personRefSchema>;

export const columnSchema = z.object({ name: z.string(), type: z.string() });

export const databaseErrorInfoSchema = z.object({
  kind: z.string(),
  dbCode: z.string().nullable(),
  message: z.string(),
});
export type DatabaseErrorDto = z.infer<typeof databaseErrorInfoSchema>;

/** A connection as Data APIs show it; `missing` when it was deleted. */
export const connectionRefSchema = z.object({
  id,
  name: z.string(),
  engine: dbEngineSchema.nullable(),
  readOnly: z.boolean(),
  status: z.enum(['unknown', 'ok', 'error', 'missing']),
});
export type ConnectionRef = z.input<typeof connectionRefSchema>;

export { dbConnectionSummarySchema };

/* ───────────────────────────── parameters & definitions ───────────────────────────── */

export const paramDefSchema = z
  .object({
    name: z.string().trim().regex(PARAM_NAME_RE, 'Letters, digits and _, starting with a letter or _'),
    type: paramTypeSchema.default('string'),
    list: z.boolean().default(false),
    required: z.boolean().default(false),
    default: nullableText(1_000).default(null),
    min: z.number().nullable().default(null),
    max: z.number().nullable().default(null),
    minLength: z.number().int().min(0).max(100_000).nullable().default(null),
    maxLength: z.number().int().min(1).max(100_000).nullable().default(null),
    pattern: nullableText(500)
      .default(null)
      .refine((p) => p === null || compilePattern(p) !== null, 'Not a valid regular expression'),
    enum: z.array(z.string().trim().min(1).max(200)).max(100).nullable().default(null),
    description: nullableText(1_000).default(null),
    example: nullableText(1_000).default(null),
    sensitive: z.boolean().default(false),
    target: nullableText(128).default(null),
  })
  .superRefine((p, ctx) => {
    if (p.min !== null && p.max !== null && p.min > p.max)
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'Must not be below the minimum' });
    if (p.minLength !== null && p.maxLength !== null && p.minLength > p.maxLength)
      ctx.addIssue({ code: 'custom', path: ['maxLength'], message: 'Must not be below the minimum length' });
  });
export type ParamDefInput = z.input<typeof paramDefSchema>;

export const procedureSchema = z.object({
  schema: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  kind: z.enum(['procedure', 'function']),
  returns: z.string().max(200).nullable(),
  parameters: z
    .array(
      z.object({
        name: z.string().max(128),
        type: z.string().max(200),
        direction: z.enum(['in', 'out', 'inout']),
      }),
    )
    .max(100),
});

export const endpointDefinitionSchema = z
  .object({
    method: endpointMethodSchema.default('GET'),
    connectionId: id,
    kind: endpointKindSchema.default('query'),
    sql: z.string().max(100_000).default(''),
    procedure: procedureSchema.nullable().default(null),
    params: z.array(paramDefSchema).max(MAX_PARAMS).default([]),
    allowsWrites: z.boolean().default(false),
    responseShape: responseShapeSchema.default('rows'),
    maxRows: z.number().int().min(1).max(100_000).default(1_000),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(30_000),
    cacheTtlSeconds: z.number().int().min(0).max(86_400).default(0),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.params.forEach((p, i) => {
      if (seen.has(p.name))
        ctx.addIssue({ code: 'custom', path: ['params', i, 'name'], message: 'Duplicate parameter name' });
      seen.add(p.name);
    });
    if (d.kind === 'procedure' && d.procedure) {
      const args = new Set(d.procedure.parameters.filter((a) => a.direction !== 'out').map((a) => a.name));
      d.params.forEach((p, i) => {
        if (!args.has(p.target || p.name))
          ctx.addIssue({
            code: 'custom',
            path: ['params', i, 'target'],
            message: `${d.procedure!.name} has no input argument ${p.target || p.name}`,
          });
      });
    }
  });
export type EndpointDefinitionInput = z.input<typeof endpointDefinitionSchema>;

/**
 * Response shapes of definitions. Responses are encoded through their schemas, which must not hold
 * transforms or defaults; the input schemas above normalise, these only describe.
 */
export const paramDefOutSchema = z.object({
  name: z.string(),
  type: paramTypeSchema,
  list: z.boolean(),
  required: z.boolean(),
  default: z.string().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  minLength: z.number().int().nullable(),
  maxLength: z.number().int().nullable(),
  pattern: z.string().nullable(),
  enum: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  example: z.string().nullable(),
  sensitive: z.boolean(),
  target: z.string().nullable(),
});

export const endpointDefinitionOutSchema = z.object({
  method: endpointMethodSchema,
  connectionId: z.string(),
  kind: endpointKindSchema,
  sql: z.string(),
  procedure: procedureSchema.nullable(),
  params: z.array(paramDefOutSchema),
  allowsWrites: z.boolean(),
  responseShape: responseShapeSchema,
  maxRows: z.number().int(),
  timeoutMs: z.number().int(),
  cacheTtlSeconds: z.number().int(),
});
export type EndpointDefinitionDto = z.input<typeof endpointDefinitionOutSchema>;

/* ───────────────────────────── endpoints ───────────────────────────── */

export const apiClientRefSchema = z.object({
  id,
  name: z.string(),
  clientId: z.string(),
  revoked: z.boolean(),
});
export type ApiClientRef = z.input<typeof apiClientRefSchema>;

export const versionSchema = z.object({
  version: z.number().int(),
  status: versionStatusSchema,
  definition: endpointDefinitionOutSchema,
  columns: z.array(columnSchema),
  note: z.string().nullable(),
  publishedAt: dateTime,
  publishedBy: actorSchema.nullable(),
  deprecatedAt: dateTime.nullable(),
  retiredAt: dateTime.nullable(),
});
export type VersionDto = z.input<typeof versionSchema>;
export type VersionOut = z.output<typeof versionSchema>;

export const endpointSummarySchema = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  method: endpointMethodSchema,
  kind: endpointKindSchema,
  connection: connectionRefSchema.nullable(),
  status: endpointStatusSchema,
  latestVersion: z.number().int().nullable(),
  /** The draft differs from the latest published version. */
  draftChanged: z.boolean(),
  calls24h: z.number().int(),
  errors24h: z.number().int(),
  updatedAt: dateTime,
});
export type EndpointSummary = z.input<typeof endpointSummarySchema>;
export type EndpointSummaryOut = z.output<typeof endpointSummarySchema>;

export const endpointDetailSchema = endpointSummarySchema.extend({
  draft: endpointDefinitionOutSchema,
  /** The current draft passed a test (publish is allowed). */
  draftTested: z.boolean(),
  draftTestedAt: dateTime.nullable(),
  draftColumns: z.array(columnSchema).nullable(),
  /** Write/DDL keywords found in the draft SQL (outside strings and comments). */
  writeKeywords: z.array(z.string()),
  allowUsers: z.boolean(),
  allowedClients: z.array(apiClientRefSchema),
  rateLimitPerMinute: z.number().int().nullable(),
  effectiveRateLimit: z.number().int(),
  versions: z.array(versionSchema),
  createdBy: actorSchema.nullable(),
  createdAt: dateTime,
  viewer: z.object({ canManage: z.boolean(), canInvoke: z.boolean() }),
});
export type EndpointDetail = z.input<typeof endpointDetailSchema>;
export type EndpointDetailOut = z.output<typeof endpointDetailSchema>;

export const endpointQuerySchema = listQuerySchema.extend({
  status: endpointStatusSchema.optional(),
  connection: id.optional(),
});

export const createEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: nullableText(2_000),
  method: endpointMethodSchema.default('GET'),
  connectionId: id,
  kind: endpointKindSchema.default('query'),
});
export type CreateEndpointInput = z.input<typeof createEndpointSchema>;

export const updateEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** Only while no version is published (callers use it in URLs). */
  slug: slugSchema.optional(),
  description: nullableText(2_000).optional(),
  draft: endpointDefinitionSchema.optional(),
  allowUsers: z.boolean().optional(),
  allowedClients: z.array(id).max(200).optional(),
  /** null = the module default. */
  rateLimitPerMinute: z.number().int().min(1).max(100_000).nullable().optional(),
});
export type UpdateEndpointInput = z.input<typeof updateEndpointSchema>;

export const testRequestSchema = z.object({
  /** Values as strings (form fields) or JSON values. */
  params: z.record(z.string(), z.unknown()).default({}),
  /** Run a published version instead of the draft. */
  version: z.number().int().min(1).optional(),
});
export type TestRequest = z.input<typeof testRequestSchema>;

export const testResultSchema = z.object({
  ok: z.boolean(),
  version: z.number().int().nullable(),
  columns: z.array(columnSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int(),
  truncated: z.boolean(),
  durationMs: z.number().int(),
  /** The statement with the driver's placeholders (values are bound separately). */
  boundSql: z.string(),
  error: databaseErrorInfoSchema.nullable(),
  /** The draft is now tested and can be published. */
  draftTested: z.boolean(),
});
export type TestResult = z.input<typeof testResultSchema>;

export const publishSchema = z.object({ note: nullableText(2_000) });

export const VERSION_ACTIONS = ['deprecate', 'retire', 'restore', 'load'] as const;
export const versionActionSchema = z.enum(VERSION_ACTIONS);
export type VersionAction = (typeof VERSION_ACTIONS)[number];

export const statsQuerySchema = z.object({ period: z.enum(STATS_PERIODS).default('24h') });

export const endpointStatsSchema = z.object({
  period: z.enum(STATS_PERIODS),
  calls: z.number().int(),
  errors: z.number().int(),
  errorRate: z.number(),
  cacheHits: z.number().int(),
  p95Ms: z.number().nullable(),
  avgMs: z.number().nullable(),
  series: z.array(
    z.object({
      at: dateTime,
      calls: z.number().int(),
      errors: z.number().int(),
      p95Ms: z.number().nullable(),
    }),
  ),
});
export type EndpointStats = z.input<typeof endpointStatsSchema>;
export type EndpointStatsOut = z.output<typeof endpointStatsSchema>;

/* ───────────────────────────── execution log ───────────────────────────── */

export const callerSchema = z.object({
  type: z.enum(['user', 'client']),
  id: z.string().nullable(),
  name: z.string(),
});
export type CallerDto = z.input<typeof callerSchema>;

export const callSchema = z.object({
  id,
  endpoint: z.object({ id, slug: z.string(), name: z.string() }),
  version: z.number().int().nullable(),
  caller: callerSchema,
  status: z.number().int(),
  errorCode: z.string().nullable(),
  durationMs: z.number().int(),
  rows: z.number().int().nullable(),
  cached: z.boolean(),
  params: z.record(z.string(), z.unknown()),
  requestId: z.string().nullable(),
  createdAt: dateTime,
});
export type CallDto = z.input<typeof callSchema>;
export type CallOut = z.output<typeof callSchema>;

export const callDetailSchema = callSchema.extend({ errorMessage: z.string().nullable() });
export type CallDetail = z.input<typeof callDetailSchema>;
export type CallDetailOut = z.output<typeof callDetailSchema>;

export const callQuerySchema = listQuerySchema.extend({
  endpoint: id.optional(),
  status: z.enum(['ok', 'error']).optional(),
  /** `user:<id>` or `client:<id>`. */
  caller: z
    .string()
    .regex(/^(user|client):[0-9a-f-]{36}$/)
    .optional(),
  period: z.enum(CALL_PERIODS).default('7d'),
});

/* ───────────────────────────── pipelines ───────────────────────────── */

export const mappingSchema = z.object({
  source: z.string().trim().min(1).max(128),
  target: z.string().trim().min(1).max(128),
  transform: z.string().regex(TRANSFORM_RE, 'Unknown transform').default('none'),
});
export type MappingInput = z.input<typeof mappingSchema>;

export const staticValueSchema = z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]);

export const pipelineSourceSchema = z.object({
  connectionId: id,
  sql: z.string().trim().min(1).max(100_000),
  /** Static values of the SQL's `:params` (`:watermark` comes from the last successful run). */
  params: z.record(z.string(), staticValueSchema).default({}),
});

export const pipelineTargetSchema = z.object({
  connectionId: id,
  schema: z.string().trim().max(128).nullable().default(null),
  table: z.string().trim().min(1).max(128),
  mode: writeModeSchema.default('insert'),
  keys: z.array(z.string().trim().min(1).max(128)).max(16).default([]),
});

export const incrementalSchema = z.object({
  /** Result column whose highest value becomes the next watermark. */
  column: z.string().trim().min(1).max(128),
  /** Watermark of the very first run. */
  initial: z.string().trim().min(1).max(200),
});

export const pipelineInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: nullableText(2_000),
  ownerId: id.nullable().default(null),
  enabled: z.boolean().default(true),
  source: pipelineSourceSchema,
  incremental: incrementalSchema.nullable().default(null),
  target: pipelineTargetSchema,
  mappings: z.array(mappingSchema).min(1).max(500),
  batchSize: z.number().int().min(1).max(10_000).default(500),
});
export type PipelineInput = z.input<typeof pipelineInputSchema>;

/** Partial edit: absent fields keep their value (no defaults here, unlike `.partial()` in Zod 4). */
export const pipelineUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: nullableText(2_000).optional(),
  ownerId: id.nullable().optional(),
  enabled: z.boolean().optional(),
  source: pipelineSourceSchema.optional(),
  incremental: incrementalSchema.nullable().optional(),
  target: pipelineTargetSchema.optional(),
  mappings: z.array(mappingSchema).min(1).max(500).optional(),
  batchSize: z.number().int().min(1).max(10_000).optional(),
  /** Clear the stored watermark (the next run starts from `incremental.initial`). */
  resetWatermark: z.boolean().optional(),
});
export type PipelineUpdateInput = z.input<typeof pipelineUpdateSchema>;

export const runSchema = z.object({
  id,
  pipelineId: id,
  trigger: runTriggerSchema,
  status: runStatusSchema,
  rowsRead: z.number().int(),
  rowsWritten: z.number().int(),
  rowsRejected: z.number().int(),
  watermarkFrom: z.string().nullable(),
  watermarkTo: z.string().nullable(),
  startedAt: dateTime.nullable(),
  finishedAt: dateTime.nullable(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  /** Why it failed, for the plain explanation (`error` is the raw text). */
  problem: runProblemSchema.nullable(),
  triggeredBy: actorSchema.nullable(),
  /** The Scheduled jobs run that started it (trigger `schedule`). */
  jobRun: z.object({ runId: z.string(), jobId: z.string().nullable() }).nullable(),
  cancelRequested: z.boolean(),
  createdAt: dateTime,
});
export type RunDto = z.input<typeof runSchema>;
export type RunOut = z.output<typeof runSchema>;

export const runLogLineSchema = z.object({
  at: dateTime,
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});
export type RunLogLine = z.input<typeof runLogLineSchema>;

export const runDetailSchema = runSchema.extend({
  pipeline: z.object({ id, name: z.string() }),
  log: z.array(runLogLineSchema),
  viewer: z.object({ canRun: z.boolean() }),
});
export type RunDetail = z.input<typeof runDetailSchema>;
export type RunDetailOut = z.output<typeof runDetailSchema>;

export const pipelineSummarySchema = z.object({
  id,
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  owner: personRefSchema.nullable(),
  source: connectionRefSchema.nullable(),
  target: connectionRefSchema.nullable(),
  targetTable: z.string(),
  mode: writeModeSchema,
  incremental: z.boolean(),
  lastRun: runSchema.nullable(),
  updatedAt: dateTime,
});
export type PipelineSummary = z.input<typeof pipelineSummarySchema>;
export type PipelineSummaryOut = z.output<typeof pipelineSummarySchema>;

export const pipelineDefinitionOutSchema = z.object({
  source: z.object({
    connectionId: z.string(),
    sql: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  }),
  incremental: z.object({ column: z.string(), initial: z.string() }).nullable(),
  target: z.object({
    connectionId: z.string(),
    schema: z.string().nullable(),
    table: z.string(),
    mode: writeModeSchema,
    keys: z.array(z.string()),
  }),
  mappings: z.array(z.object({ source: z.string(), target: z.string(), transform: z.string() })),
  batchSize: z.number().int(),
});
export type PipelineDefinitionDto = z.input<typeof pipelineDefinitionOutSchema>;

export const pipelineDetailSchema = pipelineSummarySchema.extend({
  definition: pipelineDefinitionOutSchema,
  /** The scheduled job that ran it most recently (last 60 days), so the page links to it instead of offering "Schedule". */
  schedule: z.object({ jobId: z.string(), lastRunAt: dateTime }).nullable(),
  watermark: z.string().nullable(),
  stats: z.object({
    runs: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    rowsWritten: z.number().int(),
  }),
  createdBy: actorSchema.nullable(),
  createdAt: dateTime,
  viewer: z.object({ canManage: z.boolean(), canRun: z.boolean() }),
});
export type PipelineDetail = z.input<typeof pipelineDetailSchema>;
export type PipelineDetailOut = z.output<typeof pipelineDetailSchema>;

export const pipelineQuerySchema = listQuerySchema.extend({
  status: runStatusSchema.optional(),
  enabled: z.stringbool().optional(),
});

export const runQuerySchema = listQuerySchema.extend({ status: runStatusSchema.optional() });

export const previewSchema = z.object({
  connectionId: id,
  sql: z.string().trim().min(1).max(100_000),
  params: z.record(z.string(), staticValueSchema).default({}),
  incremental: incrementalSchema.nullable().default(null),
});

export const previewResultSchema = z.object({
  columns: z.array(columnSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
  error: databaseErrorInfoSchema.nullable(),
});
export type PreviewResult = z.input<typeof previewResultSchema>;

/* ───────────────────────────── AI tools ───────────────────────────── */

export const aiListEndpointsInput = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const aiRunPipelineInput = z.object({
  /** Pipeline id or name. */
  pipeline: z.string().trim().min(1).max(200),
});

/* ───────────────────────────── task type ───────────────────────────── */

export const pipelineTaskConfigSchema = z.object({ pipelineId: id });
export type PipelineTaskConfig = z.infer<typeof pipelineTaskConfigSchema>;
