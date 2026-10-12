import { setTimeout as sleep } from 'node:timers/promises';
import { FormData } from 'undici';
import type { AiConfig, DocumentProvider } from '../../ai/config';
import { type AiConnection, aiRequest, providerError } from '../../ai/connection';
import type { Extracted, FileKind } from './builtin';

type Service = Exclude<AiConfig['documents']['service'], { provider: 'none' }>;

export interface ServiceInput {
  name: string;
  contentType: string;
  kind: FileKind;
  data: Buffer;
  /** OCR languages (BCP 47), most likely first. */
  languages: string[];
  maxPages: number;
}

/** What each service reads (anything else stays with the builtin readers). */
const READS: Record<DocumentProvider, FileKind[]> = {
  docling: ['pdf', 'image', 'docx', 'pptx', 'xlsx'],
  paddleocr: ['pdf', 'image'],
  azure: ['pdf', 'image', 'docx', 'pptx', 'xlsx'],
  mistral: ['pdf', 'image'],
};

export const serviceReads = (provider: DocumentProvider, kind: FileKind) => READS[provider].includes(kind);

/** How long one file may take, polling included (a 300-page scan through OCR takes minutes). */
const DEADLINE_MS = 15 * 60_000;

/** Markdown per page from a document-extraction service. */
export async function extractWithService(service: Service, input: ServiceInput): Promise<Extracted> {
  const conn: AiConnection = service;
  switch (service.provider) {
    case 'docling':
      return docling(conn, input);
    case 'paddleocr':
      return paddle(conn, input);
    case 'azure':
      return azure(conn, service.model, input);
    case 'mistral':
      return mistral(conn, service.model, input);
  }
}

const PAGE_BREAK = '<!-- isbp:page-break -->';

/* ───────────────────────────── docling-serve ───────────────────────────── */

/** Docling takes BCP 47 OCR languages, with the script for Chinese (each engine maps them to its own codes). */
const DOCLING_LANG: Record<string, string> = {
  'zh-TW': 'zh-Hant',
  'zh-HK': 'zh-Hant',
  zh: 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
};

/**
 * docling-serve (`/v1/convert/file/async`, then poll): Markdown with a page-break placeholder between pages. The key
 * goes in `X-Api-Key` (DOCLING_SERVE_API_KEY).
 */
async function docling(conn: AiConnection, input: ServiceInput): Promise<Extracted> {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(input.data)], { type: input.contentType }), input.name);
  form.append('to_formats', 'md');
  form.append('do_ocr', 'true');
  form.append('image_export_mode', 'placeholder');
  form.append('md_page_break_placeholder', PAGE_BREAK);
  for (const l of new Set(input.languages.map((l) => DOCLING_LANG[l] ?? l))) form.append('ocr_lang', l);
  const auth = conn.apiKey ? { 'X-Api-Key': conn.apiKey } : undefined;
  const started = Date.now();
  const submit = await aiRequest(conn, '/v1/convert/file/async', {
    method: 'POST',
    headers: auth,
    body: form as unknown as FormData,
    timeoutMs: 120_000,
  });
  const task = (await submit.json()) as { task_id?: string; task_status?: string };
  if (!task.task_id) throw providerError('empty_response');
  for (;;) {
    if (Date.now() - started > DEADLINE_MS) throw providerError('timeout');
    const poll = await aiRequest(conn, `/v1/status/poll/${encodeURIComponent(task.task_id)}?wait=5`, {
      headers: auth,
      timeoutMs: 60_000,
    });
    const status = ((await poll.json()) as { task_status?: string }).task_status;
    if (status === 'success') break;
    if (status === 'failure')
      throw providerError('conversion_failed', new Error('docling-serve could not convert the file'));
    await sleep(2_000);
  }
  const result = await aiRequest(conn, `/v1/result/${encodeURIComponent(task.task_id)}`, {
    headers: auth,
    timeoutMs: 120_000,
  });
  // Results are single-use: read once. A failed task answers 200 with a failure result.
  const data = (await result.json()) as {
    kind?: string;
    status?: string;
    document?: { md_content?: string | null };
    errors?: { error_message?: string }[];
  };
  if (data.status === 'failure' || data.kind === 'TaskFailureResult')
    throw providerError(
      'conversion_failed',
      new Error(data.errors?.[0]?.error_message ?? 'conversion failed'),
    );
  return {
    pages: splitPages(data.document?.md_content ?? '', PAGE_BREAK).slice(0, input.maxPages),
    producer: 'docling',
  };
}

/* ───────────────────────────── PaddleOCR serving ───────────────────────────── */

/**
 * PaddleOCR serving (`/layout-parsing`: PaddleOCR-VL or PP-StructureV3): base64 in, Markdown per page out. PDFs are
 * `fileType` 0, images 1.
 */
async function paddle(conn: AiConnection, input: ServiceInput): Promise<Extracted> {
  const res = await aiRequest(conn, '/layout-parsing', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {}),
    },
    body: JSON.stringify({
      file: input.data.toString('base64'),
      fileType: input.kind === 'pdf' ? 0 : 1,
      useDocOrientationClassify: true,
      useDocUnwarping: false,
      visualize: false,
    }),
    timeoutMs: DEADLINE_MS,
  });
  const data = (await res.json()) as {
    errorCode?: number;
    errorMsg?: string;
    result?: { layoutParsingResults?: { markdown?: { text?: string } }[] };
  };
  if (data.errorCode) throw providerError(`paddle_${data.errorCode}`, new Error(data.errorMsg ?? ''));
  const pages = (data.result?.layoutParsingResults ?? []).map((r) => (r.markdown?.text ?? '').trim());
  return { pages: pages.slice(0, input.maxPages), producer: 'paddleocr' };
}

/* ───────────────────────────── Azure AI Document Intelligence ───────────────────────────── */

const AZURE_API_VERSION = '2024-11-30';

/**
 * Azure AI Document Intelligence (cloud or container): `prebuilt-layout` (or the configured model) with Markdown
 * output, polled through `Operation-Location`; pages cut from the content by each page's span.
 */
async function azure(conn: AiConnection, model: string, input: ServiceInput): Promise<Extracted> {
  const base = conn.baseUrl.replace(/\/+$/, '');
  const url = new URL(
    `${base}/documentintelligence/documentModels/${encodeURIComponent(model || 'prebuilt-layout')}:analyze`,
  );
  url.searchParams.set('api-version', AZURE_API_VERSION);
  url.searchParams.set('outputContentFormat', 'markdown');
  // JavaScript string offsets: the default (text elements) misplaces page spans after CJK text and emoji.
  url.searchParams.set('stringIndexType', 'utf16CodeUnit');
  url.searchParams.set('pages', `1-${input.maxPages}`);
  const key = conn.apiKey ? { 'Ocp-Apim-Subscription-Key': conn.apiKey } : undefined;
  const submit = await aiRequest(conn, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...key },
    body: JSON.stringify({ base64Source: input.data.toString('base64') }),
    timeoutMs: 120_000,
  });
  const location = submit.headers.get('operation-location');
  if (!location) throw providerError('empty_response');
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > DEADLINE_MS) throw providerError('timeout');
    const poll = await aiRequest(conn, location, { headers: key, timeoutMs: 60_000 });
    const data = (await poll.json()) as {
      status?: string;
      error?: { message?: string };
      analyzeResult?: { content?: string; pages?: { spans?: { offset: number; length: number }[] }[] };
    };
    if (data.status === 'succeeded') {
      const content = data.analyzeResult?.content ?? '';
      const pages = (data.analyzeResult?.pages ?? []).map((p) =>
        azureMarkdown((p.spans ?? []).map((s) => content.slice(s.offset, s.offset + s.length)).join('\n')),
      );
      return { pages: pages.length ? pages : [azureMarkdown(content)], producer: 'azure' };
    }
    if (data.status === 'failed')
      throw providerError('conversion_failed', new Error(data.error?.message ?? 'analysis failed'));
    const retryAfter = Number(poll.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 2_000);
  }
}

/* ───────────────────────────── Mistral OCR ───────────────────────────── */

/** Mistral OCR (`/v1/ocr`): a data URL in, Markdown per page out. */
async function mistral(conn: AiConnection, model: string, input: ServiceInput): Promise<Extracted> {
  const dataUrl = `data:${input.contentType};base64,${input.data.toString('base64')}`;
  const res = await aiRequest(conn, '/ocr', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model || 'mistral-ocr-latest',
      document:
        input.kind === 'image'
          ? { type: 'image_url', image_url: dataUrl }
          : { type: 'document_url', document_url: dataUrl, document_name: input.name },
      include_image_base64: false,
      include_blocks: false,
    }),
    timeoutMs: DEADLINE_MS,
  });
  const data = (await res.json()) as { pages?: { index: number; markdown?: string }[] };
  const pages = [...(data.pages ?? [])]
    .sort((a, b) => a.index - b.index)
    .map((p) => (p.markdown ?? '').trim());
  return { pages: pages.slice(0, input.maxPages), producer: 'mistral' };
}

/** Markdown split at a page-break marker (one string when there is none). */
export function splitPages(markdown: string, marker: string): string[] {
  return markdown.split(marker).map((p) => p.trim());
}

/**
 * Azure's Markdown, readable for search: page header/footer/number comments and page breaks dropped, HTML tables as
 * Markdown rows, figure tags removed (their caption text stays).
 */
export function azureMarkdown(text: string): string {
  return text
    .replace(/<!--\s*Page(Header|Footer|Number|Break)[^>]*-->/g, '')
    .replace(/<\/t[hd]>\s*/gi, ' | ')
    .replace(/<t[hd][^>]*>/gi, '')
    .replace(/<\/tr>\s*/gi, '\n')
    .replace(/<tr[^>]*>/gi, '| ')
    .replace(/<\/?(table|thead|tbody|figure|figcaption|caption)[^>]*>/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
