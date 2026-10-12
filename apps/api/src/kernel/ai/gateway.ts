import { aiUsage } from '@isbp/db/schema';
import {
  type AiChatRequest,
  type AiChatResult,
  type AiIndexDocument,
  type AiMessage,
  type AiSearchOptions,
  type AiService,
  type AiStatus,
  type AiStreamEvent,
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  type ModuleManifest,
  PermissionSet,
  type Principal,
} from '@isbp/sdk/server';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { currentPrincipal } from '../context';
import { buildAuthContext } from '../http/auth';
import type { ModuleRegistry } from '../modules';
import type { SettingsService } from '../settings';
import { type AiConfig, connectionOf, costOf, readAiConfig } from './config';
import { aiPost } from './connection';
import { BUILTIN_MODEL, builtinEmbed, normalize } from './embedder';
import { type Embedder, SemanticIndex } from './index-store';
import { Masker } from './masking';
import {
  AnthropicProvider,
  type ChatProvider,
  OpenAiCompatibleProvider,
  OpenAiResponsesProvider,
  type ProviderOutput,
  type ProviderRequest,
} from './providers';
import type { McpServer } from './mcp';
import { ToolRegistry, wireName } from './tools';

interface UsageRow {
  moduleId: string;
  feature: string;
  kind: 'chat' | 'embed' | 'tool';
  principal: Principal;
  provider: string;
  model: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status: 'ok' | 'error' | 'refused' | 'blocked';
  error?: string | null;
  masked?: number;
}

/**
 * The kernel AI gateway: one governed path from every module to the configured models — provider
 * adapters, masking, usage and cost accounting, the monthly budget, the shared semantic index and the
 * tool registry. Modules reach it as `ctx.ai`.
 */
export class AiGateway {
  readonly index: SemanticIndex;
  readonly tools: ToolRegistry;
  private budgetCache?: { at: number; spent: number };
  private mcpServer?: McpServer;

  constructor(
    private readonly deps: {
      db: Db;
      settings: SettingsService;
      registry: ModuleRegistry;
      logger: FastifyBaseLogger;
      coreManifest: () => ModuleManifest;
    },
  ) {
    this.index = new SemanticIndex(deps.db, deps.logger);
    this.tools = new ToolRegistry(deps.registry, (row) => this.logUsage(row));
  }

  /** The MCP server modules reach in-process (`ctx.ai.mcp`); set once the customisation kinds exist. */
  attachMcp(server: McpServer) {
    this.mcpServer = server;
  }

  async config(): Promise<AiConfig> {
    return readAiConfig(await this.deps.settings.values(this.deps.coreManifest()));
  }

  async status(): Promise<AiStatus> {
    const c = await this.config();
    return {
      chat:
        c.chat.provider === 'none'
          ? { available: false, provider: 'none', model: null }
          : { available: true, provider: c.chat.provider, model: c.chat.model },
      embeddings: {
        provider: c.embeddings.provider,
        model: c.embeddings.model,
        dimensions: c.embeddings.dimensions,
      },
      vectorStore: await this.index.vectorMode(),
    };
  }

  /* ───────────── providers ───────────── */

  private provider(c: AiConfig): ChatProvider {
    if (c.chat.provider === 'none')
      throw new HttpError(409, ErrorCodes.AI_NOT_CONFIGURED, 'No AI chat model is configured');
    if (c.chat.provider === 'anthropic') {
      if (!c.chat.apiKey)
        throw new HttpError(409, ErrorCodes.AI_NOT_CONFIGURED, 'The Anthropic API key is missing');
      return new AnthropicProvider(c.chat.apiKey, connectionOf(c.chat));
    }
    const conn = connectionOf(c.chat);
    return c.chat.apiStyle === 'responses'
      ? new OpenAiResponsesProvider(conn)
      : new OpenAiCompatibleProvider(conn);
  }

  embedder(c: AiConfig, moduleId = 'core', feature = 'core.index'): Embedder {
    if (c.embeddings.provider === 'builtin')
      return { model: BUILTIN_MODEL, embed: async (texts) => texts.map(builtinEmbed) };
    const e = c.embeddings;
    return {
      model: e.model,
      embed: async (texts) => {
        if (!texts.length) return [];
        const started = Date.now();
        const vectors: number[][] = [];
        let tokens = 0;
        try {
          for (let i = 0; i < texts.length; i += 64) {
            const batch = texts.slice(i, i + 64);
            const res = await aiPost(connectionOf(e), '/embeddings', {
              model: e.model,
              input: batch,
              ...(e.dimensions && /api\.openai\.com/.test(e.baseUrl!) ? { dimensions: e.dimensions } : {}),
            });
            const data = (await res.json()) as {
              data: { embedding: number[]; index: number }[];
              usage?: { prompt_tokens?: number; total_tokens?: number };
            };
            const sorted = [...data.data].sort((a, b) => a.index - b.index);
            vectors.push(...sorted.map((d) => normalize(d.embedding)));
            tokens += data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0;
          }
          await this.logUsage({
            moduleId,
            feature,
            kind: 'embed',
            principal: currentPrincipal(),
            provider: 'openai-compatible',
            model: e.model,
            inputTokens: tokens,
            costUsd: (tokens * e.price) / 1_000_000,
            latencyMs: Date.now() - started,
            status: 'ok',
          });
          return vectors;
        } catch (err) {
          await this.logUsage({
            moduleId,
            feature,
            kind: 'embed',
            principal: currentPrincipal(),
            provider: 'openai-compatible',
            model: e.model,
            latencyMs: Date.now() - started,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
    };
  }

  /* ───────────── usage & budget ───────────── */

  async logUsage(row: UsageRow) {
    try {
      await this.deps.db.insert(aiUsage).values({
        moduleId: row.moduleId,
        feature: row.feature.slice(0, 120),
        kind: row.kind,
        principalType: row.principal.type,
        userId: row.principal.type === 'user' ? row.principal.id : (row.principal.onBehalfOf?.id ?? null),
        principalName: row.principal.name.slice(0, 200),
        provider: row.provider,
        model: row.model,
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        costUsd: row.costUsd ?? 0,
        latencyMs: row.latencyMs ?? null,
        status: row.status,
        error: row.error?.slice(0, 300) ?? null,
        masked: row.masked ?? 0,
      });
      if (row.costUsd && this.budgetCache) this.budgetCache.spent += row.costUsd;
    } catch (err) {
      this.deps.logger.warn({ err }, 'failed to record AI usage');
    }
  }

  async monthSpend(): Promise<number> {
    if (this.budgetCache && Date.now() - this.budgetCache.at < 60_000) return this.budgetCache.spent;
    const res = await this.deps.db.execute<{ spent: number }>(sql`
      select coalesce(sum(cost_usd), 0)::float8 as spent from core.ai_usage
      where created_at >= date_trunc('month', now())`);
    this.budgetCache = { at: Date.now(), spent: Number(res.rows[0]?.spent ?? 0) };
    return this.budgetCache.spent;
  }

  /* ───────────── chat ───────────── */

  private async prepare<T>(moduleId: string, req: AiChatRequest<T>, auth?: AuthContext) {
    const c = await this.config();
    const provider = this.provider(c);
    const chat = c.chat as Exclude<AiConfig['chat'], { provider: 'none' }>;
    const principal = auth?.principal ?? currentPrincipal();
    if (c.monthlyBudgetUsd > 0 && (await this.monthSpend()) >= c.monthlyBudgetUsd) {
      await this.logUsage({
        moduleId,
        feature: req.feature,
        kind: 'chat',
        principal,
        provider: provider.name,
        model: chat.model,
        status: 'blocked',
        error: 'budget',
      });
      throw new HttpError(429, ErrorCodes.AI_BUDGET_EXCEEDED, 'The monthly AI budget is spent');
    }
    const masker = new Masker(
      c.masking.enabled ? { categories: c.masking.categories, custom: c.masking.custom } : { categories: [] },
    );
    const toolDefs = (req.tools ?? []).map((name) => {
      const tool = this.tools.find(name);
      if (!tool) throw new HttpError(400, ErrorCodes.BAD_REQUEST, `Unknown AI tool "${name}"`);
      return {
        name: wireName(name),
        description: tool.def.description,
        inputSchema: z.toJSONSchema(tool.def.input, { unrepresentable: 'any', io: 'input' }) as Record<
          string,
          unknown
        >,
      };
    });
    const maskMessage = (m: AiMessage): AiMessage => ({
      ...m,
      content: m.content == null ? m.content : masker.mask(m.content),
      toolCalls: m.toolCalls?.map((tc) => ({
        ...tc,
        name: wireName(tc.name),
        input: maskJson(tc.input, masker),
      })),
      // Native content is replayed as-is: it was produced by the provider from already-masked input.
    });
    const preq: ProviderRequest = {
      model: chat.model,
      system: req.system ? masker.mask(req.system) : undefined,
      messages: req.messages.map(maskMessage),
      tools: toolDefs,
      schema: req.schema
        ? (z.toJSONSchema(req.schema, { unrepresentable: 'any' }) as Record<string, unknown>)
        : undefined,
      effort: req.effort,
      maxTokens: req.maxTokens ?? (req.schema ? 4_000 : 16_000),
    };
    return { provider, chat, principal, masker, preq };
  }

  private async finish<T>(
    moduleId: string,
    req: AiChatRequest<T>,
    ctx: Awaited<ReturnType<AiGateway['prepare']>>,
    out: ProviderOutput,
    started: number,
  ): Promise<AiChatResult<T>> {
    const text = ctx.masker.unmask(out.text);
    const toolCalls = out.toolCalls.map((c) => ({
      id: c.id,
      name: this.tools.fromWire(c.name),
      input: unmaskJson(c.input, ctx.masker),
    }));
    let output: T | null = null;
    if (req.schema && out.stopReason === 'end') {
      const parsed = req.schema.safeParse(unmaskJson(safeJson(extractJson(out.text)), ctx.masker));
      output = parsed.success ? parsed.data : null;
    }
    const costUsd = costOf(ctx.chat.prices, out.usage.inputTokens, out.usage.outputTokens);
    await this.logUsage({
      moduleId,
      feature: req.feature,
      kind: 'chat',
      principal: ctx.principal,
      provider: ctx.provider.name,
      model: ctx.chat.model,
      inputTokens: out.usage.inputTokens,
      outputTokens: out.usage.outputTokens,
      costUsd,
      latencyMs: Date.now() - started,
      status: out.stopReason === 'refusal' ? 'refused' : 'ok',
      masked: ctx.masker.count,
    });
    return {
      text,
      output,
      toolCalls,
      stopReason: out.stopReason,
      message: {
        role: 'assistant',
        content: text,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        native: out.native
          ? { provider: ctx.provider.wire, model: ctx.chat.model, content: out.native }
          : undefined,
      },
      usage: { inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, costUsd },
      provider: ctx.provider.name,
      model: ctx.chat.model,
    };
  }

  private async failed(
    moduleId: string,
    feature: string,
    ctx: Awaited<ReturnType<AiGateway['prepare']>>,
    err: unknown,
    started: number,
  ) {
    await this.logUsage({
      moduleId,
      feature,
      kind: 'chat',
      principal: ctx.principal,
      provider: ctx.provider.name,
      model: ctx.chat.model,
      latencyMs: Date.now() - started,
      status: 'error',
      error:
        err instanceof HttpError
          ? String((err.details as { reason?: string })?.reason ?? err.code)
          : String(err),
      masked: ctx.masker.count,
    });
  }

  async chat<T>(moduleId: string, req: AiChatRequest<T>, auth?: AuthContext): Promise<AiChatResult<T>> {
    const ctx = await this.prepare(moduleId, req, auth);
    const started = Date.now();
    try {
      return await this.finish(moduleId, req, ctx, await ctx.provider.chat(ctx.preq), started);
    } catch (err) {
      await this.failed(moduleId, req.feature, ctx, err, started);
      throw err;
    }
  }

  async *stream<T>(
    moduleId: string,
    req: AiChatRequest<T>,
    auth?: AuthContext,
  ): AsyncIterable<AiStreamEvent<T>> {
    const ctx = await this.prepare(moduleId, req, auth);
    const started = Date.now();
    // Placeholders can straddle deltas: hold back an unfinished `[…` before unmasking.
    let pending = '';
    try {
      for await (const evt of ctx.provider.stream(ctx.preq)) {
        if (evt.type === 'text') {
          pending += evt.delta;
          const cut = pending.lastIndexOf('[');
          const safe = cut >= 0 && !pending.slice(cut).includes(']') ? pending.slice(0, cut) : pending;
          pending = pending.slice(safe.length);
          if (safe) yield { type: 'text', delta: ctx.masker.unmask(safe) };
        } else {
          if (pending) yield { type: 'text', delta: ctx.masker.unmask(pending) };
          yield { type: 'done', result: await this.finish(moduleId, req, ctx, evt.output, started) };
        }
      }
    } catch (err) {
      await this.failed(moduleId, req.feature, ctx, err, started);
      throw err;
    }
  }

  /** A one-shot request to verify the configuration (Administration → AI → Test). */
  async test(): Promise<{
    chat: { ok: boolean; model: string | null; latencyMs: number; error?: string };
    embeddings: { ok: boolean; dimensions: number; latencyMs: number; error?: string };
  }> {
    const c = await this.config();
    const result = {
      chat: { ok: false, model: null as string | null, latencyMs: 0, error: undefined as string | undefined },
      embeddings: { ok: false, dimensions: 0, latencyMs: 0, error: undefined as string | undefined },
    };
    if (c.chat.provider !== 'none') {
      const t = Date.now();
      try {
        await this.chat('core', {
          feature: 'core.ai.test',
          messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          effort: 'low',
          maxTokens: 512,
        });
        result.chat = { ok: true, model: c.chat.model, latencyMs: Date.now() - t, error: undefined };
      } catch (err) {
        result.chat = { ok: false, model: c.chat.model, latencyMs: Date.now() - t, error: reasonOf(err) };
      }
    }
    const t = Date.now();
    try {
      const [v] = await this.embedder(c, 'core', 'core.ai.test').embed(['connection test']);
      result.embeddings = {
        ok: true,
        dimensions: v?.length ?? 0,
        latencyMs: Date.now() - t,
        error: undefined,
      };
    } catch (err) {
      result.embeddings = { ok: false, dimensions: 0, latencyMs: Date.now() - t, error: reasonOf(err) };
    }
    return result;
  }

  /* ───────────── agent identity ───────────── */

  agentAuth(manifest: ModuleManifest): AuthContext {
    const agent = manifest.ai?.agent;
    if (!agent) throw new Error(`[${manifest.id}] declares no ai.agent identity`);
    const permissions = new PermissionSet(agent.permissions.map((p) => ({ p, s: 'g' as const })));
    return buildAuthContext({ type: 'ai_agent', id: null, name: agent.name }, null, null, permissions);
  }

  /* ───────────── per-module service ───────────── */

  forModule(manifest: ModuleManifest): AiService {
    const moduleId = manifest.id;
    return {
      status: () => this.status(),
      chat: (req, opts) => this.chat(moduleId, req, opts?.auth),
      stream: (req, opts) => this.stream(moduleId, req, opts?.auth),
      embed: async (texts, opts) => this.embedder(await this.config(), moduleId, opts.feature).embed(texts),
      index: {
        upsert: async (doc: AiIndexDocument) =>
          this.index.upsert(doc, this.embedder(await this.config(), moduleId, `${moduleId}.index`)),
        remove: (type, id) => this.index.remove(type, id),
        search: async (query: string, opts: AiSearchOptions) =>
          this.index.search(query, opts, this.embedder(await this.config(), moduleId, `${moduleId}.search`)),
      },
      tools: {
        list: (auth) => this.tools.list(auth),
        invoke: (name, input, opts) => this.tools.invoke(moduleId, name, input, opts),
      },
      agent: () => this.agentAuth(manifest),
      mcp: (auth, opts) => {
        if (!this.mcpServer) throw new Error('The MCP server is not attached');
        return this.mcpServer.session(auth, { via: moduleId, ...opts });
      },
    };
  }

  /** Re-embeds documents left on an older embedding model (scheduled job, bounded per run). */
  async reindexStale(limit = 50): Promise<number> {
    const c = await this.config();
    const embedder = this.embedder(c);
    const stale = await this.index.staleDocuments(embedder.model, limit);
    for (const d of stale) await this.index.reembed(d.source_type, d.source_id, embedder);
    return stale.length;
  }
}

function reasonOf(err: unknown): string {
  if (err instanceof HttpError) {
    const d = err.details as { reason?: string; detail?: string } | undefined;
    return [d?.reason ?? err.code, d?.detail].filter(Boolean).join(': ');
  }
  return err instanceof Error ? err.message : String(err);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Models sometimes wrap JSON in prose or code fences. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) return fenced[1]!;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function maskJson(value: unknown, masker: Masker): unknown {
  if (typeof value === 'string') return masker.mask(value);
  if (Array.isArray(value)) return value.map((v) => maskJson(v, masker));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskJson(v, masker)]));
  return value;
}

function unmaskJson(value: unknown, masker: Masker): unknown {
  if (typeof value === 'string') return masker.unmask(value);
  if (Array.isArray(value)) return value.map((v) => unmaskJson(v, masker));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmaskJson(v, masker)]));
  return value;
}
