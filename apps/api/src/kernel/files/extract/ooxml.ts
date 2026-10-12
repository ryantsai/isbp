import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';

/**
 * Word, PowerPoint and Excel files (Office Open XML: a zip of XML parts) as Markdown, without Office or a model.
 * Word keeps headings, lists and tables, and splits pages where Word last laid them out; each slide and each sheet
 * is a page. Sheets are capped (rows, columns) so a data dump doesn't flood the index.
 */

const MAX_SHEET_ROWS = 2_000;
const MAX_SHEET_COLS = 30;
const MAX_PART_BYTES = 50 * 1024 * 1024;

type Node = Record<string, unknown>;

// Ordered parsing keeps runs, paragraphs and table cells in document order.
const ordered = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  preserveOrder: true,
  trimValues: false,
  processEntities: true,
  parseTagValue: false,
});
const plain = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ['sheet', 'Relationship', 'si', 'r', 'row', 'c', 'p:sldId'].includes(name),
});

function parts(data: Buffer): Record<string, Uint8Array> {
  let total = 0;
  return unzipSync(new Uint8Array(data), {
    filter: (f) => {
      // Only the XML parts we read; refuse zip bombs.
      if (!/\.(xml|rels)$/.test(f.name)) return false;
      total += f.originalSize;
      return f.originalSize <= MAX_PART_BYTES && total <= MAX_PART_BYTES * 4;
    },
  });
}

const xml = (files: Record<string, Uint8Array>, path: string) => {
  const f = files[path];
  return f ? strFromU8(f) : null;
};

/** Children of a preserveOrder node, as `[tag, node]` pairs. */
function children(node: unknown): [string, Node][] {
  if (!Array.isArray(node)) return [];
  const out: [string, Node][] = [];
  for (const item of node as Node[]) {
    const tag = Object.keys(item).find((k) => k !== ':@');
    if (tag) out.push([tag, item]);
  }
  return out;
}
const kids = (item: Node, tag: string) => item[tag] as unknown;
const attr = (item: Node, name: string) => (item[':@'] as Record<string, string> | undefined)?.[name];

/** All `w:t` / `a:t` text under a node, in order. */
function textOf(node: unknown, textTag: string): string {
  let out = '';
  for (const [tag, item] of children(node)) {
    if (tag === '#text') out += String(item['#text'] ?? '');
    else if (tag === textTag) out += textOf(kids(item, tag), textTag);
    else if (tag === 'w:tab' || tag === 'a:tab') out += '\t';
    else if (tag === 'w:br' || tag === 'a:br') out += attr(item, '@w:type') === 'page' ? '' : '\n';
    else out += textOf(kids(item, tag), textTag);
  }
  return out;
}

const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

function table(rows: string[][]): string {
  const width = Math.min(MAX_SHEET_COLS, Math.max(0, ...rows.map((r) => r.length)));
  if (!width) return '';
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => cell(r[i] ?? ''));
  const [head, ...body] = rows.map(pad);
  return [
    `| ${head!.join(' | ')} |`,
    `| ${head!.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/* ───────────────────────────── Word ───────────────────────────── */

export function docxPages(data: Buffer): string[] {
  const files = parts(data);
  const doc = xml(files, 'word/document.xml');
  if (!doc) return [];
  const root = ordered.parse(doc) as unknown;
  const body = children(children(root).find(([t]) => t === 'w:document')?.[1]?.['w:document']).find(
    ([t]) => t === 'w:body',
  )?.[1]?.['w:body'];

  const pages: string[][] = [[]];
  const push = (block: string) => block.trim() && pages[pages.length - 1]!.push(block);
  const breaksPage = (node: unknown): boolean =>
    children(node).some(
      ([tag, item]) =>
        tag === 'w:lastRenderedPageBreak' ||
        (tag === 'w:br' && attr(item, '@w:type') === 'page') ||
        breaksPage(kids(item, tag)),
    );

  const paragraph = (item: Node): string => {
    const p = kids(item, 'w:p');
    const props = children(p).find(([t]) => t === 'w:pPr')?.[1]?.['w:pPr'];
    const style = attr(children(props).find(([t]) => t === 'w:pStyle')?.[1] ?? {}, '@w:val') ?? '';
    const list = children(props).some(([t]) => t === 'w:numPr');
    const text = textOf(
      children(p)
        .filter(([t]) => t !== 'w:pPr')
        .map(([, n]) => n),
      'w:t',
    ).trim();
    if (!text) return '';
    const level =
      style === 'Title' ? 1 : Number(/^(?:Heading|heading|見出し|標題)\s*(\d)$/.exec(style)?.[1] ?? 0);
    if (level) return `${'#'.repeat(Math.min(6, level))} ${text}`;
    return list ? `- ${text}` : text;
  };

  for (const [tag, item] of children(body)) {
    if (tag === 'w:p') {
      if (breaksPage(kids(item, tag)) && pages[pages.length - 1]!.length) pages.push([]);
      push(paragraph(item));
    } else if (tag === 'w:tbl') {
      const rows = children(kids(item, tag))
        .filter(([t]) => t === 'w:tr')
        .map(([, tr]) =>
          children(kids(tr, 'w:tr'))
            .filter(([t]) => t === 'w:tc')
            .map(([, tc]) => textOf(kids(tc, 'w:tc'), 'w:t')),
        );
      push(table(rows));
    }
  }
  return pages.map((p) => p.join('\n\n')).filter((p) => p.trim());
}

/* ───────────────────────────── PowerPoint ───────────────────────────── */

function relationships(files: Record<string, Uint8Array>, path: string): Map<string, string> {
  const text = xml(files, path);
  if (!text) return new Map();
  const rels = (plain.parse(text) as { Relationships?: { Relationship?: Node[] } }).Relationships
    ?.Relationship;
  return new Map((rels ?? []).map((r) => [String(r['@Id']), String(r['@Target'])]));
}

const resolve = (base: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};

export function pptxPages(data: Buffer): string[] {
  const files = parts(data);
  const pres = xml(files, 'ppt/presentation.xml');
  if (!pres) return [];
  const rels = relationships(files, 'ppt/_rels/presentation.xml.rels');
  const ids =
    (plain.parse(pres) as { 'p:presentation'?: { 'p:sldIdLst'?: { 'p:sldId'?: Node[] } } })[
      'p:presentation'
    ]?.['p:sldIdLst']?.['p:sldId'] ?? [];
  return ids.map((s) => {
    const path = resolve('ppt/presentation.xml', rels.get(String(s['@r:id'])) ?? '');
    const slide = xml(files, path);
    if (!slide) return '';
    const blocks: string[] = [];
    const walk = (node: unknown) => {
      for (const [tag, item] of children(node)) {
        if (tag === 'p:sp') {
          const sp = kids(item, tag);
          const ph = JSON.stringify(sp).match(/"@type":"(title|ctrTitle)"/);
          const paras = collect(sp, 'a:p')
            .map((p) => textOf(p, 'a:t').trim())
            .filter(Boolean);
          if (!paras.length) continue;
          blocks.push(ph ? `## ${paras.join(' ')}` : paras.join('\n'));
        } else if (tag === 'a:tbl') {
          const rows = collect(kids(item, tag), 'a:tr').map((tr) =>
            collect(tr, 'a:tc').map((tc) => textOf(tc, 'a:t')),
          );
          blocks.push(table(rows));
        } else walk(kids(item, tag));
      }
    };
    walk(ordered.parse(slide));
    // Speaker notes often carry the explanation the slide only hints at.
    const notesTarget = [
      ...relationships(files, path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')).values(),
    ].find((t) => /notesSlide/.test(t));
    const notes = notesTarget ? xml(files, resolve(path, notesTarget)) : null;
    if (notes) {
      const text = collect(ordered.parse(notes), 'a:p')
        .map((p) => textOf(p, 'a:t').trim())
        .filter((t) => t && !/^\d+$/.test(t))
        .join('\n');
      if (text) blocks.push(`Notes:\n${text}`);
    }
    return blocks.join('\n\n');
  });
}

/** Every `tag` node's children under `node`, in document order. */
function collect(node: unknown, tag: string): unknown[] {
  const out: unknown[] = [];
  for (const [t, item] of children(node)) {
    if (t === tag) out.push(kids(item, t));
    else out.push(...collect(kids(item, t), tag));
  }
  return out;
}

/* ───────────────────────────── Excel ───────────────────────────── */

export function xlsxPages(data: Buffer): string[] {
  const files = parts(data);
  const book = xml(files, 'xl/workbook.xml');
  if (!book) return [];
  const rels = relationships(files, 'xl/_rels/workbook.xml.rels');
  const sheets =
    (plain.parse(book) as { workbook?: { sheets?: { sheet?: Node[] } } }).workbook?.sheets?.sheet ?? [];
  const shared = sharedStrings(xml(files, 'xl/sharedStrings.xml'));
  return sheets.map((s) => {
    const path = resolve('xl/workbook.xml', rels.get(String(s['@r:id'])) ?? '');
    const sheet = xml(files, path);
    if (!sheet) return '';
    const rows =
      (plain.parse(sheet) as { worksheet?: { sheetData?: { row?: Node[] } } }).worksheet?.sheetData?.row ??
      [];
    const grid: string[][] = [];
    for (const row of rows.slice(0, MAX_SHEET_ROWS)) {
      const values: string[] = [];
      for (const c of (row.c as Node[] | undefined) ?? []) {
        const col = columnIndex(String(c['@r'] ?? ''));
        if (col >= MAX_SHEET_COLS) continue;
        values[col] = cellValue(c, shared);
      }
      if (values.some((v) => v?.trim())) grid.push(Array.from(values, (v) => v ?? ''));
    }
    const title = `## ${String(s['@name'] ?? '')}`;
    return grid.length ? `${title}\n\n${table(grid)}` : '';
  });
}

function sharedStrings(text: string | null): string[] {
  if (!text) return [];
  const items = (plain.parse(text) as { sst?: { si?: Node[] } }).sst?.si ?? [];
  const str = (v: unknown): string =>
    v == null ? '' : typeof v === 'object' ? String((v as Node)['#text'] ?? '') : String(v);
  return items.map((si) =>
    si.t !== undefined ? str(si.t) : ((si.r as Node[] | undefined) ?? []).map((r) => str(r.t)).join(''),
  );
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellValue(c: Node, shared: string[]): string {
  const raw = c.v;
  const v = raw == null ? '' : typeof raw === 'object' ? String((raw as Node)['#text'] ?? '') : String(raw);
  switch (c['@t']) {
    case 's':
      return shared[Number(v)] ?? '';
    case 'inlineStr': {
      const is = c.is as Node | undefined;
      const t = is?.t;
      return t == null ? '' : typeof t === 'object' ? String((t as Node)['#text'] ?? '') : String(t);
    }
    case 'b':
      return v === '1' ? 'TRUE' : 'FALSE';
    default:
      return v;
  }
}
