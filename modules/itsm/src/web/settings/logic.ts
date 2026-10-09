import type { Condition } from '@isbp/sdk';
import type { SlaPolicy } from '../../contracts';

/*
 * Pure helpers of the service desk settings (no React, no I/O) — unit-tested in `test/settings-logic.test.ts`.
 */

/**
 * SLA target durations typed as text ("4h", "30m", "1h 30m", "1.5h", "4 小時", "1時間30分"): pure parsing and the
 * parts used to format them back. Days are not accepted on purpose: targets count business time on the policy's
 * calendar, where a "day" would be ambiguous.
 */

/** Largest target the API accepts (a year, in minutes). */
export const MAX_TARGET_MINUTES = 525_600;

const UNIT = /(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|小時|小时|時間|时|時|minutes?|mins?|m|分鐘|分钟|分)/gy;

/** Minutes for a duration text, or null when it isn't one (or is under a minute / over a year). */
export function parseDuration(text: string): number | null {
  const s = text.normalize('NFKC').trim().toLowerCase();
  if (!s) return null;
  let total = 0;
  let pos = 0;
  let found = false;
  while (pos < s.length) {
    while (s[pos] === ' ') pos++;
    if (pos >= s.length) break;
    UNIT.lastIndex = pos;
    const m = UNIT.exec(s);
    if (!m) return null;
    const n = Number(m[1]!.replace(',', '.'));
    total += /^(m|min|分)/.test(m[2]!) ? n : n * 60;
    pos = UNIT.lastIndex;
    found = true;
  }
  const minutes = Math.round(total);
  return found && minutes >= 1 && minutes <= MAX_TARGET_MINUTES ? minutes : null;
}

/** Whole hours and the remaining minutes (business time: no days). */
export function durationParts(minutes: number): { hours: number; minutes: number } {
  const m = Math.max(0, Math.round(minutes));
  return { hours: Math.floor(m / 60), minutes: m % 60 };
}

const CATEGORY_FACTS = ['ticket.categoryKeys', 'ticket.categoryKey'];

/** The policy that exists for one category alone: a single rule "category is <key>" (with or without subcategories). */
export function ownPolicyOf<P extends Pick<SlaPolicy, 'condition'>>(
  key: string,
  policies: readonly P[],
): P | null {
  return (
    policies.find((p) => {
      const c = p.condition as Condition | null;
      return Boolean(c && 'fact' in c && CATEGORY_FACTS.includes(c.fact) && c.op === 'eq' && c.value === key);
    }) ?? null
  );
}

/** `items` with the one at `index` swapped with its neighbour in `direction` (unchanged at the ends). */
export function moved<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const out = [...items];
  const j = index + direction;
  if (j < 0 || j >= out.length) return out;
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}
