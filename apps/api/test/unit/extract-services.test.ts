import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMockServer } from '@isbp/integration-mocks';
import { describe, expect, it } from 'vitest';
import type { AiConfig } from '../../src/kernel/ai/config';
import { makePdf, TEST_PAGE } from '../../src/kernel/files/extract/sample';
import { azureMarkdown, extractWithService, splitPages } from '../../src/kernel/files/extract/services';

type Service = Exclude<AiConfig['documents']['service'], { provider: 'none' }>;

async function serve(
  handler: (req: IncomingMessage, body: Buffer, res: ServerResponse, url: string) => void,
) {
  const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer }[] = [];
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, body, res, req.url ?? '');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const json = (res: ServerResponse, data: unknown, status = 200, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
};

const service = (provider: Service['provider'], baseUrl: string, extra: Partial<Service> = {}): Service => ({
  provider,
  baseUrl,
  apiKey: 'k',
  headers: [],
  insecureTls: false,
  model: '',
  mode: 'fallback',
  price: 0,
  ...extra,
});

const input = (kind: 'pdf' | 'image' = 'pdf') => ({
  name: kind === 'pdf' ? 'a.pdf' : 'a.png',
  contentType: kind === 'pdf' ? 'application/pdf' : 'image/png',
  kind,
  data: kind === 'pdf' ? makePdf([TEST_PAGE]) : Buffer.from('png'),
  languages: ['en', 'zh-TW', 'ja'],
  maxPages: 10,
});

describe('docling-serve', () => {
  it('converts asynchronously and splits pages at the placeholder (against the stand-in)', async () => {
    const mocks = await createMockServer();
    await mocks.listen({ port: 0, host: '127.0.0.1' });
    try {
      const base = `http://127.0.0.1:${(mocks.server.address() as AddressInfo).port}/docling`;
      const out = await extractWithService(service('docling', base, { apiKey: 'docling-key' }), {
        ...input(),
        data: makePdf([['First page text'], ['Second page text']]),
      });
      expect(out).toEqual({ pages: ['First page text', 'Second page text'], producer: 'docling' });
      await expect(
        extractWithService(service('docling', base, { apiKey: 'wrong' }), input()),
      ).rejects.toMatchObject({ details: { reason: 'auth' } });
    } finally {
      await mocks.close();
    }
  });

  it('sends BCP 47 OCR languages and reports a failed task', async () => {
    const srv = await serve((_req, _body, res, url) => {
      if (url.endsWith('/async')) return json(res, { task_id: 't1', task_status: 'pending' });
      if (url.includes('/status/poll/')) return json(res, { task_id: 't1', task_status: 'failure' });
      json(res, {}, 404);
    });
    try {
      await expect(extractWithService(service('docling', srv.base), input())).rejects.toMatchObject({
        details: { reason: 'conversion_failed' },
      });
      const form = srv.seen[0]!.body.toString('latin1');
      expect(srv.seen[0]!.headers['x-api-key']).toBe('k');
      for (const lang of ['en', 'zh-Hant', 'ja']) expect(form).toContain(`\r\n\r\n${lang}\r\n`);
      expect(form).toContain('name="md_page_break_placeholder"');
    } finally {
      await srv.close();
    }
  });
});

describe('Azure AI Document Intelligence', () => {
  it('polls the operation and cuts pages by their UTF-16 spans', async () => {
    const content =
      '# 合約\n第一頁內容\n<!-- PageBreak -->\n<!-- PageNumber="2" -->\n<table><tr><td>A</td><td>B</td></tr></table>';
    const p2 = content.indexOf('<!-- PageNumber');
    let polls = 0;
    const srv = await serve((_req, _body, res, url) => {
      if (url.includes(':analyze')) {
        res.writeHead(202, { 'operation-location': `${srv.base}/results/1`, 'retry-after': '0' });
        return res.end();
      }
      polls++;
      if (polls < 2) return json(res, { status: 'running' });
      json(res, {
        status: 'succeeded',
        analyzeResult: {
          content,
          pages: [
            { pageNumber: 1, spans: [{ offset: 0, length: p2 }] },
            { pageNumber: 2, spans: [{ offset: p2, length: content.length - p2 }] },
          ],
        },
      });
    });
    try {
      const out = await extractWithService(service('azure', srv.base), input());
      expect(out.pages[0]).toBe('# 合約\n第一頁內容');
      expect(out.pages[1]).toBe('| A | B |');
      const submit = new URL(srv.base + srv.seen[0]!.url);
      expect(submit.pathname).toBe('/documentintelligence/documentModels/prebuilt-layout:analyze');
      expect(submit.searchParams.get('stringIndexType')).toBe('utf16CodeUnit');
      expect(submit.searchParams.get('outputContentFormat')).toBe('markdown');
      expect(srv.seen[0]!.headers['ocp-apim-subscription-key']).toBe('k');
      expect(JSON.parse(srv.seen[0]!.body.toString()).base64Source).toBeTruthy();
    } finally {
      await srv.close();
    }
  });

  it('turns its HTML tables and page comments into plain Markdown', () => {
    expect(
      azureMarkdown(
        '<!-- PageHeader="Contoso" -->\n<table><tr><th>Name</th><th>Seats</th></tr><tr><td>Visio</td><td>3</td></tr></table>',
      ),
    ).toBe('| Name | Seats |\n| Visio | 3 |');
  });
});

describe('Mistral OCR', () => {
  it('sends a data URL and returns pages in order', async () => {
    const srv = await serve((_req, _body, res) =>
      json(res, {
        pages: [
          { index: 1, markdown: 'Page two' },
          { index: 0, markdown: 'Page one' },
        ],
        usage_info: { pages_processed: 2 },
      }),
    );
    try {
      const out = await extractWithService(service('mistral', srv.base), input('image'));
      expect(out).toEqual({ pages: ['Page one', 'Page two'], producer: 'mistral' });
      const body = JSON.parse(srv.seen[0]!.body.toString());
      expect(srv.seen[0]!.url).toBe('/ocr');
      expect(body).toMatchObject({
        model: 'mistral-ocr-latest',
        document: { type: 'image_url', image_url: expect.stringMatching(/^data:image\/png;base64,/) },
        include_blocks: false,
      });
      expect(srv.seen[0]!.headers.authorization).toBe('Bearer k');
    } finally {
      await srv.close();
    }
  });
});

describe('PaddleOCR serving', () => {
  it('returns the Markdown of each page and maps errors', async () => {
    let fail = false;
    const srv = await serve((_req, _body, res) =>
      fail
        ? json(res, { errorCode: 500, errorMsg: 'model not loaded' })
        : json(res, {
            errorCode: 0,
            result: {
              layoutParsingResults: [{ markdown: { text: '頁一' } }, { markdown: { text: '頁二' } }],
            },
          }),
    );
    try {
      expect((await extractWithService(service('paddleocr', srv.base), input())).pages).toEqual([
        '頁一',
        '頁二',
      ]);
      expect(JSON.parse(srv.seen[0]!.body.toString())).toMatchObject({ fileType: 0, visualize: false });
      fail = true;
      await expect(extractWithService(service('paddleocr', srv.base), input())).rejects.toMatchObject({
        details: { reason: 'paddle_500' },
      });
    } finally {
      await srv.close();
    }
  });
});

describe('page splitting', () => {
  it('splits at the marker and trims', () => {
    expect(splitPages('a\n\nX\n\nb', 'X')).toEqual(['a', 'b']);
    expect(splitPages('only one', 'X')).toEqual(['only one']);
  });
});
