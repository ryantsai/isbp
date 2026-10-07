import { describe, expect, it } from 'vitest';
import { endPhase, renewalTimeline, stackSegments, usage } from '../src/web/logic';

describe('renewal timeline', () => {
  it('places the notice date and today on the term', () => {
    const tl = renewalTimeline({
      startDate: '2026-01-01',
      noticeDate: '2026-11-01',
      endDate: '2026-12-31',
      today: '2026-07-02',
    })!;
    expect(tl.from).toBe('2026-01-01');
    expect(tl.notice).toBeCloseTo(83.5, 0);
    expect(tl.today).toBeCloseTo(49.7, 0);
    expect(tl.phase).toBe('running');
    expect(tl.todayOutside).toBeNull();
  });

  it('knows the notice period, the end and contracts without a start', () => {
    expect(
      renewalTimeline({
        startDate: '2026-01-01',
        noticeDate: '2026-11-01',
        endDate: '2026-12-31',
        today: '2026-11-15',
      })!.phase,
    ).toBe('notice');
    const ended = renewalTimeline({
      startDate: '2026-01-01',
      noticeDate: '2026-11-01',
      endDate: '2026-12-31',
      today: '2027-01-15',
    })!;
    expect(ended).toMatchObject({ phase: 'ended', today: 100, todayOutside: 'after' });
    const noStart = renewalTimeline({
      startDate: null,
      noticeDate: '2026-11-01',
      endDate: '2026-12-31',
      today: '2026-11-15',
    })!;
    expect(noStart.from).toBe('2026-10-02');
    expect(
      renewalTimeline({ startDate: '2026-01-01', noticeDate: null, endDate: null, today: '2026-11-15' }),
    ).toBeNull();
    expect(
      renewalTimeline({
        startDate: '2027-01-01',
        noticeDate: '2027-11-01',
        endDate: '2027-12-31',
        today: '2026-11-15',
      })!,
    ).toMatchObject({ phase: 'upcoming', today: 0, todayOutside: 'before' });
  });
});

describe('usage meter', () => {
  it('colours over, full, low and unlimited usage', () => {
    expect(usage(46, 40)).toEqual({ percent: 100, tone: 'over' });
    expect(usage(40, 40)).toEqual({ percent: 100, tone: 'full' });
    expect(usage(6, 20)).toEqual({ percent: 30, tone: 'low' });
    expect(usage(3, 5)).toEqual({ percent: 60, tone: 'ok' });
    expect(usage(12, null)).toEqual({ percent: 100, tone: 'unlimited' });
    expect(usage(0, 0)).toEqual({ percent: 0, tone: 'ok' });
  });
});

describe('contract list helpers', () => {
  it('bucket the days to the end', () => {
    expect(endPhase(null)).toBe('none');
    expect(endPhase(-3)).toBe('ended');
    expect(endPhase(0)).toBe('today');
    expect(endPhase(23)).toBe('soon');
    expect(endPhase(200)).toBe('later');
  });

  it('stacks segments in order, skipping empty ones', () => {
    const segs = stackSegments({ deployed: 6, in_stock: 2, lost: 0 }, [
      'deployed',
      'in_stock',
      'lost',
    ] as const);
    expect(segs).toEqual([
      { key: 'deployed', value: 6, start: 0, percent: 75 },
      { key: 'in_stock', value: 2, start: 75, percent: 25 },
    ]);
  });
});
