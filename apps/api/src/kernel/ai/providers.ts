import Anthropic from '@anthropic-ai/sdk';
import type { AiEffort, AiMessage } from '@isbp/sdk/server';
import { ErrorCodes, HttpError } from '@isbp/sdk/server';

export interface WireTool {
  /** Wire-safe name (`itsm__create_ticket`). */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  system?: string;
  messages: AiMessage[];
  tools?: WireTool[];
  /** JSON Schema for structured output. */
  schema?: Record<string, unknown>;
  effort?: AiEffort;
  maxTokens: number;
}

export interface ProviderOutput {
  text: string;
  toolCalls: { id: string; name: string; input: unknown }[];
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal';
  /** Provider-native assistant content, replayed unchanged on the same provider and model. */
  native: unknown;
  usage: { inputTokens: number; outputTokens: number };
}

export type ProviderEvent = { type: 'text'; delta: string } | { type: 'done'; output: ProviderOutput };

export interface ChatProvider {
  readonly name: 'anthropic' | 'openai-compatible';
  chat(req: ProviderRequest): Promise<ProviderOutput>;
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}

export function providerError(reason: string, err?: unknown): HttpError {
  const detail = err instanceof Error ? err.message.slice(0, 200) : undefined;
  return new HttpError(502, ErrorCodes.AI_PROVIDER_ERROR, 'The AI provider request failed', {
    reason,
    detail,
  });
}

/* ───────────────────────────── Anthropic (official SDK) ───────────────────────────── */

/** Models that take `output_config.effort` (Haiku 4.5 and older models reject it). */
const supportsEffort = (model: string) => /^claude-(opus|sonnet|fable|mythos)-(4-[6-9]|[5-9])/.test(model);
/** Models whose refusals can be rescued server-side (`fallbacks: "default"`, Claude API only). */
const supportsFallbacks = (model: string) => /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/.test(model);

export class AnthropicProvider implements ChatProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;
  private readonly firstParty: boolean;

  constructor(apiKey: string, baseUrl?: string | null) {
    this.client = new Anthropic({ apiKey, baseURL: baseUrl || undefined, maxRetries: 2, timeout: 120_000 });
    this.firstParty = !baseUrl || /^https:\/\/api\.anthropic\.com\/?$/.test(baseUrl);
  }

  private params(req: ProviderRequest): Anthropic.Beta.MessageCreateParamsNonStreaming {
    const fallbacks = this.firstParty && supportsFallbacks(req.model);
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: toAnthropicMessages(req.messages, req.model),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
            })),
          }
        : {}),
      ...(req.schema || (req.effort && supportsEffort(req.model))
        ? {
            output_config: {
              ...(req.effort && supportsEffort(req.model) ? { effort: req.effort } : {}),
              ...(req.schema ? { format: { type: 'json_schema' as const, schema: req.schema } } : {}),
            },
          }
        : {}),
      // A safety decline on the requested model is retried server-side on a suitable fallback model.
      ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    };
  }

  async chat(req: ProviderRequest): Promise<ProviderOutput> {
    try {
      const res = await this.client.beta.messages.create(this.params(req));
      return fromAnthropic(res);
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    try {
      const stream = this.client.beta.messages.stream(this.params(req));
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
          yield { type: 'text', delta: event.delta.text };
      }
      yield { type: 'done', output: fromAnthropic(await stream.finalMessage()) };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}

function mapAnthropicError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return providerError('auth', err);
  if (err instanceof Anthropic.RateLimitError) return providerError('rate_limited', err);
  if (err instanceof Anthropic.BadRequestError) return providerError('bad_request', err);
  if (err instanceof Anthropic.APIConnectionError) return providerError('unreachable', err);
  if (err instanceof Anthropic.APIError) return providerError(`status_${err.status ?? 'unknown'}`, err);
  return providerError('unknown', err);
}

function toAnthropicMessages(messages: AiMessage[], model: string): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content ?? '' });
    else if (m.role === 'assistant') {
      if (m.native?.provider === 'anthropic' && m.native.model === model) {
        out.push({ role: 'assistant', content: m.native.content as Anthropic.Beta.BetaContentBlockParam[] });
        continue;
      }
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? [])
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input as Record<string, unknown> });
      out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] });
    } else {
      // Consecutive tool results share one user turn.
      const block: Anthropic.Beta.BetaToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content ?? '',
        ...(m.isError ? { is_error: true } : {}),
      };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result')
        (last.content as Anthropic.Beta.BetaContentBlockParam[]).push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

function fromAnthropic(res: Anthropic.Beta.BetaMessage): ProviderOutput {
  let text = '';
  const toolCalls: ProviderOutput['toolCalls'] = [];
  for (const b of res.content) {
    if (b.type === 'text') text += b.text;
    else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, input: b.input });
  }
  const stop = res.stop_reason;
  return {
    text,
    toolCalls,
    stopReason:
      stop === 'tool_use'
        ? 'tool_use'
        : stop === 'max_tokens'
          ? 'max_tokens'
          : stop === 'refusal'
            ? 'refusal'
            : 'end',
    native: res.content,
    usage: {
      inputTokens:
        res.usage.input_tokens +
        (res.usage.cache_read_input_tokens ?? 0) +
        (res.usage.cache_creation_input_tokens ?? 0),
      outputTokens: res.usage.output_tokens,
    },
  };
}

/* ───────────────────────────── OpenAI-compatible (fetch) ───────────────────────────── */

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface OaiResponse {
  choices: {
    message: { content: string | null; tool_calls?: OaiMessage['tool_calls'] };
    finish_reason: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * OpenAI Chat Completions wire format — OpenAI, Azure OpenAI, Ollama, vLLM, LM Studio, LiteLLM and other
 * self-hosted gateways speak it.
 */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly name = 'openai-compatible' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}

  private request(path: string, body: unknown, signal?: AbortSignal) {
    return openAiFetch(this.baseUrl, this.apiKey, path, body, signal);
  }

  private body(req: ProviderRequest, stream: boolean) {
    const messages: OaiMessage[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      if (m.role === 'user') messages.push({ role: 'user', content: m.content ?? '' });
      else if (m.role === 'assistant')
        messages.push({
          role: 'assistant',
          content: m.content ?? null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
                })),
              }
            : {}),
        });
      else messages.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content ?? '' });
    }
    const openAi = /api\.openai\.com/.test(this.baseUrl);
    return {
      model: req.model,
      messages,
      ...(openAi ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
      ...(req.schema
        ? { response_format: { type: 'json_schema', json_schema: { name: 'output', schema: req.schema } } }
        : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
  }

  async chat(req: ProviderRequest): Promise<ProviderOutput> {
    const res = await this.request('/chat/completions', this.body(req, false));
    const data = (await res.json()) as OaiResponse;
    const choice = data.choices?.[0];
    if (!choice) throw providerError('empty_response');
    return this.output(
      choice.message.content ?? '',
      (choice.message.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        args: c.function.arguments,
      })),
      choice.finish_reason,
      data.usage,
    );
  }

  private output(
    text: string,
    calls: { id: string; name: string; args: string }[],
    finish: string | null,
    usage: OaiResponse['usage'],
  ): ProviderOutput {
    const toolCalls = calls.map((c) => ({ id: c.id, name: c.name, input: safeJson(c.args) }));
    return {
      text,
      toolCalls,
      stopReason: toolCalls.length
        ? 'tool_use'
        : finish === 'length'
          ? 'max_tokens'
          : finish === 'content_filter'
            ? 'refusal'
            : 'end',
      native: null,
      usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 },
    };
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const res = await this.request('/chat/completions', this.body(req, true));
    if (!res.body) throw providerError('empty_response');
    let text = '';
    let finish: string | null = null;
    let usage: OaiResponse['usage'];
    const calls: { id: string; name: string; args: string }[] = [];
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        const evt = safeJson(payload) as {
          choices?: {
            delta?: {
              content?: string | null;
              tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
            finish_reason?: string | null;
          }[];
          usage?: OaiResponse['usage'];
        } | null;
        if (!evt) continue;
        if (evt.usage) usage = evt.usage;
        const choice = evt.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          yield { type: 'text', delta: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const cur = (calls[tc.index] ??= { id: tc.id ?? `call_${tc.index}`, name: '', args: '' });
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
        }
      }
    }
    yield { type: 'done', output: this.output(text, calls.filter(Boolean), finish, usage) };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** POST to an OpenAI-style API (Azure: `api-key` header + `api-version`). */
export async function openAiFetch(
  baseUrl: string,
  apiKey: string | null,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const azure = /\.openai\.azure\.com/.test(baseUrl);
  const url = new URL(baseUrl.replace(/\/+$/, '') + path);
  if (azure && !url.searchParams.has('api-version')) url.searchParams.set('api-version', '2024-10-21');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) {
    if (azure) headers['api-key'] = apiKey;
    else headers.authorization = `Bearer ${apiKey}`;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw providerError('unreachable', err);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    const reason =
      res.status === 401 || res.status === 403
        ? 'auth'
        : res.status === 429
          ? 'rate_limited'
          : `status_${res.status}`;
    throw new HttpError(502, ErrorCodes.AI_PROVIDER_ERROR, 'The AI provider request failed', {
      reason,
      detail,
    });
  }
  return res;
}
