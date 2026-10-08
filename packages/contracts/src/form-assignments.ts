import { listQuerySchema, localizedTextSchema, renderTemplate } from '@isbp/sdk';
import { z } from 'zod';
import { dateTime, id } from './common';
import { personRefSchema } from './workflows';

/*
 * Assigned and recurring forms (Phase 8, §15.8a): "a form someone must fill in by a date" — a monthly server room
 * inspection, a quarterly firewall rule review — opened by hand or by the `core.assign-form` scheduled job.
 */

/* ───────────── periods (pure, shared by the API, the job and the browser) ───────────── */

export const ASSIGNMENT_PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type AssignmentPeriod = (typeof ASSIGNMENT_PERIODS)[number];

/** A calendar date (month 1–12). */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const zoneCheck = new Map<string, boolean>();

/** An IANA time zone this runtime knows (`UTC` included). */
export function isTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  let ok = zoneCheck.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    zoneCheck.set(tz, ok);
  }
  return ok;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock at `at` in `timeZone` (unknown zones fall back to UTC). */
function wallClock(at: Date, timeZone: string) {
  const tz = isTimeZone(timeZone) ? timeZone : 'UTC';
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** The calendar date at `at` in `timeZone`. */
export function localDateOf(at: Date, timeZone: string): LocalDate {
  const { year, month, day } = wallClock(at, timeZone);
  return { year, month, day };
}

/** The date `days` days after `date` (negative: before). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The instant a wall-clock time in `timeZone` denotes (DST-safe: a time skipped by a spring-forward gap resolves to
 * the same wall time after the shift).
 */
export function zonedInstant(
  local: LocalDate & { hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const wall = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  );
  const offset = (instant: number) => {
    const whole = instant - (((instant % 1000) + 1000) % 1000);
    const w = wallClock(new Date(whole), timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole;
  };
  let t = wall - offset(wall);
  t = wall - offset(t);
  return new Date(t);
}

/** The last second of a calendar day in `timeZone` (23:59:59). */
export function endOfLocalDay(date: LocalDate, timeZone: string): Date {
  return zonedInstant({ ...date, hour: 23, minute: 59, second: 59 }, timeZone);
}

/** `YYYY-MM-DD` → a date, or null. */
export function parseLocalDate(value: string): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = addDays(date, 0);
  return check.year === date.year && check.month === date.month && check.day === date.day ? date : null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `YYYY-MM-DD`. */
export function formatLocalDate(date: LocalDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** ISO 8601 week (weeks start on Monday; week 1 holds the year's first Thursday) and the year it belongs to. */
export function isoWeek(date: LocalDate): { year: number; week: number } {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

/** The key of the period a date falls in: `2026-10-08`, `2026-W41`, `2026-10`, `2026-Q4`, `2026`. */
export function periodKeyOfDate(date: LocalDate, period: AssignmentPeriod): string {
  switch (period) {
    case 'day':
      return formatLocalDate(date);
    case 'week': {
      const w = isoWeek(date);
      return `${pad(w.year, 4)}-W${pad(w.week)}`;
    }
    case 'month':
      return `${pad(date.year, 4)}-${pad(date.month)}`;
    case 'quarter':
      return `${pad(date.year, 4)}-Q${Math.floor((date.month - 1) / 3) + 1}`;
    case 'year':
      return pad(date.year, 4);
  }
}

/** The key of the period `at` falls in, in `timeZone` (a run at 00:30 on 1 Nov in Taipei belongs to `2026-11`). */
export function periodKey(at: Date, period: AssignmentPeriod, timeZone = 'UTC'): string {
  return periodKeyOfDate(localDateOf(at, timeZone), period);
}

/** The last day of the period a date falls in. */
export function lastDayOfPeriod(date: LocalDate, period: AssignmentPeriod): LocalDate {
  switch (period) {
    case 'day':
      return date;
    case 'week': {
      const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() || 7;
      return addDays(date, 7 - weekday);
    }
    case 'month':
      return addDays({ year: date.year, month: date.month + 1, day: 1 }, -1);
    case 'quarter': {
      const firstOfNext = Math.floor((date.month - 1) / 3) * 3 + 4;
      return addDays({ year: date.year, month: firstOfNext, day: 1 }, -1);
    }
    case 'year':
      return { year: date.year, month: 12, day: 31 };
  }
}

export const assignmentDueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('end-of-period') }),
  z.object({
    type: z.literal('days'),
    days: z.number().int().min(0).max(366).describe('Days after the run date; due at the end of that day'),
  }),
]);
export type AssignmentDue = z.infer<typeof assignmentDueSchema>;

/**
 * When an assignment opened at `at` is due, in `timeZone`: the end (23:59:59) of the period's last day, or of the
 * day `days` days after the run date.
 */
export function assignmentDueAt(
  at: Date,
  period: AssignmentPeriod,
  due: AssignmentDue,
  timeZone = 'UTC',
): Date {
  const today = localDateOf(at, timeZone);
  const day = due.type === 'days' ? addDays(today, due.days) : lastDayOfPeriod(today, period);
  return endOfLocalDay(day, timeZone);
}

/** An assignment title from its template: `{{period}}` becomes the period key (nothing else is evaluated). */
export function assignmentTitle(template: string, periodKey: string | null): string {
  return renderTemplate(template, { period: periodKey ?? '' })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/* ───────────── API shapes ───────────── */

export const formAssignmentStatusSchema = z.enum(['open', 'done', 'cancelled']);
export type FormAssignmentStatus = z.infer<typeof formAssignmentStatusSchema>;

/**
 * What lists show: `open` (not yet due), `overdue` (open past its due date), `done` (on time), `late` (done after
 * the due date) and `cancelled`.
 */
export const FORM_ASSIGNMENT_STATES = ['open', 'overdue', 'done', 'late', 'cancelled'] as const;
export const formAssignmentStateSchema = z.enum(FORM_ASSIGNMENT_STATES);
export type FormAssignmentState = z.infer<typeof formAssignmentStateSchema>;

/** Who must fill it in: a person (any member of a group may do a group's). */
export const assigneeInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), userId: id.describe('User id of the person') }),
  z.object({
    type: z.literal('group'),
    groupKey: z.string().trim().min(1).max(100).describe('Key of the group; any member may fill it in'),
  }),
]);
export type AssigneeInput = z.input<typeof assigneeInputSchema>;

export const formAssignmentSchema = z.object({
  id,
  form: z.object({ id, key: z.string(), name: localizedTextSchema, icon: z.string() }),
  title: z.string(),
  /** The period it covers (`2026-10`), or null. */
  periodKey: z.string().nullable(),
  dueAt: dateTime,
  status: formAssignmentStatusSchema,
  state: formAssignmentStateSchema,
  /** Null when the person or group was deleted. */
  assignee: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('user'), user: personRefSchema }),
      z.object({ type: z.literal('group'), group: z.object({ id, key: z.string(), name: z.string() }) }),
    ])
    .nullable(),
  note: z.string().nullable(),
  /** `job` (a scheduled job, `id` = the job) or `manual`. */
  source: z.object({ type: z.string(), id: z.string().nullable() }),
  /** The request that completed it. */
  submission: z.object({ id, reference: z.string(), submittedBy: personRefSchema.nullable() }).nullable(),
  createdBy: personRefSchema.nullable(),
  createdAt: dateTime,
  completedAt: dateTime.nullable(),
  /** Where the assignee fills it in (`/requests/forms/<key>?assignment=<id>`). */
  href: z.string(),
});
export type FormAssignment = z.input<typeof formAssignmentSchema>;

export const createFormAssignmentSchema = z.object({
  assignee: assigneeInputSchema,
  /** Defaults to the form's name in your language (with the period key when there is one). */
  title: z.string().trim().min(1).max(300).optional(),
  dueAt: dateTime,
  periodKey: z.string().trim().min(1).max(32).nullish(),
  note: z.string().trim().max(2000).nullish(),
});
export type CreateFormAssignmentInput = z.input<typeof createFormAssignmentSchema>;

export const cancelFormAssignmentSchema = z.object({ reason: z.string().trim().max(500).nullish() });

export const formAssignmentQuerySchema = listQuerySchema.extend({
  state: formAssignmentStateSchema.optional(),
  period: z.string().trim().max(32).optional(),
});

export const myFormAssignmentQuerySchema = listQuerySchema.extend({
  /** `open` (default; overdue first, then by due date), `closed` (done or cancelled) or `all`. */
  status: z.enum(['open', 'closed', 'all']).default('open'),
});

/** Per period of a form: how its assignments went. */
export const formAssignmentComplianceSchema = z.object({
  periods: z.array(
    z.object({
      periodKey: z.string().nullable(),
      dueAt: dateTime,
      total: z.number().int(),
      onTime: z.number().int(),
      late: z.number().int(),
      overdue: z.number().int(),
      open: z.number().int(),
      cancelled: z.number().int(),
    }),
  ),
});
export type FormAssignmentCompliance = z.input<typeof formAssignmentComplianceSchema>;

/** Choices for the assign dialog and the `core.assign-form` job editor (form administrators). */
export const formAssignmentOptionsSchema = z.object({
  forms: z.array(
    z.object({ id, key: z.string(), name: localizedTextSchema, icon: z.string(), published: z.boolean() }),
  ),
  groups: z.array(z.object({ id, key: z.string(), name: z.string() })),
});
export type FormAssignmentOptions = z.input<typeof formAssignmentOptionsSchema>;

/** Configuration of the `core.assign-form` task type (Scheduled Jobs): one assignment per period. */
export const assignFormTaskConfigSchema = z.object({
  formKey: z.string().trim().min(1).max(100).describe('Key of a published form, e.g. server-room-inspection'),
  assignee: assigneeInputSchema,
  period: z
    .enum(ASSIGNMENT_PERIODS)
    .default('month')
    .describe('Each run opens the assignment of the period it falls in (in the job’s time zone)'),
  due: assignmentDueSchema.default({ type: 'end-of-period' }),
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      'Title of each assignment; {{period}} becomes the period key, e.g. "Server room inspection {{period}}"',
    ),
  note: z.string().trim().max(2000).nullish().describe('Shown to the assignee with the form'),
});
export type AssignFormTaskConfig = z.input<typeof assignFormTaskConfigSchema>;
