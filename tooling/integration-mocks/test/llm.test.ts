import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '../src';
import { scriptedReply } from '../src/llm';

const tools = [
  'assistant__list_kinds',
  'assistant__describe_kind',
  'assistant__propose_change',
  'assistant__update_change_set',
].map((name) => ({ function: { name } }));
const ask = '```json\n[{"kind":"core.custom-field","op":"create","value":{"entityType":"itsm.ticket"}}]\n```';

describe('scripted chat model', () => {
  it('describes, proposes, names the change set and summarises', () => {
    const user = { role: 'user' as const, content: `Add a field:\n${ask}` };
    expect(scriptedReply({ tools, messages: [user] })).toEqual({
      call: { name: 'assistant__describe_kind', args: { kind: 'core.custom-field' } },
    });
    const described = [user, { role: 'tool' as const, content: '{}' }];
    expect(scriptedReply({ tools, messages: described })).toMatchObject({
      call: { name: 'assistant__propose_change', args: { kind: 'core.custom-field', op: 'create' } },
    });
    const proposed = [
      ...described,
      {
        role: 'tool' as const,
        content: '{"changeSet":{"id":"cs1","reference":"CS-00007"},"items":[{"check":{"ok":true}}]}',
      },
    ];
    expect(scriptedReply({ tools, messages: proposed })).toMatchObject({
      call: { name: 'assistant__update_change_set', args: { changeSetId: 'cs1', title: 'Add a field' } },
    });
    const named = [
      ...proposed,
      {
        role: 'tool' as const,
        content: '{"changeSet":{"id":"cs1","reference":"CS-00007"},"items":[{"check":{"ok":true}}]}',
      },
    ];
    expect(scriptedReply({ tools, messages: named })).toEqual({
      text: 'I prepared CS-00007 with 1 change(s). Nothing is live yet: review the diff, then apply it if you may, or request a review.',
    });
  });

  it('asks to apply when told to, then waits for the confirmation', () => {
    const user = { role: 'user' as const, content: `Add a field and apply it:\n${ask}` };
    const cs = '{"changeSet":{"id":"cs1","reference":"CS-00007"},"items":[{"check":{"ok":true}}]}';
    const tool = (content: string) => ({ role: 'tool' as const, content });
    const named = [user, tool('{}'), tool(cs), tool(cs)];
    expect(
      scriptedReply({
        tools: [...tools, { function: { name: 'assistant__apply_change_set' } }],
        messages: named,
      }),
    ).toEqual({ call: { name: 'assistant__apply_change_set', args: {} } });
    expect(
      scriptedReply({ tools, messages: [...named, tool('{"status":"awaiting_confirmation"}')] }),
    ).toEqual({
      text: 'Everything is ready. Confirm it in the card to apply it; you can roll it back afterwards.',
    });
  });

  it('lists kinds without proposals, and answers tool-less requests', () => {
    const user = { role: 'user' as const, content: 'What can you do?' };
    expect(scriptedReply({ tools, messages: [user] })).toEqual({
      call: { name: 'assistant__list_kinds', args: {} },
    });
    expect(
      scriptedReply({
        tools,
        messages: [user, { role: 'tool', content: '{"kinds":[{"kind":"core.workflow"}]}' }],
      }),
    ).toEqual({ text: 'I can prepare changes to: core.workflow. Tell me what you would like to change.' });
    expect(scriptedReply({ messages: [user] })).toEqual({ text: 'ready' });
  });
});

describe('the HTTP endpoint', () => {
  const app = createMockServer();
  beforeAll(async () => (await app).ready());
  afterAll(async () => (await app).close());

  it('streams tool calls in the OpenAI format', async () => {
    const res = await (
      await app
    ).inject({
      method: 'POST',
      url: '/llm/v1/chat/completions',
      payload: { stream: true, tools, messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('"name":"assistant__list_kinds"');
    expect(res.body).toContain('"finish_reason":"tool_calls"');
    expect(res.body.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('follows the same script over the Responses API', async () => {
    const server = await app;
    const responsesTools = tools.map((t) => ({ type: 'function', name: t.function.name }));
    const plain = await server.inject({
      method: 'POST',
      url: '/llm/v1/responses',
      payload: { input: 'Reply with the single word: ready' },
    });
    expect(plain.json()).toMatchObject({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ready' }] }],
      usage: { input_tokens: 40, output_tokens: 12 },
    });

    const call = await server.inject({
      method: 'POST',
      url: '/llm/v1/responses',
      payload: { tools: responsesTools, input: [{ role: 'user', content: 'hi' }] },
    });
    expect(call.json().output[0]).toMatchObject({ type: 'function_call', name: 'assistant__list_kinds' });

    // After the tool result, the script answers (streamed as Responses events).
    const streamed = await server.inject({
      method: 'POST',
      url: '/llm/v1/responses',
      payload: {
        stream: true,
        tools: responsesTools,
        input: [
          { role: 'user', content: 'hi' },
          { type: 'function_call', call_id: 'call_1', name: 'assistant__list_kinds', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_1', output: '{"kinds":[{"kind":"core.workflow"}]}' },
        ],
      },
    });
    expect(streamed.body).toContain('event: response.output_text.delta');
    expect(streamed.body).toContain('core.workflow');
    expect(streamed.body).toContain('event: response.completed');
  });
});

/** A one-colour PNG with an optional `Text` chunk (what the stand-in "reads"). */
function png(rgb: [number, number, number], text?: string) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.from([0, ...rgb, ...rgb]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    ...(text ? [chunk('tEXt', Buffer.from(`Text\0${text}`, 'utf8'))] : []),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

describe('images', () => {
  const app = createMockServer();
  beforeAll(async () => (await app).ready());
  afterAll(async () => (await app).close());

  it('names the colour when asked, and otherwise reads the text and describes the image', async () => {
    const server = await app;
    const ask = (content: unknown) =>
      server.inject({
        method: 'POST',
        url: '/llm/v1/chat/completions',
        payload: { messages: [{ role: 'user', content }] },
      });
    const red = `data:image/png;base64,${png([220, 30, 30])}`;
    const colour = await ask([
      { type: 'image_url', image_url: { url: red } },
      { type: 'text', text: 'What colour fills this image? Reply with one English word.' },
    ]);
    expect(colour.json().choices[0].message.content).toBe('red');

    const dialog = `data:image/png;base64,${png([255, 255, 255], 'VPN error 809: the remote server did not respond')}`;
    const described = await ask([
      { type: 'image_url', image_url: { url: dialog } },
      { type: 'text', text: 'Describe this image for search.' },
    ]);
    expect(described.json().choices[0].message.content).toBe(
      'VPN error 809: the remote server did not respond\nA white image, 2×2 pixels.',
    );
  });

  it('sees input_image parts over the Responses API', async () => {
    const res = await (
      await app
    ).inject({
      method: 'POST',
      url: '/llm/v1/responses',
      payload: {
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_image', image_url: `data:image/png;base64,${png([30, 60, 220])}` },
              { type: 'input_text', text: 'What colour is it?' },
            ],
          },
        ],
      },
    });
    expect(res.json().output[0].content[0].text).toBe('blue');
  });
});

describe('rerank stand-ins', () => {
  const app = createMockServer();
  beforeAll(async () => (await app).ready());
  afterAll(async () => (await app).close());
  const documents = ['Clear a stuck print queue.', 'Reconnect the VPN client when it keeps disconnecting.'];

  it('rank the overlapping document first in every shape', async () => {
    const server = await app;
    const cohere = await server.inject({
      method: 'POST',
      url: '/rerank/v1/rerank',
      payload: { query: 'VPN keeps disconnecting', documents },
    });
    expect(cohere.json().results[0]).toMatchObject({ index: 1 });
    const tei = await server.inject({
      method: 'POST',
      url: '/rerank/tei/rerank',
      payload: { query: 'VPN keeps disconnecting', texts: documents },
    });
    expect(tei.json()[0]).toMatchObject({ index: 1 });
    const voyage = await server.inject({
      method: 'POST',
      url: '/rerank/voyage/rerank',
      payload: { query: '印表機', documents: ['VPN 斷線', '印表機卡紙'] },
    });
    expect(voyage.json().data[0]).toMatchObject({ index: 1 });
  });
});
