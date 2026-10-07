export interface Chunk {
  no: number;
  text: string;
}

const TARGET = 800;
const OVERLAP = 120;

/**
 * Splits Markdown or plain text into ~800-character chunks along headings and paragraphs, carrying
 * the nearest heading into each chunk so it stays meaningful on its own. Long paragraphs are cut on
 * sentence boundaries (Latin and CJK punctuation) with a small overlap.
 */
export function chunkText(title: string, text: string): Chunk[] {
  const blocks: { heading: string | null; body: string }[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) blocks.push({ heading, body });
    buf = [];
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[1]!.trim();
    } else buf.push(line);
  }
  flush();
  if (!blocks.length) return [{ no: 0, text: title }];

  const pieces: string[] = [];
  for (const b of blocks) {
    const prefix = b.heading ? `${b.heading}\n` : '';
    for (const part of splitLong(b.body)) pieces.push(prefix + part);
  }

  // Greedily pack small pieces together up to the target size.
  const chunks: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > TARGET) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c, no) => ({ no, text: `${title}\n${c}` }));
}

function splitLong(body: string): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= TARGET) {
      out.push(p);
      continue;
    }
    const sentences = p.match(/[^.!?。！？\n]+[.!?。！？]*\s*/g) ?? [p];
    let cur = '';
    for (const s of sentences) {
      if (cur.length + s.length > TARGET && cur) {
        out.push(cur.trim());
        cur = cur.slice(-OVERLAP) + s;
      } else cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}
