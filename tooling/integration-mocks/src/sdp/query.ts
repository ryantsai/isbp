/**
 * `input_data` and `list_info` as ServiceDesk Plus reads them: paging (`start_index` is 1-based,
 * `row_count` defaults to 10 and caps at 100), sorting and `search_criteria`.
 */
import type { Rec } from './data';

export class SdpInputError extends Error {
  constructor(
    message: string,
    readonly statusCode = 4000,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** `input_data` from the query string (GET) or the form body (POST/PUT); `{}` when absent. */
export function inputData(query: unknown, body: unknown): Record<string, unknown> {
  const raw =
    (body && typeof body === 'object' ? (body as Record<string, unknown>).input_data : undefined) ??
    (query && typeof query === 'object' ? (query as Record<string, unknown>).input_data : undefined);
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new SdpInputError('Invalid input_data: expected a JSON object', 4000, 'input_data');
}

export interface Criterion {
  field?: string;
  condition?: string;
  value?: unknown;
  values?: unknown[];
  logical_operator?: string;
  children?: Criterion[] | Criterion;
}

/** A record's value at a dotted path; `{ value }` times compare by value, `{ name }` lookups by name. */
export function fieldValue(rec: Rec, field: string): unknown {
  let v: unknown = rec;
  for (const k of field.split('.')) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Rec)[k];
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Rec;
    if ('value' in o) return o.value;
    if ('name' in o) return o.name;
  }
  return v;
}

const asNumber = (v: unknown) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};

/** Compares numerically when both sides are numbers, else as case-insensitive strings. */
export function compare(a: unknown, b: unknown): number {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na - nb;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).toLowerCase());

function matchOne(rec: Rec, c: Criterion): boolean {
  if (!c.field || !c.condition) throw new SdpInputError('search_criteria needs a field and a condition');
  const actual = fieldValue(rec, c.field);
  const values = c.values ?? (c.value === undefined ? [] : [c.value]);
  const first = values[0];
  switch (c.condition.trim().toLowerCase()) {
    case 'is':
    case '=':
    case 'eq':
      return values.some((v) => compare(actual, v) === 0);
    case 'is not':
    case '!=':
    case 'neq':
      return values.every((v) => compare(actual, v) !== 0);
    case 'greater than':
    case 'gt':
      return actual !== null && actual !== undefined && compare(actual, first) > 0;
    case 'greater or equal':
    case 'gte':
      return actual !== null && actual !== undefined && compare(actual, first) >= 0;
    case 'lesser than':
    case 'lt':
      return actual !== null && actual !== undefined && compare(actual, first) < 0;
    case 'lesser or equal':
    case 'lte':
      return actual !== null && actual !== undefined && compare(actual, first) <= 0;
    case 'between':
    case 'range':
      return compare(actual, values[0]) >= 0 && compare(actual, values[1]) <= 0;
    case 'contains':
      return text(actual).includes(text(first));
    case 'not contains':
      return !text(actual).includes(text(first));
    case 'starts with':
      return text(actual).startsWith(text(first));
    case 'ends with':
      return text(actual).endsWith(text(first));
    default:
      throw new SdpInputError(`Unsupported condition "${c.condition}"`, 4000, 'search_criteria');
  }
}

function evaluate(rec: Rec, c: Criterion): boolean {
  let result = matchOne(rec, c);
  if (c.children) result = combine(result, c.children, rec);
  return result;
}

/** Each criterion after the first joins the result so far with its `logical_operator` (AND by default). */
function combine(initial: boolean | null, list: Criterion[] | Criterion, rec: Rec): boolean {
  const items = Array.isArray(list) ? list : [list];
  let result = initial;
  for (const c of items) {
    const v = evaluate(rec, c);
    if (result === null) result = v;
    else result = String(c.logical_operator ?? 'and').toLowerCase() === 'or' ? result || v : result && v;
  }
  return result ?? true;
}

/** Every field a criterion (and its children) names. */
export function criteriaFields(criteria: unknown): string[] {
  if (!criteria || typeof criteria !== 'object') return [];
  const list = Array.isArray(criteria) ? (criteria as Criterion[]) : [criteria as Criterion];
  return list.flatMap((c) => [...(c.field ? [c.field] : []), ...criteriaFields(c.children)]);
}

export function matches(rec: Rec, criteria: unknown): boolean {
  if (!criteria) return true;
  if (typeof criteria !== 'object')
    throw new SdpInputError('Invalid search_criteria', 4000, 'search_criteria');
  return combine(null, criteria as Criterion[] | Criterion, rec);
}

export interface ListInfo {
  row_count?: unknown;
  start_index?: unknown;
  sort_field?: unknown;
  sort_order?: unknown;
  get_total_count?: unknown;
  search_criteria?: unknown;
}

/**
 * One page of `records` for a `list_info`. Records with equal sort values come back newest id first:
 * ServiceDesk Plus promises no order within ties, and clients must not rely on one.
 */
export function page<T extends Rec>(
  records: T[],
  listInfo: ListInfo | undefined,
  defaultSort: string,
  /** Fields that may be sorted and searched by (others: 400 / 4000, as ServiceDesk Plus answers). */
  allowed?: (field: string) => boolean,
): { items: T[]; listInfo: Record<string, unknown> } {
  const li = listInfo ?? {};
  if (allowed) {
    if (typeof li.sort_field === 'string' && li.sort_field && !allowed(li.sort_field))
      throw new SdpInputError(`Sorting by ${li.sort_field} is not allowed`, 4000, 'sort_field');
    for (const f of criteriaFields(li.search_criteria))
      if (!allowed(f)) throw new SdpInputError(`Searching by ${f} is not allowed`, 4000, 'search_criteria');
  }
  const rowCount = Math.min(Math.max(Number(li.row_count ?? 10) || 10, 1), 100);
  const start = Math.max(Number(li.start_index ?? 1) || 1, 1);
  const sortField = typeof li.sort_field === 'string' && li.sort_field ? li.sort_field : defaultSort;
  const desc = String(li.sort_order ?? 'asc').toLowerCase() === 'desc';
  const filtered = records.filter((r) => matches(r, li.search_criteria));
  const sorted = filtered
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const c = compare(fieldValue(a.r, sortField), fieldValue(b.r, sortField));
      if (c !== 0) return desc ? -c : c;
      return compare(b.r.id, a.r.id);
    })
    .map((x) => x.r);
  const items = sorted.slice(start - 1, start - 1 + rowCount);
  const info: Record<string, unknown> = {
    has_more_rows: start - 1 + rowCount < sorted.length,
    start_index: start,
    row_count: items.length,
    sort_field: sortField,
    sort_order: desc ? 'desc' : 'asc',
    page: Math.floor((start - 1) / rowCount) + 1,
  };
  if (li.get_total_count === true || li.get_total_count === 'true') info.total_count = sorted.length;
  return { items, listInfo: info };
}
