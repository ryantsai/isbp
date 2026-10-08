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
});
