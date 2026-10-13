import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPORT_TEMPLATES,
  forecastOf,
  isoWeekKey,
  mondayOfIsoWeek,
  needsNarrative,
  periodFromKey,
  periodOf,
  type ProjectSignals,
  projectState,
  reportedStatus,
  shiftPeriod,
  standingOf,
  suggestedStatus,
} from '../src/model';

describe('ISO weeks', () => {
  it('numbers weeks by their Thursday, across year ends', () => {
    expect(isoWeekKey('2026-10-13')).toBe('2026-W42');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01');
  });

  it('finds the Monday of a week, and refuses weeks a year does not have', () => {
    expect(mondayOfIsoWeek('2026-W42')).toBe('2026-10-12');
    expect(mondayOfIsoWeek('2026-W01')).toBe('2025-12-29');
    expect(mondayOfIsoWeek('2026-W53')).toBe('2026-12-28');
    expect(mondayOfIsoWeek('2025-W53')).toBeNull();
    for (const bad of ['2026-W00', '2026-W54', '2026-42', 'W42', '2026-W4'])
      expect(mondayOfIsoWeek(bad)).toBeNull();
  });
});

describe('reporting periods', () => {
  it('weekly: the ISO week, due on the chosen weekday', () => {
    expect(periodOf('2026-10-13', 'weekly', 5)).toEqual({
      key: '2026-W42',
      cadence: 'weekly',
      start: '2026-10-12',
      end: '2026-10-18',
      due: '2026-10-16',
    });
    expect(periodOf('2026-10-18', 'weekly', 1).due).toBe('2026-10-12');
  });

  it('every two weeks: pairs of weeks counted from 2024-01-01, due in the second week', () => {
    const p = periodOf('2026-10-13', 'biweekly', 5);
    expect(p).toEqual({
      key: '2026-W41',
      cadence: 'biweekly',
      start: '2026-10-05',
      end: '2026-10-18',
      due: '2026-10-16',
    });
    // Every day of the pair belongs to the same period.
    for (const d of ['2026-10-05', '2026-10-09', '2026-10-18'])
      expect(periodOf(d, 'biweekly', 5).key).toBe(p.key);
    expect(periodOf('2026-10-19', 'biweekly', 5).start).toBe('2026-10-19');
    expect(periodOf('2024-01-03', 'biweekly', 3)).toMatchObject({ start: '2024-01-01', due: '2024-01-10' });
    // Before the epoch the pairs keep the same rhythm.
    expect(periodOf('2023-12-28', 'biweekly', 5).start).toBe('2023-12-18');
  });

  it('monthly: the calendar month, due on its last chosen weekday', () => {
    expect(periodOf('2026-10-13', 'monthly', 5)).toEqual({
      key: '2026-10',
      cadence: 'monthly',
      start: '2026-10-01',
      end: '2026-10-31',
      due: '2026-10-30',
    });
    expect(periodOf('2026-02-02', 'monthly', 1)).toMatchObject({ end: '2026-02-28', due: '2026-02-23' });
    expect(periodOf('2028-02-10', 'monthly', 2)).toMatchObject({ end: '2028-02-29', due: '2028-02-29' });
  });

  it('reads keys back, and refuses keys of another cadence', () => {
    for (const cadence of ['weekly', 'biweekly', 'monthly'] as const) {
      const p = periodOf('2026-10-13', cadence, 4);
      expect(periodFromKey(p.key, cadence, 4)).toEqual(p);
    }
    expect(periodFromKey('2026-W42', 'biweekly', 5)).toBeNull(); // second week of a pair
    expect(periodFromKey('2026-10', 'weekly', 5)).toBeNull();
    expect(periodFromKey('2026-13', 'monthly', 5)).toBeNull();
    expect(periodFromKey("2026-W42' or 1=1", 'weekly', 5)).toBeNull();
  });

  it('steps to earlier and later periods', () => {
    const w = periodOf('2026-01-02', 'weekly', 5);
    expect(shiftPeriod(w, -1, 5).key).toBe('2025-W52');
    expect(shiftPeriod(w, 1, 5).key).toBe('2026-W02');
    const b = periodOf('2026-10-13', 'biweekly', 5);
    expect(shiftPeriod(b, 1, 5).start).toBe('2026-10-19');
    expect(shiftPeriod(b, -1, 5).start).toBe('2026-09-21');
    const m = periodOf('2026-01-15', 'monthly', 5);
    expect(shiftPeriod(m, -1, 5).key).toBe('2025-12');
    expect(shiftPeriod(m, 13, 5).key).toBe('2027-02');
  });
});

describe('update standing', () => {
  const dueAt = new Date('2026-10-16T15:59:59Z');
  const closesAt = new Date('2026-10-18T16:00:00Z');
  const pending = { state: 'pending' as const, dueAt, closesAt, submittedAt: null };

  it('tells due, overdue and missed apart for pending updates', () => {
    expect(standingOf(pending, new Date('2026-10-14T00:00:00Z'))).toBe('due');
    expect(standingOf(pending, new Date('2026-10-17T00:00:00Z'))).toBe('overdue');
    expect(standingOf(pending, new Date('2026-10-18T16:00:00Z'))).toBe('missed');
  });

  it('marks updates sent after the due time as late', () => {
    const at = (iso: string) => ({ ...pending, state: 'submitted' as const, submittedAt: new Date(iso) });
    expect(standingOf(at('2026-10-15T09:00:00Z'), new Date())).toBe('submitted');
    expect(standingOf(at('2026-10-17T09:00:00Z'), new Date())).toBe('late');
  });
});

describe('project state', () => {
  const today = '2026-10-13';
  const signals = (s: Partial<ProjectSignals> = {}): ProjectSignals => ({
    targetDate: '2026-12-31',
    openTasks: 20,
    overdueTasks: 0,
    blockedTasks: 0,
    overdueMilestones: 0,
    progress: 40,
    nextMilestone: null,
    ...s,
  });
  const base = { reported: null, forecastDate: null, signals: signals(), completed: false, today };

  it('is on track when an update says so and the plan agrees, and "no update" without one', () => {
    expect(projectState({ ...base, reported: 'on_track' })).toEqual({
      state: 'on_track',
      reasons: [],
      mismatch: false,
    });
    expect(projectState(base).state).toBe('no_update');
    expect(projectState({ ...base, signals: null }).state).toBe('no_update');
  });

  it('is delayed by what is reported or what the dates say, with the reasons', () => {
    expect(projectState({ ...base, reported: 'off_track' })).toMatchObject({
      state: 'delayed',
      reasons: [{ code: 'reported_off_track', value: null }],
      mismatch: false,
    });
    expect(projectState({ ...base, reported: 'on_track', forecastDate: '2027-01-14' })).toEqual({
      state: 'delayed',
      reasons: [{ code: 'slip', value: 14 }],
      mismatch: true,
    });
    expect(projectState({ ...base, signals: signals({ targetDate: '2026-10-01' }) }).reasons).toEqual([
      { code: 'target_passed', value: 12 },
    ]);
    // An expected finish later than today replaces "target passed" by the slip it gives.
    expect(
      projectState({ ...base, forecastDate: '2026-11-01', signals: signals({ targetDate: '2026-10-01' }) })
        .reasons,
    ).toEqual([{ code: 'slip', value: 31 }]);
    expect(
      projectState({ ...base, reported: 'at_risk', signals: signals({ overdueMilestones: 2 }) }),
    ).toMatchObject({
      state: 'delayed',
      reasons: [
        { code: 'milestones_overdue', value: 2 },
        { code: 'reported_at_risk', value: null },
      ],
      mismatch: true,
    });
  });

  it('is at risk when reported so, or when enough tasks are overdue', () => {
    expect(projectState({ ...base, reported: 'at_risk' }).state).toBe('at_risk');
    expect(
      projectState({ ...base, reported: 'on_track', signals: signals({ overdueTasks: 3 }) }),
    ).toMatchObject({
      state: 'at_risk',
      reasons: [{ code: 'tasks_overdue', value: 3 }],
      mismatch: true,
    });
    expect(projectState({ ...base, signals: signals({ openTasks: 5, overdueTasks: 1 }) }).state).toBe(
      'at_risk',
    );
    expect(projectState({ ...base, reported: 'on_track', signals: signals({ overdueTasks: 2 }) }).state).toBe(
      'on_track',
    );
  });

  it('is completed whatever else is said', () => {
    expect(projectState({ ...base, reported: 'off_track', completed: true })).toEqual({
      state: 'completed',
      reasons: [],
      mismatch: false,
    });
  });

  it('suggests a status from the plan for the builtin draft', () => {
    expect(suggestedStatus(signals(), null, today)).toBe('on_track');
    expect(suggestedStatus(signals({ overdueTasks: 4 }), null, today)).toBe('at_risk');
    expect(suggestedStatus(signals(), '2027-02-01', today)).toBe('off_track');
  });
});

describe('what the updates report', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 15, h));

  it('takes the latest manager update, else the most severe one', () => {
    expect(reportedStatus([])).toBeNull();
    expect(
      reportedStatus([
        { status: 'off_track', byManager: false, submittedAt: at(9) },
        { status: 'at_risk', byManager: true, submittedAt: at(8) },
        { status: 'on_track', byManager: true, submittedAt: at(10) },
      ]),
    ).toBe('on_track');
    expect(
      reportedStatus([
        { status: 'on_track', byManager: false, submittedAt: at(9) },
        { status: 'at_risk', byManager: false, submittedAt: at(8) },
      ]),
    ).toBe('at_risk');
  });

  it("takes the managers' expected finish first", () => {
    expect(
      forecastOf([
        { forecastDate: '2027-01-01', byManager: false, submittedAt: at(11) },
        { forecastDate: '2026-12-01', byManager: true, submittedAt: at(9) },
        { forecastDate: null, byManager: true, submittedAt: at(12) },
      ]),
    ).toBe('2026-12-01');
    expect(forecastOf([{ forecastDate: '2027-01-01', byManager: false, submittedAt: at(11) }])).toBe(
      '2027-01-01',
    );
    expect(forecastOf([])).toBeNull();
  });
});

describe('report templates', () => {
  it('knows which sections need narrative text', () => {
    expect(needsNarrative([{ type: 'counts' }, { type: 'projects', detail: 'table' }])).toBe(false);
    expect(needsNarrative([{ type: 'projects', detail: 'brief' }])).toBe(true);
    expect(needsNarrative([{ type: 'asks' }])).toBe(true);
    for (const t of DEFAULT_REPORT_TEMPLATES) expect(needsNarrative(t.sections)).toBe(true);
  });
});
