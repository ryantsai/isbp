/**
 * The CMDB's vocabulary and its pure rules (no I/O): shared by the API, the web pages, other modules
 * reading `cmdb.*` tables (ITSM) and the unit tests.
 */

export const CI_STATUSES = ['planned', 'in_use', 'maintenance', 'retired'] as const;
export type CiStatus = (typeof CI_STATUSES)[number];

export const CI_ENVIRONMENTS = ['production', 'staging', 'test', 'development'] as const;
export type CiEnvironment = (typeof CI_ENVIRONMENTS)[number];

/** Highest first — list sorting by criticality follows this order. */
export const CI_CRITICALITIES = ['critical', 'high', 'medium', 'low'] as const;
export type CiCriticality = (typeof CI_CRITICALITIES)[number];

/** Class of the CIs end users see (the "affected service" picker) and impact analysis highlights. */
export const BUSINESS_SERVICE_CLASS = 'business-service';

/** System classes, installed by migration; they can be renamed but never deleted. */
export const SYSTEM_CLASSES = [
  'business-service',
  'application',
  'server',
  'database',
  'network-device',
  'storage',
  'cloud-resource',
  'end-user-device',
  'other',
] as const;

/** The list page's quick tabs. Classes admins add only appear under "All". */
export const CI_VIEWS = {
  services: ['business-service'],
  applications: ['application'],
  infrastructure: ['server', 'database', 'network-device', 'storage', 'cloud-resource'],
} as const satisfies Record<string, readonly string[]>;
export type CiView = keyof typeof CI_VIEWS;

/** `CI-00042`. */
export function formatCiNumber(n: number): string {
  return `CI-${String(n).padStart(5, '0')}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_RE = /^CI-?(\d{1,12})$/i;

/** A CI reference from a URL or a person: its uuid, or its number (`CI-00042`, `ci-42`). */
export function parseCiRef(ref: string): { id: string } | { number: number } | null {
  const value = ref.trim();
  if (UUID_RE.test(value)) return { id: value.toLowerCase() };
  const m = NUMBER_RE.exec(value);
  if (m) {
    const n = Number(m[1]);
    return Number.isSafeInteger(n) && n > 0 ? { number: n } : null;
  }
  return null;
}

/* ───────────────────────────── relationships ───────────────────────────── */

/** Typed, directional links: `source —type→ target`, read "source <forward> target". */
export const RELATIONSHIP_TYPES = ['depends_on', 'runs_on', 'connects_to', 'contains', 'backs_up'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** `outgoing`: this CI is the source; `incoming`: this CI is the target. */
export type RelationDirection = 'outgoing' | 'incoming';

/**
 * English labels per type: `forward` reads from the source ("app depends on db"), `reverse` from the
 * target ("db is used by app"). The web app shows the translated catalog entries
 * (`relationships.<type>.forward|reverse`); these are for logs, AI tools and tests.
 */
export const RELATIONSHIP_LABELS: Record<RelationshipType, { forward: string; reverse: string }> = {
  depends_on: { forward: 'depends on', reverse: 'used by' },
  runs_on: { forward: 'runs on', reverse: 'hosts' },
  connects_to: { forward: 'connects to', reverse: 'connected from' },
  contains: { forward: 'contains', reverse: 'contained in' },
  backs_up: { forward: 'backs up', reverse: 'backed up by' },
};

/** The label of a relationship from one CI's point of view. */
export function relationshipLabel(type: RelationshipType, direction: RelationDirection): string {
  return RELATIONSHIP_LABELS[type][direction === 'outgoing' ? 'forward' : 'reverse'];
}

export type RelationshipProblem = 'self' | 'duplicate' | 'cycle';

/**
 * Why a new relationship is refused, or `null` when it is fine. The facts come from the database:
 * whether the same (source, target, type) exists, and which CIs the target already (transitively)
 * contains — `source contains target` would close a containment loop if the source is among them.
 */
export function relationshipProblem(
  input: { sourceId: string; targetId: string; type: RelationshipType },
  facts: { duplicate: boolean; containedInTarget: ReadonlySet<string> },
): RelationshipProblem | null {
  if (input.sourceId === input.targetId) return 'self';
  if (facts.duplicate) return 'duplicate';
  if (input.type === 'contains' && facts.containedInTarget.has(input.sourceId)) return 'cycle';
  return null;
}

/* ───────────────────────────── impact analysis ───────────────────────────── */

/**
 * An outage of X impacts every CI that (transitively) depends on X, runs on X or is contained in X.
 * For an edge `source —type→ target`:
 *  - `depends_on`, `runs_on`: a failing **target** impacts the source;
 *  - `contains`: a failing **source** impacts the target.
 * `connects_to` and `backs_up` don't propagate failures.
 */
export const IMPACT_FROM_TARGET = ['depends_on', 'runs_on'] as const satisfies readonly RelationshipType[];
export const IMPACT_FROM_SOURCE = ['contains'] as const satisfies readonly RelationshipType[];

export const MAX_IMPACT_DEPTH = 5;

/** `impacted`: upstream, what breaks if the CI breaks. `dependsOn`: downstream, what the CI needs. */
export type ImpactDirection = 'impacted' | 'dependsOn';

export interface Edge {
  sourceId: string;
  targetId: string;
  type: RelationshipType;
}

export interface TraversalNode {
  id: string;
  /** 1 = directly linked to the root. */
  depth: number;
  /** Type of the edge that reached this node. */
  edgeType: RelationshipType;
  /** The node it was reached from (the root at depth 1). */
  parentId: string;
}

const fromTarget = new Set<RelationshipType>(IMPACT_FROM_TARGET);
const fromSource = new Set<RelationshipType>(IMPACT_FROM_SOURCE);

/** The CI an edge leads to when walking in `direction` from `from`, or null if it doesn't apply. */
export function impactStep(edge: Edge, from: string, direction: ImpactDirection): string | null {
  const up = direction === 'impacted';
  if (fromTarget.has(edge.type)) {
    if (up && edge.targetId === from) return edge.sourceId;
    if (!up && edge.sourceId === from) return edge.targetId;
  }
  if (fromSource.has(edge.type)) {
    if (up && edge.sourceId === from) return edge.targetId;
    if (!up && edge.targetId === from) return edge.sourceId;
  }
  return null;
}

/**
 * How a CI found by impact analysis is linked to its parent (the CI one level closer to the analysed
 * one), from the found CI's point of view: an impacted app "depends on" its parent, a VM impacted by its
 * rack is "contained in" it, a database the app needs is "used by" it.
 */
export function impactChildDirection(type: RelationshipType, direction: ImpactDirection): RelationDirection {
  return (direction === 'impacted') === fromTarget.has(type) ? 'outgoing' : 'incoming';
}

/**
 * Reference semantics of impact analysis, breadth first: every reachable CI once, at its shortest
 * depth, never the root, cycle-safe and depth-limited. The API runs the same rules as a recursive CTE.
 */
export function traverse(
  edges: readonly Edge[],
  rootId: string,
  direction: ImpactDirection,
  maxDepth: number,
): TraversalNode[] {
  const depthLimit = Math.max(1, Math.min(MAX_IMPACT_DEPTH, Math.floor(maxDepth)));
  const seen = new Set([rootId]);
  const out: TraversalNode[] = [];
  let frontier = [rootId];
  for (let depth = 1; depth <= depthLimit && frontier.length; depth++) {
    const next: string[] = [];
    for (const from of frontier) {
      for (const edge of edges) {
        const to = impactStep(edge, from, direction);
        if (!to || seen.has(to)) continue;
        seen.add(to);
        next.push(to);
        out.push({ id: to, depth, edgeType: edge.type, parentId: from });
      }
    }
    frontier = next;
  }
  return out;
}
