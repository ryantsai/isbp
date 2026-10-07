/**
 * Endpoints and pipelines as linkable records (`etl.endpoint`, `etl.pipeline`) for the record registry
 * (linked records and attachments panels, pickers in other modules — e.g. the `alm.application` consuming an
 * API), plus global search. Visibility follows the pages: `etl.endpoints.read` / `etl.pipelines.read`.
 */
import {
  type AuthContext,
  likePattern,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
  type SearchHit,
  type SearchProvider,
} from '@isbp/sdk/server';
import { desc, ilike, inArray, or, sql } from 'drizzle-orm';
import { endpointHref, endpointStatusOf, ENDPOINT_TONE, pipelineHref, RUN_TONE } from '../model';
import { ENDPOINTS_MANAGE, ENDPOINTS_READ, PIPELINES_MANAGE, PIPELINES_READ, UUID_RE } from './access';
import { endpoints, endpointVersions, pipelineRuns, pipelines } from './schema';

const validIds = (ids: readonly string[]) => [...new Set(ids.filter((id) => UUID_RE.test(id)))];

type EndpointRow = typeof endpoints.$inferSelect;
type PipelineRow = typeof pipelines.$inferSelect;

async function endpointSummaries(
  rows: EndpointRow[],
  ctx: ModuleContext,
  auth: AuthContext,
): Promise<RecordSummary[]> {
  if (!rows.length) return [];
  const versions = await ctx.db
    .select({ endpointId: endpointVersions.endpointId, status: endpointVersions.status })
    .from(endpointVersions)
    .where(
      inArray(
        endpointVersions.endpointId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => {
    const status = endpointStatusOf(versions.filter((v) => v.endpointId === r.id).map((v) => v.status));
    return {
      id: r.id,
      reference: r.slug,
      title: r.name,
      subtitle: `${r.draft.method} /api/v1/etl/data/${r.slug}`,
      status: { key: `etl.endpointStatus.${status}`, tone: ENDPOINT_TONE[status] },
      href: endpointHref(r.slug),
      editable: auth.can(ENDPOINTS_MANAGE),
    };
  });
}

async function pipelineSummaries(
  rows: PipelineRow[],
  ctx: ModuleContext,
  auth: AuthContext,
): Promise<RecordSummary[]> {
  if (!rows.length) return [];
  const last = await ctx.db
    .selectDistinctOn([pipelineRuns.pipelineId], {
      pipelineId: pipelineRuns.pipelineId,
      status: pipelineRuns.status,
    })
    .from(pipelineRuns)
    .where(
      inArray(
        pipelineRuns.pipelineId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(pipelineRuns.pipelineId, desc(pipelineRuns.createdAt));
  const lastBy = new Map(last.map((l) => [l.pipelineId, l.status]));
  return rows.map((r) => {
    const status = lastBy.get(r.id);
    return {
      id: r.id,
      reference: null,
      title: r.name,
      subtitle: `→ ${r.targetSchema ? `${r.targetSchema}.` : ''}${r.targetTable}`,
      status: status ? { key: `etl.runStatus.${status}`, tone: RUN_TONE[status] } : null,
      href: pipelineHref(r.id),
      editable: auth.can(PIPELINES_MANAGE),
    };
  });
}

const endpoint: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const valid = validIds(ids);
    if (!valid.length || !auth.can(ENDPOINTS_READ)) return [];
    const rows = await ctx.db.select().from(endpoints).where(inArray(endpoints.id, valid));
    return endpointSummaries(rows, ctx, auth);
  },
  async search(query, ctx, auth, limit) {
    if (!auth.can(ENDPOINTS_READ)) return [];
    const q = query.trim();
    const rows = await ctx.db
      .select()
      .from(endpoints)
      .where(q ? or(ilike(endpoints.name, likePattern(q)), ilike(endpoints.slug, likePattern(q))) : undefined)
      .orderBy(
        q ? sql`${endpoints.slug} = ${q.toLowerCase()} desc` : desc(endpoints.updatedAt),
        endpoints.name,
      )
      .limit(limit);
    return endpointSummaries(rows, ctx, auth);
  },
};

const pipeline: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const valid = validIds(ids);
    if (!valid.length || !auth.can(PIPELINES_READ)) return [];
    const rows = await ctx.db.select().from(pipelines).where(inArray(pipelines.id, valid));
    return pipelineSummaries(rows, ctx, auth);
  },
  async search(query, ctx, auth, limit) {
    if (!auth.can(PIPELINES_READ)) return [];
    const q = query.trim();
    const rows = await ctx.db
      .select()
      .from(pipelines)
      .where(q ? ilike(pipelines.name, likePattern(q)) : undefined)
      .orderBy(q ? pipelines.name : desc(pipelines.updatedAt))
      .limit(limit);
    return pipelineSummaries(rows, ctx, auth);
  },
};

export const records = { endpoint, pipeline };

/** Global search: Data APIs by name or slug, pipelines by name. */
export const search: SearchProvider = async (query, ctx, auth, limit) => {
  const hits: SearchHit[] = [];
  if (auth.can(ENDPOINTS_READ)) {
    for (const r of await endpoint.search(query, ctx, auth, limit))
      hits.push({
        id: r.id,
        type: 'endpoint',
        title: r.title,
        subtitle: r.subtitle,
        href: r.href,
        icon: 'database-zap',
      });
  }
  if (auth.can(PIPELINES_READ)) {
    for (const r of await pipeline.search(query, ctx, auth, limit))
      hits.push({
        id: r.id,
        type: 'pipeline',
        title: r.title,
        subtitle: r.subtitle,
        href: r.href,
        icon: 'workflow',
      });
  }
  return hits.slice(0, limit);
};
