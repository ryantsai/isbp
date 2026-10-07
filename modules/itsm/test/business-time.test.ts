import { describe, expect, it } from 'vitest';
import type { WorkingHours } from '../src/contracts';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  type CalendarSpec,
  isValidTimeZone,
  type SlaClock,
  slaDueAt,
  slaElapsedRatio,
  slaResume,
  slaWarnAt,
  zoneOffset,
} from '../src/server/business-time';

const weekdays = (start: string, end: string): WorkingHours => ({
  days: [[], [{ start, end }], [{ start, end }], [{ start, end }], [{ start, end }], [{ start, end }], []],
});

/** Taipei office hours: Mon–Fri 09:00–18:00, UTC+8 all year (no DST). */
const taipei: CalendarSpec = {
  timezone: 'Asia/Taipei',
  hours: weekdays('09:00', '18:00'),
  holidays: [{ date: '2026-10-09' }, '2026-10-26'],
};
/** `2026-10-05T10:00` local Taipei time → instant. */
const tpe = (local: string) => new Date(`${local}:00+08:00`);

describe('business time — Taipei office hours', () => {
  it('Taipei has no DST: +08:00 in winter and summer', () => {
    expect(zoneOffset(Date.parse('2026-01-15T00:00:00Z'), 'Asia/Taipei')).toBe(8 * 3_600_000);
    expect(zoneOffset(Date.parse('2026-07-15T00:00:00Z'), 'Asia/Taipei')).toBe(8 * 3_600_000);
  });

  it('adds minutes within the same working day', () => {
    expect(addBusinessMinutes(tpe('2026-10-05T10:00'), 60, taipei)).toEqual(tpe('2026-10-05T11:00'));
  });

  it('starts counting at opening time when raised before hours', () => {
    expect(addBusinessMinutes(tpe('2026-10-05T07:15'), 30, taipei)).toEqual(tpe('2026-10-05T09:30'));
  });

  it('carries over the night', () => {
    expect(addBusinessMinutes(tpe('2026-10-06T17:30'), 60, taipei)).toEqual(tpe('2026-10-07T09:30'));
  });

  it('skips the weekend', () => {
    expect(addBusinessMinutes(tpe('2026-10-02T17:30'), 60, taipei)).toEqual(tpe('2026-10-05T09:30'));
    expect(addBusinessMinutes(tpe('2026-10-03T11:00'), 45, taipei)).toEqual(tpe('2026-10-05T09:45'));
  });

  it('skips holidays (National Day observed on Friday 9 October)', () => {
    expect(addBusinessMinutes(tpe('2026-10-08T17:00'), 120, taipei)).toEqual(tpe('2026-10-12T10:00'));
  });

  it('ends exactly at closing time when the target fills the day', () => {
    // Three business days of nine hours = 1620 minutes.
    expect(addBusinessMinutes(tpe('2026-10-05T09:00'), 1620, taipei)).toEqual(tpe('2026-10-07T18:00'));
  });

  it('measures business minutes between two instants', () => {
    expect(businessMinutesBetween(tpe('2026-10-02T17:00'), tpe('2026-10-05T10:00'), taipei)).toBe(120);
    expect(businessMinutesBetween(tpe('2026-10-05T12:00'), tpe('2026-10-05T12:30'), taipei)).toBe(30);
    expect(businessMinutesBetween(tpe('2026-10-08T17:00'), tpe('2026-10-12T10:00'), taipei)).toBe(120);
    expect(businessMinutesBetween(tpe('2026-10-05T12:00'), tpe('2026-10-05T11:00'), taipei)).toBe(0);
  });

  it('add and between are inverse operations', () => {
    const start = tpe('2026-10-01T16:42');
    for (const minutes of [1, 59, 540, 777, 2400, 5000]) {
      const due = addBusinessMinutes(start, minutes, taipei);
      expect(businessMinutesBetween(start, due, taipei)).toBe(minutes);
    }
  });
});

describe('business time — other calendars', () => {
  it('handles DST transitions in the calendar zone (New York, March 2026)', () => {
    const ny: CalendarSpec = { timezone: 'America/New_York', hours: weekdays('09:00', '17:00') };
    // Fri 6 March 16:00 EST (UTC−5) + 2h → Mon 9 March 10:00 EDT (UTC−4), across the spring-forward night.
    const due = addBusinessMinutes(new Date('2026-03-06T21:00:00Z'), 120, ny);
    expect(due.toISOString()).toBe('2026-03-09T14:00:00.000Z');
    expect(businessMinutesBetween(new Date('2026-03-06T21:00:00Z'), due, ny)).toBe(120);
  });

  it('supports overnight working intervals', () => {
    const nights: CalendarSpec = {
      timezone: 'Asia/Taipei',
      hours: { days: [[], [{ start: '22:00', end: '06:00' }], [], [], [], [], []] },
    };
    expect(addBusinessMinutes(tpe('2026-10-05T23:00'), 120, nights)).toEqual(tpe('2026-10-06T01:00'));
    expect(businessMinutesBetween(tpe('2026-10-05T21:00'), tpe('2026-10-06T07:00'), nights)).toBe(480);
    // Starting inside yesterday's overnight interval counts the rest of it.
    expect(addBusinessMinutes(tpe('2026-10-06T05:00'), 30, nights)).toEqual(tpe('2026-10-06T05:30'));
  });

  it('24×7 calendars use wall-clock time', () => {
    const always: CalendarSpec = {
      timezone: 'UTC',
      hours: { days: [[], [], [], [], [], [], []] },
      alwaysOpen: true,
    };
    const start = new Date('2026-10-03T23:30:00Z');
    expect(addBusinessMinutes(start, 240, always).toISOString()).toBe('2026-10-04T03:30:00.000Z');
    expect(businessMinutesBetween(start, new Date('2026-10-04T00:15:00Z'), always)).toBe(45);
  });

  it('falls back to wall-clock time when a calendar has no working hours', () => {
    const empty: CalendarSpec = { timezone: 'UTC', hours: { days: [[], [], [], [], [], [], []] } };
    expect(addBusinessMinutes(new Date('2026-10-05T00:00:00Z'), 30, empty).toISOString()).toBe(
      '2026-10-05T00:30:00.000Z',
    );
  });

  it('validates time zones', () => {
    expect(isValidTimeZone('Asia/Taipei')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('SLA clocks', () => {
  const clock: SlaClock = {
    startedAt: tpe('2026-10-05T09:00'),
    targetMinutes: 240,
    pausedMs: 0,
    pausedAt: null,
    stoppedAt: null,
  };

  it('computes the deadline and the warning threshold in business time', () => {
    expect(slaDueAt(clock, taipei)).toEqual(tpe('2026-10-05T13:00'));
    expect(slaWarnAt(clock, 0.75, taipei)).toEqual(tpe('2026-10-05T12:00'));
    expect(slaElapsedRatio(clock, taipei, tpe('2026-10-05T11:00'))).toBe(0.5);
  });

  it('pausing stops the clock and resuming extends the deadline by the paused business time', () => {
    const paused: SlaClock = { ...clock, pausedAt: tpe('2026-10-05T10:00') };
    // While paused, elapsed time stays at one hour.
    expect(slaElapsedRatio(paused, taipei, tpe('2026-10-05T17:00'))).toBe(0.25);
    const resumed = slaResume(paused, taipei, tpe('2026-10-05T15:00'));
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.pausedMs).toBe(5 * 3_600_000);
    expect(slaDueAt(resumed, taipei)).toEqual(tpe('2026-10-05T18:00'));
    expect(slaElapsedRatio(resumed, taipei, tpe('2026-10-05T16:00'))).toBe(0.5);
  });

  it('a pause over the night only counts business hours', () => {
    const paused: SlaClock = { ...clock, pausedAt: tpe('2026-10-05T17:00') };
    const resumed = slaResume(paused, taipei, tpe('2026-10-06T10:00'));
    expect(resumed.pausedMs).toBe(2 * 3_600_000);
  });

  it('reports ratios above 1 once the target has passed', () => {
    expect(slaElapsedRatio(clock, taipei, tpe('2026-10-05T17:00'))).toBe(2);
    expect(
      slaElapsedRatio({ ...clock, stoppedAt: tpe('2026-10-05T10:00') }, taipei, tpe('2026-10-06T17:00')),
    ).toBe(0.25);
  });
});
