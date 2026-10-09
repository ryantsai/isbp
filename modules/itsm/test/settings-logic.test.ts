import { describe, expect, it } from 'vitest';
import { durationParts, moved, ownPolicyOf, parseDuration } from '../src/web/settings/logic';

describe('SLA target durations', () => {
  it('reads hours and minutes in any of the UI languages', () => {
    expect(parseDuration('4h')).toBe(240);
    expect(parseDuration('30m')).toBe(30);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration(' 2 hours 5 min ')).toBe(125);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration('1,5 h')).toBe(90);
    expect(parseDuration('27H')).toBe(1620);
    expect(parseDuration('4 小時 30 分鐘')).toBe(270);
    expect(parseDuration('4小時')).toBe(240);
    expect(parseDuration('1 時間 30 分')).toBe(90);
    expect(parseDuration('１時間')).toBe(60); // full-width digits from an IME
  });

  it('refuses what is not a duration, under a minute or over a year', () => {
    for (const bad of ['', '4', 'abc', '3d', '1 day', 'h', '4h x', '0m', '0.2m', '9000h'])
      expect(parseDuration(bad), bad).toBeNull();
  });

  it('splits minutes into hours and minutes, without days (business time)', () => {
    expect(durationParts(1620)).toEqual({ hours: 27, minutes: 0 });
    expect(durationParts(90)).toEqual({ hours: 1, minutes: 30 });
    expect(durationParts(15)).toEqual({ hours: 0, minutes: 15 });
  });
});

describe('ordering helpers', () => {
  it('swaps an item with its neighbour and leaves the ends alone', () => {
    expect(moved(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe("a category's own SLA policy", () => {
  const policies = [
    { id: 'general', condition: null },
    {
      id: 'combo',
      condition: { all: [{ fact: 'ticket.categoryKeys', op: 'eq' as const, value: 'hardware' }] },
    },
    { id: 'exact', condition: { fact: 'ticket.categoryKey', op: 'eq' as const, value: 'network' } },
    { id: 'tree', condition: { fact: 'ticket.categoryKeys', op: 'eq' as const, value: 'hardware' } },
  ];

  it('is a policy with the single rule "category is <key>"', () => {
    expect(ownPolicyOf('hardware', policies)?.id).toBe('tree');
    expect(ownPolicyOf('network', policies)?.id).toBe('exact');
    expect(ownPolicyOf('software', policies)).toBeNull();
  });
});
