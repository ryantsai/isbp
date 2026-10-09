import type { Condition } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import type { TicketType } from '../src/contracts';
import { matchPolicy, slaFacts } from '../src/server/sla';
import {
  categoryKeyChain,
  categoryPolicies,
  type CoveragePolicy,
  isAnalysable,
  placementFor,
  policyReach,
  prioritiesOf,
  reachAfter,
} from '../src/sla-coverage';

const categories = [
  { id: 'c-hw', key: 'hardware', parentId: null },
  { id: 'c-laptop', key: 'hardware-laptop', parentId: 'c-hw' },
  { id: 'c-dock', key: 'hardware-laptop-dock', parentId: 'c-laptop' },
  { id: 'c-net', key: 'network', parentId: null },
];
const ctx = { categories };

const policy = (
  id: string,
  ticketTypes: TicketType[],
  condition: Condition | null = null,
  active = true,
): CoveragePolicy => ({ id, ticketTypes, condition, active });

const p1: Condition = { fact: 'ticket.priority', op: 'eq', value: 1 };
const hardware: Condition = { fact: 'ticket.categoryKeys', op: 'eq', value: 'hardware' };
const laptopOnly: Condition = { fact: 'ticket.categoryKey', op: 'eq', value: 'hardware-laptop' };

/** The demo policies: P1 incidents around the clock, then incidents, then service requests. */
const demo = [
  policy('critical', ['incident'], p1),
  policy('incidents', ['incident']),
  policy('requests', ['service_request']),
];

describe('category key chain (ticket.categoryKeys)', () => {
  it('lists the category and its ancestors, nearest first', () => {
    expect(categoryKeyChain('hardware-laptop-dock', categories)).toEqual([
      'hardware-laptop-dock',
      'hardware-laptop',
      'hardware',
    ]);
    expect(categoryKeyChain('network', categories)).toEqual(['network']);
    expect(categoryKeyChain(null, categories)).toEqual([]);
  });

  it('lets a rule on a parent category match its subcategories when tickets are matched', () => {
    const t = {
      type: 'incident',
      priority: 3,
      impact: 2,
      urgency: 2,
      major: false,
      channel: 'portal',
    } as never;
    const rows = [
      { id: 'hw', ticketTypes: ['incident'], condition: hardware, sortOrder: 10 },
      { id: 'inc', ticketTypes: ['incident'], condition: null, sortOrder: 20 },
    ] as never[];
    const chain = categoryKeyChain('hardware-laptop-dock', categories);
    expect(matchPolicy(rows, slaFacts(t, 'hardware-laptop-dock', chain))?.id).toBe('hw');
    expect(matchPolicy(rows, slaFacts(t, 'network', ['network']))?.id).toBe('inc');
    // `ticket.categoryKey` stays exact.
    const exact = [{ id: 'x', ticketTypes: ['incident'], condition: laptopOnly, sortOrder: 10 }] as never[];
    expect(matchPolicy(exact, slaFacts(t, 'hardware-laptop-dock', chain))).toBeNull();
    expect(matchPolicy(exact, slaFacts(t, 'hardware-laptop', ['hardware-laptop', 'hardware']))?.id).toBe('x');
  });
});

describe('policy reach', () => {
  it('flags a category policy placed after the general one as never applying', () => {
    const list = [...demo, policy('hw', ['incident'], hardware)];
    const reach = policyReach(list, ctx);
    expect(reach.get('critical')).toEqual({ blocked: [] });
    expect(reach.get('incidents')).toEqual({ blocked: [] });
    expect(reach.get('hw')).toEqual({ blocked: [{ type: 'incident', by: 'incidents' }] });
  });

  it('names the policy that takes the last of its tickets, after partial overlaps', () => {
    // P1 hardware incidents go to "critical", the rest to "incidents": the latter closes the gap.
    expect(reachAfter(policy('hw', ['incident'], hardware), demo, ctx)).toEqual({
      blocked: [{ type: 'incident', by: 'incidents' }],
    });
    // A P1-only policy behind "critical" is taken entirely by it.
    expect(reachAfter(policy('p1-hw', ['incident'], { all: [p1, hardware] }), demo, ctx)).toEqual({
      blocked: [{ type: 'incident', by: 'critical' }],
    });
  });

  it('reports each ticket type on its own', () => {
    const both = policy('hw', ['incident', 'service_request', 'problem'], hardware);
    expect(reachAfter(both, demo, ctx)).toEqual({
      blocked: [
        { type: 'incident', by: 'incidents' },
        { type: 'service_request', by: 'requests' },
      ],
    });
  });

  it('applies when it comes first, and ignores inactive policies', () => {
    expect(reachAfter(policy('hw', ['incident'], hardware), [], ctx)).toEqual({ blocked: [] });
    const off = [policy('incidents', ['incident'], null, false)];
    expect(reachAfter(policy('hw', ['incident'], hardware), off, ctx)).toEqual({ blocked: [] });
  });

  it('says when no ticket can match the rules', () => {
    const impossible: Condition = { all: [p1, { fact: 'ticket.priority', op: 'eq', value: 2 }] };
    expect(reachAfter(policy('x', ['incident'], impossible), [], ctx)).toEqual({
      blocked: [{ type: 'incident', by: null }],
    });
  });

  it('is exact for subcategories: an exact-category rule does not cover its children', () => {
    const earlier = [policy('laptop', ['incident'], laptopOnly)];
    expect(reachAfter(policy('hw', ['incident'], hardware), earlier, ctx)).toEqual({ blocked: [] });
    const subtree = [policy('laptop-tree', ['incident'], { ...hardware, value: 'hardware-laptop' })];
    expect(
      reachAfter(
        policy('dock', ['incident'], { ...laptopOnly, value: 'hardware-laptop-dock' }),
        subtree,
        ctx,
      ),
    ).toEqual({ blocked: [{ type: 'incident', by: 'laptop-tree' }] });
  });

  it('makes no claim about conditions on facts it cannot enumerate', () => {
    const odd: Condition = { fact: 'ticket.colour', op: 'eq', value: 'red' };
    expect(isAnalysable(odd)).toBe(false);
    expect(reachAfter(policy('x', ['incident'], odd), demo, ctx)).toBeNull();
    // An earlier policy with such a condition never counts as taking tickets.
    expect(reachAfter(policy('hw', ['incident'], hardware), [policy('odd', ['incident'], odd)], ctx)).toEqual(
      {
        blocked: [],
      },
    );
  });

  it('handles any/not, lists and comparisons with the real matching rules', () => {
    const highOrMajor: Condition = {
      any: [
        { fact: 'ticket.priority', op: 'lte', value: 2 },
        { fact: 'ticket.major', op: 'eq', value: true },
      ],
    };
    const earlier = [policy('urgent', ['incident'], highOrMajor)];
    expect(reachAfter(policy('p1', ['incident'], p1), earlier, ctx)).toEqual({
      blocked: [{ type: 'incident', by: 'urgent' }],
    });
    expect(
      reachAfter(
        policy('p3', ['incident'], { fact: 'ticket.priority', op: 'in', value: [2, 3] }),
        earlier,
        ctx,
      ),
    ).toEqual({ blocked: [] });
    expect(
      reachAfter(policy('not-p1', ['incident'], { not: p1 }), [policy('all', ['incident'])], ctx),
    ).toEqual({ blocked: [{ type: 'incident', by: 'all' }] });
  });
});

describe('placement of a new policy', () => {
  it('goes just before the policy that would take all its tickets, after partial overlaps', () => {
    expect(placementFor(policy('hw', ['incident'], hardware), demo, ctx)).toBe('incidents');
    expect(placementFor(policy('p1-hw', ['incident'], { all: [p1, hardware] }), demo, ctx)).toBe('critical');
  });

  it('takes the earliest place its types need', () => {
    const list = [policy('requests', ['service_request']), policy('incidents', ['incident'])];
    expect(placementFor(policy('hw', ['incident', 'service_request'], hardware), list, ctx)).toBe('requests');
  });

  it('goes last when nothing takes all its tickets, nothing can match, or it cannot be analysed', () => {
    expect(placementFor(policy('chg', ['change']), demo, ctx)).toBeNull();
    expect(placementFor(policy('x', ['incident'], { all: [p1, { ...p1, value: 2 }] }), demo, ctx)).toBeNull();
    expect(
      placementFor(policy('x', ['incident'], { fact: 'ticket.colour', op: 'eq', value: 'red' }), demo, ctx),
    ).toBeNull();
  });
});

describe('priorities a condition allows', () => {
  it('reads priority rules, alone or combined', () => {
    expect(prioritiesOf(null, ctx)).toEqual([1, 2, 3, 4]);
    expect(prioritiesOf(p1, ctx)).toEqual([1]);
    expect(prioritiesOf({ all: [hardware, { fact: 'ticket.priority', op: 'lte', value: 2 }] }, ctx)).toEqual([
      1, 2,
    ]);
    expect(prioritiesOf({ fact: 'ticket.priority', op: 'nin', value: [1, 4] }, ctx)).toEqual([2, 3]);
    expect(prioritiesOf(hardware, ctx)).toEqual([1, 2, 3, 4]);
  });

  it('follows impact and urgency', () => {
    // Impact 1 and urgency 1 can still give any priority: priority is its own fact here.
    expect(prioritiesOf({ fact: 'ticket.impact', op: 'eq', value: 1 }, ctx)).toEqual([1, 2, 3, 4]);
  });

  it('keeps every priority when it cannot tell', () => {
    expect(prioritiesOf({ fact: 'ticket.colour', op: 'eq', value: 'red' }, ctx)).toEqual([1, 2, 3, 4]);
  });
});

describe('policies a category gets', () => {
  it('lists the policies that apply to some ticket of each type, in order', () => {
    const list = [policy('hw', ['incident'], hardware), ...demo];
    expect(
      categoryPolicies(
        { key: 'hardware-laptop', ticketTypes: ['incident', 'service_request', 'change'] },
        list,
        ctx,
      ),
    ).toEqual([
      { type: 'incident', policyIds: ['hw'] },
      { type: 'service_request', policyIds: ['requests'] },
    ]);
    expect(categoryPolicies({ key: 'network', ticketTypes: ['incident'] }, list, ctx)).toEqual([
      { type: 'incident', policyIds: ['critical', 'incidents'] },
    ]);
  });
});
