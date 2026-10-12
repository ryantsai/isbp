import type { FastifyInstance } from 'fastify';
import { describeSeen, seeImage } from './vision';

/**
 * A scripted stand-in for an OpenAI-compatible chat model (`/llm/v1/chat/completions`), so the assistant's
 * streamed tool loop can be exercised end to end without a model or a key. It is not a model: it follows a fixed
 * script driven by the conversation.
 *
 * - A user message with a ```json block of proposals (`{ kind, op, value?, targetId?, ref? }` or an array of them)
 *   → describe the first kind, propose each change in turn, name the change set, then summarise it. With "apply
 *   it" in the message, it then asks to apply the change set (which the person confirms in the panel).
 * - Anything else → list the kinds the person can customise, then answer with them.
 * - A request without tools (Administration → AI → Test) → "ready".
 * - A question with images → their colour when asked "what colour", otherwise a description (the text stored in a
 *   PNG's `tEXt` chunk named `Text`, then its colour and size): see `vision.ts`.
 */

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ContentPart[] | null;
  tool_call_id?: string;
}

const textOf = (c: ChatMessage['content']) =>
  typeof c === 'string' ? c : (c ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('');
const imagesOf = (c: ChatMessage['content']) =>
  Array.isArray(c) ? c.flatMap((p) => (p.type === 'image_url' ? [p.image_url.url] : [])) : [];

interface ChatRequest {
  model?: string;
  messages?: ChatMessage[];
  tools?: { function: { name: string } }[];
  stream?: boolean;
}

type Reply = { text: string } | { call: { name: string; args: unknown } };

function proposalsIn(text: string): Record<string, unknown>[] {
  const block = /```json\s*([\s\S]*?)```/.exec(text);
  if (!block) return [];
  try {
    const parsed = JSON.parse(block[1]!) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && 'kind' in p);
  } catch {
    return [];
  }
}

const parse = (s: string | null | undefined): Record<string, unknown> => {
  try {
    return JSON.parse(s ?? '') as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** The next step of the script for a conversation. */
export function scriptedReply(req: ChatRequest): Reply {
  const messages = req.messages ?? [];
  const tools = new Set((req.tools ?? []).map((t) => t.function.name));
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  const userText = textOf(messages[lastUser]?.content);
  const images = imagesOf(messages[lastUser]?.content);
  if (images.length) return { text: describeSeen(images.map(seeImage), userText) };
  if (!tools.size) return { text: 'ready' };
  const results = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  const proposals = proposalsIn(userText);

  if (proposals.length) {
    const n = results.length;
    if (n === 0) return { call: { name: 'assistant__describe_kind', args: { kind: proposals[0]!.kind } } };
    if (n <= proposals.length) return { call: { name: 'assistant__propose_change', args: proposals[n - 1] } };
    const last = parse(textOf(results.at(-1)?.content));
    const changeSet = (last.changeSet ?? {}) as { reference?: string; id?: string };
    if (n === proposals.length + 1 && changeSet.id) {
      const title =
        userText
          .split('\n')[0]!
          .replace(/[:：]\s*$/, '')
          .slice(0, 120) || 'Proposed changes';
      return {
        call: {
          name: 'assistant__update_change_set',
          args: {
            changeSetId: changeSet.id,
            title,
            summary: `${proposals.length} change(s) prepared from the conversation.`,
          },
        },
      };
    }
    // "…and apply it": ask to apply (the person confirms in the panel).
    const applyIt = /\bapply it\b|\band apply\b/i.test(userText);
    if (applyIt && n === proposals.length + 2 && tools.has('assistant__apply_change_set'))
      return { call: { name: 'assistant__apply_change_set', args: {} } };
    if (last.status === 'awaiting_confirmation')
      return {
        text: 'Everything is ready. Confirm it in the card to apply it; you can roll it back afterwards.',
      };
    const items = (last.items ?? []) as { check?: { ok?: boolean } | null }[];
    const failing = items.filter((i) => i.check && !i.check.ok).length;
    return {
      text:
        `I prepared ${changeSet.reference ?? 'a change set'} with ${items.length} change(s)` +
        (failing ? `; ${failing} still need attention` : '') +
        '. Nothing is live yet: review the diff, then apply it if you may, or request a review.',
    };
  }

  if (!results.length && tools.has('assistant__list_kinds'))
    return { call: { name: 'assistant__list_kinds', args: {} } };
  const kinds = ((parse(textOf(results.at(-1)?.content)).kinds ?? []) as { kind: string }[]).map(
    (k) => k.kind,
  );
  return {
    text: kinds.length
      ? `I can prepare changes to: ${kinds.join(', ')}. Tell me what you would like to change.`
      : 'You can’t customise anything here yet. An administrator can help.',
  };
}

let calls = 0;

export function registerLlm(app: FastifyInstance) {
  app.get('/llm/v1/models', async () => ({ data: [{ id: 'scripted', object: 'model' }] }));

  app.post<{ Body: ChatRequest }>('/llm/v1/chat/completions', async (req, reply) => {
    const step = scriptedReply(req.body);
    const usage = { prompt_tokens: 40, completion_tokens: 12 };
    const id = `call_${++calls}`;
    const toolCall =
      'call' in step
        ? {
            id,
            type: 'function',
            function: { name: step.call.name, arguments: JSON.stringify(step.call.args) },
          }
        : null;
    if (!req.body.stream) {
      return {
        id: `chatcmpl-${calls}`,
        object: 'chat.completion',
        model: req.body.model ?? 'scripted',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'text' in step ? step.text : null,
              ...(toolCall ? { tool_calls: [toolCall] } : {}),
            },
            finish_reason: toolCall ? 'tool_calls' : 'stop',
          },
        ],
        usage,
      };
    }
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    if ('text' in step) {
      // A few words at a time, like a model streams.
      for (const piece of step.text.match(/\S+\s*/g) ?? [])
        send({ choices: [{ index: 0, delta: { content: piece } }] });
    } else {
      send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...toolCall }] } }] });
    }
    send({ choices: [{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }], usage });
    reply.raw.end('data: [DONE]\n\n');
    return reply;
  });

  // The same script over the Responses API (`ai.chat.apiStyle: responses`).
  app.post<{ Body: ResponsesRequest }>('/llm/v1/responses', async (req, reply) => {
    const step = scriptedReply(fromResponsesRequest(req.body));
    const usage = { input_tokens: 40, output_tokens: 12 };
    const n = ++calls;
    const item =
      'call' in step
        ? {
            type: 'function_call',
            id: `fc_${n}`,
            call_id: `call_${n}`,
            name: step.call.name,
            arguments: JSON.stringify(step.call.args),
            status: 'completed',
          }
        : {
            type: 'message',
            id: `msg_${n}`,
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: step.text, annotations: [] }],
          };
    const response = { id: `resp_${n}`, object: 'response', status: 'completed', output: [item], usage };
    if (!req.body.stream) return response;
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (type: string, data: Record<string, unknown>) =>
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('response.created', { response: { ...response, status: 'in_progress', output: [] } });
    if ('text' in step)
      for (const piece of step.text.match(/\S+\s*/g) ?? [])
        send('response.output_text.delta', {
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: piece,
        });
    send('response.output_item.done', { output_index: 0, item });
    send('response.completed', { response });
    reply.raw.end();
    return reply;
  });
}

interface ResponsesRequest {
  model?: string;
  instructions?: string;
  input?: string | Record<string, unknown>[];
  tools?: { type: string; name: string }[];
  stream?: boolean;
}

/** A Responses API request as the Chat Completions shape the script reads. */
function fromResponsesRequest(body: ResponsesRequest): ChatRequest {
  const messages: ChatMessage[] = [];
  const items = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : (body.input ?? []);
  for (const item of items) {
    if (item.type === 'function_call_output')
      messages.push({ role: 'tool', content: String(item.output ?? ''), tool_call_id: String(item.call_id) });
    else if (item.type === 'function_call') messages.push({ role: 'assistant', content: null });
    else if (item.role === 'user' || item.role === 'assistant') {
      const content = Array.isArray(item.content)
        ? (item.content as { type?: string; text?: string; image_url?: string }[]).map((p): ContentPart =>
            p.type === 'input_image'
              ? { type: 'image_url', image_url: { url: p.image_url ?? '' } }
              : { type: 'text', text: p.text ?? '' },
          )
        : String(item.content ?? '');
      messages.push({ role: item.role, content });
    }
  }
  return {
    model: body.model,
    messages,
    tools: (body.tools ?? [])
      .filter((t) => t.type === 'function')
      .map((t) => ({ function: { name: t.name } })),
  };
}
