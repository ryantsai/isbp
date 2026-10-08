/**
 * Text templates for process actions: `{{data.title}}`, `{{records.cis.criticality}}`, `{{request.reference}}`.
 * A placeholder is a dotted path into a context object — never evaluated: no expressions, no filters, no calls.
 * Unknown paths render empty; lists are joined with ", "; a table's rows (a list of objects) render one line per row
 * with the cells joined by " · "; other objects become JSON (capped).
 */

/** `{{ path }}`: a dotted path of names or list indexes (`data.title`, `records.cis.owner`, `data.items.0`). */
export const TEMPLATE_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const PATH_RE = /^[A-Za-z_][\w-]*(\.[\w-]+){0,7}$/;
/** Never followed, so a template can't reach into prototypes. */
const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_VALUE = 10_000;
const MAX_OUTPUT = 100_000;

export interface RenderTemplateOptions {
  /** Applied to every substituted value, e.g. `jsonEscape` inside a JSON body. */
  escape?: (value: string) => string;
}

/** Escapes a value for use inside a JSON string literal (`"{{data.title}}"` stays valid JSON). */
export const jsonEscape = (value: string): string => JSON.stringify(value).slice(1, -1);

/** The value at a dotted path (own properties only), or `undefined`. */
export function templateValue(context: unknown, path: string): unknown {
  if (!PATH_RE.test(path)) return undefined;
  let cur: unknown = context;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || BLOCKED.has(seg)) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(seg)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/**
 * A table's rows (a list of plain objects), one line per row with the cells joined by " · " (`443 · TCP · allow`).
 * Cells are strings, numbers, booleans or lists of them; an object cell is left out.
 */
function rowLines(rows: readonly Record<string, unknown>[], depth: number): string {
  return rows
    .map((row) =>
      Object.values(row)
        .map((cell) => (isPlainObject(cell) ? '' : stringify(cell, depth + 1)))
        .filter(Boolean)
        .join(' · '),
    )
    .filter(Boolean)
    .join('\n');
}

function stringify(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (Array.isArray(value)) {
    if (depth > 2) return '';
    if (value.length && value.every(isPlainObject)) return rowLines(value, depth);
    return value
      .map((v) => stringify(v, depth + 1))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Replaces each `{{path}}` in `template` with the value at that path in `context`. Nothing is evaluated: a
 * placeholder that is not a plain path, or that points nowhere, renders as an empty string.
 */
export function renderTemplate(template: string, context: unknown, opts: RenderTemplateOptions = {}): string {
  const out = template.replace(TEMPLATE_RE, (_m, path: string) => {
    const text = stringify(templateValue(context, path)).slice(0, MAX_VALUE);
    return opts.escape ? opts.escape(text) : text;
  });
  return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) : out;
}

/**
 * Renders the templates in every string of a configuration object (recursively through objects and lists);
 * numbers, booleans and other values are returned as they are. Keys in `skip` (top level) are left untouched.
 */
export function renderTemplates<T>(
  value: T,
  context: unknown,
  opts: RenderTemplateOptions & { skip?: readonly string[] } = {},
): T {
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return renderTemplate(v, context, opts);
    if (depth > 10 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>))
      out[k] = depth === 0 && opts.skip?.includes(k) ? x : walk(x, depth + 1);
    return out;
  };
  return walk(value, 0) as T;
}

/** The paths a template refers to, in order (for "unknown value" hints in builders). */
export function templatePaths(template: string): string[] {
  return [...template.matchAll(TEMPLATE_RE)].map((m) => m[1]!).filter((p) => PATH_RE.test(p));
}
