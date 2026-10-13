/**
 * Pure rules of status reporting (Phase 11, `docs/architecture.md` §17): reporting periods, how a project's state in
 * the status report is decided from what people reported and what the plan says, and the vocabulary of report
 * templates. Dates are calendar days (`YYYY-MM-DD`) in the schedule's time zone; no I/O, no clock.
 */

/* ───────────────────────────── periods ───────────────────────────── */

export const CADENCES = ['weekly', 'biweekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

/** ISO weekday the update is due: 1 = Monday … 5 = Friday. */
export const DUE_WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** Every-two-weeks periods are pairs of ISO weeks counted from this Monday (ISO 2024-W01). */
export const BIWEEKLY_EPOCH = '2024-01-01';

export interface ReportingPeriod {
  /** `2026-W42` (weekly, and the first week of a two-week period) or `2026-10` (monthly). */
  key: string;
  cadence: Cadence;
  /** First and last day of the period. */
  start: string;
  end: string;
  /** The day the update is due (by the end of it). */
  due: string;
}

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function plusDays(value: string, days: number): string {
  const d = day(value);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** 0 = Monday … 6 = Sunday. */
const weekdayOf = (value: string) => (day(value).getUTCDay() + 6) % 7;
const mondayOf = (value: string) => plusDays(value, -weekdayOf(value));
const daysFrom = (a: string, b: string) => Math.round((day(b).getTime() - day(a).getTime()) / 86_400_000);

/** ISO week-numbering year and week of a date (the week belongs to the year of its Thursday). */
export function isoWeekOf(value: string): { year: number; week: number } {
  const thursday = day(plusDays(mondayOf(value), 3));
  const year = thursday.getUTCFullYear();
  const week = Math.floor(daysFrom(`${year}-01-01`, iso(thursday)) / 7) + 1;
  return { year, week };
}

export const isoWeekKey = (value: string) => {
  const w = isoWeekOf(value);
  return `${pad(w.year, 4)}-W${pad(w.week)}`;
};

/** Monday of an ISO week (`2026-W42`), or null for a malformed key or a week the year doesn't have. */
export function mondayOfIsoWeek(key: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const monday = plusDays(mondayOf(`${pad(year, 4)}-01-04`), (week - 1) * 7);
  return isoWeekOf(monday).year === year ? monday : null;
}

function lastDayOfMonth(year: number, month: number): string {
  return iso(new Date(Date.UTC(year, month, 0)));
}

/** The last `weekday` (1–7) of a month: "the last Friday". */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  let d = lastDayOfMonth(year, month);
  while (weekdayOf(d) !== weekday - 1) d = plusDays(d, -1);
  return d;
}

/** The reporting period a calendar date falls in. */
export function periodOf(date: string, cadence: Cadence, dueWeekday: number): ReportingPeriod {
  if (cadence === 'monthly') {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    return {
      key: `${pad(year, 4)}-${pad(month)}`,
      cadence,
      start: `${pad(year, 4)}-${pad(month)}-01`,
      end: lastDayOfMonth(year, month),
      due: lastWeekdayOfMonth(year, month, dueWeekday),
    };
  }
  let start = mondayOf(date);
  if (cadence === 'biweekly') {
    const index = Math.floor(daysFrom(BIWEEKLY_EPOCH, start) / 7);
    start = plusDays(start, -(((index % 2) + 2) % 2) * 7);
  }
  const length = cadence === 'biweekly' ? 14 : 7;
  return {
    key: isoWeekKey(start),
    cadence,
    start,
    end: plusDays(start, length - 1),
    due: plusDays(start, length - 7 + dueWeekday - 1),
  };
}

/** The period of a key (`2026-W42`, `2026-10`), or null when the key is not a period of this cadence. */
export function periodFromKey(key: string, cadence: Cadence, dueWeekday: number): ReportingPeriod | null {
  if (cadence === 'monthly') {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    return periodOf(`${key}-01`, cadence, dueWeekday);
  }
  const monday = mondayOfIsoWeek(key);
  if (!monday) return null;
  const period = periodOf(monday, cadence, dueWeekday);
  return period.start === monday ? period : null;
}

/** The period `n` periods after (or before, when negative) this one. */
export function shiftPeriod(period: ReportingPeriod, n: number, dueWeekday: number): ReportingPeriod {
  if (period.cadence === 'monthly') {
    const year = Number(period.start.slice(0, 4));
    const month = Number(period.start.slice(5, 7)) - 1 + n;
    const d = new Date(Date.UTC(year, month, 1));
    return periodOf(iso(d), 'monthly', dueWeekday);
  }
  const length = period.cadence === 'biweekly' ? 14 : 7;
  return periodOf(plusDays(period.start, n * length), period.cadence, dueWeekday);
}

/* ───────────────────────────── updates ───────────────────────────── */

export const STATUS_UPDATE_STATES = ['pending', 'submitted'] as const;
export type StatusUpdateState = (typeof STATUS_UPDATE_STATES)[number];

/**
 * What lists show for an expected or posted update: `due` (pending, not yet due), `overdue` (pending past its due
 * time, period still open), `missed` (the period ended without it), `submitted` (on time) and `late`.
 */
export const UPDATE_STANDINGS = ['due', 'overdue', 'missed', 'submitted', 'late'] as const;
export type UpdateStanding = (typeof UPDATE_STANDINGS)[number];

export function standingOf(
  u: { state: StatusUpdateState; dueAt: Date; closesAt: Date; submittedAt: Date | null },
  now: Date,
): UpdateStanding {
  if (u.state === 'submitted') return u.submittedAt && u.submittedAt > u.dueAt ? 'late' : 'submitted';
  if (now >= u.closesAt) return 'missed';
  return now > u.dueAt ? 'overdue' : 'due';
}

/* ───────────────────────────── project state ───────────────────────────── */

/** Health values in order of severity (the status an update reports uses the same scale). */
export const HEALTH_SEVERITY = { on_track: 0, at_risk: 1, off_track: 2 } as const;
export type ReportedStatus = keyof typeof HEALTH_SEVERITY;

export const REPORT_STATES = ['delayed', 'at_risk', 'on_track', 'no_update', 'completed'] as const;
export type ReportState = (typeof REPORT_STATES)[number];

/** Why a project is delayed or at risk. `value` is days (`slip`, `target_passed`) or a count. */
export const STATE_REASONS = [
  'reported_off_track',
  'slip',
  'target_passed',
  'milestones_overdue',
  'reported_at_risk',
  'tasks_overdue',
] as const;
export type StateReasonCode = (typeof STATE_REASONS)[number];
export interface StateReason {
  code: StateReasonCode;
  value: number | null;
}

const DELAYING: readonly StateReasonCode[] = [
  'reported_off_track',
  'slip',
  'target_passed',
  'milestones_overdue',
];

/** Overdue tasks put a project at risk from this many on, or from this share of its open tasks. */
export const OVERDUE_TASKS_AT_RISK = 3;
export const OVERDUE_SHARE_AT_RISK = 0.2;

/** What the plan says about a project (live, or the snapshot an update kept). */
export interface ProjectSignals {
  targetDate: string | null;
  openTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  overdueMilestones: number;
  /** Done ÷ (all but cancelled), 0–100. */
  progress: number;
  nextMilestone: { name: string; dueDate: string | null } | null;
}

export interface ProjectStateInput {
  /** What the updates say (the managers' update, else the most severe one); null without an update. */
  reported: ReportedStatus | null;
  /** The expected finish date the updates give, if any. */
  forecastDate: string | null;
  /** Signals, or null when nothing is known (a past period without an update). */
  signals: ProjectSignals | null;
  /** Completed within the period. */
  completed: boolean;
  today: string;
}

export interface ProjectStateResult {
  state: ReportState;
  reasons: StateReason[];
  /** The updates say "on track" (or "at risk") but the plan says worse. */
  mismatch: boolean;
}

/**
 * The project's state in the status report: delayed when someone reports it off track, the expected finish is after
 * the target date, the target date has passed or milestones are overdue; at risk when someone reports it at risk or
 * enough tasks are overdue; otherwise on track when an update says so, else "no update".
 */
export function projectState(input: ProjectStateInput): ProjectStateResult {
  if (input.completed) return { state: 'completed', reasons: [], mismatch: false };
  const reasons: StateReason[] = [];
  const s = input.signals;
  if (input.reported === 'off_track') reasons.push({ code: 'reported_off_track', value: null });
  const target = s?.targetDate ?? null;
  if (target && input.forecastDate && input.forecastDate > target)
    reasons.push({ code: 'slip', value: daysFrom(target, input.forecastDate) });
  else if (target && target < input.today)
    reasons.push({ code: 'target_passed', value: daysFrom(target, input.today) });
  if (s && s.overdueMilestones > 0) reasons.push({ code: 'milestones_overdue', value: s.overdueMilestones });
  if (input.reported === 'at_risk') reasons.push({ code: 'reported_at_risk', value: null });
  if (
    s &&
    s.overdueTasks > 0 &&
    (s.overdueTasks >= OVERDUE_TASKS_AT_RISK ||
      (s.openTasks > 0 && s.overdueTasks / s.openTasks >= OVERDUE_SHARE_AT_RISK))
  )
    reasons.push({ code: 'tasks_overdue', value: s.overdueTasks });

  const state: ReportState = reasons.some((r) => DELAYING.includes(r.code))
    ? 'delayed'
    : reasons.length
      ? 'at_risk'
      : input.reported
        ? 'on_track'
        : 'no_update';
  const severity = state === 'delayed' ? 2 : state === 'at_risk' ? 1 : 0;
  const mismatch = input.reported !== null && HEALTH_SEVERITY[input.reported] < severity;
  return { state, reasons, mismatch };
}

/**
 * The status the updates report for a project: the latest update by one of its managers, else the most severe of
 * the others (null without updates).
 */
export function reportedStatus(
  updates: readonly { status: ReportedStatus; byManager: boolean; submittedAt: Date }[],
): ReportedStatus | null {
  const managers = updates.filter((u) => u.byManager);
  if (managers.length) return managers.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a)).status;
  if (!updates.length) return null;
  return updates.reduce((a, b) => (HEALTH_SEVERITY[b.status] > HEALTH_SEVERITY[a.status] ? b : a)).status;
}

/** The expected finish the updates give: the managers' latest, else anyone's latest. */
export function forecastOf(
  updates: readonly { forecastDate: string | null; byManager: boolean; submittedAt: Date }[],
): string | null {
  const dated = updates.filter((u) => u.forecastDate);
  const pick = (list: typeof dated) =>
    list.length ? list.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a)).forecastDate : null;
  return pick(dated.filter((u) => u.byManager)) ?? pick(dated);
}

/** The status an update would suggest from the plan alone (the builtin draft's guess). */
export function suggestedStatus(
  signals: ProjectSignals,
  forecastDate: string | null,
  today: string,
): ReportedStatus {
  const { state } = projectState({ reported: null, forecastDate, signals, completed: false, today });
  return state === 'delayed' ? 'off_track' : state === 'at_risk' ? 'at_risk' : 'on_track';
}

/* ───────────────────────────── report templates ───────────────────────────── */

export const REPORT_SECTION_TYPES = [
  'summary',
  'counts',
  'projects',
  'blockers',
  'asks',
  'milestones',
  'missing',
  'decisions',
] as const;
export type ReportSectionType = (typeof REPORT_SECTION_TYPES)[number];

/** How a `projects` section shows each project: a table row, one line, or the whole (merged) update. */
export const PROJECT_DETAILS = ['table', 'brief', 'full'] as const;
export type ProjectDetailLevel = (typeof PROJECT_DETAILS)[number];

/** Section types whose text comes from the narrative (AI or builtin). */
export const NARRATIVE_SECTIONS: readonly ReportSectionType[] = ['summary', 'blockers', 'asks'];

export const MAX_REPORT_SECTIONS = 20;
export const REPORT_TEMPLATE_KEY_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** The built-in templates created on first use (names and descriptions come from the catalogs). */
export const DEFAULT_REPORT_TEMPLATES = [
  {
    key: 'executive',
    sections: [
      { id: 'summary', type: 'summary' },
      { id: 'counts', type: 'counts' },
      { id: 'attention', type: 'projects', states: ['delayed', 'at_risk'], detail: 'brief' },
      { id: 'asks', type: 'asks' },
      { id: 'milestones', type: 'milestones', days: 14 },
    ],
  },
  {
    key: 'detailed',
    sections: [
      { id: 'counts', type: 'counts' },
      { id: 'delayed', type: 'projects', states: ['delayed'], detail: 'full' },
      { id: 'at-risk', type: 'projects', states: ['at_risk'], detail: 'full' },
      { id: 'on-track', type: 'projects', states: ['on_track', 'completed'], detail: 'brief' },
      { id: 'no-update', type: 'projects', states: ['no_update'], detail: 'table' },
      { id: 'blockers', type: 'blockers' },
      { id: 'decisions', type: 'decisions' },
      { id: 'missing', type: 'missing' },
      { id: 'milestones', type: 'milestones', days: 30 },
    ],
  },
] as const;

/** Whether a template needs narrative text: a summary, merged blockers or asks, or a brief or full project list. */
export function needsNarrative(
  sections: readonly { type: ReportSectionType; detail?: ProjectDetailLevel }[],
): boolean {
  return sections.some(
    (s) => NARRATIVE_SECTIONS.includes(s.type) || (s.type === 'projects' && s.detail !== 'table'),
  );
}
