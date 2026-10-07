import { DONE_STATUSES, TRANSITIONS, type TicketStatus, type TicketType } from '../contracts';

const ORDER: readonly TicketStatus[] = [
  'draft',
  'new',
  'pending_approval',
  'assessment',
  'authorization',
  'scheduled',
  'investigating',
  'in_progress',
  'implementing',
  'on_hold',
  'known_error',
  'review',
  'resolved',
  'fulfilled',
  'closed',
  'rejected',
  'cancelled',
];

/** Every status a ticket type can be in, in lifecycle order. */
export function statusesOf(type?: TicketType): TicketStatus[] {
  const types = type ? [type] : (Object.keys(TRANSITIONS) as TicketType[]);
  const set = new Set<TicketStatus>();
  for (const ty of types)
    for (const [from, to] of Object.entries(TRANSITIONS[ty]) as [TicketStatus, TicketStatus[]][]) {
      set.add(from);
      to.forEach((s) => set.add(s));
    }
  return ORDER.filter((s) => set.has(s));
}

export const isDone = (status: TicketStatus) => DONE_STATUSES.includes(status);

/** Statuses that end work and need a resolution code (cancel too). */
export const NEEDS_CODE: readonly TicketStatus[] = ['resolved', 'fulfilled', 'cancelled'];
