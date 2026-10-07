import { describe, expect, it } from 'vitest';
import {
  cronError,
  firstRun,
  isValidTimezone,
  nextCron,
  nextRuns,
  planDue,
  runsBetween,
  slotAfter,
} from '../src/schedule';

const iso = (d: Date | null) => d?.toISOString() ?? null;
const HOUR = 3_600_000;

describe('cron next runs', () => {
  it('evaluates in the job time zone', () => {
    // 07:00 in Taipei (UTC+8) is 23:00 UTC the day before.
    const from = new Date('2026-10-07T00:00:00Z');
    expect(nextRuns({ kind: 'cron', cron: '0 7 * * *', timezone: 'Asia/Taipei' }, from, 2).map(iso)).toEqual([
      '2026-10-07T23:00:00.000Z',
      '2026-10-08T23:00:00.000Z',
    ]);
    // Sunday 03:00 in Taipei.
    expect(iso(nextCron('0 3 * * 0', 'Asia/Taipei', from))).toBe('2026-10-10T19:00:00.000Z');
    expect(iso(nextCron('*/15 * * * *', 'UTC', from))).toBe('2026-10-07T00:15:00.000Z');
  });

  it('handles the spring-forward gap (02:30 does not exist: runs at 03:30 EDT)', () => {
    const runs = nextRuns(
      { kind: 'cron', cron: '30 2 * * *', timezone: 'America/New_York' },
      new Date('2026-03-07T12:00:00Z'),
      3,
    ).map(iso);
    expect(runs).toEqual([
      '2026-03-08T07:30:00.000Z',
      '2026-03-09T06:30:00.000Z',
      '2026-03-10T06:30:00.000Z',
    ]);
  });

  it('runs once in the repeated hour when clocks fall back', () => {
    const runs = nextRuns(
      { kind: 'cron', cron: '30 1 * * *', timezone: 'America/New_York' },
      new Date('2026-10-31T12:00:00Z'),
      2,
    ).map(iso);
    expect(runs).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
  });

  it('validates expressions and time zones', () => {
    expect(cronError('0 7 * * *', 'Asia/Taipei')).toBeNull();
    expect(cronError('')).toMatch(/Enter/);
    expect(cronError('* * * * * *')).toMatch(/five fields/);
    expect(cronError('61 * * * *')).toMatch(/range/);
    expect(cronError('0 7 * * *', 'Mars/Olympus')).toMatch(/time zone/);
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });
});

describe('intervals', () => {
  it('counts from the previous slot', () => {
    const spec = { kind: 'interval' as const, intervalMinutes: 15 };
    const now = new Date('2026-10-07T10:00:00Z');
    expect(iso(firstRun(spec, now))).toBe('2026-10-07T10:15:00.000Z');
    expect(iso(slotAfter(spec, new Date('2026-10-07T10:15:00Z')))).toBe('2026-10-07T10:30:00.000Z');
    expect(
      runsBetween(spec, new Date('2026-10-07T10:15:00Z'), new Date('2026-10-07T11:00:00Z'), 10),
    ).toHaveLength(4);
  });

  it('manual and after triggers have no clock', () => {
    expect(firstRun({ kind: 'manual' }, new Date())).toBeNull();
    expect(nextRuns({ kind: 'after' }, new Date(), 5)).toEqual([]);
  });
});

describe('misfires', () => {
  const grace = 60 * 60_000;

  it('runs a future slot inside the lookahead on time', () => {
    const now = new Date('2026-10-07T09:59:45Z');
    const plan = planDue(
      { kind: 'cron', cron: '0 * * * *', timezone: 'UTC' },
      new Date('2026-10-07T10:00:00Z'),
      now,
      grace,
    );
    expect(iso(plan.run)).toBe('2026-10-07T10:00:00.000Z');
    expect(iso(plan.next)).toBe('2026-10-07T11:00:00.000Z');
    expect(plan.missed).toBeNull();
  });

  it('runs a late slot once when it is within the grace period', () => {
    // Down from 08:50 to 10:20: the 09:00 and 10:00 slots passed; 10:00 runs, 09:00 is counted.
    const now = new Date('2026-10-07T10:20:00Z');
    const plan = planDue(
      { kind: 'cron', cron: '0 * * * *', timezone: 'UTC' },
      new Date('2026-10-07T09:00:00Z'),
      now,
      grace,
    );
    expect(iso(plan.run)).toBe('2026-10-07T10:00:00.000Z');
    expect(plan.missedCount).toBe(1);
    expect(iso(plan.next)).toBe('2026-10-07T11:00:00.000Z');
  });

  it('logs slots older than the grace as missed and moves on', () => {
    const now = new Date('2026-10-08T09:30:00Z');
    const plan = planDue(
      { kind: 'cron', cron: '0 7 * * *', timezone: 'UTC' },
      new Date('2026-10-06T07:00:00Z'),
      now,
      grace,
    );
    expect(plan.run).toBeNull();
    expect(iso(plan.missed)).toBe('2026-10-08T07:00:00.000Z');
    expect(plan.missedCount).toBe(3);
    expect(iso(plan.next)).toBe('2026-10-09T07:00:00.000Z');
  });

  it('works out interval misfires arithmetically', () => {
    const spec = { kind: 'interval' as const, intervalMinutes: 30 };
    const slot = new Date('2026-10-07T08:00:00Z');
    const late = planDue(spec, slot, new Date(slot.getTime() + 2 * HOUR + 10 * 60_000), grace);
    expect(iso(late.run)).toBe('2026-10-07T10:00:00.000Z');
    expect(late.missedCount).toBe(4);
    expect(iso(late.next)).toBe('2026-10-07T10:30:00.000Z');
    const missed = planDue(spec, slot, new Date(slot.getTime() + 2 * HOUR + 10 * 60_000), 5 * 60_000);
    expect(missed.run).toBeNull();
    expect(iso(missed.missed)).toBe('2026-10-07T10:00:00.000Z');
  });
});
