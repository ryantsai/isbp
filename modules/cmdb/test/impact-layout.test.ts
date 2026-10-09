import { describe, expect, it } from 'vitest';
import type { CiRef, ImpactNode } from '../src/contracts';
import {
  fitText,
  layoutImpact,
  NODE_H,
  NODE_W,
  nodesPerRow,
  PAD,
  pathToRoot,
} from '../src/web/impact-layout';

const ci = (id: string, classKey = 'server'): CiRef => ({
  id,
  number: 1,
  reference: `CI-${id}`,
  name: id,
  class: { key: classKey, name: { en: classKey }, icon: 'server' },
  status: 'in_use',
  environment: 'production',
  criticality: 'high',
});
const node = (id: string, depth: number, parentId: string, isService = false): ImpactNode => ({
  ci: ci(id, isService ? 'business-service' : 'server'),
  depth,
  edgeType: 'depends_on',
  parentId,
  isService,
});

describe('impact graph layout', () => {
  const layout = layoutImpact({
    root: ci('root'),
    impacted: [node('a', 1, 'root'), node('b', 1, 'root'), node('svc', 2, 'b', true), node('x', 2, 'a')],
    dependsOn: [node('db', 1, 'root')],
  });
  const at = (key: string) => layout.nodes.find((n) => n.key === key)!;

  it('puts impacted CIs above, the CI in the middle and dependencies below', () => {
    expect(at('impacted:svc').y).toBeLessThan(at('impacted:a').y);
    expect(at('impacted:a').y).toBeLessThan(at('root:root').y);
    expect(at('root:root').y).toBeLessThan(at('dependsOn:db').y);
  });

  it('keeps children under their parents and never overlaps nodes in a row', () => {
    expect(at('impacted:x').x).toBeLessThan(at('impacted:svc').x);
    for (const row of new Set(layout.nodes.map((n) => n.row))) {
      const xs = layout.nodes
        .filter((n) => n.row === row)
        .map((n) => n.x)
        .sort((p, q) => p - q);
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(NODE_W);
    }
    expect(Math.max(...layout.nodes.map((n) => n.x + NODE_W))).toBeLessThanOrEqual(layout.width);
  });

  it('draws one edge per found CI, read from the upper node', () => {
    expect(layout.edges).toHaveLength(5);
    const svc = layout.edges.find((e) => e.key === 'impacted:svc')!;
    expect([svc.upper.key, svc.lower.key, svc.child, svc.direction]).toEqual([
      'impacted:svc',
      'impacted:b',
      'upper',
      'outgoing',
    ]);
    const db = layout.edges.find((e) => e.key === 'dependsOn:db')!;
    expect([db.upper.key, db.lower.key, db.direction]).toEqual(['root:root', 'dependsOn:db', 'outgoing']);
  });

  it('wraps wide levels onto extra rows, the first one nearest the analysed CI', () => {
    const wide = layoutImpact(
      {
        root: ci('r'),
        impacted: ['a', 'b', 'c', 'd', 'e'].map((id) => node(id, 1, 'r')),
        dependsOn: ['p', 'q', 'r2'].map((id) => node(id, 1, 'r')),
      },
      2,
    );
    const pos = (key: string) => wide.nodes.find((n) => n.key === key)!;
    expect(new Set(wide.nodes.map((n) => n.row)).size).toBe(6);
    expect(pos('impacted:e').y).toBeLessThan(pos('impacted:c').y);
    expect(pos('impacted:c').y).toBeLessThan(pos('impacted:a').y);
    expect(pos('impacted:a').y).toBe(pos('impacted:b').y);
    expect(pos('dependsOn:p').y).toBeLessThan(pos('dependsOn:r2').y);
    expect(wide.width).toBeLessThanOrEqual(2 * NODE_W + 200);
    expect(nodesPerRow(1000)).toBe(4);
    expect(nodesPerRow(343)).toBe(2);
  });

  it('handles a CI with no relationships', () => {
    const lonely = layoutImpact({ root: ci('r'), impacted: [], dependsOn: [] });
    expect(lonely.nodes).toHaveLength(1);
    expect(lonely.edges).toHaveLength(0);
    expect(lonely.bands).toEqual([]);
  });

  it('labels the two sides right above and right below the analysed CI, clear of every node', () => {
    const root = at('root:root');
    expect(layout.bands.map((b) => [b.side, b.count])).toEqual([
      ['impacted', 4],
      ['dependsOn', 1],
    ]);
    const [up, down] = layout.bands;
    // "Affected if it fails" sits between the first impacted row and the CI; "Depends on" between the CI and its
    // first dependency row. The 22 px label must not touch a node.
    expect(up!.y).toBeLessThan(root.y - 11);
    expect(up!.y).toBeGreaterThan(at('impacted:a').y + NODE_H + 11);
    expect(down!.y).toBeGreaterThan(root.y + NODE_H + 11);
    expect(down!.y).toBeLessThan(at('dependsOn:db').y - 11);
    // Labels start at the left edge, where edges never run (they leave the CI from its centre).
    expect(root.x + NODE_W / 2).toBeGreaterThan(PAD + 150);
  });

  it('only labels the sides that have CIs, and keeps room for the labels on a one-column graph', () => {
    const chain = layoutImpact({ root: ci('r'), impacted: [node('up', 1, 'r')], dependsOn: [] });
    expect(chain.bands.map((b) => b.side)).toEqual(['impacted']);
    expect(chain.width).toBeGreaterThanOrEqual(2 * NODE_W + 2 * PAD);
  });

  it('finds the path from a CI back to the analysed CI', () => {
    expect([...pathToRoot(layout, 'impacted:svc')]).toEqual(['impacted:svc', 'impacted:b', 'root:root']);
    expect([...pathToRoot(layout, 'dependsOn:db')]).toEqual(['dependsOn:db', 'root:root']);
    expect(pathToRoot(layout, null).size).toBe(0);
    expect(pathToRoot(layout, 'nope').size).toBe(0);
  });

  it('shortens long names, counting wide characters double', () => {
    expect(fitText('tpe-sw-core-01', 18)).toBe('tpe-sw-core-01');
    expect(fitText('Active Directory Domain Services', 18)).toBe('Active Directory D…');
    expect(fitText('財務會計系統正式環境主機', 10)).toBe('財務會計系…');
  });
});
