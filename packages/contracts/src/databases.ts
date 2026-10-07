import { z } from 'zod';
import { dateTime } from './common';

export const dbEngineSchema = z.enum(['mssql', 'postgres', 'mysql', 'oracle']);
export const dbPurposeSchema = z.enum(['data', 'admin']);
export type DbEngineValue = z.infer<typeof dbEngineSchema>;
export type DbPurposeValue = z.infer<typeof dbPurposeSchema>;

/** Default TCP port per engine. */
export const DEFAULT_DB_PORTS: Record<DbEngineValue, number> = {
  mssql: 1433,
  postgres: 5432,
  mysql: 3306,
  oracle: 1521,
};

export const dbConnectionOptionsSchema = z.object({
  tls: z.enum(['off', 'require', 'verify']).default('require'),
  ca: z.string().max(20_000).nullable().default(null),
  instanceName: z.string().trim().max(128).nullable().default(null),
  domain: z.string().trim().max(128).nullable().default(null),
});

const actor = z.object({ id: z.uuid(), name: z.string() }).nullable();

export const dbConnectionSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  engine: dbEngineSchema,
  host: z.string(),
  port: z.number().int().nullable(),
  database: z.string().nullable(),
  username: z.string(),
  /** The password is never returned; this says whether one is stored. */
  hasPassword: z.boolean(),
  options: z.object({
    tls: z.enum(['off', 'require', 'verify']),
    hasCa: z.boolean(),
    instanceName: z.string().nullable(),
    domain: z.string().nullable(),
  }),
  purposes: z.array(dbPurposeSchema),
  readOnly: z.boolean(),
  enabled: z.boolean(),
  poolMax: z.number().int(),
  timeoutMs: z.number().int(),
  maxRows: z.number().int(),
  status: z.enum(['unknown', 'ok', 'error']),
  serverVersion: z.string().nullable(),
  lastCheckedAt: dateTime.nullable(),
  lastLatencyMs: z.number().int().nullable(),
  lastError: z.string().nullable(),
  createdBy: actor,
  updatedBy: actor,
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type DbConnectionDto = z.input<typeof dbConnectionSchema>;

const keySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'Lower-case letters, digits and dashes');

/** Fields without defaults: `.partial()` of a schema with `.default()`s would fill omitted fields in PATCH. */
const connectionFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).nullable(),
  engine: dbEngineSchema,
  host: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9.:[\]_-]+$/, 'Host name or IP address'),
  port: z.number().int().min(1).max(65_535).nullable(),
  database: z.string().trim().max(128).nullable(),
  username: z.string().trim().min(1).max(128),
  /** Write-only. */
  password: z.string().max(1_024).nullable(),
  purposes: z.array(dbPurposeSchema).min(1).max(2),
  readOnly: z.boolean(),
  enabled: z.boolean(),
  poolMax: z.number().int().min(1).max(50),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  maxRows: z.number().int().min(1).max(100_000),
};

export const createDbConnectionSchema = z.object({
  ...connectionFields,
  key: keySchema,
  description: connectionFields.description.default(null),
  port: connectionFields.port.default(null),
  database: connectionFields.database.default(null),
  password: connectionFields.password.default(null),
  options: dbConnectionOptionsSchema.default({ tls: 'require', ca: null, instanceName: null, domain: null }),
  readOnly: connectionFields.readOnly.default(false),
  enabled: connectionFields.enabled.default(true),
  poolMax: connectionFields.poolMax.default(5),
  timeoutMs: connectionFields.timeoutMs.default(30_000),
  maxRows: connectionFields.maxRows.default(10_000),
});
export type CreateDbConnectionInput = z.input<typeof createDbConnectionSchema>;

/** Omitted fields are kept. `password`: `null` clears it. `options.ca`: omit to keep, `null` to clear. */
export const updateDbConnectionSchema = z
  .object({
    ...connectionFields,
    options: z.object({
      tls: z.enum(['off', 'require', 'verify']).optional(),
      ca: z.string().max(20_000).nullable().optional(),
      instanceName: z.string().trim().max(128).nullable().optional(),
      domain: z.string().trim().max(128).nullable().optional(),
    }),
  })
  .partial();
export type UpdateDbConnectionInput = z.input<typeof updateDbConnectionSchema>;

/** Test a draft before saving; `id` reuses the stored password when `password` is omitted. */
export const testDbConnectionSchema = createDbConnectionSchema
  .omit({ key: true, name: true, description: true })
  .extend({ id: z.uuid().optional(), password: z.string().max(1_024).nullable().optional() });

export const databaseErrorSchema = z.object({
  kind: z.string(),
  dbCode: z.string().nullable(),
  message: z.string(),
});

export const dbTestResultSchema = z.object({
  ok: z.boolean(),
  version: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  error: databaseErrorSchema.nullable(),
});
export type DbTestResult = z.infer<typeof dbTestResultSchema>;

export const catalogSchema = z.object({
  defaultSchema: z.string(),
  schemas: z.array(z.string()),
  tables: z.array(
    z.object({
      schema: z.string(),
      name: z.string(),
      kind: z.enum(['table', 'view']),
      columns: z.array(
        z.object({ name: z.string(), type: z.string(), nullable: z.boolean(), key: z.boolean() }),
      ),
    }),
  ),
  procedures: z.array(
    z.object({
      schema: z.string(),
      name: z.string(),
      kind: z.enum(['procedure', 'function']),
      returns: z.string().nullable(),
      parameters: z.array(
        z.object({ name: z.string(), type: z.string(), direction: z.enum(['in', 'out', 'inout']) }),
      ),
    }),
  ),
  truncated: z.boolean(),
});
export type CatalogDto = z.infer<typeof catalogSchema>;

/** A connection as modules show it in pickers (no credentials, no host details beyond the name). */
export const dbConnectionSummarySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  engine: dbEngineSchema,
  database: z.string().nullable(),
  readOnly: z.boolean(),
  enabled: z.boolean(),
  status: z.enum(['unknown', 'ok', 'error']),
});
export type DbConnectionSummary = z.infer<typeof dbConnectionSummarySchema>;

/** A task type Scheduled Jobs can run (`ctx.taskTypes.list`). */
export const taskTypeInfoSchema = z.object({
  type: z.string(),
  moduleId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  permission: z.string(),
  configSchema: z.unknown(),
});
export type TaskTypeInfoDto = z.infer<typeof taskTypeInfoSchema>;

/**
 * Props of the `scheduler.task-config.<type>` slots (e.g. `scheduler.task-config.etl.pipeline`): the module
 * that owns the task type contributes its config editor; types without one get a JSON editor.
 */
export interface TaskConfigSlotProps {
  type: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** Field errors from the last save, keyed by config path. */
  errors?: Record<string, string>;
  disabled?: boolean;
}
