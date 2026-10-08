/**
 * The CSV an inventory tool exports (SCCM/Intune, Lansweeper, PDQ, a spreadsheet…), read in the browser and sent to
 * `POST /discovery/import` in batches of whole devices: one row per installed product, grouped by device. Each device
 * in the file is a complete report for that device, exactly like `POST /discovery/software`. Pure: no I/O.
 *
 * Columns (header row required, any order; names are case-insensitive and spaces, `_` and `-` are ignored, so
 * "Serial number" and `serial_number` are the same): `serial_number` or `asset_tag` (one of them per row),
 * `product` (required), `publisher`, `version`. Comma, semicolon and tab separators are recognised.
 */

/** The documented columns, in the order the Discovery page lists them. */
export const DISCOVERY_CSV_COLUMNS = [
  { name: 'serial_number', required: 'device' },
  { name: 'asset_tag', required: 'device' },
  { name: 'product', required: 'always' },
  { name: 'publisher', required: 'no' },
  { name: 'version', required: 'no' },
] as const;
export type DiscoveryCsvColumn = (typeof DISCOVERY_CSV_COLUMNS)[number]['name'];

/** A sample file, shown on the Discovery page next to the column list (data, the same in every language). */
export const DISCOVERY_CSV_EXAMPLE = [
  'serial_number,product,publisher,version',
  '5CG4123ABC,Google Chrome,Google,129.0.6668.90',
  '5CG4123ABC,7-Zip,Igor Pavlov,24.08',
  'PF4XK2LM,Microsoft 365 E3,Microsoft,16.0.18025',
].join('\n');

export const DISCOVERY_CSV_MAX_ROWS = 100_000;
/** Same cap as one `POST /discovery/software` report. */
export const DISCOVERY_MAX_PRODUCTS = 2000;
/** Devices per `POST /discovery/import` request. */
export const DISCOVERY_IMPORT_BATCH = 100;

const LIMITS = { serial_number: 100, asset_tag: 30, product: 200, publisher: 200, version: 64 } as const;

export interface DiscoveryCsvProduct {
  product: string;
  publisher: string | null;
  version: string | null;
}

export interface DiscoveryCsvDevice {
  /** `serial_number` or `asset_tag` as written in the file (shown in results). */
  device: string;
  assetSerial?: string;
  assetTag?: string;
  products: DiscoveryCsvProduct[];
}

/** A row that was left out, with its line number in the file (1 = header). */
export interface DiscoveryCsvIssue {
  line: number;
  code: 'noDevice' | 'noProduct' | 'tooLong' | 'tooManyProducts';
}

export type DiscoveryCsvResult =
  | { ok: true; rows: number; devices: DiscoveryCsvDevice[]; issues: DiscoveryCsvIssue[] }
  | { ok: false; error: 'empty' | 'tooManyRows' }
  | { ok: false; error: 'missingColumns'; missing: DiscoveryCsvColumn[] };

const normalise = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
const HEADER: Record<string, DiscoveryCsvColumn> = Object.fromEntries(
  DISCOVERY_CSV_COLUMNS.map((c) => [normalise(c.name), c.name]),
);

/** The separator used most outside quotes on the first line. */
function separatorOf(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]!++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return n > 0 ? best : ',';
}

/** RFC 4180 records with the line each one starts on (quoted fields may hold separators and newlines). */
export function csvRecords(text: string): { line: number; cells: string[] }[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = separatorOf(src);
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let touched = false;
  const endRecord = () => {
    cells.push(cell);
    if (touched || cells.length > 1 || cell !== '') out.push({ line: start, cells });
    cells = [];
    cell = '';
    touched = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      touched = true;
    } else if (ch === sep) {
      cells.push(cell);
      cell = '';
      touched = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else cell += ch;
  }
  if (cell !== '' || cells.length || touched) endRecord();
  return out;
}

const value = (v: string | undefined) => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

/** Parses an inventory export into complete per-device reports (products deduplicated case-insensitively). */
export function parseDiscoveryCsv(text: string): DiscoveryCsvResult {
  const records = csvRecords(text);
  if (records.length < 2) return { ok: false, error: 'empty' };
  if (records.length - 1 > DISCOVERY_CSV_MAX_ROWS) return { ok: false, error: 'tooManyRows' };
  const columns = new Map<DiscoveryCsvColumn, number>();
  records[0]!.cells.forEach((h, i) => {
    const c = HEADER[normalise(h)];
    if (c && !columns.has(c)) columns.set(c, i);
  });
  const missing: DiscoveryCsvColumn[] = [];
  if (!columns.has('serial_number') && !columns.has('asset_tag')) missing.push('serial_number', 'asset_tag');
  if (!columns.has('product')) missing.push('product');
  if (missing.length) return { ok: false, error: 'missingColumns', missing };

  const cell = (cells: string[], c: DiscoveryCsvColumn) => {
    const i = columns.get(c);
    return i === undefined ? null : value(cells[i]);
  };
  const devices = new Map<string, DiscoveryCsvDevice & { seen: Set<string>; firstLine: number }>();
  const issues: DiscoveryCsvIssue[] = [];
  for (const { line, cells } of records.slice(1)) {
    const row = {
      serial_number: cell(cells, 'serial_number'),
      asset_tag: cell(cells, 'asset_tag'),
      product: cell(cells, 'product'),
      publisher: cell(cells, 'publisher'),
      version: cell(cells, 'version'),
    };
    if (!row.serial_number && !row.asset_tag) {
      issues.push({ line, code: 'noDevice' });
      continue;
    }
    if (!row.product) {
      issues.push({ line, code: 'noProduct' });
      continue;
    }
    if ((Object.keys(LIMITS) as (keyof typeof LIMITS)[]).some((k) => (row[k]?.length ?? 0) > LIMITS[k])) {
      issues.push({ line, code: 'tooLong' });
      continue;
    }
    const key = row.serial_number
      ? `s:${row.serial_number.toLowerCase()}`
      : `t:${row.asset_tag!.toUpperCase()}`;
    let d = devices.get(key);
    if (!d) {
      d = {
        device: row.serial_number ?? row.asset_tag!,
        ...(row.serial_number ? { assetSerial: row.serial_number } : { assetTag: row.asset_tag! }),
        products: [],
        seen: new Set(),
        firstLine: line,
      };
      devices.set(key, d);
    }
    const p = row.product.toLowerCase();
    if (d.seen.has(p)) continue;
    if (d.products.length >= DISCOVERY_MAX_PRODUCTS) {
      issues.push({ line, code: 'tooManyProducts' });
      continue;
    }
    d.seen.add(p);
    d.products.push({ product: row.product, publisher: row.publisher, version: row.version });
  }
  return {
    ok: true,
    rows: records.length - 1,
    devices: [...devices.values()].map(({ seen: _seen, firstLine: _line, ...d }) => d),
    issues,
  };
}

/**
 * Splits devices into import requests: whole devices only (a device is always reported completely), at most
 * `DISCOVERY_IMPORT_BATCH` devices and about `maxBytes` of JSON each, under the API's request size limit.
 */
export function discoveryBatches<T extends { products: unknown[] }>(
  devices: readonly T[],
  maxBytes = 700_000,
): T[][] {
  const batches: T[][] = [];
  const encoder = new TextEncoder();
  let current: T[] = [];
  let size = 0;
  for (const d of devices) {
    const bytes = encoder.encode(JSON.stringify(d)).length;
    if (current.length && (current.length >= DISCOVERY_IMPORT_BATCH || size + bytes > maxBytes)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(d);
    size += bytes;
  }
  if (current.length) batches.push(current);
  return batches;
}
