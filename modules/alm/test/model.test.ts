import { describe, expect, it } from 'vitest';
import {
  assembleDora,
  canMoveRelease,
  DEPLOYMENT_TRANSITIONS,
  type DoraFacts,
  evaluatePolicy,
  evaluateReadiness,
  inWindow,
  isValidCode,
  median,
  type PolicyChange,
  rankChanges,
  releaseHref,
  suggestCode,
  weekStart,
  weekStarts,
} from '../src/model';

const NOW = new Date('2026-10-07T12:00:00Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

const change = (
  status: string,
  window: 'in' | 'past' | 'future' | 'none',
  extra: Partial<PolicyChange> = {},
) => ({
  id: `${status}-${window}-${extra.named ? 'n' : 'l'}`,
  reference: 'CHG-00012',
  status,
  plannedStart: window === 'none' ? null : window === 'in' ? at(-1) : window === 'past' ? at(-5) : at(24),
  plannedEnd: window === 'none' ? null : window === 'in' ? at(2) : window === 'past' ? at(-3) : at(26),
  ...extra,
});

const ON = { requireChange: true, enforceWindow: false };
const STRICT = { requireChange: true, enforceWindow: true };

describe('change policy', () => {
  it('only applies to production while the requirement is on', () => {
    for (const kind of ['development', 'test', 'staging', 'dr'] as const)
      expect(
        evaluatePolicy({ environmentKind: kind, settings: STRICT, changes: [], now: NOW }),
      ).toMatchObject({
        outcome: 'allow',
        applies: false,
      });
    expect(
      evaluatePolicy({
        environmentKind: 'production',
        settings: { requireChange: false, enforceWindow: true },
        changes: [],
        now: NOW,
      }),
    ).toMatchObject({ outcome: 'allow', applies: false, reason: null });
  });

  it.each([
    // [change status, window, settings, override] → outcome, reason, warning
    ['none', 'none', ON, false, 'deny', 'no_change', null],
    ['none', 'none', ON, true, 'override', 'no_change', null],
    ['draft', 'in', ON, false, 'deny', 'change_not_approved', null],
    ['authorization', 'in', STRICT, false, 'deny', 'change_not_approved', null],
    ['rejected', 'in', ON, true, 'override', 'change_not_approved', null],
    ['closed', 'in', ON, false, 'deny', 'change_not_approved', null],
    ['scheduled', 'in', ON, false, 'allow', null, null],
    ['implementing', 'in', STRICT, false, 'allow', null, null],
    ['scheduled', 'future', ON, false, 'warn', null, 'outside_window'],
    ['scheduled', 'past', ON, false, 'warn', null, 'outside_window'],
    ['scheduled', 'none', ON, false, 'warn', null, 'outside_window'],
    ['scheduled', 'future', STRICT, false, 'deny', 'outside_window', null],
    ['implementing', 'past', STRICT, true, 'override', 'outside_window', null],
    // An override on a deployment the policy allows is not an override.
    ['scheduled', 'in', STRICT, true, 'allow', null, null],
  ] as const)(
    '%s change, %s window, %o, override %s → %s',
    (status, window, settings, override, outcome, reason, warning) => {
      const changes = status === 'none' ? [] : [change(status, window)];
      const d = evaluatePolicy({ environmentKind: 'production', settings, changes, now: NOW, override });
      expect(d).toMatchObject({ outcome, reason, warning, applies: true });
      if (changes.length) expect(d.change?.status).toBe(status);
    },
  );

  it('is authorized by the named change or a linked one, preferring the best candidate', () => {
    const linked = change('scheduled', 'in');
    const named = change('draft', 'in', { named: true });
    const d = evaluatePolicy({
      environmentKind: 'production',
      settings: STRICT,
      changes: [named, linked],
      now: NOW,
    });
    expect(d).toMatchObject({ outcome: 'allow', change: { id: linked.id } });
    // Among equally good changes, the one the caller named wins.
    const namedOk = change('implementing', 'in', { named: true, id: 'n' });
    expect(rankChanges([linked, namedOk], NOW)[0]!.id).toBe('n');
    // Authorized beats closer in time; in-window beats out-of-window.
    const soon = change('scheduled', 'future', { id: 'soon' });
    expect(rankChanges([soon, change('draft', 'in'), linked], NOW).map((c) => c.id)).toEqual([
      linked.id,
      'soon',
      'draft-in-l',
    ]);
  });

  it('treats the window as inclusive and needs both ends', () => {
    expect(inWindow({ plannedStart: NOW, plannedEnd: NOW }, NOW)).toBe(true);
    expect(inWindow({ plannedStart: at(-1), plannedEnd: null }, NOW)).toBe(false);
  });
});

describe('release readiness', () => {
  const ready = {
    changes: [change('scheduled', 'future')],
    testedIn: ['Staging'],
    notes: '## Notes',
    failedInProduction: 0,
  };

  it('passes when all four checks pass', () => {
    expect(evaluateReadiness(ready, NOW)).toMatchObject({
      ready: true,
      passed: 4,
      total: 4,
      change: { status: 'scheduled' },
    });
  });

  it('reports each missing piece', () => {
    const r = evaluateReadiness(
      { changes: [change('assessment', 'in')], testedIn: [], notes: '  ', failedInProduction: 1 },
      NOW,
    );
    expect(r).toMatchObject({ ready: false, passed: 0, change: { status: 'assessment' } });
    expect(r.checks).toEqual([
      { key: 'change', ok: false },
      { key: 'tested', ok: false },
      { key: 'notes', ok: false },
      { key: 'production', ok: false },
    ]);
    expect(evaluateReadiness({ ...ready, changes: [] }, NOW)).toMatchObject({ passed: 3, change: null });
  });
});

describe('DORA metrics', () => {
  const facts: DoraFacts = {
    succeeded: 9,
    failed: 2,
    rolledBack: 1,
    leadTimeMinutes: 2880,
    leadTimeSamples: 4,
    restoreMinutes: 90,
    restoreSamples: 3,
    weeks: [
      { week: '2026-09-14', succeeded: 4, failed: 1 },
      { week: '2026-10-05', succeeded: 5, failed: 2 },
    ],
  };

  it('computes frequency, failure rate, lead time and time to restore', () => {
    const from = new Date('2026-09-09T12:00:00Z');
    const m = assembleDora(facts, from, NOW);
    expect(m.days).toBe(28);
    expect(m.deploymentFrequency).toEqual({ perWeek: 2.3, total: 9 });
    expect(m.changeFailureRate).toEqual({ rate: 0.25, failures: 3, finished: 12 });
    expect(m.leadTime).toEqual({ medianHours: 48, samples: 4 });
    expect(m.timeToRestore).toEqual({ medianHours: 1.5, samples: 3 });
    // Every week of the window, Monday first, zeros where nothing happened.
    expect(m.weekly.map((w) => w.week)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ]);
    expect(m.weekly.map((w) => [w.succeeded, w.failed])).toEqual([
      [0, 0],
      [4, 1],
      [0, 0],
      [0, 0],
      [5, 2],
    ]);
  });

  it('says "no data" rather than zero when nothing finished', () => {
    const m = assembleDora(
      {
        ...facts,
        succeeded: 0,
        failed: 0,
        rolledBack: 0,
        leadTimeMinutes: null,
        restoreMinutes: null,
        weeks: [],
      },
      new Date('2026-07-09T12:00:00Z'),
      NOW,
    );
    expect(m.changeFailureRate.rate).toBeNull();
    expect(m.leadTime.medianHours).toBeNull();
    expect(m.deploymentFrequency.perWeek).toBe(0);
    expect(m.weekly).toHaveLength(14);
  });

  it('finds Mondays in UTC and medians', () => {
    expect(weekStart(new Date('2026-10-04T23:59:00Z'))).toBe('2026-09-28'); // a Sunday
    expect(weekStart(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05');
    expect(weekStarts(new Date('2026-10-05T00:00:00Z'), new Date('2026-10-05T00:00:00Z'))).toEqual([
      '2026-10-05',
    ]);
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('codes, versions and lifecycles', () => {
  it('suggests a code from the name', () => {
    expect(suggestCode('Finance ERP')).toBe('finance-erp');
    expect(suggestCode('Field Service Mobile App')).toBe('field-service-mobile-app');
    expect(suggestCode('Café Ordering 2.0')).toBe('cafe-ordering-2-0');
    expect(suggestCode('  HR   Portal!! ')).toBe('hr-portal');
    expect(suggestCode('財務 ERP')).toBe('erp');
    expect(suggestCode('財務系統')).toBe('');
    expect(suggestCode('365 Mail')).toBe('mail');
    expect(suggestCode('Releases')).toBe('releases-app');
    expect(suggestCode('A very long application name that keeps going and going')).toBe(
      'a-very-long-application-name',
    );
    expect(suggestCode('HR Portal', new Set(['hr-portal', 'hr-portal-2']))).toBe('hr-portal-3');
    for (const name of [
      'Finance ERP',
      'Field Service Mobile App',
      'A very long application name that keeps going',
    ])
      expect(isValidCode(suggestCode(name))).toBe(true);
  });

  it('allows the documented release and deployment transitions', () => {
    expect(canMoveRelease('planned', 'in_progress')).toBe(true);
    expect(canMoveRelease('ready', 'released')).toBe(true);
    expect(canMoveRelease('released', 'planned')).toBe(false);
    expect(canMoveRelease('cancelled', 'planned')).toBe(true);
    expect(canMoveRelease('cancelled', 'released')).toBe(false);
    expect(DEPLOYMENT_TRANSITIONS.succeeded).toEqual(['rolled_back']);
    expect(DEPLOYMENT_TRANSITIONS.failed).toEqual([]);
  });

  it('builds release URLs safely', () => {
    expect(releaseHref('erp', '12.1.0')).toBe('/alm/erp/releases/12.1.0');
    expect(releaseHref('corp-web', '1.0+build.7')).toBe('/alm/corp-web/releases/1.0%2Bbuild.7');
  });
});
