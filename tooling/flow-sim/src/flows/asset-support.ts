/**
 * Helpers of the assets, information security and database access flows (`assets.ts`, `isms.ts`, `dbaccess.ts`):
 * company dates as the modules compute them, a tiny CSV reader/writer for the exports they round-trip, exclusive
 * use of a persona within this process, and the simulator's departments.
 */
import type { Json } from '../client';
import type { FlowContext } from '../flow';

/** The demo company's time zone: ITAM and ISMS dates ("today", due dates) are company dates. */
export const COMPANY_TZ = 'Asia/Taipei';

/** Today as `YYYY-MM-DD` in a time zone. */
export function todayIn(tz = COMPANY_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
    .slice(0, 10);
}

const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

/** Calendar months, the day clamped to the target month (Jan 31 + 1 month = Feb 28/29), like the modules. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = index - ty * 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(ty, tm, Math.min(d, last)));
}

/** Whole months from `from` to `to` (0 when `to` is earlier). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

/* ───────────────────────────── CSV ───────────────────────────── */

/** RFC 4180 rows (a leading BOM dropped). */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/* ───────────────────────────── exclusive personas ───────────────────────────── */

const held = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` with one of `candidates` that no other run in this process holds (a persona whose data the run
 * counts exactly, or a person × role pair that may only have one request at a time), waiting for one to be free.
 */
export async function withExclusive<T>(
  ctx: FlowContext,
  candidates: readonly string[],
  fn: (key: string) => Promise<T>,
  timeoutMs = 120_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const free = candidates.filter((c) => !held.has(c));
    if (free.length) {
      const key = ctx.rand.pick(free);
      held.add(key);
      try {
        return await fn(key);
      } finally {
        held.delete(key);
      }
    }
    if (Date.now() > until) ctx.fail(`none of ${candidates.join(', ')} was free for ${timeoutMs / 1000} s`);
    await sleep(100);
  }
}

/* ───────────────────────────── departments ───────────────────────────── */

let departments: Promise<Map<string, string>> | null = null;

/** Department ids by code (the simulator's `SIM`, `SIM-BIZ`, `SIM-IT` and the seed's), read once. */
export async function departmentIds(ctx: FlowContext): Promise<Map<string, string>> {
  departments ??= (async () => {
    const res = ctx.expect.ok(await ctx.as('admin').get('/departments'), 'list departments');
    return new Map((res.body.items as Json[]).map((d) => [d.code as string, d.id as string]));
  })().catch((err) => {
    departments = null;
    throw err;
  });
  return departments;
}

/** Notifications of `type` that mention `needle`, as the persona's inbox shows them (newest 100). */
export async function notificationsAbout(
  ctx: FlowContext,
  persona: string,
  type: string,
  needle: string,
): Promise<Json[]> {
  const res = ctx.expect.ok(
    await ctx.as(persona).get('/me/notifications', { query: { pageSize: 100 } }),
    `${persona}'s notifications`,
  );
  return (res.body.items as Json[]).filter((n) => n.type === type && JSON.stringify(n).includes(needle));
}
