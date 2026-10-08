/**
 * ITSM rules that need no I/O (shared by the services and the unit tests).
 */
import type { StatusTone } from '@isbp/sdk/server';
import {
  DONE_STATUSES,
  formatTicketRef,
  type LinkType,
  SIGN_OFF_TRANSITIONS,
  type TicketStatus,
  TRANSITIONS,
  type TicketType,
} from '../contracts';

export const OPEN_STATUSES = (
  [
    'new',
    'pending_approval',
    'in_progress',
    'on_hold',
    'investigating',
    'known_error',
    'draft',
    'assessment',
    'authorization',
    'scheduled',
    'implementing',
    'review',
  ] as const satisfies readonly TicketStatus[]
).slice();

export const isDone = (status: TicketStatus) => DONE_STATUSES.includes(status);

/** Statuses where the work is finished and the requester can confirm or reopen. */
export const SOLVED_STATUSES: readonly TicketStatus[] = ['resolved', 'fulfilled'];
/** Statuses where nothing happens any more (no comments from requesters, no SLA). */
export const FINAL_STATUSES: readonly TicketStatus[] = ['closed', 'cancelled', 'rejected'];
/** Moving to these needs a resolution code and notes. */
export const RESOLVING_STATUSES: readonly TicketStatus[] = ['resolved', 'fulfilled', 'cancelled'];

/**
 * Statuses an agent may move a ticket to from its current one. While a resolution waits for its sign-off
 * (`signOff`) it can only go back to work (withdrawing the resolution) or be cancelled.
 */
export function allowedTransitions(type: TicketType, status: TicketStatus, signOff = false): TicketStatus[] {
  if (signOff && status === 'pending_approval') return [...SIGN_OFF_TRANSITIONS];
  return [...(TRANSITIONS[type][status] ?? [])];
}

export function canTransition(
  type: TicketType,
  from: TicketStatus,
  to: TicketStatus,
  signOff = false,
): boolean {
  return allowedTransitions(type, from, signOff).includes(to);
}

/** Colour family for a status (always shown with its label — never colour alone). */
export function statusTone(status: TicketStatus): StatusTone {
  switch (status) {
    case 'new':
    case 'in_progress':
    case 'investigating':
    case 'assessment':
    case 'scheduled':
    case 'implementing':
    case 'review':
      return 'info';
    case 'pending_approval':
    case 'on_hold':
    case 'known_error':
    case 'authorization':
      return 'warning';
    case 'resolved':
    case 'fulfilled':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** The status label key, "Waiting for sign-off" while a resolution waits for its sign-off. */
export const statusLabelKey = (t: { status: TicketStatus; signOffInstanceId?: string | null }) =>
  t.signOffInstanceId && t.status === 'pending_approval' ? 'itsm.signOff.status' : `itsm.status.${t.status}`;

/** Where a ticket stands for the request portal ("My requests"). */
export function portalState(status: TicketStatus): 'open' | 'closed' {
  return isDone(status) ? 'closed' : 'open';
}

/** Progress reported on the form submission a service request fulfils. */
export function fulfilmentState(status: TicketStatus): 'open' | 'done' | 'cancelled' {
  if (status === 'cancelled' || status === 'rejected') return 'cancelled';
  return isDone(status) ? 'done' : 'open';
}

export const statusKey = (status: TicketStatus) => `itsm.status.${status}`;
export const ticketHref = (reference: string) => `/itsm/tickets/${reference}`;
export const refOf = (t: { type: TicketType; number: number }) => formatTicketRef(t.type, t.number);

/**
 * Why a link is not allowed (null = fine):
 * `caused_by` incident/request → problem · `implements` change → incident/problem ·
 * `parent_of` between tickets of the same type · `related` / `duplicate_of` between any.
 */
export function linkProblem(type: LinkType, source: TicketType, target: TicketType): string | null {
  switch (type) {
    case 'caused_by':
      return (source === 'incident' || source === 'service_request') && target === 'problem'
        ? null
        : 'Only incidents and service requests can be caused by a problem';
    case 'implements':
      return source === 'change' && (target === 'incident' || target === 'problem')
        ? null
        : 'Only a change can implement the fix for an incident or a problem';
    case 'parent_of':
      return source === target ? null : 'Parent and child tickets must be of the same type';
    default:
      return null;
  }
}

/** `related` is symmetric: A related B and B related A are the same link. */
export const isSymmetricLink = (type: LinkType) => type === 'related';

/** Plain-text excerpt for notifications. */
export function excerpt(text: string, max = 280): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
