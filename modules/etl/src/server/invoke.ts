import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  type ModuleRouter,
} from '@isbp/sdk/server';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  buildOpenApi,
  canonicalJson,
  type ColumnInfo,
  dataUrl,
  latestCallable,
  maskParams,
  MAX_CACHE_BYTES,
  type OpenApiEndpoint,
  parseParams,
  toCsv,
} from '../model';
import { ENDPOINT_TYPE, ENDPOINTS_INVOKE, invalid, mayInvoke, sha256 } from './access';
import { errorInfo } from './endpoints';
import { calls, endpoints, endpointVersions } from './schema';
import { services } from './services';

/** What the execution log records about one call; written after the response is sent. */
interface PendingCall {
  endpointId: string;
  version: number | null;
  callerType: 'user' | 'client';
  userId: string | null;
  clientId: string | null;
  callerName: string;
  errorCode: string | null;
  errorMessage: string | null;
  rows: number | null;
  cached: boolean;
  params: Record<string, unknown>;
}

interface CachedResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  durationMs: number;
}

const pending = new WeakMap<FastifyRequest, PendingCall>();

/** `Accept: text/csv` (preferred over JSON when both are listed). */
function wantsCsv(accept: string | undefined): boolean {
  if (!accept) return false;
  const csv = accept.indexOf('text/csv');
  if (csv === -1) return false;
  const json = accept.indexOf('application/json');
  return json === -1 || csv < json;
}

const GENERIC_DB_ERROR =
  'The database could not answer this request. Give the request id to the owner of this Data API.';

/**
 * Runs one Data API call: access (API client allow-list, or people with `etl.endpoints.invoke` globally or on
 * the endpoint), version (latest or pinned; deprecated → `Deprecation`, retired → 410), method, rate limit,
 * parameter validation, cache, execution, then JSON or CSV.
 */
async function handle(
  ctx: ModuleContext,
  req: FastifyRequest,
  reply: FastifyReply,
  slug: string,
  pinned: number | null,
) {
  const auth = req.auth;
  const [ep] = await ctx.db.select().from(endpoints).where(eq(endpoints.slug, slug)).limit(1);
  if (!ep) throw httpErrors.notFound('Data API not found');
  const log: PendingCall = {
    endpointId: ep.id,
    version: null,
    callerType: auth.client ? 'client' : 'user',
    userId: auth.client ? null : (auth.user?.id ?? null),
    clientId: auth.client?.id ?? null,
    callerName: auth.client?.name ?? auth.user?.displayName ?? auth.principal.name,
    errorCode: null,
    errorMessage: null,
    rows: null,
    cached: false,
    params: {},
  };
  pending.set(req, log);

  if (auth.client) {
    if (!ep.allowedClients.includes(auth.client.id)) {
      await ctx.audit.record({
        action: 'etl.endpoint.access_denied',
        category: 'security',
        outcome: 'denied',
        entityType: ENDPOINT_TYPE,
        entityId: ep.id,
        entityLabel: ep.name,
        metadata: { slug, client: auth.client.clientId },
      });
      throw httpErrors.forbidden('This API client is not allowed to call this Data API');
    }
  } else {
    if (!ep.allowUsers) throw httpErrors.forbidden('This Data API is only for API clients');
    auth.require(ENDPOINTS_INVOKE, { recordType: ENDPOINT_TYPE, recordId: ep.id });
  }

  const versions = await ctx.db
    .select()
    .from(endpointVersions)
    .where(eq(endpointVersions.endpointId, ep.id))
    .orderBy(desc(endpointVersions.version));
  if (!versions.length)
    throw new HttpError(404, ErrorCodes.ENDPOINT_NOT_PUBLISHED, 'This Data API has no published version yet');
  const latest = latestCallable(versions);
  const v = pinned === null ? latest : versions.find((x) => x.version === pinned);
  if (pinned !== null && !v) throw httpErrors.notFound(`Version ${pinned} does not exist`);
  if (!v || v.status === 'retired')
    throw new HttpError(410, ErrorCodes.ENDPOINT_RETIRED, `This version of ${slug} is retired`, {
      latest: latest?.version ?? null,
    });
  log.version = v.version;
  const def = v.definition;
  if (v.status === 'deprecated') {
    reply.header('Deprecation', 'true');
    if (latest && latest.version !== v.version)
      reply.header('Link', `<${dataUrl(slug, latest.version)}>; rel="latest-version"`);
  }

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (method !== def.method) {
    reply.header('Allow', def.method);
    throw new HttpError(405, ErrorCodes.BAD_REQUEST, `Call this Data API with ${def.method}`, {
      method: def.method,
    });
  }

  const limit = ep.rateLimitPerMinute ?? (await services(ctx).endpoints.defaultRateLimit());
  const callerKey = auth.client ? `c:${auth.client.id}` : `u:${auth.user?.id ?? 'anon'}`;
  const rl = await ctx.cache.rateLimit(`${ep.id}:${callerKey}`, limit, 60);
  reply.header('RateLimit-Limit', String(limit));
  reply.header('RateLimit-Remaining', String(rl.remaining));
  reply.header('RateLimit-Reset', String(rl.resetSeconds));
  if (!rl.allowed) {
    reply.header('Retry-After', String(Math.max(1, rl.resetSeconds)));
    throw new HttpError(429, ErrorCodes.RATE_LIMITED, `Rate limit of ${limit} calls per minute reached`, {
      limit,
      retryAfter: Math.max(1, rl.resetSeconds),
    });
  }

  const body = req.body;
  if (
    method === 'POST' &&
    body !== undefined &&
    body !== null &&
    (typeof body !== 'object' || Array.isArray(body))
  )
    throw invalid(
      [{ path: '(body)', message: 'Send the parameters as a JSON object' }],
      'Invalid parameters',
    );
  const input = (method === 'POST' ? (body ?? {}) : (req.query ?? {})) as Record<string, unknown>;
  const parsed = parseParams(def.params, input);
  if (!parsed.success) throw invalid(parsed.issues, 'Invalid parameters');
  log.params = maskParams(parsed.data, def.params);

  const ttl = def.cacheTtlSeconds;
  const key = ttl > 0 ? `ep:${ep.id}:v${v.version}:${sha256(canonicalJson(parsed.data))}` : null;
  let result = key ? await ctx.cache.get<CachedResult>(key).catch(() => null) : null;
  log.cached = result !== null;
  if (!result) {
    try {
      const r = await services(ctx).endpoints.execute(def, parsed.data);
      result = { columns: r.columns, rows: r.rows, truncated: r.truncated, durationMs: r.durationMs };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      const info = errorInfo(err);
      log.errorMessage = `${info.kind}${info.dbCode ? ` ${info.dbCode}` : ''}: ${info.message}`.slice(
        0,
        4_000,
      );
      // The connection behind a published version was deleted: a server-side problem, not a missing API.
      const failure =
        err.statusCode === 404
          ? new HttpError(
              422,
              ErrorCodes.DATABASE_ERROR,
              'The database connection of this Data API no longer exists',
              {
                kind: 'not_found',
                dbCode: null,
                message: 'Database connection not found',
              },
            )
          : err;
      if (auth.client && failure.code === ErrorCodes.DATABASE_ERROR)
        throw new HttpError(422, ErrorCodes.DATABASE_ERROR, GENERIC_DB_ERROR);
      throw failure;
    }
    if (key) {
      const size = Buffer.byteLength(JSON.stringify(result));
      if (size <= MAX_CACHE_BYTES) await ctx.cache.set(key, result, ttl).catch(() => undefined);
    }
  }
  if (key) reply.header('X-Cache', log.cached ? 'HIT' : 'MISS');
  log.rows = result.rows.length;

  if (def.responseShape === 'single' && !result.rows.length) throw httpErrors.notFound('No row matched');
  if (wantsCsv(req.headers.accept)) {
    const rows = def.responseShape === 'single' ? result.rows.slice(0, 1) : result.rows;
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${slug}-v${v.version}.csv"`)
      .send(
        toCsv(
          result.columns.map((c) => c.name),
          rows,
        ),
      );
  }
  return reply.send({
    data: def.responseShape === 'single' ? result.rows[0] : result.rows,
    meta: {
      rows: def.responseShape === 'single' ? 1 : result.rows.length,
      truncated: result.truncated,
      version: v.version,
      durationMs: result.durationMs,
      cached: log.cached,
    },
  });
}

/** Endpoints a caller may call, with their non-retired versions (for the OpenAPI document). */
export async function callableEndpoints(
  ctx: ModuleContext,
  auth: AuthContext | null,
): Promise<OpenApiEndpoint[]> {
  const rows = await ctx.db.select().from(endpoints).where(isNotNull(endpoints.latestVersion));
  const visible = auth
    ? rows.filter((r) =>
        auth.client ? r.allowedClients.includes(auth.client.id) : r.allowUsers && mayInvoke(auth, r.id),
      )
    : rows;
  if (!visible.length) return [];
  const versions = await ctx.db
    .select()
    .from(endpointVersions)
    .where(
      and(
        inArray(
          endpointVersions.endpointId,
          visible.map((r) => r.id),
        ),
        sql`${endpointVersions.status} <> 'retired'`,
      ),
    );
  return visible.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: r.description,
    versions: versions
      .filter((v) => v.endpointId === r.id)
      .map((v) => ({ version: v.version, status: v.status, definition: v.definition, columns: v.columns })),
  }));
}

export const openApiInfo = { title: 'IS Big Platform – Data APIs', version: '1.0.0' };

/**
 * Invocation routes (`/data/:slug`, `/data/:slug/v<N>`) and the callers' OpenAPI document. The execution
 * log row is written in `onResponse`, after the response went out.
 */
export function invocationRoutes(app: ModuleRouter, ctx: ModuleContext) {
  app.addHook('onResponse', async (req, reply) => {
    const log = pending.get(req);
    if (!log) return;
    pending.delete(req);
    const status = reply.statusCode;
    try {
      await ctx.db.insert(calls).values({
        endpointId: log.endpointId,
        version: log.version,
        callerType: log.callerType,
        userId: log.userId,
        clientId: log.clientId,
        callerName: log.callerName.slice(0, 200),
        status,
        errorCode: status >= 400 ? (log.errorCode ?? 'ERROR') : null,
        errorMessage: status >= 400 ? log.errorMessage : null,
        durationMs: Math.max(0, Math.round(reply.elapsedTime)),
        rows: status < 400 ? log.rows : null,
        cached: log.cached,
        params: log.params,
        requestId: String(req.id).slice(0, 64),
      });
    } catch (err) {
      ctx.logger.error({ err, endpointId: log.endpointId }, 'failed to write the Data API execution log');
    }
  });

  const run = async (req: FastifyRequest, reply: FastifyReply, slug: string, version: string | null) => {
    let pinned: number | null = null;
    if (version !== null) {
      const m = /^v([1-9]\d{0,5})$/.exec(version);
      if (!m) throw httpErrors.notFound('Use /data/<slug>/v<number> to pin a version');
      pinned = Number(m[1]);
    }
    try {
      return await handle(ctx, req, reply, slug, pinned);
    } catch (err) {
      const log = pending.get(req);
      if (log && err instanceof HttpError) {
        log.errorCode = err.code;
        log.errorMessage ??= err.message.slice(0, 4_000);
      } else if (log) {
        log.errorCode = ErrorCodes.INTERNAL;
        log.errorMessage ??= String((err as Error)?.message ?? err).slice(0, 4_000);
      }
      throw err;
    }
  };

  const tags = ['Data API calls'];
  const config = { permission: ENDPOINTS_INVOKE, scoped: true };
  const summary = 'Call a Data API (parameters in the query string for GET, a JSON object for POST)';
  for (const method of ['GET', 'POST'] as const) {
    app.route({
      method,
      url: '/data/:slug',
      config,
      schema: { tags, summary: `${summary} — latest version` },
      handler: (req, reply) => run(req, reply, (req.params as { slug: string }).slug, null),
    });
    app.route({
      method,
      url: '/data/:slug/:version',
      config,
      schema: { tags, summary: `${summary} — pinned version (v1, v2, …)` },
      handler: (req, reply) => {
        const p = req.params as { slug: string; version: string };
        return run(req, reply, p.slug, p.version);
      },
    });
  }

  app.get(
    '/openapi.json',
    {
      config,
      schema: {
        tags,
        summary: 'OpenAPI 3.1 of the Data APIs you may call (published, non-retired versions)',
      },
    },
    async (req) => buildOpenApi(await callableEndpoints(ctx, req.auth), openApiInfo),
  );
}
