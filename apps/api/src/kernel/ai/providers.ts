import Anthropic from '@anthropic-ai/sdk';
import type { AiEffort, AiImage, AiMessage } from '@isbp/sdk/server';
import { HttpError } from '@isbp/sdk/server';
import {
  type AiConnection,
  aiPost,
  connectionFetch,
  headerObject,
  isAzure,
  providerError,
  tlsReason,
} from './connection';

export { providerError } from './connection';

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
  /** The configured provider (usage reports). */
  readonly name: 'anthropic' | 'openai-compatible';
  /** Wire format: a stored assistant turn's native content is replayed only to the same wire and model. */
  readonly wire: 'anthropic' | 'openai-chat' | 'openai-responses';
  chat(req: ProviderRequest): Promise<ProviderOutput>;
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}

/* ───────────────────────────── Anthropic (official SDK) ───────────────────────────── */

/** Models that take `output_config.effort` (Haiku 4.5 and older models reject it). */
const supportsEffort = (model: string) => /^claude-(opus|sonnet|fable|mythos)-(4-[6-9]|[5-9])/.test(model);
/** Models whose refusals can be rescued server-side (`fallbacks: "default"`, Claude API only). */
const supportsFallbacks = (model: string) => /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/.test(model);

export class AnthropicProvider implements ChatProvider {
  readonly name = 'anthropic' as const;
  readonly wire = 'anthropic' as const;
  private readonly client: Anthropic;
  private readonly firstParty: boolean;

  /** `conn.baseUrl` empty means the Claude API; custom headers and the TLS switch apply to gateways too. */
  constructor(apiKey: string, conn: Pick<AiConnection, 'baseUrl' | 'headers' | 'insecureTls'>) {
    const baseUrl = conn.baseUrl || null;
    this.client = new Anthropic({
      apiKey,
      baseURL: baseUrl ?? undefined,
      maxRetries: 2,
      timeout: 120_000,
      ...(conn.headers.length ? { defaultHeaders: headerObject(conn.headers) } : {}),
      ...(conn.insecureTls ? { fetch: connectionFetch(conn) } : {}),
    });
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
  if (err instanceof Anthropic.APIConnectionError) return providerError(tlsReason(err) ?? 'unreachable', err);
  if (err instanceof Anthropic.APIError) return providerError(`status_${err.status ?? 'unknown'}`, err);
  return providerError('unknown', err);
}

function toAnthropicMessages(messages: AiMessage[], model: string): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user')
      out.push({
        role: 'user',
        content: m.images?.length
          ? [
              ...m.images.map((i): Anthropic.Beta.BetaImageBlockParam => ({
                type: 'image',
                source: { type: 'base64', media_type: i.mediaType, data: i.data },
              })),
              { type: 'text', text: m.content || ' ' },
            ]
          : (m.content ?? ''),
      });
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

/* ───────────────────────────── OpenAI-compatible: shared ───────────────────────────── */

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Server-sent events of a response body: `{ event, data }` per `data:` line (data parsed as JSON). */
async function* sseEvents(res: Response): AsyncIterable<{ event: string | null; data: unknown }> {
  if (!res.body) throw providerError('empty_response');
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | null = null;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) {
        event = null;
        continue;
      }
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      const data = safeJson(payload);
      if (data !== null) yield { event, data };
    }
  }
}

const dataUrl = (i: AiImage) => `data:${i.mediaType};base64,${i.data}`;

/** OpenAI's own API wants `max_completion_tokens`; most compatible servers still read `max_tokens`. */
const officialOpenAi = (baseUrl: string) => /api\.openai\.com/i.test(baseUrl) || isAzure(baseUrl);

/* ───────────────────────────── OpenAI-compatible: Chat Completions ───────────────────────────── */

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    string | null | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
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
  readonly wire = 'openai-chat' as const;

  constructor(private readonly conn: AiConnection) {}

  private body(req: ProviderRequest, stream: boolean) {
    const messages: OaiMessage[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      if (m.role === 'user')
        messages.push({
          role: 'user',
          content: m.images?.length
            ? [
                // Images before the question, like the Anthropic provider (what vision models expect).
                ...m.images.map((i) => ({ type: 'image_url' as const, image_url: { url: dataUrl(i) } })),
                { type: 'text' as const, text: m.content ?? '' },
              ]
            : (m.content ?? ''),
        });
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
    return {
      model: req.model,
      messages,
      ...(officialOpenAi(this.conn.baseUrl)
        ? { max_completion_tokens: req.maxTokens }
        : { max_tokens: req.maxTokens }),
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
    const res = await aiPost(this.conn, '/chat/completions', this.body(req, false));
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
    const res = await aiPost(this.conn, '/chat/completions', this.body(req, true));
    let text = '';
    let finish: string | null = null;
    let usage: OaiResponse['usage'];
    const calls: { id: string; name: string; args: string }[] = [];
    for await (const { data } of sseEvents(res)) {
      const evt = data as {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
        usage?: OaiResponse['usage'];
      };
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
    yield { type: 'done', output: this.output(text, calls.filter(Boolean), finish, usage) };
  }
}

/* ───────────────────────────── OpenAI-compatible: Responses API ───────────────────────────── */

/** An output item of the Responses API (only the fields the gateway reads). */
interface ResponsesItem {
  type: string;
  id?: string;
  role?: string;
  content?: { type: string; text?: string; refusal?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
  encrypted_content?: string | null;
  [key: string]: unknown;
}

export interface ResponsesResult {
  status?: string;
  output?: ResponsesItem[];
  incomplete_details?: { reason?: string } | null;
  error?: { code?: string; message?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * The OpenAI Responses API (`POST /responses`): OpenAI, Azure OpenAI, vLLM, Ollama, LM Studio, LiteLLM and other
 * gateways that implement it. Requests are stateless (`store: false`): the whole conversation is sent each time,
 * and an assistant turn's output items are replayed unchanged to the same model.
 */
export class OpenAiResponsesProvider implements ChatProvider {
  readonly name = 'openai-compatible' as const;
  readonly wire = 'openai-responses' as const;

  constructor(private readonly conn: AiConnection) {}

  private input(req: ProviderRequest): unknown[] {
    const items: unknown[] = [];
    for (const m of req.messages) {
      if (m.role === 'user')
        items.push({
          role: 'user',
          content: m.images?.length
            ? [
                ...m.images.map((i) => ({ type: 'input_image', image_url: dataUrl(i) })),
                { type: 'input_text', text: m.content ?? '' },
              ]
            : (m.content ?? ''),
        });
      else if (m.role === 'assistant') {
        if (
          m.native?.provider === this.wire &&
          m.native.model === req.model &&
          Array.isArray(m.native.content)
        ) {
          // Reasoning goes back only to OpenAI/Azure, with its encrypted content (stateless requests); other
          // servers (vLLM) reject replayed reasoning. SDK-only fields are dropped.
          const official = officialOpenAi(this.conn.baseUrl);
          for (const item of m.native.content as ResponsesItem[]) {
            if (item.type === 'reasoning' && !(official && item.encrypted_content)) continue;
            const { created_by: _by, parsed: _parsed, ...rest } = item;
            items.push(rest);
          }
          continue;
        }
        if (m.content) items.push({ role: 'assistant', content: m.content });
        for (const c of m.toolCalls ?? [])
          items.push({
            type: 'function_call',
            call_id: c.id,
            name: c.name,
            arguments: JSON.stringify(c.input ?? {}),
          });
      } else
        items.push({ type: 'function_call_output', call_id: m.toolCallId ?? '', output: m.content ?? '' });
    }
    return items;
  }

  private body(req: ProviderRequest, stream: boolean) {
    const official = officialOpenAi(this.conn.baseUrl);
    return {
      model: req.model,
      ...(req.system ? { instructions: req.system } : {}),
      input: this.input(req),
      max_output_tokens: req.maxTokens,
      store: false,
      // Reasoning models continue a tool loop only with their reasoning; other servers may not know `include`.
      ...(official ? { include: ['reasoning.encrypted_content'] } : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
              strict: false,
            })),
          }
        : {}),
      ...(req.schema
        ? { text: { format: { type: 'json_schema', name: 'output', schema: req.schema, strict: false } } }
        : {}),
      ...(stream ? { stream: true } : {}),
    };
  }

  async chat(req: ProviderRequest): Promise<ProviderOutput> {
    const res = await aiPost(this.conn, '/responses', this.body(req, false));
    return responsesOutput((await res.json()) as ResponsesResult);
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const res = await aiPost(this.conn, '/responses', this.body(req, true));
    // Completed items, in case the server ends the stream without a final `response.*` event.
    const done: ResponsesItem[] = [];
    let final: ResponsesResult | null = null;
    for await (const { event, data } of sseEvents(res)) {
      const evt = data as {
        type?: string;
        delta?: string;
        item?: ResponsesItem;
        output_index?: number;
        response?: ResponsesResult;
        code?: string;
        message?: string;
      };
      const type = evt.type ?? event;
      if (type === 'response.output_text.delta' && evt.delta) yield { type: 'text', delta: evt.delta };
      else if (type === 'response.output_item.done' && evt.item)
        done[evt.output_index ?? done.length] = evt.item;
      else if (type === 'response.completed' || type === 'response.incomplete') final = evt.response ?? null;
      else if (type === 'response.failed')
        throw providerError(
          evt.response?.error?.code ?? 'failed',
          new Error(evt.response?.error?.message ?? 'The response failed'),
        );
      else if (type === 'error')
        throw providerError(evt.code ?? 'stream_error', new Error(evt.message ?? 'Stream error'));
    }
    yield {
      type: 'done',
      output: responsesOutput(final?.output?.length ? final : { ...final, output: done.filter(Boolean) }),
    };
  }
}

/** A Responses API result as provider output: text, function calls, why it stopped, usage. */
export function responsesOutput(data: ResponsesResult): ProviderOutput {
  if (data.error?.message) throw providerError(data.error.code ?? 'failed', new Error(data.error.message));
  const output = data.output ?? [];
  let text = '';
  let refused = false;
  const toolCalls: ProviderOutput['toolCalls'] = [];
  for (const item of output) {
    if (item.type === 'message')
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text) text += part.text;
        else if (part.type === 'refusal') {
          refused = true;
          if (part.refusal) text += part.refusal;
        }
      }
    else if (item.type === 'function_call' && item.name)
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call_${toolCalls.length}`,
        name: item.name,
        input: safeJson(item.arguments ?? '{}'),
      });
  }
  const incomplete = data.status === 'incomplete' ? data.incomplete_details?.reason : undefined;
  return {
    text,
    toolCalls,
    stopReason: toolCalls.length
      ? 'tool_use'
      : refused || incomplete === 'content_filter'
        ? 'refusal'
        : incomplete === 'max_output_tokens'
          ? 'max_tokens'
          : 'end',
    native: output,
    usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
  };
}
