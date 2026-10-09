import { type ItemOp, REF_PREFIX } from '../contracts';
import { refsIn } from './refs';

/**
 * How the items of a change set (or a package) hang together, so a person can read a set of 59 changes as the
 * processes it builds: which items refer to which, what removing one would break, and the groups the change set page
 * and the process packs page show ("Firewall rule change: form + approval + yearly review", "Shared by several
 * processes", "Other changes"). Pure: the API (removing an item with its dependents) and the web share it.
 */

/** What the functions here need of an item (a change set item, or a package item with an index as its id). */
export interface PlanItem {
  id: string;
  position: number;
  ref: string | null;
  kind: string;
  op: ItemOp;
  targetId: string | null;
  label: string;
  value: unknown;
}

/** A process is a request form (with its approval, the schedules that assign it…): the kind that anchors a group. */
export const PROCESS_KIND = 'core.form';
/** An approval workflow that belongs to one process counts as part of it, not on its own. */
export const WORKFLOW_KIND = 'core.workflow';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The key an item creates or changes (`value.key`), which later items may name instead of a `$ref`. */
function keyOf(item: PlanItem): string | null {
  if (item.op !== 'create' && item.op !== 'update') return null;
  const key = isRecord(item.value) ? item.value.key : undefined;
  return typeof key === 'string' && key ? key : null;
}

/** `core.group` → `group`, `core.custom-field` → `field`: the noun a property such as `groupKey` names. */
function nounOf(kind: string): string {
  const name = kind.slice(kind.indexOf('.') + 1);
  return name.split('-').pop()!.toLowerCase();
}

/**
 * Keys a value names, by the noun of the property that holds them: `{ groupKey: 'x' }`, `{ groupKeys: ['x'] }`,
 * `{ formKey: 'y' }`, `{ defaultGroupKey: 'z' }` → `group: {x, z}`, `form: {y}`. Package items name groups and forms
 * by key where the platform stores keys (approvers, audiences, the forms a schedule assigns), and by `$ref` where it
 * stores ids (R55).
 */
function namedKeys(value: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (noun: string, key: unknown) => {
    if (typeof key !== 'string' || !key) return;
    const set = out.get(noun) ?? new Set<string>();
    set.add(key);
    out.set(noun, set);
  };
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRecord(v))
      for (const [prop, x] of Object.entries(v)) {
        const m = /([A-Za-z]+?)Keys?$/.exec(prop);
        if (m) {
          // The last word of the property's name before Key(s): `defaultGroupKey` → `group`.
          const words = m[1]!.split(/(?=[A-Z])/);
          const noun = words[words.length - 1]!.toLowerCase();
          if (Array.isArray(x)) x.forEach((k) => add(noun, k));
          else add(noun, x);
        }
        walk(x);
      }
  };
  walk(value);
  return out;
}

/**
 * Which items each item refers to (ids): `"$ref:<name>"` in its value or target, or a key an earlier item of the set
 * creates, named by a property for that kind of object (`groupKey` for a group).
 */
export function dependencies(items: readonly PlanItem[]): Map<string, Set<string>> {
  const byRef = new Map<string, PlanItem>();
  const byKey = new Map<string, PlanItem>();
  for (const i of items) {
    if (i.ref) byRef.set(i.ref, i);
    const key = keyOf(i);
    if (key) byKey.set(`${nounOf(i.kind)}\u0000${key}`, i);
  }
  const out = new Map<string, Set<string>>();
  for (const item of items) {
    const deps = new Set<string>();
    for (const r of [...refsIn(item.value), ...refsIn(item.targetId)]) {
      const target = byRef.get(r);
      if (target && target.id !== item.id) deps.add(target.id);
    }
    for (const [noun, keys] of namedKeys(item.value))
      for (const key of keys) {
        const target = byKey.get(`${noun}\u0000${key}`);
        if (target && target.id !== item.id && target.position < item.position) deps.add(target.id);
      }
    out.set(item.id, deps);
  }
  return out;
}

/** The reverse of {@link dependencies}: which items refer to each item. */
export function dependents(items: readonly PlanItem[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(items.map((i) => [i.id, new Set<string>()]));
  for (const [from, deps] of dependencies(items)) for (const to of deps) out.get(to)?.add(from);
  return out;
}

/**
 * The items that stop working when `itemId` is removed: those that refer to it, and those that refer to them, in
 * the order they apply. Removing an item "with what depends on it" removes these too.
 */
export function dependentsOf(items: readonly PlanItem[], itemId: string): PlanItem[] {
  const reverse = dependents(items);
  const found = new Set<string>();
  const queue = [itemId];
  while (queue.length) {
    for (const d of reverse.get(queue.shift()!) ?? [])
      if (d !== itemId && !found.has(d)) {
        found.add(d);
        queue.push(d);
      }
  }
  return items.filter((i) => found.has(i.id)).sort((a, b) => a.position - b.position);
}

export type ItemGroupType = 'process' | 'shared' | 'other';

/** A group of items as the change set page shows them. */
export interface ItemGroup {
  /** `process:<anchor item id>`, `shared` or `other`. */
  id: string;
  type: ItemGroupType;
  /** The request form the process is built around (`process` only). */
  anchorId: string | null;
  /** Item ids in the order they apply. */
  itemIds: string[];
}

export interface ItemGrouping {
  /** Shared items first (they apply first), then each process in order, then the rest. */
  groups: ItemGroup[];
  /** The process (`process:<id>`) or `shared`/`other` group of each item. */
  groupOf: Map<string, string>;
}

/**
 * Groups items by process. Each request form anchors a process. An item joins a process when everything that refers
 * to it belongs to that process (the form's approval workflow, a group only its workflow names), or when it refers
 * to that process and nothing refers to it (a schedule that assigns the form). Items several processes use (groups,
 * categories) are "shared"; the rest (a custom field, a workflow for tickets) are "other".
 */
export function groupByProcess(items: readonly PlanItem[]): ItemGrouping {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const deps = dependencies(sorted);
  const reverse = dependents(sorted);
  const owner = new Map<string, string>();
  for (const i of sorted)
    if (i.kind === PROCESS_KIND && (i.op === 'create' || i.op === 'update')) owner.set(i.id, i.id);

  for (let changed = owner.size > 0; changed;) {
    changed = false;
    for (const item of sorted) {
      if (owner.has(item.id)) continue;
      const up = new Set(
        [...(deps.get(item.id) ?? [])].flatMap((d) => (owner.has(d) ? [owner.get(d)!] : [])),
      );
      const down = [...(reverse.get(item.id) ?? [])];
      let anchor: string | null = null;
      if (down.length) {
        if (down.every((d) => owner.has(d))) {
          const anchors = new Set(down.map((d) => owner.get(d)!));
          const [only] = anchors;
          if (anchors.size === 1 && [...up].every((a) => a === only)) anchor = only!;
        }
      } else if (up.size === 1) anchor = [...up][0]!;
      if (anchor) {
        owner.set(item.id, anchor);
        changed = true;
      }
    }
  }

  const groupOf = new Map<string, string>();
  const processes = new Map<string, ItemGroup>();
  const shared: ItemGroup = { id: 'shared', type: 'shared', anchorId: null, itemIds: [] };
  const other: ItemGroup = { id: 'other', type: 'other', anchorId: null, itemIds: [] };
  for (const item of sorted) {
    const anchor = owner.get(item.id);
    if (anchor) {
      const id = `process:${anchor}`;
      let g = processes.get(id);
      if (!g) processes.set(id, (g = { id, type: 'process', anchorId: anchor, itemIds: [] }));
      g.itemIds.push(item.id);
      groupOf.set(item.id, id);
    } else {
      const g = (reverse.get(item.id)?.size ?? 0) > 0 ? shared : other;
      g.itemIds.push(item.id);
      groupOf.set(item.id, g.id);
    }
  }
  // Processes in the order of their forms.
  const ordered = [...processes.values()].sort(
    (a, b) => sorted.findIndex((i) => i.id === a.anchorId) - sorted.findIndex((i) => i.id === b.anchorId),
  );
  return {
    groups: [shared, ...ordered, other].filter((g) => g.itemIds.length > 0),
    groupOf,
  };
}

/**
 * What a set of items adds up to, for "17 processes · 5 groups · 3 categories · 8 schedules": the number of
 * processes, then the other items per kind in the order they first appear — without the approval workflows that are
 * part of a process.
 */
export function countByKind(
  items: readonly PlanItem[],
  grouping: ItemGrouping = groupByProcess(items),
): { processes: number; kinds: { kind: string; count: number }[] } {
  const processes = grouping.groups.filter((g) => g.type === 'process').length;
  const kinds = new Map<string, number>();
  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    if (item.kind === PROCESS_KIND && grouping.groupOf.get(item.id)?.startsWith('process:')) continue;
    if (item.kind === WORKFLOW_KIND && grouping.groupOf.get(item.id)?.startsWith('process:')) continue;
    kinds.set(item.kind, (kinds.get(item.kind) ?? 0) + 1);
  }
  return { processes, kinds: [...kinds].map(([kind, count]) => ({ kind, count })) };
}

/** The approval workflow a form uses, when it is an item of the same set (`workflowId: "$ref:<name>"`). */
export function workflowItemOf<T extends PlanItem>(form: PlanItem, items: readonly T[]): T | null {
  const id = isRecord(form.value) ? form.value.workflowId : undefined;
  if (typeof id !== 'string' || !id.startsWith(REF_PREFIX)) return null;
  const ref = id.slice(REF_PREFIX.length);
  return items.find((i) => i.ref === ref && i.kind === WORKFLOW_KIND) ?? null;
}

/** The request forms of the set that use a workflow item (by `$ref`). */
export function formsUsing<T extends PlanItem>(workflow: PlanItem, items: readonly T[]): T[] {
  if (!workflow.ref) return [];
  return items.filter(
    (i) =>
      i.kind === PROCESS_KIND && isRecord(i.value) && i.value.workflowId === `${REF_PREFIX}${workflow.ref}`,
  );
}

/** Package items (which have no ids) as plan items: their index is their id and position. */
export function planOfPackage(
  items: readonly {
    ref?: string;
    kind: string;
    op: ItemOp;
    targetId?: string | null;
    label?: string;
    value?: unknown;
  }[],
): PlanItem[] {
  return items.map((i, index) => ({
    id: String(index),
    position: index,
    ref: i.ref ?? null,
    kind: i.kind,
    op: i.op,
    targetId: i.op === 'create' ? null : (i.targetId ?? null),
    label: i.label ?? '',
    value: i.value ?? null,
  }));
}
