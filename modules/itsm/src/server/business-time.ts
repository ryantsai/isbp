/**
 * Business-time arithmetic for SLAs — pure functions, no I/O.
 *
 * A calendar has weekly working hours per weekday (0 = Sunday … 6 = Saturday) in an IANA time zone,
 * plus holidays (local dates). Wall-clock ↔ instant conversion uses `Intl.DateTimeFormat`, so DST is
 * handled by the platform's time-zone database: a working interval is anchored to local wall time on
 * its day. An interval whose end is not after its start runs overnight into the next day (`22:00–06:00`,
 * or `09:00–00:00` for "until midnight"); it belongs to the day it starts on (holidays included).
 */
import type { WorkingHours } from '../contracts';

export interface CalendarSpec {
  timezone: string;
  hours: WorkingHours;
  /** Local dates (`YYYY-MM-DD`) on which no interval starts. */
  holidays?: readonly (string | { date: string })[];
  /** 24×7: business time equals wall-clock time. */
  alwaysOpen?: boolean;
}

export const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Searching further than this for working time means the calendar has (almost) none. */
const MAX_DAYS = 366 * 20;

/* ───────────────────────────── time zones ───────────────────────────── */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for IANA zone names the runtime knows (`Asia/Taipei`, `UTC`, …). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: number, timeZone: string): WallClock {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant)))
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Offset of the zone at an instant (local wall clock − UTC), in ms. */
export function zoneOffset(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Local calendar day of an instant, as days since 1970-01-01. */
export function localDay(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day) / DAY_MS;
}

const instantCache = new Map<string, number>();

/**
 * The instant of a local wall-clock time: `minuteOfDay` minutes after local midnight of `day`
 * (may exceed 1440 for the next day). Times inside a DST gap resolve to the later offset.
 */
export function localToInstant(day: number, minuteOfDay: number, timeZone: string): number {
  const key = `${timeZone}|${day}|${minuteOfDay}`;
  const hit = instantCache.get(key);
  if (hit !== undefined) return hit;
  const wall = day * DAY_MS + minuteOfDay * MINUTE_MS;
  let guess = wall - zoneOffset(wall, timeZone);
  const second = zoneOffset(guess, timeZone);
  if (wall - second !== guess) guess = wall - second;
  if (instantCache.size > 50_000) instantCache.clear();
  instantCache.set(key, guess);
  return guess;
}

export function isoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/* ───────────────────────────── calendars ───────────────────────────── */

interface Interval {
  start: number;
  end: number;
}

interface Compiled {
  timeZone: string;
  alwaysOpen: boolean;
  /** Per weekday, sorted by start; minutes from local midnight (`end` may exceed 1440). */
  days: Interval[][];
  holidays: Set<string>;
  hasHours: boolean;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

function compile(cal: CalendarSpec): Compiled {
  const days = Array.from({ length: 7 }, (_, i) =>
    (cal.hours.days[i] ?? [])
      .map((iv) => {
        const start = toMinutes(iv.start);
        let end = toMinutes(iv.end);
        if (end <= start) end += 1440;
        return { start, end };
      })
      .sort((a, b) => a.start - b.start),
  );
  return {
    timeZone: cal.timezone || 'UTC',
    alwaysOpen: Boolean(cal.alwaysOpen),
    days,
    holidays: new Set((cal.holidays ?? []).map((h) => (typeof h === 'string' ? h : h.date))),
    hasHours: days.some((d) => d.length > 0),
  };
}

const weekday = (day: number) => new Date(day * DAY_MS).getUTCDay();

/** Working intervals (as instants) of one local day; empty on holidays. */
function intervalsOn(c: Compiled, day: number): { start: number; end: number }[] {
  if (c.holidays.has(isoDate(day))) return [];
  return c.days[weekday(day)]!.map((iv) => ({
    start: localToInstant(day, iv.start, c.timeZone),
    end: localToInstant(day, iv.end, c.timeZone),
  }));
}

/* ───────────────────────────── arithmetic ───────────────────────────── */

/** `start` plus `ms` of business time. A calendar without working hours falls back to wall-clock time. */
export function addBusinessMs(start: Date, ms: number, cal: CalendarSpec): Date {
  const from = start.getTime();
  if (ms <= 0) return new Date(from);
  const c = compile(cal);
  if (c.alwaysOpen || !c.hasHours) return new Date(from + ms);
  let remaining = ms;
  let cursor = from;
  const first = localDay(from, c.timeZone) - 1; // yesterday's overnight interval may still be running
  for (let day = first; day < first + MAX_DAYS; day++) {
    for (const iv of intervalsOn(c, day)) {
      if (iv.end <= cursor) continue;
      const begin = Math.max(iv.start, cursor);
      const available = iv.end - begin;
      if (available >= remaining) return new Date(begin + remaining);
      remaining -= available;
      cursor = iv.end;
    }
  }
  return new Date(cursor + remaining);
}

export function addBusinessMinutes(start: Date, minutes: number, cal: CalendarSpec): Date {
  return addBusinessMs(start, minutes * MINUTE_MS, cal);
}

/** Business time between two instants, in ms (0 when `to` is not after `from`). */
export function businessMsBetween(from: Date, to: Date, cal: CalendarSpec): number {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return 0;
  const c = compile(cal);
  if (c.alwaysOpen || !c.hasHours) return b - a;
  let total = 0;
  let cursor = a;
  const last = localDay(b, c.timeZone);
  for (let day = localDay(a, c.timeZone) - 1; day <= last; day++) {
    for (const iv of intervalsOn(c, day)) {
      const begin = Math.max(iv.start, cursor);
      const end = Math.min(iv.end, b);
      if (end > begin) {
        total += end - begin;
        cursor = end;
      }
    }
  }
  return total;
}

export function businessMinutesBetween(from: Date, to: Date, cal: CalendarSpec): number {
  return businessMsBetween(from, to, cal) / MINUTE_MS;
}

/* ───────────────────────────── SLA clocks ───────────────────────────── */

/** The state of one SLA timer, as stored in `itsm.ticket_slas`. */
export interface SlaClock {
  startedAt: Date;
  targetMinutes: number;
  /** Business time spent paused (completed pauses). */
  pausedMs: number;
  /** Set while paused. */
  pausedAt: Date | null;
  /** Met / breached / cancelled at. */
  stoppedAt: Date | null;
}

/** Deadline: the target plus every completed pause, in business time from the start. */
export function slaDueAt(clock: SlaClock, cal: CalendarSpec): Date {
  return addBusinessMs(clock.startedAt, clock.targetMinutes * MINUTE_MS + clock.pausedMs, cal);
}

/** When `fraction` of the target has elapsed (warning threshold). */
export function slaWarnAt(clock: SlaClock, fraction: number, cal: CalendarSpec): Date {
  return addBusinessMs(
    clock.startedAt,
    Math.round(clock.targetMinutes * MINUTE_MS * fraction) + clock.pausedMs,
    cal,
  );
}

/** Business time counted against the target at `now` (pauses excluded). */
export function slaElapsedMs(clock: SlaClock, cal: CalendarSpec, now: Date): number {
  const end = clock.stoppedAt ?? clock.pausedAt ?? now;
  return Math.max(0, businessMsBetween(clock.startedAt, end, cal) - clock.pausedMs);
}

/** Elapsed / target: 0–1 while in time, ≥ 1 once breached. */
export function slaElapsedRatio(clock: SlaClock, cal: CalendarSpec, now: Date): number {
  if (clock.targetMinutes <= 0) return 0;
  const ratio = slaElapsedMs(clock, cal, now) / (clock.targetMinutes * MINUTE_MS);
  return Math.round(ratio * 1000) / 1000;
}

/** Resuming after a pause: the paused business time extends the deadline. */
export function slaResume(clock: SlaClock, cal: CalendarSpec, now: Date): SlaClock {
  if (!clock.pausedAt) return clock;
  return {
    ...clock,
    pausedMs: clock.pausedMs + businessMsBetween(clock.pausedAt, now, cal),
    pausedAt: null,
  };
}
