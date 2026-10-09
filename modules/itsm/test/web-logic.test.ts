import { describe, expect, it } from 'vitest';
import type { Category } from '../src/contracts';
import { allowedTransitions } from '../src/server/rules';
import {
  articleRefsIn,
  categoryTree,
  dayIn,
  listOf,
  nextStep,
  windowProblem,
  monthGrid,
  mostUrgent,
  niceTicks,
  shiftMonth,
  slaState,
} from '../src/web/logic';
import { NEEDS_CODE, statusesOf } from '../src/web/statuses';

const cat = (
  id: string,
  en: string,
  parentId: string | null,
  sortOrder = 0,
  ancestors: string[] = [],
): Category => ({
  id,
  key: en.toLowerCase(),
  name: { en, 'zh-TW': `${en}（中）` },
  path: [...ancestors, en].join(' › '),
  ancestors: ancestors.map((a, i) => ({ id: `${a}-${i}`, name: { en: a } })),
  parentId,
  ticketTypes: ['incident'],
  defaultGroup: null,
  active: true,
  sortOrder,
  ticketCount: 0,
});

describe('categoryTree', () => {
  it('orders parents before children, siblings by sort order then name, localized', () => {
    const items = [
      cat('vpn', 'VPN', 'net', 0, ['Network']),
      cat('hw', 'Hardware', null, 1),
      cat('net', 'Network', null, 0),
      cat('wifi', 'Wi-Fi', 'net', 0, ['Network']),
    ];
    const tree = categoryTree(items, 'en');
    expect(tree.map((n) => [n.category.id, n.depth])).toEqual([
      ['net', 0],
      ['vpn', 1],
      ['wifi', 1],
      ['hw', 0],
    ]);
    expect(tree[1]!.path).toBe('Network › VPN');
    expect(categoryTree(items, 'zh-TW')[0]!.name).toBe('Network（中）');
  });

  it('lifts children whose parent is filtered out to the top level', () => {
    const tree = categoryTree([cat('vpn', 'VPN', 'missing', 0, ['Network'])], 'en');
    expect(tree).toHaveLength(1);
    expect(tree[0]!.depth).toBe(0);
  });
});

describe('slaState', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  const base = { dueAt: '2026-10-07T12:00:00Z', elapsedRatio: 0.2 };
  it('reads running, at-risk and breached targets live', () => {
    expect(slaState({ ...base, status: 'running' }, now)).toBe('running');
    expect(slaState({ ...base, status: 'running', elapsedRatio: 0.8 }, now)).toBe('at_risk');
    expect(slaState({ ...base, status: 'running', elapsedRatio: 0.8 }, now, 0.9)).toBe('running');
    // Past due before the job marked it.
    expect(slaState({ ...base, status: 'running', dueAt: '2026-10-07T09:00:00Z' }, now)).toBe('breached');
    expect(slaState({ ...base, status: 'breached' }, now)).toBe('breached');
    expect(slaState({ ...base, status: 'paused' }, now)).toBe('paused');
    expect(slaState({ ...base, status: 'met' }, now)).toBe('met');
  });

  it('sorts the most urgent tickets first', () => {
    const sla = (dueAt: string, status: 'running' | 'breached' = 'running', elapsedRatio = 0.1) => ({
      metric: 'resolution' as const,
      status,
      dueAt,
      elapsedRatio,
    });
    const items = [
      { id: 'none', priority: 1, sla: null },
      { id: 'later', priority: 4, sla: sla('2026-10-08T10:00:00Z') },
      { id: 'sooner', priority: 4, sla: sla('2026-10-07T18:00:00Z') },
      { id: 'risk', priority: 3, sla: sla('2026-10-09T10:00:00Z', 'running', 0.9) },
      { id: 'breached', priority: 4, sla: sla('2026-10-06T10:00:00Z', 'breached') },
    ];
    expect(mostUrgent(items, now).map((i) => i.id)).toEqual(['breached', 'risk', 'sooner', 'later', 'none']);
  });
});

describe('niceTicks', () => {
  it('rounds the axis up to clean steps', () => {
    expect(niceTicks(0)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceTicks(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceTicks(37).max).toBe(40);
    expect(niceTicks(1234)).toEqual({ max: 1500, ticks: [0, 500, 1000, 1500] });
  });
});

describe('change calendar grid', () => {
  it('covers the month in Monday-first weeks', () => {
    const weeks = monthGrid('2026-10');
    // 1 October 2026 is a Thursday.
    expect(weeks[0]![0]!.key).toBe('2026-09-28');
    expect(weeks[0]![3]).toEqual({ key: '2026-10-01', day: 1, inMonth: true });
    expect(weeks.at(-1)!.at(-1)!.key).toBe('2026-11-01');
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });

  it('moves between months and buckets instants by the viewer’s day', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    const late = new Date('2026-10-07T20:30:00Z');
    expect(dayIn(late, 'Asia/Taipei')).toBe('2026-10-08');
    expect(dayIn(late, 'Europe/London')).toBe('2026-10-07');
  });
});

describe('statuses', () => {
  it('lists each type’s lifecycle in order', () => {
    expect(statusesOf('incident')).toEqual([
      'new',
      'in_progress',
      'on_hold',
      'resolved',
      'closed',
      'cancelled',
    ]);
    expect(statusesOf('change')[0]).toBe('draft');
    expect(statusesOf('change')).toContain('rejected');
    expect(NEEDS_CODE).toEqual(['resolved', 'fulfilled', 'cancelled']);
  });
});

describe('nextStep', () => {
  const step = (
    type: Parameters<typeof nextStep>[0]['type'],
    status: Parameters<typeof nextStep>[0]['status'],
  ) => nextStep({ type, status, transitions: allowedTransitions(type, status) })?.key ?? null;

  it('names the next stop of each lifecycle', () => {
    expect(step('incident', 'new')).toBe('resolve');
    expect(step('incident', 'resolved')).toBe('reopen');
    expect(step('incident', 'closed')).toBeNull();
    expect(step('service_request', 'in_progress')).toBe('fulfil');
    expect(step('problem', 'new')).toBe('startInvestigating');
    expect(step('problem', 'investigating')).toBe('markKnownError');
    expect(step('problem', 'known_error')).toBe('resolve');
    expect(step('change', 'draft')).toBe('submitForApproval');
    expect(step('change', 'assessment')).toBe('submitForApproval');
    expect(step('change', 'authorization')).toBeNull();
    expect(step('change', 'scheduled')).toBe('startImplementation');
    expect(step('change', 'implementing')).toBe('finishImplementation');
    expect(step('change', 'review')).toBe('closeChange');
    expect(step('change', 'rejected')).toBe('revise');
  });

  it('waits while a sign-off runs and only offers what the viewer may do', () => {
    expect(
      nextStep({ type: 'incident', status: 'pending_approval', signOff: {}, transitions: ['in_progress'] }),
    ).toBeNull();
    expect(nextStep({ type: 'incident', status: 'new', transitions: [] })).toBeNull();
  });
});

describe('ticket page helpers', () => {
  it('sends each kind back to its own list', () => {
    expect(listOf('incident').href).toBe('/itsm');
    expect(listOf('problem').href).toBe('/itsm/problems');
    expect(listOf('change').href).toBe('/itsm/changes');
  });

  it('knows when a change window keeps it from being submitted', () => {
    const now = new Date('2026-10-09T10:00:00Z');
    expect(windowProblem({ changeType: 'normal', plannedStart: null, plannedEnd: null }, now)).toBe(
      'missing',
    );
    expect(
      windowProblem(
        { changeType: 'normal', plannedStart: '2026-10-08T10:00:00Z', plannedEnd: '2026-10-08T11:00:00Z' },
        now,
      ),
    ).toBe('past');
    expect(
      windowProblem(
        { changeType: 'emergency', plannedStart: '2026-10-08T10:00:00Z', plannedEnd: '2026-10-08T11:00:00Z' },
        now,
      ),
    ).toBeNull();
    expect(
      windowProblem(
        { changeType: 'normal', plannedStart: '2026-10-10T10:00:00Z', plannedEnd: '2026-10-10T11:00:00Z' },
        now,
      ),
    ).toBeNull();
  });

  it('finds the articles a reply cites', () => {
    expect(articleRefsIn('See [KB-00078](/knowledge/KB-00078) and KB-00012.')).toEqual([
      'KB-00078',
      'KB-00012',
    ]);
  });
});
