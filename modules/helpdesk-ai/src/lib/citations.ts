import type { Citation } from '../contracts';

export type CitationSource = Omit<Citation, 'n'>;

/**
 * Stable citation numbers for one conversation: an article keeps the number it got the first time it
 * was offered to the model, so `[2]` means the same article in every turn.
 */
export class CitationRegistry {
  private readonly byKey = new Map<string, Citation>();
  private next = 1;

  constructor(existing: readonly Citation[] = []) {
    for (const c of [...existing].sort((a, b) => a.n - b.n)) {
      const key = keyOf(c);
      if (this.byKey.has(key) || [...this.byKey.values()].some((x) => x.n === c.n)) continue;
      this.byKey.set(key, { ...c });
      this.next = Math.max(this.next, c.n + 1);
    }
  }

  /** The source's citation (numbered on first sight). */
  add(source: CitationSource): Citation {
    const key = keyOf(source);
    const found = this.byKey.get(key);
    if (found) return found;
    const c: Citation = { ...source, n: this.next++ };
    this.byKey.set(key, c);
    return c;
  }

  get(n: number): Citation | undefined {
    return [...this.byKey.values()].find((c) => c.n === n);
  }

  all(): Citation[] {
    return [...this.byKey.values()].sort((a, b) => a.n - b.n);
  }
}

const keyOf = (c: { id?: string; reference: string }) => (c.reference || c.id || '').toUpperCase();

/** Citation numbers used in a text: `[1]`, `[1, 3]`, `[2][3]` (not Markdown links `[x](…)`). */
export function citedNumbers(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g)) {
    for (const part of m[1]!.split(',')) {
      const n = Number(part.trim());
      if (n > 0) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The registry's citations a text actually refers to, by number. */
export function citationsIn(text: string, registry: CitationRegistry): Citation[] {
  return citedNumbers(text)
    .map((n) => registry.get(n))
    .filter((c): c is Citation => !!c);
}

/**
 * Cosine-similarity floors for knowledge hits. Answers shown to people (builtin replies, chat answers)
 * need a hit that is clearly about the question; context handed to a model may be looser, because the
 * model judges relevance itself. Tuned on the builtin embedder, where unrelated text scores ~0.05–0.2.
 */
export const RELEVANCE = {
  /** Shown to people: above 0.2 and within 70% of the best hit. */
  answer: { floor: 0.2, relative: 0.7 },
  /** Handed to a model, which judges relevance itself. */
  context: { floor: 0.1, relative: 0 },
} as const;

/** Hits worth using: above the floor and close enough to the best one, best first. */
export function relevantHits<T extends { similarity: number }>(
  hits: readonly T[],
  rule: { floor: number; relative: number },
  max = 3,
): T[] {
  const sorted = [...hits].sort((a, b) => b.similarity - a.similarity);
  const cut = Math.max(rule.floor, (sorted[0]?.similarity ?? 0) * rule.relative);
  return sorted.filter((h) => h.similarity >= cut).slice(0, max);
}

/** A one-line, Markdown-free teaser for an article (its summary, else the matching snippet). */
export function teaser(hit: { summary?: string | null; snippet?: string | null }, max = 220): string {
  const raw = hit.summary?.trim() || hit.snippet || '';
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\|?\s*:?-{3,}:?\s*/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
