import { REF_PREFIX } from '../contracts';

/**
 * Items of a change set refer to objects created earlier in the same set with the string `"$ref:<name>"` (a form's
 * workflow, a catalog item's form key). At dry-run and apply time each reference becomes the id the referenced item
 * produced.
 */

const refOf = (s: string) => (s.startsWith(REF_PREFIX) ? s.slice(REF_PREFIX.length) : null);

/** Every reference in a value, in order of appearance. */
export function refsIn(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      const r = refOf(v);
      if (r && !out.includes(r)) out.push(r);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

/** The value with every reference replaced by its id; `missing` lists the names that have no id (yet). */
export function resolveRefs(
  value: unknown,
  ids: ReadonlyMap<string, string>,
): { value: unknown; missing: string[] } {
  const missing: string[] = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = refOf(v);
      if (r === null) return v;
      const id = ids.get(r);
      if (id === undefined) {
        if (!missing.includes(r)) missing.push(r);
        return v;
      }
      return id;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), missing };
}

/** The value with `"$ref:<old>"` written as `"$ref:<new>"` for every renamed reference (others unchanged). */
export function renameRefs(value: unknown, names: ReadonlyMap<string, string>): unknown {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = refOf(v);
      return r !== null && names.has(r) ? `${REF_PREFIX}${names.get(r)}` : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

/** `base`, or `base-2`, `base-3`… — the first name not in `taken` (at most 40 characters, like every ref). */
export function uniqueRef(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const name = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

/** A readable name for an object value: `name` (plain or per locale), `label`, `title` or `key`. */
export function labelOf(value: unknown, locale = 'en'): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  for (const key of ['name', 'label', 'title']) {
    const x = v[key];
    if (typeof x === 'string' && x.trim()) return x.trim();
    if (x && typeof x === 'object') {
      const t = x as Record<string, unknown>;
      const text = [t[locale], t.en, t['zh-TW'], t['ja-JP']].find((s) => typeof s === 'string' && s.trim());
      if (typeof text === 'string') return text.trim();
    }
  }
  const field = v.field as Record<string, unknown> | undefined;
  if (field) return labelOf(field, locale);
  for (const key of ['key', 'formKey', 'slug']) if (typeof v[key] === 'string' && v[key]) return v[key];
  return null;
}
