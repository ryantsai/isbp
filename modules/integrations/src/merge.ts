/**
 * The per-field three-way merge (docs/architecture.md §12.3). Pure: the engine converts values and does the
 * I/O; this file decides, for one mapped field, what changed since the last agreed value (the snapshot) and
 * what to do about it.
 *
 * The snapshot keeps the last agreed value in both forms: `l` (as ISBP stores it) and `r` (as the remote
 * system returned it). Comparing each side with its own form is what makes lossy conversions (HTML →
 * Markdown), echoes of our own writes, replays and duplicate webhooks harmless.
 */
import { type ConflictPolicy, type Direction, type FieldType, isEmpty, type MappingDirection } from './model';

/** One mapped field's last agreed value, in local (`l`) and remote (`r`) form. */
export interface SnapshotEntry {
  l: unknown;
  r: unknown;
}

/** Field key (local) → last agreed values. */
export type Snapshot = Record<string, SnapshotEntry>;

/* ───────────────────────────── normalization ───────────────────────────── */

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+$/u, ''))
    .join('\n')
    .trim();
};

const stable = (v: unknown): string => {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
};

const tagsOf = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[;,]/) : [];
  return [
    ...new Set(
      list.map((x) => (typeof x === 'string' ? x : String(x ?? '')).trim().toLowerCase()).filter(Boolean),
    ),
  ].sort();
};

const userKey = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v.trim().toLowerCase();
  if (typeof v === 'object') {
    const u = v as { email?: unknown; id?: unknown; name?: unknown };
    if (typeof u.email === 'string' && u.email.trim()) return u.email.trim().toLowerCase();
    if (typeof u.id === 'string' && u.id.trim()) return `id:${u.id.trim().toLowerCase()}`;
    if (typeof u.name === 'string') return `name:${u.name.trim().toLowerCase()}`;
  }
  return String(v);
};

/**
 * A canonical form for comparing values of a field type: trivial differences (trailing spaces, `\r\n`,
 * `null` vs `''`, tag order and case, date-time precision below a second, key order) disappear.
 */
export function normalize(type: FieldType, v: unknown): unknown {
  switch (type) {
    case 'string':
    case 'text':
    case 'markdown':
      return text(v);
    case 'html':
      return text(v)
        .replace(/>\s+</g, '><')
        .replace(/\s+/g, ' ')
        .replace(/<br\s*\/?>/gi, '<br>');
    case 'choice':
      return text(v).toLowerCase();
    case 'number': {
      if (v === null || v === undefined || v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
    }
    case 'boolean':
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'boolean') return v;
      return ['true', '1', 'yes'].includes(String(v).toLowerCase());
    case 'date':
      return typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : v ? String(v) : '';
    case 'datetime': {
      if (v === null || v === undefined || v === '') return null;
      const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
      return Number.isNaN(ms) ? String(v) : Math.floor(ms / 1000);
    }
    case 'tags':
      return tagsOf(v).join('\u0001');
    case 'user':
      return userKey(v);
    case 'parent':
      return v === null || v === undefined ? '' : String(v).trim().toLowerCase();
    case 'json':
      return stable(v);
  }
}

export function sameValue(type: FieldType, a: unknown, b: unknown): boolean {
  return normalize(type, a) === normalize(type, b);
}

/* ───────────────────────────── directions ───────────────────────────── */

export interface FieldTraits {
  readOnly?: boolean;
  createOnly?: boolean;
}

/**
 * Which ways one mapping can sync, given the profile's direction, the row's own direction and the two
 * fields: a read-only local field is never written by a pull; a read-only remote field is never pushed.
 * Create-only fields can only be set when the record is created (`onCreate`).
 */
export function effectiveDirections(
  profile: Direction,
  row: MappingDirection,
  local: FieldTraits,
  remote: FieldTraits,
  opts: { remoteUpdatable: boolean; onCreate?: boolean } = { remoteUpdatable: true },
): { canPull: boolean; canPush: boolean } {
  const pullWanted = profile !== 'push' && row !== 'push';
  const pushWanted = profile !== 'pull' && row !== 'pull';
  return {
    canPull: pullWanted && !local.readOnly && (opts.onCreate || !local.createOnly),
    canPush:
      pushWanted && !remote.readOnly && (opts.onCreate || (opts.remoteUpdatable && !remote.createOnly)),
  };
}

/* ───────────────────────────── the decision ───────────────────────────── */

/**
 * - `same`: nothing to write (unchanged, or both sides changed to the same value);
 * - `pull`: write the remote value locally;
 * - `push`: send the local value to the remote system;
 * - `conflict`: both changed differently and the policy is `manual`;
 * - `ignore`: a side changed that this mapping doesn't carry (one-way); accept it as the new base.
 */
export type FieldAction = 'same' | 'pull' | 'push' | 'conflict' | 'ignore';

export interface FieldDecisionInput {
  localType: FieldType;
  remoteType: FieldType;
  /** The last agreed values; undefined when this field was never agreed (new link or new mapping). */
  snap: SnapshotEntry | undefined;
  /** Current local value (local form). */
  local: unknown;
  /** Current remote value (remote form). */
  remote: unknown;
  /** The remote value converted to local form, to see whether both sides already agree. */
  remoteAsLocal: unknown;
  canPull: boolean;
  canPush: boolean;
  policy: ConflictPolicy;
  /** Which side's record was updated last (for `newest`); ties go to the remote side. */
  newer: 'local' | 'remote';
}

export interface FieldDecision {
  action: FieldAction;
  localChanged: boolean;
  remoteChanged: boolean;
  /**
   * The snapshot entry after the action, when the engine can know it now (`same`, `ignore`). For `pull` the
   * engine stores the converted value it wrote; for `push` the value the remote system returned; `conflict`
   * keeps the old base.
   */
  snap: SnapshotEntry | null;
}

/**
 * Decides one field. A field never agreed before (no snapshot) counts as changed on each side that has a
 * value, so filling an empty side is never a conflict.
 */
export function decideField(i: FieldDecisionInput): FieldDecision {
  let localChanged: boolean;
  let remoteChanged: boolean;
  if (i.snap) {
    localChanged = !sameValue(i.localType, i.local, i.snap.l);
    remoteChanged = !sameValue(i.remoteType, i.remote, i.snap.r);
  } else {
    localChanged = !isEmpty(i.local);
    remoteChanged = !isEmpty(i.remote);
  }
  const agreed = { l: i.local, r: i.remote };
  if (!localChanged && !remoteChanged)
    return { action: 'same', localChanged, remoteChanged, snap: i.snap ? null : agreed };

  // Both sides already hold the same value (converged edits, or a first link of identical records).
  if (sameValue(i.localType, i.local, i.remoteAsLocal))
    return { action: 'same', localChanged, remoteChanged, snap: agreed };

  const keep = (side: 'local' | 'remote'): FieldDecision => ({
    action: 'ignore',
    localChanged,
    remoteChanged,
    snap:
      side === 'remote'
        ? { l: i.snap ? i.snap.l : i.local, r: i.remote }
        : { l: i.local, r: i.snap ? i.snap.r : i.remote },
  });

  if (remoteChanged && !localChanged)
    return i.canPull ? { action: 'pull', localChanged, remoteChanged, snap: null } : keep('remote');
  if (localChanged && !remoteChanged)
    return i.canPush ? { action: 'push', localChanged, remoteChanged, snap: null } : keep('local');

  // Both changed, to different values.
  if (i.canPull && !i.canPush) return { action: 'pull', localChanged, remoteChanged, snap: null };
  if (i.canPush && !i.canPull) return { action: 'push', localChanged, remoteChanged, snap: null };
  if (!i.canPull && !i.canPush) return { action: 'ignore', localChanged, remoteChanged, snap: agreed };
  switch (i.policy) {
    case 'remote':
      return { action: 'pull', localChanged, remoteChanged, snap: null };
    case 'local':
      return { action: 'push', localChanged, remoteChanged, snap: null };
    case 'newest':
      return {
        action: i.newer === 'local' ? 'push' : 'pull',
        localChanged,
        remoteChanged,
        snap: null,
      };
    case 'manual':
      return { action: 'conflict', localChanged, remoteChanged, snap: null };
  }
}

/** `local` when the local record was updated strictly after the remote one. */
export function newerSide(
  localUpdatedAt: string | null | undefined,
  remoteUpdatedAt: string | null | undefined,
) {
  const l = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
  const r = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : Number.NaN;
  if (Number.isNaN(l)) return 'remote' as const;
  if (Number.isNaN(r)) return 'local' as const;
  return l > r ? ('local' as const) : ('remote' as const);
}

/* ───────────────────────────── cursor ───────────────────────────── */

/**
 * The cursor a pull may store after a page: past every fully handled item. While items of an earlier page
 * are deferred (waiting for their parent), the cursor stays before the first such page, so a crash replays
 * them (already-handled items are skipped by their version).
 */
export class CursorTracker {
  private safe: string | null;
  private latest: string | null;
  private holdBefore: string | null | undefined = undefined;

  constructor(start: string | null) {
    this.safe = start;
    this.latest = start;
  }

  /** Call after each page with the cursor `changes()` returned and whether some of its items were deferred. */
  page(next: string | null, deferredOnThisPage: boolean): string | null {
    if (deferredOnThisPage && this.holdBefore === undefined) this.holdBefore = this.latest;
    this.latest = next ?? this.latest;
    this.safe = this.holdBefore === undefined ? this.latest : this.holdBefore;
    return this.safe;
  }

  /** Deferred items are done: everything read so far is handled. */
  release(): string | null {
    this.holdBefore = undefined;
    this.safe = this.latest;
    return this.safe;
  }

  /** The cursor to store. */
  get value(): string | null {
    return this.safe;
  }

  /** The cursor to read the next page from. */
  get read(): string | null {
    return this.latest;
  }
}
