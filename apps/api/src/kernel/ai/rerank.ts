import type { RerankProvider } from './config';
import { type AiConnection, aiPost, providerError } from './connection';

export interface RerankResult {
  /** Relevance per input document, in input order (0–1 for the usual cross-encoders). */
  scores: number[];
  /** Tokens the provider reports, when it does (Voyage). */
  tokens: number;
}

/**
 * Scores `documents` against `query` with a rerank endpoint. Documents the provider leaves out of its answer
 * (a `top_n` cut) score 0, so they keep their place below the ones it ranked.
 */
export async function rerank(
  conn: AiConnection,
  provider: RerankProvider,
  model: string,
  query: string,
  documents: string[],
): Promise<RerankResult> {
  const scores = new Array<number>(documents.length).fill(0);
  if (!documents.length) return { scores, tokens: 0 };
  const take = (items: { index: number; score: unknown }[]) => {
    for (const r of items)
      if (Number.isInteger(r.index) && r.index >= 0 && r.index < documents.length)
        scores[r.index] = Number.isFinite(Number(r.score)) ? Number(r.score) : 0;
  };

  if (provider === 'tei') {
    // Text Embeddings Inference: sigmoid scores unless `raw_scores`; long texts truncated server-side.
    const res = await aiPost(conn, '/rerank', { query, texts: documents, raw_scores: false, truncate: true });
    const data = (await res.json()) as { index: number; score: number }[];
    if (!Array.isArray(data)) throw providerError('empty_response');
    take(data.map((r) => ({ index: r.index, score: r.score })));
    return { scores, tokens: 0 };
  }

  if (provider === 'voyage') {
    const res = await aiPost(conn, '/rerank', {
      query,
      documents,
      ...(model ? { model } : {}),
      truncation: true,
    });
    const data = (await res.json()) as {
      data?: { index: number; relevance_score: number }[];
      usage?: { total_tokens?: number };
    };
    if (!Array.isArray(data.data)) throw providerError('empty_response');
    take(data.data.map((r) => ({ index: r.index, score: r.relevance_score })));
    return { scores, tokens: data.usage?.total_tokens ?? 0 };
  }

  // Cohere-style: Cohere (/v2/rerank), Jina (/v1/rerank), vLLM, Infinity, LiteLLM.
  const res = await aiPost(conn, '/rerank', {
    query,
    documents,
    ...(model ? { model } : {}),
    top_n: documents.length,
  });
  const data = (await res.json()) as {
    results?: { index: number; relevance_score?: number; score?: number }[];
    usage?: { total_tokens?: number };
  };
  if (!Array.isArray(data.results)) throw providerError('empty_response');
  take(data.results.map((r) => ({ index: r.index, score: r.relevance_score ?? r.score })));
  return { scores, tokens: data.usage?.total_tokens ?? 0 };
}
