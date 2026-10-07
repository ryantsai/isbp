import type { CiRef, Impact, ImpactNode } from '../contracts';
import {
  impactChildDirection,
  type ImpactDirection,
  type RelationDirection,
  type RelationshipType,
} from '../model';

export const NODE_W = 184;
export const NODE_H = 56;
export const GAP_X = 28;
/** Vertical gap between dependency levels, and between the wrapped rows of one level. */
export const LEVEL_GAP = 64;
export const WRAP_GAP = 44;
export const PAD = 20;
/** Room above the first row for the pills on node tops. */
const TOP = 10;

export interface PlacedNode {
  /** Unique per side: a CI can be both impacted and a dependency when links loop. */
  key: string;
  side: 'root' | ImpactDirection;
  ci: CiRef;
  node: ImpactNode | null;
  /** Row from the top (wide levels wrap over several rows). */
  row: number;
  x: number;
  y: number;
}

export interface PlacedEdge {
  key: string;
  /** The node drawn higher up and the one below it. */
  upper: PlacedNode;
  lower: PlacedNode;
  /** The found CI's end of the edge (its label sits next to it). */
  child: 'upper' | 'lower';
  type: RelationshipType;
  /** Direction from the upper node's point of view: "upper <label> lower". */
  direction: RelationDirection;
}

export interface ImpactLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

const flip = (d: RelationDirection): RelationDirection => (d === 'outgoing' ? 'incoming' : 'outgoing');

/** How many nodes fit side by side in `width` pixels (at least `min`). */
export function nodesPerRow(width: number, min = 2): number {
  return Math.max(min, Math.floor((width - PAD * 2 + GAP_X) / (NODE_W + GAP_X)));
}

/**
 * Layered layout for the impact graph: impacted CIs above the analysed CI (deepest at the top),
 * dependencies below. A level holds its CIs in order of their parent's position (fewer crossings),
 * business services first, then by name; levels wider than `perRow` wrap onto extra rows, the first
 * row nearest the analysed CI. Pure, so it is unit-tested and stable across renders.
 */
export function layoutImpact(
  impact: Pick<Impact, 'root' | 'impacted' | 'dependsOn'>,
  perRow = 6,
): ImpactLayout {
  const per = Math.max(1, Math.floor(perRow));
  const placed = new Map<string, PlacedNode>();
  const root: PlacedNode = {
    key: `root:${impact.root.id}`,
    side: 'root',
    ci: impact.root,
    node: null,
    row: 0,
    x: 0,
    y: 0,
  };
  placed.set(root.key, root);

  // Order each level after its parents' level.
  const order = new Map<string, number>([[root.key, 0]]);
  const levels: Record<ImpactDirection, PlacedNode[][]> = { impacted: [], dependsOn: [] };
  for (const side of ['impacted', 'dependsOn'] as const) {
    const list = side === 'impacted' ? impact.impacted : impact.dependsOn;
    const maxDepth = Math.max(0, ...list.map((n) => n.depth));
    for (let d = 1; d <= maxDepth; d++) {
      const parentKey = (n: ImpactNode) =>
        d > 1 && placed.has(`${side}:${n.parentId}`) ? `${side}:${n.parentId}` : root.key;
      const level = list
        .filter((n) => n.depth === d)
        .sort(
          (a, b) =>
            (order.get(parentKey(a)) ?? 0) - (order.get(parentKey(b)) ?? 0) ||
            Number(b.isService) - Number(a.isService) ||
            a.ci.name.localeCompare(b.ci.name),
        )
        .map<PlacedNode>((n, i) => {
          const p: PlacedNode = { key: `${side}:${n.ci.id}`, side, ci: n.ci, node: n, row: 0, x: 0, y: 0 };
          order.set(p.key, i);
          placed.set(p.key, p);
          return p;
        });
      levels[side].push(level);
    }
  }

  const chunk = (level: PlacedNode[]) =>
    Array.from({ length: Math.ceil(level.length / per) }, (_, i) => level.slice(i * per, (i + 1) * per));
  // Rows top to bottom, each tagged with its level so wrapped rows sit closer together.
  const rows: { level: string; nodes: PlacedNode[] }[] = [];
  levels.impacted.forEach((level, d) => {
    const wrapped = chunk(level).reverse();
    rows.unshift(...wrapped.map((nodes) => ({ level: `up${d}`, nodes })));
  });
  rows.push({ level: 'root', nodes: [root] });
  levels.dependsOn.forEach((level, d) =>
    rows.push(...chunk(level).map((nodes) => ({ level: `down${d}`, nodes }))),
  );

  const widest = Math.max(...rows.map((r) => r.nodes.length));
  const width = PAD * 2 + widest * NODE_W + Math.max(0, widest - 1) * GAP_X;
  let y = PAD + TOP;
  rows.forEach((r, i) => {
    if (i > 0) y += NODE_H + (r.level === rows[i - 1]!.level ? WRAP_GAP : LEVEL_GAP);
    const rowWidth = r.nodes.length * NODE_W + Math.max(0, r.nodes.length - 1) * GAP_X;
    const start = (width - rowWidth) / 2;
    r.nodes.forEach((n, j) => {
      n.row = i;
      n.x = start + j * (NODE_W + GAP_X);
      n.y = y;
    });
  });

  const edges: PlacedEdge[] = [];
  for (const n of placed.values()) {
    if (!n.node || n.side === 'root') continue;
    const parent = placed.get(n.node.depth === 1 ? root.key : `${n.side}:${n.node.parentId}`) ?? root;
    const childDirection = impactChildDirection(n.node.edgeType, n.side);
    const type = n.node.edgeType;
    edges.push(
      n.side === 'impacted'
        ? { key: n.key, upper: n, lower: parent, child: 'upper', type, direction: childDirection }
        : { key: n.key, upper: parent, lower: n, child: 'lower', type, direction: flip(childDirection) },
    );
  }

  return { width, height: y + NODE_H + PAD, nodes: [...placed.values()], edges };
}

const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Shortens text to roughly `max` narrow characters (CJK and other wide characters count double). */
export function fitText(text: string, max: number): string {
  let units = 0;
  let out = '';
  for (const ch of text) {
    const w = WIDE.test(ch) ? 2 : 1;
    if (units + w > max) return `${out.trimEnd()}…`;
    units += w;
    out += ch;
  }
  return out;
}

/** Approximate rendered width of `text` at `px` font size (for pill backgrounds). */
export function textWidth(text: string, px: number): number {
  let w = 0;
  for (const ch of text) w += WIDE.test(ch) ? px : px * 0.58;
  return Math.ceil(w);
}
