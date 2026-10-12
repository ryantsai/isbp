import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAiConfig } from '../../src/kernel/ai/config';
import { type AiConnection, aiPost, mergeHeaders, parseHeaders } from '../../src/kernel/ai/connection';
import {
  AnthropicProvider,
  OpenAiCompatibleProvider,
  OpenAiResponsesProvider,
  responsesOutput,
} from '../../src/kernel/ai/providers';

type Handler = (req: IncomingMessage, body: unknown, res: ServerResponse) => void;

/** A local HTTP(S) server that records requests and answers with `handler`. */
async function serve(handler: Handler, tls = false) {
  const seen: { url: string; headers: IncomingMessage['headers']; body: unknown }[] = [];
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as unknown) : null;
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      handler(req, body, res);
    });
  };
  const dir = join(import.meta.dirname, '..', 'fixtures', 'tls');
  const server = tls
    ? createHttpsServer(
        { key: readFileSync(join(dir, 'localhost.key')), cert: readFileSync(join(dir, 'localhost.crt')) },
        onRequest,
      )
    : createHttpServer(onRequest);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `${tls ? 'https' : 'http'}://localhost:${port}/v1`,
    seen,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const json = (res: ServerResponse, data: unknown) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

const sse = (res: ServerResponse, events: { event?: string; data: unknown }[]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events)
    res.write(`${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`);
  res.end();
};

const conn = (baseUrl: string, extra: Partial<AiConnection> = {}): AiConnection => ({
  baseUrl,
  apiKey: 'sk-test',
  headers: [],
  insecureTls: false,
  ...extra,
});

describe('custom headers', () => {
  it('parse from the sealed setting and ignore anything malformed', () => {
    expect(parseHeaders('[{"name":"X-Tenant","value":"a"}]')).toEqual([{ name: 'X-Tenant', value: 'a' }]);
    expect(parseHeaders('not json')).toEqual([]);
    expect(parseHeaders('[{"name":1}]')).toEqual([]);
    expect(parseHeaders(null)).toEqual([]);
  });

  it('keep stored values for headers sent without one, and drop new headers without a value', () => {
    const stored = [
      { name: 'X-Tenant', value: 'acme' },
      { name: 'X-Token', value: 'secret' },
    ];
    expect(
      mergeHeaders(stored, [{ name: 'x-tenant' }, { name: 'X-Route', value: 'eu' }, { name: 'X-New' }]),
    ).toEqual([
      { name: 'x-tenant', value: 'acme' },
      { name: 'X-Route', value: 'eu' },
    ]);
    // Leaving a header out removes it.
    expect(mergeHeaders(stored, [])).toEqual([]);
  });

  it('are read into the chat and embeddings config with the API style and TLS switch', () => {
    const c = readAiConfig({
      'ai.chat.provider': 'openai-compatible',
      'ai.chat.baseUrl': 'https://llm.internal/v1',
      'ai.chat.model': 'qwen3',
      'ai.chat.apiStyle': 'responses',
      'ai.chat.headers': '[{"name":"X-Tenant","value":"acme"}]',
      'ai.chat.insecureTls': true,
      'ai.embeddings.provider': 'openai-compatible',
      'ai.embeddings.baseUrl': 'https://emb.internal/v1',
      'ai.embeddings.model': 'bge-m3',
      'ai.embeddings.insecureTls': true,
    });
    expect(c.chat).toMatchObject({
      apiStyle: 'responses',
      headers: [{ name: 'X-Tenant', value: 'acme' }],
      insecureTls: true,
    });
    expect(c.embeddings).toMatchObject({ headers: [], insecureTls: true });
    expect(readAiConfig({}).embeddings.insecureTls).toBe(false);
    expect(
      readAiConfig({
        'ai.chat.provider': 'openai-compatible',
        'ai.chat.baseUrl': 'http://x/v1',
        'ai.chat.model': 'm',
      }).chat,
    ).toMatchObject({ apiStyle: 'chat-completions', insecureTls: false });
  });
});

describe('aiPost', () => {
  it('sends the key as a bearer token and custom headers last (they may replace it)', async () => {
    const srv = await serve((_req, _body, res) => json(res, { ok: true }));
    try {
      await aiPost(conn(srv.url, { headers: [{ name: 'X-Tenant', value: 'acme' }] }), '/embeddings', {});
      await aiPost(conn(srv.url, { headers: [{ name: 'Authorization', value: 'Token abc' }] }), '/x', {});
      expect(srv.seen[0]!.url).toBe('/v1/embeddings');
      expect(srv.seen[0]!.headers.authorization).toBe('Bearer sk-test');
      expect(srv.seen[0]!.headers['x-tenant']).toBe('acme');
      expect(srv.seen[1]!.headers.authorization).toBe('Token abc');
    } finally {
      await srv.close();
    }
  });

  it('refuses a self-signed certificate with reason "tls", and accepts it with the TLS switch on', async () => {
    const srv = await serve((_req, _body, res) => json(res, { ok: true }), true);
    try {
      await expect(aiPost(conn(srv.url), '/embeddings', {})).rejects.toMatchObject({
        code: 'AI_PROVIDER_ERROR',
        details: { reason: 'tls' },
      });
      const res = await aiPost(conn(srv.url, { insecureTls: true }), '/embeddings', {});
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await srv.close();
    }
  });

  it('maps HTTP failures to provider errors', async () => {
    const srv = await serve((_req, _body, res) => {
      res.writeHead(401);
      res.end('bad key');
    });
    try {
      await expect(aiPost(conn(srv.url), '/embeddings', {})).rejects.toMatchObject({
        details: { reason: 'auth', detail: 'bad key' },
      });
    } finally {
      await srv.close();
    }
  });
});

describe('Responses API provider', () => {
  const tools = [{ name: 'itsm__my_tickets', description: 'My tickets', inputSchema: { type: 'object' } }];

  it('sends instructions, stateless input items and flat function tools', async () => {
    const srv = await serve((_req, _body, res) =>
      json(res, {
        status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] }],
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );
    try {
      const p = new OpenAiResponsesProvider(
        conn(srv.url, { headers: [{ name: 'X-Tenant', value: 'acme' }] }),
      );
      const out = await p.chat({
        model: 'gpt-x',
        system: 'Be brief',
        maxTokens: 100,
        tools,
        messages: [
          { role: 'user', content: 'Any tickets?' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'itsm__my_tickets', input: {} }],
          },
          { role: 'tool', toolCallId: 'call_1', content: '[]' },
        ],
      });
      expect(out).toMatchObject({
        text: 'Hi',
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 2 },
      });
      const { url, headers, body } = srv.seen[0]!;
      expect(url).toBe('/v1/responses');
      expect(headers['x-tenant']).toBe('acme');
      expect(body).toMatchObject({
        model: 'gpt-x',
        instructions: 'Be brief',
        max_output_tokens: 100,
        store: false,
        tools: [{ type: 'function', name: 'itsm__my_tickets', parameters: { type: 'object' } }],
        input: [
          { role: 'user', content: 'Any tickets?' },
          { type: 'function_call', call_id: 'call_1', name: 'itsm__my_tickets', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_1', output: '[]' },
        ],
      });
      // `include` is OpenAI's own; other servers may reject it.
      expect(body).not.toHaveProperty('include');
    } finally {
      await srv.close();
    }
  });

  it('replays a stored turn to the same model unchanged (reasoning only to OpenAI, with its encrypted content)', async () => {
    const srv = await serve((_req, _body, res) => json(res, { status: 'completed', output: [] }));
    try {
      const native = [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        { type: 'reasoning', id: 'rs_2', summary: [], encrypted_content: 'enc' },
        { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 't', arguments: '{}' },
      ];
      const p = new OpenAiResponsesProvider(conn(srv.url));
      const turn = {
        role: 'assistant' as const,
        content: '',
        native: { provider: 'openai-responses', model: 'm', content: native },
      };
      await p.chat({ model: 'm', maxTokens: 10, messages: [{ role: 'user', content: 'q' }, turn] });
      await p.chat({ model: 'other', maxTokens: 10, messages: [{ role: 'user', content: 'q' }, turn] });
      // A compatible server (vLLM rejects replayed reasoning) gets the function call only.
      const first = (srv.seen[0]!.body as { input: unknown[] }).input;
      expect(first).toEqual([{ role: 'user', content: 'q' }, native[2]]);
      // Another model gets the provider-neutral form (no tool calls on this turn, no text: nothing).
      expect((srv.seen[1]!.body as { input: unknown[] }).input).toEqual([{ role: 'user', content: 'q' }]);
    } finally {
      await srv.close();
    }
  });

  it('streams text deltas and returns function calls and usage from the final event', async () => {
    const final = {
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Let me look.' }] },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_7',
          name: 'itsm__my_tickets',
          arguments: '{"open":true}',
        },
      ],
      usage: { input_tokens: 30, output_tokens: 9 },
    };
    const srv = await serve((_req, _body, res) =>
      sse(res, [
        {
          event: 'response.created',
          data: { type: 'response.created', response: { status: 'in_progress' } },
        },
        {
          event: 'response.output_text.delta',
          data: { type: 'response.output_text.delta', delta: 'Let me ' },
        },
        { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', delta: 'look.' } },
        { event: 'response.completed', data: { type: 'response.completed', response: final } },
      ]),
    );
    try {
      const p = new OpenAiResponsesProvider(conn(srv.url));
      const deltas: string[] = [];
      let done: Awaited<ReturnType<typeof p.chat>> | null = null;
      for await (const e of p.stream({
        model: 'm',
        maxTokens: 10,
        tools,
        messages: [{ role: 'user', content: 'q' }],
      }))
        if (e.type === 'text') deltas.push(e.delta);
        else done = e.output;
      expect(deltas.join('')).toBe('Let me look.');
      expect(done).toMatchObject({
        stopReason: 'tool_use',
        toolCalls: [{ id: 'call_7', name: 'itsm__my_tickets', input: { open: true } }],
        usage: { inputTokens: 30, outputTokens: 9 },
      });
      expect((srv.seen[0]!.body as { stream: boolean }).stream).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('turns a failed stream into a provider error', async () => {
    const srv = await serve((_req, _body, res) =>
      sse(res, [
        {
          data: {
            type: 'response.failed',
            response: { status: 'failed', error: { code: 'server_error', message: 'boom' } },
          },
        },
      ]),
    );
    try {
      const p = new OpenAiResponsesProvider(conn(srv.url));
      const run = async () => {
        for await (const _ of p.stream({
          model: 'm',
          maxTokens: 10,
          messages: [{ role: 'user', content: 'q' }],
        }));
      };
      await expect(run()).rejects.toMatchObject({
        code: 'AI_PROVIDER_ERROR',
        details: { reason: 'server_error' },
      });
    } finally {
      await srv.close();
    }
  });

  it('maps incomplete and refused results to stop reasons', () => {
    const message = (part: { type: string; refusal?: string }) => [{ type: 'message', content: [part] }];
    expect(
      responsesOutput({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      }).stopReason,
    ).toBe('max_tokens');
    expect(
      responsesOutput({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] })
        .stopReason,
    ).toBe('refusal');
    expect(responsesOutput({ output: message({ type: 'refusal', refusal: 'No.' }) })).toMatchObject({
      text: 'No.',
      stopReason: 'refusal',
    });
  });

  it('asks for structured output with a JSON schema', async () => {
    const srv = await serve((_req, _body, res) => json(res, { status: 'completed', output: [] }));
    try {
      await new OpenAiResponsesProvider(conn(srv.url)).chat({
        model: 'm',
        maxTokens: 10,
        schema: { type: 'object', properties: { a: { type: 'string' } } },
        messages: [{ role: 'user', content: 'q' }],
      });
      expect(srv.seen[0]!.body).toMatchObject({
        text: { format: { type: 'json_schema', name: 'output', schema: { type: 'object' } } },
      });
    } finally {
      await srv.close();
    }
  });
});

describe('Chat Completions provider', () => {
  it('sends max_tokens to compatible servers and custom headers', async () => {
    const srv = await serve((_req, _body, res) =>
      json(res, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
    );
    try {
      const p = new OpenAiCompatibleProvider(conn(srv.url, { headers: [{ name: 'X-Route', value: 'gpu' }] }));
      expect(
        (await p.chat({ model: 'm', maxTokens: 50, messages: [{ role: 'user', content: 'q' }] })).text,
      ).toBe('ok');
      expect(srv.seen[0]!.url).toBe('/v1/chat/completions');
      expect(srv.seen[0]!.headers['x-route']).toBe('gpu');
      expect(srv.seen[0]!.body).toMatchObject({ max_tokens: 50 });
    } finally {
      await srv.close();
    }
  });
});

describe('Anthropic provider', () => {
  it('sends custom headers to a gateway and honours the TLS switch', async () => {
    const srv = await serve(
      (_req, _body, res) =>
        json(res, {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [{ type: 'text', text: 'ready' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      true,
    );
    try {
      const base = srv.url.replace(/\/v1$/, '');
      const p = new AnthropicProvider('sk-ant', {
        baseUrl: base,
        headers: [{ name: 'X-Gateway-Tenant', value: 'acme' }],
        insecureTls: true,
      });
      const out = await p.chat({
        model: 'claude-sonnet-5-5',
        maxTokens: 10,
        messages: [{ role: 'user', content: 'q' }],
      });
      expect(out.text).toBe('ready');
      expect(srv.seen[0]!.url.split('?')[0]).toBe('/v1/messages');
      expect(srv.seen[0]!.headers['x-gateway-tenant']).toBe('acme');
      expect(srv.seen[0]!.headers['x-api-key']).toBe('sk-ant');

      const strict = new AnthropicProvider('sk-ant', { baseUrl: base, headers: [], insecureTls: false });
      await expect(
        strict.chat({
          model: 'claude-sonnet-5-5',
          maxTokens: 10,
          messages: [{ role: 'user', content: 'q' }],
        }),
      ).rejects.toMatchObject({ details: { reason: 'tls' } });
    } finally {
      await srv.close();
    }
  }, 20_000);
});
