import type { updateAiConfigSchema } from '@isbp/contracts';
import { type AuthContext, type ModuleContext, httpErrors } from '@isbp/sdk/server';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DEFAULT_ANTHROPIC_MODEL, readAiConfig } from '../../kernel/ai/config';
import { mergeHeaders, parseHeaders } from '../../kernel/ai/connection';
import { getKernel } from '../kernel-ref';

/** Administration → AI: provider configuration, connection test, usage report and index status. */
export class AiAdminService {
  constructor(private readonly ctx: ModuleContext) {}

  private get core() {
    return getKernel().registry.get('core')!.manifest;
  }

  async config() {
    const kernel = getKernel();
    const raw = await kernel.settings.values(this.core);
    const c = readAiConfig(raw);
    const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
    const num = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
    const provider =
      (['none', 'anthropic', 'openai-compatible'] as const).find((p) => p === raw['ai.chat.provider']) ??
      'none';
    // Header values may carry credentials: only their names leave the server.
    const headerNames = (key: string) => parseHeaders(raw[key]).map((h) => ({ name: h.name }));
    return {
      chat: {
        provider,
        baseUrl: str('ai.chat.baseUrl'),
        model: str('ai.chat.model'),
        hasApiKey: Boolean(raw['ai.chat.apiKey']),
        inputPrice: num('ai.chat.inputPrice'),
        outputPrice: num('ai.chat.outputPrice'),
        defaultModel: provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : null,
        apiStyle:
          raw['ai.chat.apiStyle'] === 'responses' ? ('responses' as const) : ('chat-completions' as const),
        headers: headerNames('ai.chat.headers'),
        insecureTls: raw['ai.chat.insecureTls'] === true,
      },
      embeddings: {
        provider:
          raw['ai.embeddings.provider'] === 'openai-compatible'
            ? ('openai-compatible' as const)
            : ('builtin' as const),
        baseUrl: str('ai.embeddings.baseUrl'),
        model: str('ai.embeddings.model'),
        hasApiKey: Boolean(raw['ai.embeddings.apiKey']),
        dimensions: num('ai.embeddings.dimensions'),
        price: num('ai.embeddings.price'),
        headers: headerNames('ai.embeddings.headers'),
        insecureTls: raw['ai.embeddings.insecureTls'] === true,
      },
      rerank: {
        provider:
          (['cohere', 'tei', 'voyage'] as const).find((p) => p === raw['ai.rerank.provider']) ??
          ('none' as const),
        baseUrl: str('ai.rerank.baseUrl'),
        model: str('ai.rerank.model'),
        hasApiKey: Boolean(raw['ai.rerank.apiKey']),
        price: num('ai.rerank.price'),
        headers: headerNames('ai.rerank.headers'),
        insecureTls: raw['ai.rerank.insecureTls'] === true,
      },
      masking: {
        enabled: c.masking.enabled,
        categories: c.masking.categories,
        custom: str('ai.masking.custom'),
      },
      monthlyBudgetUsd: c.monthlyBudgetUsd,
      spentThisMonthUsd: await kernel.ai.monthSpend(),
    };
  }

  async update(input: z.output<typeof updateAiConfigSchema>, auth: AuthContext) {
    const kernel = getKernel();
    const raw = await kernel.settings.values(this.core);
    const before = readAiConfig(raw);
    const values: Record<string, unknown> = {};
    const put = (key: string, v: unknown) => {
      if (v !== undefined) values[key] = v;
    };
    put('ai.chat.provider', input.chat?.provider);
    put('ai.chat.baseUrl', input.chat?.baseUrl);
    put('ai.chat.model', input.chat?.model);
    put('ai.chat.apiKey', input.chat?.apiKey);
    put('ai.chat.inputPrice', input.chat?.inputPrice);
    put('ai.chat.outputPrice', input.chat?.outputPrice);
    put('ai.chat.apiStyle', input.chat?.apiStyle);
    put('ai.chat.insecureTls', input.chat?.insecureTls);
    put('ai.embeddings.provider', input.embeddings?.provider);
    put('ai.embeddings.baseUrl', input.embeddings?.baseUrl);
    put('ai.embeddings.model', input.embeddings?.model);
    put('ai.embeddings.apiKey', input.embeddings?.apiKey);
    put('ai.embeddings.dimensions', input.embeddings?.dimensions);
    put('ai.embeddings.price', input.embeddings?.price);
    put('ai.embeddings.insecureTls', input.embeddings?.insecureTls);
    put('ai.rerank.provider', input.rerank?.provider);
    put('ai.rerank.baseUrl', input.rerank?.baseUrl);
    put('ai.rerank.model', input.rerank?.model);
    put('ai.rerank.apiKey', input.rerank?.apiKey);
    put('ai.rerank.price', input.rerank?.price);
    put('ai.rerank.insecureTls', input.rerank?.insecureTls);
    // A header sent without a value keeps the stored one; the list is stored sealed, or cleared when empty.
    for (const section of ['chat', 'embeddings', 'rerank'] as const) {
      const next = input[section]?.headers;
      if (!next) continue;
      const merged = mergeHeaders(parseHeaders(raw[`ai.${section}.headers`]), next);
      put(`ai.${section}.headers`, merged.length ? JSON.stringify(merged) : '');
    }
    put('ai.masking.enabled', input.masking?.enabled);
    put('ai.masking.categories', input.masking?.categories?.join(','));
    put('ai.masking.custom', input.masking?.custom);
    put('ai.budget.monthlyUsd', input.monthlyBudgetUsd);
    if (input.masking?.custom) {
      for (const line of input.masking.custom
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)) {
        try {
          new RegExp(line);
        } catch {
          throw httpErrors.badRequest(`Invalid pattern: ${line.slice(0, 80)}`, { field: 'masking.custom' });
        }
      }
    }
    await this.ctx.transaction(async (tx) => {
      const changes = await kernel.settings.update(this.core, values, auth.user?.id ?? null, tx);
      await this.ctx.audit.record(
        {
          action: 'core.ai.config_updated',
          category: 'security',
          entityType: 'ai',
          entityId: 'gateway',
          changes,
          // Secret settings audit as "[redacted]": say which headers are set, by name.
          metadata: Object.fromEntries(
            (['chat', 'embeddings', 'rerank'] as const)
              .filter((section) => input[section]?.headers)
              .map((section) => [
                `${section}Headers`,
                (input[section]!.headers ?? []).map((h) => h.name.trim()),
              ]),
          ),
        },
        { tx },
      );
    });
    // The update cleared the cache inside the transaction; a read racing the commit may have cached the old values.
    kernel.settings.invalidate('core');
    const after = readAiConfig(await kernel.settings.values(this.core));
    // A new embedding model makes every stored vector incomparable: re-embed in the background.
    if (after.embeddings.model !== before.embeddings.model) await this.reindex(auth, false);
    return this.config();
  }

  async reindex(_auth: AuthContext, audit = true) {
    if (audit)
      await this.ctx.audit.record({
        action: 'core.ai.index_rebuilt',
        category: 'system',
        entityType: 'ai',
        entityId: 'index',
      });
    await this.ctx.jobs.enqueue('ai-reindex', {}, { jobId: `ai-reindex-${Date.now()}` });
    return { ok: true as const };
  }

  async index() {
    const kernel = getKernel();
    const c = await kernel.ai.config();
    const model = kernel.ai.embedder(c).model;
    const [types, stale] = await Promise.all([
      kernel.ai.index.stats(),
      this.ctx.db.execute<{ n: number }>(sql`
        select count(*)::int as n from (select distinct source_type, source_id from core.ai_chunks
        where model <> ${model}) x`),
    ]);
    return {
      vectorStore: await kernel.ai.index.vectorMode(),
      embeddingModel: model,
      types: types.map((t) => ({ type: t.source_type, model: t.model, documents: t.docs, chunks: t.chunks })),
      stale: stale.rows[0]?.n ?? 0,
    };
  }

  async usage(days: number) {
    const db = this.ctx.db;
    const since = sql`now() - make_interval(days => ${days})`;
    const [totals, daily, byFeature, byModel, recent] = await Promise.all([
      db.execute<Record<string, number>>(sql`
        select count(*) filter (where kind <> 'tool')::int as calls,
          coalesce(sum(input_tokens), 0)::int as "inputTokens",
          coalesce(sum(output_tokens), 0)::int as "outputTokens",
          coalesce(sum(cost_usd), 0)::float8 as "costUsd",
          count(*) filter (where status = 'error')::int as errors,
          count(*) filter (where status = 'blocked')::int as blocked,
          coalesce(sum(masked), 0)::int as masked,
          count(*) filter (where kind = 'tool')::int as "toolCalls"
        from core.ai_usage where created_at >= ${since}`),
      db.execute<{ date: string; calls: number; costUsd: number }>(sql`
        select to_char(d, 'YYYY-MM-DD') as date,
          coalesce(count(u.id) filter (where u.kind <> 'tool'), 0)::int as calls,
          coalesce(sum(u.cost_usd), 0)::float8 as "costUsd"
        from generate_series((now() at time zone 'utc')::date - (${days} - 1), (now() at time zone 'utc')::date, interval '1 day') d
        left join core.ai_usage u on (u.created_at at time zone 'utc')::date = d::date
        group by d order by d`),
      db.execute<Record<string, unknown>>(sql`
        select module_id as "moduleId", feature, count(*)::int as calls,
          coalesce(sum(input_tokens), 0)::int as "inputTokens", coalesce(sum(output_tokens), 0)::int as "outputTokens",
          coalesce(sum(cost_usd), 0)::float8 as "costUsd", avg(latency_ms)::float8 as "avgLatencyMs",
          count(*) filter (where status = 'error')::int as errors
        from core.ai_usage where created_at >= ${since}
        group by module_id, feature order by "costUsd" desc, calls desc limit 50`),
      db.execute<Record<string, unknown>>(sql`
        select provider, model, count(*)::int as calls, coalesce(sum(cost_usd), 0)::float8 as "costUsd"
        from core.ai_usage where created_at >= ${since} and kind <> 'tool'
        group by provider, model order by calls desc limit 20`),
      db.execute<Record<string, unknown>>(sql`
        select id, feature, kind, principal_type, principal_name, provider, model,
          input_tokens as "inputTokens", output_tokens as "outputTokens", cost_usd::float8 as "costUsd",
          latency_ms as "latencyMs", status, error, masked, created_at as "createdAt"
        from core.ai_usage order by created_at desc limit 50`),
    ]);
    const t = totals.rows[0]!;
    return {
      days,
      totals: {
        calls: Number(t.calls),
        inputTokens: Number(t.inputTokens),
        outputTokens: Number(t.outputTokens),
        costUsd: Number(t.costUsd),
        errors: Number(t.errors),
        blocked: Number(t.blocked),
        masked: Number(t.masked),
        toolCalls: Number(t.toolCalls),
      },
      daily: daily.rows.map((d) => ({ date: d.date, calls: Number(d.calls), costUsd: Number(d.costUsd) })),
      byFeature: byFeature.rows.map((r) => ({
        moduleId: String(r.moduleId),
        feature: String(r.feature),
        calls: Number(r.calls),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        costUsd: Number(r.costUsd),
        avgLatencyMs: r.avgLatencyMs == null ? null : Math.round(Number(r.avgLatencyMs)),
        errors: Number(r.errors),
      })),
      byModel: byModel.rows.map((r) => ({
        provider: String(r.provider),
        model: (r.model as string | null) ?? null,
        calls: Number(r.calls),
        costUsd: Number(r.costUsd),
      })),
      recent: recent.rows.map((r) => ({
        id: String(r.id),
        feature: String(r.feature),
        kind: r.kind as 'chat' | 'embed' | 'tool' | 'rerank',
        principal: { type: String(r.principal_type), name: (r.principal_name as string | null) ?? null },
        provider: String(r.provider),
        model: (r.model as string | null) ?? null,
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        costUsd: Number(r.costUsd),
        latencyMs: r.latencyMs == null ? null : Number(r.latencyMs),
        status: r.status as 'ok' | 'error' | 'refused' | 'blocked',
        error: (r.error as string | null) ?? null,
        masked: Number(r.masked),
        createdAt: new Date(r.createdAt as string),
      })),
    };
  }
}
