import { users } from '@isbp/db/schema';
import { parameterNames, statementCount } from '@isbp/sql';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
  type Page,
} from '@isbp/sdk/server';
import { and, asc, desc, eq, gte, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  PipelineDetailOut,
  pipelineInputSchema,
  pipelineQuerySchema,
  PipelineSummaryOut,
  pipelineUpdateSchema,
  PreviewResult,
  previewSchema,
  RunDetailOut,
  runQuerySchema,
  RunOut,
} from '../contracts';
import { mappingIssues, WATERMARK_PARAM } from '../model';
import {
  connectionMap,
  connectionRef,
  dataConnection,
  invalid,
  peopleById,
  PIPELINE_TYPE,
  PIPELINES_MANAGE,
  PIPELINES_RUN,
} from './access';
import { errorInfo } from './endpoints';
import { type PipelineRow, type RunRow, STALE_QUEUE_MS, STALE_RUN_MS } from './runner';
import { pipelineRuns, pipelines } from './schema';

type PipelineInput = z.infer<typeof pipelineInputSchema>;
const PREVIEW_ROWS = 10;

/** Pipelines: definitions validated against the target catalog, "Run now", runs and cancellation. */
export class PipelineService {
  constructor(private readonly ctx: ModuleContext) {}

  async get(id: string): Promise<PipelineRow> {
    const [row] = await this.ctx.db.select().from(pipelines).where(eq(pipelines.id, id));
    if (!row) throw httpErrors.notFound('Pipeline not found');
    return row;
  }

  /** By id or (case-insensitive) name, for AI tools. */
  async find(ref: string): Promise<PipelineRow | null> {
    const byId = /^[0-9a-f-]{36}$/i.test(ref)
      ? await this.ctx.db.select().from(pipelines).where(eq(pipelines.id, ref))
      : [];
    if (byId[0]) return byId[0];
    const [byName] = await this.ctx.db
      .select()
      .from(pipelines)
      .where(sql`lower(${pipelines.name}) = lower(${ref})`);
    return byName ?? null;
  }

  /* ───────────── DTOs ───────────── */

  runDto(r: RunRow, people: Map<string, { id: string; displayName: string }>): RunOut {
    const by = r.triggeredBy ? people.get(r.triggeredBy) : undefined;
    return {
      id: r.id,
      pipelineId: r.pipelineId,
      trigger: r.trigger,
      status: r.status,
      rowsRead: r.rowsRead,
      rowsWritten: r.rowsWritten,
      rowsRejected: r.rowsRejected,
      watermarkFrom: r.watermarkFrom,
      watermarkTo: r.watermarkTo,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.durationMs,
      error: r.error,
      triggeredBy: by ? { id: by.id, name: by.displayName } : null,
      cancelRequested: r.cancelRequested,
      createdAt: r.createdAt,
    };
  }

  async summaries(rows: PipelineRow[]): Promise<PipelineSummaryOut[]> {
    if (!rows.length) return [];
    // The latest run of each pipeline (including one queued or running right now).
    const latest = await this.ctx.db
      .selectDistinctOn([pipelineRuns.pipelineId])
      .from(pipelineRuns)
      .where(
        inArray(
          pipelineRuns.pipelineId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(pipelineRuns.pipelineId, desc(pipelineRuns.createdAt));
    const conns = await connectionMap(this.ctx);
    const people = await peopleById(this.ctx, [
      ...rows.map((r) => r.ownerId),
      ...latest.map((r) => r.triggeredBy),
    ]);
    const lastBy = new Map(latest.map((r) => [r.pipelineId, r]));
    return rows.map((r) => {
      const owner = r.ownerId ? people.get(r.ownerId) : undefined;
      const last = lastBy.get(r.id);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        enabled: r.enabled,
        owner: owner ? { id: owner.id, displayName: owner.displayName, avatarUrl: owner.avatarUrl } : null,
        source: connectionRef(r.sourceConnectionId, conns),
        target: connectionRef(r.targetConnectionId, conns),
        targetTable: `${r.targetSchema ? `${r.targetSchema}.` : ''}${r.targetTable}`,
        mode: r.mode,
        incremental: Boolean(r.watermarkColumn),
        lastRun: last ? this.runDto(last, people) : null,
        updatedAt: r.updatedAt,
      };
    });
  }

  async list(query: z.infer<typeof pipelineQuerySchema>): Promise<Page<PipelineSummaryOut>> {
    const conds: SQL[] = [];
    if (query.q) {
      const p = likePattern(query.q);
      conds.push(
        or(ilike(pipelines.name, p), ilike(pipelines.description, p), ilike(pipelines.targetTable, p))!,
      );
    }
    if (query.enabled !== undefined) conds.push(eq(pipelines.enabled, query.enabled));
    if (query.status)
      conds.push(
        sql`(select r.status from ${pipelineRuns} r where r.pipeline_id = ${pipelines.id} order by r.created_at desc limit 1) = ${query.status}`,
      );
    const where = conds.length ? and(...conds) : undefined;
    const key = query.sort?.replace(/^-/, '');
    const column = key === 'updatedAt' ? pipelines.updatedAt : pipelines.name;
    const [{ total } = { total: 0 }] = await this.ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(pipelines)
      .where(where);
    const rows = await this.ctx.db
      .select()
      .from(pipelines)
      .where(where)
      .orderBy(query.sort?.startsWith('-') ? desc(column) : asc(column), asc(pipelines.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { items: await this.summaries(rows), total, page: query.page, pageSize: query.pageSize };
  }

  async detail(id: string | PipelineRow, auth: AuthContext): Promise<PipelineDetailOut> {
    const row = typeof id === 'string' ? await this.get(id) : id;
    const [summary] = await this.summaries([row]);
    const [stats] = (
      await this.ctx.db.execute<{
        runs: number;
        succeeded: number;
        failed: number;
        rows_written: number;
      }>(sql`
        select count(*)::int as runs,
               (count(*) filter (where status = 'succeeded'))::int as succeeded,
               (count(*) filter (where status = 'failed'))::int as failed,
               coalesce(sum(rows_written) filter (where status = 'succeeded'), 0)::int as rows_written
          from ${pipelineRuns}
         where pipeline_id = ${row.id} and created_at > now() - interval '30 days'`)
    ).rows;
    const people = await peopleById(this.ctx, [row.createdBy]);
    const creator = row.createdBy ? people.get(row.createdBy) : undefined;
    return {
      ...summary!,
      definition: this.definitionOf(row),
      watermark: row.watermark,
      stats: {
        runs: Number(stats?.runs ?? 0),
        succeeded: Number(stats?.succeeded ?? 0),
        failed: Number(stats?.failed ?? 0),
        rowsWritten: Number(stats?.rows_written ?? 0),
      },
      createdBy: creator ? { id: creator.id, name: creator.displayName } : null,
      createdAt: row.createdAt,
      viewer: { canManage: auth.can(PIPELINES_MANAGE), canRun: auth.can(PIPELINES_RUN) },
    };
  }

  definitionOf(row: PipelineRow) {
    return {
      source: { connectionId: row.sourceConnectionId, sql: row.sourceSql, params: row.sourceParams },
      incremental:
        row.watermarkColumn && row.watermarkInitial
          ? { column: row.watermarkColumn, initial: row.watermarkInitial }
          : null,
      target: {
        connectionId: row.targetConnectionId,
        schema: row.targetSchema,
        table: row.targetTable,
        mode: row.mode,
        keys: row.keyColumns,
      },
      mappings: row.mappings,
      batchSize: row.batchSize,
    };
  }

  /* ───────────── validation ───────────── */

  /**
   * A pipeline must read from a `data` connection with one statement whose `:params` all have values
   * (`:watermark` in incremental mode), and write to a writable `data` connection's catalog table with the
   * mapped and key columns present.
   */
  async validate(input: PipelineInput): Promise<void> {
    const source = await dataConnection(this.ctx, input.source.connectionId, 'source.connectionId');
    const target = await dataConnection(this.ctx, input.target.connectionId, 'target.connectionId');
    if (target.readOnly)
      throw new HttpError(
        409,
        ErrorCodes.CONNECTION_READ_ONLY,
        `Connection ${target.name} is read-only: pick a connection that may write`,
        { path: 'target.connectionId' },
      );
    const issues: { path: string; message: string }[] = [];
    if (statementCount(input.source.sql, source.engine) > 1)
      issues.push({ path: 'source.sql', message: 'One statement only' });
    const used = parameterNames(input.source.sql, source.engine);
    for (const name of used) {
      if (name === WATERMARK_PARAM && input.incremental) continue;
      if (!(name in input.source.params))
        issues.push({ path: `source.params.${name}`, message: `Give :${name} a value` });
    }
    if (input.incremental && !used.includes(WATERMARK_PARAM))
      issues.push({
        path: 'incremental.column',
        message: 'Incremental mode needs :watermark in the source SQL',
      });
    if (input.ownerId) {
      const [owner] = await this.ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.ownerId));
      if (!owner) issues.push({ path: 'ownerId', message: 'Unknown person' });
    }
    const catalog = await this.ctx.databases.catalog(target.id, { purpose: 'data' });
    const schema = input.target.schema || catalog.defaultSchema;
    const table = catalog.tables.find(
      (t) => t.kind === 'table' && t.name === input.target.table && t.schema === schema,
    );
    issues.push(
      ...mappingIssues(
        { mode: input.target.mode, keys: input.target.keys, mappings: input.mappings },
        table ? table.columns.map((c) => c.name) : null,
      ),
    );
    if (issues.length) throw invalid(issues);
  }

  private values(input: PipelineInput) {
    return {
      name: input.name,
      description: input.description,
      ownerId: input.ownerId,
      enabled: input.enabled,
      sourceConnectionId: input.source.connectionId,
      sourceSql: input.source.sql,
      sourceParams: input.source.params,
      watermarkColumn: input.incremental?.column ?? null,
      watermarkInitial: input.incremental?.initial ?? null,
      targetConnectionId: input.target.connectionId,
      targetSchema: input.target.schema,
      targetTable: input.target.table,
      mode: input.target.mode,
      keyColumns: input.target.mode === 'upsert' ? input.target.keys : [],
      mappings: input.mappings.map((m) => ({ source: m.source, target: m.target, transform: m.transform })),
      batchSize: input.batchSize,
    };
  }

  private async assertNameFree(name: string, except?: string) {
    const [other] = await this.ctx.db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(sql`lower(${pipelines.name}) = lower(${name})`);
    if (other && other.id !== except)
      throw invalid([{ path: 'name', message: 'A pipeline with this name exists' }]);
  }

  async create(input: PipelineInput, auth: AuthContext): Promise<PipelineRow> {
    await this.assertNameFree(input.name);
    await this.validate(input);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(pipelines)
        .values({ ...this.values(input), createdBy: auth.user?.id ?? null })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'etl.pipeline.created',
          entityType: PIPELINE_TYPE,
          entityId: row!.id,
          entityLabel: row!.name,
          metadata: {
            source: row!.sourceConnectionId,
            target: row!.targetConnectionId,
            table: row!.targetTable,
            mode: row!.mode,
          },
        },
        { tx },
      );
      await this.ctx.events.publish('etl.pipeline.created', { pipelineId: row!.id, name: row!.name }, { tx });
      return row!;
    });
  }

  async update(id: string, patch: z.infer<typeof pipelineUpdateSchema>): Promise<PipelineRow> {
    const before = await this.get(id);
    const current = this.definitionOf(before);
    const merged: PipelineInput = {
      name: patch.name ?? before.name,
      description: patch.description !== undefined ? patch.description : before.description,
      ownerId: patch.ownerId !== undefined ? patch.ownerId : before.ownerId,
      enabled: patch.enabled ?? before.enabled,
      source: patch.source ?? current.source,
      incremental: patch.incremental !== undefined ? patch.incremental : current.incremental,
      target: patch.target ?? current.target,
      mappings: patch.mappings ?? current.mappings,
      batchSize: patch.batchSize ?? current.batchSize,
    };
    if (merged.name !== before.name) await this.assertNameFree(merged.name, before.id);
    const definitionChanged =
      patch.source !== undefined ||
      patch.target !== undefined ||
      patch.mappings !== undefined ||
      patch.incremental !== undefined ||
      patch.ownerId !== undefined;
    if (definitionChanged) await this.validate(merged);
    const values = this.values(merged);
    const resetWatermark =
      patch.resetWatermark === true ||
      (merged.incremental?.column ?? null) !== before.watermarkColumn ||
      merged.source.connectionId !== before.sourceConnectionId;
    const changes = this.ctx.audit.diff(
      {
        name: before.name,
        description: before.description,
        ownerId: before.ownerId,
        enabled: before.enabled,
        sourceConnectionId: before.sourceConnectionId,
        sourceSql: before.sourceSql,
        sourceParams: before.sourceParams,
        watermarkColumn: before.watermarkColumn,
        watermarkInitial: before.watermarkInitial,
        targetConnectionId: before.targetConnectionId,
        targetSchema: before.targetSchema,
        targetTable: before.targetTable,
        mode: before.mode,
        keyColumns: before.keyColumns,
        mappings: before.mappings,
        batchSize: before.batchSize,
      },
      values,
    );
    if (resetWatermark && before.watermark !== null) changes.watermark = [before.watermark, null];
    if (!Object.keys(changes).length) return before;
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(pipelines)
        .set({
          ...values,
          ...(resetWatermark ? { watermark: null } : {}),
          connectionMissing:
            before.connectionMissing &&
            values.sourceConnectionId === before.sourceConnectionId &&
            values.targetConnectionId === before.targetConnectionId,
          updatedAt: new Date(),
        })
        .where(eq(pipelines.id, before.id))
        .returning();
      await this.ctx.audit.record(
        {
          action: 'etl.pipeline.updated',
          entityType: PIPELINE_TYPE,
          entityId: before.id,
          entityLabel: row!.name,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'etl.pipeline.updated',
        { pipelineId: before.id, name: row!.name, changes: Object.keys(changes) },
        { tx },
      );
      return row!;
    });
  }

  async remove(id: string): Promise<void> {
    const row = await this.get(id);
    if (await this.activeRun(row.id))
      throw new HttpError(409, ErrorCodes.JOB_RUNNING, 'The pipeline is running: cancel the run first');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(pipelines).where(eq(pipelines.id, row.id));
      await this.ctx.records.forget({ type: PIPELINE_TYPE, id: row.id }, { tx });
      await this.ctx.audit.record(
        {
          action: 'etl.pipeline.deleted',
          entityType: PIPELINE_TYPE,
          entityId: row.id,
          entityLabel: row.name,
        },
        { tx },
      );
      await this.ctx.events.publish('etl.pipeline.deleted', { pipelineId: row.id, name: row.name }, { tx });
    });
  }

  /** A sample of the source rows (read-only, 10 rows) for the mapping editor. */
  async preview(input: z.infer<typeof previewSchema>): Promise<PreviewResult> {
    await dataConnection(this.ctx, input.connectionId, 'source.connectionId');
    const params = {
      ...input.params,
      ...(input.incremental ? { [WATERMARK_PARAM]: input.incremental.initial } : {}),
    };
    try {
      const r = await this.ctx.databases.query(input.connectionId, input.sql, {
        purpose: 'data',
        params,
        readOnly: true,
        maxRows: PREVIEW_ROWS,
      });
      return { columns: r.columns, rows: r.rows, error: null };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      return { columns: [], rows: [], error: errorInfo(err) };
    }
  }

  /* ───────────── runs ───────────── */

  /** A queued or running run that is still alive (stale ones no longer block). */
  async activeRun(pipelineId: string): Promise<RunRow | null> {
    const [r] = await this.ctx.db
      .select()
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.pipelineId, pipelineId),
          or(
            and(
              eq(pipelineRuns.status, 'running'),
              gte(pipelineRuns.heartbeatAt, new Date(Date.now() - STALE_RUN_MS)),
            ),
            and(
              eq(pipelineRuns.status, 'queued'),
              gte(pipelineRuns.createdAt, new Date(Date.now() - STALE_QUEUE_MS)),
            ),
          ),
        ),
      )
      .limit(1);
    return r ?? null;
  }

  /**
   * Creates a queued run (single flight per pipeline: 409 JOB_RUNNING). Manual runs are executed by the
   * module job `run-pipeline`; scheduled ones by the task type, in the scheduler's worker.
   */
  async queueRun(
    pipeline: PipelineRow,
    trigger: 'manual' | 'schedule',
    opts: { userId?: string | null; taskRunId?: string | null } = {},
  ): Promise<RunRow> {
    if (await this.activeRun(pipeline.id))
      throw new HttpError(409, ErrorCodes.JOB_RUNNING, `${pipeline.name} is already running`);
    return this.ctx.transaction(async (tx) => {
      // Runs nobody will finish (crashed worker) are closed so the history stays truthful.
      await tx
        .update(pipelineRuns)
        .set({ status: 'failed', error: 'The worker stopped responding', finishedAt: new Date() })
        .where(
          and(
            eq(pipelineRuns.pipelineId, pipeline.id),
            or(eq(pipelineRuns.status, 'running'), eq(pipelineRuns.status, 'queued')),
          ),
        );
      const [run] = await tx
        .insert(pipelineRuns)
        .values({
          pipelineId: pipeline.id,
          trigger,
          triggeredBy: opts.userId ?? null,
          taskRunId: opts.taskRunId ?? null,
          log: [],
        })
        .returning();
      if (trigger === 'manual')
        await this.ctx.audit.record(
          {
            action: 'etl.pipeline.run_requested',
            entityType: PIPELINE_TYPE,
            entityId: pipeline.id,
            entityLabel: pipeline.name,
            metadata: { runId: run!.id },
          },
          { tx },
        );
      return run!;
    });
  }

  /** "Run now": queue a manual run and hand it to the worker. */
  async runNow(id: string, auth: AuthContext): Promise<RunRow> {
    const pipeline = await this.get(id);
    if (!pipeline.enabled)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The pipeline is disabled: enable it to run it');
    const run = await this.queueRun(pipeline, 'manual', { userId: auth.user?.id ?? null });
    try {
      await this.ctx.jobs.enqueue('run-pipeline', { runId: run.id }, { jobId: `run-${run.id}` });
    } catch (err) {
      await this.ctx.db
        .update(pipelineRuns)
        .set({ status: 'failed', error: 'Could not queue the run', finishedAt: new Date() })
        .where(eq(pipelineRuns.id, run.id));
      throw err;
    }
    return run;
  }

  async runs(id: string, query: z.infer<typeof runQuerySchema>): Promise<Page<RunOut>> {
    await this.get(id);
    const where = and(
      eq(pipelineRuns.pipelineId, id),
      query.status ? eq(pipelineRuns.status, query.status) : undefined,
    );
    const [{ total } = { total: 0 }] = await this.ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(pipelineRuns)
      .where(where);
    const rows = await this.ctx.db
      .select()
      .from(pipelineRuns)
      .where(where)
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const people = await peopleById(
      this.ctx,
      rows.map((r) => r.triggeredBy),
    );
    return {
      items: rows.map((r) => this.runDto(r, people)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async run(id: string, runId: string, auth: AuthContext): Promise<RunDetailOut> {
    const pipeline = await this.get(id);
    const [r] = await this.ctx.db
      .select()
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.pipelineId, id)));
    if (!r) throw httpErrors.notFound('Run not found');
    const people = await peopleById(this.ctx, [r.triggeredBy]);
    return {
      ...this.runDto(r, people),
      pipeline: { id: pipeline.id, name: pipeline.name },
      log: r.log.map((l) => ({ ...l, at: new Date(l.at) })),
      viewer: { canRun: auth.can(PIPELINES_RUN) },
    };
  }

  /** A queued run is cancelled at once; a running one stops at its next batch and rolls back. */
  async cancel(id: string, runId: string): Promise<void> {
    const pipeline = await this.get(id);
    const [r] = await this.ctx.db
      .select()
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.pipelineId, id)));
    if (!r) throw httpErrors.notFound('Run not found');
    if (r.status !== 'queued' && r.status !== 'running')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `The run already ${r.status}`, { status: r.status });
    await this.ctx.transaction(async (tx) => {
      if (r.status === 'queued')
        await tx
          .update(pipelineRuns)
          .set({
            status: 'cancelled',
            finishedAt: new Date(),
            error: 'Cancelled before it started',
            log: [{ at: new Date().toISOString(), level: 'warn', message: 'Cancelled before it started' }],
          })
          .where(and(eq(pipelineRuns.id, r.id), eq(pipelineRuns.status, 'queued')));
      else await tx.update(pipelineRuns).set({ cancelRequested: true }).where(eq(pipelineRuns.id, r.id));
      await this.ctx.audit.record(
        {
          action: 'etl.pipeline.run_cancelled',
          entityType: PIPELINE_TYPE,
          entityId: pipeline.id,
          entityLabel: pipeline.name,
          metadata: { runId: r.id, status: r.status },
        },
        { tx },
      );
    });
  }
}
