import { describe, expect, it } from 'vitest';
import {
  addDays,
  blockingDependencies,
  completedAtFor,
  completionProblem,
  dueBucket,
  formatTaskRef,
  isValidRank,
  needsDependenciesDone,
  overBy,
  parseTaskRef,
  plannedHours,
  projectTransitions,
  RANK_MAX_LENGTH,
  rankBetween,
  rankSequence,
  spreadTask,
  suggestProjectKey,
  utilisation,
  weekStart,
  weeklyCapacity,
  weeklyHours,
  wouldCreateCycle,
} from '../src/model';

describe('task references', () => {
  it('formats and parses NET-12 style references and ids', () => {
    expect(formatTaskRef('NET', 12)).toBe('NET-12');
    expect(parseTaskRef('NET-12')).toEqual({ key: 'NET', number: 12 });
    expect(parseTaskRef(' m365-7 ')).toEqual({ key: 'M365', number: 7 });
    expect(parseTaskRef('0199a6f0-1c2d-7e3f-8a4b-5c6d7e8f9a0b')).toEqual({
      id: '0199a6f0-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
    });
    for (const bad of ['NET', 'NET-0', '12', 'N-1', '1NET-2', 'NET-12-3', "NET-1' or 1=1"])
      expect(parseTaskRef(bad), bad).toBeNull();
  });
});

describe('ranks', () => {
  const sorted = (xs: string[]) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  it('always finds a rank strictly between two others', () => {
    expect(rankBetween(null, null)).toBe('i');
    const a = rankBetween(null, null);
    const b = rankBetween(a, null);
    const c = rankBetween(null, a);
    expect(sorted([b, a, c])).toEqual([c, a, b]);
    const mid = rankBetween(c, a);
    expect(c < mid && mid < a).toBe(true);
    expect(rankBetween('a', 'b') > 'a' && rankBetween('a', 'b') < 'b').toBe(true);
    expect(rankBetween('a0z', 'a1')).toMatch(/^a0z/);
  });

  it('keeps inserting at the same spot without collisions or trailing zeros', () => {
    let lo = 'a';
    const hi = 'b';
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = rankBetween(lo, hi);
      expect(r > lo && r < hi, `${lo} < ${r} < ${hi}`).toBe(true);
      expect(isValidRank(r)).toBe(true);
      expect(seen.has(r)).toBe(false);
      seen.add(r);
      lo = r;
    }
    // Repeated prepends and appends.
    let top = 'i';
    let bottom = 'i';
    for (let i = 0; i < 100; i++) {
      const t = rankBetween(null, top);
      const b = rankBetween(bottom, null);
      expect(t < top && b > bottom).toBe(true);
      top = t;
      bottom = b;
    }
    expect(top.length).toBeLessThan(RANK_MAX_LENGTH);
  });

  it('refuses invalid or out-of-order bounds', () => {
    expect(() => rankBetween('b', 'a')).toThrow();
    expect(() => rankBetween('a', 'a')).toThrow();
    expect(() => rankBetween('a0', null)).toThrow();
    expect(() => rankBetween('A', null)).toThrow();
  });

  it('spreads a column evenly for seeding and rebalancing', () => {
    for (const n of [1, 2, 7, 36, 500]) {
      const ranks = rankSequence(n);
      expect(ranks).toHaveLength(n);
      expect(sorted(ranks)).toEqual(ranks);
      expect(new Set(ranks).size).toBe(n);
      expect(ranks.every(isValidRank)).toBe(true);
      // Room before the first and after the last.
      expect(rankBetween(null, ranks[0]!) < ranks[0]!).toBe(true);
      expect(rankBetween(ranks[n - 1]!, null) > ranks[n - 1]!).toBe(true);
    }
    expect(rankSequence(0)).toEqual([]);
  });
});

describe('status rules', () => {
  it('follows proposed → active → on hold ⇄ active → completed, cancel from anything open', () => {
    expect(projectTransitions('proposed')).toEqual(['cancelled']);
    expect(projectTransitions('active')).toEqual(['on_hold', 'completed', 'cancelled']);
    expect(projectTransitions('on_hold')).toEqual(['active', 'cancelled']);
    expect(projectTransitions('completed')).toEqual([]);
    expect(projectTransitions('cancelled')).toEqual([]);
  });

  it('completes only with every task closed, or forced with a comment', () => {
    expect(completionProblem({ openTasks: 0 })).toBeNull();
    expect(completionProblem({ openTasks: 3 })).toBe('open_tasks');
    expect(completionProblem({ openTasks: 3, force: true })).toBe('comment_required');
    expect(completionProblem({ openTasks: 3, force: true, comment: '  ' })).toBe('comment_required');
    expect(completionProblem({ openTasks: 3, force: true, comment: 'Moved to phase 2' })).toBeNull();
  });

  it('stamps completion when a task is done and clears it when reopened', () => {
    const now = new Date('2026-10-07T03:00:00Z');
    const earlier = new Date('2026-10-01T03:00:00Z');
    expect(completedAtFor('in_review', 'done', null, now)).toBe(now);
    expect(completedAtFor('done', 'done', earlier, now)).toBe(earlier);
    expect(completedAtFor('done', 'in_progress', earlier, now)).toBeNull();
    expect(completedAtFor('todo', 'in_progress', null, now)).toBeNull();
  });

  it('blocks starting while a dependency is not done (cancelled ones no longer block)', () => {
    expect(needsDependenciesDone('in_progress')).toBe(true);
    expect(needsDependenciesDone('in_review')).toBe(false);
    const deps = [
      { id: 'a', status: 'done' as const },
      { id: 'b', status: 'in_review' as const },
      { id: 'c', status: 'cancelled' as const },
      { id: 'd', status: 'todo' as const },
    ];
    expect(blockingDependencies(deps).map((d) => d.id)).toEqual(['b', 'd']);
  });

  it('detects dependency loops', () => {
    const edges = [
      { taskId: 'b', dependsOnId: 'a' },
      { taskId: 'c', dependsOnId: 'b' },
      { taskId: 'd', dependsOnId: 'c' },
    ];
    expect(wouldCreateCycle(edges, 'a', 'd')).toBe(true);
    expect(wouldCreateCycle(edges, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(edges, 'd', 'a')).toBe(false);
    expect(wouldCreateCycle(edges, 'e', 'd')).toBe(false);
    // Diamonds are fine.
    expect(wouldCreateCycle([...edges, { taskId: 'd', dependsOnId: 'a' }], 'e', 'd')).toBe(false);
  });
});

describe('project keys', () => {
  it('suggests a key from the name', () => {
    expect(suggestProjectKey('ERP upgrade to v12')).toBe('ERP');
    expect(suggestProjectKey('Zero Trust rollout')).toBe('ZTR');
    expect(suggestProjectKey('Microsoft 365 migration')).toBe('MM');
    expect(suggestProjectKey('Kaohsiung office opening')).toBe('KOO');
    expect(suggestProjectKey('Network')).toBe('NETW');
    expect(suggestProjectKey('Service desk platform rollout')).toBe('SDPR');
    expect(suggestProjectKey('The data center move for HQ')).toBe('HQ');
    expect(suggestProjectKey('高雄辦公室')).toBe('');
    expect(suggestProjectKey('Wi-Fi 7')).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
  });
});

describe('dates and my tasks', () => {
  it('works on calendar dates', () => {
    expect(addDays('2026-10-07', 1)).toBe('2026-10-08');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekStart('2026-10-07')).toBe('2026-10-05'); // Wednesday → Monday
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // Sunday → Monday
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
  });

  it('groups by due date', () => {
    const today = '2026-10-07'; // Wednesday
    expect(dueBucket('2026-10-06', today)).toBe('overdue');
    expect(dueBucket('2026-10-07', today)).toBe('today');
    expect(dueBucket('2026-10-11', today)).toBe('thisWeek');
    expect(dueBucket('2026-10-12', today)).toBe('later');
    expect(dueBucket(null, today)).toBe('noDate');
  });
});

describe('workload', () => {
  const today = '2026-10-07'; // Wednesday

  it('plans remaining hours, else the estimate', () => {
    expect(plannedHours({ startDate: null, dueDate: null, estimateHours: 8, remainingHours: null })).toBe(8);
    expect(plannedHours({ startDate: null, dueDate: null, estimateHours: 8, remainingHours: 3 })).toBe(3);
    expect(plannedHours({ startDate: null, dueDate: null, estimateHours: null, remainingHours: null })).toBe(
      0,
    );
  });

  it('spreads hours over working days from the start (or today) to the due date', () => {
    const spread = spreadTask(
      { startDate: '2026-10-12', dueDate: '2026-10-16', estimateHours: 10, remainingHours: null },
      today,
    );
    expect([...spread]).toEqual([
      ['2026-10-12', 2],
      ['2026-10-13', 2],
      ['2026-10-14', 2],
      ['2026-10-15', 2],
      ['2026-10-16', 2],
    ]);
    // Weekends are skipped.
    const overWeekend = spreadTask(
      { startDate: '2026-10-09', dueDate: '2026-10-12', estimateHours: 8, remainingHours: null },
      today,
    );
    expect([...overWeekend.keys()]).toEqual(['2026-10-09', '2026-10-12']);
    // No start: from today. A start in the past: from today too.
    expect([
      ...spreadTask(
        { startDate: null, dueDate: '2026-10-08', estimateHours: 4, remainingHours: null },
        today,
      ).keys(),
    ]).toEqual(['2026-10-07', '2026-10-08']);
    expect([
      ...spreadTask(
        { startDate: '2026-09-01', dueDate: '2026-10-08', estimateHours: 4, remainingHours: null },
        today,
      ).keys(),
    ]).toEqual(['2026-10-07', '2026-10-08']);
    // Overdue: everything lands today.
    expect([
      ...spreadTask(
        { startDate: null, dueDate: '2026-10-01', estimateHours: 6, remainingHours: null },
        today,
      ),
    ]).toEqual([['2026-10-07', 6]]);
    // Weekend-only window: the next working day.
    expect([
      ...spreadTask(
        { startDate: '2026-10-10', dueDate: '2026-10-11', estimateHours: 3, remainingHours: null },
        today,
      ),
    ]).toEqual([['2026-10-12', 3]]);
    // Nothing to plan without a due date or hours.
    expect(
      spreadTask({ startDate: today, dueDate: null, estimateHours: 4, remainingHours: null }, today).size,
    ).toBe(0);
    expect(
      spreadTask({ startDate: today, dueDate: '2026-10-09', estimateHours: 4, remainingHours: 0 }, today)
        .size,
    ).toBe(0);
  });

  it('sums hours per ISO week', () => {
    const weeks = weeklyHours(
      { startDate: '2026-10-08', dueDate: '2026-10-14', estimateHours: 15, remainingHours: null },
      today,
      '2026-10-05',
      3,
    );
    // 5 working days: Thu, Fri (week 1), Mon, Tue, Wed (week 2).
    expect(weeks).toEqual([6, 9, 0]);
  });

  it('measures capacity and over-allocation', () => {
    expect(weeklyCapacity([50, 30], 40)).toBe(32);
    expect(weeklyCapacity([150], 40)).toBe(40);
    expect(utilisation(30, 20)).toBe(1.5);
    expect(utilisation(5, 0)).toBeNull();
    expect(overBy(26, 20)).toBe(6);
    expect(overBy(20, 20)).toBe(0);
    expect(overBy(3, 0)).toBe(3);
  });
});
