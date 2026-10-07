import { type AiTriageOptions, priorityFor } from '@isbp/module-itsm/contracts';
import type { TriageNeighbour, TriageSuggestion } from '../contracts';

/** Neighbours below this cosine similarity are noise and do not vote. */
export const MIN_SIMILARITY = 0.1;

export interface Neighbour extends TriageNeighbour {
  impact: number | null;
  urgency: number | null;
}

export interface VoteResult {
  value: string | null;
  /** Winner's weight ÷ the weight of every voter (neighbours with no value count against it). */
  share: number;
  /** Mean similarity of the neighbours that agree with the winner. */
  meanSimilarity: number;
  /** share × meanSimilarity, clamped to 0–1. */
  confidence: number;
  supporters: number;
}

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Similarity-weighted vote. Each voter adds its weight (similarity) to its value; the heaviest value
 * wins (ties: more supporters, then first seen). Voters without a value still dilute the share.
 */
export function weightedVote(voters: { value: string | null; weight: number }[]): VoteResult {
  const valid = voters.filter((v) => v.weight > 0);
  const total = valid.reduce((n, v) => n + v.weight, 0);
  const tally = new Map<string, { weight: number; count: number }>();
  for (const v of valid) {
    if (!v.value) continue;
    const cur = tally.get(v.value) ?? { weight: 0, count: 0 };
    cur.weight += v.weight;
    cur.count += 1;
    tally.set(v.value, cur);
  }
  let winner: [string, { weight: number; count: number }] | null = null;
  for (const entry of tally) {
    if (
      !winner ||
      entry[1].weight > winner[1].weight + 1e-9 ||
      (Math.abs(entry[1].weight - winner[1].weight) <= 1e-9 && entry[1].count > winner[1].count)
    )
      winner = entry;
  }
  if (!winner || total <= 0)
    return { value: null, share: 0, meanSimilarity: 0, confidence: 0, supporters: 0 };
  const share = winner[1].weight / total;
  const meanSimilarity = winner[1].weight / winner[1].count;
  return {
    value: winner[0],
    share,
    meanSimilarity,
    confidence: clamp01(share * meanSimilarity),
    supporters: winner[1].count,
  };
}

/** Median of 1–3 levels (the rounded mean of the middle pair for even counts); null when empty. */
export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

/* ───────────────────────────── keyword heuristics ───────────────────────────── */

/** Phrases that mean many people are affected (→ impact 1), in en, zh-TW and ja-JP. */
export const IMPACT_KEYWORDS: readonly (string | RegExp)[] = [
  /\beveryone\b/,
  /\ball users\b/,
  /\bwhole (?:company|office|team|floor)\b/,
  /\bcompany[- ]wide\b/,
  /\boutage\b/,
  /\b(?:is|are|went|goes|gone) down\b/,
  /\bdown for\b/,
  /^down\b/,
  '全公司',
  '所有人',
  '大家都',
  '全部門',
  '全員',
  '全社',
  '停止',
  'ダウン',
];

/** Phrases that mean someone cannot work (→ urgency 1). */
export const URGENCY_KEYWORDS: readonly (string | RegExp)[] = [
  /\bcan(?:'|no)?t work\b/,
  /\bcannot work\b/,
  /\bunable to work\b/,
  /\bblocked\b/,
  /\burgent(?:ly)?\b/,
  /\basap\b/,
  '無法工作',
  '不能工作',
  '緊急',
  '十萬火急',
  '仕事ができない',
  '業務ができない',
  '至急',
];

function matches(text: string, patterns: readonly (string | RegExp)[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (text.includes(p)) out.push(p);
    } else {
      const m = p.exec(text);
      if (m) out.push(m[0].trim());
    }
  }
  return [...new Set(out)];
}

/** Keywords in the text that raise impact or urgency to 1 (case- and apostrophe-insensitive). */
export function keywordSignals(text: string): { impact: string[]; urgency: string[] } {
  const t = text.toLowerCase().replace(/[’‘`]/g, "'");
  return { impact: matches(t, IMPACT_KEYWORDS), urgency: matches(t, URGENCY_KEYWORDS) };
}

/* ───────────────────────────── builtin triage ───────────────────────────── */

export interface TriageTicket {
  type: string;
  title: string;
  description: string;
}

export interface BuiltinTriage {
  suggestion: TriageSuggestion;
  fieldConfidence: { category: number; group: number; impact: number; urgency: number };
  confidence: number;
  keywords: { impact: string[]; urgency: string[] };
  /** Voting neighbours, most similar first. */
  neighbours: Neighbour[];
}

/**
 * Weighted kNN vote over similar resolved tickets: category and group by similarity-weighted vote,
 * impact and urgency from the neighbours' median, raised to 1 by keywords. Only ids present in
 * `options` (and categories that apply to the ticket's type) are ever suggested.
 */
export function builtinTriage(
  ticket: TriageTicket,
  found: Neighbour[],
  options: AiTriageOptions,
): BuiltinTriage {
  const neighbours = found
    .filter((n) => n.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity);
  const categories = new Map(options.categories.map((c) => [c.id, c]));
  const groups = new Map(options.groups.map((g) => [g.id, g]));
  const applies = (id: string | null) => {
    const c = id ? categories.get(id) : undefined;
    return !!c && (c.ticketTypes.length === 0 || c.ticketTypes.includes(ticket.type as never));
  };

  const category = weightedVote(
    neighbours.map((n) => ({ value: applies(n.categoryId) ? n.categoryId : null, weight: n.similarity })),
  );
  let group = weightedVote(
    neighbours.map((n) => ({
      value: n.assignmentGroupId && groups.has(n.assignmentGroupId) ? n.assignmentGroupId : null,
      weight: n.similarity,
    })),
  );
  // No group evidence: route to the suggested category's default group, a little less sure.
  const defaultGroup = category.value ? categories.get(category.value)?.defaultGroupId : null;
  if (!group.value && defaultGroup && groups.has(defaultGroup))
    group = { ...group, value: defaultGroup, confidence: clamp01(category.confidence * 0.9) };

  const keywords = keywordSignals(`${ticket.title}\n${ticket.description}`);
  const level = (pick: (n: Neighbour) => number | null, keyword: boolean) => {
    const values = neighbours.map(pick).filter((v): v is number => v !== null && v >= 1 && v <= 3);
    const med = median(values) ?? 2;
    const agreeing = neighbours.filter((n) => pick(n) === med);
    const share = neighbours.length ? agreeing.length / neighbours.length : 0;
    const mean = agreeing.length ? agreeing.reduce((s, n) => s + n.similarity, 0) / agreeing.length : 0;
    const confidence = clamp01(share * mean);
    return keyword ? { value: 1, confidence: Math.max(confidence, 0.75) } : { value: med, confidence };
  };
  const impact = level((n) => n.impact, keywords.impact.length > 0);
  const urgency = level((n) => n.urgency, keywords.urgency.length > 0);

  const cat = category.value ? categories.get(category.value)! : null;
  const grp = group.value ? groups.get(group.value)! : null;
  return {
    suggestion: {
      categoryId: cat?.id ?? null,
      categoryPath: cat?.path ?? null,
      assignmentGroupId: grp?.id ?? null,
      assignmentGroupName: grp?.name ?? null,
      impact: impact.value,
      urgency: urgency.value,
      priority: priorityFor(impact.value, urgency.value),
    },
    fieldConfidence: {
      category: category.confidence,
      group: group.confidence,
      impact: impact.confidence,
      urgency: urgency.confidence,
    },
    confidence: category.value ? category.confidence : group.confidence,
    keywords,
    neighbours,
  };
}

/** Checks a model's suggestion against the options; returns the list of problems (empty = valid). */
export function validateSuggestion(
  s: { categoryId: string | null; assignmentGroupId: string | null; impact: number; urgency: number },
  ticketType: string,
  options: AiTriageOptions,
): string[] {
  const problems: string[] = [];
  if (s.categoryId) {
    const c = options.categories.find((x) => x.id === s.categoryId);
    if (!c) problems.push('categoryId');
    else if (c.ticketTypes.length && !c.ticketTypes.includes(ticketType as never))
      problems.push('categoryId');
  }
  if (s.assignmentGroupId && !options.groups.some((g) => g.id === s.assignmentGroupId))
    problems.push('assignmentGroupId');
  if (![1, 2, 3].includes(s.impact)) problems.push('impact');
  if (![1, 2, 3].includes(s.urgency)) problems.push('urgency');
  return problems;
}
