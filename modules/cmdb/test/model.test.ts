import { describe, expect, it } from 'vitest';
import {
  type Edge,
  formatCiNumber,
  impactChildDirection,
  impactStep,
  parseCiRef,
  relationshipLabel,
  relationshipProblem,
  traverse,
} from '../src/model';

const ID = '0190a1b2-0000-7000-8000-00000000000a';

describe('CI references', () => {
  it('formats and parses CI numbers and uuids', () => {
    expect(formatCiNumber(42)).toBe('CI-00042');
    expect(formatCiNumber(1234567)).toBe('CI-1234567');
    expect(parseCiRef('CI-00042')).toEqual({ number: 42 });
    expect(parseCiRef('ci-42')).toEqual({ number: 42 });
    expect(parseCiRef(` ${ID.toUpperCase()} `)).toEqual({ id: ID });
    expect(parseCiRef('CI-0')).toBeNull();
    expect(parseCiRef('42')).toBeNull();
    expect(parseCiRef("CI-1' or 1=1")).toBeNull();
  });
});

describe('relationship labels', () => {
  it('reads forward from the source and in reverse from the target', () => {
    expect(relationshipLabel('depends_on', 'outgoing')).toBe('depends on');
    expect(relationshipLabel('depends_on', 'incoming')).toBe('used by');
    expect(relationshipLabel('runs_on', 'incoming')).toBe('hosts');
    expect(relationshipLabel('contains', 'incoming')).toBe('contained in');
    expect(relationshipLabel('backs_up', 'incoming')).toBe('backed up by');
    expect(relationshipLabel('connects_to', 'incoming')).toBe('connected from');
  });
});

describe('relationship validation', () => {
  const none = { duplicate: false, containedInTarget: new Set<string>() };

  it('refuses self links first, then duplicates', () => {
    expect(relationshipProblem({ sourceId: 'a', targetId: 'a', type: 'depends_on' }, none)).toBe('self');
    expect(
      relationshipProblem({ sourceId: 'a', targetId: 'b', type: 'runs_on' }, { ...none, duplicate: true }),
    ).toBe('duplicate');
    expect(relationshipProblem({ sourceId: 'a', targetId: 'b', type: 'runs_on' }, none)).toBeNull();
  });

  it('refuses containment loops, and only for contains', () => {
    const facts = { duplicate: false, containedInTarget: new Set(['x', 'a']) };
    expect(relationshipProblem({ sourceId: 'a', targetId: 'b', type: 'contains' }, facts)).toBe('cycle');
    expect(relationshipProblem({ sourceId: 'a', targetId: 'b', type: 'depends_on' }, facts)).toBeNull();
    expect(relationshipProblem({ sourceId: 'z', targetId: 'b', type: 'contains' }, facts)).toBeNull();
  });
});

describe('impact traversal', () => {
  // svc → app → vm → host; rack ⊃ host; db ← app; backup backs up db; vm connects to fw.
  const edges: Edge[] = [
    { sourceId: 'svc', targetId: 'app', type: 'depends_on' },
    { sourceId: 'app', targetId: 'vm', type: 'runs_on' },
    { sourceId: 'app', targetId: 'db', type: 'depends_on' },
    { sourceId: 'vm', targetId: 'host', type: 'runs_on' },
    { sourceId: 'rack', targetId: 'host', type: 'contains' },
    { sourceId: 'bkp', targetId: 'db', type: 'backs_up' },
    { sourceId: 'vm', targetId: 'fw', type: 'connects_to' },
  ];
  const ids = (nodes: { id: string; depth: number }[]) => nodes.map((n) => `${n.id}@${n.depth}`).sort();

  it('walks upstream: what breaks when a CI breaks', () => {
    expect(ids(traverse(edges, 'rack', 'impacted', 5))).toEqual(['app@3', 'host@1', 'svc@4', 'vm@2']);
    expect(ids(traverse(edges, 'db', 'impacted', 5))).toEqual(['app@1', 'svc@2']);
    expect(traverse(edges, 'rack', 'impacted', 5)[0]).toEqual({
      id: 'host',
      depth: 1,
      edgeType: 'contains',
      parentId: 'rack',
    });
  });

  it('walks downstream: what a CI needs', () => {
    expect(ids(traverse(edges, 'svc', 'dependsOn', 5))).toEqual([
      'app@1',
      'db@2',
      'host@3',
      'rack@4',
      'vm@2',
    ]);
  });

  it('ignores links that do not propagate failures', () => {
    expect(traverse(edges, 'fw', 'impacted', 5)).toEqual([]);
    expect(traverse(edges, 'db', 'impacted', 5).some((n) => n.id === 'bkp')).toBe(false);
    expect(impactStep({ sourceId: 'a', targetId: 'b', type: 'backs_up' }, 'b', 'impacted')).toBeNull();
  });

  it('is depth-limited (1..5) and keeps the shortest depth', () => {
    expect(ids(traverse(edges, 'rack', 'impacted', 2))).toEqual(['host@1', 'vm@2']);
    expect(traverse(edges, 'rack', 'impacted', 0)).toHaveLength(1);
    const diamond: Edge[] = [
      { sourceId: 'b', targetId: 'a', type: 'depends_on' },
      { sourceId: 'c', targetId: 'b', type: 'depends_on' },
      { sourceId: 'c', targetId: 'a', type: 'depends_on' },
    ];
    expect(ids(traverse(diamond, 'a', 'impacted', 5))).toEqual(['b@1', 'c@1']);
  });

  it('survives cycles and never returns the root', () => {
    const loop: Edge[] = [
      { sourceId: 'a', targetId: 'b', type: 'depends_on' },
      { sourceId: 'b', targetId: 'c', type: 'depends_on' },
      { sourceId: 'c', targetId: 'a', type: 'depends_on' },
    ];
    expect(ids(traverse(loop, 'a', 'impacted', 5))).toEqual(['b@2', 'c@1']);
    expect(ids(traverse(loop, 'a', 'dependsOn', 5))).toEqual(['b@1', 'c@2']);
  });

  it('labels each found CI against its parent, from the found CI’s point of view', () => {
    expect(impactChildDirection('depends_on', 'impacted')).toBe('outgoing'); // app depends on db
    expect(impactChildDirection('contains', 'impacted')).toBe('incoming'); // host contained in rack
    expect(impactChildDirection('depends_on', 'dependsOn')).toBe('incoming'); // db used by app
    expect(impactChildDirection('contains', 'dependsOn')).toBe('outgoing'); // rack contains host
  });
});
