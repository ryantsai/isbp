import type { FastifyInstance } from 'fastify';

/**
 * Stand-ins for rerank endpoints, so the reranker connection can be tested end to end without a model: a document
 * scores the share of the query's words (Latin words, CJK characters) it contains. Not a model, but it ranks the
 * obvious match first, which is what "Test connection" checks.
 *
 * - `/rerank/v1/rerank`: the Cohere-style shape (Cohere, Jina, vLLM, Infinity, LiteLLM): `documents` → `results`.
 * - `/rerank/tei/rerank`: Hugging Face Text Embeddings Inference: `texts` → `[{ index, score }]`.
 * - `/rerank/voyage/rerank`: Voyage AI: `documents` → `data`.
 */
function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (!token) continue;
    if (/[぀-ヿ㐀-䶿一-鿿가-힯]/u.test(token)) for (const c of token) out.add(c);
    else if (token.length > 2) out.add(token);
  }
  return out;
}

export function overlapScore(query: string, document: string): number {
  const q = words(query);
  if (!q.size) return 0;
  const d = words(document);
  let hit = 0;
  for (const w of q) if (d.has(w) || [...d].some((x) => x.startsWith(w) || w.startsWith(x))) hit++;
  return Math.round((hit / q.size) * 1000) / 1000;
}

const ranked = (query: string, documents: string[]) =>
  documents
    .map((doc, index) => ({ index, score: overlapScore(query, doc) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

export function registerRerank(app: FastifyInstance) {
  app.post<{ Body: { query?: string; documents?: string[]; top_n?: number; model?: string } }>(
    '/rerank/v1/rerank',
    async (req) => {
      const results = ranked(req.body.query ?? '', req.body.documents ?? [])
        .slice(0, req.body.top_n ?? undefined)
        .map((r) => ({ index: r.index, relevance_score: r.score }));
      return { id: 'rerank-mock', model: req.body.model ?? 'overlap', results };
    },
  );

  app.post<{ Body: { query?: string; texts?: string[] } }>('/rerank/tei/rerank', async (req) =>
    ranked(req.body.query ?? '', req.body.texts ?? []),
  );

  app.post<{ Body: { query?: string; documents?: string[]; top_k?: number } }>(
    '/rerank/voyage/rerank',
    async (req) => ({
      object: 'list',
      data: ranked(req.body.query ?? '', req.body.documents ?? [])
        .slice(0, req.body.top_k ?? undefined)
        .map((r) => ({ index: r.index, relevance_score: r.score })),
      usage: { total_tokens: 10 },
    }),
  );
}
