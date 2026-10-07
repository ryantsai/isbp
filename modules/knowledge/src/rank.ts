/**
 * Re-ranking of semantic-index candidates at article level. The index returns chunk-level hits; an
 * article is ranked once per signal — by its best passage's similarity (vector) and by how many query
 * terms its title, summary, tags and body contain (keyword) — and the two ranks are fused with
 * Reciprocal Rank Fusion. Long articles therefore don't win just because they have many chunks.
 */

const RRF_K = 60;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

/** Latin words (3+ characters) and CJK bigrams, like the index's keyword matcher. */
export function keywordTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (!token) continue;
    if (CJK.test(token)) {
      const chars = [...token];
      if (chars.length === 1) terms.add(token);
      for (let i = 0; i + 1 < chars.length; i++) terms.add(chars[i]! + chars[i + 1]!);
    } else if (token.length >= 3) terms.add(token);
  }
  return [...terms].slice(0, 12);
}

export interface RankDoc {
  id: string;
  title: string;
  summary: string;
  body: string;
  tags: readonly string[];
  /** Best-passage cosine similarity from the index (0–1). */
  similarity: number;
}

/** Share of query terms found, weighted by where they appear (title 1, summary/tags 0.75, body 0.5). */
export function termCoverage(terms: readonly string[], doc: Omit<RankDoc, 'id' | 'similarity'>): number {
  if (!terms.length) return 0;
  const title = doc.title.normalize('NFKC').toLowerCase();
  const lead = `${doc.summary} ${doc.tags.join(' ')}`.normalize('NFKC').toLowerCase();
  const body = doc.body.normalize('NFKC').toLowerCase();
  let sum = 0;
  for (const t of terms) sum += title.includes(t) ? 1 : lead.includes(t) ? 0.75 : body.includes(t) ? 0.5 : 0;
  return sum / terms.length;
}

/** Article ids ordered by fused relevance, with a 0–1 score (1 = first in both rankings). */
export function rankDocuments(query: string, docs: readonly RankDoc[]): { id: string; score: number }[] {
  const terms = keywordTerms(query);
  const fused = new Map<string, number>(docs.map((d) => [d.id, 0]));
  const add = (ordered: readonly { id: string }[]) =>
    ordered.forEach((d, rank) => fused.set(d.id, fused.get(d.id)! + 1 / (RRF_K + rank + 1)));

  add([...docs].sort((a, b) => b.similarity - a.similarity));
  const lexical = docs
    .map((d) => ({ id: d.id, coverage: termCoverage(terms, d), similarity: d.similarity }))
    .filter((d) => d.coverage > 0)
    .sort((a, b) => b.coverage - a.coverage || b.similarity - a.similarity);
  add(lexical);

  const max = 2 / (RRF_K + 1);
  const similarity = new Map(docs.map((d) => [d.id, d.similarity]));
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1] || similarity.get(b[0])! - similarity.get(a[0])!)
    .map(([id, score]) => ({ id, score: Math.min(1, score / max) }));
}
