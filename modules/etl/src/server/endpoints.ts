import { apiClients } from '@isbp/db/schema';
import {
  bindStatement,
  type DbEngine,
  dialectFor,
  parameterNames,
  statementCount,
  writeKeywords,
} from '@isbp/sql';
import {
  type AuthContext,
  type DbConnectionInfo,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
  type Page,
  type SqlResult,
  type SqlValue,
} from '@isbp/sdk/server';
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  ConnectionRef,
  createEndpointSchema,
  EndpointDetailOut,
  endpointQuerySchema,
  EndpointStatsOut,
  EndpointSummaryOut,
  TestResult,
  testRequestSchema,
  updateEndpointSchema,
  VersionAction,
  VersionOut,
} from '../contracts';
import { endpointDefinitionSchema } from '../contracts';
import {
  type EndpointDefinition,
  endpointStatusOf,
  type ParamValue,
  paramDrift,
  paramTarget,
  parseParams,
  type StatsPeriod,
  VERSION_TRANSITIONS,
  type VersionStatus,
} from '../model';
import {
  connectionMap,
  connectionRef,
  dataConnection,
  definitionHash,
  ENDPOINT_TYPE,
  ENDPOINTS_MANAGE,
  invalid,
  mayInvoke,
  peopleById,
  UUID_RE,
} from './access';
import { calls, endpoints, endpointVersions } from './schema';

export type EndpointRow = typeof endpoints.$inferSelect;
export type VersionRow = typeof endpointVersions.$inferSelect;

/** Slugs that would be shadowed by static routes under `/endpoints/…`. */
const RESERVED_SLUGS = new Set(['openapi', 'connections', 'clients', 'new']);

const TEST_MAX_ROWS = 500;

/** Kind, code and message of a failed execution (database errors keep the server's code and message). */
export function errorInfo(err: HttpError): { kind: string; dbCode: string | null; message: string } {
  const d = (err.details ?? {}) as { kind?: unknown; dbCode?: unknown; message?: unknown };
  return {
    kind: typeof d.kind === 'string' ? d.kind : err.code.toLowerCase(),
    dbCode: typeof d.dbCode === 'string' ? d.dbCode : null,
    message: typeof d.message === 'string' ? d.message : err.message,
  };
}

/**
 * Data API endpoints: drafts, tests, versions and their statistics. The invocation route
 * (`invoke.ts`) and the AI tools use the same execution path (`execute`).
 */
export class EndpointService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── lookups ───────────── */

  async resolve(ref: string): Promise<EndpointRow> {
    const [row] = await this.ctx.db
      .select()
      .from(endpoints)
      .where(UUID_RE.test(ref) ? eq(endpoints.id, ref) : eq(endpoints.slug, ref))
      .limit(1);
    if (!row) throw httpErrors.notFound('Data API not found');
    return row;
  }

  versions(endpointId: string): Promise<VersionRow[]> {
    return this.ctx.db
      .select()
      .from(endpointVersions)
      .where(eq(endpointVersions.endpointId, endpointId))
      .orderBy(desc(endpointVersions.version));
  }

  /* ───────────── list & detail ───────────── */

  async list(query: z.infer<typeof endpointQuerySchema>): Promise<Page<EndpointSummaryOut>> {
    const has = (status: VersionStatus) =>
      sql`exists (select 1 from ${endpointVersions} v where v.endpoint_id = ${endpoints.id} and v.status = ${status})`;
    const conds: SQL[] = [];
    if (query.q) {
      const p = likePattern(query.q);
      conds.push(or(ilike(endpoints.name, p), ilike(endpoints.slug, p), ilike(endpoints.description, p))!);
    }
    if (query.connection) conds.push(eq(endpoints.connectionId, query.connection));
    switch (query.status) {
      case 'draft':
        conds.push(isNull(endpoints.latestVersion));
        break;
      case 'published':
        conds.push(has('published'));
        break;
      case 'deprecated':
        conds.push(sql`not ${has('published')} and ${has('deprecated')}`);
        break;
      case 'retired':
        conds.push(
          sql`${endpoints.latestVersion} is not null and not ${has('published')} and not ${has('deprecated')}`,
        );
        break;
    }
    const where = conds.length ? and(...conds) : undefined;
    const desc_ = query.sort?.startsWith('-');
    const key = query.sort?.replace(/^-/, '');
    const column =
      key === 'slug' ? endpoints.slug : key === 'updatedAt' ? endpoints.updatedAt : endpoints.name;
    const [{ total } = { total: 0 }] = await this.ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(endpoints)
      .where(where);
    const rows = await this.ctx.db
      .select()
      .from(endpoints)
      .where(where)
      .orderBy(desc_ ? desc(column) : asc(column), asc(endpoints.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { items: await this.summaries(rows), total, page: query.page, pageSize: query.pageSize };
  }

  async summaries(rows: EndpointRow[]): Promise<EndpointSummaryOut[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [conns, versions, stats] = await Promise.all([
      connectionMap(this.ctx),
      this.ctx.db
        .select({
          endpointId: endpointVersions.endpointId,
          version: endpointVersions.version,
          status: endpointVersions.status,
          definition: endpointVersions.definition,
        })
        .from(endpointVersions)
        .where(inArray(endpointVersions.endpointId, ids)),
      this.ctx.db
        .select({
          endpointId: calls.endpointId,
          calls: sql<number>`count(*)::int`,
          errors: sql<number>`(count(*) filter (where ${calls.status} >= 400))::int`,
        })
        .from(calls)
        .where(and(inArray(calls.endpointId, ids), sql`${calls.createdAt} > now() - interval '24 hours'`))
        .groupBy(calls.endpointId),
    ]);
    const byEndpoint = new Map<string, typeof versions>();
    for (const v of versions) byEndpoint.set(v.endpointId, [...(byEndpoint.get(v.endpointId) ?? []), v]);
    const statsBy = new Map(stats.map((s) => [s.endpointId, s]));
    return rows.map((r) => {
      const vs = byEndpoint.get(r.id) ?? [];
      const latest = vs.find((v) => v.version === r.latestVersion);
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        method: r.draft.method,
        kind: r.draft.kind,
        connection: this.connection(r, conns),
        status: endpointStatusOf(vs.map((v) => v.status)),
        latestVersion: r.latestVersion,
        draftChanged: latest ? definitionHash(latest.definition) !== definitionHash(r.draft) : true,
        calls24h: statsBy.get(r.id)?.calls ?? 0,
        errors24h: statsBy.get(r.id)?.errors ?? 0,
        updatedAt: r.updatedAt,
      };
    });
  }

  private connection(r: EndpointRow, conns: Map<string, DbConnectionInfo>): ConnectionRef {
    const ref = connectionRef(r.connectionId, conns);
    return r.connectionMissing ? { ...ref, status: 'missing' } : ref;
  }

  async detail(ref: string | EndpointRow, auth: AuthContext): Promise<EndpointDetailOut> {
    const row = typeof ref === 'string' ? await this.resolve(ref) : ref;
    const [summary] = await this.summaries([row]);
    const versions = await this.versions(row.id);
    const people = await peopleById(this.ctx, [row.createdBy, ...versions.map((v) => v.publishedBy)]);
    const clients = row.allowedClients.length
      ? await this.ctx.db
          .select({
            id: apiClients.id,
            name: apiClients.name,
            clientId: apiClients.clientId,
            revokedAt: apiClients.revokedAt,
          })
          .from(apiClients)
          .where(inArray(apiClients.id, row.allowedClients))
      : [];
    const conn = await this.ctx.databases.get(row.connectionId);
    const tested = row.draftTestedHash !== null && row.draftTestedHash === definitionHash(row.draft);
    const actor = (id: string | null) => {
      const p = id ? people.get(id) : undefined;
      return p ? { id: p.id, name: p.displayName } : null;
    };
    return {
      ...summary!,
      draft: row.draft,
      draftTested: tested,
      draftTestedAt: row.draftTestedAt,
      draftColumns: tested ? row.draftColumns : null,
      writeKeywords: row.draft.kind === 'query' && conn ? writeKeywords(row.draft.sql, conn.engine) : [],
      allowUsers: row.allowUsers,
      allowedClients: clients
        .map((c) => ({ id: c.id, name: c.name, clientId: c.clientId, revoked: c.revokedAt !== null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      rateLimitPerMinute: row.rateLimitPerMinute,
      effectiveRateLimit: row.rateLimitPerMinute ?? (await this.defaultRateLimit()),
      versions: versions.map((v) => this.versionDto(v, actor(v.publishedBy))),
      createdBy: actor(row.createdBy),
      createdAt: row.createdAt,
      viewer: { canManage: auth.can(ENDPOINTS_MANAGE), canInvoke: mayInvoke(auth, row.id) },
    };
  }

  versionDto(v: VersionRow, publishedBy: { id: string; name: string } | null): VersionOut {
    return {
      version: v.version,
      status: v.status,
      definition: v.definition,
      columns: v.columns,
      note: v.note,
      publishedAt: v.publishedAt,
      publishedBy,
      deprecatedAt: v.deprecatedAt,
      retiredAt: v.retiredAt,
    };
  }

  async defaultRateLimit(): Promise<number> {
    const v = Number(await this.ctx.settings.get<number>('defaultRateLimitPerMinute'));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 120;
  }

  /* ───────────── create & edit ───────────── */

  private async assertSlugFree(slug: string, except?: string) {
    if (RESERVED_SLUGS.has(slug)) throw invalid([{ path: 'slug', message: 'This slug is reserved' }]);
    const [other] = await this.ctx.db
      .select({ id: endpoints.id })
      .from(endpoints)
      .where(eq(endpoints.slug, slug))
      .limit(1);
    if (other && other.id !== except) throw invalid([{ path: 'slug', message: 'This slug is already used' }]);
  }

  /**
   * Save-time rules: a `data` connection, limits within the connection's, write keywords need "allows
   * writes", a read-only connection never allows writes, parameter defaults and enums fit their type.
   */
  async checkDraft(def: EndpointDefinition, prefix = 'draft'): Promise<DbConnectionInfo> {
    const conn = await dataConnection(this.ctx, def.connectionId, `${prefix}.connectionId`);
    const issues: { path: string; message: string }[] = [];
    if (def.maxRows > conn.maxRows)
      issues.push({ path: `${prefix}.maxRows`, message: `At most ${conn.maxRows} (the connection's limit)` });
    if (def.timeoutMs > conn.timeoutMs)
      issues.push({
        path: `${prefix}.timeoutMs`,
        message: `At most ${conn.timeoutMs} ms (the connection's limit)`,
      });
    def.params.forEach((p, i) => {
      const values: string[] = [...(p.enum ?? []), ...(p.default !== null ? [p.default] : [])];
      for (const v of values) {
        const r = parseParams([{ ...p, required: true, default: null, enum: null }], { [p.name]: v });
        if (!r.success)
          issues.push({
            path: `${prefix}.params.${i}.${p.default === v ? 'default' : 'enum'}`,
            message: `${v}: ${r.issues[0]?.message ?? 'invalid'}`,
          });
      }
    });
    if (issues.length) throw invalid(issues);
    if (def.kind === 'query' && !def.allowsWrites) {
      const keywords = writeKeywords(def.sql, conn.engine);
      if (keywords.length)
        throw new HttpError(
          422,
          ErrorCodes.WRITES_NOT_ALLOWED,
          `The SQL changes data (${keywords.join(', ')}); turn on "allows writes" to save it`,
          { keywords },
        );
    }
    if (def.allowsWrites && conn.readOnly)
      throw new HttpError(
        409,
        ErrorCodes.CONNECTION_READ_ONLY,
        `Connection ${conn.name} is read-only: this endpoint cannot write`,
      );
    return conn;
  }

  /** Test/publish-time rules: there is something to run, one statement, every `:param` defined. */
  readiness(def: EndpointDefinition, engine: DbEngine) {
    const issues: { path: string; message: string }[] = [];
    if (def.kind === 'query') {
      if (!def.sql.trim()) issues.push({ path: 'draft.sql', message: 'Write the SQL first' });
      else {
        if (statementCount(def.sql, engine) > 1)
          issues.push({ path: 'draft.sql', message: 'One statement per endpoint' });
        const { missing } = paramDrift(
          def.params.map((p) => p.name),
          parameterNames(def.sql, engine),
        );
        for (const name of missing)
          issues.push({ path: 'draft.params', message: `:${name} is used in the SQL but not defined` });
      }
    } else if (!def.procedure)
      issues.push({ path: 'draft.procedure', message: 'Pick a procedure or function' });
    if (issues.length) throw invalid(issues, 'The definition is not ready to run');
  }

  async create(input: z.infer<typeof createEndpointSchema>, auth: AuthContext): Promise<EndpointRow> {
    await this.assertSlugFree(input.slug);
    const draft = endpointDefinitionSchema.parse({
      method: input.method,
      connectionId: input.connectionId,
      kind: input.kind,
    }) as EndpointDefinition;
    await this.checkDraft(draft);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(endpoints)
        .values({
          slug: input.slug,
          name: input.name,
          description: input.description,
          connectionId: draft.connectionId,
          draft,
          createdBy: auth.user?.id ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'etl.endpoint.created',
          entityType: ENDPOINT_TYPE,
          entityId: row!.id,
          entityLabel: row!.name,
          metadata: { slug: row!.slug, kind: draft.kind, connectionId: draft.connectionId },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'etl.endpoint.created',
        { endpointId: row!.id, slug: row!.slug, name: row!.name },
        { tx },
      );
      return row!;
    });
  }

  async update(ref: string, input: z.infer<typeof updateEndpointSchema>): Promise<EndpointRow> {
    const before = await this.resolve(ref);
    const patch: Partial<typeof endpoints.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.slug !== undefined && input.slug !== before.slug) {
      if (before.latestVersion !== null)
        throw new HttpError(
          409,
          ErrorCodes.INVALID_STATE,
          'The slug is part of published URLs and cannot change after the first version',
        );
      await this.assertSlugFree(input.slug, before.id);
      patch.slug = input.slug;
    }
    if (input.draft !== undefined) {
      const draft = input.draft as EndpointDefinition;
      await this.checkDraft(draft);
      patch.draft = draft;
      patch.connectionId = draft.connectionId;
      if (draft.connectionId !== before.connectionId) patch.connectionMissing = false;
    }
    if (input.allowUsers !== undefined) patch.allowUsers = input.allowUsers;
    if (input.allowedClients !== undefined) {
      const wanted = [...new Set(input.allowedClients)];
      const found = wanted.length
        ? await this.ctx.db
            .select({ id: apiClients.id })
            .from(apiClients)
            .where(inArray(apiClients.id, wanted))
        : [];
      const known = new Set(found.map((c) => c.id));
      const unknown = wanted.findIndex((id) => !known.has(id));
      if (unknown !== -1)
        throw invalid([{ path: `allowedClients.${unknown}`, message: 'Unknown API client' }]);
      patch.allowedClients = wanted;
    }
    if (input.rateLimitPerMinute !== undefined) patch.rateLimitPerMinute = input.rateLimitPerMinute;
    const changes = this.ctx.audit.diff(
      {
        name: before.name,
        slug: before.slug,
        description: before.description,
        draft: before.draft,
        allowUsers: before.allowUsers,
        allowedClients: before.allowedClients,
        rateLimitPerMinute: before.rateLimitPerMinute,
      },
      patch as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(endpoints)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(endpoints.id, before.id))
        .returning();
      await this.ctx.audit.record(
        {
          action: 'etl.endpoint.updated',
          entityType: ENDPOINT_TYPE,
          entityId: before.id,
          entityLabel: row!.name,
          changes: changes.draft ? { ...changes, draft: ['…', '…'] } : changes,
          metadata: changes.draft ? { draftChanged: true } : undefined,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'etl.endpoint.updated',
        { endpointId: before.id, slug: row!.slug, changes: Object.keys(changes) },
        { tx },
      );
      return row!;
    });
  }

  async remove(ref: string): Promise<void> {
    const row = await this.resolve(ref);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(endpoints).where(eq(endpoints.id, row.id));
      await this.ctx.records.forget({ type: ENDPOINT_TYPE, id: row.id }, { tx });
      await this.ctx.audit.record(
        {
          action: 'etl.endpoint.deleted',
          entityType: ENDPOINT_TYPE,
          entityId: row.id,
          entityLabel: row.name,
          metadata: { slug: row.slug, latestVersion: row.latestVersion },
        },
        { tx },
      );
      await this.ctx.events.publish('etl.endpoint.deleted', { endpointId: row.id, slug: row.slug }, { tx });
    });
  }

  /* ───────────── execution ───────────── */

  /** Runs a definition with validated values through `ctx.databases` (`data` purpose, read-only unless it writes). */
  execute(
    def: EndpointDefinition,
    values: Record<string, ParamValue>,
    opts: { maxRows?: number; signal?: AbortSignal } = {},
  ): Promise<SqlResult> {
    const maxRows = Math.min(opts.maxRows ?? def.maxRows, def.responseShape === 'single' ? 1 : def.maxRows);
    if (def.kind === 'query') {
      return this.ctx.databases.query(def.connectionId, def.sql, {
        purpose: 'data',
        params: values as Record<string, SqlValue>,
        types: Object.fromEntries(def.params.map((p) => [p.name, p.type])),
        readOnly: !def.allowsWrites,
        maxRows,
        timeoutMs: def.timeoutMs,
        signal: opts.signal,
      });
    }
    if (!def.procedure) throw invalid([{ path: 'draft.procedure', message: 'Pick a procedure or function' }]);
    const args = Object.fromEntries(def.params.map((p) => [paramTarget(p), values[p.name] as SqlValue]));
    return this.ctx.databases.call(def.connectionId, def.procedure, args, {
      purpose: 'data',
      readOnly: !def.allowsWrites,
      maxRows,
      timeoutMs: def.timeoutMs,
      signal: opts.signal,
    });
  }

  /** The statement as the driver receives it (placeholders, never values), for the test console. */
  boundSql(def: EndpointDefinition, engine: DbEngine, values: Record<string, ParamValue>): string {
    const types = Object.fromEntries(def.params.map((p) => [p.name, p.type]));
    if (def.kind === 'query')
      return bindStatement(engine, def.sql, values as Record<string, SqlValue>, types).text;
    const proc = def.procedure;
    if (!proc) return '';
    const d = dialectFor(engine);
    const name = d.qualified(proc.schema, proc.name);
    const inputs = proc.parameters.filter((p) => p.direction !== 'out' && p.name);
    const bound: Record<string, SqlValue> = {};
    const byTarget = new Map(def.params.map((p) => [paramTarget(p), p.name]));
    inputs.forEach((p, i) => {
      const from = byTarget.get(p.name);
      bound[`a${i}`] = from !== undefined ? ((values[from] ?? null) as SqlValue) : null;
    });
    const named = inputs.map((p, i) => `${d.quote(p.name)} => :a${i}`);
    let text: string;
    switch (engine) {
      case 'postgres':
        text =
          proc.kind === 'function'
            ? `SELECT * FROM ${name}(${named.join(', ')})`
            : `CALL ${name}(${named.join(', ')})`;
        break;
      case 'mssql':
        text =
          proc.kind === 'function'
            ? `SELECT * FROM ${name}(${inputs.map((_, i) => `:a${i}`).join(', ')})`
            : `EXEC ${name} ${inputs.map((p, i) => `@${p.name} = :a${i}`).join(', ')}`;
        break;
      case 'mysql':
        text =
          proc.kind === 'function'
            ? `SELECT ${name}(${inputs.map((_, i) => `:a${i}`).join(', ')})`
            : `CALL ${name}(${inputs.map((_, i) => `:a${i}`).join(', ')})`;
        break;
      case 'oracle':
        text = `BEGIN ${name}(${named.join(', ')}); END;`;
        break;
    }
    return bindStatement(engine, text, bound).text;
  }

  /**
   * The test console: runs the draft (or a version) with a parameter form and reports rows, columns, time,
   * the bound SQL and the database's error. A successful draft test records the draft's hash and columns:
   * publishing needs exactly that draft.
   */
  async test(ref: string, input: z.infer<typeof testRequestSchema>): Promise<TestResult> {
    const row = await this.resolve(ref);
    let def = row.draft;
    if (input.version !== undefined) {
      const [v] = await this.ctx.db
        .select()
        .from(endpointVersions)
        .where(and(eq(endpointVersions.endpointId, row.id), eq(endpointVersions.version, input.version)));
      if (!v) throw httpErrors.notFound(`Version ${input.version} not found`);
      def = v.definition;
    }
    const conn = await dataConnection(this.ctx, def.connectionId, 'draft.connectionId');
    this.readiness(def, conn.engine);
    const parsed = parseParams(def.params, input.params);
    if (!parsed.success)
      throw invalid(
        parsed.issues.map((i) => ({ path: `params.${i.path}`, message: i.message })),
        'Invalid parameters',
      );
    let boundSql = '';
    try {
      boundSql = this.boundSql(def, conn.engine, parsed.data);
    } catch {
      /* the run reports it */
    }
    const started = performance.now();
    let result: SqlResult | null = null;
    let error: TestResult['error'] = null;
    try {
      result = await this.execute(def, parsed.data, { maxRows: Math.min(def.maxRows, TEST_MAX_ROWS) });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      error = errorInfo(err);
    }
    const isDraft = input.version === undefined;
    const ok = result !== null;
    const columns = result?.columns ?? [];
    await this.ctx.transaction(async (tx) => {
      if (ok && isDraft)
        await tx
          .update(endpoints)
          .set({ draftTestedHash: definitionHash(def), draftTestedAt: new Date(), draftColumns: columns })
          .where(eq(endpoints.id, row.id));
      await this.ctx.audit.record(
        {
          action: 'etl.endpoint.tested',
          entityType: ENDPOINT_TYPE,
          entityId: row.id,
          entityLabel: row.name,
          outcome: ok ? 'success' : 'failure',
          metadata: {
            version: input.version ?? 'draft',
            rows: result?.rows.length ?? null,
            durationMs: result?.durationMs ?? Math.round(performance.now() - started),
            error: error ? { kind: error.kind, dbCode: error.dbCode } : null,
          },
        },
        { tx },
      );
    });
    return {
      ok,
      version: input.version ?? null,
      columns,
      rows: result?.rows ?? [],
      rowCount: result?.rows.length ?? 0,
      truncated: result?.truncated ?? false,
      durationMs: result?.durationMs ?? Math.round(performance.now() - started),
      boundSql,
      error,
      draftTested: isDraft
        ? ok
        : row.draftTestedHash !== null && row.draftTestedHash === definitionHash(row.draft),
    };
  }

  /* ───────────── versions ───────────── */

  /** Freezes the tested draft as version N (409 TEST_REQUIRED when the draft changed since its last test). */
  async publish(ref: string, note: string | null, auth: AuthContext): Promise<VersionRow> {
    const row = await this.resolve(ref);
    if (
      row.draftTestedHash === null ||
      row.draftTestedHash !== definitionHash(row.draft) ||
      !row.draftColumns
    )
      throw new HttpError(
        409,
        ErrorCodes.TEST_REQUIRED,
        'Test the current draft successfully before publishing',
      );
    const conn = await this.checkDraft(row.draft);
    this.readiness(row.draft, conn.engine);
    return this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(endpoints).where(eq(endpoints.id, row.id)).for('update');
      if (!locked || locked.draftTestedHash !== definitionHash(locked.draft))
        throw new HttpError(
          409,
          ErrorCodes.TEST_REQUIRED,
          'The draft changed: test it again before publishing',
        );
      const [{ next } = { next: 1 }] = await tx
        .select({ next: sql<number>`coalesce(max(${endpointVersions.version}), 0)::int + 1` })
        .from(endpointVersions)
        .where(eq(endpointVersions.endpointId, row.id));
      const [version] = await tx
        .insert(endpointVersions)
        .values({
          endpointId: row.id,
          version: next,
          definition: locked.draft,
          connectionId: locked.draft.connectionId,
          columns: locked.draftColumns ?? [],
          note,
          publishedBy: auth.user?.id ?? null,
        })
        .returning();
      await tx
        .update(endpoints)
        .set({ latestVersion: next, updatedAt: new Date() })
        .where(eq(endpoints.id, row.id));
      await this.ctx.audit.record(
        {
          action: 'etl.endpoint.published',
          entityType: ENDPOINT_TYPE,
          entityId: row.id,
          entityLabel: row.name,
          metadata: { slug: row.slug, version: next, note },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'etl.endpoint.published',
        { endpointId: row.id, slug: row.slug, version: next },
        { tx },
      );
      return version!;
    });
  }

  /** Deprecate, retire or restore a version, or load it into the draft. */
  async versionAction(ref: string, version: number, action: VersionAction): Promise<void> {
    const row = await this.resolve(ref);
    const [v] = await this.ctx.db
      .select()
      .from(endpointVersions)
      .where(and(eq(endpointVersions.endpointId, row.id), eq(endpointVersions.version, version)));
    if (!v) throw httpErrors.notFound(`Version ${version} not found`);
    if (action === 'load') {
      await this.ctx.transaction(async (tx) => {
        await tx
          .update(endpoints)
          .set({
            draft: v.definition,
            connectionId: v.definition.connectionId,
            // The version was tested when it was published.
            draftTestedHash: definitionHash(v.definition),
            draftTestedAt: new Date(),
            draftColumns: v.columns,
            updatedAt: new Date(),
          })
          .where(eq(endpoints.id, row.id));
        await this.ctx.audit.record(
          {
            action: 'etl.endpoint.draft_loaded',
            entityType: ENDPOINT_TYPE,
            entityId: row.id,
            entityLabel: row.name,
            metadata: { version },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'etl.endpoint.updated',
          { endpointId: row.id, slug: row.slug, changes: ['draft'] },
          { tx },
        );
      });
      return;
    }
    if (!VERSION_TRANSITIONS[action].includes(v.status))
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `Version ${version} is ${v.status}`, {
        status: v.status,
      });
    const status: VersionStatus =
      action === 'deprecate' ? 'deprecated' : action === 'retire' ? 'retired' : 'published';
    const event =
      action === 'deprecate'
        ? 'etl.endpoint.deprecated'
        : action === 'retire'
          ? 'etl.endpoint.retired'
          : 'etl.endpoint.restored';
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(endpointVersions)
        .set({
          status,
          deprecatedAt: status === 'deprecated' ? new Date() : status === 'published' ? null : v.deprecatedAt,
          retiredAt: status === 'retired' ? new Date() : null,
        })
        .where(eq(endpointVersions.id, v.id));
      await tx.update(endpoints).set({ updatedAt: new Date() }).where(eq(endpoints.id, row.id));
      await this.ctx.audit.record(
        {
          action: event,
          entityType: ENDPOINT_TYPE,
          entityId: row.id,
          entityLabel: row.name,
          changes: { [`v${version}`]: [v.status, status] },
          metadata: { slug: row.slug, version },
        },
        { tx },
      );
      await this.ctx.events.publish(event, { endpointId: row.id, slug: row.slug, version }, { tx });
    });
  }

  /* ───────────── statistics ───────────── */

  /** Calls, error rate and p95 latency over 24 h (hourly) or 7 days (daily). */
  async stats(ref: string, period: StatsPeriod): Promise<EndpointStatsOut> {
    const row = await this.resolve(ref);
    const hourly = period === '24h';
    const span = hourly ? sql`interval '24 hours'` : sql`interval '7 days'`;
    const unit = hourly ? sql.raw(`'hour'`) : sql.raw(`'day'`);
    const step = hourly ? sql`interval '1 hour'` : sql`interval '1 day'`;
    const back = hourly ? sql`interval '23 hours'` : sql`interval '6 days'`;
    const [totals] = (
      await this.ctx.db.execute<{
        calls: number;
        errors: number;
        cache_hits: number;
        p95: number | null;
        avg: number | null;
      }>(sql`
        select count(*)::int as calls,
               (count(*) filter (where status >= 400))::int as errors,
               (count(*) filter (where cached))::int as cache_hits,
               percentile_cont(0.95) within group (order by duration_ms) as p95,
               avg(duration_ms)::float8 as avg
          from ${calls}
         where endpoint_id = ${row.id} and created_at > now() - ${span}`)
    ).rows;
    const series = (
      await this.ctx.db.execute<{ at: Date | string; calls: number; errors: number; p95: number | null }>(sql`
        select b.at as at,
               count(c.id)::int as calls,
               (count(c.id) filter (where c.status >= 400))::int as errors,
               percentile_cont(0.95) within group (order by c.duration_ms) as p95
          from generate_series(date_trunc(${unit}, now()) - ${back}, date_trunc(${unit}, now()), ${step}) as b(at)
          left join ${calls} c
            on c.endpoint_id = ${row.id} and c.created_at >= b.at and c.created_at < b.at + ${step}
         group by b.at
         order by b.at`)
    ).rows;
    const n = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));
    return {
      period,
      calls: Number(totals?.calls ?? 0),
      errors: Number(totals?.errors ?? 0),
      errorRate: totals?.calls ? Number(totals.errors) / Number(totals.calls) : 0,
      cacheHits: Number(totals?.cache_hits ?? 0),
      p95Ms: n(totals?.p95),
      avgMs: n(totals?.avg),
      series: series.map((s) => ({
        at: new Date(s.at),
        calls: Number(s.calls),
        errors: Number(s.errors),
        p95Ms: n(s.p95),
      })),
    };
  }
}
