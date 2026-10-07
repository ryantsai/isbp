import { createHash } from 'node:crypto';

/** Dimensions of the builtin embedder (and the HNSW index created by migration 0005). */
export const BUILTIN_DIMENSIONS = 384;
export const BUILTIN_MODEL = 'isbp-hash-384';

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'are',
  'was',
  'be',
  'it',
  'my',
  'i',
  'me',
  'we',
  'you',
  'with',
  'at',
  'by',
  'from',
  'this',
  'that',
  'can',
  'not',
  'no',
  'do',
  'does',
  'how',
]);

function bucket(feature: string): [index: number, sign: number] {
  const h = createHash('md5').update(feature).digest();
  return [h.readUInt32LE(0) % BUILTIN_DIMENSIONS, h[4]! & 1 ? 1 : -1];
}

/**
 * Light English stemming so "dropping", "drops" and "dropped" meet at "drop", and "printers"/"printing"
 * at "print". Short words are left alone ("vpn", "sso", "bus").
 */
export function stem(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word;
  let w = word;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  for (const suffix of ['ing', 'ers', 'ed', 'er', 'es', 's']) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      if (suffix === 's' && /(ss|us|is)$/.test(w)) break;
      w = w.slice(0, -suffix.length);
      // "dropp" → "drop", "stopp" → "stop" (but keep "ll", "ss": "install", "access").
      if (/([^aeiouls])\1$/.test(w)) w = w.slice(0, -1);
      break;
    }
  }
  return w;
}

/** Features with weights: words, word bigrams, char trigrams (Latin) and CJK uni/bigrams. */
export function features(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (f: string, w: number) => out.set(f, (out.get(f) ?? 0) + w);
  const normalized = text.normalize('NFKC').toLowerCase();
  const words: string[] = [];
  for (const token of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (!token) continue;
    if (CJK.test(token)) {
      const chars = [...token].filter((c) => CJK.test(c) || /[\p{L}\p{N}]/u.test(c));
      chars.forEach((c, i) => {
        add(`c:${c}`, 0.6);
        if (i + 1 < chars.length) add(`b:${c}${chars[i + 1]}`, 1.2);
      });
      continue;
    }
    if (STOP.has(token)) continue;
    const w = stem(token);
    words.push(w);
    add(`w:${w}`, 1.5);
    const padded = `^${w}$`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`t:${padded.slice(i, i + 3)}`, 0.35);
  }
  for (let i = 0; i + 1 < words.length; i++) add(`p:${words[i]} ${words[i + 1]}`, 0.8);
  return out;
}

/**
 * Deterministic offline embedding: signed feature hashing into 384 dimensions with sublinear term
 * weights, L2-normalised. Lexical rather than semantic, but language-agnostic (CJK included) and good
 * enough for retrieval over a help-desk corpus — and it needs no network, key or model download.
 */
export function builtinEmbed(text: string): number[] {
  const v = new Array<number>(BUILTIN_DIMENSIONS).fill(0);
  for (const [f, w] of features(text)) {
    const [i, sign] = bucket(f);
    v[i]! += sign * (1 + Math.log(w));
  }
  return normalize(v);
}

export function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm ? v.map((x) => x / norm) : v;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i]! * b[i]!;
  return s;
}
