import type { AiImage } from '@isbp/sdk/server';
import { strFromU8, unzipSync } from 'fflate';
import type { FileKind } from './builtin';

/** An image inside a document, with the page (slide) it is on, for a vision model to describe. */
export interface Figure {
  page: number;
  name: string;
  image: AiImage;
}

/** Figures described per file: the first ones, big enough to matter (icons and logos are left out). */
export const MAX_FIGURES = 12;
const MIN_BYTES = 8 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;

const MEDIA: Record<string, AiImage['mediaType']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const mediaTypeOf = (path: string) => MEDIA[path.toLowerCase().split('.').pop() ?? ''];

/** The image types a vision model reads, from the file's own type. */
export function imageMediaType(contentType: string): AiImage['mediaType'] | null {
  const t = contentType.toLowerCase();
  return t === 'image/png' || t === 'image/jpeg' || t === 'image/webp' || t === 'image/gif' ? t : null;
}

/**
 * Pictures in Word and PowerPoint files (diagrams, screenshots pasted into a runbook), with their page or slide:
 * PowerPoint through each slide's relationships, Word by counting the page breaks before each drawing.
 */
export function officeFigures(kind: FileKind, data: Buffer): Figure[] {
  if (kind !== 'docx' && kind !== 'pptx') return [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data), {
      filter: (f) =>
        (/\.(xml|rels)$/.test(f.name) || /\/media\//.test(f.name)) && f.originalSize <= MAX_BYTES,
    });
  } catch {
    return [];
  }
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : '');
  const rels = (path: string) =>
    new Map(
      [...text(path).matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );
  const resolve = (base: string, target: string) => {
    const parts = base.split('/').slice(0, -1);
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  };

  const out: Figure[] = [];
  const seen = new Set<string>();
  const add = (page: number, path: string) => {
    const mediaType = mediaTypeOf(path);
    const bytes = files[path];
    if (!mediaType || !bytes || seen.has(path) || out.length >= MAX_FIGURES) return;
    if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) return;
    seen.add(path);
    out.push({
      page,
      name: path.split('/').pop()!,
      image: { mediaType, data: Buffer.from(bytes).toString('base64') },
    });
  };

  if (kind === 'pptx') {
    const presRels = rels('ppt/_rels/presentation.xml.rels');
    const order = [...text('ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) =>
      resolve('ppt/presentation.xml', presRels.get(m[1]!) ?? ''),
    );
    order.forEach((slide, i) => {
      const slideRels = rels(slide.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
      for (const target of slideRels.values())
        if (/\/media\//.test(`/${target}`)) add(i + 1, resolve(slide, target));
    });
    return out;
  }

  // Word: walk the body in order, counting rendered page breaks, and take each drawing's image.
  const docRels = rels('word/_rels/document.xml.rels');
  const body = text('word/document.xml');
  let page = 1;
  for (const m of body.matchAll(
    /<w:lastRenderedPageBreak\/>|<w:br\b[^>]*w:type="page"[^>]*\/>|r:embed="([^"]+)"/g,
  )) {
    if (!m[1]) {
      page++;
      continue;
    }
    const target = docRels.get(m[1]);
    if (target) add(page, resolve('word/document.xml', target));
  }
  return out;
}
