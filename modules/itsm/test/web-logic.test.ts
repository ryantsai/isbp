import { describe, expect, it } from 'vitest';
import type { Category } from '../src/contracts';
import {
  categoryTree,
  dayIn,
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
