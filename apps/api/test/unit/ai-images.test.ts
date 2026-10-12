import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readAiConfig } from '../../src/kernel/ai/config';
import {
  AnthropicProvider,
  OpenAiCompatibleProvider,
  OpenAiResponsesProvider,
} from '../../src/kernel/ai/providers';
import { imageMediaType, MAX_FIGURES, officeFigures } from '../../src/kernel/files/extract/figures';
import { solidPng } from '../../src/kernel/files/extract/sample';

/** A local server that records JSON bodies and answers with `reply`. */
async function serve(reply: (res: ServerResponse) => void) {
  const seen: Record<string, unknown>[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      seen.push(JSON.parse(raw) as Record<string, unknown>);
      reply(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const json = (res: ServerResponse, data: unknown) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

const png = solidPng(4, 4, [220, 30, 30]);
const image = { mediaType: 'image/png' as const, data: png.toString('base64') };
const question = { role: 'user' as const, content: 'What does this error mean?', images: [image] };

describe('images in chat requests', () => {
  it('go to Chat Completions as image_url parts (data URLs) before the text', async () => {
    const srv = await serve((res) =>
      json(res, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
    );
    try {
      await new OpenAiCompatibleProvider({
        baseUrl: `${srv.url}/v1`,
        apiKey: null,
        headers: [],
        insecureTls: false,
      }).chat({ model: 'm', maxTokens: 10, messages: [question] });
      const messages = srv.seen[0]!.messages as { role: string; content: unknown }[];
      expect(messages.at(-1)!.content).toEqual([
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } },
        { type: 'text', text: 'What does this error mean?' },
      ]);
    } finally {
      await srv.close();
    }
  });

  it('go to the Responses API as input_image parts', async () => {
    const srv = await serve((res) =>
      json(res, {
        id: 'resp_1',
        status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    try {
      await new OpenAiResponsesProvider({
        baseUrl: `${srv.url}/v1`,
        apiKey: null,
        headers: [],
        insecureTls: false,
      }).chat({ model: 'm', maxTokens: 10, messages: [question] });
      const input = srv.seen[0]!.input as { role: string; content: unknown }[];
      expect(input.at(-1)).toMatchObject({
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:image/png;base64,${image.data}` },
          { type: 'input_text', text: 'What does this error mean?' },
        ],
      });
    } finally {
      await srv.close();
    }
  });

  it('go to Anthropic as base64 image blocks before the text', async () => {
    const srv = await serve((res) =>
      json(res, {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    try {
      await new AnthropicProvider('sk-ant', { baseUrl: srv.url, headers: [], insecureTls: false }).chat({
        model: 'claude-sonnet-5-5',
        maxTokens: 10,
        messages: [question],
      });
      const messages = srv.seen[0]!.messages as { role: string; content: unknown }[];
      expect(messages.at(-1)!.content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data } },
        { type: 'text', text: 'What does this error mean?' },
      ]);
    } finally {
      await srv.close();
    }
  });
});

describe('image settings', () => {
  const base = {
    'ai.chat.provider': 'openai-compatible',
    'ai.chat.baseUrl': 'http://llm/v1',
    'ai.chat.model': 'm',
  };

  it('keep images away from the chat model unless allowed, and never without one', () => {
    expect(readAiConfig(base).images.chat).toBe(false);
    expect(readAiConfig({ ...base, 'ai.images.chat': true }).images.chat).toBe(true);
    expect(readAiConfig({ 'ai.images.chat': true }).images.chat).toBe(false);
  });

  it('describe images with the chat model or another one, once it is complete', () => {
    expect(readAiConfig({ ...base, 'ai.vision.provider': 'chat' }).vision).toEqual({ provider: 'chat' });
    // "The chat model" without one describes nothing.
    expect(readAiConfig({ 'ai.vision.provider': 'chat' }).vision).toEqual({ provider: 'none' });
    expect(
      readAiConfig({ 'ai.vision.provider': 'openai-compatible', 'ai.vision.baseUrl': 'http://ollama/v1' })
        .vision,
    ).toEqual({ provider: 'none' });
    expect(
      readAiConfig({
        'ai.vision.provider': 'openai-compatible',
        'ai.vision.baseUrl': 'http://ollama/v1',
        'ai.vision.model': 'qwen2.5vl:7b',
        'ai.vision.apiStyle': 'responses',
        'ai.vision.insecureTls': true,
        'ai.vision.inputPrice': 0.2,
      }).vision,
    ).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'http://ollama/v1',
      model: 'qwen2.5vl:7b',
      apiStyle: 'responses',
      insecureTls: true,
      prices: [0.2, 0],
    });
  });
});

describe('test images', () => {
  it('are valid PNGs of one colour, with optional text and padding', () => {
    const big = solidPng(8, 2, [30, 60, 220], { text: 'Error 809', minBytes: 9_000 });
    expect(big.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(big.length).toBeGreaterThanOrEqual(9_000);
    expect(big.includes(Buffer.from('Text\0Error 809'))).toBe(true);
    const at = big.indexOf('IDAT');
    const pixels = inflateSync(big.subarray(at + 4, at + 4 + big.readUInt32BE(at - 4)));
    expect([...pixels.subarray(0, 4)]).toEqual([0, 30, 60, 220]);
  });
});

/* ───────────── pictures in Office files ───────────── */

const bigPng = (rgb: [number, number, number]) => solidPng(16, 16, rgb, { minBytes: 10_000 });

function zip(entries: Record<string, string | Buffer>) {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : new Uint8Array(v)]),
      ),
    ),
  );
}

describe('office figures', () => {
  it('finds PowerPoint pictures on their slides, in slide order, skipping icons', () => {
    const data = zip({
      'ppt/presentation.xml':
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld/>',
      'ppt/slides/slide2.xml': '<p:sld/>',
      'ppt/slides/_rels/slide1.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="../media/diagram.png"/><Relationship Id="rId2" Target="../media/logo.png"/></Relationships>',
      'ppt/slides/_rels/slide2.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="../media/screenshot.png"/></Relationships>',
      'ppt/media/diagram.png': bigPng([30, 160, 60]),
      'ppt/media/screenshot.png': bigPng([220, 30, 30]),
      'ppt/media/logo.png': solidPng(4, 4, [0, 0, 0]),
    });
    const figures = officeFigures('pptx', data);
    // slide2.xml is shown first (presentation order); the tiny logo is left out.
    expect(figures.map((f) => [f.page, f.name])).toEqual([
      [1, 'screenshot.png'],
      [2, 'diagram.png'],
    ]);
    expect(figures[0]!.image.mediaType).toBe('image/png');
    expect(Buffer.from(figures[0]!.image.data, 'base64')).toEqual(bigPng([220, 30, 30]));
  });

  it('finds Word pictures on the page they follow, once each', () => {
    const W = 'xmlns:w="w" xmlns:r="r"';
    const drawing = (id: string) => `<w:r><w:drawing><a:blip r:embed="${id}"/></w:drawing></w:r>`;
    const data = zip({
      'word/document.xml': `<w:document ${W}><w:body><w:p>${drawing('rId5')}</w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p>${drawing('rId6')}${drawing('rId5')}</w:p></w:body></w:document>`,
      'word/_rels/document.xml.rels':
        '<Relationships><Relationship Id="rId5" Target="media/image1.png"/><Relationship Id="rId6" Target="media/image2.jpeg"/></Relationships>',
      'word/media/image1.png': bigPng([30, 60, 220]),
      'word/media/image2.jpeg': Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9_000)]),
    });
    expect(officeFigures('docx', data).map((f) => [f.page, f.name, f.image.mediaType])).toEqual([
      [1, 'image1.png', 'image/png'],
      [2, 'image2.jpeg', 'image/jpeg'],
    ]);
  });

  it(`stops at ${MAX_FIGURES} pictures and ignores other kinds and broken files`, () => {
    const many: Record<string, string | Buffer> = {
      'ppt/presentation.xml':
        '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld/>',
      'ppt/slides/_rels/slide1.xml.rels': `<Relationships>${Array.from(
        { length: 20 },
        (_, i) => `<Relationship Id="rId${i}" Target="../media/p${i}.png"/>`,
      ).join('')}</Relationships>`,
    };
    for (let i = 0; i < 20; i++) many[`ppt/media/p${i}.png`] = bigPng([i * 10, 0, 0]);
    expect(officeFigures('pptx', zip(many))).toHaveLength(MAX_FIGURES);
    expect(officeFigures('xlsx', zip(many))).toEqual([]);
    expect(officeFigures('pptx', Buffer.from('not a zip'))).toEqual([]);
  });

  it('knows which attachments a vision model can read', () => {
    expect(imageMediaType('image/PNG')).toBe('image/png');
    expect(imageMediaType('image/webp')).toBe('image/webp');
    expect(imageMediaType('image/tiff')).toBeNull();
    expect(imageMediaType('application/pdf')).toBeNull();
  });
});
