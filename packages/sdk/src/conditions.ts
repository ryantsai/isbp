import { z } from 'zod';

/* ───────────────────────────── localized text ───────────────────────────── */

/**
 * Admin-authored text (form labels, workflow step names shown to users) in any of the platform's
 * locales. At least one locale must be filled; {@link localize} falls back to English, then to any
 * filled locale, so users never see an empty label.
 */
export type LocalizedText = { en?: string; 'zh-TW'?: string; 'ja-JP'?: string };

const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;

export const localizedTextSchema = z
  .object({
    en: z.string().trim().max(2000).optional(),
    'zh-TW': z.string().trim().max(2000).optional(),
    'ja-JP': z.string().trim().max(2000).optional(),
  })
  .refine((t) => LOCALES.some((l) => t[l]), 'Enter the text in at least one language');

export function localize(text: LocalizedText | string | null | undefined, locale: string): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text[locale as keyof LocalizedText] || text.en || LOCALES.map((l) => text[l]).find(Boolean) || '';
}

/* ───────────────────────────── conditions ───────────────────────────── */

export const CONDITION_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'empty',
  'notEmpty',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export type ConditionValue = string | number | boolean | null;

/**
 * A safe, declarative condition (never evaluated as code). Facts are dotted paths into the data the
 * condition is evaluated against — workflow facts (`role.riskLevel`) or other form fields (`deviceType`).
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; op: ConditionOp; value?: ConditionValue | ConditionValue[] };

const conditionValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
export const FACT_PATH_RE = /^[a-zA-Z_][\w-]*(\.[a-zA-Z_][\w-]*){0,5}$/;

export const conditionSchema: z.ZodType<Condition, Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).max(50) }).strict(),
    z.object({ any: z.array(conditionSchema).max(50) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z
      .object({
        fact: z.string().regex(FACT_PATH_RE, 'Invalid fact path'),
        op: z.enum(CONDITION_OPS),
        value: z.union([conditionValue, z.array(conditionValue).max(100)]).optional(),
      })
      .strict(),
  ]),
);

/** Reads `a.b.c` from nested objects; undefined when any segment is missing. */
export function getFact(facts: unknown, path: string): unknown {
  let cur: unknown = facts;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) return (a ?? null) === (b ?? null);
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na === nb;
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return false;
}

/** Numeric when both sides are numbers; otherwise ordinal string comparison (works for ISO dates). */
function compare(a: unknown, b: unknown): number | null {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na - nb;
  if (typeof a === 'string' && typeof b === 'string' && a && b) return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function evalRule(fact: unknown, op: ConditionOp, value: unknown): boolean {
  const list = Array.isArray(value) ? value : [value];
  switch (op) {
    case 'eq':
      return Array.isArray(fact) ? fact.some((f) => looseEqual(f, value)) : looseEqual(fact, value);
    case 'neq':
      return !evalRule(fact, 'eq', value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const c = compare(fact, value);
      if (c === null) return false;
      return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
    }
    case 'in':
      return Array.isArray(fact)
        ? fact.some((f) => list.some((v) => looseEqual(f, v)))
        : list.some((v) => looseEqual(fact, v));
    case 'nin':
      return !evalRule(fact, 'in', value);
    case 'contains':
      if (Array.isArray(fact)) return fact.some((f) => looseEqual(f, value));
      return (
        typeof fact === 'string' &&
        typeof value === 'string' &&
        fact.toLowerCase().includes(value.toLowerCase())
      );
    case 'empty':
      return isEmpty(fact);
    case 'notEmpty':
      return !isEmpty(fact);
  }
}

/** Evaluates a condition against facts. Unknown facts are `undefined` (so `empty` is true). */
export function evaluateCondition(
  condition: Condition | null | undefined,
  facts: unknown,
  depth = 0,
): boolean {
  if (!condition) return true;
  if (depth > 20) return false;
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, facts, depth + 1));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, facts, depth + 1));
  if ('not' in condition) return !evaluateCondition(condition.not, facts, depth + 1);
  return evalRule(getFact(facts, condition.fact), condition.op, condition.value);
}

/** Every fact path a condition reads (for "unknown field" warnings in builders). */
export function conditionFacts(condition: Condition | null | undefined): string[] {
  if (!condition) return [];
  if ('all' in condition) return condition.all.flatMap(conditionFacts);
  if ('any' in condition) return condition.any.flatMap(conditionFacts);
  if ('not' in condition) return conditionFacts(condition.not);
  return [condition.fact];
}
