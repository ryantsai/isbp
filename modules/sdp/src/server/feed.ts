/**
 * Change-feed cursors and inbound webhook bodies. Pure: no I/O.
 */

/**
 * Where a change feed stopped.
 *
 * - `time` (records with a last-update time): the last time handed out, and the ids already handed out *at*
 *   that time. The next page asks for records updated at or after `t` and skips those ids, so records sharing a
 *   millisecond are neither skipped nor repeated, whatever order ServiceDesk Plus returns them in.
 * - `scan` (records without one): a full pass sorted by id; `after` is the last id handed out and `index` the
 *   `start_index` to continue from. When a pass ends the cursor starts the next pass from the beginning; the hub
 *   skips records whose (hash) version it already has.
 */
export type FeedCursor =
  { m: 'time'; t: number | null; ids: string[] } | { m: 'scan'; after: string | null; index: number };

const MAX_IDS = 1000;

export type TimeCursor = Extract<FeedCursor, { m: 'time' }>;
export type ScanCursor = Extract<FeedCursor, { m: 'scan' }>;

export const START: { time: TimeCursor; scan: ScanCursor } = {
  time: { m: 'time', t: null, ids: [] },
  scan: { m: 'scan', after: null, index: 1 },
};

export function encodeCursor(c: FeedCursor): string {
  const body = c.m === 'time' ? { v: 2, m: 'time', t: c.t, ids: c.ids.slice(-MAX_IDS) } : { v: 2, ...c };
  return Buffer.from(JSON.stringify(body)).toString('base64url');
}

/** An unreadable cursor starts from the beginning (the hub's snapshots make replays harmless). */
export function decodeCursor(cursor: string | null | undefined): FeedCursor | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (v.m === 'scan') {
      const after = typeof v.after === 'string' && SDP_ID_RE.test(v.after) ? v.after : null;
      const index =
        typeof v.index === 'number' && Number.isSafeInteger(v.index) && v.index >= 1 ? v.index : 1;
      return { m: 'scan', after, index: after ? index : 1 };
    }
    // `time`, and version 1 cursors (no mode).
    const t = typeof v.t === 'number' && Number.isFinite(v.t) && v.t > 0 ? v.t : null;
    const ids = Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === 'string') : [];
    return { m: 'time', t, ids: t === null ? [] : ids };
  } catch {
    return null;
  }
}

/** The `time` cursor after handing out `items` (sorted by time, then id) from a page that started at `prev`. */
export function advanceCursor(
  prev: Extract<FeedCursor, { m: 'time' }>,
  items: { id: string; t: number }[],
): Extract<FeedCursor, { m: 'time' }> {
  if (!items.length) return prev;
  const t = items[items.length - 1]!.t;
  const at = items.filter((i) => i.t === t).map((i) => i.id);
  return { m: 'time', t, ids: t === prev.t ? [...new Set([...prev.ids, ...at])] : at };
}

/** Numeric ids (ServiceDesk Plus ids are longs) compared as numbers. */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** A record id as ServiceDesk Plus issues them (digits); anything else is not one of its records. */
export const SDP_ID_RE = /^\d{1,20}$/;

/** Modules whose custom triggers can run a webhook (Admin › Automation › Custom Triggers). */
const WEBHOOK_MODULES = new Set(['request', 'problem', 'change'] as const);
type WebhookModule = 'request' | 'problem' | 'change';

function parseBody(body: unknown): unknown {
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body !== 'string') return body;
  const s = body.trim();
  if (s.startsWith('{')) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  // A form payload (`module=request&id=123`): ServiceDesk Plus webhooks can send either.
  return Object.fromEntries(new URLSearchParams(s));
}

/**
 * The record an inbound webhook says changed: `{ "module": "request" | "problem" | "change", "id": <id> }`, as
 * JSON or a form payload, the id a number or a numeric string. Anything else (other modules, an id the trigger
 * did not fill in, arrays) is ignored. Never trusted for data: the hub re-reads the record.
 */
export function parseWebhook(body: unknown): { objectType: WebhookModule; id: string }[] {
  const o = parseBody(body);
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return [];
  const { module, id } = o as Record<string, unknown>;
  const objectType = typeof module === 'string' ? module.trim().toLowerCase() : '';
  if (!WEBHOOK_MODULES.has(objectType as WebhookModule)) return [];
  const value =
    typeof id === 'number' && Number.isSafeInteger(id) && id > 0
      ? String(id)
      : typeof id === 'string'
        ? id.trim()
        : '';
  return SDP_ID_RE.test(value) ? [{ objectType: objectType as WebhookModule, id: value }] : [];
}
