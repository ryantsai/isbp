/**
 * Permission keys are `module.resource.action` (e.g. `core.users.update`).
 * Role patterns may use `*` per segment; a trailing `*` also matches every remaining segment:
 *   `*` · `core.*` · `core.users.*` · `*.*.read`
 */
export const PERMISSION_KEY_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
export const PERMISSION_PATTERN_RE = /^(\*|[a-z][a-z0-9-]*)(\.(\*|[a-z][a-z0-9-]*)){0,2}$/;

export function isPermissionKey(value: string): boolean {
  return PERMISSION_KEY_RE.test(value);
}

export function isPermissionPattern(value: string): boolean {
  return PERMISSION_PATTERN_RE.test(value);
}

export function matchPermission(pattern: string, key: string): boolean {
  if (pattern === key || pattern === '*') return true;
  const p = pattern.split('.');
  const k = key.split('.');
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg === '*' && i === p.length - 1) return k.length > i;
    if (i >= k.length) return false;
    if (seg !== '*' && seg !== k[i]) return false;
  }
  return p.length === k.length;
}

/** Expands a trailing `*` to fill three segments; returns null for patterns that match nothing. */
function normalizePattern(pattern: string): string[] | null {
  const segs = pattern.split('.');
  if (segs[segs.length - 1] === '*') while (segs.length < 3) segs.push('*');
  return segs.length === 3 ? segs : null;
}

/**
 * True when every key matched by `pattern` is also matched by `grant` — used to stop users from
 * granting permissions they do not hold themselves (privilege-escalation guard).
 */
export function patternCovers(grant: string, pattern: string): boolean {
  const p = normalizePattern(pattern);
  if (!p) return true;
  const g = normalizePattern(grant);
  if (!g) return false;
  return g.every((seg, i) => seg === '*' || seg === p[i]);
}

export type ScopeType = 'global' | 'department' | 'record';

/**
 * A compiled grant. Department grants carry the full subtree of department ids so checks are O(1)
 * and need no database access.
 */
export type Grant =
  { p: string; s: 'g' } | { p: string; s: 'd'; d: string[] } | { p: string; s: 'r'; t: string; id: string };

/** What a check is about. Omit for "anywhere" checks on global resources. */
export interface ResourceScope {
  departmentId?: string | null;
  recordType?: string;
  recordId?: string;
}

/** Resolved reach of one permission, used to filter list queries. */
export interface PermissionReach {
  global: boolean;
  departmentIds: string[];
  records: { type: string; id: string }[];
}

export class PermissionSet {
  readonly grants: readonly Grant[];

  constructor(grants: readonly Grant[]) {
    this.grants = grants;
  }

  static empty(): PermissionSet {
    return new PermissionSet([]);
  }

  /**
   * True when a grant matches `permission` for the given resource.
   * Without a resource, only global grants count — use {@link hasAny} for "somewhere" checks.
   */
  can(permission: string, resource?: ResourceScope): boolean {
    for (const g of this.grants) {
      if (!matchPermission(g.p, permission)) continue;
      if (g.s === 'g') return true;
      if (!resource) continue;
      if (g.s === 'd' && resource.departmentId && g.d.includes(resource.departmentId)) return true;
      if (g.s === 'r' && resource.recordType === g.t && resource.recordId === g.id) return true;
    }
    return false;
  }

  /** True when the permission is granted at any scope (navigation, button visibility). */
  hasAny(permission: string): boolean {
    return this.grants.some((g) => matchPermission(g.p, permission));
  }

  reach(permission: string): PermissionReach {
    const reach: PermissionReach = { global: false, departmentIds: [], records: [] };
    const departments = new Set<string>();
    for (const g of this.grants) {
      if (!matchPermission(g.p, permission)) continue;
      if (g.s === 'g') reach.global = true;
      else if (g.s === 'd') g.d.forEach((id) => departments.add(id));
      else reach.records.push({ type: g.t, id: g.id });
    }
    reach.departmentIds = [...departments];
    return reach;
  }

  toJSON(): readonly Grant[] {
    return this.grants;
  }
}
