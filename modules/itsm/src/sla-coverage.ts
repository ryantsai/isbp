/**
 * Which SLA policy a ticket gets, worked out for the settings pages: the first active policy (in evaluation order)
 * whose ticket types include the ticket's and whose condition holds wins. These pure helpers answer "can this policy
 * ever apply?", "where must it go so it does?", "which priorities can its tickets have?" and "which policies do a
 * category's tickets get?" — shared by the API (policy list, automatic placement) and the policy forms (live hints).
 *
 * They enumerate the facts SLA conditions read (type, priority, impact, urgency, major, channel and the category with
 * its ancestors) over their finite values and evaluate the real conditions with `evaluateCondition`, so the answers
 * follow the matching rules exactly. A condition that reads anything else is "unknown": no claim is made about it.
 */
import { type Condition, conditionFacts, evaluateCondition } from '@isbp/sdk';
import { channelSchema, type TicketType, ticketTypeSchema } from './contracts';

export interface CoveragePolicy {
  id: string;
  ticketTypes: readonly TicketType[];
  condition: Condition | null | undefined;
  active: boolean;
}

export interface CoverageCategory {
  id: string;
  key: string;
  parentId: string | null;
}

export interface CoverageContext {
  categories: readonly CoverageCategory[];
}

/** Ticket types this policy never applies to at its place in the order; `by` = the policy that matches them first. */
export interface PolicyReach {
  blocked: { type: TicketType; by: string | null }[];
}

export const PRIORITIES = [1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Above this many fact combinations no claim is made (keeps the browser responsive). */
const MAX_COMBOS = 50_000;

type Facts = { ticket: Record<string, unknown> };
interface Dim {
  facts: readonly string[];
  values: readonly unknown[];
  set: (ticket: Record<string, unknown>, value: unknown) => void;
}

/** The category's key and the keys of its ancestors, nearest first (`ticket.categoryKeys`). */
export function categoryKeyChain(key: string | null, categories: readonly CoverageCategory[]): string[] {
  if (!key) return [];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const start = categories.find((c) => c.key === key);
  if (!start) return [key];
  const out: string[] = [];
  for (let c: CoverageCategory | undefined = start; c && !out.includes(c.key);) {
    out.push(c.key);
    c = c.parentId ? byId.get(c.parentId) : undefined;
  }
  return out;
}

function dimensions(ctx: CoverageContext, type: TicketType | null): Dim[] {
  const plain = (fact: string, values: readonly unknown[]): Dim => ({
    facts: [fact],
    values,
    set: (t, v) => {
      t[fact.slice('ticket.'.length)] = v;
    },
  });
  const chains = new Map(ctx.categories.map((c) => [c.key, categoryKeyChain(c.key, ctx.categories)]));
  return [
    plain('ticket.type', type ? [type] : ticketTypeSchema.options),
    plain('ticket.priority', PRIORITIES),
    plain('ticket.impact', [1, 2, 3]),
    plain('ticket.urgency', [1, 2, 3]),
    plain('ticket.major', [true, false]),
    plain('ticket.channel', channelSchema.options),
    {
      facts: ['ticket.categoryKey', 'ticket.categoryKeys'],
      values: [null, ...chains.keys()],
      set: (t, v) => {
        t.categoryKey = v;
        t.categoryKeys = v ? (chains.get(v as string) ?? [v]) : [];
      },
    },
  ];
}

const KNOWN_FACTS = new Set(dimensions({ categories: [] }, null).flatMap((d) => d.facts));

/** True when every fact the condition reads is one these helpers can enumerate. */
export function isAnalysable(condition: Condition | null | undefined): boolean {
  return conditionFacts(condition).every((f) => KNOWN_FACTS.has(f));
}

/** Every combination of the dimensions the conditions read (the others don't change any outcome). */
function combos(
  ctx: CoverageContext,
  type: TicketType | null,
  conditions: readonly (Condition | null | undefined)[],
  always: readonly string[] = [],
): Facts[] | null {
  const used = new Set([...always, ...conditions.flatMap((c) => conditionFacts(c))]);
  const dims = dimensions(ctx, type).filter((d) => d.facts.some((f) => used.has(f)));
  if (type && !dims.some((d) => d.facts.includes('ticket.type'))) dims.unshift(dimensions(ctx, type)[0]!);
  const total = dims.reduce((n, d) => n * d.values.length, 1);
  if (total > MAX_COMBOS) return null;
  let out: Record<string, unknown>[] = [{}];
  for (const d of dims)
    out = out.flatMap((t) =>
      d.values.map((v) => {
        const next = { ...t };
        d.set(next, v);
        return next;
      }),
    );
  return out.map((ticket) => ({ ticket }));
}

const applies = (p: CoveragePolicy, type: TicketType, facts: Facts) =>
  p.active && p.ticketTypes.includes(type) && evaluateCondition(p.condition ?? null, facts);

/**
 * For each of the candidate's types: the index in `ordered` of the policy at which every ticket the candidate could
 * match is already taken (`-1`: no ticket can match its rules; `ordered.length`: it is never fully taken). Null when
 * the candidate's condition reads facts these helpers can't enumerate. Policies whose conditions can't be analysed
 * never count as taking tickets (so no false "never applies").
 */
function deadlines(
  candidate: Pick<CoveragePolicy, 'ticketTypes' | 'condition'>,
  ordered: readonly CoveragePolicy[],
  ctx: CoverageContext,
): Map<TicketType, number> | null {
  if (!isAnalysable(candidate.condition)) return null;
  const out = new Map<TicketType, number>();
  for (const type of candidate.ticketTypes) {
    const relevant = ordered.filter(
      (q) => q.active && q.ticketTypes.includes(type) && isAnalysable(q.condition),
    );
    const all = combos(ctx, type, [candidate.condition, ...relevant.map((q) => q.condition)]);
    if (!all) return null;
    let open = all.filter((f) => evaluateCondition(candidate.condition ?? null, f));
    if (!open.length) {
      out.set(type, -1);
      continue;
    }
    let at = ordered.length;
    for (let i = 0; i < ordered.length; i++) {
      const q = ordered[i]!;
      if (!q.active || !q.ticketTypes.includes(type) || !isAnalysable(q.condition)) continue;
      open = open.filter((f) => !evaluateCondition(q.condition ?? null, f));
      if (!open.length) {
        at = i;
        break;
      }
    }
    out.set(type, at);
  }
  return out;
}

/**
 * Whether the candidate can apply when it comes after `earlier` (the policies checked before it). Null when its
 * condition can't be analysed.
 */
export function reachAfter(
  candidate: Pick<CoveragePolicy, 'ticketTypes' | 'condition'>,
  earlier: readonly CoveragePolicy[],
  ctx: CoverageContext,
): PolicyReach | null {
  const d = deadlines(candidate, earlier, ctx);
  if (!d) return null;
  const blocked: PolicyReach['blocked'] = [];
  for (const [type, at] of d) {
    if (at === -1) blocked.push({ type, by: null });
    else if (at < earlier.length) blocked.push({ type, by: earlier[at]!.id });
  }
  return { blocked };
}

/** Reach of every policy at its place in `ordered` (evaluation order). */
export function policyReach(
  ordered: readonly CoveragePolicy[],
  ctx: CoverageContext,
): Map<string, PolicyReach | null> {
  return new Map(ordered.map((p, i) => [p.id, reachAfter(p, ordered.slice(0, i), ctx)]));
}

/**
 * Where a new (or moved) policy goes so that it applies: just before the first policy that would otherwise take
 * every ticket it could match (for the earliest of its types), so policies that only overlap it keep their tickets.
 * `null`: at the end (nothing takes all its tickets, no ticket can match it, or its condition can't be analysed).
 */
export function placementFor(
  candidate: Pick<CoveragePolicy, 'ticketTypes' | 'condition'>,
  ordered: readonly CoveragePolicy[],
  ctx: CoverageContext,
): string | null {
  const d = deadlines(candidate, ordered, ctx);
  if (!d) return null;
  const at = Math.min(...[...d.values()].filter((i) => i >= 0 && i < ordered.length));
  return Number.isFinite(at) ? ordered[at]!.id : null;
}

/** Priorities a ticket matching the condition can have (all four when that can't be told). */
export function prioritiesOf(condition: Condition | null | undefined, ctx: CoverageContext): Priority[] {
  if (!condition || !isAnalysable(condition)) return [...PRIORITIES];
  const all = combos(ctx, null, [condition], ['ticket.priority']);
  if (!all) return [...PRIORITIES];
  const out = new Set<Priority>();
  for (const f of all) if (evaluateCondition(condition, f)) out.add(f.ticket.priority as Priority);
  return PRIORITIES.filter((p) => out.has(p));
}

/** True when the condition reads the ticket's category. */
export const readsCategory = (condition: Condition | null | undefined) =>
  conditionFacts(condition).some((f) => f === 'ticket.categoryKey' || f === 'ticket.categoryKeys');

/**
 * The policies tickets of a category get, per ticket type of the category, in evaluation order (each applies to at
 * least one ticket of that type in the category). Policies whose conditions can't be analysed are left out.
 */
export function categoryPolicies(
  category: { key: string; ticketTypes: readonly TicketType[] },
  ordered: readonly CoveragePolicy[],
  ctx: CoverageContext,
): { type: TicketType; policyIds: string[] }[] {
  const chain = categoryKeyChain(category.key, ctx.categories);
  const out: { type: TicketType; policyIds: string[] }[] = [];
  for (const type of category.ticketTypes) {
    const relevant = ordered.filter(
      (p) => p.active && p.ticketTypes.includes(type) && isAnalysable(p.condition),
    );
    if (!relevant.length) continue;
    // The category is fixed, so only the other dimensions are enumerated.
    const all = combos(
      { categories: [] },
      type,
      relevant.map((p) => p.condition),
    );
    if (!all) continue;
    const won = new Set<string>();
    for (const f of all) {
      f.ticket.categoryKey = category.key;
      f.ticket.categoryKeys = chain;
      const winner = relevant.find((p) => applies(p, type, f));
      if (winner) won.add(winner.id);
    }
    const ids = relevant.filter((p) => won.has(p.id)).map((p) => p.id);
    if (ids.length) out.push({ type, policyIds: ids });
  }
  return out;
}
