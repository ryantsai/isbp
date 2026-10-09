/**
 * Pure helpers of the ITSM pages (no React, no I/O) — unit-tested in `test/web-logic.test.ts`.
 */
import { localize } from '@isbp/sdk';
import type { Category, TicketListItem, TicketStatus, TicketType } from '../contracts';
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

/* ───────────────────────────── next step ───────────────────────────── */

/**
 * The one primary action of a ticket page: the next stop of its lifecycle (`key` names the label in
 * `itsm.actions.next.*`). The Status menu keeps the side exits. Null when the ticket waits for someone else (the
 * CAB, a sign-off) or is finished for good.
 */
export interface NextStep {
  to: TicketStatus;
  key:
    | 'resolve'
    | 'fulfil'
    | 'reopen'
    | 'startInvestigating'
    | 'markKnownError'
    | 'closeProblem'
    | 'submitForApproval'
    | 'revise'
    | 'startImplementation'
    | 'finishImplementation'
    | 'closeChange';
}

export function nextStep(ticket: {
  type: TicketType;
  status: TicketStatus;
  signOff?: unknown;
  transitions: readonly TicketStatus[];
}): NextStep | null {
  const can = (to: TicketStatus) => ticket.transitions.includes(to);
  const step = (to: TicketStatus, key: NextStep['key']): NextStep | null => (can(to) ? { to, key } : null);
  if (ticket.signOff) return null;
  switch (ticket.type) {
    case 'incident':
    case 'service_request': {
      const finish = ticket.type === 'service_request' ? 'fulfilled' : 'resolved';
      if (ticket.status === finish) return step('in_progress', 'reopen');
      return step(finish, ticket.type === 'service_request' ? 'fulfil' : 'resolve');
    }
    case 'problem':
      if (ticket.status === 'new') return step('investigating', 'startInvestigating');
      if (ticket.status === 'investigating') return step('known_error', 'markKnownError');
      if (ticket.status === 'known_error') return step('resolved', 'resolve');
      if (ticket.status === 'resolved') return step('closed', 'closeProblem');
      return null;
    case 'change':
      if (ticket.status === 'draft' || ticket.status === 'assessment')
        return step('authorization', 'submitForApproval');
      if (ticket.status === 'rejected') return step('draft', 'revise');
      if (ticket.status === 'scheduled') return step('implementing', 'startImplementation');
      if (ticket.status === 'implementing') return step('review', 'finishImplementation');
      if (ticket.status === 'review') return step('closed', 'closeChange');
      return null;
  }
}

/** Where a ticket page's back link goes: the list of its kind. */
export function listOf(type: TicketType): { href: string; key: 'tickets' | 'problems' | 'changes' } {
  if (type === 'problem') return { href: '/itsm/problems', key: 'problems' };
  if (type === 'change') return { href: '/itsm/changes', key: 'changes' };
  return { href: '/itsm', key: 'tickets' };
}

/** A change must have a planned window that hasn't started yet (emergencies excepted) to be submitted. */
export function windowProblem(
  change: { changeType: string; plannedStart: string | null; plannedEnd: string | null },
  now: Date,
): 'missing' | 'past' | null {
  if (!change.plannedStart || !change.plannedEnd) return 'missing';
  if (change.changeType !== 'emergency' && new Date(change.plannedStart).getTime() < now.getTime())
    return 'past';
  return null;
}

/** "KB-00078" references in a reply (links the agent inserted or typed). */
export function articleRefsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\bKB-\d{3,12}\b/g)].map((m) => m[0]))];
}
