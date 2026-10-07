/**
 * Schedule arithmetic (server side; it needs the cron parser): next run times in a job's time zone,
 * intervals from the previous slot, and what to do about slots that were missed.
 */
import { CronExpressionParser } from 'cron-parser';
import { cronFieldCount, LIMITS } from './model';

export interface ScheduleSpec {
  kind: 'cron' | 'interval' | 'after' | 'manual';
  cron?: string | null;
  timezone?: string | null;
  intervalMinutes?: number | null;
}

const zones = new Map<string, boolean>();

/** An IANA time zone this runtime knows. */
export function isValidTimezone(tz: string): boolean {
  let ok = zones.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      ok = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) || tz === 'UTC';
    } catch {
      ok = false;
    }
    zones.set(tz, ok);
  }
  return ok;
}

/** A readable reason the expression can't be used, or null when it is valid. */
export function cronError(expr: string, tz = 'UTC'): string | null {
  if (!expr.trim()) return 'Enter a cron expression';
  if (cronFieldCount(expr) !== 5) return 'Use five fields: minute, hour, day of month, month and day of week';
  if (!isValidTimezone(tz)) return `Unknown time zone ${tz}`;
  try {
    CronExpressionParser.parse(expr, { tz, currentDate: new Date() }).next();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** First cron occurrence strictly after `after`, in `tz`. */
export function nextCron(expr: string, tz: string, after: Date): Date | null {
  try {
    return CronExpressionParser.parse(expr, { tz, currentDate: after }).next().toDate();
  } catch {
    return null;
  }
}

/** Latest cron occurrence at or before `at`. */
export function previousCron(expr: string, tz: string, at: Date): Date | null {
  try {
    return CronExpressionParser.parse(expr, { tz, currentDate: new Date(at.getTime() + 1) })
      .prev()
      .toDate();
  } catch {
    return null;
  }
}

/**
 * The slot after `slot`: the next cron occurrence, or `slot + interval` (intervals count from the previous
 * slot, not from when the run finished). Triggers without a clock return null.
 */
export function slotAfter(spec: ScheduleSpec, slot: Date): Date | null {
  if (spec.kind === 'cron' && spec.cron) return nextCron(spec.cron, spec.timezone || 'UTC', slot);
  if (spec.kind === 'interval' && spec.intervalMinutes)
    return new Date(slot.getTime() + spec.intervalMinutes * 60_000);
  return null;
}

/**
 * `next_run_at` for a job that was just created, edited or enabled: the next cron occurrence, or one
 * interval from now.
 */
export function firstRun(spec: ScheduleSpec, now: Date): Date | null {
  if (spec.kind === 'cron' && spec.cron) return nextCron(spec.cron, spec.timezone || 'UTC', now);
  if (spec.kind === 'interval' && spec.intervalMinutes)
    return new Date(now.getTime() + Math.max(LIMITS.intervalMinutes.min, spec.intervalMinutes) * 60_000);
  return null;
}

/** The next `count` run times from `from`. */
export function nextRuns(spec: ScheduleSpec, from: Date, count: number): Date[] {
  const out: Date[] = [];
  let at = firstRun(spec, from);
  while (at && out.length < count) {
    out.push(at);
    at = slotAfter(spec, at);
  }
  return out;
}

/** Run times in `[from, until]` starting at `first` (e.g. the stored `next_run_at`), at most `limit`. */
export function runsBetween(spec: ScheduleSpec, first: Date | null, until: Date, limit: number): Date[] {
  const out: Date[] = [];
  let at = first;
  while (at && at.getTime() <= until.getTime() && out.length < limit) {
    out.push(at);
    at = slotAfter(spec, at);
  }
  return out;
}

export interface DuePlan {
  /** Slot to run now (on time, or late within the misfire grace). */
  run: Date | null;
  /** Latest slot that was missed beyond the grace (logged as a skipped run). */
  missed: Date | null;
  /** Earlier slots that were missed and are not run (counted, capped at 1,000). */
  missedCount: number;
  /** The new `next_run_at`. */
  next: Date | null;
}

const MAX_COUNT = 1_000;

/**
 * What the tick does with a job whose `next_run_at` (`slot`) is due (≤ now + lookahead). A slot in the
 * future (inside the lookahead) runs on time. When slots passed while the platform was down, only the
 * latest one matters: it runs once if it is within the grace period, otherwise it is logged as missed.
 */
export function planDue(spec: ScheduleSpec, slot: Date, now: Date, graceMs: number): DuePlan {
  if (slot.getTime() > now.getTime())
    return { run: slot, missed: null, missedCount: 0, next: slotAfter(spec, slot) };
  let last = slot;
  let passed = 1;
  if (spec.kind === 'interval' && spec.intervalMinutes) {
    const step = spec.intervalMinutes * 60_000;
    const n = Math.floor((now.getTime() - slot.getTime()) / step);
    last = new Date(slot.getTime() + n * step);
    passed = n + 1;
  } else if (spec.kind === 'cron' && spec.cron) {
    const prev = previousCron(spec.cron, spec.timezone || 'UTC', now);
    if (prev && prev.getTime() > slot.getTime()) {
      last = prev;
      passed = 1;
      for (let at = slotAfter(spec, slot); at && at.getTime() <= prev.getTime() && passed < MAX_COUNT;) {
        passed++;
        at = slotAfter(spec, at);
      }
    }
  }
  const next = slotAfter(spec, last);
  if (now.getTime() - last.getTime() <= graceMs)
    return { run: last, missed: null, missedCount: Math.min(passed - 1, MAX_COUNT), next };
  return { run: null, missed: last, missedCount: Math.min(passed, MAX_COUNT), next };
}
