/**
 * Who may see and do what with a ticket. The routes, the AI tools and the `viewer` block of the ticket
 * DTO all use these functions, so the UI and the API can never disagree.
 *
 * - Agents read with `itsm.tickets.read`, globally or for the ticket's department (`department_id`, the
 *   requester's department at creation). `itsm.changes.read` also reads every change.
 * - Requesters (requester or requested-for) see their own tickets with `itsm.tickets.create` only, and
 *   only the public conversation.
 * - Working a ticket needs `itsm.tickets.work` at its scope; changes also accept `itsm.changes.manage`,
 *   problems `itsm.problems.manage`.
 */
import type { AuthContext } from '@isbp/sdk/server';
import { eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { TicketStatus, TicketType } from '../contracts';
import { allowedTransitions, FINAL_STATUSES, SOLVED_STATUSES } from './rules';
import { tickets } from './schema';

export interface TicketScope {
  type: TicketType;
  status: TicketStatus;
  departmentId: string | null;
  requesterId: string | null;
  requestedForId: string | null;
}

export interface Viewer {
  role: 'agent' | 'requester';
  canEdit: boolean;
  canComment: boolean;
  canWorkNote: boolean;
  transitions: TicketStatus[];
  canReopen: boolean;
  canConfirm: boolean;
}

const scopeOf = (t: TicketScope) => ({ departmentId: t.departmentId });

export function isRequesterOf(t: TicketScope, auth: AuthContext): boolean {
  const me = auth.user?.id;
  return Boolean(me && (t.requesterId === me || t.requestedForId === me));
}

export function canReadAsAgent(t: TicketScope, auth: AuthContext): boolean {
  if (auth.can('itsm.tickets.read', scopeOf(t))) return true;
  return t.type === 'change' && auth.can('itsm.changes.read');
}

export function canRead(t: TicketScope, auth: AuthContext): boolean {
  return canReadAsAgent(t, auth) || isRequesterOf(t, auth);
}

export function canWork(t: TicketScope, auth: AuthContext): boolean {
  if (auth.can('itsm.tickets.work', scopeOf(t))) return true;
  if (t.type === 'change') return auth.can('itsm.changes.manage');
  if (t.type === 'problem') return auth.can('itsm.problems.manage');
  return false;
}

/** Agent work on incidents/requests anywhere — used for "raise on behalf of" and agent-only fields. */
export function isAgent(auth: AuthContext, departmentId: string | null): boolean {
  return auth.can('itsm.tickets.work', { departmentId });
}

export function viewerOf(t: TicketScope, auth: AuthContext): Viewer {
  const agent = canReadAsAgent(t, auth);
  const work = canWork(t, auth);
  const requester = isRequesterOf(t, auth);
  const solved =
    SOLVED_STATUSES.includes(t.status) && (t.type === 'incident' || t.type === 'service_request');
  return {
    role: agent ? 'agent' : 'requester',
    canEdit: work,
    canComment: work || (requester && !FINAL_STATUSES.includes(t.status)),
    canWorkNote: work,
    transitions: work ? allowedTransitions(t.type, t.status) : [],
    canReopen: requester && solved,
    canConfirm: requester && solved,
  };
}

/**
 * SQL filter for tickets the caller may see in lists (undefined = everything): their own, those in
 * their read reach, and every change for `itsm.changes.read`.
 */
export function visibilityFilter(auth: AuthContext): SQL | undefined {
  const read = auth.reach('itsm.tickets.read');
  if (read.global) return undefined;
  const parts: SQL[] = [];
  const me = auth.user?.id;
  if (me) parts.push(eq(tickets.requesterId, me), eq(tickets.requestedForId, me));
  if (read.departmentIds.length) parts.push(inArray(tickets.departmentId, read.departmentIds));
  if (auth.can('itsm.changes.read')) parts.push(eq(tickets.type, 'change'));
  return parts.length ? or(...parts) : sql`false`;
}

/** Holds any agent permission (lookups such as groups and agents). */
export function hasAgentReach(auth: AuthContext): boolean {
  const p = auth.permissions;
  return (
    p.hasAny('itsm.tickets.read') ||
    p.hasAny('itsm.tickets.work') ||
    p.hasAny('itsm.tickets.triage') ||
    p.hasAny('itsm.changes.read') ||
    p.hasAny('itsm.config.manage')
  );
}
