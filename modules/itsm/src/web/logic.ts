/**
 * Pure helpers of the ITSM pages (no React, no I/O) — unit-tested in `test/web-logic.test.ts`.
 */
import { localize } from '@isbp/sdk';
import type { Category, TicketListItem } from '../contracts';
import type { SlaStatus } from './types';

/* ───────────────────────────── categories ───────────────────────────── */

export interface CategoryNode {
  category: Category;
  depth: number;
  /** Localized "Network › VPN". */
  path: string;
  /** Localized own name. */
  name: string;
}

/** Categories in tree order (parents before children, siblings by sort order then name). */
export function categoryTree(items: readonly Category[], locale: string): CategoryNode[] {
  const children = new Map<string | null, Category[]>();
  const ids = new Set(items.map((c) => c.id));
  for (const c of items) {
    // A child whose parent is filtered out (inactive or another type) shows at the top level.
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(c);
    children.set(parent, list);
  }
  const out: CategoryNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = [...(children.get(parent) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || localize(a.name, locale).localeCompare(localize(b.name, locale)),
    );
    for (const c of list) {
      const name = localize(c.name, locale);
      const path = [...c.ancestors.map((a) => localize(a.name, locale)), name].join(' › ');
      out.push({ category: c, depth, path, name });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/* ───────────────────────────── SLA ───────────────────────────── */

export type SlaState = 'breached' | 'at_risk' | 'running' | 'paused' | 'met' | 'cancelled';

/** Live state of an SLA target: running past its due time counts as breached before the job marks it. */
export function slaState(
  sla: { status: SlaStatus; dueAt: string; elapsedRatio: number },
  now: Date,
  warnAt = 0.75,
): SlaState {
  if (sla.status === 'breached') return 'breached';
  if (sla.status !== 'running') return sla.status;
  const due = new Date(sla.dueAt).getTime();
  if (due <= now.getTime()) return 'breached';
  return sla.elapsedRatio >= warnAt ? 'at_risk' : 'running';
}

const STATE_RANK: Record<SlaState, number> = {
  breached: 0,
  at_risk: 1,
  running: 2,
  paused: 3,
  met: 4,
  cancelled: 4,
};

/** Breached first, then at risk, then by due time; tickets without a running SLA last, by priority. */
export function mostUrgent<T extends Pick<TicketListItem, 'priority' | 'sla'>>(
  items: readonly T[],
  now: Date,
): T[] {
  const rank = (r: T) => (r.sla ? STATE_RANK[slaState(r.sla, now)] : 5);
  return [...items].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.sla && b.sla ? a.sla.dueAt.localeCompare(b.sla.dueAt) : 0) ||
      a.priority - b.priority,
  );
}

/* ───────────────────────────── charts ───────────────────────────── */

/** A clean axis maximum and its ticks (0 / 5 / 10 …). */
export function niceTicks(max: number, count = 4) {
  if (max <= 0) return { max: count, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/* ───────────────────────────── calendar ───────────────────────────── */

export const DAY = 86_400_000;
export const pad = (n: number) => String(n).padStart(2, '0');
export const keyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const msOf = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dayIn(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Weeks (Monday first) covering a `YYYY-MM` month. */
export function monthGrid(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = Date.UTC(y, m - 1, 1);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - offset * DAY;
  const weeks = Math.ceil((offset + days) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const ms = start + (w * 7 + d) * DAY;
      const key = keyOf(ms);
      return { key, day: new Date(ms).getUTCDate(), inMonth: key.startsWith(month) };
    }),
  );
}

export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
