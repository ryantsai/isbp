/**
 * Pure helpers of the web pages (no React): unit-tested in `test/web-logic.test.ts`.
 */
import { addDays, daysBetween } from '../model';

export interface TimelineInput {
  startDate: string | null;
  noticeDate: string | null;
  endDate: string | null;
  today: string;
}

export interface Timeline {
  /** The first day drawn (the term start, or a little before the notice date / today). */
  from: string;
  to: string;
  /** 0–100 positions on the track. */
  notice: number | null;
  today: number;
  /** Where today is relative to the term. */
  phase: 'upcoming' | 'running' | 'notice' | 'ended';
  /** Today lies outside the drawn range (the marker is pinned to an edge). */
  todayOutside: 'before' | 'after' | null;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Marker positions for the renewal timeline: start → notice date → end, with today marked. */
export function renewalTimeline(c: TimelineInput): Timeline | null {
  if (!c.endDate) return null;
  const earliest = [c.noticeDate, c.today].filter((d): d is string => Boolean(d)).sort()[0]!;
  const from =
    c.startDate && c.startDate < c.endDate
      ? c.startDate
      : addDays(earliest < c.endDate ? earliest : c.endDate, -30);
  const span = Math.max(1, daysBetween(from, c.endDate));
  const pos = (d: string) => (daysBetween(from, d) / span) * 100;
  const rawToday = pos(c.today);
  const phase: Timeline['phase'] =
    daysBetween(c.today, c.endDate) < 0
      ? 'ended'
      : c.noticeDate && daysBetween(c.noticeDate, c.today) >= 0
        ? 'notice'
        : daysBetween(from, c.today) < 0
          ? 'upcoming'
          : 'running';
  return {
    from,
    to: c.endDate,
    notice: c.noticeDate ? clamp(pos(c.noticeDate)) : null,
    today: clamp(rawToday),
    phase,
    todayOutside: rawToday < 0 ? 'before' : rawToday > 100 ? 'after' : null,
  };
}

export type UsageTone = 'over' | 'full' | 'ok' | 'low' | 'unlimited';

/** Fill of a usage meter and how to colour it. */
export function usage(used: number, quantity: number | null, underUsedPercent = 60) {
  if (quantity === null) return { percent: used > 0 ? 100 : 0, tone: 'unlimited' as UsageTone };
  if (quantity === 0) return { percent: used > 0 ? 100 : 0, tone: (used > 0 ? 'over' : 'ok') as UsageTone };
  const percent = (used / quantity) * 100;
  const tone: UsageTone =
    used > quantity
      ? 'over'
      : used === quantity
        ? 'full'
        : quantity >= 10 && percent < underUsedPercent
          ? 'low'
          : 'ok';
  return { percent: Math.min(100, percent), tone };
}

/** "Renews in 23 days" buckets for the contract list. */
export function endPhase(daysToEnd: number | null): 'none' | 'ended' | 'today' | 'soon' | 'later' {
  if (daysToEnd === null) return 'none';
  if (daysToEnd < 0) return 'ended';
  if (daysToEnd === 0) return 'today';
  return daysToEnd <= 90 ? 'soon' : 'later';
}

/** Stacked-bar segments in a fixed status order, skipping empty ones. */
export function stackSegments<K extends string>(
  counts: Partial<Record<K, number>>,
  order: readonly K[],
): { key: K; value: number; start: number; percent: number }[] {
  const total = order.reduce((n, k) => n + (counts[k] ?? 0), 0);
  let start = 0;
  return order
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => {
      const value = counts[k]!;
      const seg = { key: k, value, start, percent: total ? (value / total) * 100 : 0 };
      start += seg.percent;
      return seg;
    });
}
