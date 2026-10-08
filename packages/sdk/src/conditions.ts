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
 * `valueFact` compares with another fact instead of a fixed `value` (`end` `gte` `start`).
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
      fact: string;
      op: ConditionOp;
      value?: ConditionValue | ConditionValue[];
      valueFact?: string;
      /**
       * Shifts the compared date (`value` or `valueFact`) by this many days, e.g. `{ fact: 'end', op: 'lte',
       * valueFact: 'start', valueOffsetDays: 366 }` is "at most a year after the start". Dates are `YYYY-MM-DD` or ISO
       * date-times; a value that isn't a date then matches nothing.
       */
      valueOffsetDays?: number;
    };

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
        valueFact: z.string().regex(FACT_PATH_RE, 'Invalid fact path').optional(),
        valueOffsetDays: z.number().int().min(-36_500).max(36_500).optional(),
      })
      .strict(),
  ]),
);

/**
 * Reads `a.b.c` from nested objects; undefined when any segment is missing. Lists are traversed: a numeric segment
 * picks an element (`data.rules.0.port`), any other segment is read from every element and the values are returned as
 * one flat list without the missing ones (`data.rules.port` → `[443, 22]`), so `eq`, `in` and `contains` match any
 * row and `empty` means "no row has it".
 */
export function getFact(facts: unknown, path: string): unknown {
  return readPath(facts, path.split('.'));
}

function readPath(start: unknown, segs: readonly string[]): unknown {
  let cur: unknown = start;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (Array.isArray(cur) && !/^\d+$/.test(seg)) {
      const rest = segs.slice(i);
      return cur.flatMap((el) => {
        const v = readPath(el, rest);
        return v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v];
      });
    }
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** A reserved fact: today's date (`YYYY-MM-DD`, UTC) when form rules and workflows are evaluated. */
export const TODAY_FACT = 'today';
/** Facts every condition may read besides the evaluated data (never "unknown fields" in builders). */
export const RESERVED_FACTS: readonly string[] = [TODAY_FACT];

/** Today as `YYYY-MM-DD` in UTC (the value of the `today` fact). */
export function todayFact(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** `facts` with the reserved `today` fact added (a fact of the same name in `facts` wins). */
export function withToday(facts: unknown, now: Date = new Date()): Record<string, unknown> {
  return {
    [TODAY_FACT]: todayFact(now),
    ...(facts && typeof facts === 'object' && !Array.isArray(facts)
      ? (facts as Record<string, unknown>)
      : {}),
  };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY_MS = 86_400_000;

/** A date (`YYYY-MM-DD` or ISO date-time, or a list of them) plus `days`; anything else is no value. */
export function shiftDate(value: unknown, days: number): unknown {
  if (Array.isArray(value)) return value.map((v) => shiftDate(v, days)).filter((v) => v !== undefined);
  if (typeof value !== 'string') return undefined;
  if (DATE_ONLY_RE.test(value)) {
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return undefined;
    return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
  }
  if (DATE_TIME_RE.test(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    return new Date(d.getTime() + days * DAY_MS).toISOString();
  }
  return undefined;
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
      // A list (several picked records, a table's column) matches when any element does.
      if (Array.isArray(fact)) return fact.some((f) => evalRule(f, op, value));
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
  const raw = condition.valueFact ? getFact(facts, condition.valueFact) : condition.value;
  const value = condition.valueOffsetDays ? shiftDate(raw, condition.valueOffsetDays) : raw;
  return evalRule(getFact(facts, condition.fact), condition.op, value);
}

/** Every fact path a condition reads (for "unknown field" warnings in builders). */
export function conditionFacts(condition: Condition | null | undefined): string[] {
  if (!condition) return [];
  if ('all' in condition) return condition.all.flatMap(conditionFacts);
  if ('any' in condition) return condition.any.flatMap(conditionFacts);
  if ('not' in condition) return conditionFacts(condition.not);
  return condition.valueFact ? [condition.fact, condition.valueFact] : [condition.fact];
}
