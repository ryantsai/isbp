import { STOP, stem } from './embedder';

/**
 * Search terms for the index's keyword arm, made in the application so they work the same on every Postgres
 * (no text-search dictionary, extension or language configuration needed): stored per chunk in `terms text[]`
 * (GIN) and matched by array containment.
 *
 * - Latin words: NFKC, lower case, light stemming, English stop words dropped.
 * - Identifiers kept whole as well as split: ticket numbers (`inc-1234`), error codes (`0x80070005`), KB numbers,
 *   versions and host names, which people search for exactly.
 * - Chinese and Japanese: the words `Intl.Segmenter` finds (ICU dictionaries) plus every character bigram of the
 *   run, so a query still matches when the segmenter splits a phrase differently in the document.
 *
 * Bump `TERMS_VERSION` when the rules change: the reindex job re-derives the terms of older chunks.
 */
export const TERMS_VERSION = 1;

/** Terms kept per chunk (an 800-character CJK chunk has fewer than 1 000). */
const MAX_TERMS = 1500;
/** Terms a query is matched with. */
const MAX_QUERY_TERMS = 24;

const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯ｦ-ﾟ]/u;
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯ｦ-ﾟー]+/gu;
const KANA = /[぀-ヿｦ-ﾟ]/u;
const HANGUL = /[가-힯]/u;
/** A run of letters/digits joined by `-`, `_`, `.`, `:` or `/` (INC-1234, kb5034441, 10.1.2.3, v2.3.1). */
const IDENTIFIER = /[\p{L}\p{N}]+(?:[-_.:/][\p{L}\p{N}]+)+/gu;

const segmenters = new Map<string, Intl.Segmenter>();
function segmenter(locale: string): Intl.Segmenter {
  let s = segmenters.get(locale);
  if (!s) segmenters.set(locale, (s = new Intl.Segmenter(locale, { granularity: 'word' })));
  return s;
}

/** Terms of a text, most specific first: identifiers, then words, then CJK bigrams. */
function terms(text: string): { identifiers: string[]; words: string[]; bigrams: string[] } {
  const normalized = text.normalize('NFKC').toLowerCase();
  const identifiers = new Set<string>();
  const words = new Set<string>();
  const bigrams = new Set<string>();

  for (const m of normalized.matchAll(IDENTIFIER)) {
    const id = m[0].replace(/[-_.:/]+$/, '');
    // Skip prose like "e.g" or a lone "a/b": an identifier has a digit or is long enough to be a name.
    if (/\d/.test(id) || id.length >= 6) identifiers.add(id);
  }

  // CJK runs: dictionary words and bigrams; the rest of the text is split into Latin words and numbers.
  const latin = normalized.replace(CJK_RUN, (run) => {
    const locale = KANA.test(run) ? 'ja' : HANGUL.test(run) ? 'ko' : 'zh-Hant';
    for (const seg of segmenter(locale).segment(run))
      if (seg.isWordLike && [...seg.segment].length >= 2) words.add(seg.segment);
    const chars = [...run].filter((c) => CJK_CHAR.test(c));
    if (chars.length === 1) words.add(chars[0]!);
    for (let i = 0; i + 1 < chars.length; i++) bigrams.add(chars[i]! + chars[i + 1]!);
    return ' ';
  });
  for (const token of latin.split(/[^\p{L}\p{N}]+/u)) {
    if (!token || STOP.has(token)) continue;
    // Two-letter words matter in IT (os, ad, pc, ip); single letters and digits don't.
    if (token.length < 2) continue;
    words.add(stem(token));
  }
  return { identifiers: [...identifiers], words: [...words], bigrams: [...bigrams] };
}

/** Index terms of a chunk (deduplicated, capped). */
export function searchTerms(text: string): string[] {
  const t = terms(text);
  return [...new Set([...t.identifiers, ...t.words, ...t.bigrams])].slice(0, MAX_TERMS);
}

/** Query terms, most specific first (identifiers, words, bigrams), capped. */
export function queryTerms(query: string): string[] {
  const t = terms(query);
  return [...new Set([...t.identifiers, ...t.words, ...t.bigrams])].slice(0, MAX_QUERY_TERMS);
}

/**
 * Inverse document frequency (BM25's, always positive): rare terms count for more than common ones, so "VPN" in
 * "VPN keeps dropping" outweighs "keep".
 */
export function idf(df: number, total: number): number {
  return Math.log(1 + (Math.max(total, df) - df + 0.5) / (df + 0.5));
}
