/**
 * Pure domain logic of Information security (no I/O): asset numbers and value, stocktake and review rules,
 * calendar dates, and the CSV the register and account reviews are imported from and exported to. Shared by the
 * server, the web pages and the unit tests.
 */

/* ───────────────────────────── information assets ───────────────────────────── */

export const CIA_LEVELS = [1, 2, 3, 4] as const;
export type CiaLevel = (typeof CIA_LEVELS)[number];
/** Confidentiality, integrity, availability. */
export const CIA_DIMENSIONS = ['c', 'i', 'a'] as const;
export type CiaDimension = (typeof CIA_DIMENSIONS)[number];

export const ASSET_STATUSES = ['active', 'missing', 'disposed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Asset value = the highest of its confidentiality, integrity and availability scores. */
export function assetValue(c: number, i: number, a: number): number {
  return Math.max(c, i, a);
}

/** Class codes: 2–4 capital letters (`PE`, `HW`, `SW`, `DA`, `SV`). */
export const CLASS_CODE_RE = /^[A-Z]{2,4}$/;
/** Site codes: 2–8 capital letters or digits (`HQ01`). */
export const SITE_CODE_RE = /^[A-Z0-9]{2,8}$/;
/** Sub-class and label keys: lowercase slugs. */
export const KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** An asset number: site code, class code, then a sequence of at least four digits. */
export const ASSET_NUMBER_RE = /^[A-Z0-9]{2,8}[A-Z]{2,4}\d{4,6}$/;

/** `<site><class>`: the numbering sequence an asset belongs to. */
export const numberPrefix = (siteCode: string, classCode: string) => `${siteCode}${classCode}`;

/** `HQ01HW0001`: site code, class code and the sequence, zero-padded to four digits. */
export function formatAssetNumber(siteCode: string, classCode: string, seq: number): string {
  return `${numberPrefix(siteCode, classCode)}${String(seq).padStart(4, '0')}`;
}

/** The sequence of a number in the given `<site><class>` series, or null when it belongs to another one. */
export function sequenceOf(number: string, prefix: string): number | null {
  if (!number.startsWith(prefix)) return null;
  const rest = number.slice(prefix.length);
  return /^\d{4,6}$/.test(rest) ? Number(rest) : null;
}

/** Normalises free text for matching (case, width and spacing don't matter). */
export function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ───────────────────────────── references ───────────────────────────── */

export const REF_PREFIX = { stocktake: 'STK', review: 'ACR', account: 'SHA' } as const;
export type RefKind = keyof typeof REF_PREFIX;

/** `STK-00007`, `ACR-00012`, `SHA-00003`. */
export const formatRef = (kind: RefKind, n: number) => `${REF_PREFIX[kind]}-${String(n).padStart(5, '0')}`;

/** Accepts `STK-00007`, `stk-7` or `7`; null when it isn't one. */
export function parseRef(kind: RefKind, value: string): number | null {
  const m = new RegExp(`^(?:${REF_PREFIX[kind]}-)?0*(\\d{1,9})$`, 'i').exec(value.trim());
  return m ? Number(m[1]) : null;
}

export const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* ───────────────────────────── stocktakes ───────────────────────────── */

export const STOCKTAKE_STATUSES = ['scheduled', 'open', 'signed_off', 'cancelled'] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];
export const STOCKTAKE_RESULTS = ['confirmed', 'changed', 'missing', 'disposed'] as const;
export type StocktakeResult = (typeof STOCKTAKE_RESULTS)[number];
export const RECURRENCES = ['none', 'quarterly', 'yearly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** Months between two runs of a recurring stocktake or account review (0: it doesn't recur). */
export function recurrenceMonths(r: Recurrence): number {
  return r === 'yearly' ? 12 : r === 'quarterly' ? 3 : 0;
}
/** Fields an asset's manager may correct during a stocktake ("changed"). */
export const STOCKTAKE_EDITABLE = [
  'name',
  'location',
  'usersText',
  'brand',
  'model',
  'version',
  'quantity',
] as const;
export type StocktakeEditable = (typeof STOCKTAKE_EDITABLE)[number];

export interface Progress {
  total: number;
  done: number;
  /** 0–100, rounded down (100 only when everything is done). */
  percent: number;
  byResult: Record<StocktakeResult, number>;
}

export function stocktakeProgress(results: readonly (StocktakeResult | null)[]): Progress {
  const byResult = { confirmed: 0, changed: 0, missing: 0, disposed: 0 } as Record<StocktakeResult, number>;
  let done = 0;
  for (const r of results) {
    if (!r) continue;
    done++;
    byResult[r]++;
  }
  const total = results.length;
  return { total, done, percent: total ? Math.floor((done / total) * 100) : 100, byResult };
}

/** What the asset becomes when the stocktake is signed off (null: its status stays). */
export function statusAfterStocktake(result: StocktakeResult): AssetStatus | null {
  if (result === 'missing') return 'missing';
  if (result === 'disposed') return 'disposed';
  return 'active';
}

/* ───────────────────────────── account reviews ───────────────────────────── */

export const REVIEW_STATUSES = ['scheduled', 'open', 'completed', 'signed_off', 'cancelled'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_DECISIONS = ['keep', 'disable', 'delete'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const PRIVILEGES = ['admin', 'user'] as const;
export type Privilege = (typeof PRIVILEGES)[number];
export const ACCOUNT_STATES = ['enabled', 'disabled'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];
export const REVIEW_SOURCES = ['csv', 'application', 'manual'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

/** An item is decided when it has a decision and, to disable or delete, the date that was done. */
export function itemDecided(item: { decision: ReviewDecision | null; doneOn: string | null }): boolean {
  if (!item.decision) return false;
  return item.decision === 'keep' || Boolean(item.doneOn);
}

export function reviewProgress(items: readonly { decision: ReviewDecision | null; doneOn: string | null }[]) {
  const decided = items.filter(itemDecided).length;
  const byDecision = { keep: 0, disable: 0, delete: 0 } as Record<ReviewDecision, number>;
  for (const i of items) if (i.decision) byDecision[i.decision]++;
  return {
    total: items.length,
    decided,
    percent: items.length ? Math.floor((decided / items.length) * 100) : 100,
    byDecision,
  };
}

const ADMIN_WORDS = [
  'admin',
  'administrator',
  'administrators',
  'root',
  'superuser',
  'owner',
  'privileged',
  'sysadmin',
  'dba',
  '管理者',
  '管理員',
  '系統管理員',
  '特權',
];
const USER_WORDS = [
  'user',
  'users',
  'standard',
  'member',
  'normal',
  '使用者',
  '一般',
  'ユーザー',
  '一般ユーザー',
];

/** Reads a privilege as people write it in an exported account list (null when it says neither). */
export function parsePrivilege(value: string): Privilege | null {
  const v = normalizeName(value);
  if (!v) return null;
  if (ADMIN_WORDS.includes(v) || /admin|root|管理/.test(v)) return 'admin';
  if (USER_WORDS.includes(v)) return 'user';
  return null;
}

const ENABLED_WORDS = ['enabled', 'enable', 'active', 'yes', 'true', '1', 'on', '啟用', '有効', '正常'];
const DISABLED_WORDS = [
  'disabled',
  'disable',
  'inactive',
  'locked',
  'no',
  'false',
  '0',
  'off',
  'expired',
  '停用',
  '鎖定',
  '無効',
  'ロック',
];

/** Reads an account state (null when it says neither). */
export function parseAccountState(value: string): AccountState | null {
  const v = normalizeName(value);
  if (ENABLED_WORDS.includes(v)) return 'enabled';
  if (DISABLED_WORDS.includes(v)) return 'disabled';
  return null;
}

/** Roles that read as privileged: names with admin/owner/manage words, or a high risk level. */
export function privilegeOfRoles(
  roles: readonly { key: string; name: string; riskLevel?: string | null }[],
): Privilege {
  return roles.some(
    (r) => r.riskLevel === 'high' || /admin|owner|manage|root|super/i.test(`${r.key} ${r.name}`),
  )
    ? 'admin'
    : 'user';
}

/* ───────────────────────────── shared accounts ───────────────────────────── */

export const SHARED_ACCOUNT_STATUSES = ['active', 'retired'] as const;
export type SharedAccountStatus = (typeof SHARED_ACCOUNT_STATUSES)[number];
/** Why the custodian must change the password. */
export const PASSWORD_REASONS = ['member_left', 'member_moved', 'member_removed', 'custodian_left'] as const;
export type PasswordReason = (typeof PASSWORD_REASONS)[number];
export const DEFAULT_REVIEW_MONTHS = 12;

/* ───────────────────────────── calendar dates ───────────────────────────── */

export const COMPANY_TIME_ZONE = 'Asia/Taipei';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

/** Today's calendar date (`YYYY-MM-DD`) in a time zone. */
export function todayIn(timeZone: string = COMPANY_TIME_ZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid calendar date "${date}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return fromUtc(Date.UTC(y, m - 1, d) + days * 86_400_000);
}

/** Adds calendar months; the day is clamped to the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = index - ty * 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(ty, tm, Math.min(d, last)));
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Reads a date as spreadsheets write it: `2026-10-08`, `2026/10/8`, `2026.10.08`. */
export function parseLooseDate(value: string): string | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  return isDate(iso) ? iso : null;
}

/* ───────────────────────────── CSV ───────────────────────────── */

/** Excel opens UTF-8 CSV with CJK text correctly only with a byte-order mark. */
export const CSV_BOM = '﻿';
const FORMULA = /^[=+\-@\t\r]/;

/** One RFC 4180 cell; text that a spreadsheet would run as a formula is prefixed with an apostrophe. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else {
    s = typeof value === 'string' ? value : JSON.stringify(value);
    if (FORMULA.test(s)) s = `'${s}`;
  }
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV text (CRLF line ends) with the BOM, ready to download. */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** The separator used most outside quotes on the first line (comma, semicolon or tab). */
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
    if (cells.some((c) => c.trim() !== '')) out.push({ line: start, cells });
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

/** Header text compared loosely: case, spaces, `_`, `-`, `*` and brackets don't matter. */
export const normalizeHeader = (h: string) =>
  h
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-*()（）[\]]+/g, '');

/**
 * Finds each known column in a header row. `aliases` lists, per column, every name it may have (its key and its
 * label in each language). Returns the cell index per column found.
 */
export function matchColumns<C extends string>(
  header: readonly string[],
  aliases: Record<C, readonly string[]>,
): Map<C, number> {
  const lookup = new Map<string, C>();
  for (const [column, names] of Object.entries(aliases) as [C, readonly string[]][])
    for (const name of names) {
      const key = normalizeHeader(name);
      if (key && !lookup.has(key)) lookup.set(key, column);
    }
  const found = new Map<C, number>();
  header.forEach((h, i) => {
    const column = lookup.get(normalizeHeader(h));
    if (column && !found.has(column)) found.set(column, i);
  });
  return found;
}

export interface CsvTable<C extends string> {
  rows: { line: number; values: Partial<Record<C, string>> }[];
}

export type CsvTableResult<C extends string> =
  | ({ ok: true } & CsvTable<C>)
  | { ok: false; error: 'empty' | 'tooManyRows' }
  | { ok: false; error: 'missingColumns'; missing: C[] };

/** Reads a CSV with a header row into rows of trimmed values by column (empty cells left out). */
export function readCsvTable<C extends string>(
  text: string,
  aliases: Record<C, readonly string[]>,
  required: readonly NoInfer<C>[],
  maxRows: number,
): CsvTableResult<C> {
  const records = csvRecords(text);
  // A title line above the header (the register's paper layout) is skipped: the header is the first row with a
  // required column.
  const headerAt = records.findIndex((r) => {
    const found = matchColumns(r.cells, aliases);
    return required.every((c) => found.has(c));
  });
  if (records.length < 2) return { ok: false, error: 'empty' };
  if (headerAt < 0) {
    const found = matchColumns(records[0]!.cells, aliases);
    return { ok: false, error: 'missingColumns', missing: required.filter((c) => !found.has(c)) };
  }
  const body = records.slice(headerAt + 1);
  if (!body.length) return { ok: false, error: 'empty' };
  if (body.length > maxRows) return { ok: false, error: 'tooManyRows' };
  const columns = matchColumns(records[headerAt]!.cells, aliases);
  return {
    ok: true,
    rows: body.map(({ line, cells }) => {
      const values: Partial<Record<C, string>> = {};
      for (const [c, i] of columns) {
        const v = (cells[i] ?? '').trim();
        if (v) values[c] = v.startsWith("'") && FORMULA.test(v.slice(1)) ? v.slice(1) : v;
      }
      return { line, values };
    }),
  };
}

/* ───────────────────────────── the register's columns ───────────────────────────── */

/**
 * The register's columns, in the order of the paper register (number … value), then the platform's own. Export
 * writes them in this order; import finds them by key or by their label in any language.
 */
export const REGISTER_COLUMNS = [
  'number',
  'name',
  'class',
  'subclass',
  'manager',
  'users',
  'location',
  'brand',
  'model',
  'version',
  'quantity',
  'confidentiality',
  'integrity',
  'availability',
  'value',
  'classification',
  'site',
  'status',
  'notes',
] as const;
export type RegisterColumn = (typeof REGISTER_COLUMNS)[number];
export const REGISTER_IMPORT_MAX_ROWS = 2000;

/** Account list columns (the account review layout), import and export. */
export const REVIEW_COLUMNS = [
  'account',
  'user',
  'privilege',
  'status',
  'decision',
  'doneOn',
  'note',
] as const;
export type ReviewColumn = (typeof REVIEW_COLUMNS)[number];
export const REVIEW_IMPORT_MAX_ROWS = 5000;

/** Reads a score written as `3`, `3.0` or ` 3 `; null when it isn't 1–4. */
export function parseLevel(value: string | undefined): CiaLevel | null {
  if (!value) return null;
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 1 && n <= 4 ? (n as CiaLevel) : null;
}
