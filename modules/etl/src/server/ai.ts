import { type AiToolHandler, httpErrors } from '@isbp/sdk/server';
import { aiListEndpointsInput, aiRunPipelineInput } from '../contracts';
import { dataUrl, endpointHref, runHref } from '../model';
import { ENDPOINTS_READ, PIPELINES_RUN } from './access';
import { services } from './services';

/** Handlers of `manifest.ai.tools` (input already validated against the manifest schemas). */
export const aiTools: Record<string, AiToolHandler> = {
  'etl.list_endpoints': async (input, ctx, auth) => {
    auth.require(ENDPOINTS_READ);
    const { query, limit } = aiListEndpointsInput.parse(input);
    const s = services(ctx).endpoints;
    const page = await s.list({ page: 1, pageSize: limit, q: query || undefined, status: 'published' });
    const items = [];
    for (const e of page.items) {
      const detail = await s.detail(e.id, auth);
      const latest = detail.versions.find((v) => v.version === e.latestVersion);
      const def = latest?.definition ?? detail.draft;
      items.push({
        slug: e.slug,
        name: e.name,
        description: e.description,
        method: def.method,
        url: dataUrl(e.slug),
        latestVersion: e.latestVersion,
        parameters: def.params.map((p) => ({
          name: p.name,
          type: p.list ? `${p.type}[]` : p.type,
          required: p.required && p.default === null,
          ...(p.enum?.length ? { allowed: p.enum } : {}),
          ...(p.description ? { description: p.description } : {}),
        })),
        callsLast24h: e.calls24h,
        href: endpointHref(e.slug),
      });
    }
    return { total: page.total, endpoints: items };
  },

  'etl.run_pipeline': async (input, ctx, auth) => {
    auth.require(PIPELINES_RUN);
    const { pipeline } = aiRunPipelineInput.parse(input);
    const s = services(ctx).pipelines;
    const row = await s.find(pipeline);
    if (!row) throw httpErrors.notFound(`No pipeline called "${pipeline}"`);
    const run = await s.runNow(row.id, auth);
    return {
      pipeline: row.name,
      runId: run.id,
      status: run.status,
      href: runHref(row.id, run.id),
    };
  },
};
