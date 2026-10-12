/**
 * Retrieval evaluation: labelled questions → recall@k and mean reciprocal rank, per language. Used by the
 * retrieval regression test (a floor on the builtin setup) and by `pnpm ai:eval` (the live index, with whatever
 * embedder and reranker are configured), so model choices are compared on our own content and languages.
 */
export interface EvalCase {
  locale: string;
  q: string;
  /** The key of the document that answers it (any of its language versions counts). */
  expect: string;
  /** Asked in a language the document isn't written in: reported, not held to a floor. */
  crossLingual?: boolean;
}

export interface EvalScores {
  cases: number;
  /** Share of cases whose document is the first hit. */
  recallAt1: number;
  /** Share of cases whose document is among the first five hits. */
  recallAt5: number;
  /** Mean of 1 / rank of the document (0 when it isn't found). */
  mrr: number;
}

export interface EvalReport {
  overall: EvalScores;
  byLocale: Record<string, EvalScores>;
  crossLingual: EvalScores;
  /** Cases whose document wasn't in the first five hits, with what came first. */
  misses: { locale: string; q: string; expect: string; got: string[] }[];
}

/**
 * Runs every case through `search` (which returns the document keys of its hits, best first) and scores them.
 */
export async function evaluate(
  cases: EvalCase[],
  search: (c: EvalCase) => Promise<string[]>,
): Promise<EvalReport> {
  const ranks: { c: EvalCase; rank: number; got: string[] }[] = [];
  for (const c of cases) {
    const got = await search(c);
    const i = got.indexOf(c.expect);
    ranks.push({ c, rank: i < 0 ? 0 : i + 1, got });
  }
  const score = (rows: typeof ranks): EvalScores => ({
    cases: rows.length,
    recallAt1: rows.length ? rows.filter((r) => r.rank === 1).length / rows.length : 0,
    recallAt5: rows.length ? rows.filter((r) => r.rank > 0 && r.rank <= 5).length / rows.length : 0,
    mrr: rows.length ? rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rows.length : 0,
  });
  const main = ranks.filter((r) => !r.c.crossLingual);
  const byLocale: Record<string, EvalScores> = {};
  for (const locale of [...new Set(main.map((r) => r.c.locale))])
    byLocale[locale] = score(main.filter((r) => r.c.locale === locale));
  return {
    overall: score(main),
    byLocale,
    crossLingual: score(ranks.filter((r) => r.c.crossLingual)),
    misses: ranks
      .filter((r) => r.rank === 0 || r.rank > 5)
      .map((r) => ({ locale: r.c.locale, q: r.c.q, expect: r.c.expect, got: r.got.slice(0, 3) })),
  };
}

/** A plain-text table of a report (for the CLI and test logs). */
export function formatReport(report: EvalReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(5);
  const line = (name: string, s: EvalScores) =>
    `${name.padEnd(14)} ${String(s.cases).padStart(5)} ${pct(s.recallAt1)} ${pct(s.recallAt5)} ${s.mrr.toFixed(3).padStart(6)}`;
  return [
    `${'Questions'.padEnd(14)} ${'n'.padStart(5)} ${'R@1'.padStart(5)} ${'R@5'.padStart(5)} ${'MRR'.padStart(6)}`,
    ...Object.entries(report.byLocale).map(([l, s]) => line(l, s)),
    line('all', report.overall),
    line('cross-lingual', report.crossLingual),
    ...(report.misses.length
      ? [
          '',
          'Not in the top 5:',
          ...report.misses.map(
            (m) => `  [${m.locale}] ${m.q} → ${m.expect} (got ${m.got.join(', ') || 'nothing'})`,
          ),
        ]
      : []),
  ].join('\n');
}
