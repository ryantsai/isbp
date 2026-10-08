import { describe, expect, it } from 'vitest';
import { instantFrom, plannedWindow } from '../src/server/process-actions';

const at = (iso: string) => new Date(iso).getTime();

describe('the planned window of a change raised from a form', () => {
  it('reads date-only answers as whole days in the requester’s time zone', () => {
    const data = { start: '2026-11-02', end: '2026-11-02', when: '2026-11-02T09:30:00Z' };
    expect(instantFrom(data, 'start', 'Asia/Taipei')).toBe(at('2026-11-01T16:00:00Z'));
    expect(instantFrom(data, 'end', 'Asia/Taipei', true)).toBe(at('2026-11-02T16:00:00Z'));
    expect(instantFrom(data, 'start', 'UTC')).toBe(at('2026-11-02T00:00:00Z'));
    // Datetimes are taken as given; missing or unknown keys give nothing.
    expect(instantFrom(data, 'when', 'Asia/Tokyo', true)).toBe(at('2026-11-02T09:30:00Z'));
    expect(instantFrom(data, 'nope', 'UTC')).toBeNull();
    expect(instantFrom(data, undefined, 'UTC')).toBeNull();
  });

  it('starts a window that already began at the next quarter hour', () => {
    const now = at('2026-11-02T10:07:30Z');
    const today = plannedWindow(at('2026-11-02T00:00:00Z'), at('2026-11-03T00:00:00Z'), now);
    expect(today).toEqual({
      start: at('2026-11-02T10:15:00Z'),
      end: at('2026-11-03T00:00:00Z'),
      passed: false,
    });
    // A future window is kept as it is.
    const later = plannedWindow(at('2026-11-05T00:00:00Z'), at('2026-11-06T00:00:00Z'), now);
    expect(later).toEqual({
      start: at('2026-11-05T00:00:00Z'),
      end: at('2026-11-06T00:00:00Z'),
      passed: false,
    });
  });

  it('marks a window that has ended (or ends before the next quarter hour) as passed', () => {
    const now = at('2026-11-02T10:07:30Z');
    expect(plannedWindow(at('2026-10-30T00:00:00Z'), at('2026-10-31T00:00:00Z'), now).passed).toBe(true);
    expect(plannedWindow(at('2026-11-02T00:00:00Z'), at('2026-11-02T10:10:00Z'), now).passed).toBe(true);
    expect(plannedWindow(null, null, now)).toEqual({ start: null, end: null, passed: false });
  });
});
