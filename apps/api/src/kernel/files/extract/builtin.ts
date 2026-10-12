import { extractText, getDocumentProxy } from 'unpdf';
import { docxPages, pptxPages, xlsxPages } from './ooxml';

/** What a file is, for extraction: decided from the sniffed content type, then the extension. */
export type FileKind = 'text' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'image' | 'other';

export interface Extracted {
  /** Markdown per page (slides and sheets are pages). */
  pages: string[];
  producer: string;
  /** The text layer is missing or unreadable (a scan, or fonts without a Unicode map): OCR would do better. */
  needsOcr?: boolean;
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'md',
  'markdown',
  'csv',
  'tsv',
  'log',
  'json',
  'yaml',
  'yml',
  'ini',
  'conf',
  'cfg',
  'xml',
  'ps1',
  'sh',
  'sql',
]);
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/bmp',
]);

export function fileKind(contentType: string, name: string): FileKind {
  const type = contentType.toLowerCase();
  const ext = name.toLowerCase().split('.').pop() ?? '';
  // Office files are zips: a sniffer that stops at "zip" (or nothing) leaves the extension to decide.
  const zipLike = type === 'application/zip' || type === 'application/octet-stream';
  if (type === 'application/pdf') return 'pdf';
  if (type.includes('wordprocessingml') || (zipLike && ext === 'docx')) return 'docx';
  if (type.includes('presentationml') || (zipLike && ext === 'pptx')) return 'pptx';
  if (type.includes('spreadsheetml') || (zipLike && ext === 'xlsx')) return 'xlsx';
  if (IMAGE_TYPES.has(type)) return 'image';
  if (type.startsWith('text/') || type === 'application/json' || TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'other';
}

/** Characters on a page below which a PDF page counts as having no text layer (a scan). */
const MIN_PAGE_CHARS = 40;

/**
 * Text without a model: plain-text files (UTF-8, or Big5 / Shift_JIS / GB18030 when that reads better), the text
 * layer of PDFs, and Word, PowerPoint and Excel files. Returns null for kinds it can't read (images, legacy Office).
 */
export async function extractBuiltin(kind: FileKind, data: Buffer): Promise<Extracted | null> {
  switch (kind) {
    case 'text':
      return { pages: [decodeText(data)], producer: 'builtin:text' };
    case 'pdf':
      return pdfPages(data);
    case 'docx':
      return { pages: docxPages(data), producer: 'builtin:docx' };
    case 'pptx':
      return { pages: pptxPages(data), producer: 'builtin:pptx' };
    case 'xlsx':
      return { pages: xlsxPages(data), producer: 'builtin:xlsx' };
    default:
      return null;
  }
}

async function pdfPages(data: Buffer): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(data), { verbosity: 0 });
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((t) => t.replace(/[ \t]+\n/g, '\n').trim());
    const readable = pages.filter((p) => p.length >= MIN_PAGE_CHARS && !garbled(p)).length;
    // Mostly pages without a usable text layer: a scan (or CJK fonts without a Unicode map).
    const needsOcr = pages.length > 0 && readable < pages.length / 2;
    return { pages, producer: 'builtin:pdf', needsOcr };
  } finally {
    // Frees pdf.js's per-document caches (the proxy has `cleanup`; older builds also `destroy`).
    const doc = pdf as unknown as { cleanup?: () => Promise<void>; destroy?: () => Promise<void> };
    await (doc.destroy ?? doc.cleanup)?.call(doc).catch(() => undefined);
  }
}

/** Replacement characters, private-use glyphs or control characters in more than a tenth of the text. */
export function garbled(text: string): boolean {
  if (!text) return false;
  let bad = 0;
  for (const c of text) {
    const code = c.codePointAt(0)!;
    if (code === 0xfffd || (code >= 0xe000 && code <= 0xf8ff) || (code < 0x20 && c !== '\n' && c !== '\t'))
      bad++;
  }
  return bad / [...text].length > 0.1;
}

/**
 * Bytes as text: UTF-8 (BOM dropped), unless it doesn't decode cleanly and a legacy East Asian encoding does
 * (files exported from older Taiwanese and Japanese systems).
 */
export function decodeText(data: Buffer): string {
  const strip = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe)
    return strip(new TextDecoder('utf-16le').decode(data));
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff)
    return strip(new TextDecoder('utf-16be').decode(data));
  const utf8 = new TextDecoder('utf-8').decode(data);
  const bad = (s: string) => (s.match(/�/g) ?? []).length;
  if (!bad(utf8)) return strip(utf8);
  let best = utf8;
  for (const encoding of ['big5', 'shift_jis', 'gb18030', 'euc-kr']) {
    try {
      const candidate = new TextDecoder(encoding).decode(data);
      if (bad(candidate) < bad(best)) best = candidate;
    } catch {
      // Encoding not built into this Node (small-icu): keep UTF-8.
    }
  }
  return strip(best);
}
