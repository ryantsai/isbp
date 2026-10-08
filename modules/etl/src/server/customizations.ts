import { apiClients } from '@isbp/db/schema';
import {
  type CustomizationHandler,
  type CustomizationIssue,
  ErrorCodes,
  HttpError,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  createEndpointSchema,
  endpointDefinitionSchema,
  pipelineInputSchema,
  slugSchema,
} from '../contracts';
import {
  CAST_TYPES,
  ENDPOINT_KINDS,
  type EndpointDefinition,
  endpointHref,
  PARAM_TYPES,
  pipelineHref,
  RESPONSE_SHAPES,
  WATERMARK_PARAM,
  WRITE_MODES,
} from '../model';
import { UUID_RE } from './access';
import { endpoints, pipelines } from './schema';
import { services } from './services';

/** Slugs the endpoint routes reserve (see `EndpointService`). */
const RESERVED_SLUGS = new Set(['openapi', 'connections', 'clients', 'new']);

/**
 * A service's refusal as issues: `VALIDATION_FAILED` lists them, other codes become one issue at the path the
 * service named (or `path`).
 */
function refusal(err: unknown, path = ''): CustomizationIssue[] {
  if (!(err instanceof HttpError)) throw err;
  const d = (err.details ?? {}) as { issues?: { path: string; message: string }[]; path?: string };
  if (d.issues?.length) return d.issues.map((i) => ({ path: i.path, message: i.message, code: 'invalid' }));
  return [{ path: d.path ?? path, message: err.message, code: err.code.toLowerCase() }];
}

/** Data connections, for guides (never their credentials). */
async function dataConnections(ctx: ModuleContext) {
  return (await ctx.databases.list({ purpose: 'data', enabledOnly: true })).map((c) => ({
    id: c.id,
    name: c.name,
    engine: c.engine,
    readOnly: c.readOnly,
    maxRows: c.maxRows,
    timeoutMs: c.timeoutMs,
  }));
}

/** Stands in for an id in examples when there is nothing live to point at. */
const SAMPLE_ID = '0190a0a0-0000-7000-8000-000000000001';

/* ───────────────────────────── etl.pipeline ───────────────────────────── */

const p = pipelineInputSchema.shape;

/** The pipeline form without `enabled`: a disabled pipeline is an archived one. */
export const pipelineValueSchema = z.object({
  name: p.name.describe('Unique pipeline name (case-insensitive)'),
  description: p.description.describe('What the pipeline loads and why'),
  ownerId: p.ownerId.describe('User id of the person responsible for it, or null'),
  source: p.source.describe(
    'A data connection and one SELECT with :name parameters; `params` gives each parameter a static value (:watermark comes from the last run)',
  ),
  incremental: p.incremental.describe(
    'Incremental loads: the result `column` whose highest value becomes the next :watermark, and the `initial` watermark. null loads everything on every run',
  ),
  target: p.target.describe(
    'A writable data connection, `schema` (null = the connection’s default), an existing `table`, `mode` insert, upsert (on `keys`) or replace',
  ),
  mappings: p.mappings.describe(
    'Source column → target column, with a transform: none, trim, upper, lower, cast:<type>, default:<value> or constant:<value>',
  ),
  batchSize: p.batchSize.describe('Rows per batch'),
});
export type PipelineValue = z.infer<typeof pipelineValueSchema>;

async function pipelineRow(ctx: ModuleContext, id: string) {
  if (!UUID_RE.test(id)) return null;
  const [row] = await ctx.db.select().from(pipelines).where(eq(pipelines.id, id));
  return row ?? null;
}

/** `etl.pipeline`: an ETL pipeline, live on apply; archiving disables it. */
export const pipelineCustomization: CustomizationHandler<PipelineValue> = {
  schema: pipelineValueSchema,

  async guide(ctx) {
    const connections = await dataConnections(ctx);
    const source = connections[0]?.id ?? SAMPLE_ID;
    const target = connections.find((c) => !c.readOnly)?.id ?? SAMPLE_ID;
    return {
      instructions: [
        'A pipeline copies the rows of one SELECT on a source data connection into a table of a target data connection, batch by batch, in one transaction per run (a failed run rolls back).',
        `The source SQL is one statement with :name parameters; give each one a value in source.params. For incremental loads, filter on :${WATERMARK_PARAM} (e.g. "where updated_at > :${WATERMARK_PARAM}") and set incremental.column to the result column whose highest value becomes the next watermark.`,
        'The target table must exist in the target connection’s catalog; the target connection must not be read-only. mode insert appends, upsert updates rows matching `keys` (the target’s key columns, required for upsert), replace empties the table first.',
        'Every mapping names a source column and a target column (each target column once); key columns must be mapped. Transforms: none, trim, upper, lower, cast:<type>, default:<value> (when the value is empty), constant:<value> (ignores the source).',
        'Applying makes the pipeline live (enabled; Scheduled Jobs can run it with the etl.pipeline task type). Archive disables it; restore enables it again.',
      ].join('\n'),
      reference: {
        dataConnections: connections,
        writeModes: WRITE_MODES,
        castTypes: CAST_TYPES,
        watermarkParameter: WATERMARK_PARAM,
      },
      examples: [
        {
          description: 'Load changed customers from the CRM into the warehouse every run',
          value: {
            name: 'CRM customers to warehouse',
            description: 'Keeps dim_customer in step with the CRM',
            ownerId: null,
            source: {
              connectionId: source,
              sql: `select code, name, region, updated_at from crm.customers where updated_at > :${WATERMARK_PARAM} order by updated_at`,
              params: {},
            },
            incremental: { column: 'updated_at', initial: '2026-01-01T00:00:00Z' },
            target: {
              connectionId: target,
              schema: 'dw',
              table: 'dim_customer',
              mode: 'upsert',
              keys: ['customer_code'],
            },
            mappings: [
              { source: 'code', target: 'customer_code', transform: 'trim' },
              { source: 'name', target: 'name', transform: 'none' },
              { source: 'region', target: 'region', transform: 'upper' },
            ],
            batchSize: 500,
          },
        },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx) {
    const pattern = q ? likePattern(q) : null;
    const rows = await ctx.db
      .select({
        id: pipelines.id,
        name: pipelines.name,
        description: pipelines.description,
        enabled: pipelines.enabled,
      })
      .from(pipelines)
      .where(
        and(
          includeArchived ? undefined : eq(pipelines.enabled, true),
          pattern
            ? or(
                ilike(pipelines.name, pattern),
                ilike(pipelines.description, pattern),
                ilike(pipelines.targetTable, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(sql`lower(${pipelines.name})`, asc(pipelines.id))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      label: r.name,
      description: r.description,
      archived: !r.enabled,
      href: pipelineHref(r.id),
    }));
  },

  async get(id, ctx) {
    const row = await pipelineRow(ctx, id);
    if (!row) return null;
    return {
      id: row.id,
      label: row.name,
      description: row.description,
      archived: !row.enabled,
      href: pipelineHref(row.id),
      value: {
        name: row.name,
        description: row.description,
        ownerId: row.ownerId,
        ...services(ctx).pipelines.definitionOf(row),
      },
    };
  },

  async check({ op, id, value }, ctx) {
    if ((op !== 'create' && op !== 'update') || !value) return [];
    const issues: CustomizationIssue[] = [];
    const [other] = await ctx.db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(
        and(sql`lower(${pipelines.name}) = lower(${value.name})`, id ? ne(pipelines.id, id) : undefined),
      );
    if (other)
      issues.push({ path: 'name', message: 'A pipeline with this name exists', code: 'duplicate_name' });
    // Connections, owner, the target table in the target's catalog and the mappings, as the service checks them.
    try {
      await services(ctx).pipelines.validate({ ...value, enabled: true });
    } catch (err) {
      issues.push(...refusal(err));
    }
    return issues;
  },

  async apply({ op, id, value }, ctx, auth) {
    const s = services(ctx).pipelines;
    switch (op) {
      case 'create':
        return { id: (await s.create({ ...value!, enabled: true }, auth)).id };
      case 'update':
        await s.update(id!, value!);
        return { id: id! };
      case 'archive':
      case 'restore':
        await s.update(id!, { enabled: op === 'restore' });
        return { id: id! };
      case 'delete':
        await s.remove(id!);
        return { id: id! };
    }
  },
};

/* ───────────────────────────── etl.endpoint ───────────────────────────── */

const e = createEndpointSchema.shape;

/** An endpoint as people edit it: names, the draft definition and who may call it. */
export const endpointValueSchema = z.object({
  name: e.name.describe('Display name'),
  slug: slugSchema.describe(
    'URL name (/api/v1/etl/data/<slug>): lower-case letters, digits and single dashes. Fixed once a version is published',
  ),
  description: e.description.describe('What the API answers, for the people who call it'),
  definition: endpointDefinitionSchema.describe(
    'The draft: method, data connection, kind query (one SQL statement with :name parameters) or procedure, parameter definitions, limits and caching',
  ),
  allowUsers: z.boolean().default(true).describe('Signed-in people holding etl.endpoints.invoke may call it'),
  allowedClients: z.array(z.uuid()).max(200).default([]).describe('Ids of the API clients that may call it'),
  rateLimitPerMinute: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .nullable()
    .default(null)
    .describe('Calls per minute per caller; null = the module default'),
});
export type EndpointValue = z.infer<typeof endpointValueSchema>;

async function endpointRow(ctx: ModuleContext, id: string) {
  if (!UUID_RE.test(id)) return null;
  const [row] = await ctx.db.select().from(endpoints).where(eq(endpoints.id, id));
  return row ?? null;
}

/**
 * `etl.endpoint`: a Data API. Applying saves the draft and its access settings only: a person tests the draft
 * and publishes it as a version in Data APIs.
 */
export const endpointCustomization: CustomizationHandler<EndpointValue> = {
  schema: endpointValueSchema,

  async guide(ctx) {
    const [connections, clients, defaultRate] = await Promise.all([
      dataConnections(ctx),
      ctx.db
        .select({ id: apiClients.id, name: apiClients.name, clientId: apiClients.clientId })
        .from(apiClients)
        .where(isNull(apiClients.revokedAt))
        .orderBy(asc(apiClients.name))
        .limit(200),
      ctx.settings.get<number>('defaultRateLimitPerMinute'),
    ]);
    return {
      instructions: [
        'A Data API answers GET or POST /api/v1/etl/data/<slug> from one parameterized SQL statement (kind "query") or a stored procedure or function (kind "procedure") on a data connection.',
        'Applying SAVES THE DRAFT ONLY. It never tests or publishes: a person runs the draft in the test console and publishes it as a version in Data APIs, and callers only ever reach published versions.',
        'SQL uses :name placeholders bound by the driver; define every placeholder in definition.params (name, type, required, default, min/max, minLength/maxLength, pattern, enum, description, example). Never build SQL from values. One statement only.',
        'A statement that changes data needs definition.allowsWrites (refused on read-only connections). maxRows and timeoutMs may not exceed the connection’s limits. responseShape "single" returns one object instead of a list.',
        'allowUsers lets signed-in people with etl.endpoints.invoke call it; allowedClients lists API client ids. The slug is fixed once a version is published.',
      ].join('\n'),
      reference: {
        dataConnections: connections,
        apiClients: clients,
        kinds: ENDPOINT_KINDS,
        paramTypes: PARAM_TYPES,
        responseShapes: RESPONSE_SHAPES,
        defaultRateLimitPerMinute: Number(defaultRate) || 120,
      },
      examples: [
        {
          description: 'Customers of one region, for the sales dashboard',
          value: {
            name: 'Customers by region',
            slug: 'customers-by-region',
            description: 'Active customers of one sales region',
            definition: {
              method: 'GET',
              connectionId: connections[0]?.id ?? SAMPLE_ID,
              kind: 'query',
              sql: 'select code, name, region from crm.customers where region = :region order by name',
              params: [
                {
                  name: 'region',
                  type: 'string',
                  required: true,
                  enum: ['north', 'south', 'east'],
                  description: 'Sales region',
                },
              ],
              responseShape: 'rows',
              maxRows: 1000,
              cacheTtlSeconds: 60,
            },
            allowUsers: true,
            allowedClients: [],
            rateLimitPerMinute: null,
          },
        },
      ],
    };
  },

  async list({ q, limit }, ctx) {
    const pattern = q ? likePattern(q) : null;
    const rows = await ctx.db
      .select({
        id: endpoints.id,
        slug: endpoints.slug,
        name: endpoints.name,
        description: endpoints.description,
      })
      .from(endpoints)
      .where(
        pattern
          ? or(
              ilike(endpoints.name, pattern),
              ilike(endpoints.slug, pattern),
              ilike(endpoints.description, pattern),
            )
          : undefined,
      )
      .orderBy(asc(endpoints.slug))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      label: r.name,
      description: r.description,
      href: endpointHref(r.slug),
    }));
  },

  async get(id, ctx) {
    const row = await endpointRow(ctx, id);
    if (!row) return null;
    return {
      id: row.id,
      label: row.name,
      description: row.description,
      href: endpointHref(row.slug),
      value: {
        name: row.name,
        slug: row.slug,
        description: row.description,
        definition: row.draft,
        allowUsers: row.allowUsers,
        allowedClients: row.allowedClients,
        rateLimitPerMinute: row.rateLimitPerMinute,
      },
    };
  },

  async check({ op, id, value }, ctx) {
    if ((op !== 'create' && op !== 'update') || !value) return [];
    const issues: CustomizationIssue[] = [];
    const current = id ? await endpointRow(ctx, id) : null;
    if (current && current.latestVersion !== null && value.slug !== current.slug)
      issues.push({
        path: 'slug',
        message: 'The slug is part of published URLs and cannot change after the first version',
        code: 'immutable',
      });
    else if (RESERVED_SLUGS.has(value.slug))
      issues.push({ path: 'slug', message: 'This slug is reserved', code: 'reserved' });
    else {
      const [other] = await ctx.db
        .select({ id: endpoints.id })
        .from(endpoints)
        .where(and(eq(endpoints.slug, value.slug), current ? ne(endpoints.id, current.id) : undefined));
      if (other) issues.push({ path: 'slug', message: 'This slug is already used', code: 'duplicate_slug' });
    }
    try {
      await services(ctx).endpoints.checkDraft(value.definition as EndpointDefinition, 'definition');
    } catch (err) {
      const path =
        err instanceof HttpError && err.code === ErrorCodes.WRITES_NOT_ALLOWED
          ? 'definition.allowsWrites'
          : 'definition.connectionId';
      issues.push(...refusal(err, path));
    }
    const wanted = [...new Set(value.allowedClients)];
    if (wanted.length) {
      const known = new Set(
        (
          await ctx.db.select({ id: apiClients.id }).from(apiClients).where(inArray(apiClients.id, wanted))
        ).map((c) => c.id),
      );
      value.allowedClients.forEach((clientId, i) => {
        if (!known.has(clientId))
          issues.push({ path: `allowedClients.${i}`, message: 'Unknown API client', code: 'unknown_client' });
      });
    }
    return issues;
  },

  async apply({ op, id, value }, ctx, auth) {
    const s = services(ctx).endpoints;
    if (op === 'delete') {
      await s.remove(id!);
      return { id: id! };
    }
    const v = value!;
    const settings = {
      draft: v.definition,
      allowUsers: v.allowUsers,
      allowedClients: v.allowedClients,
      rateLimitPerMinute: v.rateLimitPerMinute,
    };
    if (op === 'create') {
      const row = await s.create(
        {
          name: v.name,
          slug: v.slug,
          description: v.description,
          method: v.definition.method,
          connectionId: v.definition.connectionId,
          kind: v.definition.kind,
        },
        auth,
      );
      await s.update(row.id, settings);
      return { id: row.id };
    }
    await s.update(id!, { name: v.name, slug: v.slug, description: v.description, ...settings });
    return { id: id! };
  },
};
