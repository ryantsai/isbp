import { describe, expect, it } from 'vitest';
import {
  addDays,
  assignFormTaskConfigSchema,
  assignmentDueAt,
  assignmentTitle,
  createFormAssignmentSchema,
  endOfLocalDay,
  isoWeek,
  isTimeZone,
  lastDayOfPeriod,
  localDateOf,
  parseLocalDate,
  periodKey,
  zonedInstant,
} from '../src/index';

const at = (iso: string) => new Date(iso);

describe('period keys', () => {
  it('names every kind of period', () => {
    const d = at('2026-10-08T03:00:00Z');
    expect(periodKey(d, 'day')).toBe('2026-10-08');
    expect(periodKey(d, 'week')).toBe('2026-W41');
    expect(periodKey(d, 'month')).toBe('2026-10');
    expect(periodKey(d, 'quarter')).toBe('2026-Q4');
    expect(periodKey(d, 'year')).toBe('2026');
  });

  it('uses the time zone of the job, not UTC', () => {
    // 00:30 on 1 November in Taipei is still 31 October in UTC.
    const d = at('2026-10-31T16:30:00Z');
    expect(periodKey(d, 'month', 'UTC')).toBe('2026-10');
    expect(periodKey(d, 'month', 'Asia/Taipei')).toBe('2026-11');
    expect(periodKey(d, 'day', 'Asia/Taipei')).toBe('2026-11-01');
    // 20:00 on 31 December in New York is already the next year in UTC.
    const nye = at('2027-01-01T01:00:00Z');
    expect(periodKey(nye, 'year', 'America/New_York')).toBe('2026');
    expect(periodKey(nye, 'quarter', 'America/New_York')).toBe('2026-Q4');
    expect(periodKey(nye, 'quarter', 'Asia/Tokyo')).toBe('2027-Q1');
  });

  it('numbers weeks the ISO way across year ends', () => {
    expect(isoWeek({ year: 2026, month: 1, day: 1 })).toEqual({ year: 2026, week: 1 }); // a Thursday
    expect(isoWeek({ year: 2027, month: 1, day: 1 })).toEqual({ year: 2026, week: 53 }); // a Friday
    expect(isoWeek({ year: 2024, month: 12, day: 30 })).toEqual({ year: 2025, week: 1 }); // a Monday
    expect(periodKey(at('2027-01-02T12:00:00Z'), 'week')).toBe('2026-W53');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('Asia/Taipei')).toBe(true);
    expect(periodKey(at('2026-10-31T16:30:00Z'), 'month', 'Mars/Olympus_Mons')).toBe('2026-10');
  });
});

describe('local dates and instants', () => {
  it('finds the last day of each period', () => {
    const d = { year: 2026, month: 2, day: 11 }; // a Wednesday
    expect(lastDayOfPeriod(d, 'day')).toEqual(d);
    expect(lastDayOfPeriod(d, 'week')).toEqual({ year: 2026, month: 2, day: 15 });
    expect(lastDayOfPeriod(d, 'month')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(lastDayOfPeriod({ year: 2028, month: 2, day: 1 }, 'month')).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(lastDayOfPeriod(d, 'quarter')).toEqual({ year: 2026, month: 3, day: 31 });
    expect(lastDayOfPeriod({ year: 2026, month: 11, day: 5 }, 'quarter')).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
    expect(lastDayOfPeriod({ year: 2026, month: 12, day: 7 }, 'month')).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
    expect(lastDayOfPeriod(d, 'year')).toEqual({ year: 2026, month: 12, day: 31 });
    // A Sunday ends its own week.
    expect(lastDayOfPeriod({ year: 2026, month: 2, day: 15 }, 'week')).toEqual({
      year: 2026,
      month: 2,
      day: 15,
    });
  });

  it('converts wall clocks to instants, across daylight saving time', () => {
    expect(endOfLocalDay({ year: 2026, month: 10, day: 31 }, 'Asia/Taipei').toISOString()).toBe(
      '2026-10-31T15:59:59.000Z',
    );
    // Berlin switches to summer time on 29 March 2026.
    expect(endOfLocalDay({ year: 2026, month: 3, day: 28 }, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-28T22:59:59.000Z',
    );
    expect(endOfLocalDay({ year: 2026, month: 3, day: 31 }, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-31T21:59:59.000Z',
    );
    expect(zonedInstant({ year: 2026, month: 11, day: 1, hour: 9 }, 'America/New_York').toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
    expect(localDateOf(at('2026-03-29T00:30:00Z'), 'Europe/Berlin')).toEqual({
      year: 2026,
      month: 3,
      day: 29,
    });
  });

  it('parses dates and adds days', () => {
    expect(parseLocalDate('2026-10-31')).toEqual({ year: 2026, month: 10, day: 31 });
    expect(parseLocalDate('2026-02-30')).toBeNull();
    expect(parseLocalDate('31/10/2026')).toBeNull();
    expect(addDays({ year: 2026, month: 12, day: 30 }, 3)).toEqual({ year: 2027, month: 1, day: 2 });
  });
});

describe('due dates', () => {
  // "1st of every month 09:00 Asia/Taipei" — the run's slot.
  const run = at('2026-10-01T01:00:00Z');

  it('is due at the end of the period', () => {
    expect(assignmentDueAt(run, 'month', { type: 'end-of-period' }, 'Asia/Taipei').toISOString()).toBe(
      '2026-10-31T15:59:59.000Z',
    );
    expect(assignmentDueAt(run, 'quarter', { type: 'end-of-period' }, 'Asia/Taipei').toISOString()).toBe(
      '2026-12-31T15:59:59.000Z',
    );
    expect(assignmentDueAt(run, 'year', { type: 'end-of-period' }, 'UTC').toISOString()).toBe(
      '2026-12-31T23:59:59.000Z',
    );
  });

  it('or at the end of the day N days after the run', () => {
    expect(assignmentDueAt(run, 'month', { type: 'days', days: 7 }, 'Asia/Taipei').toISOString()).toBe(
      '2026-10-08T15:59:59.000Z',
    );
    expect(assignmentDueAt(run, 'month', { type: 'days', days: 0 }, 'Asia/Taipei').toISOString()).toBe(
      '2026-10-01T15:59:59.000Z',
    );
  });
});

describe('titles and schemas', () => {
  it('renders {{period}} and nothing else', () => {
    expect(assignmentTitle('Server room inspection {{period}}', '2026-10')).toBe(
      'Server room inspection 2026-10',
    );
    expect(assignmentTitle('Review {{ period }} {{constructor}} {{data.x}}', '2026-Q4')).toBe(
      'Review 2026-Q4',
    );
    expect(assignmentTitle('Backup check {{period}}', null)).toBe('Backup check');
  });

  it('fills the task configuration defaults', () => {
    const c = assignFormTaskConfigSchema.parse({
      formKey: 'server-room-inspection',
      assignee: { type: 'group', groupKey: 'it-ops' },
      title: 'Server room inspection {{period}}',
    });
    expect(c).toMatchObject({ period: 'month', due: { type: 'end-of-period' } });
    expect(assignFormTaskConfigSchema.safeParse({ ...c, due: { type: 'days', days: -1 } }).success).toBe(
      false,
    );
    expect(
      assignFormTaskConfigSchema.safeParse({ ...c, assignee: { type: 'user', userId: 'nope' } }).success,
    ).toBe(false);
  });

  it('takes a due date as an instant', () => {
    const v = createFormAssignmentSchema.parse({
      assignee: { type: 'user', userId: '01a10fa3-5141-77f6-9b0a-10258b3a22fb' },
      dueAt: '2026-10-31T15:59:59.000Z',
    });
    expect(v.dueAt).toBeInstanceOf(Date);
  });
});
